(function(){
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function msg(text,kind=''){const e=$('adminUserMessage');if(e){e.textContent=text;e.className='admin-user-message '+kind;}}
 function isAdmin(){return window.ZimportOnline?.profile?.role==='admin';}
 async function call(action,payload={}){
   const client=window.ZimportOnline?.client;if(!client)throw new Error('Cloud connection is not ready.');
   const {data,error}=await client.functions.invoke('manage-users',{body:{action,...payload}});
   if(error)throw error;if(data?.error)throw new Error(data.error);return data;
 }
 async function loadUsers(){
   const box=$('adminUserPanel');if(!box)return;
   box.style.display=isAdmin()?'':'none';if(!isAdmin())return;
   msg('Loading users…');
   try{const r=await call('list');renderUsers(r.users||[]);msg('');}catch(e){console.error(e);msg(e.message||'Unable to load users.','error');}
 }
 function renderUsers(users){
   const body=$('adminUsersBody');if(!body)return;
   body.innerHTML=users.map(u=>`<tr><td>${esc(u.full_name||'')}</td><td>${esc(u.email||'')}</td><td><select data-user-role="${esc(u.id)}"><option ${u.role==='admin'?'selected':''}>admin</option><option ${u.role==='manager'?'selected':''}>manager</option><option ${u.role==='worker'?'selected':''}>worker</option><option ${u.role==='readonly'?'selected':''}>readonly</option></select></td><td><input type="checkbox" data-user-active="${esc(u.id)}" ${u.active?'checked':''}></td><td><button type="button" class="secondary small" data-save-user="${esc(u.id)}">Save</button> <button type="button" class="secondary small" data-reset-user="${esc(u.email||'')}">Reset password</button></td></tr>`).join('')||'<tr><td colspan="5">No users found.</td></tr>';
   body.querySelectorAll('[data-save-user]').forEach(b=>b.onclick=async()=>{const id=b.dataset.saveUser,role=body.querySelector(`[data-user-role="${CSS.escape(id)}"]`).value,active=body.querySelector(`[data-user-active="${CSS.escape(id)}"]`).checked;msg('Saving user…');try{await call('update',{user_id:id,role,active});msg('User updated.','success');await loadUsers()}catch(e){msg(e.message,'error')}});
   body.querySelectorAll('[data-reset-user]').forEach(b=>b.onclick=async()=>{const email=b.dataset.resetUser;if(!email)return;msg('Sending password reset…');try{const r=await window.ZimportOnline.client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(r.error)throw r.error;msg('Password reset email sent.','success')}catch(e){msg(e.message,'error')}});
 }
 function init(){
   $('createProgramUser')?.addEventListener('submit',async e=>{e.preventDefault();msg('Creating user…');const payload={email:$('newUserEmail').value.trim(),password:$('newUserPassword').value,full_name:$('newUserName').value.trim(),role:$('newUserRole').value};try{await call('create',payload);e.target.reset();msg('User created successfully.','success');await loadUsers()}catch(err){console.error(err);msg(err.message||'User could not be created.','error')}});
   $('refreshProgramUsers')?.addEventListener('click',loadUsers);
   window.addEventListener('zimport-online-role',loadUsers);
   setTimeout(loadUsers,1000);
 }
 window.ZimportAdmin={loadUsers};window.addEventListener('DOMContentLoaded',init);
})();
