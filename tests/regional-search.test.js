'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { socialPost, validateListing, searchRegion, responseSources } = require('../server/regional-search');

const now = new Date('2026-09-17T15:00:00.000Z');
const target = {
  id: 'sy-tartus-safita-mashta-elhiu-mashta-elhiu',
  governorateId: 'sy-tartus', governorateName: 'طرطوس', name: 'مشتى الحلو', kind: 'town'
};
const urls = {
  facebook: 'https://www.facebook.com/100069723124560/videos/27922983067403817/',
  instagram: 'https://www.instagram.com/reel/Abc_123-X/',
  tiktok: 'https://www.tiktok.com/@office.name/video/7543210987654321000'
};
const ids = { facebook: '27922983067403817', instagram: 'Abc_123-X', tiktok: '7543210987654321000' };
function listing(overrides = {}) {
  return {
    url: urls.facebook, title: 'شقة للبيع في مشتى الحلو', summary: 'شقة سكنية معروضة للبيع.',
    advertiser_name: 'المكتب العقاري', published_at: '2026-09-16T12:30:00Z',
    location_evidence: 'مشتى الحلو في محافظة طرطوس',
    source_excerpt: 'شقة للبيع في مشتى الحلو محافظة طرطوس، السعر ٤٢٬٥٠٠ دولار، المساحة ١٢٠ م²، اتصال 0933123456.',
    source_read: true, is_offer: true, available: true, property_type: 'شقة', listing_mode: 'sale',
    price: 42500, currency: 'USD', area: 120, phone: '0933123456', media_kind: 'video',
    ...overrides
  };
}
function validate(item, overrides = {}) {
  return validateListing(item, {
    target, platform: 'facebook', sources: new Map([[ids.facebook, urls.facebook]]), now, ...overrides
  });
}
function response(platform = 'facebook', items = [listing({ url: urls[platform] })], overrides = {}) {
  return {
    id: 'resp_test_only', status: 'completed', usage: { input_tokens: 30, output_tokens: 20 },
    output: [
      { type: 'web_search_call', action: { type: 'search', sources: [{ url: urls[platform] }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ listings: items }), annotations: [] }] }
    ],
    ...overrides
  };
}

test('social post URLs normalize platform hosts, tracking parameters and stable post IDs', () => {
  for (const platform of Object.keys(urls)) {
    assert.deepEqual(socialPost(urls[platform] + '?utm_source=test#fragment', platform), { id: ids[platform], url: urls[platform] });
  }
  assert.deepEqual(socialPost('https://m.facebook.com/100069723124560/videos/27922983067403817?mibextid=test', 'facebook'), {
    id: ids.facebook, url: urls.facebook
  });
  assert.deepEqual(socialPost('https://facebook.com/watch/?v=123456789&id=987654321&fbclid=tracking', 'facebook'), {
    id: '123456789', url: 'https://www.facebook.com/watch/?v=123456789&id=987654321'
  });
  assert.deepEqual(socialPost('https://www.facebook.com/groups/987/posts/pfbidAbC123/?ref=share', 'facebook'), {
    id: 'pfbidAbC123', url: 'https://www.facebook.com/groups/987/posts/pfbidAbC123/'
  });
  assert.deepEqual(socialPost('https://facebook.com/story.php?story_fbid=123456789&id=987654321&ref=share', 'facebook'), {
    id: '123456789', url: 'https://www.facebook.com/story.php?story_fbid=123456789&id=987654321'
  });
  assert.deepEqual(socialPost('https://instagram.com/p/Photo_123', 'instagram'), {
    id: 'Photo_123', url: 'https://www.instagram.com/p/Photo_123/'
  });
});

test('social post parsing rejects account/search/login pages, short links and untrusted hosts', () => {
  const rejected = {
    facebook: [
      'https://www.facebook.com/100069723124560/', 'https://www.facebook.com/login/',
      'https://www.facebook.com/search/top?q=عقار', 'https://www.facebook.com/share/v/abc/',
      'http://www.facebook.com/reel/123/', 'https://user:pass@www.facebook.com/reel/123/',
      'https://www.facebook.com:444/reel/123/', 'https://facebook.com.evil.example/reel/123/',
      'https://evil.facebook.com/reel/123/', 'https://127.0.0.1/reel/123/', 'javascript:alert(1)'
    ],
    instagram: ['https://www.instagram.com/office/', 'https://www.instagram.com/explore/tags/عقار/', 'https://www.instagram.com/accounts/login/', urls.facebook],
    tiktok: ['https://www.tiktok.com/@office', 'https://www.tiktok.com/search?q=عقار', 'https://vm.tiktok.com/short/', 'https://www.tiktok.com/@office/video/not-a-number', urls.instagram]
  };
  for (const [platform, values] of Object.entries(rejected)) {
    for (const value of values) assert.equal(socialPost(value, platform), null, platform + ': ' + value);
  }
  assert.equal(socialPost(urls.facebook, 'unknown'), null);
});

test('publishable offers require a cited original post, confirmed location, recent date and source reading', () => {
  const verified = validate(listing());
  assert.equal(verified.publishable, true);
  assert.equal(verified.external_id, ids.facebook);
  assert.equal(verified.external_url, urls.facebook);
  assert.equal(verified.city, 'طرطوس');
  assert.equal(verified.district, 'مشتى الحلو');
  assert.equal(verified.raw_data.locality_id, target.id);
  assert.equal(verified.raw_data.source_published_at, '2026-09-16T12:30:00.000Z');
  assert.equal(validate(listing(), { sources: new Map() }), null);
  assert.equal(validate(listing({ url: 'https://www.facebook.com/reel/999999/' })), null);
  assert.equal(validate(listing({ is_offer: false })), null);
  assert.equal(validate(listing({ title: '   ' })), null);
  for (const overrides of [
    { source_read: false }, { location_evidence: 'مشتى الحلو' }, { location_evidence: 'صافيتا محافظة طرطوس' },
    { location_evidence: '' }, { published_at: null }, { published_at: 'unknown' },
    { published_at: '2026-09-09T15:00:00Z' }, { published_at: '2026-09-17T15:06:00Z' }, { listing_mode: null }
  ]) {
    const pending = validate(listing(overrides));
    assert.ok(pending);
    assert.equal(pending.publishable, false, JSON.stringify(overrides));
    assert.ok(pending.raw_data.review_reason);
  }
});

test('sold offers remain pending and unsupported prices, sizes and contact numbers are dropped', () => {
  const supported = validate(listing());
  assert.equal(supported.price, 42500);
  assert.equal(supported.currency, 'USD');
  assert.equal(supported.area, 120);
  assert.equal(supported.phone, '+963933123456');
  const sold = validate(listing({ available: false, source_excerpt: 'تم بيع العقار.' }));
  assert.equal(sold.publishable, false);
  assert.equal(sold.price, null);
  assert.equal(sold.area, null);
  assert.equal(sold.phone, null);
  assert.ok(sold.raw_data.review_reason);
  const unsupported = validate(listing({ price: 50000, area: 130, phone: '0944123456' }));
  assert.equal(unsupported.price, null);
  assert.equal(unsupported.currency, null);
  assert.equal(unsupported.area, null);
  assert.equal(unsupported.phone, null);
  assert.equal(validate(listing({ price: 4250, area: 12 })).price, null);
  assert.equal(validate(listing({ price: 4250, area: 12 })).area, null);
  assert.equal(validate(listing({ currency: null })).price, null);
  for (const invalid of [-120, 0, Infinity, NaN, '120']) assert.equal(validate(listing({ area: invalid })).area, null);
});

test('only supported platform post citations count, from search sources, open actions or annotations', () => {
  const sourceData = { output: [
    { type: 'web_search_call', action: { sources: [{ url: urls.facebook }, { url: 'https://www.facebook.com/office/' }, { url: urls.instagram }] } },
    { type: 'web_search_call', action: { url: 'https://www.facebook.com/reel/222222/' } },
    { type: 'message', content: [{ annotations: [
      { type: 'url_citation', url: 'https://www.facebook.com/reel/333333/?tracking=1' },
      { type: 'url_citation', url: 'https://evil.example/reel/444444/' },
      { type: 'file_citation', url: 'https://www.facebook.com/reel/555555/' }
    ] }] }
  ] };
  const sources = responseSources(sourceData, 'facebook');
  assert.deepEqual([...sources.keys()], [ids.facebook, '222222', '333333']);
  assert.equal(sources.get('333333'), 'https://www.facebook.com/reel/333333/');
});

test('search requests Astra with mandatory domain-limited web search and a strict output schema', async () => {
  for (const platform of ['facebook', 'instagram', 'tiktok']) {
    let calls = 0;
    const secret = 'sk-unit-test-not-a-real-key';
    const result = await searchRegion({ target, platform, key: secret, now, fetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer ' + secret);
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6-astra');
      assert.equal(body.store, false);
      assert.equal(body.tool_choice, 'required');
      assert.deepEqual(body.tools, [{ type: 'web_search', filters: { allowed_domains: [platform + '.com'] } }]);
      assert.ok(body.include.includes('web_search_call.action.sources'));
      assert.equal(body.max_tool_calls, 4);
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      const schema = body.text.format.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ['listings']);
      assert.equal(schema.properties.listings.type, 'array');
      const itemSchema = schema.properties.listings.items;
      assert.equal(itemSchema.additionalProperties, false);
      assert.deepEqual([...itemSchema.required].sort(), Object.keys(itemSchema.properties).sort());
      assert.equal(itemSchema.properties.source_read.type, 'boolean');
      assert.equal(itemSchema.properties.location_evidence.type, 'string');
      assert.ok(body.input.includes(target.name));
      assert.ok(body.input.includes(target.governorateName));
      assert.ok(body.input.includes(now.toISOString()));
      assert.ok(!options.body.includes(secret));
      return { ok: true, json: async () => response(platform) };
    } });
    assert.equal(calls, 1);
    assert.equal(result.response_id, 'resp_test_only');
    assert.equal(result.source_count, 1);
    assert.equal(result.listings.length, 1);
    assert.equal(result.listings[0].external_id, ids[platform]);
    assert.equal(result.listings[0].publishable, true);
    assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 20 });
  }
});

test('search drops uncited offers and returns no more than five cited offers', async () => {
  const uncited = response('facebook');
  uncited.output = uncited.output.filter(item => item.type !== 'web_search_call');
  const empty = await searchRegion({ target, platform: 'facebook', key: 'mock', now, fetcher: async () => ({ ok: true, json: async () => uncited }) });
  assert.deepEqual(empty.listings, []);
  assert.equal(empty.source_count, 0);
  const items = Array.from({ length: 7 }, (_, i) => listing({ url: 'https://www.facebook.com/reel/' + (100000 + i) + '/' }));
  const data = response('facebook', items);
  data.output[0].action.sources = items.map(item => ({ url: item.url }));
  const capped = await searchRegion({ target, platform: 'facebook', key: 'mock', now, fetcher: async () => ({ ok: true, json: async () => data }) });
  assert.equal(capped.listings.length, 5);
  assert.equal(capped.source_count, 7);
  assert.deepEqual(capped.listings.map(item => item.external_id), ['100000', '100001', '100002', '100003', '100004']);
});

test('incomplete responses and invalid result JSON are rejected without partial publication', async () => {
  for (const status of ['incomplete', 'failed', 'in_progress', undefined]) {
    await assert.rejects(searchRegion({ target, platform: 'facebook', key: 'mock', now, fetcher: async () => ({
      ok: true, json: async () => response('facebook', [listing()], { status })
    }) }), /لم يكتمل البحث/);
  }
  for (const raw of ['not JSON', '{"listings":', '{"listings":null}', '{"listings":{}}', '{}']) {
    const data = response('facebook');
    data.output[1].content[0].text = raw;
    await assert.rejects(searchRegion({ target, platform: 'facebook', key: 'mock', now, fetcher: async () => ({ ok: true, json: async () => data }) }), /تعذر قراءة نتيجة|نتيجة البحث غير صالحة/);
  }
});

test('HTTP authentication and rate limits pause safely without leaking API keys or upstream messages', async () => {
  const secret = 'sk-unit-test-secret-do-not-expose';
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(searchRegion({ target, platform: 'facebook', key: secret, now, fetcher: async () => ({
      ok: false, status,
      json: async () => { assert.fail('Untrusted API error body must not be used: ' + secret); }
    }) }), error => {
      assert.equal(error.pause, [401, 403, 404, 429].includes(status));
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.stack.includes(secret));
      assert.ok(!JSON.stringify(error).includes(secret));
      if (status === 401) assert.match(error.message, /مفتاح OpenAI/);
      if (status === 429) assert.match(error.message, /حد الاستخدام|معدل الطلبات/);
      return true;
    });
  }
  await assert.rejects(searchRegion({ target, platform: 'facebook', key: '', now, fetcher: async () => {
    assert.fail('No API request is allowed without a key');
  } }), error => error.pause === true && /مفتاح OpenAI/.test(error.message));
});

test('regression: an empty source excerpt cannot produce a publishable offer', () => {
  for (const source_excerpt of ['', '   ', 'إعلان']) {
    const result = validate(listing({ source_excerpt, source_read: true }));
    assert.equal(result.publishable, false);
    assert.ok(result.raw_data.review_reason);
  }
});

test('regression: Rif Dimashq evidence must not match the Damascus governorate', () => {
  const damascus = { id:'sy-damascus', governorateId:'sy-damascus', governorateName:'دمشق', name:'دمشق', kind:'governorate' };
  const wrong = validate(listing({ location_evidence:'شقة في محافظة ريف دمشق' }), { target:damascus });
  assert.equal(wrong.publishable, false);
  assert.ok(wrong.raw_data.review_reason);
  assert.equal(validate(listing({ location_evidence:'شقة في محافظة دمشق' }), { target:damascus }).publishable, true);
  assert.equal(validate(listing({ location_evidence:'مشتى الحلويات في محافظة طرطوس' })).publishable, false);
});

test('regression: explicit sold wording overrides a model claim of availability', () => {
  for (const source_excerpt of ['تم البيع، العقار مباع وغير متاح.', 'تم تأجير العقار المعروض في مشتى الحلو.']) {
    const result = validate(listing({ available:true, source_excerpt }));
    assert.equal(result.publishable, false);
    assert.equal(result.raw_data.availability, 'sold');
    assert.ok(result.raw_data.review_reason);
  }
});

test('price currency and area require their own units and cannot exchange matching numbers', () => {
  const swapped = validate(listing({ price:120, area:42500 }));
  assert.equal(swapped.price, null);
  assert.equal(swapped.currency, null);
  assert.equal(swapped.area, null);
  assert.equal(validate(listing({ currency:'EUR' })).price, null);
  assert.equal(validate(listing({ source_excerpt:'شقة في مشتى الحلو محافظة طرطوس، الرقم 42500 والرقم 120.' })).price, null);
  assert.equal(validate(listing({ source_excerpt:'شقة في مشتى الحلو محافظة طرطوس، الرقم 42500 والرقم 120.' })).area, null);
  const euros = validate(listing({ currency:'EUR', source_excerpt:'شقة في مشتى الحلو محافظة طرطوس بسعر 42500 يورو ومساحة 120 متر مربع.' }));
  assert.equal(euros.price, 42500);
  assert.equal(euros.currency, 'EUR');
  assert.equal(euros.area, 120);
});
