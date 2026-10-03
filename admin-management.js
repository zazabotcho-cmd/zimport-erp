(function(){
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const groupNames={'heads-page':"Head's Page",'tender-niss':'Tenders','speciality-services':'Speciality Services / Private Orders',transportations:'Transportations','po-section':"POs and Order Forms",'country-sourcing':'Country Sourcing','invoice-calculator-section':'Invoice Calculator','internal-mail-section':'Internal Mail','recycle-section':'Recycling Bin','setting-section':'Settings'};
 let users=[],busy=false;
 function msg(text,kind=''){const e=$('adminUserMessage');if(e){e.textContent=text;e.className='admin-user-message '+kind;}}
 function isAdmin(){return window.ZimportOnline?.profile?.role==='admin'&&window.ZimportOnline.profile.active!==false;}
 async function call(action,payload={}){
  if(!isAdmin())throw Error('Administrator access only.');
  const client=window.ZimportOnline?.client;if(!client)throw Error('Cloud connection is not ready.');
  const {data,error}=await client.functions.invoke('manage-users',{body:{action,...payload}});
  if(error){let message=error.message;try{const body=await error.context.json();message=body.error||message;}catch{}throw Error(message);}
  if(data?.error)throw Error(data.error);return data;
 }
 function pageBoxes(selected=[]){
  const groups={};for(const p of window.ZimportPermissions.catalog)(groups[p.group]??=[]).push(p);
  $('newUserPageAccess').innerHTML=Object.entries(groups).map(([group,pages])=>`<fieldset style="border:1px solid #cbd5e1;border-radius:8px"><legend>${esc(groupNames[group]||group)}</legend>${pages.map(p=>`<label style="display:flex;gap:8px;align-items:center;margin:9px 0"><input style="width:auto;margin:0" type="checkbox" data-user-page="${esc(p.id)}" ${selected.includes(p.id)?'checked':''} ${['users','settings','program-settings','heads-recycle-bin'].includes(p.id)?'disabled':''}>${esc(p.label)}${['users','settings','program-settings','heads-recycle-bin'].includes(p.id)?' (Administrator only)':''}</label>`).join('')}</fieldset>`).join('');
  roleChanged();
 }
 function roleChanged(){const admin=$('newUserRole').value==='admin';$('newUserPageAccess').querySelectorAll('[data-user-page]').forEach(e=>{const reserved=['users','settings','program-settings','heads-recycle-bin'].includes(e.dataset.userPage);e.disabled=admin||reserved;if(admin)e.checked=true;else if(reserved)e.checked=false;});}
 function openForm(user=null){
  if(!isAdmin())return;
  $('createProgramUser').reset();$('editProgramUserId').value=user?.id||'';
  $('newUserName').value=user?.full_name||'';$('newUserUsername').value=user?.username||'';$('newUserEmail').value=user?.email||'';$('newUserEmail').readOnly=!!user;
  $('newUserRole').value=user?.role||'worker';$('newUserPassword').required=!user;
  $('userPasswordHint').textContent=user?'Leave blank to keep the current password.':'At least 10 characters. Passwords are never included in invitation emails.';
  $('newUserInvite').checked=!user;$('newUserInvite').disabled=!!user;
  $('userFormTitle').textContent=user?'Edit User and Page Access':'Create New User';$('saveProgramUser').textContent=user?'Save User':'Create New User';
  pageBoxes(user?.allowed_pages||[]);$('newUserFormPanel').classList.remove('hidden');$('newUserName').focus();
 }
 function renderUsers(){
  const body=$('adminUsersBody');body.replaceChildren();
  for(const u of users){
   const tr=document.createElement('tr');
   for(const value of [u.full_name||'',u.username||'',u.email||'',u.role,u.role==='admin'?'All pages':Array.isArray(u.allowed_pages)?u.allowed_pages.map(id=>window.ZimportPermissions.catalog.find(p=>p.id===id)?.label||id).join(', ')||'No pages assigned':'Existing access']){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   const active=document.createElement('td');active.textContent=u.active?'Yes':'No';tr.append(active);
   const actions=document.createElement('td');
   for(const [label,handler]of [ ['Edit / Page Access',()=>openForm(u)], ['Send Invitation',()=>action('send_invitation',{user_id:u.id},'Invitation email sent.')], ['Reset Password',()=>action('reset_password',{user_id:u.id},'Password reset email sent.')], [u.active?'Deactivate':'Activate',()=>action('update',{user_id:u.id,active:!u.active},'User status updated.')] ]){
    const b=document.createElement('button');b.type='button';b.className='secondary small';b.textContent=label;b.style.margin='3px';b.addEventListener('click',handler);actions.append(b);
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
   const pages=[...$('newUserPageAccess').querySelectorAll('input:checked')].map(e=>e.dataset.userPage);
   if($('newUserRole').value!=='admin'&&!pages.length){msg('Select at least one page for this user.','error');return;}
   const payload={email:$('newUserEmail').value.trim(),username:$('newUserUsername').value.trim(),full_name:$('newUserName').value.trim(),role:$('newUserRole').value,allowed_pages:pages,send_invitation:$('newUserInvite').checked,redirect_to:location.origin+location.pathname};
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
