(function(root){
 'use strict';
 function array(value){if(typeof value==='string'){try{value=JSON.parse(value);}catch{value=[value];}}return Array.isArray(value)?value:[];}
 function safeUrl(value){if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(value,root?.location?.href||'https://aqartcom-v93.onrender.com/');if(u.username||u.password||!['http:','https:'].includes(u.protocol))return '';if(u.protocol==='http:'&&u.origin!==(root?.location?.origin||''))return '';return value.trim();}catch{return '';}}
 function youtubePoster(url){try{const u=new URL(url);if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(u.hostname))return '';const id=u.hostname==='youtu.be'?u.pathname.slice(1).split('/')[0]:u.searchParams.get('v')||u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];return /^[\w-]{11}$/.test(id||'')?'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg':'';}catch{return '';}}
 function candidates(entity){
  const out=[],seen=new Set();
  const add=(type,value)=>{if(!value)return;const url=safeUrl(typeof value==='string'?value:value.url);if(!url||seen.has(type+url)||/\/assets\/property-(?:building|villa|interior)\.webp$/.test(url))return;seen.add(type+url);out.push({type,url,poster:type==='video'?safeUrl(value.poster_url||value.poster||value.thumbnail_url)||youtubePoster(url):'',title:typeof value==='object'?String(value.title||value.alt||''):''});};
  array(entity?.images).forEach(v=>add('image',v));add('image',entity?.image_url);
  array(entity?.media).forEach(v=>{const type=v.type==='video'||/\.(mp4|mov|webm)(?:[?#]|$)/i.test(v.url||'')?'video':v.type==='image'||/\.(jpe?g|png|webp)(?:[?#]|$)/i.test(v.url||'')?'image':null;if(type)add(type,v);});
  add('video',entity?.primary_video);add('video',entity?.hosted_video);
  array(entity?.videos).forEach(v=>add('video',v));
  for(const room of array(entity?.rooms))for(const item of candidates(room))add(item.type,item);
  return out;
 }
 function url(entity){return safeUrl(entity?.cover_media?.url)||safeUrl(entity?.hosted_video?.poster_url||entity?.hosted_video?.poster)||candidates(entity).find(x=>x.type==='image')?.url||candidates(entity).find(x=>x.type==='video'&&x.poster)?.poster||'';}
 const api={safeUrl,candidates,url};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root?.document)return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function request(path,options={}){const r=await fetch(path,options);const j=await r.json();if(!r.ok)throw Error(j.error||'تعذر حفظ صورة العرض');return j;}
 async function editor(host,kind,id,onSave=()=>{}){
  const endpoint='/api/listing-management/'+kind+'/'+encodeURIComponent(id)+'/cover';host.textContent='جارٍ تحميل صور وفيديوهات العرض…';
  try{
   const state=await request(endpoint);if(!host.isConnected)return;
   host.innerHTML='<p>اختر صورة العرض، أو حرّك الفيديو إلى اللقطة المطلوبة ثم اعتمدها.</p><div class="cover-current"></div><div class="cover-choices"></div><p class="cover-status" role="status"></p>';
   const current=host.querySelector('.cover-current'),choices=host.querySelector('.cover-choices'),note=host.querySelector('.cover-status');
   function showCurrent(cover){current.innerHTML=safeUrl(cover?.url)?'<strong>الصورة الرئيسية الحالية</strong><img src="'+esc(cover.url)+'" alt="الصورة الرئيسية للعرض">':'';}
   showCurrent(state.cover);let busy=false;
   async function save(choice){
    if(busy)return;busy=true;host.querySelectorAll('button,input').forEach(b=>b.disabled=true);note.textContent=choice.seconds!=null?'جارٍ استخراج اللقطة وحفظها…':'جارٍ حفظ صورة العرض…';
    try{const result=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...choice,revision:state.revision})});showCurrent(result.cover);note.textContent=result.message;onSave(result);const updated=await request(endpoint);state.revision=updated.revision;}
    catch(e){note.textContent=e.message;}finally{busy=false;host.querySelectorAll('button,input').forEach(b=>b.disabled=false);}
   }
   for(const [index,item] of state.media.entries()){
    const row=document.createElement('section');row.className='cover-choice';
    if(item.type==='image'){
     row.innerHTML='<img src="'+esc(item.url)+'" alt="صورة العرض '+(index+1)+'" loading="lazy"><button type="button">تعيين هذه الصورة</button>';row.querySelector('button').onclick=()=>save({type:'image',url:item.url});
    }else{
     const direct=/\.(mp4|webm|mov)(?:[?#]|$)/i.test(item.url);
     row.innerHTML=(direct?'<video src="'+esc(item.url)+'" controls playsinline preload="metadata"'+(item.poster?' poster="'+esc(item.poster)+'"':'')+'></video>':item.poster?'<img src="'+esc(item.poster)+'" alt="صورة الفيديو">':'')+'<p>'+esc(item.title||'فيديو العرض')+'</p>';
     if(item.poster){const button=document.createElement('button');button.type='button';button.textContent='استخدام صورة الفيديو الحالية';button.onclick=()=>save({type:'video',url:item.url});row.append(button);}
     if(item.can_extract){
      const label=document.createElement('label');label.textContent='وقت اللقطة بالثواني ';const seconds=document.createElement('input');seconds.type='number';seconds.min='0';seconds.step='0.1';seconds.value='0.5';label.append(seconds);
      const video=row.querySelector('video');if(video){video.onloadedmetadata=()=>{if(Number.isFinite(video.duration)){seconds.max=String(Math.max(0,video.duration-0.05));seconds.value=String(Math.min(0.5,Number(seconds.max)));video.currentTime=Number(seconds.value);}};video.ontimeupdate=()=>{if(!busy)seconds.value=String(Math.round(video.currentTime*10)/10);};seconds.onchange=()=>{if(Number.isFinite(Number(seconds.value)))video.currentTime=Number(seconds.value);};}
      const button=document.createElement('button');button.type='button';button.textContent='اعتماد هذه اللقطة';button.onclick=()=>{video?.pause();const at=Number(seconds.value);if(!seconds.value||!seconds.checkValidity()||!Number.isFinite(at)){note.textContent='اختر وقتًا داخل مدة الفيديو.';return;}save({type:'video',url:item.url,seconds:at});};row.append(label,button);
     }else{const hint=document.createElement('small');hint.textContent='لاختيار لقطة أخرى، ارفع ملف الفيديو إلى العرض أو اختر صورة مرفوعة.';row.append(hint);}
    }
    choices.append(row);
   }
   if(!state.media.length)choices.textContent='أضف صورًا أو فيديو إلى العرض أولًا.';
   const reset=document.createElement('button');reset.type='button';reset.textContent='اختيار تلقائي من وسائط العرض';reset.onclick=()=>save({type:'auto'});host.append(reset);
  }catch(e){host.textContent=e.message;}
 }
 function open(kind,id,onSaved){
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='listing-dialog cover-dialog';dialog.dir='rtl';dialog.innerHTML='<div class="listing-dialog-head"><h2>صورة العرض الرئيسية</h2><button type="button" aria-label="إغلاق اختيار صورة العرض">×</button></div><div class="cover-editor"></div>';document.body.append(dialog);let changed=false;
  const close=()=>{dialog.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});dialog.remove();previous?.focus();if(changed){if(onSaved)onSaved();else if(document.getElementById('managedListings'))window.dispatchEvent(new CustomEvent('listing:changed'));else location.reload();}};
  dialog.querySelector('button').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();editor(dialog.querySelector('.cover-editor'),kind,id,()=>changed=true);
 }
 root.ListingCover={...api,editor,open,request};
})(typeof window==='undefined'?null:window);
