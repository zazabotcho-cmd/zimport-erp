// Read-only statistics over active and archived transportation records.
function statisticsDate(value){const text=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function statisticsInRange(date,from,to){if(!from&&!to)return true;return !!date&&(!from||date>=from)&&(!to||date<=to);}
function statisticsTransportationRecords(data){
 const byId=new Map();for(const sh of [...(data.archivedShipments||[]),...(data.shipments||[])])if(sh?.id)byId.set(String(sh.id),sh);
 const all=[...byId.values()],transports=all.filter(sh=>sh.recordKind==='transportation');
 const assigned=new Set(transports.flatMap(sh=>(sh.cargoLinks||[]).map(link=>String(link.cargoId))));
 return all.filter(sh=>sh.recordKind==='transportation'||!assigned.has(String(sh.id)));
}
function statisticsPoLines(data,sh){
 const allCargo=[...(data.shipments||[]),...(data.archivedShipments||[])];
 const links=sh.recordKind==='transportation'&&sh.cargoLinks?.length?sh.cargoLinks.flatMap(link=>{const cargo=allCargo.find(c=>String(c.id)===String(link.cargoId))||link.snapshot;return cargo?.poLinks||[];}):(sh.poLinks||[]);
 const seen=new Set();return links.filter(link=>{const key=String(link.poId||link.poNumber||link.number||'');if(!key||seen.has(key))return false;seen.add(key);return true;}).map(link=>{
 const po=[...(data.purchaseOrders||[]),...(data.manuallyArchivedPurchaseOrders||[]),...(data.inventoryDeletedPoSnapshots||[])].find(p=>String(p.id)===String(link.poId))||link.snapshot||link;
 const lines=po.lines||po.items||[];
 const bottles=lines.reduce((sum,line)=>sum+(line.bottleQuantity!==''&&line.bottleQuantity!=null?num(line.bottleQuantity):num(line.totalQuantity)*num(line.unitsPerCase)),0);
 const vendor=(po.vendors||po.supplierNames||[po.vendor||po.supplierName||'']).filter(Boolean).join(', ')||'Unassigned vendor';
 return {key:String(link.poId||link.poNumber||link.number),number:po.number||link.poNumber||'—',bottles,vendor,missing:!lines.length};
 });
}
function calculateEntireStatistics(data,filters){
 const arrived=new Set(['Arrived in Canada','CLEARED OUT FROM THE WAREHOUSE','LCBO PAYED']);
 const statuses=new Set(filters.statuses),records=statisticsTransportationRecords(data);
 const statusOf=sh=>normalizeSharedShipmentStatus(sh.status||'Not Contacted to Transporter');
 const eligible=records.filter(sh=>statuses.has(statusOf(sh)));
 const dateOf=sh=>statisticsDate(filters.dateBasis==='pickup'?sh.pickupDate:filters.dateBasis==='status'?sh.statusDate:sh.deliveryDate);
 const rowCandidates=eligible.filter(sh=>statisticsInRange(dateOf(sh),filters.from,filters.to));
 // Attribute a PO to its latest eligible transportation; keep duplicate assignments visible, but count its bottles only once.
 const seen=new Set(),rows=[],vendorTotals=new Map(),statusTotals=new Map();let missingPos=0,duplicateBottles=0;
 rowCandidates.sort((a,b)=>dateOf(b).localeCompare(dateOf(a))||String(a.id).localeCompare(String(b.id)));
 for(const sh of rowCandidates){let bottles=0,duplicate=0;const pos=statisticsPoLines(data,sh);for(const po of pos){if(po.missing)missingPos++;if(seen.has(po.key)){duplicate+=po.bottles;continue;}seen.add(po.key);bottles+=po.bottles;vendorTotals.set(po.vendor,(vendorTotals.get(po.vendor)||0)+po.bottles);}duplicateBottles+=duplicate;
 const status=statusOf(sh);statusTotals.set(status,(statusTotals.get(status)||0)+bottles);rows.push({sh,date:dateOf(sh),status,bottles,duplicate,pos});}
 const payments=eligible.filter(sh=>['paid','fully paid'].includes(String(sh.paymentStatus||'').trim().toLowerCase())&&statisticsInRange(statisticsDate(sh.payDate),filters.from,filters.to)).map(sh=>{
 const currency=sh.currency||'CAD',rate=num(sh.exchangeRate),amount=num(sh.cost);return {sh,date:statisticsDate(sh.payDate),currency,amount,cad:currency==='CAD'?amount:rate>0?amount/rate:null};});
 const missingPaymentDates=eligible.filter(sh=>['paid','fully paid'].includes(String(sh.paymentStatus||'').trim().toLowerCase())&&!statisticsDate(sh.payDate)).length;
 const missingDates=eligible.filter(sh=>!dateOf(sh)).length;
 const currencies=new Map();for(const p of payments)currencies.set(p.currency,(currencies.get(p.currency)||0)+p.amount);
 return {rows,payments,bottles:rows.reduce((sum,r)=>sum+r.bottles,0),importedBottles:rows.filter(r=>arrived.has(r.status)).reduce((sum,r)=>sum+r.bottles,0),paidCad:payments.reduce((sum,p)=>sum+(p.cad??0),0),missingFx:payments.filter(p=>p.cad===null).length,missingPaymentDates,missingDates,missingPos,duplicateBottles,statusTotals:[...statusTotals],vendorTotals:[...vendorTotals],currencies:[...currencies]};
}
function renderEntireStatistics(){
 const root=document.getElementById('entire-statistics');if(!root)return;
 const statusesBox=document.getElementById('statisticsStatusOptions');
 const known=[...new Set([...TRANSPORT_SYNC_STATUSES,'CLEARED OUT FROM THE WAREHOUSE','LCBO PAYED',...statisticsTransportationRecords(state).map(sh=>normalizeSharedShipmentStatus(sh.status||'Not Contacted to Transporter'))])];
 const old=new Map([...statusesBox.querySelectorAll('input')].map(el=>[el.value,el.checked]));
 if(known.some(status=>!old.has(status))||old.size!==known.length)statusesBox.innerHTML=known.map(status=>`<label class="statistics-status-option"><input type="checkbox" value="${escapeHtml(status)}" ${old.has(status)?(old.get(status)?'checked':''):(['Arrived in Canada','CLEARED OUT FROM THE WAREHOUSE','LCBO PAYED'].includes(status)?'checked':'')} onchange="renderEntireStatistics()">${escapeHtml(status)}</label>`).join('');
 const from=document.getElementById('statisticsFrom').value,to=document.getElementById('statisticsTo').value,notice=document.getElementById('statisticsNotice');
 if(from&&to&&from>to){notice.textContent='From date must be on or before To date.';document.getElementById('statisticsResults').hidden=true;return;}
 document.getElementById('statisticsResults').hidden=false;
 const result=calculateEntireStatistics(state,{from,to,dateBasis:document.getElementById('statisticsDateBasis').value,statuses:[...statusesBox.querySelectorAll('input:checked')].map(el=>el.value)});
 document.getElementById('statisticsBottleTotal').textContent=result.bottles.toLocaleString();document.getElementById('statisticsImportedTotal').textContent=result.importedBottles.toLocaleString();document.getElementById('statisticsTransportTotal').textContent=result.rows.length.toLocaleString();document.getElementById('statisticsPaidTotal').textContent='CAD '+result.paidCad.toFixed(2)+(result.missingFx?' (partial)':'');
 const notes=[];if(result.missingDates)notes.push(result.missingDates+' transportation(s) have no selected date'+(from||to?' and are excluded from bottle totals.':'.'));if(result.missingPaymentDates)notes.push(result.missingPaymentDates+' paid transportation(s) have no pay date'+(from||to?' and are excluded from payments.':'.'));if(result.missingFx)notes.push(result.missingFx+' payment(s) need an exchange rate to be included in the CAD total.');if(result.missingPos)notes.push(result.missingPos+' PO link(s) have no saved bottle quantities.');if(result.duplicateBottles)notes.push(result.duplicateBottles.toLocaleString()+' bottles were assigned more than once and counted only once.');notice.textContent=notes.join(' ');
 const simple=(id,rows)=>document.getElementById(id).innerHTML=rows.map(([label,count])=>`<tr><td>${escapeHtml(label)}</td><td><b>${count.toLocaleString()}</b></td></tr>`).join('')||'<tr><td colspan="2">No matching records.</td></tr>';
 simple('statisticsStatusRows',result.statusTotals);simple('statisticsVendorRows',result.vendorTotals);
 document.getElementById('statisticsCurrencyTotals').textContent=result.currencies.map(([currency,amount])=>currency+' '+amount.toFixed(2)).join(' · ')||'No paid transportation invoices in the selected period.';
 document.getElementById('statisticsTransportRows').innerHTML=result.rows.map(r=>`<tr><td>${escapeHtml(r.sh.name||'—')}${r.sh.recordKind!=='transportation'?'<br><small>Legacy / unlinked cargo</small>':''}</td><td>${escapeHtml(r.date||'No date')}</td><td>${escapeHtml(r.status)}</td><td>${r.pos.map(po=>escapeHtml(po.number)).join('<br>')||'—'}</td><td>${r.bottles.toLocaleString()}${r.duplicate?'<br><small>Duplicate bottles excluded: '+r.duplicate.toLocaleString()+'</small>':''}</td><td>${num(r.sh.palletQty).toLocaleString()}</td><td>${escapeHtml(r.sh.paymentStatus||'Not Paid')}</td></tr>`).join('')||'<tr><td colspan="7">No matching transportations.</td></tr>';
 document.getElementById('statisticsPaymentRows').innerHTML=result.payments.map(p=>`<tr><td>${escapeHtml(p.sh.name||'—')}</td><td>${escapeHtml(p.sh.company||'—')}</td><td>${escapeHtml(p.date||'No pay date')}</td><td>${escapeHtml(p.currency)} ${p.amount.toFixed(2)}</td><td>${p.cad===null?'Exchange rate needed':'CAD '+p.cad.toFixed(2)}</td></tr>`).join('')||'<tr><td colspan="5">No paid transportation invoices in this period.</td></tr>';
}
function markStatisticsStatuses(checked){document.querySelectorAll('#statisticsStatusOptions input').forEach(el=>el.checked=checked);renderEntireStatistics();}
function resetEntireStatistics(){document.getElementById('statisticsFrom').value='';document.getElementById('statisticsTo').value='';document.getElementById('statisticsDateBasis').value='delivery';document.querySelectorAll('#statisticsStatusOptions input').forEach(el=>el.checked=['Arrived in Canada','CLEARED OUT FROM THE WAREHOUSE','LCBO PAYED'].includes(el.value));renderEntireStatistics();}
renderEntireStatistics();
