'use strict';

let wineryOfferImportRunning = false;
const publishedWineryStatuses = new Map();
async function importApprovedWineryOffers() {
 if (wineryOfferImportRunning || !isAdminUser() || location.origin !== 'http://127.0.0.1:8000') return;
 wineryOfferImportRunning = true;
 const cacheKey = DATA_KEY;
 try {
  const response = await fetch('http://127.0.0.1:8091/approved-offers', {cache:'no-store'});
  if (!response.ok || cacheKey !== DATA_KEY || !isAdminUser()) return;
  const offers = await response.json();
  if (!Array.isArray(offers) || cacheKey !== DATA_KEY || !isAdminUser()) return;
  const imported = new Set(state.wineryImportedOffers || []);
  const fields = ['itemName','supplier','tenderName','tenderId','tenderDate','productNeeds',
   'productType','offeredQuote','offeredQuoteCurrency','bottles','caseKg'];
  let added = false;
  for (const offer of offers) {
   if (!offer?.key || !offer.itemName || imported.has(offer.key)) continue;
   const record = defaults();
   for (const field of fields) if (typeof offer[field] === 'string' && offer[field]) record[field] = offer[field];
   record.id = uid();
   record.wineryOfferKey = offer.key;
   state.records.push(record);
   imported.add(offer.key);
   added = true;
  }
  if (added) {
   state.wineryImportedOffers = [...imported];
   save();
  }
  const updates = Object.create(null);
  for (const record of state.records) {
   if (!record.wineryOfferKey) continue;
   const status = record.submissionStatus || '';
   if (publishedWineryStatuses.get(record.wineryOfferKey) !== status) updates[record.wineryOfferKey] = status;
  }
  if (Object.keys(updates).length) {
   const published = await fetch('http://127.0.0.1:8091/submission-status', {
    method:'POST', body:JSON.stringify(updates)
   });
   if (published.ok) for (const [key,status] of Object.entries(updates)) publishedWineryStatuses.set(key,status);
  }

 } catch (error) {
  if (!(error instanceof TypeError)) console.warn('Winery offer import:', error);
 } finally {
  wineryOfferImportRunning = false;
 }
}
setInterval(importApprovedWineryOffers, 5000);
