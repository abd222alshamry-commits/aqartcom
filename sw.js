'use strict';
const CACHE='aqartkom-offline-v2';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.add('offline.html')));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aqartkom-offline-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// Never cache account data, property responses, POST requests, or phone numbers.
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&event.request.method==='GET'&&new URL(event.request.url).origin===self.location.origin){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('offline.html'))));}});
