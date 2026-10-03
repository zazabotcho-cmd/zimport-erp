(function(){
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const groupNames={'heads-page':"Head's Page",'tender-niss':'Tenders','speciality-services':'Speciality Services / Private Orders',transportations:'Transportations','po-section':"POs and Order Forms",'country-sourcing':'Country Sourcing','invoice-calculator-section':'Invoice Calculator','internal-mail-section':'Internal Mail','recycle-section':'Recycling Bin','setting-section':'Settings'};
 let users=[],busy=false;
 function msg(text,kind=''){for(const id of ['adminUserMessage','userFormMessage']){const el=$(id);if(el){el.textContent=text;el.className='admin-user-message '+kind;}}if(kind==='error'&&!$('newUserFormPanel').classList.contains('hidden'))$('userFormMessage')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
 function isAdmin(){return window.ZimportOnline?.profile?.role==='admin'&&window.ZimportOnline.profile.active!==false;}
 async function call(action,payload={}){
  if(!isAdmin())throw Error('Administrator access only.');
  const client=window.ZimportOnline?.client;if(!client)throw Error('Cloud connection is not ready.');
  const {data,error}=await client.functions.invoke('manage-users',{body:{action,...payload}});
  if(error){let message=error.message;try{const body=await error.context.json();message=body.error||message;}catch{}throw Error(message);}
  if(data?.error)throw Error(data.error);return data;
 }
 function ensureCountryPages(){const inputs=[...$('newUserPageAccess').querySelectorAll('[data-user-page]')].filter(e=>e.dataset.userPage.startsWith('country-')&&!e.disabled);if(!inputs.some(e=>e.checked))inputs.forEach(e=>e.checked=true);}
 function pageBoxes(selected=[]){
  const groups={};for(const p of window.ZimportPermissions.catalog)(groups[p.group]??=[]).push(p);
  $('newUserPageAccess').innerHTML=Object.entries(groups).map(([group,pages])=>`<fieldset style="border:1px solid #cbd5e1;border-radius:8px"><legend>${esc(groupNames[group]||group)}</legend>${group==='country-sourcing'?`<p class="note">Registered Countries</p><div id="newUserCountryAccess"></div><hr><p class="note">Pages in Selected Countries — automatically selected when you mark a country or supplier; uncheck pages to limit access.</p>`:''}${pages.map(p=>`<label style="display:flex;gap:8px;align-items:center;margin:9px 0"><input style="width:auto;margin:0" type="checkbox" data-user-page="${esc(p.id)}" ${selected.includes(p.id)?'checked':''} ${['users','settings','program-settings','heads-recycle-bin'].includes(p.id)?'disabled':''}>${esc(p.label)}${['users','settings','program-settings','heads-recycle-bin'].includes(p.id)?' (Administrator only)':''}</label>`).join('')}</fieldset>`).join('');
  const countries=window.getRegisteredSourcingCountries?.()||[];
  const suppliers=window.getRegisteredSourcingSuppliers?.()||[];
  $('newUserCountryAccess').innerHTML=countries.map(country=>`<div style="margin:12px 0"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" style="width:auto;margin:0" data-user-country="${esc(country)}">${esc(country)}</label><div style="margin:8px 0 8px 24px"><small>Suppliers</small>${suppliers.filter(s=>s.country===country).map(s=>`<label style="display:flex;align-items:center;gap:8px;margin:7px 0"><input type="checkbox" style="width:auto;margin:0" data-user-supplier="${esc(s.id)}" data-supplier-country="${esc(country)}">${esc(s.name||s.id)}</label>`).join('')||'<p class="note">No registered suppliers in this country.</p>'}</div></div>`).join('')||'<p>No registered countries.</p>';
  $('newUserPageAccess').querySelectorAll('[data-user-country]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)ensureCountryPages();$('newUserPageAccess').querySelectorAll('[data-user-supplier]').forEach(s=>{if(s.dataset.supplierCountry===input.dataset.userCountry)s.checked=input.checked;});}));
  $('newUserPageAccess').querySelectorAll('[data-user-supplier]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)ensureCountryPages();if(input.checked)$('newUserPageAccess').querySelectorAll('[data-user-country]').forEach(c=>{if(c.dataset.userCountry===input.dataset.supplierCountry)c.checked=true;});}));
  roleChanged();
 }
 function roleChanged(){const admin=$('newUserRole').value==='admin';$('newUserPageAccess').querySelectorAll('[data-user-page]').forEach(e=>{const reserved=['users','settings','program-settings','heads-recycle-bin'].includes(e.dataset.userPage);e.disabled=admin||reserved;if(admin)e.checked=true;else if(reserved)e.checked=false;});$('newUserPageAccess').querySelectorAll('[data-user-country],[data-user-supplier]').forEach(e=>{e.disabled=admin;if(admin)e.checked=true;});}
 function openForm(user=null){
  if(!isAdmin())return;
  $('createProgramUser').reset();msg('');$('editProgramUserId').value=user?.id||'';
  $('newUserName').value=user?.full_name||'';$('newUserUsername').value=user?.username||'';$('newUserEmail').value=user?.email||'';$('newUserEmail').readOnly=!!user;
  $('newUserRole').value=user?.role||'worker';$('newUserPassword').required=!user;
  $('userPasswordHint').textContent=user?'Leave blank to keep the current password.':'At least 10 characters. Passwords are never included in invitation emails.';
  $('newUserInvite').checked=false;$('newUserInvite').disabled=!!user;
  $('userFormTitle').textContent=user?'Edit User and Page Access':'Create New User';$('saveProgramUser').textContent=user?'Save User':'Create New User';
  pageBoxes(user?.allowed_pages||[]);$('newUserPageAccess').querySelectorAll('[data-user-country]').forEach(e=>e.checked=user?.role==='admin'||(user?.allowed_countries||[]).includes(e.dataset.userCountry));$('newUserPageAccess').querySelectorAll('[data-user-supplier]').forEach(e=>e.checked=user?.role==='admin'||(user?.allowed_supplier_ids||[]).includes(e.dataset.userSupplier));$('newUserFormPanel').classList.remove('hidden');$('newUserName').focus();
 }
 function renderUsers(){
  const body=$('adminUsersBody');body.replaceChildren();
  for(const u of users){
   const tr=document.createElement('tr');
   for(const value of [u.full_name||'',u.username||'',u.email||'',({'partner_supplier':'Partner Supplier','worker':'Worker','manager':'Manager','readonly':'Read Only','admin':'Administrator'}[u.role]||u.role),u.role==='admin'?'All pages':Array.isArray(u.allowed_pages)?[...u.allowed_pages.map(id=>window.ZimportPermissions.catalog.find(p=>p.id===id)?.label||id),...(u.allowed_countries||[]).map(c=>'Country: '+c),...(u.allowed_supplier_ids||[]).map(id=>'Supplier: '+(window.getRegisteredSourcingSuppliers?.().find(s=>s.id===id)?.name||id))].join(', ')||'No pages assigned':'Existing access']){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   const active=document.createElement('td');active.textContent=u.active?'Yes':'No';tr.append(active);
   const actions=document.createElement('td');
   for(const [label,handler]of [ ['Edit / Page Access',()=>openForm(u)], ['Send Invitation',()=>action('send_invitation',{user_id:u.id},'Invitation sign-in email sent.')], ['Reset Password',()=>action('reset_password',{user_id:u.id},'Password reset email sent.')], ['Delete User',()=>{if(confirm('Delete user '+(u.username||u.email)+'? This removes the account and its sign-in access. Existing business records will be kept.'))return action('delete',{user_id:u.id},'User deleted. Existing business records kept.');}], [u.active?'Deactivate':'Activate',()=>action('update',{user_id:u.id,active:!u.active},'User status updated.')] ]){
    const b=document.createElement('button');b.type='button';b.className=label==='Delete User'?'danger small':'secondary small';b.textContent=label;if(label==='Delete User'&&u.id===window.ZimportOnline?.user?.id){b.disabled=true;b.title='You cannot delete your own account.';}b.style.margin='3px';b.addEventListener('click',handler);actions.append(b);
   }tr.append(actions);body.append(tr);
  }
  if(!users.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='No users found.';tr.append(td);body.append(tr);}
 }
 async function loadUsers(clearMessage=true){
  $('adminUserPanel').style.display=isAdmin()?'':'none';$('openCreateUser').disabled=!isAdmin();
  if(!isAdmin())return; if(clearMessage)msg('Loading users…');
  try{const result=await call('list');users=result.users||[];renderUsers();if(clearMessage)msg('');}catch(e){msg(e.message,'error');}
 }
 async function action(name,payload,success){if(busy)return;busy=true;msg('Working…');try{await call(name,{...payload,redirect_to:location.origin+location.pathname});await loadUsers(false);msg(success,'success');}catch(e){msg(e.message,'error');}finally{busy=false;}}
 function init(){
  $('openCreateUser').addEventListener('click',()=>openForm());$('cancelCreateUser').addEventListener('click',()=>$('newUserFormPanel').classList.add('hidden'));
  $('newUserRole').addEventListener('change',roleChanged);
  $('selectAllUserPages').addEventListener('click',()=>$('newUserPageAccess').querySelectorAll('input:not(:disabled)').forEach(e=>e.checked=true));
  $('clearUserPages').addEventListener('click',()=>$('newUserPageAccess').querySelectorAll('input:not(:disabled)').forEach(e=>e.checked=false));
  $('createProgramUser').addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;
   const id=$('editProgramUserId').value;
   const invalid=(field,message)=>{msg(message,'error');$(field).focus();};
   if(!$('newUserName').value.trim()){invalid('newUserName','Enter the user’s full name.');return;}
   if(!/^[A-Za-z0-9_.-]{3,40}$/.test($('newUserUsername').value.trim())){invalid('newUserUsername','Enter a username with 3–40 letters, numbers, dots, underscores or hyphens.');return;}
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('newUserEmail').value.trim())){invalid('newUserEmail','Enter a valid email address.');return;}
   const password=$('newUserPassword').value;
   if((!id||password)&&password.length<10){invalid('newUserPassword','Password must contain at least 10 characters. Choose a strong, unique password.');return;}
   if(!isAdmin()){msg('Sign in as an administrator to create or edit users.','error');return;}

   let pages=[...$('newUserPageAccess').querySelectorAll('[data-user-page]:checked')].map(e=>e.dataset.userPage);
   const scopeSelected=$('newUserPageAccess').querySelector('[data-user-country]:checked,[data-user-supplier]:checked');
   if(!pages.length&&scopeSelected){ensureCountryPages();pages=[...$('newUserPageAccess').querySelectorAll('[data-user-page]:checked')].map(e=>e.dataset.userPage);}
   if($('newUserRole').value!=='admin'&&!pages.length){msg('Select at least one page for this user.','error');return;}
   const countries=[...$('newUserPageAccess').querySelectorAll('[data-user-country]:checked')].map(e=>e.dataset.userCountry);
   if($('newUserRole').value!=='admin'&&pages.some(id=>id.startsWith('country-'))&&!countries.length){msg('Select at least one registered country for Country Sourcing access.','error');return;}
   countries.forEach(country=>{const available=[...$('newUserPageAccess').querySelectorAll('[data-user-supplier]')].filter(e=>e.dataset.supplierCountry===country);if(available.length&&!available.some(e=>e.checked))available.forEach(e=>e.checked=true);});
   const suppliers=[...$('newUserPageAccess').querySelectorAll('[data-user-supplier]:checked')].filter(e=>countries.includes(e.dataset.supplierCountry)).map(e=>e.dataset.userSupplier);
   if($('newUserRole').value!=='admin'&&pages.some(id=>id.startsWith('country-'))&&countries.some(country=>{const available=[...$('newUserPageAccess').querySelectorAll('[data-user-supplier]')].filter(e=>e.dataset.supplierCountry===country);return available.length&&!available.some(e=>e.checked);})){msg('Select at least one supplier beneath each selected country.','error');return;}
   const payload={allowed_supplier_ids:suppliers,allowed_countries:countries,email:$('newUserEmail').value.trim(),username:$('newUserUsername').value.trim(),full_name:$('newUserName').value.trim(),role:$('newUserRole').value,allowed_pages:pages,send_invitation:$('newUserInvite').checked,redirect_to:location.origin+location.pathname};
   if($('newUserPassword').value)payload.password=$('newUserPassword').value;
   if(id)payload.user_id=id;
   busy=true;$('saveProgramUser').disabled=true;msg(id?'Saving user…':'Creating user…');
   try{const result=await call(id?'update':'create',payload);$('newUserPassword').value='';$('newUserFormPanel').classList.add('hidden');await loadUsers(false);msg(result.message||(id?'User and page access saved.':'User created.'),'success');}catch(err){msg(err.message,'error');}finally{busy=false;$('saveProgramUser').disabled=false;}
  });
  $('refreshProgramUsers').addEventListener('click',()=>loadUsers());
  window.addEventListener('zimport-online-role',()=>loadUsers());
  document.querySelector('[data-tab="users"]')?.addEventListener('click',()=>loadUsers());
  loadUsers();
 }
 window.ZimportAdmin={loadUsers};window.addEventListener('DOMContentLoaded',init);
})();
