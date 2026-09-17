'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const catalog = require('../server/regional-catalog');
const { register, schedule, wallTime, localDay, taskAt, enqueue, saveListings, TOTAL_TASKS } = require('../server/regional-agents');

async function until(check, message) {
  const deadline = Date.now() + 5000;
  do { if (await check()) return; await delay(15); } while (Date.now() < deadline);
  assert.fail(message || 'The local worker did not reach the expected state');
}
async function fixture(t, { env = {}, fetcher } = {}) {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(await fs.readFile(path.join(__dirname, '../server/db/schema.sql'), 'utf8'));
  async function query(sql, params) {
    if (!params && sql.split(';').filter(part => part.trim()).length > 1) {
      const results = await db.exec(sql);
      return results.at(-1) || { rows: [] };
    }
    return db.query(sql, params);
  }
  const pool = { query, connect:async () => ({ query, release() {} }) };
  const app = express(); app.use(express.json());
  const requireAdmin = (req, res, next) => req.get('x-test-admin') === 'yes' ? next() : res.sendStatus(403);
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    if (fetcher) return fetcher(url, options);
    assert.fail('This test must not issue an OpenAI request');
  };
  const controller = await register(app, { pool, requireAdmin, env, fetcher:mockFetch, startTimer:false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { controller.stop(); await new Promise(resolve => server.close(resolve)); await db.close(); });
  async function request(endpoint = '', { method = 'GET', body, admin = true, origin } = {}) {
    const headers = { ...(admin ? { 'x-test-admin':'yes' } : {}), ...(body !== undefined ? { 'content-type':'application/json' } : {}), ...(origin ? { origin } : {}) };
    return fetch(base + '/api/admin/regional-agents' + endpoint, { method, headers, ...(body !== undefined ? { body:JSON.stringify(body) } : {}) });
  }
  return { db, pool, app, controller, request, calls, env };
}
function marketItem(id, overrides = {}) {
  return {
    platform:'facebook', external_id:id, external_url:'https://www.facebook.com/reel/' + id + '/',
    advertiser_name:'مكتب اختبار محلي', title:'شقة للاختبار', description:'بيانات اختبار داخل قاعدة مؤقتة فقط.',
    phone:null, city:'طرطوس', district:'مشتى الحلو', property_type:'شقة', listing_mode:'sale',
    price:42500, currency:'USD', area:120, publishable:true,
    raw_data:{ import_batch:'regional-astra-v1', governorate_id:'sy-tartus', availability:'unconfirmed' }, ...overrides
  };
}
function fakeResponse(platform = 'facebook', includeOffer = false) {
  const url = platform === 'facebook' ? 'https://www.facebook.com/reel/123456789/' : platform === 'instagram' ? 'https://www.instagram.com/p/Test123/' : 'https://www.tiktok.com/@test/video/123456789';
  const listings = includeOffer ? [{
    url, title:'شقة للبيع في الحسكة', summary:'عرض عقاري من مصدر اختبار.', advertiser_name:'مكتب اختبار',
    published_at:new Date(Date.now() - 3600000).toISOString(), location_evidence:'محافظة الحسكة',
    source_excerpt:'شقة للبيع في محافظة الحسكة، السعر 42500 دولار، المساحة 120 متر مربع.',
    source_read:true, is_offer:true, available:true, property_type:'شقة', listing_mode:'sale',
    price:42500, currency:'USD', area:120, phone:null, media_kind:'image'
  }] : [];
  return { id:'resp_local_mock', status:'completed', usage:{ input_tokens:10, output_tokens:20 }, output:[
    { type:'web_search_call', action:{ sources:includeOffer ? [{ url }] : [] } },
    { type:'message', content:[{ type:'output_text', text:JSON.stringify({ listings }), annotations:[] }] }
  ] };
}

test('Damascus daily slots are 18:00 and 23:00 across exact times and date boundaries', () => {
  assert.equal(wallTime('2026-09-17', 18).toISOString(), '2026-09-17T15:00:00.000Z');
  assert.equal(wallTime('2026-09-17', 23).toISOString(), '2026-09-17T20:00:00.000Z');
  const before = schedule(new Date('2026-09-17T14:59:59Z'));
  assert.equal(before.due.key, '2026-09-16T23:00');
  assert.equal(before.next.at.toISOString(), '2026-09-17T15:00:00.000Z');
  const first = schedule(new Date('2026-09-17T15:00:00Z'));
  assert.equal(first.due.key, '2026-09-17T18:00');
  assert.equal(first.next.at.toISOString(), '2026-09-17T20:00:00.000Z');
  const last = schedule(new Date('2026-12-31T20:00:00Z'));
  assert.equal(last.due.key, '2026-12-31T23:00');
  assert.equal(last.next.at.toISOString(), '2027-01-01T15:00:00.000Z');
  assert.equal(localDay(new Date('2026-09-17T21:30:00Z')), '2026-09-18');
  assert.equal(TOTAL_TASKS, 7619 * 3);
  assert.deepEqual([0,1,2].map(index => taskAt(index).platform), ['facebook','instagram','tiktok']);
  assert.equal(taskAt(3).target.id, catalog.governors[1].id);
  assert.equal(taskAt(TOTAL_TASKS).target.id, taskAt(0).target.id);
});

test('enqueue is idempotent per scheduled slot and advances a durable cursor, including wraparound', async t => {
  const f = await fixture(t);
  await f.pool.query('UPDATE regional_agent_settings SET calls_per_cycle=3 WHERE id=1');
  const settings = async () => (await f.pool.query('SELECT * FROM regional_agent_settings WHERE id=1')).rows[0];
  const firstSlot = { key:'2026-09-17T18:00', at:new Date('2026-09-17T15:00:00Z') };
  const id = await enqueue(f.pool, firstSlot, await settings());
  assert.ok(id);
  assert.equal((await settings()).next_cursor, 3);
  assert.equal(await enqueue(f.pool, firstSlot, await settings()), null);
  assert.equal((await settings()).next_cursor, 3);
  let jobs = (await f.pool.query('SELECT * FROM regional_agent_jobs ORDER BY id')).rows;
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map(job => job.platform), ['facebook','instagram','tiktok']);
  assert.ok(jobs.every(job => job.target_id === catalog.governors[0].id));
  // A fresh registration reads the same stored cursor; it cannot reset coverage.
  const restarted = await register(express(), { pool:f.pool, requireAdmin:(_req,_res,next) => next(), env:{}, startTimer:false });
  restarted.stop();
  assert.equal((await settings()).next_cursor, 3);
  const skippedId = await enqueue(f.pool, { key:'2026-09-17T23:00', at:new Date('2026-09-17T20:00:00Z') }, await settings());
  const skipped = (await f.pool.query('SELECT * FROM regional_agent_runs WHERE id=$1', [skippedId])).rows[0];
  assert.equal(skipped.planned_count, 0);
  assert.ok(skipped.skipped_reason);
  assert.ok(skipped.finished_at);
  assert.equal((await settings()).next_cursor, 3);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM regional_agent_jobs')).rows[0].count, 3);
  await f.pool.query("UPDATE regional_agent_jobs SET state='empty',finished_at=NOW() WHERE state='pending'");
  await enqueue(f.pool, { key:'2026-09-18T18:00', at:new Date('2026-09-18T15:00:00Z') }, await settings());
  jobs = (await f.pool.query('SELECT * FROM regional_agent_jobs ORDER BY id')).rows;
  assert.equal(jobs.length, 6);
  assert.ok(jobs.slice(3).every(job => job.target_id === catalog.governors[1].id));
  assert.equal((await settings()).next_cursor, 6);
  await f.pool.query("UPDATE regional_agent_jobs SET state='empty',finished_at=NOW() WHERE state='pending'");
  await f.pool.query('UPDATE regional_agent_settings SET next_cursor=$1,calls_per_cycle=2 WHERE id=1', [TOTAL_TASKS - 1]);
  await enqueue(f.pool, { key:'wrap-test', at:new Date() }, await settings());
  assert.equal((await settings()).next_cursor, 1);
  jobs = (await f.pool.query('SELECT * FROM regional_agent_jobs ORDER BY id DESC LIMIT 2')).rows.reverse();
  assert.equal(jobs[0].platform, 'tiktok');
  assert.equal(jobs[0].target_id, catalog.targets.at(-1).id);
  assert.equal(jobs[1].platform, 'facebook');
  assert.equal(jobs[1].target_id, catalog.targets[0].id);
  assert.equal(f.calls.length, 0);
});

test('listing storage publishes only verified offers and deduplicates without replacing edits or videos', async t => {
  const f = await fixture(t);
  assert.deepEqual(await saveListings(f.pool, [marketItem('100'), marketItem('101', { publishable:false })], true), { published:1, review:1, duplicates:0 });
  assert.deepEqual(await saveListings(f.pool, [marketItem('102')], false), { published:0, review:1, duplicates:0 });
  const localVideo = { url:'/uploads/local-test.mp4', poster:'/uploads/local-test.jpg', has_audio:true };
  await f.pool.query("UPDATE market_listings SET title='عنوان عدّله المدير',status='rejected',raw_data=raw_data || $1::jsonb WHERE external_id='100'", [JSON.stringify({ local_video:localVideo, availability:'sold' })]);
  assert.deepEqual(await saveListings(f.pool, [marketItem('100', { title:'عنوان استيراد بديل' })], true), { published:0, review:0, duplicates:1 });
  const rows = (await f.pool.query('SELECT * FROM market_listings ORDER BY external_id')).rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'عنوان عدّله المدير');
  assert.equal(rows[0].status, 'rejected');
  assert.equal(rows[0].raw_data.availability, 'sold');
  assert.deepEqual(rows[0].raw_data.local_video, localVideo);
  assert.equal(rows[1].status, 'pending');
  assert.equal(rows[2].status, 'pending');
});

test('admin endpoints deny unauthorized access and require verified configuration before enabling', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('', { admin:false })).status, 403);
  assert.equal((await f.request('/targets', { admin:false })).status, 403);
  assert.equal((await f.request('/settings', { method:'PATCH', body:{ enabled:true } })).status, 409);
  assert.equal((await f.request('/run', { method:'POST' })).status, 409);
  assert.equal((await f.request('/settings', { method:'PATCH', body:{ enabled:false }, origin:'https://foreign.example' })).status, 403);
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const data = await result.json();
  assert.equal(data.configured, false);
  assert.equal(data.verified, false);
  assert.equal(data.settings.enabled, false);
  assert.equal(data.timezone, 'Asia/Damascus');
  assert.deepEqual(data.times, ['18:00','23:00']);
  assert.equal(data.catalog.localities, 7605);
  const filtered = await (await f.request('/targets?governorate=sy-tartus&q=' + encodeURIComponent('مشتى الحلو'))).json();
  assert.ok(filtered.data.length > 0);
  assert.ok(filtered.data.every(item => item.governorateId === 'sy-tartus' && item.name.includes('مشتى الحلو')));
  assert.equal(f.calls.length, 0);
});

test('verified mock key enables runs, executes one job per tick and enforces the daily limit', async t => {
  const secret = 'sk-local-test-not-a-real-key';
  let responseCalls = 0;
  const f = await fixture(t, { env:{ REGIONAL_OPENAI_API_KEY:secret }, fetcher:async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + secret);
    if (url === 'https://api.openai.com/v1/models/gpt-6-astra') return { ok:true, json:async () => ({ id:'gpt-6-astra' }) };
    assert.equal(url, 'https://api.openai.com/v1/responses');
    responseCalls++;
    const platform = JSON.parse(options.body).tools[0].filters.allowed_domains[0].split('.')[0];
    return { ok:true, json:async () => fakeResponse(platform, responseCalls === 1) };
  } });
  assert.equal((await f.request('/settings', { method:'PATCH', body:{ enabled:true } })).status, 409);
  assert.equal((await f.request('/verify', { method:'POST' })).status, 200);
  assert.equal((await f.request('/settings', { method:'PATCH', body:{ enabled:true, calls_per_cycle:2, calls_per_day:2, auto_publish:true } })).status, 200);
  const run = await f.request('/run', { method:'POST' });
  assert.equal(run.status, 202);
  const runId = (await run.json()).run_id;
  assert.ok(runId);
  await until(async () => (await f.pool.query("SELECT id FROM regional_agent_jobs WHERE state='completed'")).rows.length === 1, 'First mock offer was not saved');
  await until(async () => (await f.pool.query("SELECT id FROM regional_agent_jobs WHERE state='running'")).rows.length === 0);
  assert.equal((await f.request('/run', { method:'POST' })).status, 409);
  await f.controller.tick();
  await until(async () => (await f.pool.query("SELECT id FROM regional_agent_jobs WHERE state='empty'")).rows.length === 1, 'Second mock response did not finish');
  assert.equal(responseCalls, 2);
  const stored = (await f.pool.query('SELECT * FROM market_listings')).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'published');
  assert.equal(stored[0].city, 'الحسكة');
  assert.equal(stored[0].price, '42500.00');
  const summary = await (await f.request()).json();
  assert.equal(summary.calls_today, 2);
  assert.equal(summary.verified, true);
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.ok(summary.runs.find(item => item.id === runId).finished_at);
  assert.equal((await f.request('/run', { method:'POST' })).status, 409);
  await f.controller.tick();
  assert.equal(responseCalls, 2);
  f.env.REGIONAL_OPENAI_API_KEY = 'sk-local-replacement-key';
  await f.controller.tick();
  const paused = (await f.pool.query('SELECT * FROM regional_agent_settings WHERE id=1')).rows[0];
  assert.equal(paused.enabled, false);
  assert.match(paused.pause_reason, /اختبار اتصال/);
  assert.equal(responseCalls, 2);
});

test('a mocked 429 pauses the worker, records a safe error and does not retry charged work', async t => {
  let responseCalls = 0;
  const secret = 'sk-local-only-rate-limit-test';
  const f = await fixture(t, { env:{ OPENAI_API_KEY:secret }, fetcher:async url => {
    if (url.includes('/models/')) return { ok:true, json:async () => ({ id:'gpt-6-astra' }) };
    responseCalls++;
    return { ok:false, status:429, json:async () => { assert.fail('The error body should not be read'); } };
  } });
  await f.request('/verify', { method:'POST' });
  await f.request('/settings', { method:'PATCH', body:{ enabled:true, calls_per_cycle:1, calls_per_day:2 } });
  assert.equal((await f.request('/run', { method:'POST' })).status, 202);
  await until(async () => !(await f.pool.query('SELECT enabled FROM regional_agent_settings WHERE id=1')).rows[0].enabled);
  const jobs = (await f.pool.query('SELECT * FROM regional_agent_jobs')).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, 'error');
  assert.match(jobs[0].error_message, /حد الاستخدام|معدل الطلبات/);
  assert.equal(JSON.stringify(jobs).includes(secret), false);
  await f.controller.tick();
  assert.equal(responseCalls, 1);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM market_listings')).rows[0].count, 0);
});
