/* A real provider play button receives the first tap, then the same player expands.
   Keeping its iframe in place preserves the gesture, sound, and playback position. */
(function () {
  'use strict';
  if (!window.FacebookPropertyPlayer || !window.PropertyVideo) return;
  const entries = new Map(), seen = new WeakSet();
  let expanded = null, serial = 0;
  function lockOutside(viewer) {
    const saved = [];
    for (let node = viewer; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children || []) {
        if (sibling !== node) { saved.push([sibling, sibling.inert]); sibling.inert = true; }
      }
    }
    return () => saved.forEach(([element, inert]) => { element.inert = inert; });
  }
  function expand(entry) {
    if (expanded === entry) return;
    expanded?.close();
    const {viewer, controller, closeButton} = entry;
    viewer.classList.remove('video-inline-preview');
    viewer.classList.add('property-video-viewer');
    viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-modal', 'true');
    document.body.classList.add('video-viewer-open');
    const unlock = lockOutside(viewer);
    const key = 'facebook-' + Date.now();
    let hasHistory = false, hasFullscreen = false, closed = false;
    try { history.pushState({...history.state, propertyVideo:key}, '', location.href); hasHistory = true; } catch (_) {}
    function onPop() { close(true); }
    function onFullscreen() {
      if (document.fullscreenElement === viewer || document.webkitFullscreenElement === viewer) hasFullscreen = true;
      else if (hasFullscreen) close();
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const first = closeButton, last = viewer.querySelector('.video-viewer-source');
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function close(fromHistory = false) {
      if (closed) return;
      closed = true;
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      controller.pause();
      if (document.fullscreenElement === viewer) document.exitFullscreen?.().catch(() => {});
      else if (document.webkitFullscreenElement === viewer) document.webkitExitFullscreen?.();
      viewer.classList.remove('property-video-viewer'); viewer.classList.add('video-inline-preview');
      viewer.removeAttribute('role'); viewer.removeAttribute('aria-modal');
      unlock(); document.body.classList.remove('video-viewer-open');
      if (expanded === entry) expanded = null;
      viewer.querySelector('iframe')?.focus({preventScroll:true});
      if (!fromHistory && hasHistory && history.state?.propertyVideo === key) history.back();
    }
    entry.close = close; expanded = entry;
    closeButton.onclick = event => { event.stopPropagation(); close(); };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    // The click inside Facebook also activates ancestor windows in supporting browsers.
    try { (viewer.requestFullscreen ? viewer.requestFullscreen({navigationUI:'hide'}) : viewer.webkitRequestFullscreen?.())?.catch(() => {}); } catch (_) {}
    closeButton.focus({preventScroll:true});
  }
  function prepare(trigger) {
    if (!trigger.isConnected || entries.has(trigger)) return;
    let video;
    try { video = trigger.dataset.propertyVideo ? JSON.parse(trigger.dataset.propertyVideo) : {url:trigger.href, title:trigger.dataset.videoTitle}; } catch (_) { return; }
    const source = window.PropertyVideo.resolveVideo(video?.url, location.href);
    if (source?.type !== 'facebook') return;
    const box = document.createElement('div');
    box.className = trigger.classList.contains('marei-preview') ? 'marei-preview' : 'property-video-launch';
    trigger.replaceWith(box); box.append(trigger);
    trigger.className = 'facebook-preview-fallback';
    trigger.dataset.propertyVideo = JSON.stringify(video);
    const viewer = document.createElement('div');
    viewer.className = 'video-inline-preview'; viewer.dir = 'rtl';
    const titleId = 'facebook-inline-title-' + (++serial);
    viewer.setAttribute('aria-labelledby', titleId);
    const header = document.createElement('div'); header.className = 'video-viewer-header';
    const titleBox = document.createElement('div');
    const brand = document.createElement('small'); brand.textContent = 'فيسبوك';
    const title = document.createElement('h2'); title.id = titleId; title.textContent = video.title || 'فيديو العقار';
    titleBox.append(brand, title);
    const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.className = 'video-viewer-close'; closeButton.textContent = '✕'; closeButton.setAttribute('aria-label', 'إغلاق الفيديو');
    header.append(titleBox, closeButton);
    const stage = document.createElement('div'); stage.className = 'video-viewer-stage';
    const footer = document.createElement('div'); footer.className = 'video-viewer-footer';
    const note = document.createElement('span'); note.className = 'video-viewer-tools'; note.textContent = 'تحكم بالصوت من رمز السماعة داخل الفيديو.';
    const original = document.createElement('a'); original.className = 'video-viewer-source'; original.href = source.url; original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = 'فتح الفيديو الأصلي ↗';
    footer.append(note, original); viewer.append(header, stage, footer); box.append(viewer);
    const entry = {box, viewer, closeButton, controller:null, close:() => {}};
    entries.set(trigger, entry);
    entry.controller = window.FacebookPropertyPlayer.mount({stage, url:source.url,
      onReady() { if (box.isConnected) { trigger.hidden = true; viewer.classList.add('video-inline-ready'); } },
      onPlaying() { if (box.isConnected) expand(entry); },
      onError() { entry.close(); entry.controller?.destroy(); viewer.remove(); trigger.hidden = false; }
    });
  }
  const observer = window.IntersectionObserver ? new IntersectionObserver(items => {
    items.forEach(item => { if (item.isIntersecting) { observer.unobserve(item.target); prepare(item.target); } });
  }, {rootMargin:'350px 0px'}) : null;
  function scan() {
    document.querySelectorAll('a.marei-preview, button.property-video-launch[data-property-video]').forEach(trigger => {
      if (seen.has(trigger)) return; seen.add(trigger);
      if (observer) observer.observe(trigger); else prepare(trigger);
    });
    for (const [trigger, entry] of entries) {
      if (!entry.box.isConnected) { entry.close(true); entry.controller.destroy(); entries.delete(trigger); }
    }
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; scan(); }); }
  }).observe(document.body, {childList:true, subtree:true});
  // Preserve ready iframes in the back/forward cache; only stop their playback.
  window.addEventListener('pagehide', () => { expanded?.close(true); entries.forEach(entry => entry.controller.pause()); });
  scan();
})();
