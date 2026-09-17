/* One full-screen viewer for uploaded files and supported video providers. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function resolveVideo(value, base = 'https://aqartcom-v93.onrender.com/') {
    let url;
    try { url = new URL(String(value || ''), base); } catch (_) { return null; }
    if (!value || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = host.endsWith('youtu.be') ? parts[0] : url.searchParams.get('v') || (['embed','shorts','live'].includes(parts[0]) ? parts[1] : '');
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) return {type:'external', url:url.href};
      return {type:'youtube', url:`https://www.youtube.com/watch?v=${id}`, embed:`https://www.youtube-nocookie.com/embed/${id}?autoplay=0&rel=0&playsinline=1`, poster:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`};
    }
    if (['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com'].includes(host)) {
      const match = url.pathname.match(/\/(?:videos|reel)\/(?:[^/]+\/)?(\d+)\/?$/);
      const id = match?.[1] || (/^\/watch\/?$/.test(url.pathname) ? url.searchParams.get('v') : '');
      if (/^\d+$/.test(id || '')) {
        const source = match ? `https://www.facebook.com${url.pathname}` : `https://www.facebook.com/watch/?v=${id}`;
        // Facebook starts autoplay embeds muted even when mute=false. Let the
        // viewer press Facebook's play control so playback can begin with sound.
        return {type:'facebook', url:source, embed:`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(source)}&show_text=false&autoplay=false&mute=false&allowfullscreen=true`};
      }
    }
    if (['tiktok.com','www.tiktok.com','m.tiktok.com'].includes(host)) {
      const id = url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)?.[1];
      if (id) return {type:'tiktok', url:url.href, embed:`https://www.tiktok.com/player/v1/${id}?autoplay=0&controls=1&muted=0`};
    }
    return {type:/\.(mp4|webm|mov|m4v|ogv)$/i.test(url.pathname) ? 'file' : 'external', url:url.href};
  }
  function preview(video, poster = '') {
    const resolved = resolveVideo(video?.url);
    const image = resolved?.poster || poster;
    return `<button type="button" class="property-video-launch" data-property-video="${esc(JSON.stringify(video))}" aria-label="${esc('تشغيل بملء الشاشة: ' + (video?.title || 'فيديو العقار'))}">${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : ''}<span class="video-launch-icon" aria-hidden="true">▶</span><span class="video-launch-caption">شاهد بملء الشاشة</span></button>`;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {resolveVideo, preview};
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let active = null;
  function open(video) {
    const source = resolveVideo(video?.url, location.href);
    if (!source) return;
    if (active) return;
    const returnFocus = document.activeElement;
    const viewer = document.createElement('div');
    viewer.className = 'property-video-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-labelledby', 'videoViewerTitle');
    viewer.setAttribute('dir', 'rtl');
    const provider = {file:'فيديو العقار', youtube:'YouTube', facebook:'فيسبوك', tiktok:'تيك توك', external:'فيديو خارجي'}[source.type];
    viewer.innerHTML = `<div class="video-viewer-header"><div><small>${provider}</small><h2 id="videoViewerTitle">${esc(video.title || 'جولة في العقار')}</h2></div><button type="button" class="video-viewer-close" aria-label="إغلاق الفيديو" title="إغلاق الفيديو">✕</button></div><div class="video-viewer-stage"></div><div class="video-viewer-footer"><div class="video-viewer-tools"></div><button type="button" class="video-viewer-return">العودة إلى الإعلان</button></div>`;
    document.body.append(viewer);
    const stage = viewer.querySelector('.video-viewer-stage');
    const tools = viewer.querySelector('.video-viewer-tools');
    const closeButton = viewer.querySelector('.video-viewer-close');
    let media = null, frameObserver = null, closed = false, enteredFullscreen = false, historyAdded = false;
    const historyKey = 'video-' + Date.now();
    const inertElements = Array.from(document.body.children).filter(el => el !== viewer).map(el => [el, el.inert]);
    inertElements.forEach(([el]) => { el.inert = true; });
    document.body.classList.add('video-viewer-open');
    try { history.pushState({...history.state, propertyVideo:historyKey}, '', location.href); historyAdded = true; } catch (_) {}
    function close(fromHistory = false) {
      if (closed) return;
      closed = true;
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      window.removeEventListener('pagehide', onHide);
      frameObserver?.disconnect();
      window.removeEventListener('resize', fitFrame);
      if (media?.tagName === 'VIDEO') {
        media.pause();
        if (document.pictureInPictureElement === media) document.exitPictureInPicture?.().catch(() => {});
        media.removeAttribute('src'); media.load();
      } else if (media) { media.src = 'about:blank'; }
      if (document.fullscreenElement && viewer.contains(document.fullscreenElement)) document.exitFullscreen?.().catch(() => {});
      else if (document.webkitFullscreenElement && viewer.contains(document.webkitFullscreenElement)) document.webkitExitFullscreen?.();
      viewer.remove();
      inertElements.forEach(([el, wasInert]) => { el.inert = wasInert; });
      document.body.classList.remove('video-viewer-open');
      active = null;
      if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
      if (!fromHistory && historyAdded && history.state?.propertyVideo === historyKey) history.back();
    }
    function onPop() { close(true); }
    function onHide() { close(true); }
    function onFullscreen() {
      const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreen && (fullscreen === viewer || viewer.contains(fullscreen))) enteredFullscreen = true;
      else if (enteredFullscreen && !fullscreen) close();
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(viewer.querySelectorAll('button:not([disabled]), a[href], select, video, iframe')).filter(el => !el.hidden);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function requestFullscreen() {
      try {
        const result = viewer.requestFullscreen ? viewer.requestFullscreen({navigationUI:'hide'}) : viewer.webkitRequestFullscreen?.();
        // The viewport-sized viewer remains usable when fullscreen is denied (e.g. embedded browsers).
        result?.catch(() => {});
      } catch (_) {}
    }
    function fitFrame() {
      if (!media || !['facebook','tiktok'].includes(source.type)) return;
      // Facebook sizes its embedded reels by width; a wide iframe crops their controls.
      // A portrait-safe width also accommodates landscape clips without clipping.
      media.style.width = Math.max(1, Math.min(stage.clientWidth, stage.clientHeight * 9 / 16)) + 'px';
    }
    active = {close};
    closeButton.onclick = () => close();
    viewer.querySelector('.video-viewer-return').onclick = () => close();
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    if (source.type === 'file') {
      media = document.createElement('video');
      media.controls = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.muted = false;
      media.src = source.url;
      media.setAttribute('aria-label', video.title || 'فيديو العقار');
      stage.append(media);
      const status = document.createElement('p');
      status.className = 'video-viewer-status'; status.setAttribute('role', 'status');
      status.textContent = 'جاري تحميل الفيديو…'; stage.append(status);
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'video-viewer-retry'; retry.textContent = '▶ تشغيل الفيديو'; retry.hidden = true; stage.append(retry);
      function play() { const promise = media.play(); promise?.catch(() => { if (!closed && !media.error) { status.textContent = 'اضغط لتشغيل الفيديو بالصوت'; status.hidden = false; retry.hidden = false; } }); }
      retry.onclick = play;
      media.addEventListener('playing', () => { status.hidden = true; retry.hidden = true; });
      media.addEventListener('waiting', () => { status.textContent = 'جاري التحميل…'; status.hidden = false; });
      media.addEventListener('error', () => { status.hidden = false; status.textContent = 'تعذر تشغيل هذا الفيديو. أغلق المشغّل وحاول مرة أخرى.'; retry.hidden = true; });
      tools.innerHTML = '<button type="button" data-seek="-10" aria-label="رجوع 10 ثوانٍ">↶ 10</button><label>السرعة <select aria-label="سرعة الفيديو"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" data-seek="10" aria-label="تقديم 10 ثوانٍ">10 ↷</button>';
      tools.querySelectorAll('[data-seek]').forEach(button => { button.onclick = () => { if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + Number(button.dataset.seek))); }; });
      tools.querySelector('select').onchange = event => { media.playbackRate = Number(event.target.value); };
      // Start sound while the original tap is active, before fullscreen consumes it.
      play();
      requestFullscreen();
      if (!viewer.requestFullscreen && !viewer.webkitRequestFullscreen && media.webkitEnterFullscreen) {
        const nativeFullscreen = () => { if (!closed) { try { media.webkitEnterFullscreen(); } catch (_) {} } };
        media.addEventListener('loadedmetadata', nativeFullscreen, {once:true});
        media.addEventListener('webkitendfullscreen', () => close(), {once:true});
      }
    } else if (source.embed) {
      media = document.createElement('iframe');
      media.title = video.title || 'فيديو العقار';
      media.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      media.allowFullscreen = true;
      media.referrerPolicy = 'strict-origin-when-cross-origin';
      // Provider controls may play media, but cannot open apps/tabs or navigate this page.
      media.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      media.src = source.embed;
      stage.append(media);
      if (['facebook','tiktok'].includes(source.type)) {
        fitFrame();
        if (window.ResizeObserver) { frameObserver = new ResizeObserver(fitFrame); frameObserver.observe(stage); }
        window.addEventListener('resize', fitFrame);
      }
      tools.textContent = 'اضغط ▶ داخل الفيديو للتشغيل. للإغلاق اضغط × أو زر الرجوع.';
      requestFullscreen();
    } else {
      stage.innerHTML = '<p class="video-viewer-message">هذا الرابط غير مدعوم في المشغّل الداخلي. اضغط «العودة إلى الإعلان» لإغلاق النافذة.</p>';
      requestFullscreen();
    }
    closeButton.focus({preventScroll:true});
  }
  window.PropertyVideo = {open, preview, resolveVideo};
  document.addEventListener('click', function (event) {
    const trigger = event.target.closest('[data-property-video], a.marei-preview');
    if (!trigger || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    let video;
    if (trigger.hasAttribute('data-property-video')) {
      try { video = JSON.parse(trigger.dataset.propertyVideo); } catch (_) { return; }
    } else video = {url:trigger.href, title:trigger.dataset.videoTitle || trigger.getAttribute('aria-label') || 'فيديو العقار'};
    if (!resolveVideo(video?.url, location.href)) return;
    event.preventDefault(); event.stopPropagation(); open(video);
  });
})();
