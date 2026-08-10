(function(){
  const cfg=window.ZIMPORT_ONLINE_CONFIG||{};
  const configured=()=>/^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl||'')&&!String(cfg.supabaseAnonKey||'').includes('PASTE_');
  let client=null,user=null,profile=null,syncTimer=null,syncing=false,dirty=false,realtimeTimer=null;
  let latestState=null,latestSettings=null,baseline=new Map();
  const $=id=>document.getElementById(id);
  const collectionMap={agencies:'agencies',suppliers:'suppliers',items:'items',tenders:'tenders',purchaseOrders:'purchase_orders',shipments:'shipments'};
  const allTables=['agencies','suppliers','items','tenders','worker_submissions','submitted_items','winners','archived_tenders','purchase_orders','shipments','supplier_invoices','settings','recycle_bin'];
  function status(text,type=''){const el=$('onlineStatus');if(el){el.textContent=text;el.className='online-status '+type}const b=$('onlineSyncBanner');if(b){b.textContent=text;b.className='sync-banner '+(type==='connected'?'':'offline')}const c=$('cloudSettingsStatus');if(c)c.textContent=text;}
  function cleanData(row){const d={...(row||{})};delete d._audit;delete d._cloudVersion;return d;}
  function stable(v){return JSON.stringify(v,Object.keys(v||{}).sort());}
  function key(table,id){return `${table}:${id}`;}
  function partitionRecords(records){const active=[],winners=[],archived=[];(records||[]).forEach(r=>{if(r.completedPO||r.stage1Decision==='Declined'||r.finalDecision==='Declined')archived.push(r);else if(r.finalDecision==='Winner')winners.push(r);else active.push(r)});return {active,winners,archived};}
  function flatten(state,settings){const out={};for(const [k,t] of Object.entries(collectionMap))out[t]=(state[k]||[]).filter(Boolean);
    const workers=[];(state.tenders||[]).forEach(t=>(t.workItems||[]).forEach(w=>workers.push({...w,id:w.id||`${t.id}-${w.itemId}`,tenderRecordId:t.id})));out.worker_submissions=workers;
    const p=partitionRecords(state.records||[]);out.submitted_items=p.active;out.winners=p.winners;out.archived_tenders=p.archived;
    const invoices=[];['financialInvoices','supplierPaymentInvoices','supplierPaymentInvoices2','otherInvoices'].forEach(g=>(state[g]||[]).forEach(x=>invoices.push({...x,invoice_group:g})));out.supplier_invoices=invoices;
    out.recycle_bin=state.recycleBin||[];out.settings=[{id:'main',settings,recycleRetentionDays:state.recycleRetentionDays||90}];return out;
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
          if(JSON.stringify(cleanData(row))!==JSON.stringify(b.data))await updateRow(table,row,b);
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
  async function syncState(state,settings){if(!configured()||!user||syncing)return;if(profile?.role==='readonly'){status('Read-only account','error');return;}syncing=true;dirty=false;status('Saving changes…');try{
    const flat=flatten(state,settings);
    for(const table of Object.keys(flat)){
      const rows=flat[table],current=new Map(rows.map(r=>[String(r.id),r]));
      for(const row of rows){const b=baseline.get(key(table,row.id));if(!b)await insertRow(table,row);else if(JSON.stringify(cleanData(row))!==JSON.stringify(b.data))await updateRow(table,row,b);}
      for(const [k,b] of [...baseline]){const [bt,id]=k.split(':');if(bt===table&&!current.has(id))await deleteRow(table,id,b);}
    }
    status('All changes saved','connected');
  }catch(e){console.error(e);if(e.code==='CONFLICT'){status('Conflict detected — reloading latest data','error');alert('Another user changed the same record before your save. The latest cloud version will now load. Please review and enter your change again.');await loadState();}else if(String(e.code||'')==='23505'){status('Sync error: duplicate cloud record detected. Reloading shared data…','error');await loadState();}else status('Sync error: '+(e.message||'Unknown error'),'error');}finally{syncing=false;}
  }
  async function loadTable(table){const r=await client.from(table).select('id,data,created_by,created_at,updated_by,updated_at,deleted_by,restore_date,version').eq('organization_id',cfg.organizationId);if(r.error)throw r.error;return (r.data||[]).map(x=>{baseline.set(key(table,x.id),{data:x.data||{},version:x.version||1,updatedAt:x.updated_at});return {...x.data,id:x.id,_cloudVersion:x.version||1,_audit:{createdBy:x.created_by,createdAt:x.created_at,updatedBy:x.updated_by,updatedAt:x.updated_at,deletedBy:x.deleted_by,restoreDate:x.restore_date}};});}
  async function loadState(){if(syncing)return;status('Loading shared data…');try{baseline=new Map();const out={};for(const [k,t] of Object.entries(collectionMap))out[k]=await loadTable(t);
    // worker_submissions are already represented inside tender.workItems in the app state,
    // but their cloud rows must still be loaded so sync knows they already exist.
    await loadTable('worker_submissions');
    const [a,w,ar,inv,rec,set]=await Promise.all([loadTable('submitted_items'),loadTable('winners'),loadTable('archived_tenders'),loadTable('supplier_invoices'),loadTable('recycle_bin'),loadTable('settings')]);out.records=[...a,...w,...ar];out.recycleBin=rec;out.financialInvoices=inv.filter(x=>x.invoice_group==='financialInvoices');out.supplierPaymentInvoices=inv.filter(x=>x.invoice_group==='supplierPaymentInvoices');out.supplierPaymentInvoices2=inv.filter(x=>x.invoice_group==='supplierPaymentInvoices2');out.otherInvoices=inv.filter(x=>x.invoice_group==='otherInvoices');const s=set.find(x=>x.id==='main')||{};out.recycleRetentionDays=s.recycleRetentionDays||90;window.dispatchEvent(new CustomEvent('zimport-online-state-loaded',{detail:{state:out,settings:s.settings||{}}}));status('Cloud connected','connected');}catch(e){console.error(e);status('Load error: '+(e.message||''),'error');}}
  function scheduleRealtimeReload(){if(syncing||dirty)return;clearTimeout(realtimeTimer);realtimeTimer=setTimeout(loadState,700);}
  function subscribeRealtime(){const ch=client.channel('zimport-shared-changes');allTables.forEach(t=>ch.on('postgres_changes',{event:'*',schema:'public',table:t,filter:`organization_id=eq.${cfg.organizationId}`},payload=>{if(payload.new?.updated_by===user?.id||payload.old?.updated_by===user?.id)return;scheduleRealtimeReload();}));ch.subscribe();}
  async function getProfile(){const r=await client.from('profiles').select('*').eq('id',user.id).maybeSingle();if(r.error)throw r.error;profile=r.data||{role:'readonly',full_name:user.email};window.ZIMPORT_CURRENT_ROLE=profile.role||'readonly';window.dispatchEvent(new CustomEvent('zimport-online-role',{detail:{role:window.ZIMPORT_CURRENT_ROLE}}));if($('onlineUserLabel'))$('onlineUserLabel').textContent=`${profile.full_name||user.email} · ${window.ZIMPORT_CURRENT_ROLE}`;}
  async function afterLogin(session){user=session?.user||null;if(!user)return showLogin();await getProfile();$('onlineLoginGate')?.classList.add('hidden');if($('onlineSignOut'))$('onlineSignOut').style.display='';await loadState();subscribeRealtime();}
  function showLogin(){user=null;profile=null;$('onlineLoginGate')?.classList.remove('hidden');if($('onlineSignOut'))$('onlineSignOut').style.display='none';if($('onlineUserLabel'))$('onlineUserLabel').textContent='';status(configured()?'Sign in required':'Supabase not configured');}
  async function init(){if(!configured()){showLogin();if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Supabase is not configured.';return;}client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});if($('onlineSetupMessage'))$('onlineSetupMessage').textContent='Use your assigned email and password.';$('onlineLoginForm')?.addEventListener('submit',async e=>{e.preventDefault();$('onlineLoginError').textContent='';const r=await client.auth.signInWithPassword({email:$('onlineEmail').value.trim(),password:$('onlinePassword').value});if(r.error){$('onlineLoginError').textContent=r.error.message;return;}await afterLogin(r.data.session);});if($('onlineForgotPassword'))$('onlineForgotPassword').onclick=async()=>{const email=$('onlineEmail').value.trim();if(!email){$('onlineLoginError').textContent='Enter your email first.';return;}const r=await client.auth.resetPasswordForEmail(email,{redirectTo:location.href});$('onlineLoginError').textContent=r.error?r.error.message:'Password reset email sent.';};if($('onlineSignOut'))$('onlineSignOut').onclick=async()=>{await client.auth.signOut();showLogin();};$('cloudForceSync')?.addEventListener('click',()=>window.ZimportOnline.syncNow());const {data}=await client.auth.getSession();if(data.session)await afterLogin(data.session);else showLogin();client.auth.onAuthStateChange((_e,s)=>{if(s&&!user)afterLogin(s);if(!s)showLogin();});}
  async function uploadFile(path,file){if(!client||!user)throw new Error('Not signed in');const clean=`${cfg.organizationId}/${path}`.replace(/[^a-zA-Z0-9._\/-]/g,'_');const r=await client.storage.from(cfg.storageBucket).upload(clean,file,{upsert:true});if(r.error)throw r.error;await log('UPLOAD_FILE','storage',clean,{name:file.name,size:file.size,type:file.type});return clean;}
  async function deleteFile(path){const r=await client.storage.from(cfg.storageBucket).remove([path]);if(r.error)throw r.error;await log('DELETE_FILE','storage',path);}
  async function signedFileUrl(path,seconds=600){const r=await client.storage.from(cfg.storageBucket).createSignedUrl(path,seconds);if(r.error)throw r.error;return r.data.signedUrl;}
  window.ZimportOnline={configured,init,queueSync:(s,se)=>{latestState=s;latestSettings=se;dirty=true;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncState(s,se),500);},syncNow:()=>latestState?syncState(latestState,latestSettings||{}):Promise.resolve(),loadNow:loadState,uploadFile,deleteFile,signedFileUrl,get client(){return client},get user(){return user},get profile(){return profile}};
  window.addEventListener('DOMContentLoaded',init);
})();
