/* Public Facebook video controls: no sign-in, Graph API request, or access token. */
(function () {
  'use strict';
  let sdkPromise, sequence = 0;
  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('Facebook SDK timeout')), 12000);
      script.src = 'https://connect.facebook.net/ar_AR/sdk.js';
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        clearTimeout(timer);
        try {
          window.FB.init({version:'v23.0', xfbml:false, cookie:false, status:false});
          resolve(window.FB);
        } catch (error) { reject(error); }
      };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Facebook SDK unavailable')); };
      document.head.append(script);
    }).catch(error => { sdkPromise = null; throw error; });
    return sdkPromise;
  }
  function mount({stage, url, onReady = () => {}, onPlaying = () => {}, onError = () => {}}) {
    let disposed = false, api, player, readyHandler, timer, didStart = false;
    const subscriptions = [];
    const host = document.createElement('div');
    host.className = 'facebook-video-host';
    host.style.cssText = 'position:absolute;left:50%;top:50%;width:500px;height:889px;transform:translate(-50%,-50%);transform-origin:center;';
    const widget = document.createElement('div');
    widget.id = 'aqartcom-facebook-' + (++sequence);
    widget.className = 'fb-video';
    widget.setAttribute('data-href', url);
    widget.setAttribute('data-width', '500');
    widget.setAttribute('data-allowfullscreen', 'true');
    widget.setAttribute('data-autoplay', 'true');
    widget.setAttribute('data-show-text', 'false');
    host.append(widget); stage.append(host);
    function fit() {
      const frame = host.querySelector('iframe');
      if (!frame) return;
      const allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      if (frame.getAttribute('allow') !== allow) frame.setAttribute('allow', allow);
      frame.allowFullscreen = true;
      frame.title = 'فيديو العقار من فيسبوك';
      const width = Number(frame.getAttribute('width')) || 500;
      const height = Number(frame.getAttribute('height')) || 889;
      const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
      host.style.width = width + 'px'; host.style.height = height + 'px';
      host.style.transform = `translate(-50%,-50%) scale(${Math.max(.01, scale)})`;
    }
    const observer = new MutationObserver(fit);
    observer.observe(host, {childList:true, subtree:true, attributes:true, attributeFilter:['width','height']});
    const resize = window.ResizeObserver ? new ResizeObserver(fit) : null;
    resize?.observe(stage);
    window.addEventListener('resize', fit);
    function playWithSound() {
      if (disposed || !player) return;
      player.unmute(); player.setVolume(1); player.play();
    }
    function fail(error) {
      if (disposed) return;
      clearTimeout(timer);
      onError(error);
    }
    loadSdk().then(FB => {
      if (disposed) return;
      api = FB;
      readyHandler = message => {
        if (disposed || message.type !== 'video' || message.id !== widget.id) return;
        clearTimeout(timer);
        api.Event.unsubscribe('xfbml.ready', readyHandler);
        readyHandler = null;
        player = message.instance;
        subscriptions.push(['startedPlaying', player.subscribe('startedPlaying', () => {
          if (disposed) return;
          // Some provider versions apply a default mute when playback starts.
          // Correct it once, then respect subsequent user mute/volume choices.
          if (!didStart) { didStart = true; player.unmute(); player.setVolume(1); }
          onPlaying();
        })]);
        subscriptions.push(['error', player.subscribe('error', fail)]);
        fit(); onReady(); playWithSound();
      };
      api.Event.subscribe('xfbml.ready', readyHandler);
      timer = setTimeout(() => fail(new Error('Facebook video controls unavailable')), 15000);
      api.XFBML.parse(host);
    }).catch(fail);
    return {
      playWithSound,
      destroy() {
        if (disposed) return;
        disposed = true; clearTimeout(timer);
        if (api && readyHandler) api.Event.unsubscribe('xfbml.ready', readyHandler);
        subscriptions.forEach(([event, subscription]) => { try { subscription.release(event); } catch (_) {} });
        try { player?.pause(); } catch (_) {}
        observer.disconnect(); resize?.disconnect(); window.removeEventListener('resize', fit);
        host.querySelectorAll('iframe').forEach(frame => { frame.src = 'about:blank'; });
        host.remove();
      }
    };
  }
  window.FacebookPropertyPlayer = {mount};
})();
