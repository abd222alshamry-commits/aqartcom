'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('express');
const root = path.resolve(__dirname, '..');

test('HTTP public assets are served, internal files are not', async t => {
  const app = express(); app.use(require('../server/public-files')(root)); app.use((_req, res) => res.sendStatus(404));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const url of ['/', '/property.html', '/advertiser-contact.js', '/manifest.webmanifest', '/icons/icon-192.png', '/assets/property-building.webp', '/assets/property-interior.webp', '/assets/property-villa.webp']) {
    const res = await fetch(base + url); assert.equal(res.status, 200, url); await res.arrayBuffer();
  }
  for (const url of ['/server/server.js', '/server/db/schema.sql', '/package.json', '/package-lock.json', '/scripts_setup_notifications.js', '/.env', '/private_uploads/request-chat/example.pdf', '/backups/db.sql', '/mobile/ios/project.yml', '/server%2fserver.js', '/unknown.html']) {
    const res = await fetch(base + url); assert.equal(res.status, 404, url); await res.arrayBuffer();
  }
  assert.equal((await fetch(base + '/')).headers.get('cache-control'), 'no-store');
});

test('advertiser contacts normalize numerals and do not guess country codes', () => {
  const context = {}; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'advertiser-contact.js'), 'utf8'), context);
  const links = context.advertiserContactLinks;
  assert.equal(links('٠٠٩٦٣ ٩٤٤ ١٢٣ ٤٥٦', 'منزل', 'https://example.test/property.html?id=1').tel, 'tel:+963944123456');
  assert.match(links('+۹۶۳۹۴۴۱۲۳۴۵۶', 'منزل', 'https://example.test').whatsappUrl, /^https:\/\/wa.me\/963944123456\?text=/);
  assert.equal(links('0944123456', '', '').whatsappUrl, null);
  assert.equal(links('javascript:alert(1)', '', ''), null);
  assert.equal(links('', '', ''), null);
  const wa = new URL(links('+963944123456', 'منزل & أرض', 'https://example.test/?id=1&x=2').whatsappUrl);
  assert.match(wa.searchParams.get('text'), /منزل & أرض/);
});

function worker() {
  const handlers = {}, deleted = [], opened = [], cached = [];
  const context = {URL, location: {origin: 'https://aqartkom.test'}, fetch: async () => { throw Error('offline'); },
    caches: {keys: async () => ['aqartkom-v60-shell-v1', 'aqartkom-v92-public-v1', 'aqartkom-v93-theme-v1', 'aqartkom-v93-sol-shell-v1', 'aqartkom-sol-models-v1', 'aqartkom-sol-runtime-v1', 'other-app'], delete: async k => deleted.push(k), match: async k => ({cached: k}), open: async () => ({addAll: async list => cached.push(...list)})},
    clients: {claim: async () => {}, matchAll: async () => [], openWindow: async u => opened.push(u)},
    self: {addEventListener: (name, callback) => { handlers[name] = callback; }, skipWaiting: async () => {}}};
  context.self.clients = context.clients;
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), context);
  return {handlers, deleted, opened, cached};
}
test('offline cache excludes personal pages and removes only app-owned older caches', async () => {
  const w = worker(); let work;
  w.handlers.install({waitUntil: p => work = p}); await work;
  assert.deepEqual(w.cached, ['/site-ui.js', '/site-ui.css', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/sol.html', '/sol.css', '/sol.js', '/sol-config.js', '/sol-knowledge.js', '/sol-storage.js', '/sol-worker.js', '/manifest.webmanifest']);
  w.handlers.activate({waitUntil: p => work = p}); await work;
  assert.deepEqual(w.deleted, ['aqartkom-v60-shell-v1', 'aqartkom-v92-public-v1', 'aqartkom-v93-theme-v1']);
});
test('API and attachments never receive cached responses; navigation gets offline page', async () => {
  const w = worker();
  for (const suffix of ['/api/me', '/private_uploads/chat.pdf', '/uploads/image.png']) {
    let intercepted = false;
    w.handlers.fetch({request: {method: 'GET', url: 'https://aqartkom.test' + suffix, mode: 'cors'}, respondWith: () => { intercepted = true; }});
    assert.equal(intercepted, false, suffix);
  }
  let response;
  w.handlers.fetch({request: {method: 'GET', url: 'https://aqartkom.test/messages.html', mode: 'navigate'}, respondWith: p => response = p});
  assert.equal((await response).cached, '/offline.html');
});
test('push clicks cannot open an outside origin', async () => {
  const w = worker(); let work;
  w.handlers.notificationclick({notification: {close() {}, data: {url: 'https://evil.test/'}}, waitUntil: p => work = p});
  await work; assert.deepEqual(w.opened, ['https://aqartkom.test/']);
});

test('iPhone install help is visible outside standalone and hidden in native app', () => {
  for (const [agent, hidden] of [['iPhone Safari', false], ['iPhone AqartkomNative/92', true]]) {
    const button = {hidden: true, addEventListener() {}};
    const context = {navigator: {userAgent: agent, platform: 'iPhone', standalone: false}, document: {getElementById: id => id === 'installApp' ? button : null}, addEventListener() {}, matchMedia: () => ({matches: false}), window: {}};
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'pwa.js'), 'utf8'), context);
    assert.equal(button.hidden, hidden);
  }
});
