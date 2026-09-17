(async function () {
  'use strict';
  const el = id => document.getElementById(id);
  const status = el('pageStatus'), form = el('videoForm');
  let listings = [], saving = false;
  const bytes = value => (Number(value)/1024/1024).toLocaleString('ar-SY',{maximumFractionDigits:0})+' ميغابايت';
  async function load() {
    const response = await fetch('/api/admin/office-videos',{credentials:'same-origin',cache:'no-store'});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'تعذر تحميل الإعلانات.');
    const selected = el('listing').value;
    listings = result.data;
    el('savedCount').textContent = listings.filter(p => p.hosted_video).length+' من '+listings.length+' إعلانًا له فيديو محفوظ';
    el('storageSpace').textContent = 'مساحة متاحة: '+bytes(result.storage.free_bytes);
    if (el('office').options.length === 1) [...new Set(listings.map(p => p.advertiser_name))].forEach(name => el('office').add(new Option(name,name)));
    options(selected);
  }
  function options(selected = '') {
    el('listing').replaceChildren(new Option('اختر الإعلان',''));
    listings.filter(p => !el('office').value || p.advertiser_name === el('office').value).forEach(p => el('listing').add(new Option((p.hosted_video?'✓ ':'')+p.title,p.id)));
    el('listing').value = selected; showListing();
  }
  function showListing() {
    const item = listings.find(p => String(p.id) === el('listing').value);
    el('listingInfo').hidden = !item;
    el('currentVideo').replaceChildren();
    if (!item) return;
    el('listingTitle').textContent = item.title;
    el('viewListing').href = '/office-property.html?id='+encodeURIComponent(item.id);
    el('viewSource').href = item.external_url;
    const local = item.hosted_video;
    el('videoState').textContent = local ? 'محفوظ على الموقع · '+bytes(local.size_bytes)+(local.has_audio?' · يحتوي صوتًا':' · الملف الأصلي بلا مسار صوت')+' — حفظ ملف جديد يستبدل هذه النسخة.' : 'لم تُحفظ نسخة فيديو لهذا الإعلان بعد.';
    if (local) el('currentVideo').innerHTML = window.PropertyVideo.preview({url:local.url,title:item.title},local.poster);
  }
  function send(url,body,isFile) {
    return new Promise((resolve,reject) => {
      const request = new XMLHttpRequest(); request.open('POST',url); request.withCredentials = true; request.timeout = 15*60*1000;
      if (!isFile) request.setRequestHeader('Content-Type','application/json');
      request.upload.onprogress = event => { if (isFile && event.lengthComputable) { el('progress').value = Math.round(100*event.loaded/event.total); el('saveStatus').textContent = 'رفع الفيديو: '+el('progress').value+'٪'; } };
      request.upload.onload = () => { el('progress').removeAttribute('value'); el('saveStatus').textContent = isFile?'اكتمل الرفع. جاري تجهيز الفيديو وحفظه…':'جاري تنزيل الملف وتجهيزه…'; };
      request.onerror = () => reject(Error('انقطع الاتصال. تحقق من الإعلان قبل إعادة الرفع.'));
      request.ontimeout = () => reject(Error('طال حفظ الفيديو. حدّث الصفحة للتحقق من النتيجة قبل المحاولة مجددًا.'));
      request.onload = () => {
        let result = {}; try { result = JSON.parse(request.responseText); } catch (_) {}
        if (request.status >= 200 && request.status < 300) resolve(result);
        else reject(Error(result.error || 'تعذر حفظ الفيديو. أعد المحاولة.'));
      };
      request.send(body);
    });
  }
  el('office').onchange = () => options(); el('listing').onchange = showListing;
  form.querySelectorAll('[name=method]').forEach(radio => radio.onchange = () => { el('fileFields').hidden = radio.value !== 'upload'; el('urlFields').hidden = radio.value !== 'import'; });
  window.addEventListener('beforeunload',event => { if (saving) { event.preventDefault(); event.returnValue = ''; } });
  form.onsubmit = async event => {
    event.preventDefault(); if (saving) return;
    el('saveError').hidden = true;
    try {
      const id = el('listing').value, method = form.querySelector('[name=method]:checked').value;
      if (!id) throw Error('اختر الإعلان أولًا.');
      let body;
      if (method === 'upload') {
        const file = el('videoFile').files[0];
        if (!file || !file.size || !/\.(mp4|mov|webm)$/i.test(file.name)) throw Error('اختر ملف فيديو MP4 أو MOV أو WebM.');
        if (file.size > 100*1024*1024) throw Error('الحد الأقصى للفيديو 100 ميغابايت.');
        body = new FormData(); body.append('video',file,file.name);
      } else {
        const url = new URL(el('videoUrl').value.trim());
        if (url.protocol !== 'https:') throw Error('استخدم رابط تنزيل HTTPS.');
        if (/(^|\.)(facebook\.com|fb\.watch|youtube\.com|youtu\.be)$/.test(url.hostname)) throw Error('استخدم ملف الفيديو أو رابط تنزيله المباشر، وليس رابط صفحة فيسبوك.');
        body = JSON.stringify({url:url.href});
      }
      saving = true; el('fields').disabled = true; el('uploadProgress').hidden = false; el('progress').removeAttribute('value'); el('saveStatus').textContent = 'جاري حفظ الفيديو…';
      const result = await send('/api/admin/office-videos/'+id+'/'+method,body,method === 'upload');
      el('progress').value = 100;
      el('saveStatus').textContent = '✓ تم حفظ الفيديو. أصبح تشغيله داخل الإعلان من موقعنا.'+(result.data.has_audio?'':' الملف الأصلي لا يحتوي مسارًا صوتيًا.');
      el('videoFile').value = ''; el('videoUrl').value = '';
      await load();
    } catch (error) { el('saveError').textContent = error instanceof TypeError ? 'أدخل رابط تنزيل صحيحًا.' : error.message; el('saveError').hidden = false; el('uploadProgress').hidden = true; }
    finally { saving = false; el('fields').disabled = false; }
  };
  try {
    const response = await fetch('/api/auth/me',{credentials:'same-origin'}), account = await response.json();
    if (account.user?.role !== 'admin') { status.textContent = 'هذه الصفحة لمدير الموقع. سجّل الدخول بحساب المدير أولًا.'; el('signIn').hidden = false; return; }
    await load(); status.hidden = true; el('manager').hidden = false;
  } catch (error) { status.textContent = error.message || 'تعذر الاتصال بالموقع.'; }
})();
