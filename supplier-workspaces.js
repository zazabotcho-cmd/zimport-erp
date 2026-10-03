(function(){
 const collections=['countryWineries','countryCandidates','archivedCountryCandidates','portfolioManagerNotes','portfolioManagerRecycleBin','internalMail','internalMailDrafts'];
 let versions={},baseline={},loaded=false;
 const stable=data=>JSON.stringify(data);
 async function call(action,payload={}){const {data,error}=await window.ZimportOnline.client.functions.invoke('manage-users',{body:{action,...payload}});if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}if(data?.error)throw Error(data.error);return data;}
 async function load(){
  const response=await call('workspace_load');const state={supplierContactPersons:{}};for(const key of collections)state[key]=[];
  for(const row of response.workspaces||[]){versions[row.supplier_id]=row.version;baseline[row.supplier_id]=stable(row.data);for(const key of collections)state[key].push(...(row.data[key]||[]));state.supplierContactPersons[row.country+'::'+row.supplier_id]=row.data.supplierContactPersons||[];}
  loaded=true;state.countryPortfolioSuppliers=response.suppliers||[];state.countrySourcingCountries=response.countries||[];
  if(window.ZimportOnline.profile?.role==='partner_supplier'){
   for(const key of ['agencies','suppliers','items','purchaseOrders','shipments','archivedShipments','financialInvoices','supplierPaymentInvoices','supplierPaymentInvoices2','otherInvoices','recycleBin','records','countryBonuses','pendingEmailNotifications','emailNotificationLog'])state[key]=[];
   state.tenders=response.tenders||[];
  }
  return state;
 }
 async function save(state){
  if(!loaded)return;const profile=window.ZimportOnline.profile;if(!profile||profile.role==='readonly')return;
  const rows=[];
  for(const supplier of state.countryPortfolioSuppliers||[]){
   if(!window.ZimportPermissions.canCountry(profile,supplier.country)||!window.ZimportPermissions.canSupplier(profile,supplier.id))continue;
   const data={};for(const key of collections)data[key]=(state[key]||[]).filter(r=>key==='internalMail'||key==='internalMailDrafts'?r.supplierKey===supplier.country+'::'+supplier.id:r.country===supplier.country&&r.portfolioSupplierId===supplier.id);
   data.supplierContactPersons=state.supplierContactPersons?.[supplier.country+'::'+supplier.id]||[];
   if(stable(data)===baseline[supplier.id])continue;
   rows.push({supplier_id:supplier.id,country:supplier.country,expected_version:versions[supplier.id]||0,data});
  }
  if(!rows.length)return;const result=await call('workspace_save',{workspaces:rows});
  for(const row of rows){versions[row.supplier_id]=result.versions[row.supplier_id];baseline[row.supplier_id]=stable(row.data);}
 }
 window.ZimportWorkspaces={load,save};
})();
