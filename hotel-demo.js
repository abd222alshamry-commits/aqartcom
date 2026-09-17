'use strict';
const byId=id=>document.getElementById(id);
let allowed=false, busy=false, catalog=[], published=[];
function message(text) { byId('message').textContent=text; }
function buttons() { byId('create').disabled=!allowed||busy; byId('hide').disabled=!allowed||busy||!published.some(h=>h.status==='active'); }
async function api(path, method='GET') {
  const r=await fetch(path,{method,credentials:'same-origin',headers:{Accept:'application/json'}});
  const body=await r.json();
  if(!r.ok) { const e=new Error(body.error||'تعذر الاتصال بالخادم'); e.status=r.status; throw e; }
  return body;
}
function render() {
  byId('catalog').replaceChildren();
  for(const hotel of catalog) {
    const row=document.createElement('tr'), existing=published.find(h=>h.name===hotel.name);
    for(const value of [hotel.city,hotel.prices.join(' / ')+' '+hotel.currency,!existing?'لم تُضف بعد':existing.status==='active'?'ظاهر في الموقع':'مخفي']) {
      const cell=document.createElement('td');cell.textContent=value;row.append(cell);
    }
    byId('catalog').append(row);
  }
}
async function run(action) {
  if(busy||!allowed)return;
  busy=true;buttons();message('جارٍ حفظ التغيير…');
  try {
    const result=await api('/api/admin/demo-hotels'+(action==='hide'?'/hide':''),'POST');
    published=result.data;render();
    message(action==='hide'?`تم إخفاء ${result.hidden} فنادق تجريبية مع الاحتفاظ بالسجلات.`:`أُضيف ${result.created} فنادق. يوجد ${result.existing} فنادق تجريبية سابقة لم تتغير. افتح صفحة الفنادق لاختبارها.`);
  }catch(error){message(error.message+(error.status?'':' — إذا انقطع الاتصال، أعد تحميل الصفحة للتحقق قبل المحاولة مجددًا.'));}
  finally{busy=false;buttons();}
}
byId('create').onclick=()=>run('create');byId('hide').onclick=()=>run('hide');
(async()=>{
  try{const data=await api('/api/admin/demo-hotels');catalog=data.catalog;published=data.data;allowed=true;render();message('جاهز لإضافة بيانات الاختبار بحساب المدير.');}
  catch(error){message(error.message);if(error.status===401)byId('login').hidden=false;}
  buttons();
})();
