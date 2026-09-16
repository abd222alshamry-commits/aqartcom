(() => {
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sourceUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.facebook.com'?url.href:null}catch{return null}}
const phone=value=>/^\+\d{8,15}$/.test(value||'')?value:null;
window.officeListingCard=function(p){
const url=sourceUrl(p.external_url),sold=p.availability==='sold',tel=phone(p.phone),wa=phone(p.whatsapp);
      const thumb=(Array.isArray(p.media)?p.media:[]).find(m=>/^\/assets\/fb-[a-z0-9-]+\.jpg$/.test(m.url||''));
      const details=p.detail_url||'/office-property.html?id='+encodeURIComponent(p.market_id||p.id);
      return `<article class="marei-card${sold?' marei-sold':''}">
        <a class="marei-preview" href="${esc(url||'#')}" target="_blank" rel="noopener noreferrer" aria-label="${esc('شاهد فيديو '+p.title)}">
          ${thumb?`<img src="${esc(thumb.url)}" alt="${esc(thumb.alt||p.title)}" loading="lazy" width="640" height="360">`:''}
          <span class="marei-play" aria-hidden="true">▶</span><span class="marei-duration">${esc(p.video_duration||'فيديو')}</span>
          ${sold?'<strong class="marei-sold-badge">تم البيع</strong>':''}
        </a><div class="marei-card-body">
        <div class="marei-card-top"><span>${esc(p.advertiser_name)}</span><span class="marei-platform">${p.offer_number?'عرض '+esc(p.offer_number):'فيسبوك'}</span></div>
        <h3><a class="office-title-link" href="${esc(details)}">${esc(p.title)}</a></h3><p class="marei-location">${esc(p.district||'مشتى الحلو')} · ${esc(p.city)}</p>
        <p class="marei-description">${esc(p.description)}</p>
        <div class="marei-facts">${p.area!=null?`<span>${esc(Number(p.area))} م²</span>`:''}<strong>${p.price==null?'السعر لدى المكتب':`<span data-price="${esc(p.price)}" data-price-currency="${esc(p.currency||'USD')}">${esc(Number(p.price_display??p.price).toLocaleString('ar-SY')+' '+(p.display_currency||p.currency||'USD'))}</span>`}</strong></div>
        <p class="marei-availability">${sold?'تم البيع بحسب منشور المكتب':'تأكد من المكتب من استمرار التوفر'}</p>
        <a class="office-details-link" href="${esc(details)}">تفاصيل العقار ←</a><small class="marei-date">${p.source_published_at?'تاريخ المنشور: '+esc(p.source_published_at):esc(p.published_label||'')} · مراجعة 16 سبتمبر 2026</small>
        ${url?`<a class="marei-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">شاهد الإعلان والفيديو الأصلي <span aria-hidden="true">↗</span></a>`:''}
        ${!sold&&(tel||wa)?`<div class="marei-contact">${tel?`<a href="tel:${tel}" aria-label="${esc('اتصل بـ'+p.advertiser_name)}">اتصال بالمكتب</a>`:''}${wa?`<a href="https://wa.me/${wa.slice(1)}?text=${encodeURIComponent('مرحبًا، أستفسر عن إعلان: '+p.title+' '+(url||''))}" target="_blank" rel="noopener noreferrer">واتساب</a>`:''}</div>`:''}
        </div></article>`;
};
})();
