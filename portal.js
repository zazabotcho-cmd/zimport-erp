'use strict';
const get=id=>document.getElementById(id);
const db=JSON.parse(localStorage.getItem('winglobal-portal-demo')||'{"wineries":[],"items":[],"tenders":[],"offers":[],"messages":[]}');
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
 'c_score',
 'c_scoreSource','c_scoreSourceOther','c_awards','c_pressCoverage','portalWebsites',
 'c_packageMaterial','c_packageWeightG','c_stopperType','c_stopperWeightG',
 'itCanBottlesPerCase','itCanPromotionalSupportPercent','itCanPromotionalSupportAmount'
];
function tenderUpdateForm(){
 const template=document.createElement('template');
 template.innerHTML=forms.item;
 const source=template.content;
 const section=source.querySelector('fieldset').cloneNode(false);
 add(section,'legend','Vintage, submission and packaging details');
 const firstRow=add(section,'div');firstRow.className='submission-details-row tender-identification-row';
 for(const key of ['c_vintage','c_limitedCaseQty','c_upcNumber','c_sccNumber']){
  firstRow.append(source.getElementById(key).closest('label'));
 }
 const grid=add(section,'div');grid.className='form-grid three';
 for(const key of tenderUpdateFields)grid.append(source.getElementById(key).closest('label'));
 const attachments=source.getElementById('c_attachments').parentElement;
 const caseAndPallet=Array.from(source.querySelectorAll('fieldset')).find(group=>group.querySelector('#c_caseLengthCm'));
 caseAndPallet.querySelector('.case-volume-column').remove();
 return section.outerHTML+caseAndPallet.outerHTML+attachments.outerHTML;
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
 const currency=data.itCanCurrency||'';
 const hasQuote=quote>0&&Number.isFinite(quote);
 percent.disabled=!hasQuote;
 amount.disabled=!hasQuote;
 amount.readOnly=false;
 amount.step='any';
 form.querySelector('#itCanPromotionalSupportCurrency').textContent=currency;
 const description=amount.closest('label').querySelector('small');
 description.textContent=hasQuote
  ? 'Based on the approved case quote of '+quote.toFixed(2)+(currency?' '+currency:'')+'. When both promo fields are unlocked, editing either recalculates the other.'
  : 'An approved case quote greater than zero is needed to calculate promo support.';
 if(!hasQuote)return;
 const asAmount=rate=>Number((quote*rate/100).toFixed(2));
 const min=asAmount(2), max=asAmount(15);
 amount.min=min;
 amount.max=max;
 percent.step='any';
 percent.oninput=()=>{
  if(amount.disabled)return;
  amount.value=percent.value===''?'':asAmount(Number(percent.value)).toFixed(2);
 };
 amount.oninput=()=>{
  if(percent.disabled)return;
  const value=Number(amount.value);
  percent.value=amount.value===''?'':value===min?2:value===max?15:Number((value/quote*100).toFixed(6));
 };
 if(percent.value!==''&&amount.value==='')percent.oninput();
 if(amount.value!==''&&percent.value==='')amount.oninput();
}
function form(root,key,data={},submit,readOnly=false){
 const f=add(root,'form');
 const tenderUpdate=key==='tenderUpdate';
 const fields=add(f,'fieldset');fields.innerHTML=tenderUpdate?tenderUpdateForm():forms[key];
 fields.disabled=readOnly;
 const keepControls={};
 const reviewFields=[];
 const keepPrevious=(input,label,update,hasUpdate)=>{
  const wrapper=el('div');
  label.before(wrapper);
  if(label.classList.contains('full'))wrapper.classList.add('full');
  wrapper.append(label);
  const choice=add(wrapper,'label');
  const keep=add(choice,'input');
  keep.type='checkbox';keep.style.width='auto';
  choice.append(' Same as approved/previous item');
  const fieldLabel=input.dataset.keepLabel||label.firstChild.textContent.trim();
  keep.setAttribute('aria-label','Same as approved/previous item — '+fieldLabel);
  reviewFields.push({keep,fieldLabel,hasUpdate});
  keepControls[input.name]=keep;
  const previous=add(wrapper,'small');
  previous.setAttribute('role','status');
  previous.style.whiteSpace='pre-wrap';
  previous.style.overflowWrap='anywhere';
  keep.onchange=()=>{
   update(keep.checked);
   previous.hidden=!keep.checked;
   if(!keep.checked){previous.textContent='';return}
   const saved=data[input.name];
   if(input.type==='file'){
    const count=saved?.length||0;
    previous.textContent=count?'Approved files: '+count:'No files on the approved item.';
    return;
   }
   const selectedLabel=input.tagName==='SELECT'&&saved
    ? [...input.options].find(option=>option.value===String(saved))?.textContent
    : null;
   previous.textContent=saved==null||String(saved).trim()===''
    ? 'No value on the approved item.'
    : 'Approved value: '+(selectedLabel||saved);
  };
  keep.onchange();
  return keep;
 };
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
   const exCellarDelivery=field('itCanExCellarDelivery');
   field('itCanExCellarDeliveryWrap').classList.toggle('hidden',quoteType.value!=='EX-CELLAR');
   exCellarDelivery.disabled=quoteType.value!=='EX-CELLAR';
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
   field('itCanPromotionalSupportCurrency').textContent=field('itCanCurrency').value||'—';
  };
  f.addEventListener('input',calculate);
  field('itCanCurrency').addEventListener('change',calculate);calculate();
 }
 if(tenderUpdate){
  configureTenderPromo(f,data);
  for(const input of fields.querySelectorAll('[name]')){
   if(input.type==='file'||input.readOnly)continue;
   const unavailable=input.disabled;
   const previousValue=input.value.trim();
   keepPrevious(input,input.closest('label'),keep=>{
    input.disabled=keep||unavailable;
    if(keep)input.value=previousValue;
   },()=>!unavailable&&input.value.trim()!==previousValue);
  }
 }
 const attachmentPickers=key==='item'
  ? [[attachmentKey,'italyCandidateAttachmentRows'],[awardAttachmentKey,'awardAttachmentRows']]
  : tenderUpdate?[[attachmentKey,'italyCandidateAttachmentRows']]:[];
 for(const [pickerId,rowsId] of attachmentPickers){
  const picker=field(pickerId);
  const rows=field(rowsId);
  let attachments=[...(data[pickerId]||[])];
  attachmentGroups[pickerId]=attachments;
  let attaching=false;
  let keepFiles;
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
    if(!readOnly&&!keepFiles?.checked)button(row,'Remove',()=>{
     if(attaching)return;
     attachments.splice(index,1);
     redraw();
    });
   });
  };
  picker.hidden=true;
  if(!readOnly){
   const attach=button(picker.parentNode,'Attach',()=>picker.click());
   if(tenderUpdate){
    picker.dataset.keepLabel='Supporting Photos / Documents';
    keepFiles=keepPrevious(picker,picker.parentElement.parentElement,keep=>{
     attach.disabled=keep||attaching;
     if(keep){
      attachments=[...(data[pickerId]||[])];
      attachmentGroups[pickerId]=attachments;
     }
    },()=>{
     const previous=data[pickerId]||[];
     return attachments.length!==previous.length||attachments.some((file,index)=>file!==previous[index]);
    });
    keepFiles.addEventListener('change',redraw);
   }
   picker.onchange=async()=>{
    const selected=[...picker.files];
    picker.value='';
    if(!selected.length||attaching||keepFiles?.checked)return;
    if(attachments.length+selected.length>10){alert('You can attach up to 10 files.');return}
    if(selected.some(file=>! /\.(pdf|jpe?g)$/i.test(file.name)||file.size>1000000||!file.size)){
     alert('Choose PDF, JPG or JPEG files up to 1 MB each.');return;
    }
    attaching=true;
    pendingAttachments++;
    attach.disabled=true;
    try{const files=await Promise.all(selected.map(readFile));if(!keepFiles?.checked)attachments.push(...files);redraw()}
    catch{alert('Could not read the selected files.')}
    finally{attaching=false;pendingAttachments--;attach.disabled=Boolean(keepFiles?.checked)}
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
   const unreviewed=reviewFields.find(({keep,hasUpdate})=>!keep.checked&&!hasUpdate());
   if(unreviewed){
    alert('For '+unreviewed.fieldLabel+', check “Same as approved/previous item” or enter an update before submitting.');
    unreviewed.keep.focus();
    return;
   }
   const attachments=attachmentGroups[attachmentKey];
   if(attachments.length<7||attachments.length>10){
    alert('Uncheck the box for Supporting Photos / Documents and attach 7 to 10 files before submitting.');
    return;
   }
   for(const [fieldName,value] of new FormData(f)){
    if(typeof value==='string'&&keepControls[fieldName]&&!keepControls[fieldName].checked)values[fieldName]=value.trim();
   }
   const dimensionFields=['c_caseLengthCm','c_caseWidthCm','c_caseHeightCm'];
   if(dimensionFields.some(key=>!keepControls[key].checked)){
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
function reviewTenderOffer(root,tender,item,picker){
 const existing=root.querySelector('.tender-offer-review');
 if(existing)existing.remove();
 const review=add(root,'div');review.className='tender-offer-review';
 add(review,'h3','Review '+name(item)+' for '+tender.title);
 add(review,'p','For each field, check Same as approved/previous item to keep its approved value, or enter an update for this tender.');
 form(review,'tenderUpdate',item.data,async data=>{
  const stillEligible=()=>item.owner===owner()&&item.status==='Approved'&&db.tenders.includes(tender)&&tender.status!=='Closed'&&
   tender.targets.includes(item.owner)&&!db.offers.some(offer=>offer.tender===tender.id&&offer.item===item.id);
  if(!stillEligible())throw Error('This item is no longer available for this tender.');
  const detailsId=id();
  await tenderOfferStorage('put',detailsId,data);
  const offer={owner:item.owner,tender:tender.id,item:item.id,detailsId,status:'Submitted'};
  try{
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
 button(review,'Cancel',()=>review.remove());
 picker.onchange=()=>review.remove();
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
function composeMail(root,to,subject=''){
 const existing=root.querySelector('.mail-compose');
 if(existing){existing.querySelector('input').focus();return}
 const sender=owner();
 const f=add(root,'form');f.className='mail-compose';
 add(f,'h3','To: '+(winery(to)?.data.itWinName||'Portal Administrator'));
 const subjectInput=add(add(f,'label','Subject'),'input');subjectInput.required=true;subjectInput.value=subject;
 const body=add(add(f,'label','Message'),'textarea');body.required=true;body.rows=5;
 add(f,'button','Send message').type='submit';
 button(f,'Cancel',()=>f.remove());
 const result=add(f,'p');result.setAttribute('role','status');
 f.onsubmit=event=>{
  event.preventDefault();
  if(!subjectInput.value.trim()||!body.value.trim()){result.textContent='Enter a subject and message.';return}
  change(()=>note(to,subjectInput.value.trim(),body.value.trim(),sender));
  const sent=add(get('view'),'p','Message sent in the portal.');sent.setAttribute('role','status');
 };
 subjectInput.focus();
}
const tenderFields=[
 ['code','Tender ID','input'],
 ['title','Tender Name','input'],
 ['productNeeds','Product Needs','select',['BEER','DEST COLLECTION','DUTY FREE','ECOMMERCE','ONE-ONE-ONE','READY TO DRINK','SPIRITS','VINTAGES','VINTAGES ADHOC','VINTAGES DIRECT','WINES','Other']],
 ['preSubmissionDate','Pre-Submission Date','date'],
 ['tastingDate','Tasting Date','date'],
 ['status','Status','select',['Active','Closed']],
 ['notes','Notes','textarea']
];
function showTenderFields(r,t){
  tenderFields.filter(([key])=>key!=='title').forEach(([key,label])=>{
   const value=t[key]??(key==='notes'?t.description:undefined);
   if(value)add(r,'p',label+': '+value);
  });
}
function renderTenderForm(root,tender){
  const action=tender?'Save Tender Changes':'Announce Tender';
  add(root,'p','Complete all required fields and select the suppliers who should see this tender.');
  const f=add(root,'form');
  const grid=add(f,'div');grid.className='form-grid';
  const controls=tenderFields.map(([key,label,kind,options])=>{
   const wrapper=add(grid,'label',label+' *');
   const input=add(wrapper,kind==='date'?'input':kind);
   if(kind==='date')input.type='date';
   if(options)input.replaceChildren(new Option('Select',''),...options.map(value=>new Option(value,value)));
   input.value=tender?.[key]??(key==='notes'?tender?.description:'')??'';
   input.required=true;
   return [key,input];
  });
  const recipients=db.wineries.filter(w=>w.approved).map(w=>{
   const label=add(f,'label',w.data.itWinName);const input=add(label,'input');input.type='checkbox';input.style.width='auto';input.value=w.id;input.checked=Boolean(tender?.targets.includes(w.id));return input;
  });
  add(f,'button',action).type='submit';
  if(tender)button(f,'Cancel',()=>render());
  f.onsubmit=event=>{event.preventDefault();
   if(!admin()||(tender&&!db.tenders.includes(tender)))return;
   const targets=recipients.filter(input=>input.checked).map(input=>input.value);
   const values=Object.fromEntries(controls.map(([key,input])=>[key,input.value.trim()]));
   if((!tender&&!targets.length)||Object.values(values).some(value=>!value)){alert('Complete all required fields and select at least one recipient.');return}
   if(db.tenders.some(t=>t!==tender&&t.code?.toLowerCase()===values.code.toLowerCase())){alert('This Tender ID already exists.');return}
   if(tender){
    change(()=>Object.assign(tender,values,{targets,seenBy:(tender.seenBy||[]).filter(id=>targets.includes(id))}));
    return;
   }
   const subject='New tender: '+values.title;
   const message=tenderFields.map(([key,label])=>label+': '+values[key]).join('\n');
   const announced={id:id(),...values,targets,seenBy:[]};
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
  button(add(card,'h3'),t.title,()=>{selectedAdminTenderId=t.id;render()});
  add(card,'p',[t.code,t.status].filter(Boolean).join(' · '));
 });
}
function render(){
 roles();
 const root=get('view'),nav=get('nav');root.replaceChildren();nav.replaceChildren();
 const tabs=admin()?['Announce Tender','Tender List','Active Tender Offers','Mail Inbox','Transfer Queue','My Information (Supplier)','Offer an Item']:
 owner()==='new'?['Register New Supplier']:['Tender List','My Active Tender Items','Mail Inbox','Recycle Bin','My Information (Supplier)','Approved Items','Offer an Item'];
 if(!tabs.includes(page))page=tabs[0];
 const newTenders=db.tenders.filter(t=>t.targets.includes(owner())&&t.seenBy&&!t.seenBy.includes(owner()));
 const supplierActions=add(nav,'div');supplierActions.className='supplier-actions';
 tabs.forEach(tab=>{const target=['My Information (Supplier)','Approved Items','Offer an Item'].includes(tab)?supplierActions:nav;
 const b=button(target,tab,()=>{page=tab;selectedAdminTenderId='';render()});if(tab==='Mail Inbox'){const unread=db.messages.filter(m=>m.to===owner()&&!m.read).length;if(unread)add(b,'span',' '+unread).className='badge'}if(tab==='Tender List'&&newTenders.length)add(b,'span','New Tender Announced').className='badge';b.setAttribute('aria-current',tab===page?'page':'false')});
 if(supplierActions.children.length)nav.appendChild(supplierActions);else supplierActions.remove();
 add(root,'h2',page);
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
 case 'Recycle Bin':list(root,own.filter(i=>i.status==='Discarded'),(r,i)=>{
  add(r,'h3',name(i));button(r,'Restore draft',()=>change(()=>{i.status='Draft'}));
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
  if(t.status==='Closed')return;
  const eligible=own.filter(i=>i.status==='Approved'&&!db.offers.some(o=>o.tender===t.id&&o.item===i.id));
  if(!eligible.length){add(r,'p','No approved items available to offer.');return}
  const pick=add(r,'select');eligible.forEach(i=>pick.add(new Option(name(i),i.id)));
  button(r,'Offer selected item',()=>reviewTenderOffer(r,t,eligible.find(item=>item.id===pick.value),pick));
 });break;
 case 'Active Tender Offers':list(root,db.offers,offerStatus);break;
 case 'My Active Tender Items':list(root,db.offers.filter(o=>o.owner===owner()),offerStatus);refreshMainSubmissionStatuses();break;
 case 'Mail Inbox':
  if(!admin())button(root,'Email Administrator',()=>composeMail(root,'admin'));
  list(root,db.messages.filter(m=>m.to===owner()),(r,m)=>{
   add(r,'h3',m.subject);
   add(r,'small','From: '+(winery(m.from)?.data.itWinName||'Portal Administrator'));
   if(!m.read)add(r,'span','NEW').className='badge';
   add(r,'p',m.body);
   if(!m.read)button(r,'Mark as read',()=>change(()=>{m.read=true}));
   if(admin()&&winery(m.from))button(r,'Reply',()=>composeMail(r,m.from,'Re: '+m.subject));
   button(r,'Delete',()=>{if(confirm('Delete this Mail Inbox message?'))change(()=>{db.messages=db.messages.filter(message=>message!==m)})});
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
 const response=await fetch(key+'.html');if(!response.ok)throw Error('Missing form');forms[key]=await response.text();
})).then(render).catch(()=>add(get('view'),'p','Start the portal using START_WINERY_PORTAL.bat.'));
