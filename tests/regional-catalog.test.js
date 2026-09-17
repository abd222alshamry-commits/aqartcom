'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sourceGovernors = require('../geography-provenance/governorates.json');
const sourceLocalities = require('../geography-provenance/localities.json');
const { governors, localities, targets, findTarget, summary, PLATFORMS } = require('../server/regional-catalog');

test('catalog retains every source ID and governorate relationship without invented places', () => {
  assert.equal(governors.length, 14);
  assert.equal(localities.length, 7605);
  assert.equal(targets.length, 7619);
  assert.equal(new Set(targets.map(t => t.id)).size, targets.length);
  assert.deepEqual(new Set(governors.map(g => g.id)), new Set(sourceGovernors.map(g => g.id)));
  assert.deepEqual(new Set(localities.map(l => l.id)), new Set(sourceLocalities.map(l => l.id)));
  const governorIds = new Set(governors.map(g => g.id));
  for (const locality of localities) assert.ok(governorIds.has(locality.parentId));
  const mashtaId = 'sy-tartus-safita-mashta-elhiu-mashta-elhiu';
  assert.deepEqual(findTarget(mashtaId), {
    id: mashtaId,
    governorateId: 'sy-tartus',
    governorateName: 'طرطوس',
    name: 'مشتى الحلو',
    kind: 'town'
  });
  assert.ok(localities.find(l => l.id === mashtaId).aliases.includes('Mashta al Hulw'));
  assert.equal(findTarget('unknown-target'), null);
  assert.equal(findTarget(null), null);
  assert.equal(findTarget(), null);
});

test('limited batches alternate governorates and skip exhausted groups without losing targets', () => {
  const ids = governors.map(g => g.id);
  assert.deepEqual(targets.slice(0, 14).map(t => t.id), ids);
  assert.ok(targets.slice(0, 14).every(t => t.kind === 'governorate'));
  assert.deepEqual(targets.slice(14, 28).map(t => t.governorateId), ids);
  assert.deepEqual(targets.slice(28, 42).map(t => t.governorateId), ids);
  assert.deepEqual(targets.slice(42, 55).map(t => t.governorateId), ids.filter(id => id !== 'sy-damascus'));
  for (const governor of governors) {
    const group = targets.filter(t => t.governorateId === governor.id);
    assert.equal(group[0].id, governor.id);
    assert.deepEqual(group.slice(1).map(t => t.id), sourceLocalities.filter(l => l.governorateId === governor.id).map(l => l.id));
  }
});

test('missing Arabic names use original English names and coverage limits remain explicit', () => {
  const missing = sourceLocalities.filter(l => !l.name.ar);
  assert.equal(missing.length, 6);
  for (const source of missing) {
    const target = findTarget(source.id);
    assert.equal(target.name, source.name.en);
    assert.equal(target.governorateId, 'sy-quneitra');
  }
  const counts = summary();
  assert.equal(counts.governorates, 14);
  assert.equal(counts.localities, 7605);
  assert.equal(counts.targets, 7619);
  assert.equal(counts.arabicLocalities, 7599);
  assert.equal(counts.missingArabicNames, 6);
  assert.equal(counts.neighborhoodsComplete, false);
  assert.match(counts.coverageNote, /أحياء/);
  assert.match(counts.coverageNote, /دمشق/);
  assert.equal(counts.byGovernorate.find(g => g.id === 'sy-damascus').localities, 2);
  assert.equal(counts.byGovernorate.find(g => g.id === 'sy-quneitra').localities, 74);
  assert.equal(counts.byGovernorate.reduce((total, g) => total + g.localities, 0), 7605);
  assert.equal(counts.byGovernorate.reduce((total, g) => total + g.targets, 0), 7619);
});

test('catalog shared by workers cannot be changed through exported records', () => {
  assert.deepEqual(PLATFORMS, ['facebook', 'instagram', 'tiktok']);
  assert.throws(() => targets.reverse(), TypeError);
  assert.throws(() => { findTarget('sy-tartus').name = 'changed'; }, TypeError);
  assert.throws(() => { localities[0].aliases.push('invented'); }, TypeError);
  const first = summary();
  first.byGovernorate[0].localities = 0;
  assert.equal(summary().byGovernorate[0].localities, 1467);
});
