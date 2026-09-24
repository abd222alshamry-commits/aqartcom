(function (root) {
  'use strict';
  function array(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { value = [value]; }
    }
    return Array.isArray(value) ? value : [];
  }
  function safeUrl(value, base = root?.location?.href || 'https://aqartcom-v93.onrender.com/') {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, base);
      if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === new URL(base).origin))) return '';
      return value.trim();
    } catch (_) { return ''; }
  }
  function items(entity, label = entity?.name || entity?.title || '') {
    const result = [], seen = new Set();
    for (const [field, type] of [['images', 'image'], ['videos', 'video']]) {
      const values = array(entity?.[field]);
      if (!values.length && entity?.[type + '_url']) values.push(entity[type + '_url']);
      for (const value of values) {
        const url = safeUrl(typeof value === 'string' ? value : value?.url);
        if (!url || seen.has(type + url)) continue;
        seen.add(type + url);
        result.push({ type, url, title: String(value?.title || label), poster: safeUrl(value?.poster_url || value?.thumbnail_url) });
      }
    }
    return result;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { array, safeUrl, items };
  if (!root?.document) return;
  const document = root.document;
  let active = null, sequence = 0;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    if (tag === 'button') element.type = 'button';
    return element;
  }
  function open(images, index = 0) {
    images = images.filter(item => item.type === 'image' && safeUrl(item.url));
    if (!images.length || active) return;
    const returnFocus = document.activeElement, viewer = node('div', 'media-image-viewer');
    const titleId = 'mediaImageTitle' + (++sequence);
    viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-modal', 'true'); viewer.setAttribute('aria-labelledby', titleId);
    viewer.dir = 'rtl';
    const header = node('div', 'media-image-header'), title = node('h2'), close = node('button', '', '✕');
    title.id = titleId; close.setAttribute('aria-label', 'إغلاق الصور'); header.append(title, close);
    const stage = node('div', 'media-image-stage'), photo = node('img'), status = node('p', 'media-image-status');
    status.setAttribute('role', 'status');
    const retry = node('button', 'media-image-retry', 'إعادة تحميل الصورة'); retry.hidden = true;
    stage.append(photo, status, retry);
    const tools = node('div', 'media-image-tools'), previous = node('button', '', '→ السابقة'), next = node('button', '', 'التالية ←');
    const counter = node('span'), zoom = node('button', '', 'تكبير الصورة');
    counter.setAttribute('aria-live', 'polite'); zoom.setAttribute('aria-pressed', 'false');
    tools.append(previous, counter, next, zoom);
    const thumbs = node('div', 'media-image-thumbs');
    viewer.append(header, stage, tools, thumbs); document.body.append(viewer);
    const inert = [...document.body.children].filter(el => el !== viewer).map(el => [el, el.inert]);
    inert.forEach(([el]) => { el.inert = true; }); document.body.classList.add('media-image-open');
    const historyKey = 'image-' + Date.now() + '-' + sequence;
    let historyAdded = false, closed = false, current = 0, touch = null;
    try { history.pushState({ ...history.state, mediaImage: historyKey }, '', location.href); historyAdded = true; } catch (_) {}
    function cleanup(fromHistory = false) {
      if (closed) return;
      closed = true; root.removeEventListener('popstate', onPop); root.removeEventListener('pagehide', onPop);
      document.removeEventListener('keydown', onKey, true); photo.removeAttribute('src'); viewer.remove();
      inert.forEach(([el, value]) => { el.inert = value; }); document.body.classList.remove('media-image-open'); active = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      if (!fromHistory && historyAdded && history.state?.mediaImage === historyKey) history.back();
    }
    function onPop() { cleanup(true); }
    function show(value) {
      current = (value + images.length) % images.length;
      const item = images[current]; title.textContent = item.title || 'صور الإعلان';
      counter.textContent = `${current + 1} / ${images.length}`;
      stage.classList.remove('is-zoomed'); zoom.setAttribute('aria-pressed', 'false'); zoom.textContent = 'تكبير الصورة';
      status.textContent = 'جارٍ تحميل الصورة…'; status.hidden = false; retry.hidden = true;
      photo.alt = item.title || 'صورة الإعلان'; photo.src = item.url;
      [...thumbs.children].forEach((button, i) => button.setAttribute('aria-current', String(i === current)));
      previous.disabled = next.disabled = images.length < 2;
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); return; }
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); show(current + (event.key === 'ArrowLeft' ? 1 : -1)); }
      if (event.key === 'Tab') {
        const focusable = [...viewer.querySelectorAll('button:not([disabled])')].filter(el => !el.hidden);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    images.forEach((item, i) => {
      const button = node('button'), image = node('img'); image.src = item.url; image.alt = ''; image.loading = 'lazy';
      button.setAttribute('aria-label', `عرض الصورة ${i + 1}`); button.append(image); button.onclick = () => show(i); thumbs.append(button);
    });
    photo.onload = () => { status.hidden = true; retry.hidden = true; };
    photo.onerror = () => { status.textContent = 'تعذر تحميل الصورة. يمكنك إعادة المحاولة أو الانتقال إلى صورة أخرى.'; status.hidden = false; retry.hidden = false; };
    retry.onclick = () => { photo.removeAttribute('src'); show(current); };
    close.onclick = () => cleanup(); previous.onclick = () => show(current - 1); next.onclick = () => show(current + 1);
    zoom.onclick = () => { const value = stage.classList.toggle('is-zoomed'); zoom.setAttribute('aria-pressed', String(value)); zoom.textContent = value ? 'إظهار الصورة كاملة' : 'تكبير الصورة'; };
    stage.addEventListener('touchstart', event => { touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }, { passive: true });
    stage.addEventListener('touchend', event => {
      if (!touch || stage.classList.contains('is-zoomed') || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y; touch = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) show(current + (dx > 0 ? 1 : -1));
    }, { passive: true });
    root.addEventListener('popstate', onPop); root.addEventListener('pagehide', onPop); document.addEventListener('keydown', onKey, true);
    active = { close: cleanup }; show(index); close.focus({ preventScroll: true });
  }
  function mount(container, entries, title = 'الصور والفيديوهات') {
    entries = entries.filter(item => safeUrl(item.url)); container.replaceChildren(); container.classList.add('media-gallery');
    const heading = node('h3', '', title), filters = node('div', 'media-gallery-filters'), grid = node('div', 'media-gallery-grid');
    filters.setAttribute('aria-label', 'تصفية الوسائط'); container.append(heading, filters, grid);
    const photos = entries.filter(item => item.type === 'image');
    function render(filter) {
      grid.replaceChildren(); [...filters.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
      const selected = entries.filter(item => filter === 'all' || item.type === filter);
      if (!selected.length) { grid.append(node('p', 'media-gallery-empty', filter === 'video' ? 'لا توجد فيديوهات مسجلة لهذا العرض.' : filter === 'image' ? 'لا توجد صور مسجلة لهذا العرض.' : 'لا توجد صور أو فيديوهات مسجلة لهذا العرض.')); return; }
      selected.forEach(item => {
        const button = node('button', 'media-gallery-item'), preview = node('span', 'media-gallery-preview');
        button.setAttribute('aria-label', (item.type === 'video' ? 'تشغيل الفيديو: ' : 'فتح الصورة: ') + item.title);
        const url = item.type === 'image' ? item.url : item.poster;
        if (url) { const image = node('img'); image.src = url; image.alt = ''; image.loading = 'lazy'; image.onerror = () => { preview.replaceChildren(node('span', '', item.type === 'video' ? '▶ فيديو' : 'فتح الصورة')); }; preview.append(image); }
        if (item.type === 'video') preview.append(node('span', 'media-gallery-play', '▶ فيديو'));
        button.append(preview, node('span', 'media-gallery-caption', item.title || (item.type === 'video' ? 'فيديو' : 'صورة')));
        button.onclick = () => { if (item.type === 'image') open(photos, photos.indexOf(item)); else if (root.PropertyVideo) root.PropertyVideo.open({ url: item.url, title: item.title, poster_url: item.poster }); };
        grid.append(button);
      });
    }
    for (const [filter, label, count] of [['all', 'الكل', entries.length], ['image', 'الصور', photos.length], ['video', 'الفيديوهات', entries.length - photos.length]]) {
      const button = node('button', '', `${label} (${count})`); button.dataset.filter = filter; button.onclick = () => render(filter); filters.append(button);
    }
    render('all');
  }
  root.MediaGallery = { array, safeUrl, items, mount, open };
})(typeof window === 'undefined' ? null : window);
