(function(){
 const collections=['countryWineries','countryCandidates','archivedCountryCandidates','portfolioManagerNotes','portfolioManagerRecycleBin','internalMail','internalMailDrafts'];
 let versions={},baseline={},loaded=false;
 const stable=data=>JSON.stringify(data);
 async function call(action,payload={}){const {data,error}=await window.ZimportOnline.client.functions.invoke('manage-users',{body:{action,...payload}});if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}if(data?.error)throw Error(data.error);return data;}
 async function load(getPending=()=>[],merge=(_before,after)=>after){
  const response=await call('workspace_load');const state={supplierContactPersons:{}};for(const key of collections)state[key]=[];
  versions={};baseline={};
  const pending=new Map(getPending().map(row=>[row.supplier_id,row]));
  const rows=new Map((response.workspaces||[]).map(row=>[row.supplier_id,row]));
  for(const supplier of response.suppliers||[]){
   const row=rows.get(supplier.id), edit=pending.get(supplier.id);
   const cloud=row?.data;
   if(row){versions[supplier.id]=row.version;baseline[supplier.id]=stable(cloud);}
   const data=(edit?merge(edit.before,edit.data,cloud,edit.hasFallback?edit.fallback:edit.before):cloud)||{};
   for(const key of collections)state[key].push(...(data[key]||[]));
   state.supplierContactPersons[supplier.country+'::'+supplier.id]=data.supplierContactPersons||[];
  }
  loaded=true;state.countryPortfolioSuppliers=response.suppliers||[];state.countrySourcingCountries=response.countries||[];
  if(window.ZimportOnline.profile?.role==='partner_supplier'){
   for(const key of ['agencies','suppliers','items','purchaseOrders','shipments','archivedShipments','financialInvoices','supplierPaymentInvoices','supplierPaymentInvoices2','otherInvoices','recycleBin','records','countryBonuses','pendingEmailNotifications','emailNotificationLog'])state[key]=[];
   state.tenders=response.tenders||[];
  }
  return state;
 }
 function changes(state,inFlight=[]){
  const profile=window.ZimportOnline.profile;
  if(!loaded||!profile||profile.role==='readonly')return [];
  const rows=[], sending=new Map(inFlight.map(row=>[row.supplier_id,row.data]));
  for(const supplier of state.countryPortfolioSuppliers||[]){
   if(!window.ZimportPermissions.canCountry(profile,supplier.country)||!window.ZimportPermissions.canSupplier(profile,supplier.id))continue;
   const data={};for(const key of collections)data[key]=(state[key]||[]).filter(r=>key==='internalMail'||key==='internalMailDrafts'?r.supplierKey===supplier.country+'::'+supplier.id:r.country===supplier.country&&r.portfolioSupplierId===supplier.id);
   data.supplierContactPersons=state.supplierContactPersons?.[supplier.country+'::'+supplier.id]||[];
   const original=baseline[supplier.id];
   const sent=sending.get(supplier.id);
   if(stable(data)===original&&(!sent||stable(data)===stable(sent)))continue;
   rows.push({supplier_id:supplier.id,country:supplier.country,expected_version:versions[supplier.id]||0,
    data:structuredClone(data),before:sent||(original===undefined?undefined:JSON.parse(original)),
    ...(sent?{hasFallback:true,fallback:original===undefined?undefined:JSON.parse(original)}:{})});
  }
  return rows;
 }
 async function save(rows){
  for(const {supplier_id,country,expected_version,data} of rows){
   try{
    const result=await call('workspace_save',{workspaces:[{supplier_id,country,expected_version,data}]});
    versions[supplier_id]=result.versions[supplier_id];
    baseline[supplier_id]=stable(data);
   }catch(error){
    if(/workspace changed|duplicate key|query returned no rows/i.test(error.message))error.code='WORKSPACE_CONFLICT';
    throw error;
   }
  }
 }
 window.ZimportWorkspaces={load,changes,save};
})();
