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
 return {po,key:String(link.poId||link.poNumber||link.number),number:po.number||link.poNumber||'—',bottles,vendor,missing:!lines.length};
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
 renderStatisticsProfit(state,{from,to,statuses:[...statusesBox.querySelectorAll('input:checked')].map(el=>el.value)});
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

function statisticsYearToDate(){
 const now=new Date(),today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
 document.getElementById('statisticsFrom').value=now.getFullYear()+'-01-01';document.getElementById('statisticsTo').value=today;
 document.getElementById('statisticsDateBasis').value='delivery';
 document.querySelectorAll('#statisticsStatusOptions input').forEach(el=>el.checked=['Arrived in Canada','CLEARED OUT FROM THE WAREHOUSE','LCBO PAYED'].includes(el.value));renderEntireStatistics();
}
function calculateStatisticsProfit(data,filters){
 const arrived=new Set(['Arrived in Canada','CLEARED OUT FROM THE WAREHOUSE','LCBO PAYED']),selected=new Set(filters.statuses);
 const invoices=[...(data.financialInvoices||[]),...(data.archivedInvoices||[]).filter(x=>x.sourceType==='Tender').map(x=>x.data).filter(Boolean)];
 const present=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v));
 const cad=(amount,currency,rate)=>!present(amount)?null:(!currency||currency==='CAD'?num(amount):(num(rate)>0?num(amount)/num(rate):null));
 const candidates=[];
 for(const sh of statisticsTransportationRecords(data)){
  const status=normalizeSharedShipmentStatus(sh.status||'');if(!arrived.has(status)||!selected.has(status))continue;
  const pos=statisticsPoLines(data,sh),denominator=pos.reduce((sum,x)=>sum+x.bottles,0);
  const transport=cad(sh.cost,sh.currency,sh.exchangeRate);
  for(const entry of pos){const po=entry.po;
   const inv=invoices.find(x=>String(x.sourcePoId||'')===String(po.id)&&po.id)||invoices.find(x=>String(x.poNumber||'').trim()===String(po.number||'').trim()&&po.number);
   // Status date is the actual arrival date in this program. Never use an approximate Canada date.
   const date=statisticsDate(inv?.arrivedInCanadaDate||po.inventoryArrivalStatusDate||po.arrivedInCanadaDate||(status==='Arrived in Canada'?sh.statusDate:'')||sh.arrivedInCanadaDate);
   candidates.push({entry,po,inv,sh,date,transport,denominator});
  }
 }
 candidates.sort((a,b)=>b.date.localeCompare(a.date)||String(a.sh.id).localeCompare(String(b.sh.id)));
 const seen=new Set(),rows=[];let duplicates=0,missingDates=0;
 for(const x of candidates){if(seen.has(x.entry.key)){duplicates++;continue;}seen.add(x.entry.key);
  if(!x.date){missingDates++;continue;}if(!statisticsInRange(x.date,filters.from,filters.to))continue;
  const {po,inv,entry}=x,lines=po.lines||po.items||[],problems=[];
  let revenue=0,supplier=0,expenses=0;
  if(inv){revenue=cad(inv.lcboInvoiceCad,inv.lcboCurrency,inv.lcboRate);supplier=cad(inv.supplierItemPrice??inv.supplierItemUsd,inv.supplierCurrency,inv.supplierRate);if(supplier!==null)supplier*=entry.bottles;
   expenses=['nettedAmount1','nettedAmount2','nettedAmount3','adAmount1','adAmount2','adAmount3','adAmount4','adAmount5','adAmount6','otherExpenseAmount'].reduce((sum,k)=>sum+num(inv[k]),0)+num(revenue)*num(inv.failedSalesPercent)/100;
  }else{
   for(let i=0;i<lines.length;i++){const line=lines[i],bottles=present(line.bottleQuantity)?num(line.bottleQuantity):num(line.totalQuantity)*num(line.unitsPerCase);
    const key=typeof profitCalcKey==='function'?profitCalcKey(po,line,i):po.id+'::'+(line.itemNo||line.yearProductName||i);
    let saved=data.profitItemCalculator?.[key];
    const copy=Object.values(data.financialProfitPageData||{}).find(page=>String(page.transportationId)===String(x.sh.id)&&present(page.rows?.[key]?.supplierBottlePrice));if(copy)saved=copy.rows[key];
    const item=(data.items||[]).find(it=>line.itemNo&&String(it.lcboItemNumber)===String(line.itemNo));
    const r=cad(line.quotedPricePerCase,po.currency||po.quotationCurrency,po.exchangeRate);if(r===null)revenue=null;else if(revenue!==null)revenue+=r*num(line.totalQuantity);
    let unit=present(saved?.supplierBottlePrice)?cad(saved.supplierBottlePrice,saved.currency,saved.cadToSupplierCurrency):null;
    if(unit===null&&item){const price=item.supplierPricePerOfferedCase??item.supplierCasePriceReference,units=item.supplierItemsPerCase??item.sellingUnitsPerShippingCase;
     const currency=item.supplierCurrencyReference||item.quotationCurrency||'CAD';const rate=currency==='CAD'?1:(typeof currencyToCadRate==='function'?1/currencyToCadRate(currency):0);
     const value=cad(price,currency,rate);if(value!==null&&num(units)>0)unit=value/num(units);}
    if(unit===null)supplier=null;else if(supplier!==null)supplier+=unit*bottles;expenses+=num(saved?.labOther);
   }
  }
  const transport=x.transport!==null&&x.denominator>0?x.transport*entry.bottles/x.denominator:null;
  if(!lines.length||entry.bottles<=0)problems.push('Missing PO quantities');if(revenue===null)problems.push('Missing revenue or exchange rate');if(supplier===null)problems.push('Missing supplier price or exchange rate');if(transport===null)problems.push('Missing transportation cost, quantities or exchange rate');
  const complete=!problems.length;rows.push({...x,revenue,supplier,expenses,relatedTransport:transport,complete,problems,profit:complete?revenue-supplier-transport-expenses:null});
 }
 const totals={revenue:0,supplier:0,relatedTransport:0,expenses:0,profit:0};for(const row of rows.filter(x=>x.complete))for(const k of Object.keys(totals))totals[k]+=row[k];
 return {rows,totals,missingDates,duplicates,incomplete:rows.filter(x=>!x.complete).length};
}
function renderStatisticsProfit(data,filters){
 const result=calculateStatisticsProfit(data,filters),fmt=v=>v===null?'—':'CAD '+v.toFixed(2);
 for(const [id,key] of [['statisticsRevenue','revenue'],['statisticsSupplier','supplier'],['statisticsRelatedTransport','relatedTransport'],['statisticsExpenses','expenses'],['statisticsProfit','profit']])document.getElementById(id).textContent=fmt(result.totals[key])+(result.incomplete||result.missingDates?' (partial)':'');
 document.getElementById('statisticsProfitNotice').textContent=result.rows.filter(x=>x.complete).length+' complete PO(s) included. '+result.incomplete+' PO(s) with missing financial data excluded from all totals. '+result.missingDates+' PO(s) missing an actual LCBO arrival date excluded. '+result.duplicates+' duplicate PO assignment(s) counted once. Transportation is allocated by bottle quantity across the entire transportation. Complete missing prices in the invoice or profit calculator; amounts of zero must be saved explicitly. Only recorded expenses are deducted.';
 document.getElementById('statisticsProfitRows').innerHTML=result.rows.map(r=>`<tr><td>${escapeHtml(r.entry.number)}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.sh.name||'—')}</td><td>${fmt(r.revenue)}</td><td>${fmt(r.supplier)}</td><td>${fmt(r.relatedTransport)}</td><td>${fmt(r.expenses)}</td><td><b>${fmt(r.profit)}</b></td><td>${escapeHtml(r.complete?'Included':r.problems.join('; '))}</td></tr>`).join('')||'<tr><td colspan="9">No arrived POs in the selected period and marked statuses.</td></tr>';
}
