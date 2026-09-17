const CACHE='aqartkom-v93-sol-shell-v2';
const SHELL=['/site-ui.js','/site-ui.css','/offline.html','/icons/icon-192.png','/icons/icon-512.png','/sol.html','/sol.css','/sol.js','/sol-config.js','/sol-knowledge.js','/sol-storage.js','/sol-worker.js','/manifest.webmanifest'];
const PRESERVE=['aqartkom-sol-models-v1','aqartkom-sol-runtime-v1'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aqartkom-')&&k!==CACHE&&!PRESERVE.includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;const u=new URL(e.request.url);
 if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
 if(/^\/sol-runtime\/3\.8\.1\/(transformers\.min\.mjs|ort-wasm-simd-threaded\.jsep\.(mjs|wasm))$/.test(u.pathname)){
  e.respondWith(caches.open('aqartkom-sol-runtime-v1').then(async cache=>await cache.match(u.pathname)||fetch(e.request)));return;
 }
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request).then(async response=>{if(response.ok)return response;return (u.pathname==='/sol.html'?await caches.match('/sol.html'):null)||response;}).catch(()=>caches.match(u.pathname==='/sol.html'?'/sol.html':'/offline.html')));
 }else if(SHELL.includes(u.pathname)){
  // Pinned Sol shell files must match the page/worker cached for this release.
  e.respondWith(caches.open(CACHE).then(async cache=>await cache.match(u.pathname)||fetch(e.request)));
 }
});
self.addEventListener('push',e=>{let d={};try{d=e.data?.json()||{}}catch{d={body:e.data?.text()||''}};e.waitUntil(self.registration.showNotification(d.title||'عقارتكم',{body:d.body||'لديك تحديث جديد',icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',dir:'rtl',lang:'ar',data:{url:d.url||'/'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();let url=new URL('/',location.origin);try{const candidate=new URL(e.notification.data?.url||'/',url);if(candidate.origin===url.origin)url=candidate;}catch{}e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async ws=>{const w=ws.find(w=>new URL(w.url).origin===url.origin);if(w){await w.navigate(url.href);return w.focus();}return clients.openWindow(url.href);}));});
