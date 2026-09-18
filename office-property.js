(async()=>{
 const status=document.getElementById('detailStatus'),share=document.getElementById('shareListing');
 try{
  const id=new URLSearchParams(location.search).get('id');if(!/^\d+$/.test(id||''))throw Error('الإعلان غير موجود');
  const response=await fetch('/api/market/listings/'+id),json=await response.json();
  if(!response.ok)throw Error(json.error||'تعذر تحميل الإعلان');
  document.title=json.data.title+' — عقارتكم';document.getElementById('officeProperty').innerHTML=officeListingCard(json.data);
  const note=document.getElementById('officeDetailNote');
  const platform={facebook:'فيسبوك',instagram:'إنستغرام',tiktok:'تيك توك'}[json.data.platform]||'المصدر';
  note.textContent=json.data.platform==='manual_office'?'عرض أضافه فريق الإشراف لصالح المكتب وجرى اعتماده. تأكد من المكتب من التوفر والسعر الحالي.':'ملخص من إعلان المعلن على '+platform+'. تأكد من المعلن من التوفر والسعر الحالي. موقع العقار موضح بحسب المعلومات المنشورة في الإعلان.';
  status.textContent='';note.hidden=false;share.hidden=false;
  showOfficeLocation(json.data);
  share.onclick=async()=>{if(window.ListingActions)return ListingActions.share('market',id,json.data.title);try{if(navigator.share)await navigator.share({title:json.data.title,url:location.href});else{await navigator.clipboard.writeText(location.href);status.textContent='تم نسخ رابط الإعلان';}}catch(error){if(error.name!=='AbortError')status.textContent='يمكنك نسخ رابط الإعلان من شريط العنوان.';}};
 }catch(error){status.textContent=error.message;}
})();

function showOfficeLocation(listing) {
 const section=document.getElementById('officeLocation');
 section.hidden=false;
 document.getElementById('officeLocationLabel').textContent=listing.location_label||'الموقع غير محدد';
 const scope=document.getElementById('officeLocationScope');
 const container=document.getElementById('officeLocationMap');
 if(listing.latitude==null||listing.longitude==null||!Number.isFinite(Number(listing.latitude))||!Number.isFinite(Number(listing.longitude))){
  scope.textContent='لا تتوفر معلومات كافية لتحديد المنطقة على الخريطة. اطلب الموقع من المعلن.';
  container.hidden=true;return;
 }
 scope.textContent=listing.location_accuracy==='governorate'?'المتاح هو اسم المحافظة فقط. العلامة لعرض المحافظة وليست عنوان العقار. الدائرة إرشادية ولا تمثل حدودها.':'العلامة عند مركز البلدة المذكورة في الإعلان. الدائرة نطاق إرشادي بنصف قطر 5 كم حول المركز؛ تأكد من الموقع الفعلي مع المعلن.';
 if(!window.L){scope.textContent+=' تعذر تحميل الخريطة حاليًا.';container.hidden=true;return;}
 const point=[Number(listing.latitude),Number(listing.longitude)];
 const map=L.map(container,{scrollWheelZoom:false}).setView(point,listing.location_accuracy==='governorate'?8:12);
 addPropertyBasemaps(map);
 const radius=Math.max(1000,Math.min(400000,Number(listing.location_radius_m)||5000));
 const range=L.circle(point,{radius,color:'#b77912',fillColor:'#eab54a',fillOpacity:.12,dashArray:'6 5',weight:2}).addTo(map);
 const marker=L.marker(point,{title:'موقع تقريبي — ليس موقع العقار الدقيق'}).addTo(map);
 const label=document.createElement('div');label.dir='rtl';label.textContent=(listing.location_label||'')+' — موقع تقريبي، ليس موقع العقار الدقيق';marker.bindPopup(label);
 map.fitBounds(range.getBounds(),{padding:[20,20],maxZoom:12});
}
