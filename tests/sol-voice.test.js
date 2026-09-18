'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {JSDOM} = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const localVoice = {lang: 'ar-SA', name: 'عربي محلي', localService: true};
async function setup(t, options = {}) {
  const dom = new JSDOM(source('sol.html'), {url: 'https://test.invalid/sol.html', runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window, doc = w.document, sessions = [], spoken = [], requests = [];
  let available = options.available || 'unavailable', canceled = 0, installed = 0, voiceList = options.voices || [localVoice];
  class Recognition {
    constructor() { sessions.push(this); }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    static async available() { return typeof available === 'function' ? available() : available; }
    static async install() { installed++; available = 'available'; return true; }
  }
  if (options.local !== false) Recognition.prototype.processLocally = false;
  if (!options.unsupported) w.SpeechRecognition = Recognition;
  const synthesisEvents = {};
  w.speechSynthesis = {getVoices: () => voiceList, speak: u => spoken.push(u), cancel: () => canceled++, addEventListener: (name, fn) => synthesisEvents[name] = fn};
  w.SpeechSynthesisUtterance = class {constructor(text) { this.text = text; }};
  w.fetch = async (...args) => { requests.push(args); throw Error('Unexpected request'); };
  Object.defineProperty(w.navigator, 'onLine', {value: options.connected !== false, configurable: true});
  w.eval(source('sol-voice.js'));
  const voice = w.SolVoice.create({textarea: doc.getElementById('question')});
  t.after(() => { voice.stop(); dom.window.close(); });
  await tick();
  const $ = id => doc.getElementById(id);
  const change = (id, value) => { $(id).checked = value; $(id).dispatchEvent(new w.Event('change')); };
  function result(recognition, entries) {
    recognition.onresult({results: entries.map(([transcript, isFinal]) => Object.assign([{transcript}], {isFinal}))});
  }
  return {w, doc, $, sessions, spoken, requests, voice, change, result, canceled: () => canceled, installed: () => installed,
    setAvailable: v => { available = v; }, setVoices: v => { voiceList = v; synthesisEvents.voiceschanged?.(); }};
}
test('remote speech stays off until explicit opt-in, then inserts Arabic without sending', async t => {
  const p = await setup(t, {local: false});
  assert.equal(p.$('voiceOnline').checked, false);
  p.$('voiceMic').click(); await tick(); assert.equal(p.sessions.length, 0);
  p.change('voiceOnline', true); await tick();
  p.$('question').value = 'أبحث عن'; p.$('voiceMic').click(); await tick();
  const r = p.sessions[0]; assert.equal(r.lang, 'ar-SA'); assert.equal(r.started, true);
  let submissions = 0; p.$('chatForm').addEventListener('submit', e => { e.preventDefault(); submissions++; });
  p.result(r, [['شقة في دمشق', true]]); r.onend();
  assert.equal(p.$('question').value, 'أبحث عن شقة في دمشق');
  assert.equal(p.$('question').readOnly, false); assert.equal(submissions, 0);
  assert.equal(p.requests.length, 0); assert.match(p.$('voiceStatus').textContent, /راجع/);
});
test('offline recognition strictly uses on-device processing and final results do not duplicate', async t => {
  const p = await setup(t, {available: 'available', connected: false});
  p.$('voiceMic').click(); await tick(); const r = p.sessions[0];
  assert.equal(r.processLocally, true);
  p.result(r, [['فندق', true], ['في حم', false]]);
  p.result(r, [['فندق', true], ['في حماة', true]]); r.onend();
  assert.equal(p.$('question').value, 'فندق في حماة'); assert.equal(p.requests.length, 0);
});
test('permission failure restores typing and permits retry without auto-restart', async t => {
  const p = await setup(t, {available: 'available'});
  p.$('voiceMic').click(); await tick(); const r = p.sessions[0];
  r.onerror({error: 'not-allowed'});
  assert.equal(p.$('question').readOnly, false); assert.equal(p.$('voiceMic').disabled, false);
  assert.match(p.$('voiceStatus').textContent, /لم يُسمح/); assert.equal(p.sessions.length, 1);
  p.$('voiceMic').click(); await tick(); assert.equal(p.sessions.length, 2);
});
test('cancel while local capability check is pending never opens the microphone later', async t => {
  const p = await setup(t); let resolve;
  p.setAvailable(() => new Promise(r => { resolve = r; }));
  p.$('voiceMic').click(); assert.equal(p.$('voiceStop').hidden, false);
  p.$('voiceStop').click(); resolve('available'); await tick();
  assert.equal(p.sessions.length, 0); assert.equal(p.$('voiceMic').disabled, false);
});
test('cancel and busy state ignore late transcripts; input length remains bounded', async t => {
  const p = await setup(t, {available: 'available'});
  p.$('voiceMic').click(); await tick(); const r = p.sessions[0];
  p.result(r, [['ش'.repeat(1500), true]]); assert.equal(p.$('question').value.length, 1000);
  p.voice.setBusy(true); assert.equal(r.aborted, true); assert.equal(p.$('voiceMic').disabled, true);
  p.$('question').value = ''; p.result(r, [['متأخر', true]]); assert.equal(p.$('question').value, '');
  p.voice.setBusy(false); assert.equal(p.$('voiceMic').disabled, false);
});
test('online fallback is blocked offline and withdrawing permission aborts recognition', async t => {
  const p = await setup(t, {local: false});
  p.change('voiceOnline', true); await tick(); p.$('voiceMic').click(); await tick();
  const r = p.sessions[0]; p.change('voiceOnline', false); await tick(); assert.equal(r.aborted, true);
  Object.defineProperty(p.w.navigator, 'onLine', {value: false, configurable: true});
  p.change('voiceOnline', true); await tick(); p.$('voiceMic').click(); await tick();
  assert.equal(p.sessions.length, 1);
});
test('local speech uses an Arabic voice offline and complete long replies are spoken in chunks', async t => {
  const p = await setup(t, {connected: false, voices: [{lang: 'en-US', localService: true}, {lang: 'ar-SA', localService: false}, localVoice]});
  const body = p.doc.querySelector('.bubble p'); body.textContent = Array(150).fill('مرحبا').join(' ');
  p.voice.addReply(body); p.doc.querySelector('.sol-read').click();
  for (let i = 0; i < p.spoken.length; i++) { assert.equal(p.spoken[i].voice, localVoice); assert.ok(p.spoken[i].text.length <= 200); p.spoken[i].onend(); }
  assert.equal(p.spoken.map(u => u.text).join(' '), body.textContent);
  assert.match(p.$('voiceStatus').textContent, /انتهت/); assert.equal(p.requests.length, 0);
});
test('no Arabic voice gives useful feedback and never silently falls back to English', async t => {
  const p = await setup(t, {voices: [{lang: 'en-US', localService: true}]});
  const body = p.doc.querySelector('.bubble p'); p.voice.addReply(body); p.doc.querySelector('.sol-read').click();
  assert.equal(p.spoken.length, 0); assert.match(p.$('voiceStatus').textContent, /ثبّت صوتًا عربيًا/);
  p.setVoices([localVoice]); p.doc.querySelector('.sol-read').click(); assert.equal(p.spoken.length, 1);
});
test('remote TTS needs opt-in, stops offline, and cancellation prevents queued chunks', async t => {
  const p = await setup(t, {voices: [{lang: 'ar-SA', localService: false}]});
  const body = p.doc.querySelector('.bubble p'); body.textContent = 'كلمة '.repeat(200); p.voice.addReply(body);
  p.doc.querySelector('.sol-read').click(); assert.equal(p.spoken.length, 0);
  p.change('voiceOnline', true); await tick(); p.doc.querySelector('.sol-read').click();
  assert.equal(p.spoken.length, 1); const u = p.spoken[0];
  Object.defineProperty(p.w.navigator, 'onLine', {value: false, configurable: true}); p.w.dispatchEvent(new p.w.Event('offline'));
  u.onend(); assert.equal(p.spoken.length, 1); assert.equal(p.$('voiceStop').hidden, true);
});
test('pack download is user-initiated, and recognition waits until pack is installed', async t => {
  const p = await setup(t, {available: 'downloadable'});
  assert.equal(p.$('voiceInstall').hidden, false); assert.equal(p.installed(), 0);
  p.$('voiceMic').click(); await tick(); assert.equal(p.sessions.length, 0);
  p.$('voiceInstall').click(); await tick(); assert.equal(p.installed(), 1);
  p.$('voiceMic').click(); await tick(); assert.equal(p.sessions[0].processLocally, true);
});
test('unsupported browser preserves typed chat and disables unavailable microphone', async t => {
  const p = await setup(t, {unsupported: true});
  assert.equal(p.$('voiceMic').disabled, true); assert.equal(p.$('question').readOnly, false);
  assert.match(p.$('voiceStatus').textContent, /لوحة مفاتيح/);
});
test('Sol integration reads guide replies only when enabled and stops on new chat', async t => {
  const dom = new JSDOM(source('sol.html'), {url: 'https://test.invalid/sol.html', runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window, spoken = []; let cancellations = 0;
  w.speechSynthesis = {getVoices: () => [localVoice], cancel: () => cancellations++, speak: u => spoken.push(u)};
  w.SpeechSynthesisUtterance = class {constructor(text) { this.text = text; }};
  w.fetch = () => { throw Error('no network'); };
  for (const file of ['sol-config.js', 'sol-knowledge.js', 'sol-storage.js', 'sol-voice.js', 'sol.js']) w.eval(source(file));
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); }); await tick();
  const $ = id => w.document.getElementById(id);
  $('question').value = 'كيف أضيف فندقًا؟'; $('chatForm').dispatchEvent(new w.Event('submit', {cancelable: true}));
  assert.equal(spoken.length, 0);
  $('voiceAuto').checked = true; $('question').value = 'كيف أضيف فندقًا؟'; $('chatForm').dispatchEvent(new w.Event('submit', {cancelable: true}));
  assert.equal(spoken.length, 1); assert.match(spoken[0].text, /بوابة/);
  const previous = cancellations; $('clearChat').click(); assert.ok(cancellations > previous);
  spoken[0].onend(); assert.equal(spoken.length, 1);
});
