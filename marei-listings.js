(() => {
  'use strict';
  const section=document.getElementById('marei-listings'),host=document.getElementById('mareiCards');
  if(!section||!host)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sourceUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.facebook.com'?url.href:null}catch{return null}}
  async function load(){
    try {
      const response=await fetch('/api/market/marei');
      if(!response.ok)throw Error('load');
      const {data}=await response.json();
      section.hidden=!data.length;
      document.getElementById('mareiCount').textContent=data.length+' إعلانات';
      host.innerHTML=data.map(p=>{
        const url=sourceUrl(p.external_url);
        return `<article class="marei-card"><div class="marei-card-top"><span>عرض ${esc(p.offer_number||'عقاري')}</span><span class="marei-platform">فيسبوك</span></div>
          <h3>${esc(p.title)}</h3><p class="marei-location">${esc(p.district||'مشتى الحلو')} · ${esc(p.city)}</p>
          <p class="marei-description">${esc(p.description)}</p>
          <div class="marei-facts"><span>للبيع</span>${p.area!=null?`<span>${esc(Number(p.area))} م²</span>`:''}<strong>${p.price==null?'السعر لدى المكتب':esc(Number(p.price).toLocaleString('ar-SY')+' '+(p.currency||''))}</strong></div>
          <p class="marei-availability">التوفر بحاجة إلى تأكيد</p>
          ${p.source_published_at?`<small class="marei-date">تاريخ المنشور: <time datetime="${esc(p.source_published_at)}">${esc(p.source_published_at)}</time></small>`:''}
          ${url?`<a class="marei-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">▶ شاهد الإعلان والفيديو الأصلي <span aria-hidden="true">↗</span></a>`:''}</article>`;
      }).join('');
    }catch{
      host.innerHTML='<p class="marei-load-error">تعذر تحميل الإعلانات. <button type="button" id="retryMarei">حاول مجددًا</button></p>';
      document.getElementById('retryMarei').onclick=load;
    }
  }
  load();
})();
