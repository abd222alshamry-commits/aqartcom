(function(root) {
  const rules = {
    images: { limit: 12, size: 8 * 1024 * 1024, type: /^image\/(jpeg|jpg|png|webp)$/i, extension: /\.(jpe?g|png|webp)$/i, label: 'الصور', formats: 'JPG / PNG / WebP' },
    videos: { limit: 3, size: 100 * 1024 * 1024, type: /^video\/(mp4|webm|quicktime)$/i, extension: /\.(mp4|webm|mov)$/i, label: 'الفيديو', formats: 'MP4 / WebM / MOV' }
  };
  function validate(files, kind) {
    const rule = rules[kind];
    if (files.length > rule.limit) throw Error(`${rule.label}: الحد الأقصى ${rule.limit} ملفات.`);
    for (const file of files) {
      if (!file.size) throw Error(`الملف «${file.name}» فارغ.`);
      if (!(file.type ? rule.type.test(file.type) : rule.extension.test(file.name))) throw Error(`صيغة «${file.name}» غير مدعومة. اختر ${rule.formats}.`);
      if (file.size > rule.size) throw Error(`الملف «${file.name}» يتجاوز ${rule.size / 1024 / 1024} ميغابايت.`);
    }
  }
  async function uploadPending(items, send, progress = () => {}) {
    for (const item of items) {
      if (item.uploaded) continue;
      item.error = '';
      try {
        await send(item, percent => progress(item, percent));
        item.uploaded = true;
      } catch (error) { item.error = error.message || 'تعذر رفع الملف'; }
      progress(item, 100);
    }
    return items.filter(item => !item.uploaded);
  }
  function sendFile(propertyId, item, progress) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `/api/me/properties/${encodeURIComponent(propertyId)}/${item.kind}`);
      request.withCredentials = true;
      request.timeout = 10 * 60 * 1000;
      request.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      request.onerror = () => reject(Error('انقطع الاتصال أثناء الرفع. أعد المحاولة.'));
      request.ontimeout = () => reject(Error('انتهت مهلة رفع الملف. أعد المحاولة.'));
      request.onload = () => {
        let result = {}; try { result = JSON.parse(request.responseText); } catch (_) {}
        if (request.status >= 200 && request.status < 300 && result.data?.length === 1) resolve(result.data[0]);
        else reject(Error(result.error || (request.status === 413 ? 'حجم الملف أكبر من الحد المسموح.' : 'تعذر رفع الملف. أعد المحاولة.')));
      };
      const form = new FormData();
      // Some mobile pickers omit the MIME type; use the accepted extension in that case.
      const mime = item.file.type || ({ jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime' }[item.file.name.split('.').pop().toLowerCase()]);
      const file = item.file.type ? item.file : new Blob([item.file], { type: mime });
      form.append(item.kind, file, item.file.name);
      request.send(form);
    });
  }
  function create(container) {
    const items = [];
    let locked = false;
    container.innerHTML = `<h3>صور وفيديو الإعلان <small>(اختياري)</small></h3>
      <div class="media-pickers">
        <label class="media-picker">📷 إضافة صور<input id="adImages" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple aria-label="إضافة صور للإعلان"></label>
        <label class="media-picker">▶ إضافة فيديو<input id="adVideos" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" multiple aria-label="إضافة فيديو للإعلان"></label>
      </div><p class="media-limits">حتى 12 صورة (8 ميغابايت للصورة) و3 مقاطع فيديو (100 ميغابايت للمقطع).<br>الصور: JPG / PNG / WebP · الفيديو: MP4 / WebM / MOV</p>
      <p class="media-selection-status" role="status">اختر من معرض الجوال أو من الملفات.</p>
      <p class="media-error" role="alert" hidden></p><div class="media-previews"></div>`;
    const status = container.querySelector('.media-selection-status');
    const error = container.querySelector('.media-error');
    const previews = container.querySelector('.media-previews');
    function render() {
      previews.replaceChildren();
      for (const item of items) {
        const figure = document.createElement('figure');
        const media = document.createElement(item.kind === 'images' ? 'img' : 'video');
        media.src = item.url;
        if (item.kind === 'images') media.alt = item.file.name;
        else { media.controls = true; media.preload = 'metadata'; media.playsInline = true; }
        const caption = document.createElement('figcaption');
        caption.textContent = item.file.name;
        const state = document.createElement('small');
        state.textContent = item.uploaded ? '✓ تم الرفع' : item.error || 'جاهز للرفع';
        if (item.error) state.className = 'media-error';
        figure.append(media, caption, state);
        if (!locked) {
          const remove = document.createElement('button');
          remove.type = 'button'; remove.textContent = 'إزالة';
          remove.setAttribute('aria-label', `إزالة ${item.file.name}`);
          remove.addEventListener('click', () => {
            if (media.tagName === 'VIDEO') media.pause();
            URL.revokeObjectURL(item.url);
            items.splice(items.indexOf(item), 1);
            render();
          });
          figure.append(remove);
        }
        previews.append(figure);
      }
      status.textContent = items.length ? `${items.filter(x => x.kind === 'images').length} صور · ${items.filter(x => x.kind === 'videos').length} فيديو` : 'اختر من معرض الجوال أو من الملفات.';
    }
    for (const [id, kind] of [['adImages','images'],['adVideos','videos']]) {
      container.querySelector('#' + id).addEventListener('change', event => {
        const input = event.target;
        const files = [...input.files].filter(file => !items.some(item => item.kind === kind && item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified));
        try {
          validate([...items.filter(x => x.kind === kind).map(x => x.file), ...files], kind);
          error.hidden = true;
          for (const file of files) items.push({ file, kind, url: URL.createObjectURL(file), uploaded: false });
          render();
        } catch (issue) { error.textContent = issue.message; error.hidden = false; }
        input.value = '';
      });
    }
    return {
      get count() { return items.length; },
      lock() { locked = true; container.querySelectorAll('input').forEach(input => input.disabled = true); render(); },
      async upload(propertyId, progress) {
        const remaining = await uploadPending(items, (item, update) => sendFile(propertyId, item, update), progress);
        render(); return remaining;
      },
      destroy() { previews.querySelectorAll('video').forEach(video => video.pause()); items.forEach(item => URL.revokeObjectURL(item.url)); }
    };
  }
  const api = { validate, uploadPending, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PropertyMedia = api;
})(typeof window === 'undefined' ? null : window);
