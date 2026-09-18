(() => {
 'use strict';
 const $=id=>document.getElementById(id),api=ListingActions.api,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={property:'عقار',market:'عرض مكتب',hotel:'إقامة'},statuses={active:'منشور',published:'منشور',pending:'بانتظار المراجعة',rejected:'مرفوض',inactive:'غير نشط',approved:'معتمد وغير منشور',duplicate:'مكرر'};
 let page=1,serial=0;
 async function load(){
  const token=++serial,q=new URLSearchParams(new FormData($('listingFilters')));q.set('page',page);$('listingCount').textContent='جارٍ تحميل الإعلانات…';
  try{
   const d=await api('/api/listing-management?'+q);if(token!==serial)return;
   const pages=Math.max(1,Math.ceil(d.total/d.page_size));if(page>pages){page=pages;return load();}
   $('listingCount').textContent=d.total+' إعلانًا يمكنك إدارته';$('listingPage').textContent=page+' / '+pages;$('previousListings').disabled=page<=1;$('nextListings').disabled=page>=pages;
   $('managedListings').innerHTML=d.data.length?d.data.map(r=>`<article class="panel"><span class="pill">${names[r.kind]} · ${esc(statuses[r.status]||r.status)}</span><h2>${esc(r.title||'إعلان بلا عنوان')}</h2><p>${esc(r.city)}</p>${['active','published'].includes(r.status)?`<a href="${esc(r.url)}">فتح الإعلان</a>`:'<small>رابط الإعلان لن يظهر للزوار حتى اعتماده ونشره.</small>'}<div data-listing-kind="${r.kind}" data-listing-id="${esc(r.id)}" data-title="${esc(r.title)}"></div></article>`).join(''):'<section class="panel">لا توجد إعلانات متاحة لإدارتها بهذا البحث.</section>';
   ListingActions.refreshPermissions();
  }catch(e){$('listingCount').textContent=e.message;if(e.status===401){$('workspace').hidden=true;$('signIn').hidden=false;}}
 }
 async function boot(){
  try{const d=await api('/api/auth/me');$('signIn').hidden=!!d.user;$('workspace').hidden=!d.user;$('logout').hidden=!d.user;if(!d.user)return;
   $('accountLabel').textContent='مرحبًا '+d.user.name+(d.user.role==='admin'?' — تظهر الإعلانات بحسب صلاحياتك الإدارية.':' — تظهر إعلاناتك وإعلانات المكتب الذي تملكه.');
   $('reviewLink').hidden=d.user.role!=='admin'||(Array.isArray(d.user.admin_permissions)&&!d.user.admin_permissions.includes('offers.read'));await load();
  }catch(e){$('managementMessage').textContent=e.message;$('signIn').hidden=false;}
 }
 $('listingLogin').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});$('listingLogin').reset();$('managementMessage').textContent='';await boot();}catch(e){$('managementMessage').textContent=e.message;}finally{b.disabled=false;}};
 $('logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});location.reload();}catch(e){$('managementMessage').textContent=e.message;}};
 $('listingFilters').onsubmit=e=>{e.preventDefault();page=1;load();};$('previousListings').onclick=()=>{page--;load();};$('nextListings').onclick=()=>{page++;load();};
 window.addEventListener('listing:changed',load);window.addEventListener('listing:message',e=>$('managementMessage').textContent=e.detail);boot();
})();
