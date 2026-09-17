(() => {
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hosts={
  'facebook.com':'facebook','www.facebook.com':'facebook','m.facebook.com':'facebook','web.facebook.com':'facebook',
  'instagram.com':'instagram','www.instagram.com':'instagram',
  'tiktok.com':'tiktok','www.tiktok.com':'tiktok','m.tiktok.com':'tiktok','vm.tiktok.com':'tiktok','vt.tiktok.com':'tiktok'
};
const platforms={facebook:'فيسبوك',instagram:'إنستغرام',tiktok:'تيك توك'};
function source(value){try{const url=new URL(value),platform=Object.hasOwn(hosts,url.hostname)?hosts[url.hostname]:null;return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&platform?{url:url.href,platform}:null}catch{return null}}
const phone=value=>/^\+\d{8,15}$/.test(value||'')?value:null;
function dateLabel(value){
  if(!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value||'')))return '';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
  const options={day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Damascus'};
  if(String(value).includes('T'))Object.assign(options,{hour:'2-digit',minute:'2-digit'});
  return new Intl.DateTimeFormat('ar-SY',options).format(date);
}
window.officeListingCard=function(p){
  const original=source(p.external_url),url=original?.url,sold=p.availability==='sold',tel=phone(p.phone),wa=phone(p.whatsapp);
  const platformKey=original?.platform||p.platform;
  const platform=Object.hasOwn(platforms,platformKey)?platforms[platformKey]:'المصدر';
  const hosted=/^\/uploads\/office-[a-f0-9]{32}\.mp4$/.test(p.hosted_video?.url||'')?p.hosted_video:null;
  const poster=hosted&&/^\/uploads\/office-[a-f0-9]{32}\.jpg$/.test(hosted.poster||'')?hosted.poster:null;
  const thumb=(Array.isArray(p.media)?p.media:[]).find(m=>/^\/assets\/fb-[a-z0-9-]+\.jpg$/.test(m.url||''));
  const image=poster||thumb?.url;
  const hasVideo=Boolean(hosted||p.media_kind==='video'||(!p.media_kind&&p.video_duration));
  const seconds=Number(hosted?.duration);
  const duration=hosted&&Number.isFinite(seconds)&&seconds>0?Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'):p.video_duration||('فيديو على '+platform);
  const id=String(p.market_id||p.id||'');
  const details=/^\d+$/.test(id)?'/office-property.html?id='+encodeURIComponent(id):'#';
  const location=[p.district,p.city].filter(Boolean).join(' · ')||'الموقع غير مذكور في المصدر';
  const published=dateLabel(p.source_published_at),observed=dateLabel(p.observed_at);
  const dates=[published?'تاريخ المنشور: '+published:p.published_label||'تاريخ المنشور غير متاح',observed?'رصد الإعلان: '+observed:''].filter(Boolean).join(' · ');
  const mediaContents=`${image?`<img src="${esc(image)}" alt="${esc(thumb?.alt||p.title)}" loading="lazy" width="640" height="360">`:''}
    ${hasVideo?`<span class="marei-play" aria-hidden="true">▶</span><span class="marei-duration">${esc(duration)}</span>`:''}
    ${sold?'<strong class="marei-sold-badge">تم البيع</strong>':''}`;
  const preview=hasVideo&&(hosted||url)?`<button type="button" class="marei-preview" data-property-video="${esc(JSON.stringify({url:hosted?.url||url,title:p.title}))}" aria-label="${esc('شاهد فيديو '+p.title)}">${mediaContents}</button>`:image?`<div class="marei-preview">${mediaContents}</div>`:'';
  return `<article class="marei-card${sold?' marei-sold':''}">
    ${preview}<div class="marei-card-body">
    <div class="marei-card-top"><span>${esc(p.advertiser_name||'المعلن')}</span><span class="marei-platform">${esc(platform)}${p.offer_number?' · عرض '+esc(p.offer_number):''}</span></div>
    <h3><a class="office-title-link" href="${details}">${esc(p.title)}</a></h3><p class="marei-location">${esc(location)}</p>
    <p class="marei-description">${esc(p.description)}</p>
    <div class="marei-facts">${p.area!=null?`<span>${esc(Number(p.area))} م²</span>`:''}<strong>${p.price==null?'السعر لدى المعلن':`<span data-price="${esc(p.price)}" data-price-currency="${esc(p.currency||'USD')}">${esc(Number(p.price_display??p.price).toLocaleString('ar-SY')+' '+(p.display_currency||p.currency||'USD'))}</span>`}</strong></div>
    <p class="marei-availability">${sold?'تم البيع بحسب منشور المعلن':'تأكد من المعلن من استمرار التوفر'}</p>
    <a class="office-details-link" href="${details}">تفاصيل العقار ←</a><small class="marei-date">${esc(dates)}</small>
    ${url?`<a class="marei-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">الإعلان الأصلي على ${esc(platform)} <span aria-hidden="true">↗</span></a>`:''}
    ${!sold&&(tel||wa)?`<div class="marei-contact">${tel?`<a href="tel:${tel}" aria-label="${esc('اتصل بـ'+(p.advertiser_name||'المعلن'))}">اتصال بالمعلن</a>`:''}${wa?`<a href="https://wa.me/${wa.slice(1)}?text=${encodeURIComponent('مرحبًا، أستفسر عن إعلان: '+p.title+' '+(url||''))}" target="_blank" rel="noopener noreferrer">واتساب</a>`:''}</div>`:''}
    </div></article>`;
};
})();
