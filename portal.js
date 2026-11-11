'use strict';
const get=id=>document.getElementById(id);
const db=JSON.parse(localStorage.getItem('winglobal-portal-demo')||'{"wineries":[],"items":[],"tenders":[],"offers":[],"messages":[]}');
db.recycledFiles??=[];
const save=()=>localStorage.setItem('winglobal-portal-demo',JSON.stringify(db));
const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,url:reader.result});reader.onerror=reject;reader.readAsDataURL(file)});
function download(root,file){const link=add(root,'a',file.name);link.href=file.url;link.download=file.name}
const id=()=>crypto.randomUUID();
const el=(tag,content)=>{const node=document.createElement(tag);if(content!=null)node.textContent=content;return node};
const add=(root,tag,content)=>root.appendChild(el(tag,content));
const button=(root,title,action)=>{const b=add(root,'button',title);b.type='button';b.onclick=action;return b};
const admin=()=>get('role').value==='admin';
const owner=()=>get('role').value;
const name=item=>item.data.c_productDescription||item.data.itCanName||item.data.c_brandName||'Wine offer';
const winery=key=>db.wineries.find(w=>w.id===key);
const note=(to,subject,body,from)=>db.messages.unshift({to,subject,body,from,read:false});
const change=(fn)=>{fn();save();render()};
let page='Register New Supplier';
let selectedAdminTenderId='';
const forms={};
function roles(){
 const r=get('role'), value=r.value;
 r.replaceChildren(new Option('New Supplier','new'),new Option('Portal administrator','admin'),
 ...db.wineries.map(w=>new Option(w.data.itWinName,w.id)));
 r.value=[...r.options].some(o=>o.value===value)?value:'new';
}
function list(root,records,draw){
 if(!records.length)add(root,'p','Nothing to show here yet.');
 records.forEach(record=>draw(add(root,'article'),record));
}
const attachmentKey='italyCandidateAttachmentInput';
const awardAttachmentKey='awardAttachmentInput';
const tenderUpdateFields=[
 'portalPhoto0','portalPhoto1','portalPhoto2','itCanPromotionalSupportPercent',
 'itCanUniqueOtherDescription','itCanOutstandingLocation','c_previousSubmissionNumber','c_upcNumber','c_sccNumber',
 'wineCandidateSupplierInfoSelect','c_lcboSupplierNumber','c_supplierName','c_supplierAddress1','c_supplierAddress2','c_supplierCity','c_supplierRegion','c_supplierCountry','c_supplierPostalCode','c_phoneNumber','c_faxNumber','c_emailAddress','c_paymentTerms','c_producerSize','c_supplierOntarioAgent','c_supplierOntarioAgentDetails','c_supplierOtherProvinceExporter','c_supplierOtherProvinceExporterDetails',
 'c_producingCountry','c_producingRegion','c_purchasingCountry','c_purchasingRegion','c_manufacturingCountry','c_manufacturingRegion','c_vintage','c_percentAlcohol','c_sweetnessSugar','c_grapeVarietal1','c_grapeVarietal2','c_grapeVarietal3',
 'c_limitedCaseQty','c_leadTimeDays','c_score','c_scoreSource','c_scoreSourceOther','c_awards','c_pressCoverage','portalWebsites',
 'awardAttachmentInput','italyCandidateAttachmentInput','c_sellingUnitSizeMl','c_unitsPerSellingPack','c_containerType','c_containerWeightG','c_packageMaterial','c_packageWeightG','c_stopperType','c_stopperWeightG',
 'c_caseLengthCm','c_caseHeightCm','c_caseWidthCm','c_caseWeightKg','c_casesPerPallet','c_casesPerTier','c_numberOfTiers','c_cases20Container','c_cases40Container','c_casesTempContainer'
];
function tenderUpdateForm(){
 const template=document.createElement('template');template.innerHTML=forms.item;
 for(const input of template.content.querySelectorAll('[name]')){
  input.removeAttribute('required');
  if(tenderUpdateFields.includes(input.name)){
   input.removeAttribute('disabled');
   input.closest('label')?.classList.remove('hidden','field-hidden');
  }else{
   input.disabled=true;input.dataset.tenderLocked='true';
   input.closest('label')?.classList.add('tender-locked');
  }
 }
 for(const key of ['portalPhoto0','portalPhoto1','portalPhoto2']){
  const input=template.content.getElementById(key);input.accept='.pdf,.jpg,.jpeg,image/jpeg,application/pdf';
  const box=document.createElement('div');box.className='attachment-box';input.before(box);box.append(input);
  const rows=document.createElement('div');rows.id=key+'Rows';box.append(rows);
 }
 return template.innerHTML;
}
function tenderOfferStorage(method,key,data){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('winglobal-tender-offers',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('details');
  request.onerror=()=>reject(Error('Could not open local tender offer storage.'));
  request.onsuccess=()=>{
   const connection=request.result;
   const transaction=connection.transaction('details',method==='get'?'readonly':'readwrite');
   const store=transaction.objectStore('details');
   const operation=method==='put'?store.put(data,key):store[method](key);
   transaction.oncomplete=()=>{connection.close();resolve(operation.result)};
   transaction.onabort=()=>{connection.close();reject(Error('Could not access the saved tender offer details.'))};
  };
 });
}
function configureTenderPromo(form,data){
 const percent=form.querySelector('#itCanPromotionalSupportPercent');
 const amount=form.querySelector('#itCanPromotionalSupportAmount');
 const quote=Number(data.itCanPrice);
 percent.disabled=false;
 amount.readOnly=true;
 form.querySelector('#itCanPromotionalSupportCurrency').textContent=data.itCanCurrency||'';
 const calculate=()=>{
  amount.value=Number.isFinite(quote)&&quote>=0&&data.itCanPrice!==''&&data.itCanPrice!=null&&percent.value!==''
   ? (quote*Number(percent.value)/100).toFixed(2):'';
  form.querySelector('#promoSupportAmountDisplay').textContent=amount.value||'—';
 };
 percent.addEventListener('input',calculate);
 calculate();
}
function form(root,key,data={},submit,readOnly=false){
 const f=add(root,'form');
 const tenderUpdate=key==='tenderUpdate';
 const fields=add(f,'fieldset');fields.innerHTML=tenderUpdate?tenderUpdateForm():forms[key];
 fields.disabled=readOnly;
 for(const input of fields.querySelectorAll('[name]')){
  if(input.type==='file'||!tenderUpdate&&!Object.hasOwn(data,input.name))continue;
  const value=data[input.name]??'';
  if(tenderUpdate&&input.tagName==='SELECT'&&!value&&![...input.options].some(option=>option.value==='')){
   input.add(new Option('Select',''),0);
  }
  if((tenderUpdate&&input.tagName==='SELECT'||input.id==='c_stopperType')&&value&&![...input.options].some(option=>option.value===value)){
   input.add(new Option(value+' (previously saved)',value));
  }
  input.value=value;
 }
 if(key==='supplier'){
  for(const [trigger,section] of [['itWinOntario','itWinOntarioAgentDetails'],['itWinExportsOtherProvinces','itWinOtherProvinceDetails']]){
   const update=()=>f.querySelector('#'+section).classList.toggle('hidden',f.querySelector('#'+trigger).value!=='Yes');
   f.querySelector('#'+trigger).onchange=update;update();
  }
  for(const key of ['itWinName','itWinCountry','itWinEmail'])f.querySelector('#'+key).required=true;
 }
 const attachmentGroups={};
 let pendingAttachments=0;
 const field=id=>f.querySelector('#'+id);
 if(key==='item'){
  const quoteType=field('itCanQuoteType');
  const cost=field('quoteTransportCost');
  const updateQuoteCost=()=>{
   const destination=quoteType.value==='EX-CELLAR'?'Consolidation Warehouse':'';
   field('quoteTransportCostRow').classList.toggle('hidden',!destination);
   field('quoteTransportCostLabel').textContent=destination?'Approximate Transportation Cost per Bottle to the '+destination:'';
   cost.disabled=!destination;
  };
  quoteType.addEventListener('change',()=>{cost.value='';updateQuoteCost()});
  updateQuoteCost();
  const calculate=()=>{
   const cases=Number(field('itCanPrice').value), bottles=Number(field('itCanBottlesPerCase').value);
   field('itCanBottlePrice').value=bottles>0&&field('itCanPrice').value?(cases/bottles).toFixed(4):'';
   const percent=field('itCanPromotionalSupportPercent');
   const amount=field('itCanPromotionalSupportAmount');
   const rate=Number(percent.value);
   amount.readOnly=true;
   amount.value=field('itCanPrice').value!==''&&Number.isFinite(cases)&&cases>=0&&percent.value!==''&&Number.isFinite(rate)
    ? (cases*rate/100).toFixed(2):'';
   field('itCanPromotionalSupportCurrency').textContent=field('itCanCurrency').value||'';
   field('promoSupportAmountDisplay').textContent=amount.value||'—';
  };
  f.addEventListener('input',calculate);
  field('itCanCurrency').addEventListener('change',calculate);calculate();
 }
 if(tenderUpdate){
  const supplierPick=field('wineCandidateSupplierInfoSelect');
  const supplier=winery(owner());
  if(supplier)supplierPick.add(new Option(supplier.data.itWinName, supplier.id));
  supplierPick.value=data.wineCandidateSupplierInfoSelect||'';
  supplierPick.addEventListener('change',()=>{
   const saved=winery(supplierPick.value)?.data;if(!saved)return;
   const map={c_lcboSupplierNumber:'itWinLcboSupplierNumber',c_supplierName:'itWinName',c_supplierAddress1:'itWinAddress1',c_supplierAddress2:'itWinAddress2',c_supplierCity:'itWinCity',c_supplierRegion:'itWinRegion',c_supplierCountry:'itWinCountry',c_supplierPostalCode:'itWinPostalCode',c_phoneNumber:'itWinPhone',c_emailAddress:'itWinEmail',c_paymentTerms:'itWinPaymentTerms',c_producerSize:'itWinProducerSize',c_supplierOntarioAgent:'itWinOntario',c_supplierOtherProvinceExporter:'itWinExportsOtherProvinces'};
   for(const [target,source] of Object.entries(map))if(field(target)&&!field(target).disabled)field(target).value=saved[source]||'';
  });
  configureTenderPromo(f,data);
 }
 const attachmentPickers=key==='item'
  ? [[attachmentKey,'italyCandidateAttachmentRows'],[awardAttachmentKey,'awardAttachmentRows']]
  : tenderUpdate?[[attachmentKey,'italyCandidateAttachmentRows'],[awardAttachmentKey,'awardAttachmentRows'],...['portalPhoto0','portalPhoto1','portalPhoto2'].map(key=>[key,key+'Rows'])]:[];
 for(const [pickerId,rowsId] of attachmentPickers){
  const picker=field(pickerId);
  const rows=field(rowsId);
  const attachments=[...(data[pickerId]||[])];
  attachmentGroups[pickerId]=attachments;
  let attaching=false;
  const redraw=()=>{
   rows.replaceChildren();
   attachments.forEach((file,index)=>{
    const row=add(rows,'div');
    add(row,'span',file.name);
    button(row,'View',async()=>{
     const preview=window.open('about:blank','_blank');
     if(!preview){alert('Allow pop-ups to view the attachment.');return}
     preview.opener=null;
     try{
      const blob=await (await fetch(file.url)).blob();
      const url=URL.createObjectURL(blob);
      preview.location.replace(url);
      setTimeout(()=>URL.revokeObjectURL(url),60000);
     }catch{preview.close();alert('Could not open the attachment.')}
    });
    if(!readOnly)button(row,'Remove',()=>{
     if(attaching)return;
     if(!admin()){
      const source=db.items.find(item=>item.owner===owner()&&item.data===data);
      db.recycledFiles.unshift({id:id(),owner:owner(),file:attachments[index],field:pickerId,itemId:source?.id,deletedAt:new Date().toISOString()});
      save();
     }
     attachments.splice(index,1);
     redraw();
    });
   });
  };
  picker.hidden=true;
  if(!readOnly){
   const attach=button(picker.parentNode,'Attach',()=>picker.click());
   picker.onchange=async()=>{
    const selected=[...picker.files];
    picker.value='';
    if(!selected.length||attaching)return;
    const maximum=pickerId.startsWith('portalPhoto')?1:10;
    if(attachments.length+selected.length>maximum){alert('You can attach up to '+maximum+' file(s). Remove the previous file first to replace it.');return}
    if(selected.some(file=>! /\.(pdf|jpe?g)$/i.test(file.name)||file.size>1000000||!file.size)){
     alert('Choose PDF, JPG or JPEG files up to 1 MB each.');return;
    }
    attaching=true;
    pendingAttachments++;
    attach.disabled=true;
    try{const files=await Promise.all(selected.map(readFile));attachments.push(...files);redraw()}
    catch{alert('Could not read the selected files.')}
    finally{attaching=false;pendingAttachments--;attach.disabled=false}
   };
  }
  redraw();
 }
 if(key==='item')for(const [fieldName,value] of Object.entries(data)){
  if(!Object.hasOwn(attachmentGroups,fieldName)&&Array.isArray(value))value.forEach(file=>{download(f,file);add(f,'br')});
 }
 if(readOnly)return;
 const b=add(f,'button',tenderUpdate?'Submit Tender Offer':'Save');b.type='submit';
 f.onsubmit=async event=>{
  event.preventDefault();
  if(pendingAttachments||b.disabled)return;
  const values={...data,...attachmentGroups};
  if(tenderUpdate){
   const attachments=attachmentGroups[attachmentKey];
   if(attachments.length<7||attachments.length>10){
    alert('Supporting Photos / Documents must contain 7 to 10 files before submitting.');
    return;
   }
   for(const [fieldName,value] of new FormData(f)){
    if(typeof value==='string'&&tenderUpdateFields.includes(fieldName))values[fieldName]=value.trim();
   }
   values.itCanPromotionalSupportAmount=field('itCanPromotionalSupportAmount').value;
   const dimensionFields=['c_caseLengthCm','c_caseWidthCm','c_caseHeightCm'];
   if(dimensionFields.some(key=>String(values[key]??'')!==String(data[key]??''))){
    const dimensions=dimensionFields.map(key=>Number(values[key]));
    values.c_calculatedCaseVolume=dimensions.every(value=>value>0)?String(Number(dimensions.reduce((a,b)=>a*b).toFixed(6))):'';
   }
   b.disabled=true;
   try{await submit(values)}
   catch(error){alert(error.message)}
   finally{b.disabled=false}
   return;
  }
  if(key==='item')delete values.quoteTransportCost;
  try{
   const files={};
   for(const [key,value] of new FormData(f)){
    if(typeof value==='string')values[key]=value.trim();
    else if(value.size){
     if(value.size>1000000)throw Error('Use sample files smaller than 1 MB each.');
     (files[key]??=[]).push(await readFile(value));
    }
   }
   Object.assign(values,files);
   if(JSON.stringify(db).length+JSON.stringify(values).length>3500000)throw Error('Local sample storage is full. Use smaller sample files.');
   submit(values);
  }catch(error){alert(error.message)}

 };
}
function status(root,item){
 add(root,'p',item.status==='Approved'?'Approved · Locked':item.status);
}
function details(root,key,data,submit,label){
 const d=add(root,'details');add(d,'summary',label||(submit?'View or edit details':'View details'));
 d.ontoggle=()=>{if(d.open&&!d.querySelector('form'))form(d,key,data,submit,!submit)};
}
let mainSubmissionStatuses = {};
async function refreshMainSubmissionStatuses(){
 if(page!=='My Active Tender Items')return;
 try{
  const response=await fetch('/submission-status',{cache:'no-store'});
  if(!response.ok)return;
  const statuses=await response.json();
  if(JSON.stringify(statuses)===JSON.stringify(mainSubmissionStatuses))return;
  mainSubmissionStatuses=statuses;
  if(page==='My Active Tender Items')render();
 }catch{}
}
setInterval(refreshMainSubmissionStatuses,5000);
function tenderSubmissionQuota(tender,supplierId){
 const maximum=Number(tender.maximumSubmissions);
 const used=db.offers.filter(offer=>offer.tender===tender.id&&offer.owner===supplierId).length;
 const limited=Number.isInteger(maximum)&&maximum>0;
 return {used,maximum,limited,reached:limited&&used>=maximum};
}
function ensureTenderSubmissionCapacity(tender,supplierId){
 const quota=tenderSubmissionQuota(tender,supplierId);
 if(quota.reached)throw Error('Submission limit reached. You can offer up to '+quota.maximum+' items to this tender.');
}
function reviewTenderOffer(root,tender,item,picker){
 if(tenderSubmissionQuota(tender,item.owner).reached){alert('Submission limit reached for this tender.');return}
 const existing=root.querySelector('.tender-offer-review');
 if(existing)existing.remove();
 const cards=[...get('view').querySelectorAll('article')];
 cards.forEach(card=>{if(!card.contains(picker))card.classList.add('tender-other-item')});
 const previousOptionStates=[...picker.options].map(option=>[option,option.disabled]);
 [...picker.options].forEach(option=>{option.disabled=option.disabled||option.value!==item.id});picker.disabled=true;
 const unlock=()=>{cards.forEach(card=>card.classList.remove('tender-other-item'));picker.disabled=false;previousOptionStates.forEach(([option,disabled])=>{option.disabled=disabled})};
 const review=add(root,'div');review.className='tender-offer-review';
 add(review,'h3','Review '+name(item)+' for '+tender.title);
 add(review,'p','This offer starts with the approved item’s details. Edit any available fields before submitting.');
 form(review,'tenderUpdate',item.data,async data=>{
  const stillEligible=()=>item.owner===owner()&&item.status==='Approved'&&db.tenders.includes(tender)&&tender.status!=='Closed'&&
   tender.targets.includes(item.owner)&&!db.offers.some(offer=>offer.tender===tender.id&&offer.item===item.id);
  ensureTenderSubmissionCapacity(tender,item.owner);
  if(!stillEligible())throw Error('This item is no longer available for this tender.');
  const detailsId=id();
  await tenderOfferStorage('put',detailsId,data);
  const offer={owner:item.owner,tender:tender.id,item:item.id,detailsId,status:'Submitted'};
  try{
   ensureTenderSubmissionCapacity(tender,item.owner);
   if(!stillEligible())throw Error('This item is no longer available for this tender.');
   db.offers.push(offer);
   save();
  }catch(error){
   db.offers=db.offers.filter(record=>record!==offer);
   await tenderOfferStorage('delete',detailsId).catch(()=>{});
   throw error;
  }
  page='My Active Tender Items';render();
 });
 button(review,'Cancel',()=>{unlock();review.remove()});
 picker.onchange=()=>review.remove();
}
function showSupplierTenderItems(root,tender,supplierId){
 const offers=db.offers.filter(offer=>offer.tender===tender.id&&offer.owner===supplierId);
 if(!offers.length)return;
 const section=add(root,'section');section.className='supplier-tender-items';
 add(section,'h3','Your Items in This Tender');
 offers.forEach(offer=>{
  const item=db.items.find(item=>item.id===offer.item);
  const row=add(section,'div');row.className='supplier-tender-item';
  add(row,'strong',item?name(item):'Item unavailable');
  const label=offer.status==='Approved'?'Approved Item':offer.status==='Submitted'?'Offered Item':offer.status==='Documents Submitted'?'Offered Item — Documents Submitted':offer.status==='Declined'?'Declined Item':offer.status;
  const badge=add(row,'span',label);badge.className=offer.status==='Approved'?'tender-item-status approved':'tender-item-status';
  const details=add(row,'details');add(details,'summary','View offered item');
  details.ontoggle=()=>{if(details.open&&!details.dataset.loaded){details.dataset.loaded='true';offerStatus(details,offer)}};
 });
}
function offerStatus(root,offer){
 const item=db.items.find(i=>i.id===offer.item);
 add(root,'h3',item?name(item):'Item unavailable');
 add(root,'p',db.tenders.find(t=>t.id===offer.tender).title+' · '+offer.status);
 if(!admin()&&offer.status==='Approved'){
  const key=JSON.stringify([offer.owner,offer.tender,offer.item]);
  add(root,'p','Submission Status: '+(mainSubmissionStatuses[key]||'Awaiting status from main WINGLOBAL'));
 }
 if(offer.request)add(root,'p',offer.request);
 if(offer.document){add(root,'p','Document received');download(root,offer.document)}
 const offeredData=()=>offer.detailsId?tenderOfferStorage('get',offer.detailsId):Promise.resolve(item?.data);
 if(offer.detailsId){
  const section=add(root,'details');add(section,'summary','View Submitted Offer Details');
  section.ontoggle=async()=>{
   if(!section.open)return;
   section.ontoggle=null;
   try{
    const data=await offeredData();
    if(!data)throw Error('Offer details unavailable.');
    form(section,'item',data,null,true);
   }catch(error){add(section,'p',error.message)}
  };
 }
 if(admin()){
  add(root,'p','Supplier: '+(winery(offer.owner)?.data.itWinName||'Unavailable'));
  if(item&&!offer.detailsId)details(root,'item',item.data,null,'View Item Details');
  for(const status of ['Approved','Declined','More Documents Required']){
   const decisionButton=button(root,status,async()=>{
    const request=status==='More Documents Required'?prompt('Which documents are required?'):'';
    if(request===null||status==='More Documents Required'&&!request.trim())return;
    if(status==='Approved'){
     if(!item){alert('The item is unavailable.');return}
     const tender=db.tenders.find(t=>t.id===offer.tender);
     decisionButton.disabled=true;
     try{
      const data=await offeredData();
      if(!db.offers.includes(offer))return;
      if(!data)throw Error('Offer details unavailable');
      const response=await fetch('/approved-offers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
       key:JSON.stringify([offer.owner,offer.tender,offer.item]),
       itemName:name(item),supplier:winery(offer.owner)?.data.itWinName||'',
       tenderName:tender.title,tenderId:tender.code||'',tenderDate:tender.preSubmissionDate||'',
       productNeeds:tender.productNeeds||'',productType:data.c_productType||'',
       offeredQuote:data.itCanPrice||'',offeredQuoteCurrency:data.itCanCurrency||'',
       bottles:data.itCanBottlesPerCase||'',caseKg:data.c_caseWeightKg||''
      })});
      if(!response.ok)throw Error('Queue unavailable');
     }catch{decisionButton.disabled=false;alert('Could not queue the offer. Keep the portal launcher running and try again.');return}
    }
    if(!db.offers.includes(offer))return;
    change(()=>{offer.status=status;offer.request=request;note(offer.owner,'Tender offer: '+status,request||(item?name(item):'Item unavailable'))});
   });
  }
 }else if(offer.status==='More Documents Required'){
  const file=add(root,'input');file.type='file';file.setAttribute('aria-label','Requested document');
  button(root,'Send requested document',async()=>{
   const value=file.files[0];if(!value||value.size>1000000||JSON.stringify(db).length+value.size*1.4>3500000){alert('Select a smaller sample file.');return}
   const document=await readFile(value);
   change(()=>{offer.document=document;offer.status='Documents Submitted'});
  });
 }
}
function approvedTenderNames(offers){
 return [...new Set(offers.filter(offer=>offer.status==='Approved')
  .map(offer=>db.tenders.find(tender=>tender.id===offer.tender)?.title||'Tender unavailable'))];
}
function deletePortalRecord(record,supplier=false){
 if(!admin())return;
 const label=supplier?record.data.itWinName:name(record);
 const offers=db.offers.filter(offer=>supplier?offer.owner===record.id:offer.item===record.id);
 const approved=approvedTenderNames(offers);
 const warning=approved.length?'Approved for tender: '+approved.join(', ')+'.\n\n':'';
 const affected=supplier?' This removes the supplier’s portal items and tender offers.':' This also removes any tender offers for this item from the portal.';
 if(!confirm(warning+'Delete '+label+'?'+affected))return;
 if(approved.length&&!confirm(warning+'Confirm permanent deletion from the portal.'))return;
 change(()=>{
  db.items=db.items.filter(item=>supplier?item.owner!==record.id:item.id!==record.id);
  db.offers=db.offers.filter(offer=>!offers.includes(offer));
  if(supplier){
   db.wineries=db.wineries.filter(winery=>winery.id!==record.id);
   db.messages=db.messages.filter(message=>message.to!==record.id&&message.from!==record.id);
   for(const tender of db.tenders){
    tender.targets=tender.targets.filter(target=>target!==record.id);
    if(tender.seenBy)tender.seenBy=tender.seenBy.filter(target=>target!==record.id);
   }
  }
 });
 for(const offer of offers){
  if(offer.detailsId)tenderOfferStorage('delete',offer.detailsId).catch(console.warn);
 }
}
function renderReview(root){list(root,db.items,(r,i)=>{
  add(r,'h3',name(i)+' · '+winery(i.owner).data.itWinName);status(r,i);
  const approved=approvedTenderNames(db.offers.filter(offer=>offer.item===i.id));
  if(approved.length)add(r,'p','Approved for tender: '+approved.join(', ')).className='badge';
  button(r,'Delete Item',()=>deletePortalRecord(i));
  details(r,'item',i.data,i.status==='Approved'?data=>change(()=>{i.data=data;i.revision++;note(i.owner,'Approved item updated',name(i))}):null);
  if(i.status==='Submitted')for(const decision of ['Approved','Declined','More Information Requested']){
   button(r,decision,()=>{const reason=decision==='More Information Requested'?prompt('What information is needed?'):'';if(reason===null)return;
    change(()=>{i.status=decision;if(decision==='Approved')i.revision++;note(i.owner,'Wine review: '+decision,reason||name(i))});
   });
  }
 });}

function renderRequests(root){
 list(root,db.wineries,(r,w)=>{
  add(r,'h3',w.data.itWinName);add(r,'p',w.approved?'Approved':'Pending approval');details(r,'supplier',w.data);
  const approved=approvedTenderNames(db.offers.filter(offer=>offer.owner===w.id));
  if(approved.length)add(r,'p','Approved for tender: '+approved.join(', ')).className='badge';
  button(r,'Delete Supplier',()=>deletePortalRecord(w,true));
  if(!w.approved)button(r,'Approve Supplier',()=>change(()=>{w.approved=true;note(w.id,'Supplier approved','You can now submit product offers.')}));
 });
}
async function sendTenderEmails(targets,subject,body){
 try{
  const response=await fetch('/tender-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipients:targets.map(to=>winery(to).data.itWinEmail),subject,body})});
  const result=await response.json();
  alert(result.message);
 }catch{alert('Inbox notices saved. Email delivery could not be confirmed.')}
}
function composeMail(root,to='',subject=''){
 const existing=root.querySelector('.mail-compose');
 if(existing){existing.querySelector('select, input').focus();return}
 const sender=owner();
 const f=add(root,'form');f.className='mail-compose';
 let recipient;
 if(admin()){
  add(f,'h3','Email Supplier');
  recipient=add(add(f,'label','To: Registered supplier'),'select');
  recipient.required=true;
  recipient.add(new Option('Select supplier',''));
  db.wineries.forEach(w=>recipient.add(new Option(w.data.itWinName+(w.data.itWinEmail?' — '+w.data.itWinEmail:''),w.id)));
  recipient.value=to;
 }else add(f,'h3','To: '+(winery(to)?.data.itWinName||'Portal Administrator'));
 const subjectInput=add(add(f,'label','Subject'),'input');subjectInput.required=true;subjectInput.value=subject;
 const body=add(add(f,'label','Message'),'textarea');body.required=true;body.rows=5;
 add(f,'button','Send message').type='submit';
 button(f,'Cancel',()=>f.remove());
 const result=add(f,'p');result.setAttribute('role','status');
 f.onsubmit=async event=>{
  event.preventDefault();
  const target=recipient?recipient.value:to;
  if(recipient&&!winery(target)){result.textContent='Select a registered supplier.';return}
  if(!subjectInput.value.trim()||!body.value.trim()){result.textContent='Enter a subject and message.';return}
  const subjectText=subjectInput.value.trim(), messageText=body.value.trim();
  change(()=>note(target,subjectText,messageText,sender));
  const sent=add(get('view'),'p','Message sent in the portal.');sent.setAttribute('role','status');
  if(recipient){
   if(winery(target).data.itWinEmail)await sendTenderEmails([target],subjectText,messageText);
   else sent.textContent='Message sent in the portal. This supplier has no registered email address.';
  }
 };
 subjectInput.focus();
}
const tenderFields=[
 ['productNeeds','Product Needs','select',['BEER','DEST COLLECTION','DUTY FREE','ECOMMERCE','ONE-ONE-ONE','READY TO DRINK','SPIRITS','VINTAGES','VINTAGES ADHOC','VINTAGES DIRECT','WINES','Other']],
 ['code','Product Need ID#','input'],
 ['title','Product Need Items','textarea'],
 ['productNeedItemsId','Product Need Items ID number','number'],
 ['maximumSubmissions','Maximum Submission Amount','number'],
 ['preSubmissionDate','Pre-Submission Date','date'],
 ['status','Status','select',['Active','Closed']],
 ['notes','Notes','textarea']
];
function showTenderFields(r,t){
  const layout=add(r,'div');layout.className='tender-details-columns';
  const visibleFields=tenderFields.filter(([key])=>!['maximumSubmissions','code','productNeedItemsId'].includes(key));
  const columns=Array.from({length:Math.ceil(visibleFields.length/3)},()=>add(layout,'div'));
  visibleFields.forEach(([key,label],index)=>{
   const cell=add(columns[Math.floor(index/3)],'div');cell.className='tender-detail';
   add(cell,'strong',label+' *'+(['productNeeds','title'].includes(key)?' / ID#':''));
   const value=t[key]??(key==='notes'?t.description:undefined);
   const text=add(cell,'p',value==null||String(value).trim()===''?'—':String(value));
   text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';
   if(['productNeeds','title'].includes(key)){const idValue=key==='productNeeds'?t.code:t.productNeedItemsId;add(cell,'small','ID#: '+(idValue||'—'))}
  });
}
function matchesTenderAudience(supplier,countries,categories,items=db.items){
 const normalize=value=>String(value||'').trim().toLowerCase();
 return (!countries.length||countries.some(country=>normalize(country)===normalize(supplier.data.itWinCountry)))
  &&(!categories.length||items.some(item=>item.owner===supplier.id&&item.status!=='Discarded'&&categories.includes(item.data.c_productCategory)));
}
function renderTenderForm(root,tender){
  const action=tender?'Save Tender Changes':'Announce Tender';
  add(root,'p','Complete all required fields and select the suppliers who should see this tender.');
  const f=add(root,'form');
  const grid=add(f,'div');grid.className='form-grid';
  const needsRow=add(grid,'div');needsRow.className='full';needsRow.style.display='grid';needsRow.style.gridTemplateColumns='minmax(0, 1fr) minmax(100px, 170px)';needsRow.style.gap='12px';
  const itemsRow=add(grid,'div');itemsRow.className='full';itemsRow.style.display='grid';itemsRow.style.gridTemplateColumns=needsRow.style.gridTemplateColumns;itemsRow.style.gap='12px';
  const controls=tenderFields.map(([key,label,kind,options])=>{
   const wrapper=add(['productNeeds','code'].includes(key)?needsRow:['title','productNeedItemsId'].includes(key)?itemsRow:grid,'label',label+' *');
   const input=add(wrapper,key==='title'?'input':['date','number'].includes(kind)?'input':kind);
   input.name=key;
   if(['date','number'].includes(kind))input.type=kind;
   if(kind==='number'){input.min='0';input.step='1';input.inputMode='numeric'}
   if(key==='maximumSubmissions'){input.min='1';input.placeholder='e.g. 20';add(wrapper,'small','Maximum items each supplier may offer to this tender.')}
   if(key==='code')input.placeholder='Product Need ID#';
   if(key==='title')input.placeholder='Type Product Need Items';
   if(key==='productNeedItemsId')input.placeholder='Items ID number';
   if(key==='notes'){wrapper.className='full';input.rows=5;input.style.minHeight='120px';input.style.resize='vertical'}
   if(options)input.replaceChildren(new Option('Select',''),...options.map(value=>new Option(value,value)));
   input.value=tender?.[key]??(key==='notes'?tender?.description:'')??'';
   input.required=true;
   return [key,input];
  });
  const checkbox=(root,text)=>{
   const label=add(root,'label');const input=add(label,'input');input.type='checkbox';input.style.width='auto';input.style.marginRight='8px';label.append(document.createTextNode(text));return input;
  };
  const syncGroup=(parent,children)=>{
   const count=children.filter(input=>input.checked).length;
   parent.checked=count>0&&count===children.length;parent.indeterminate=count>0&&count<children.length;
  };
  add(f,'h3','Product Categories');
  const categorySection=add(f,'div');
  const allProducts=checkbox(categorySection,'All Product Categories');
  const source=new DOMParser().parseFromString(forms.item,'text/html');
  const categories=[...source.querySelector('#c_productCategory').options].filter(option=>option.value).map(option=>{
   const row=add(categorySection,'div');row.style.marginLeft='24px';
   const input=checkbox(row,option.textContent);input.value=option.value;
   input.checked=tender?.audienceCategories?.length?tender.audienceCategories.includes(option.value):true;
   input.onchange=()=>syncGroup(allProducts,categories);return input;
  });
  allProducts.onchange=()=>{categories.forEach(input=>{input.checked=allProducts.checked});syncGroup(allProducts,categories)};
  syncGroup(allProducts,categories);
  add(f,'h3','Countries and Suppliers');
  const supplierSection=add(f,'div');
  const allSuppliers=checkbox(supplierSection,'All countries — All suppliers');
  const recipients=[],countryGroups=[];
  const suppliers=db.wineries.filter(w=>w.approved);
  const countryName=w=>String(w.data.itWinCountry||'Country not specified').trim();
  const countries=[...new Map(suppliers.map(w=>[countryName(w).toLowerCase(),countryName(w)])).values()].sort();
  const refresh=()=>{
   countryGroups.forEach(group=>syncGroup(group.input,group.children));syncGroup(allSuppliers,recipients);
   audienceCount.textContent=recipients.filter(input=>input.checked).length+' supplier(s) selected.';
  };
  countries.forEach(country=>{
   const section=add(supplierSection,'section');section.style.margin='12px 0 12px 24px';
   const countryCheck=checkbox(section,country+' — All suppliers');
   const children=suppliers.filter(w=>countryName(w).toLowerCase()===country.toLowerCase()).map(w=>{
    const row=add(section,'div');row.style.marginLeft='24px';
    const input=checkbox(row,w.data.itWinName);input.value=w.id;input.dataset.country=country;
    input.checked=Boolean(tender?.targets.includes(w.id));input.onchange=refresh;recipients.push(input);return input;
   });
   countryGroups.push({input:countryCheck,children});
   countryCheck.onchange=()=>{children.forEach(input=>{input.checked=countryCheck.checked});refresh()};
  });
  allSuppliers.onchange=()=>{recipients.forEach(input=>{input.checked=allSuppliers.checked});refresh()};
  const audienceCount=add(f,'p');audienceCount.setAttribute('role','status');refresh();
  if(!suppliers.length)add(f,'p','No approved suppliers registered yet.');
  button(f,'Clear supplier marks',()=>{recipients.forEach(input=>{input.checked=false});refresh()});
  add(f,'button',action).type='submit';
  if(tender)button(f,'Cancel',()=>render());
  f.onsubmit=event=>{event.preventDefault();
   if(!admin()||(tender&&!db.tenders.includes(tender)))return;
   const targets=[...new Set(recipients.filter(input=>input.checked).map(input=>input.value))];
   const values=Object.fromEntries(controls.map(([key,input])=>[key,input.value.trim()]));
   const selected=recipients.filter(input=>input.checked);
   const audienceCountries=[...new Set(selected.map(input=>input.dataset.country))],audienceCategories=categories.filter(input=>input.checked).map(input=>input.value);
   if(!Number.isInteger(Number(values.maximumSubmissions))||Number(values.maximumSubmissions)<1){alert('Maximum Submission Amount must be a whole number of at least 1.');return}
   if(!audienceCategories.length){alert('Mark at least one Product Category.');return}
   if((!tender&&!targets.length)||Object.values(values).some(value=>!value)){alert('Complete all required fields and select at least one recipient.');return}
   if(db.tenders.some(t=>t!==tender&&t.code?.toLowerCase()===values.code.toLowerCase())){alert('This Product Need ID# already exists.');return}
   if(tender){
    change(()=>Object.assign(tender,values,{targets,audienceCountries,audienceCategories,seenBy:(tender.seenBy||[]).filter(id=>targets.includes(id))}));
    return;
   }
   const subject='New tender: '+values.title;
   const message=tenderFields.map(([key,label])=>label+': '+values[key]).join('\n');
   const announced={id:id(),...values,targets,audienceCountries,audienceCategories,seenBy:[]};
   change(()=>{
    db.tenders.push(announced);
    targets.forEach(to=>note(to,subject,message));
    selectedAdminTenderId=announced.id;
    page='Tender List';
   });
   sendTenderEmails(targets,subject,message);
  };
}
function deleteTender(tender){
 if(!admin()||!db.tenders.includes(tender))return;
 const offers=db.offers.filter(offer=>offer.tender===tender.id);
 const hasApproval=offers.some(offer=>offer.status==='Approved');
 const warning=hasApproval?'This tender has approved offers.\n\n':'';
 if(!confirm(warning+'Delete '+tender.title+' and its '+offers.length+' portal offer(s)?'))return;
 if(hasApproval&&!confirm(warning+'Confirm permanent deletion from the portal.'))return;
 change(()=>{
  db.tenders=db.tenders.filter(record=>record!==tender);
  db.offers=db.offers.filter(offer=>offer.tender!==tender.id);
  selectedAdminTenderId='';
 });
 for(const offer of offers){
  if(offer.detailsId)tenderOfferStorage('delete',offer.detailsId).catch(console.warn);
 }
}
function renderAdminTenders(root){
 const tender=db.tenders.find(t=>t.id===selectedAdminTenderId);
 if(tender){
  button(root,'Back to Tender List',()=>{selectedAdminTenderId='';render()});
  add(root,'h3',tender.title);
  showTenderFields(root,tender);
  button(root,'Edit Tender',()=>{
   root.replaceChildren();
   add(root,'h2','Edit Tender');
   renderTenderForm(root,tender);
  });
  button(root,'Delete Tender',()=>deleteTender(tender));
  const offers=db.offers.filter(offer=>offer.tender===tender.id);
  add(root,'h3','Offers for this tender ('+offers.length+')');
  if(offers.length)list(root,offers,offerStatus);
  else add(root,'p','No offers have been submitted to this tender yet.');
  return;
 }
 list(root,[...db.tenders].reverse(),(card,t)=>{
  const tenderButton=button(add(card,'h3'),t.title,()=>{selectedAdminTenderId=t.id;render()});
  reviewFlag(tenderButton,db.offers.filter(offer=>offer.tender===t.id&&['Submitted','Documents Submitted'].includes(offer.status)).length);
  add(card,'p',[t.code,t.status].filter(Boolean).join(' · '));
 });
}
function adminReviewCounts(){
 return {
  'Offer an Item':db.items.filter(item=>item.status==='Submitted').length,
  'Active Tender Offers':db.offers.filter(offer=>['Submitted','Documents Submitted'].includes(offer.status)).length,
  'My Information (Supplier)':db.wineries.filter(supplier=>!supplier.approved).length
 };
}
function reviewFlag(root,count){
 if(!count)return;
 const flag=add(root,'span',' ⚑ '+count);flag.className='badge';
 flag.setAttribute('aria-label',count+' submissions awaiting review');
 flag.title=count+' submissions awaiting review';
}
function render(){
 roles();
 const root=get('view'),nav=get('nav');root.replaceChildren();nav.replaceChildren();
 const tabs=admin()?['Announce Tender','Tender List','Active Tender Offers','Mail Inbox','Transfer Queue','My Information (Supplier)','Offer an Item']:
 owner()==='new'?['Register New Supplier']:['Tender List','My Active Tender Items','Mail Inbox','Recycle Bin','My Information (Supplier)','Approved Items','Offer an Item'];
 if(!tabs.includes(page))page=tabs[0];
 const newTenders=db.tenders.filter(t=>t.targets.includes(owner())&&t.seenBy&&!t.seenBy.includes(owner()));
 const pageLabel=tab=>admin()?({'My Information (Supplier)':'Suppliers Information','Offer an Item':'Offered Item Information'}[tab]||tab):(tab==='Offer an Item'?'Offer an Item for Approval':tab);
 const reviewCounts=admin()?adminReviewCounts():{};
 const supplierActions=add(nav,'div');supplierActions.className='supplier-actions';
 tabs.forEach(tab=>{const target=['My Information (Supplier)','Approved Items','Offer an Item'].includes(tab)?supplierActions:nav;
 const b=button(target,pageLabel(tab),()=>{page=tab;selectedAdminTenderId='';render()});if(admin())reviewFlag(b,reviewCounts[tab]||0);if(tab==='Mail Inbox'){const unread=db.messages.filter(m=>m.to===owner()&&!m.read&&!m.deletedBy?.includes(owner())).length;if(unread)add(b,'span',' '+unread).className='badge'}if(tab==='Tender List'&&newTenders.length)add(b,'span','New Tender Announced').className='badge';b.setAttribute('aria-current',tab===page?'page':'false')});
 if(supplierActions.children.length)nav.appendChild(supplierActions);else supplierActions.remove();
 add(root,'h2',pageLabel(page));
 const own=db.items.filter(i=>i.owner===owner());
 const approved=winery(owner())?.approved;
 switch(page){
 case 'Register New Supplier':form(root,'supplier',{},data=>change(()=>{
  const w={id:id(),data,approved:false};db.wineries.push(w);
  roles();get('role').value=w.id;page='My Information (Supplier)';
 }));break;
 case 'My Information (Supplier)':if(admin()){renderRequests(root);break}add(root,'p',approved?'Account approved':'Waiting for administrator approval');details(root,'supplier',winery(owner()).data);break;
 case 'Offer an Item':
  if(admin()){renderReview(root);break}
  if(!approved){add(root,'p','Your supplier account must be approved before you can offer wines.');break}
  form(root,'item',{},data=>change(()=>{db.items.push({id:id(),owner:owner(),data,status:'Draft',revision:0});page='Approved Items'}));break;
 case 'Approved Items':list(root,own.filter(i=>i.status!=='Discarded'),(r,i)=>{
  add(r,'h3',name(i));status(r,i);
  const editable=['Draft','More Information Requested'].includes(i.status);
  details(r,'item',i.data,editable?data=>change(()=>{i.data=data}):null);
  if(editable)button(r,'Submit for review',()=>change(()=>{i.status='Submitted'}));
  if(i.status==='Draft')button(r,'Move to Recycle Bin',()=>change(()=>{i.status='Discarded'}));
  if(i.status==='Approved')button(r,'Email administrator about a correction',()=>{page='Mail Inbox';render();composeMail(get('view'),'admin','Correction request: '+name(i))});
 });break;
 case 'Recycle Bin':
 add(root,'h3','Items');
 list(root,own.filter(i=>i.status==='Discarded'),(r,i)=>{
  add(r,'h3',name(i));button(r,'Restore draft',()=>change(()=>{i.status='Draft'}));
 });
 add(root,'h3','Messages');
 list(root,db.messages.filter(m=>m.to===owner()&&m.deletedBy?.includes(owner())),(r,m)=>{
  add(r,'h3',m.subject);add(r,'p',m.body);
  button(r,'Restore message',()=>change(()=>{m.deletedBy=m.deletedBy.filter(user=>user!==owner())}));
 });
 add(root,'h3','Attachments');
 list(root,db.recycledFiles.filter(file=>file.owner===owner()),(r,record)=>{
  add(r,'h3',record.file.name);
  download(r,record.file);
  const item=db.items.find(item=>item.id===record.itemId&&item.owner===owner());
  if(item)button(r,'Restore attachment',()=>change(()=>{
   const files=item.data[record.field]??=[];
   if(!files.some(file=>file.name===record.file.name&&file.url===record.file.url))files.push(record.file);
   db.recycledFiles=db.recycledFiles.filter(file=>file!==record);
  }));
  else add(r,'p','Download this file and attach it again to your form.');
 });break;
 case 'Announce Tender':renderTenderForm(root);break;
 case 'Tender List':
 if(admin()){renderAdminTenders(root);break}
 list(root,db.tenders.filter(t=>t.targets.includes(owner())),(r,t)=>{
  add(r,'h3',t.title);
  if(newTenders.includes(t)){
   add(r,'span','New Tender Announced').className='badge';
   button(r,'Mark as seen',()=>change(()=>t.seenBy.push(owner())));
  }
  showTenderFields(r,t);
  showSupplierTenderItems(r,t,owner());
  if(t.status==='Closed')return;
  const quota=tenderSubmissionQuota(t,owner());
  if(quota.limited)add(r,'p','Your submissions: '+quota.used+' / max. submission '+quota.maximum);
  if(quota.reached){add(r,'p','Submission limit reached for this tender.');return}
  const candidates=own.filter(i=>i.status==='Approved'&&(!t.audienceCategories?.length||t.audienceCategories.includes(i.data.c_productCategory)));
  if(!candidates.length){add(r,'p','No approved items available to offer.');return}
  const alreadyOffered=item=>db.offers.some(offer=>offer.tender===t.id&&offer.item===item.id);
  const eligible=candidates.filter(item=>!alreadyOffered(item));
  const pick=add(r,'select');
  candidates.forEach(item=>{
   const offered=alreadyOffered(item);
   const option=new Option(name(item)+(offered?' — Already offered to this tender':''),item.id);
   option.disabled=offered;if(offered)option.style.color='#999';pick.add(option);
  });
  pick.value=eligible[0]?.id||'';
  const offerButton=button(r,'Offer selected item',()=>{
   const item=eligible.find(item=>item.id===pick.value);
   if(!item||alreadyOffered(item)){alert('This item has already been offered to this tender.');return}
   reviewTenderOffer(r,t,item,pick);
  });
  offerButton.disabled=!eligible.length;
  if(!eligible.length)add(r,'p','All eligible items have already been offered to this tender.');
 });break;
 case 'Active Tender Offers':list(root,db.offers,offerStatus);break;
 case 'My Active Tender Items':list(root,db.offers.filter(o=>o.owner===owner()),offerStatus);refreshMainSubmissionStatuses();break;
 case 'Mail Inbox':
  if(admin()){
   const compose=button(root,'Create Email to Supplier',()=>composeMail(root));
   compose.disabled=!db.wineries.length;
   if(!db.wineries.length)add(root,'p','Register a supplier before composing an email.');
  }else button(root,'Email Administrator',()=>composeMail(root,'admin'));
  list(root,db.messages.filter(m=>m.to===owner()&&!m.deletedBy?.includes(owner())),(r,m)=>{
   add(r,'h3',m.subject);
   add(r,'small','From: '+(winery(m.from)?.data.itWinName||'Portal Administrator'));
   if(!m.read)add(r,'span','NEW').className='badge';
   add(r,'p',m.body);
   if(!m.read)button(r,'Mark as read',()=>change(()=>{m.read=true}));
   if(admin()&&winery(m.from))button(r,'Reply',()=>composeMail(r,m.from,'Re: '+m.subject));
   button(r,'Delete',()=>{if(confirm(admin()?'Delete this Mail Inbox message?':'Move this message to your Recycle Bin?'))change(()=>{if(admin())db.messages=db.messages.filter(message=>message!==m);else{m.deletedBy??=[];if(!m.deletedBy.includes(owner()))m.deletedBy.push(owner())}})});
  });
  break;
 case 'Transfer Queue':
  add(root,'p','Local preview of the approved records that the live connection will send to WINGLOBAL.');
  list(root,db.items.filter(i=>i.status==='Approved'),(r,i)=>{add(r,'h3',name(i));add(r,'p','Portal record '+i.id+' · Revision '+i.revision)});
  break;
 }
}
get('role').onchange=()=>{selectedAdminTenderId='';page=owner()==='new'?'Register New Supplier':'My Information (Supplier)';render()};
Promise.all(['supplier','item'].map(async key=>{
 const response=await fetch(key+'.html?v=20261111-r31',{cache:'no-store'});if(!response.ok)throw Error('Missing form');forms[key]=await response.text();
})).then(render).catch(()=>add(get('view'),'p','Start the portal using START_WINERY_PORTAL.bat.'));
