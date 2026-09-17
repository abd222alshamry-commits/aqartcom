bindSyriaLocations(document);
const $=s=>document.querySelector(s),map=L.map('map',{zoomControl:true}).setView([35.0,38.0],7);addPropertyBasemaps(map);
let fittedInitialResults=false;
let properties=[],markers=L.layerGroup().addTo(map),drawPoints=[],polygonLayer=null,circleLayer=null,mode='bounds';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const toast=m=>{const x=$('#toast');x.textContent=m;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2300)};
function polygonFromBounds(){const b=map.getBounds();return[[b.getSouth(),b.getWest()],[b.getNorth(),b.getWest()],[b.getNorth(),b.getEast()],[b.getSouth(),b.getEast()]]}
function filters(){return{city:$('#city').value,district:$('#district').value.trim(),mode:$('#mode').value,type:$('#type').value,minPrice:$('#minPrice').value,maxPrice:$('#maxPrice').value,rooms:$('#rooms').value}}
async function search(){const body={...filters(),polygon:mode==='polygon'&&drawPoints.length>=3?drawPoints:mode==='bounds'?polygonFromBounds():null,center:mode==='circle'&&circleLayer?circleLayer.getLatLng():null,radiusKm:mode==='circle'?Number($('#radius').value):0};$('#summary').textContent='جاري البحث...';try{const r=await fetch('/api/properties/geo-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw Error(j.error);properties=j.data;if(!fittedInitialResults&&properties.length&&mode==='bounds'){const points=properties.filter(p=>p.latitude!=null&&p.longitude!=null).map(p=>[Number(p.latitude),Number(p.longitude)]);if(points.length){map.fitBounds(points,{padding:[75,55],maxZoom:11});fittedInitialResults=true;}}render()}catch(e){toast(e.message||'تعذر البحث')}}
function price(p){return p.price==null?'السعر عند التواصل':Number(p.price).toLocaleString('en-US')+' '+esc(p.currency||'USD')}
function detailUrl(p){return p.source_kind==='office'?'/office-property.html?id='+encodeURIComponent(p.market_id):'/property.html?id='+encodeURIComponent(p.id)}
function locationWarning(p){return p.location_approximate?'موقع تقريبي — ليس موقع العقار الدقيق':''}
function nearbyMapGroups(groups){
 const entries=[...groups.values()].map(rows=>({rows,point:map.latLngToLayerPoint([Number(rows[0].latitude),Number(rows[0].longitude)])}));
 const parent=entries.map((_,i)=>i),cells=new Map(),distance=120;
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 entries.forEach((entry,i)=>{
  const x=Math.floor(entry.point.x/distance),y=Math.floor(entry.point.y/distance);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of cells.get((x+dx)+','+(y+dy))||[]){
   const other=entries[j].point;
   if(Math.hypot(entry.point.x-other.x,entry.point.y-other.y)<distance)parent[root(i)]=root(j);
  }
  const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
 });
 const clusters=new Map();
 entries.forEach((entry,i)=>{const key=root(i);if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(entry.rows);});
 return [...clusters.values()];
}
function renderMapMarkers(){
 markers.clearLayers();
 const groups=new Map();
 for(const p of properties){
  if(p.latitude==null||p.longitude==null||!Number.isFinite(Number(p.latitude))||!Number.isFinite(Number(p.longitude)))continue;
  const key=[Number(p.latitude),Number(p.longitude),p.location_accuracy||'specified'].join(':');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
 }
 for(const centers of nearbyMapGroups(groups)){
  const group=centers.flat(),p=group[0],point=[Number(p.latitude),Number(p.longitude)],multiple=centers.length>1,approx=group.some(row=>row.location_approximate);
  const label=group.length>1?group.length+' إعلان':price(p);
  const icon=L.divIcon({className:'',html:`<div class="price-pin${approx?' approximate-pin':''}">${approx?'<span aria-hidden="true">≈ </span>':''}${label}</div>`,iconSize:[100,30],iconAnchor:[50,15]});
  // A cluster is anchored to an existing center for display only. Never draw a
  // fictitious town-radius circle around a combined or averaged location.
  if(approx&&!multiple)L.circle(point,{radius:Math.max(1000,Math.min(400000,Number(p.location_radius_m)||5000)),color:'#b77912',fillColor:'#eab54a',fillOpacity:.08,dashArray:'6 5',weight:2,interactive:false}).addTo(markers);
  const clusterLabel='مجموعة مواقع متقاربة — العلامة لتجميع النتائج وليست موقع عقار';
  const warning=multiple?`<p class="map-location-warning">${clusterLabel}</p><p>كبّر الخريطة لفصل المواقع، أو اختر الإعلان من القائمة.</p>`:approx?`<p class="map-location-warning">${locationWarning(p)}</p><p>${esc(p.location_label)}${p.location_accuracy==='governorate'?' — اسم المحافظة فقط':''}</p>`:'';
  const popup=`<div class="map-listing-popup" dir="rtl">${warning}${group.map(row=>`<article><b>${esc(row.title)}</b><br>${esc(row.location_label||row.city)}${row.district?' — '+esc(row.district):''}${row.location_approximate?`<br><span class="map-location-warning">${locationWarning(row)}</span>`:''}<br><a href="${detailUrl(row)}">عرض الإعلان · ${price(row)}</a></article>`).join('')}</div>`;
  L.marker(point,{icon,title:multiple?clusterLabel:approx?locationWarning(p):p.title}).addTo(markers).bindPopup(popup,{maxWidth:300});
 }
}
function render(){
 renderMapMarkers();
 const averages={};
 for(const p of properties){if(p.price==null||!Number.isFinite(Number(p.price)))continue;const c=p.currency||'USD';(averages[c]??=[]).push(Number(p.price));}
 const av=Object.entries(averages).map(([c,a])=>`${Math.round(a.reduce((sum,x)=>sum+x,0)/a.length).toLocaleString('en-US')} ${c}`).join(' · ');
 const approximate=properties.filter(p=>p.location_approximate).length;
 $('#summary').innerHTML=`<b>${properties.length}</b> إعلان في النطاق${approximate?`<br><span class="map-location-warning">${approximate} بموقع تقريبي؛ تحقق من المعلن.</span>`:''}${av?`<br>متوسط الأسعار المعلنة: ${esc(av)}`:''}`;
 $('#results').innerHTML=properties.slice(0,100).map(p=>`<article class="result">${p.image_url?`<img src="${esc(p.image_url)}" alt="${esc(p.title)}">`:'<span></span>'}<div><h3>${esc(p.title)}</h3><p>${esc(p.city)}${p.district?' — '+esc(p.district):''} · ${esc(p.type)}</p>${p.location_approximate?`<p class="map-location-warning">${locationWarning(p)}</p>`:''}<b>${price(p)}</b><div class="result-actions"><a href="${detailUrl(p)}">التفاصيل</a>${p.source_kind==='office'?'':`<button onclick="compare(${Number(p.id)})">⇄ مقارنة</button>`}</div></div></article>`).join('')||'<p>لا توجد عقارات مطابقة في هذه المنطقة.</p>';
 updateCompare();
}
function compare(id){let a=[...new Set(JSON.parse(localStorage.getItem('aqartkom_compare')||'[]').map(Number))];if(a.includes(Number(id)))a=a.filter(x=>x!==Number(id));else if(a.length>=4)return toast('يمكن مقارنة أربعة عقارات كحد أقصى');else a.push(Number(id));localStorage.setItem('aqartkom_compare',JSON.stringify(a));toast(a.includes(Number(id))?'أضيف العقار للمقارنة':'أزيل العقار من المقارنة');updateCompare()}
function updateCompare(){const n=JSON.parse(localStorage.getItem('aqartkom_compare')||'[]').length;$('#compareLink').textContent=n?`المقارنة (${n})`:'المقارنة'}
$('#searchBounds').onclick=search;['mode','type','rooms'].forEach(id=>$('#'+id).onchange=search);$('#draw').onclick=()=>{resetArea('polygon');drawPoints=[];if(polygonLayer)map.removeLayer(polygonLayer);$('#draw').classList.add('active');$('#finish').disabled=false;toast('اضغط نقاط حدود المنطقة على الخريطة')};$('#finish').onclick=()=>{if(drawPoints.length<3)return toast('اختر ثلاث نقاط على الأقل');$('#draw').classList.remove('active');$('#finish').disabled=true;map.fitBounds(polygonLayer.getBounds());search()};$('#circle').onclick=()=>{resetArea('circle');$('#circle').classList.add('active');toast('اضغط مركز دائرة البحث على الخريطة')};$('#radius').onchange=()=>{if(circleLayer){circleLayer.setRadius(Number($('#radius').value)*1000);search()}};map.on('click',e=>{if(mode==='polygon'&&!$('#finish').disabled){drawPoints.push([e.latlng.lat,e.latlng.lng]);if(polygonLayer)map.removeLayer(polygonLayer);polygonLayer=L.polygon(drawPoints,{color:'#d3a23a'}).addTo(map)}else if(mode==='circle'){if(circleLayer)map.removeLayer(circleLayer);circleLayer=L.circle(e.latlng,{radius:Number($('#radius').value)*1000,color:'#d3a23a'}).addTo(map);map.fitBounds(circleLayer.getBounds());search()}});$('#locate').onclick=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(x=>{map.setView([x.coords.latitude,x.coords.longitude],14);resetArea('bounds');search()},e=>toast(e.code===1?'اسمح بالوصول إلى الموقع من إعدادات المتصفح أو اختر نقطة على الخريطة':'تعذر تحديد موقعك؛ اختر نقطة على الخريطة'),{enableHighAccuracy:true,timeout:12000,maximumAge:60000}):toast('الموقع غير مدعوم');$('#saveArea').onclick=async()=>{const name=prompt('اسم منطقة البحث');if(!name)return;const b=mode==='circle'&&circleLayer?{name,center:{lat:circleLayer.getLatLng().lat,lng:circleLayer.getLatLng().lng},radiusKm:Number($('#radius').value)}:{name,polygon:mode==='polygon'&&drawPoints.length>=3?drawPoints:polygonFromBounds()};try{const r=await fetch('/api/me/search-areas',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(r.status===401)return toast('سجّل الدخول أولًا لحفظ المنطقة');if(!r.ok)throw Error();toast('تم حفظ منطقة البحث')}catch{toast('تعذر حفظ المنطقة')}};$('#mobileFilters').onclick=()=>$('.filters').classList.toggle('open');map.on('moveend',()=>{if(mode==='bounds')$('#summary').textContent='اضغط «بحث في هذه المنطقة» لتحديث النتائج.'});updateCompare();search();

function resetArea(next='bounds') {mode=next;drawPoints=[];if(polygonLayer){map.removeLayer(polygonLayer);polygonLayer=null;}if(circleLayer){map.removeLayer(circleLayer);circleLayer=null;}$('#draw').classList.remove('active');$('#circle').classList.remove('active');$('#finish').disabled=true;}
$('#resetArea').onclick=()=>{resetArea();search();};
$('#closeFilters').onclick=()=>$('.filters').classList.remove('open');

map.on('zoomend',renderMapMarkers);
