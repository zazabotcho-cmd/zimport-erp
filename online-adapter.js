(function(){
  const cfg=window.ZIMPORT_ONLINE_CONFIG||{};
  const configured=()=>/^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl||'')&&!String(cfg.supabaseAnonKey||'').includes('PASTE_');
  const invitationLanding=/[&#]type=(invite|recovery)(?:&|$)/.test(location.hash);
  let client=null,user=null,profile=null,syncTimer=null,syncing=false,dirty=false,realtimeTimer=null;
  let loginInFlight=null,realtimeChannel=null,loadedUserId=null;
  let latestState=null,latestSettings=null,baseline=new Map();
  let cloudLoadComplete=false; // Never synchronize an incomplete or empty startup snapshot.
  let cloudShipmentIds=new Set();
  let pendingSave=null, inFlight=null, retryDelay=500, saveRevision=0, loading=false, baselineReady=false;
  const saveKey=()=>['winglobal-pending-save',cfg.supabaseUrl,cfg.organizationId,user.id].join(':');
  const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function equal(a,b){
    if(a===b)return true;
    if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,i)=>equal(value,b[i]));
    if(!isObject(a)||!isObject(b))return false;
    return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
  }
  function mergePending(before,after,cloud,...fallback){
    const sent=mergeChangedFields(fallback.length?fallback[0]:before,after,cloud);
    return mergeChangedFields(before,after,sent);
  }
  function mergeChangedFields(before,after,cloud){
    if(equal(before,after))return cloud;
    if(!isObject(after)||!isObject(cloud)||(!isObject(before)&&before!==undefined))return after;
    before=before??{};
    const merged={...cloud};
    for(const field of new Set([...Object.keys(before),...Object.keys(after)])){
      const value=mergeChangedFields(
        Object.hasOwn(before,field)?before[field]:undefined,
        Object.hasOwn(after,field)?after[field]:undefined,
        Object.hasOwn(cloud,field)?cloud[field]:undefined
      );
      if(value===undefined)delete merged[field];
      else Object.defineProperty(merged,field,{value,enumerable:true,writable:true,configurable:true});
    }
    return merged;
  }
  function stashPending(save){
    pendingSave=save;
    try{
      if(save)localStorage.setItem(saveKey(),JSON.stringify(save));
      else localStorage.removeItem(saveKey());
      return true;
    }catch(error){
      console.error('Browser could not store the pending save',error);
      return false;
    }
  }
  function canSyncTable(table){
    return !window.ZimportPermissions||window.ZimportPermissions.canTable(profile,table);
  }
  function collectPending(flat,workspaces){
    const rows=[];
    for(const [table,records] of Object.entries(flat)){
      if(!canSyncTable(table))continue;
      const current=new Map(records.map(row=>[String(row.id),cleanData(row)]));
      const sending=inFlight?.rows[table]||new Map();
      const original=new Map([...baseline].filter(([k])=>k.startsWith(table+':'))
        .map(([k,b])=>[k.slice(table.length+1),b.data]));
      for(const id of new Set([...original.keys(),...current.keys(),...sending.keys()])){
        const before=sending.has(id)?sending.get(id):original.get(id);
        const after=current.get(id);
        if(!equal(before,after)||!equal(original.get(id),after))
          rows.push({table,id,before,after,...(sending.has(id)?{fallback:original.get(id),hasFallback:true}:{})});
      }
    }
    return rows.length||workspaces.length?{rows,workspaces}:null;
  }
  function restorePendingTable(table,rows){
    const restored=new Map(rows.map(row=>[String(row.id),row]));
    for(const entry of pendingSave?.rows||[]){
      if(entry.table!==table)continue;
      const cloud=restored.get(entry.id);
      const data=cleanData(cloud);
      const merged=mergePending(entry.before,entry.after,cloud?data:undefined,entry.hasFallback?entry.fallback:entry.before);
      if(merged===undefined)restored.delete(entry.id);
      else restored.set(entry.id,{...cloud,...merged,id:entry.id});
    }
    return [...restored.values()];
  }
  const $=id=>document.getElementById(id);
  const collectionMap={agencies:'agencies',suppliers:'suppliers',items:'items',tenders:'tenders',purchaseOrders:'purchase_orders',shipments:'shipments'};
  const inventoryStateFields=['inventoryCaseOverrides','inventorySaleAvailability','inventorySalesMetrics',
    'inventoryStockOutDates','officeInventory','archivedLcboInventory','inventoryDeletedPoSnapshots',
    'manuallyArchivedPurchaseOrders'];
  function inventoryState(state){
    return Object.fromEntries(inventoryStateFields.filter(field=>state[field]!==undefined)
      .map(field=>[field,state[field]]));
  }
  const warehouseLinkedFields=['inventoryCaseOverrides','inventorySaleAvailability','inventorySalesMetrics','inventoryStockOutDates'];
  const warehousePoKey=po=>encodeURIComponent(String(po.originalPoId||po.id));
  const warehouseRecordPoKey=row=>String(row.inventoryKey||'').split('::')[0];
  function warehousePurchaseOrders(orders,state){
    const byPo=new Map();
    for(const row of state.officeInventory||[]){
      const key=warehouseRecordPoKey(row);
      if(!byPo.has(key))byPo.set(key,[]);
      byPo.get(key).push(row);
    }
    return orders.map(po=>{
      const key=warehousePoKey(po);
      const records=byPo.get(key)||[];
      if(!records.length&&!po.warehouseInventory)return po;
      const linked=Object.fromEntries(warehouseLinkedFields.map(field=>[field,
        Object.fromEntries(Object.entries(state[field]||{}).filter(([id])=>id.startsWith(key+'::')))]));
      return {...po,warehouseInventory:{records,...linked}};
    });
  }
  function loadWarehousePurchaseOrders(orders,inventory){
    const stored=orders.filter(po=>po.warehouseInventory);
    if(!stored.length)return inventory;
    const poKeys=new Set(stored.map(warehousePoKey));
    const merged={...inventory,officeInventory:[
      ...(inventory.officeInventory||[]).filter(row=>!poKeys.has(warehouseRecordPoKey(row))),
      ...stored.flatMap(po=>po.warehouseInventory.records||[])
    ]};
    for(const field of warehouseLinkedFields){
      merged[field]=Object.fromEntries(Object.entries(inventory[field]||{}).filter(([id])=>!poKeys.has(id.split('::')[0])));
      for(const po of stored)Object.assign(merged[field],po.warehouseInventory[field]||{});
    }
    return merged;
  }
  function mergeCachedWarehouseInventory(orders,inventory,cached){
    if(!cached?.officeInventory?.length)return inventory;
    const syncedPoKeys=new Set(orders.filter(po=>po.warehouseInventory).map(warehousePoKey));
    const loadedKeys=new Set((inventory.officeInventory||[]).map(row=>row.inventoryKey));
    const records=cached.officeInventory.filter(row=>
      !syncedPoKeys.has(warehouseRecordPoKey(row))&&!loadedKeys.has(row.inventoryKey));
    if(!records.length)return inventory;
    const keys=new Set(records.map(row=>row.inventoryKey));
    const merged={...inventory,officeInventory:[...(inventory.officeInventory||[]),...records]};
    for(const field of warehouseLinkedFields){
      merged[field]={...Object.fromEntries(Object.entries(cached[field]||{}).filter(([id])=>keys.has(id))),...inventory[field]};
    }
    const recoveredPoKeys=new Set(records.map(warehouseRecordPoKey));
    for(const po of orders){
      const savedPricing=cached.pricing?.[po.originalPoId||po.id];
      if(recoveredPoKeys.has(warehousePoKey(po))&&savedPricing){
        po.inventoryProformaPricing={...savedPricing,...po.inventoryProformaPricing};
      }
    }
    return merged;
  }
  const allTables=['agencies','suppliers','items','tenders','worker_submissions','submitted_items','winners','archived_tenders','purchase_orders','shipments','supplier_invoices','settings','recycle_bin'];
  function status(text,type=''){const el=$('onlineStatus');if(el){el.textContent=text;el.className='online-status '+type}const b=$('onlineSyncBanner');if(b){b.textContent=text;b.className='sync-banner '+(type==='connected'?'':'offline')}const c=$('cloudSettingsStatus');if(c)c.textContent=text;}
  function cleanData(row){const d={...(row||{})};delete d._audit;delete d._cloudVersion;return d;}
  function key(table,id){return `${table}:${id}`;}
  function partitionRecords(records){const active=[],winners=[],archived=[];(records||[]).forEach(r=>{if(r.completedPO||r.stage1Decision==='Declined'||r.finalDecision==='Declined')archived.push(r);else if(r.finalDecision==='Winner')winners.push(r);else active.push(r)});return {active,winners,archived};}
  function flatten(state,settings){const out={};for(const [k,t] of Object.entries(collectionMap))out[t]=(state[k]||[]).filter(Boolean);
    out.purchase_orders=warehousePurchaseOrders(out.purchase_orders,state);
    out.shipments=[...(state.shipments||[]).map(x=>({...x,archived:false})),...(state.archivedShipments||[]).map(x=>({...x,archived:true}))];
    const workers=[];(state.tenders||[]).forEach(t=>(t.workItems||[]).forEach(w=>workers.push({...w,id:w.id||`${t.id}-${w.itemId}`,tenderRecordId:t.id})));out.worker_submissions=[...workers,...(state.standaloneSubmissions||[]).map(w=>({...w,tenderRecordId:''}))];
    const p=partitionRecords(state.records||[]);out.submitted_items=p.active;out.winners=p.winners;out.archived_tenders=p.archived;
    const invoices=[];['financialInvoices','supplierPaymentInvoices','supplierPaymentInvoices2','otherInvoices'].forEach(g=>(state[g]||[]).forEach(x=>invoices.push({...x,invoice_group:g})));out.supplier_invoices=invoices;
    out.recycle_bin=state.recycleBin||[];out.settings=[{id:'main',settings,inventoryState:inventoryState(state),recycleRetentionDays:state.recycleRetentionDays||90,countrySourcingCountries:Array.isArray(state.countrySourcingCountries)?state.countrySourcingCountries:[],countryPortfolioSuppliers:Array.isArray(state.countryPortfolioSuppliers)?state.countryPortfolioSuppliers:[]}];return out;
  }
  async function log(action,table,id,details={}){await client.from('activity_log').insert({organization_id:cfg.organizationId,user_id:user.id,action,entity_type:table,entity_id:String(id),details});}
  async function insertRow(table,row){
    const payload={id:String(row.id),organization_id:cfg.organizationId,data:cleanData(row),updated_by:user.id,version:1};
    const r=await client.from(table).insert(payload).select('version,updated_at').single();
    if(r.error){
      // A prior cloud row can exist even when this browser has no baseline yet
      // (for example worker_submissions from an older session). Adopt that row
      // instead of failing on worker_submissions_pkey / other primary keys.
      if(String(r.error.code||'')==='23505'){
        const existing=await client.from(table)
          .select('id,data,version,updated_at')
          .eq('organization_id',cfg.organizationId)
          .eq('id',String(row.id))
          .maybeSingle();
        if(existing.error)throw existing.error;
        if(existing.data){
          const b={data:existing.data.data||{},version:existing.data.version||1,updatedAt:existing.data.updated_at};
          baseline.set(key(table,row.id),b);
          if(!equal(cleanData(row),b.data))await updateRow(table,row,b);
          return;
        }
      }
      throw r.error;
    }
    baseline.set(key(table,row.id),{data:cleanData(row),version:r.data.version,updatedAt:r.data.updated_at});
    await log('CREATE',table,row.id);
  }
  async function updateRow(table,row,base){const nextVersion=(base?.version||1)+1;const q=await client.from(table).update({data:cleanData(row),updated_by:user.id,version:nextVersion}).eq('organization_id',cfg.organizationId).eq('id',String(row.id)).eq('version',base.version).select('version,updated_at');if(q.error)throw q.error;if(!q.data?.length){const e=new Error('CONFLICT');e.code='CONFLICT';e.table=table;e.id=row.id;throw e;}baseline.set(key(table,row.id),{data:cleanData(row),version:q.data[0].version,updatedAt:q.data[0].updated_at});await log('UPDATE',table,row.id,{fromVersion:base.version,toVersion:nextVersion});}
  async function deleteRow(table,id,base){const q=await client.from(table).delete().eq('organization_id',cfg.organizationId).eq('id',String(id)).eq('version',base.version).select('id');if(q.error)throw q.error;if(!q.data?.length){const e=new Error('CONFLICT');e.code='CONFLICT';e.table=table;e.id=id;throw e;}baseline.delete(key(table,id));await log('DELETE',table,id,{version:base.version});}
  async function syncState(state,settings){if(!configured()||!user||syncing||loading)return;
    if(!cloudLoadComplete){status('Sync blocked: cloud data has not finished loading','error');return;}
    if(profile?.role==='readonly'){status('Read-only account','error');return;}
    const revision=saveRevision, account=user.id;
    const inventoryJournal=profile.role==='partner_supplier'?null:readInventoryJournal();
    const flat=profile?.role==='partner_supplier'?{}:structuredClone(flatten(state,settings));
    const workspaces=window.ZimportWorkspaces.changes(state);
    inFlight={rows:Object.fromEntries(Object.entries(flat).map(([table,rows])=>[table,
      new Map([...baseline.keys()].filter(k=>k.startsWith(table+':')).map(k=>[k.slice(table.length+1),undefined])
        .concat(rows.map(row=>[String(row.id),cleanData(row)])))])),workspaces};
    syncing=true;dirty=false;status('Saving changes…');
    let reload=false;
    try{
    for(const table of Object.keys(flat)){
      if(!canSyncTable(table))continue;
      const rows=flat[table],current=new Map(rows.map(r=>[String(r.id),r]));
      for(const row of rows){const b=baseline.get(key(table,row.id));if(!b)await insertRow(table,row);else if(!equal(cleanData(row),b.data))await updateRow(table,row,b);}
      for(const [k,b] of [...baseline]){const prefix=table+':';if(k.startsWith(prefix)&&!current.has(k.slice(prefix.length)))await deleteRow(table,k.slice(prefix.length),b);}
    }
    if(flat.shipments)cloudShipmentIds=new Set(flat.shipments.map(x=>String(x.id)));
    await window.ZimportWorkspaces.save(workspaces);
    if(user?.id!==account)return;
    retryDelay=500;
    if(revision===saveRevision){
      if(!stashPending(null)){status('Changes synced, but the browser could not clear the pending save','error');return;}
      if(inventoryJournal&&canSyncTable('settings')&&equal(inventoryJournal,readInventoryJournal())){
        try{localStorage.removeItem(inventoryJournalKey());}
        catch(error){console.error('Could not clear synchronized inventory edits',error);}
      }
    }
    if(inventoryJournal&&!canSyncTable('settings'))status('Inventory edits saved in this browser · shared inventory sync unavailable','error');
    else status(dirty?'Saving changes…':'Changes synced to cloud',dirty?'':'connected');
    }catch(error){
      if(user?.id!==account)return;
      console.error(error);
      retryDelay=Math.min(retryDelay*2,30000);
      reload=error.code==='CONFLICT'||error.code==='23505'||error.code==='WORKSPACE_CONFLICT';
      dirty=true;
      status('Cloud save pending: '+(error.message||'Unknown error'),'error');
    }finally{
      syncing=false;
      inFlight=null;
      if(user?.id===account&&dirty){
        if(reload)await loadState();
        scheduleSync(retryDelay);
      }
    }
  }
  async function deleteShipmentRecord(id){
    if(!configured())return;
    if(!user||!cloudLoadComplete)throw new Error('Cloud data has not finished loading. Please sign in and retry.');
    if(profile?.role==='readonly'||profile?.role==='partner_supplier')throw new Error('This account cannot delete shipments.');
    if(syncing)throw new Error('Cloud save is in progress. Please retry in a moment.');
    const shipmentId=String(id);
    let base=baseline.get(key('shipments',shipmentId));
    if(!base){
      const existing=await client.from('shipments').select('id,data,version,updated_at').eq('organization_id',cfg.organizationId).eq('id',shipmentId).maybeSingle();
      if(existing.error)throw existing.error;
      if(!existing.data){cloudShipmentIds.delete(shipmentId);return;}
      base={data:existing.data.data||{},version:existing.data.version||1,updatedAt:existing.data.updated_at};
      baseline.set(key('shipments',shipmentId),base);
    }
    await deleteRow('shipments',shipmentId,base);
    cloudShipmentIds.delete(shipmentId);
  }
  async function loadTable(table,targetBaseline=baseline){
    if(!canSyncTable(table))return [];
    const rows=[];let offset=0;
    while(true){
      const r=await client.from(table).select('id,data,created_by,created_at,updated_by,updated_at,deleted_by,restore_date,version',{count:'exact'}).eq('organization_id',cfg.organizationId).order('id',{ascending:true}).range(offset,offset+999);
      if(r.error)throw r.error;
      const page=r.data||[];rows.push(...page);
      if(!page.length||(r.count!=null&&rows.length>=r.count)||(r.count==null&&page.length<1000))break;
      offset+=page.length;
    }
    return rows.map(x=>{targetBaseline.set(key(table,x.id),{data:structuredClone(x.data||{}),version:x.version||1,updatedAt:x.updated_at});return {...x.data,id:x.id,_cloudVersion:x.version||1,_audit:{createdBy:x.created_by,createdAt:x.created_at,updatedBy:x.updated_by,updatedAt:x.updated_at,deletedBy:x.deleted_by,restoreDate:x.restore_date}};});
  }
  async function loadState(){
    if(syncing||loading||!user)return;
    clearTimeout(syncTimer);
    loading=true;
    const account=user.id;
    status('Loading shared data…');
    const nextBaseline=new Map();
    try{
      const restoreWorkspaces=()=>window.ZimportWorkspaces.load(()=>pendingSave?.workspaces||[],mergePending);
      if(profile?.role==='partner_supplier'){
        const scoped=await restoreWorkspaces();
        if(user?.id!==account)return;
        cloudLoadComplete=baselineReady=true;
        window.dispatchEvent(new CustomEvent('zimport-online-state-loaded',{detail:{state:scoped,replaceState:true,settings:{defaultCurrency:'CAD'}}}));
        finishLoad('Assigned supplier workspaces loaded');
        window.ZimportPermissions.apply();
        return;
      }

      const tables=allTables.filter(table=>canSyncTable(table));
      const loaded=await Promise.all(tables.map(async table=>[table,await loadTable(table,nextBaseline)]));
      const workspaces=await restoreWorkspaces();
      if(user?.id!==account)return;
      const data=Object.fromEntries(loaded.map(([table,rows])=>[table,restorePendingTable(table,rows)]));
      const out=Object.fromEntries(Object.entries(collectionMap).map(([field,table])=>[field,data[table]||[]]));
      out.archivedShipments=out.shipments.filter(row=>row.archived);
      out.shipments=out.shipments.filter(row=>!row.archived);
      // Keep the existing one-time removal of the erroneous 2546 Italy North tender.
      const badTenders=out.tenders.filter(t=>String(t.code||'').trim()==='2546'&&String(t.name||'').trim().toLowerCase().includes('italy north'));
      for(const tender of badTenders){
        const rowKey=key('tenders',tender.id), base=nextBaseline.get(rowKey);
        if(base){
          try{await deleteRow('tenders',tender.id,base);nextBaseline.delete(rowKey);}
          catch(error){console.warn('Could not delete erroneous tender 2546:',error);}
        }
      }
      out.tenders=out.tenders.filter(t=>!badTenders.includes(t));
      out.standaloneSubmissions=(data.worker_submissions||[]).filter(row=>!row.tenderRecordId);
      for(const [field,value] of Object.entries(workspaces)){
        if(!['countrySourcingCountries','countryPortfolioSuppliers','tenders'].includes(field))out[field]=value;
      }
      out.records=[...(data.submitted_items||[]),...(data.winners||[]),...(data.archived_tenders||[])];
      out.recycleBin=data.recycle_bin||[];
      for(const field of ['financialInvoices','supplierPaymentInvoices','supplierPaymentInvoices2','otherInvoices']){
        out[field]=(data.supplier_invoices||[]).filter(row=>row.invoice_group===field);
      }
      const settings=(data.settings||[]).find(row=>row.id==='main')||{};
      const journal=readInventoryJournal();
      const sharedInventory=loadWarehousePurchaseOrders(out.purchaseOrders,inventoryState(settings.inventoryState||{}));
      const inventory=applyInventoryJournal(sharedInventory,journal);
      const cachedWarehouse=window.getWarehouseMigrationSnapshot?.();
      Object.assign(out,mergeCachedWarehouseInventory(out.purchaseOrders,inventory,cachedWarehouse));
      const migrateWarehouse=canSyncTable('purchase_orders')&&out.officeInventory?.some(row=>
        out.purchaseOrders.some(po=>!po.warehouseInventory&&warehousePoKey(po)===warehouseRecordPoKey(row)));
      out.recycleRetentionDays=settings.recycleRetentionDays||90;
      if(Array.isArray(settings.countrySourcingCountries))out.countrySourcingCountries=settings.countrySourcingCountries;
      if(Array.isArray(settings.countryPortfolioSuppliers))out.countryPortfolioSuppliers=settings.countryPortfolioSuppliers;
      cloudShipmentIds=new Set([...(nextBaseline.keys())].filter(k=>k.startsWith('shipments:')).map(k=>k.slice('shipments:'.length)));
      baseline=nextBaseline;
      cloudLoadComplete=baselineReady=true;
      window.dispatchEvent(new CustomEvent('zimport-online-state-loaded',{detail:{state:out,settings:settings.settings||{},repairSync:migrateWarehouse}}));
      finishLoad('Cloud connected · '+cloudShipmentIds.size+' shipment(s) loaded');
    }catch(error){
      if(user?.id!==account)return;
      console.error(error);
      cloudLoadComplete=false;
      status('Load error: '+(error.message||'')+' · pending changes kept on this browser','error');
      try{
        const shipments=await loadTable('shipments',new Map());
        if(shipments.length&&user?.id===account){
          window.dispatchEvent(new CustomEvent('zimport-online-state-loaded',{detail:{state:{shipments:shipments.filter(x=>!x.archived),archivedShipments:shipments.filter(x=>x.archived)},partialRecovery:true}}));
        }
      }catch(recoveryError){console.error('Shipment recovery failed',recoveryError);}
    }finally{
      loading=false;
      if(user?.id===account&&dirty)scheduleSync(retryDelay);
    }
  }
  function finishLoad(message){
    if(pendingSave||(profile.role!=='partner_supplier'&&canSyncTable('settings')&&readInventoryJournal())){
      const snapshot=window.getProgramSaveSnapshot();
      latestState=snapshot.state;
      latestSettings=snapshot.settings;
      dirty=true;
      scheduleSync(retryDelay);
    }else if(profile.role!=='partner_supplier'&&readInventoryJournal()){
      status('Inventory edits saved in this browser · shared inventory sync unavailable','error');
    }else status(message,'connected');
  }
  function scheduleRealtimeReload(){if(syncing||dirty)return;clearTimeout(realtimeTimer);realtimeTimer=setTimeout(loadState,700);}
  function subscribeRealtime(){
    if(realtimeChannel){try{client.removeChannel(realtimeChannel);}catch(e){console.warn('Could not remove old realtime channel:',e);}}
    const ch=client.channel('zimport-shared-changes');
    allTables.forEach(t=>ch.on('postgres_changes',{event:'*',schema:'public',table:t,filter:`organization_id=eq.${cfg.organizationId}`},payload=>{if(payload.new?.updated_by===user?.id||payload.old?.updated_by===user?.id)return;scheduleRealtimeReload();}));
    realtimeChannel=ch;ch.subscribe();
  }
  async function getProfile(){const r=await client.from('profiles').select('*').eq('id',user.id).maybeSingle();if(r.error)throw r.error;profile=r.data||{role:'readonly',full_name:user.email,active:false};if(!profile.active){await client.auth.signOut();throw Error('This account is inactive. Contact your administrator.');}window.ZIMPORT_CURRENT_ROLE=profile.role||'readonly';window.dispatchEvent(new CustomEvent('zimport-online-role',{detail:{role:window.ZIMPORT_CURRENT_ROLE}}));if($('onlineUserLabel'))$('onlineUserLabel').textContent=`${profile.full_name||user.email} · ${window.ZIMPORT_CURRENT_ROLE}`;}
  async function afterLogin(session){
    const nextUser=session?.user||null;
    if(!nextUser)return showLogin();
    // Supabase can emit several auth events for the same valid session
    // (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED). Do not reload the
    // entire application for each event; one full load per signed-in user
    // is enough. Realtime keeps later data changes synchronized.
    if(loadedUserId===nextUser.id){user=nextUser;return;}
    if(loginInFlight)return loginInFlight;
    loginInFlight=(async()=>{
      user=nextUser;
      pendingSave=null;
      try{pendingSave=JSON.parse(localStorage.getItem(saveKey())||'null');}
      catch(error){console.error('Browser could not read the pending save',error);}
      await getProfile();
      if(invitationLanding)document.getElementById('accountPasswordPanel')?.classList.remove('hidden');
      if($('onlineSignOut'))$('onlineSignOut').style.display='';
      await loadState();
      if(cloudLoadComplete)$('onlineLoginGate')?.classList.add('hidden');
      else{
        if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Shared data could not load. Click Retry connection to reopen the program.';
        addRetryButton();
      }
      loadedUserId=nextUser.id;
      subscribeRealtime();
    })();
    try{return await loginInFlight;}finally{loginInFlight=null;}
  }
  function showLogin(){clearTimeout(syncTimer);clearTimeout(realtimeTimer);cloudLoadComplete=baselineReady=false;latestState=null;latestSettings=null;pendingSave=null;dirty=false;user=null;profile=null;loadedUserId=null;$('onlineLoginGate')?.classList.remove('hidden');if($('onlineSignOut'))$('onlineSignOut').style.display='none';if($('onlineUserLabel'))$('onlineUserLabel').textContent='';window.ZIMPORT_CURRENT_ROLE='readonly';window.ZimportPermissions?.apply();status(configured()?'Sign in required':'Supabase not configured');}
  function clearStaleLocalAuthSession(){
    try{
      const host=new URL(cfg.supabaseUrl).hostname;
      const ref=host.split('.')[0];
      if(ref)localStorage.removeItem(`sb-${ref}-auth-token`);
    }catch(e){console.warn('Could not clear stale local auth session:',e);}
  }
  function isInvalidRefreshTokenError(e){
    const m=String(e?.message||e||'').toLowerCase();
    const c=String(e?.code||'').toLowerCase();
    return c==='refresh_token_not_found'||m.includes('invalid refresh token')||m.includes('refresh token not found');
  }
  function addRetryButton(){
    if($('onlineRetryConnection'))return;
    const anchor=$('onlineSetupMessage');if(!anchor)return;
    const btn=document.createElement('button');
    btn.type='button';btn.id='onlineRetryConnection';btn.className='secondary';
    btn.style.marginTop='10px';btn.style.display='block';
    btn.textContent='Retry connection';
    btn.onclick=()=>location.reload();
    anchor.insertAdjacentElement('afterend',btn);
  }
  function attachStaticHandlers(){
    // These are wired up unconditionally so the login form is never dead, even if the
    // Supabase library failed to load or the client could not be created (see init()).
    $('onlineLoginForm')?.addEventListener('submit',async e=>{
      e.preventDefault();$('onlineLoginError').textContent='';
      if(!client){$('onlineLoginError').textContent='Cloud connection is not ready. Check your internet connection, then click Retry connection or reload the page.';return;}
      const btn=e.target.querySelector('button[type=submit]');if(btn)btn.disabled=true;
      try{
        const identity=$('onlineEmail').value.trim();let r;
        if(identity.includes('@'))r=await client.auth.signInWithPassword({email:identity,password:$('onlinePassword').value});
        else{
          const response=await client.functions.invoke('manage-users',{body:{action:'login',username:identity,password:$('onlinePassword').value}});
          if(response.error||response.data?.error){$('onlineLoginError').textContent='Invalid username or password.';return;}
          r=await client.auth.setSession({access_token:response.data.access_token,refresh_token:response.data.refresh_token});
        }
        if(r.error){$('onlineLoginError').textContent=r.error.message;return;}
        await afterLogin(r.data.session);
      }catch(e){
        console.error(e);
        $('onlineLoginError').textContent='Could not reach the cloud service: '+(e.message||e)+'. Check your internet connection and try again.';
      }finally{
        if(btn)btn.disabled=false;
      }
    });
    if($('onlineForgotPassword'))$('onlineForgotPassword').onclick=async()=>{
      if(!client){$('onlineLoginError').textContent='Cloud connection is not ready. Check your internet connection, then click Retry connection or reload the page.';return;}
      const email=$('onlineEmail').value.trim();if(!email.includes('@')){$('onlineLoginError').textContent='Enter your email address to reset your password.';return;}
      try{
        const r=await client.auth.resetPasswordForEmail(email,{redirectTo:location.href});
        $('onlineLoginError').textContent=r.error?r.error.message:'Password reset email sent.';
      }catch(e){
        console.error(e);
        $('onlineLoginError').textContent='Could not reach the cloud service: '+(e.message||e)+'. Check your internet connection and try again.';
      }
    };
    if($('onlineSignOut'))$('onlineSignOut').onclick=async()=>{
      try{if(client)await client.auth.signOut();}catch(e){console.error(e);}
      showLogin();
    };
    $('cloudForceSync')?.addEventListener('click',()=>window.ZimportOnline.syncNow());
  }
  async function init(){
    attachStaticHandlers();
    if(!configured()){showLogin();if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Supabase is not configured.';return;}
    if(typeof window.supabase==='undefined'||typeof window.supabase.createClient!=='function'){
      console.error('Supabase library did not load (window.supabase is missing).');
      showLogin();status('Cloud library failed to load','error');
      if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='The cloud library failed to load. Check your internet connection (or whether something is blocking cdn.jsdelivr.net), then click Retry connection.';
      addRetryButton();
      return;
    }
    try{
      client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
    }catch(e){
      console.error(e);
      showLogin();status('Cloud connection failed to start','error');
      if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Could not start the cloud connection: '+(e.message||e)+'. Click Retry connection or reload the page.';
      addRetryButton();
      return;
    }
    if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Use your assigned email or username and password.';
    try{
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      if(data.session)await afterLogin(data.session);else showLogin();
      client.auth.onAuthStateChange((event,s)=>{
        if(event==='PASSWORD_RECOVERY')document.getElementById('accountPasswordPanel')?.classList.remove('hidden');
        if(event==='SIGNED_OUT'||!s){showLogin();return;}
        // A token refresh is normal and must not trigger a full database reload.
        if(event==='TOKEN_REFRESHED'){user=s.user||user;return;}
        // Run outside the auth callback so auth-state notifications cannot
        // block other Supabase work, and afterLogin de-duplicates same-user events.
        setTimeout(()=>afterLogin(s).catch(err=>{console.error(err);showLogin();}),0);
      });
    }catch(e){
      console.error(e);
      if(isInvalidRefreshTokenError(e)){
        clearStaleLocalAuthSession();
        showLogin();
        status('Session expired — please sign in again','error');
        if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Your saved login session expired. It was cleared safely. Please sign in again.';
      }else{
        showLogin();status('Cloud connection error','error');
        if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Could not reach the cloud service: '+(e.message||e)+'. Check your internet connection and click Retry connection.';
        addRetryButton();
      }
    }
  }
  async function uploadFile(path,file){if(!client||!user)throw new Error('Not signed in');let clean;
    if(profile?.role==='partner_supplier'){
     const scope=window.getCurrentSourcingScope?.();if(!scope?.supplier_id||!window.ZimportPermissions.canCountry(profile,scope.country)||!window.ZimportPermissions.canSupplier(profile,scope.supplier_id))throw Error('Supplier file access denied.');
     if(scope.country.includes('/')||scope.supplier_id.includes('/'))throw Error('Invalid supplier file scope.');
     clean=cfg.organizationId+'/partner/'+scope.supplier_id+'/'+scope.country+'/'+crypto.randomUUID()+'/'+String(file.name||'file').replace(/[^a-zA-Z0-9._-]/g,'_');
    }else clean=`${cfg.organizationId}/${path}`.replace(/[^a-zA-Z0-9._\/-]/g,'_');const r=await client.storage.from(cfg.storageBucket).upload(clean,file,{upsert:true});if(r.error)throw r.error;if(profile.role!=='partner_supplier')await log('UPLOAD_FILE','storage',clean,{name:file.name,size:file.size,type:file.type});return clean;}
  async function deleteFile(path){const r=await client.storage.from(cfg.storageBucket).remove([path]);if(r.error)throw r.error;await log('DELETE_FILE','storage',path);}
  async function signedFileUrl(path,seconds=600){const r=await client.storage.from(cfg.storageBucket).createSignedUrl(path,seconds);if(r.error)throw r.error;return r.data.signedUrl;}
  function scheduleSync(delay=500){
    clearTimeout(syncTimer);
    if(cloudLoadComplete)syncTimer=setTimeout(()=>syncState(latestState,latestSettings),delay);
  }
  const inventoryJournalKey=()=>saveKey()+':inventory';
  function readInventoryJournal(){
    try{return JSON.parse(localStorage.getItem(inventoryJournalKey())||'null');}
    catch(error){console.error('Could not read inventory saves',error);return null;}
  }
  function rememberInventoryChanges(state,previousSave){
    if(!previousSave||profile.role==='partner_supplier')return true;
    let previousState;
    try{previousState=JSON.parse(previousSave||'{}');}
    catch{return false;}
    if(!isObject(previousState))return false;
    const previous=inventoryState(previousState);
    const current=inventoryState(state);
    if(equal(previous,current))return true;
    const existing=readInventoryJournal();
    // Apply only the edits made in this browser over the next cloud snapshot.
    const before=existing?.before||previous;
    const after=mergeChangedFields(previous,current,existing?.after||previous);
    try{
      localStorage.setItem(inventoryJournalKey(),JSON.stringify({before,after}));
      return true;
    }catch(error){console.error('Could not save inventory changes in the browser',error);return false;}
  }
  function applyInventoryJournal(cloudInventory,journal){
    if(!journal)return cloudInventory;
    return mergeChangedFields(journal.before,journal.after,cloudInventory);
  }
  function queueSync(state,settings,previousSave){
    if(!user||!profile||profile.role==='readonly')return;
    const inventorySaved=rememberInventoryChanges(state,previousSave);
    if(!baselineReady){
      status(inventorySaved?'Saved on this browser · cloud sync pending':'Browser storage unavailable · inventory save pending','error');
      return;
    }
    clearTimeout(realtimeTimer);
    latestState=state;
    latestSettings=settings;
    saveRevision++;
    const flat=profile.role==='partner_supplier'?{}:flatten(state,settings);
    const changes=window.ZimportWorkspaces.changes(state,inFlight?.workspaces);
    const saved=stashPending(collectPending(flat,changes));
    dirty=true;
    status(saved&&inventorySaved?'Saved on this browser · cloud sync pending':'Browser storage unavailable · cloud sync pending',saved&&inventorySaved?'':'error');
    scheduleSync();
  }
  window.addEventListener('online',()=>{
    if(user&&pendingSave){
      if(cloudLoadComplete)scheduleSync(0);
      else loadState();
    }
  });
  window.ZimportOnline={configured,init,deleteShipmentRecord,queueSync,syncNow:()=>{
    if(!cloudLoadComplete||loading)return loadState();
    const snapshot=window.getProgramSaveSnapshot?.();
    if(!snapshot)return Promise.resolve();
    queueSync(snapshot.state,snapshot.settings);
    clearTimeout(syncTimer);
    return syncState(latestState,latestSettings);
  },loadNow:loadState,uploadFile,deleteFile,signedFileUrl,get client(){return client},get user(){return user},get profile(){return profile}};
  window.addEventListener('DOMContentLoaded',init);
})();
