(() => {
  'use strict';
  const section=document.getElementById('marei-listings'),host=document.getElementById('mareiCards');
  if(!section||!host)return;
  const filters=document.getElementById('mareiFilters'),availability=document.getElementById('mareiAvailability');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sourceUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.facebook.com'?url.href:null}catch{return null}}
  const phone=value=>/^\+\d{8,15}$/.test(value||'')?value:null;
  let listings=[],offices=[],selected='all';
  function render(){
    const visible=listings.filter(p=>(selected==='all'||p.office_key===selected)&&(availability.value==='all'||p.availability===availability.value));
    document.getElementById('mareiCount').textContent=visible.length+' إعلانًا';
    filters.innerHTML=[{key:'all',name:'جميع المكاتب'},...offices].map(o=>`<button type="button" data-office="${esc(o.key)}" aria-pressed="${selected===o.key}">${esc(o.name)} <span>${listings.filter(p=>o.key==='all'||p.office_key===o.key).length}</span></button>`).join('');
    const ordered=offices.flatMap(o=>visible.filter(p=>p.office_key===o.key));
    host.innerHTML=ordered.map(p=>{
      const url=sourceUrl(p.external_url),sold=p.availability==='sold',tel=phone(p.phone),wa=phone(p.whatsapp);
      const thumb=(Array.isArray(p.media)?p.media:[]).find(m=>/^\/assets\/fb-[a-z0-9-]+\.jpg$/.test(m.url||''));
      return `<article class="marei-card${sold?' marei-sold':''}">
        <a class="marei-preview" href="${esc(url||'#')}" target="_blank" rel="noopener noreferrer" aria-label="${esc('شاهد فيديو '+p.title)}">
          ${thumb?`<img src="${esc(thumb.url)}" alt="${esc(thumb.alt||p.title)}" loading="lazy" width="640" height="360">`:''}
          <span class="marei-play" aria-hidden="true">▶</span><span class="marei-duration">${esc(p.video_duration||'فيديو')}</span>
          ${sold?'<strong class="marei-sold-badge">تم البيع</strong>':''}
        </a><div class="marei-card-body">
        <div class="marei-card-top"><span>${esc(p.advertiser_name)}</span><span class="marei-platform">${p.offer_number?'عرض '+esc(p.offer_number):'فيسبوك'}</span></div>
        <h3>${esc(p.title)}</h3><p class="marei-location">${esc(p.district||'مشتى الحلو')} · ${esc(p.city)}</p>
        <p class="marei-description">${esc(p.description)}</p>
        <div class="marei-facts">${p.area!=null?`<span>${esc(Number(p.area))} م²</span>`:''}<strong>${p.price==null?'السعر لدى المكتب':esc(Number(p.price).toLocaleString('ar-SY')+' دولار')}</strong></div>
        <p class="marei-availability">${sold?'تم البيع بحسب منشور المكتب':'تأكد من المكتب من استمرار التوفر'}</p>
        <small class="marei-date">${p.source_published_at?'تاريخ المنشور: '+esc(p.source_published_at):esc(p.published_label||'')} · مراجعة 16 سبتمبر 2026</small>
        ${url?`<a class="marei-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">شاهد الإعلان والفيديو الأصلي <span aria-hidden="true">↗</span></a>`:''}
        ${!sold&&(tel||wa)?`<div class="marei-contact">${tel?`<a href="tel:${tel}" aria-label="${esc('اتصل بـ'+p.advertiser_name)}">اتصال بالمكتب</a>`:''}${wa?`<a href="https://wa.me/${wa.slice(1)}?text=${encodeURIComponent('مرحبًا، أستفسر عن إعلان: '+p.title+' '+(url||''))}" target="_blank" rel="noopener noreferrer">واتساب</a>`:''}</div>`:''}
        </div></article>`;
    }).join('')||'<p class="marei-empty">لا توجد إعلانات مطابقة لهذا الاختيار.</p>';
    host.querySelectorAll('.marei-preview img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.parentElement.classList.add('marei-no-image');},{once:true}));
  }
  filters.addEventListener('click',event=>{const button=event.target.closest('button[data-office]');if(button){selected=button.dataset.office;render();}});
  availability.addEventListener('change',render);
  async function load(){
    try {
      const response=await fetch('/api/market/offices');
      if(!response.ok)throw Error('load');
      const json=await response.json();listings=json.data;offices=json.offices;
      section.hidden=!listings.length;render();
    }catch{
      host.innerHTML='<p class="marei-load-error">تعذر تحميل الإعلانات. <button type="button" id="retryMarei">حاول مجددًا</button></p>';
      document.getElementById('retryMarei').onclick=load;
    }
  }
  load();
})();
