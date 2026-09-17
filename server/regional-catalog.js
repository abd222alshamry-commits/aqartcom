'use strict';

// OpenSyria Data Geography v0.1.5, CC BY 4.0; see GEOGRAPHY-SOURCES.md.
// Keep source IDs: Arabic names can be missing or shared by several places.
const sourceGovernors = require('../geography-provenance/governorates.json');
const sourceLocalities = require('../geography-provenance/localities.json');

const PLATFORMS = Object.freeze(['facebook', 'instagram', 'tiktok']);
const governors = Object.freeze(sourceGovernors.map(g => Object.freeze({
  id: g.id,
  name: g.name.ar || g.name.en
})));
const localities = Object.freeze(sourceLocalities.map(l => Object.freeze({
  id: l.id,
  parentId: l.governorateId,
  name: l.name.ar || l.name.en,
  kind: l.kind,
  aliases: Object.freeze([...new Set((l.aliases || []).map(a => a.value).filter(Boolean))])
})));

const queues = governors.map(g => [
  Object.freeze({
    id: g.id,
    governorateId: g.id,
    governorateName: g.name,
    name: g.name,
    kind: 'governorate'
  }),
  ...localities.filter(l => l.parentId === g.id).map(l => Object.freeze({
    id: l.id,
    governorateId: g.id,
    governorateName: g.name,
    name: l.name,
    kind: l.kind
  }))
]);

// A limited run visits every governorate before advancing to its next locality.
// Source ordering keeps persisted cursor positions stable for this snapshot.
const orderedTargets = [];
const rounds = Math.max(...queues.map(queue => queue.length));
for (let round = 0; round < rounds; round++) {
  for (const queue of queues) {
    if (queue[round]) orderedTargets.push(queue[round]);
  }
}
const targets = Object.freeze(orderedTargets);
const targetById = new Map(targets.map(target => [target.id, target]));

function findTarget(id) {
  return targetById.get(id) || null;
}

function summary() {
  const arabicLocalities = sourceLocalities.filter(l => l.name.ar).length;
  return {
    governorates: governors.length,
    localities: localities.length,
    targets: targets.length,
    arabicLocalities,
    missingArabicNames: localities.length - arabicLocalities,
    neighborhoodsComplete: false,
    coverageNote: 'تشمل البيانات المحافظات والمدن والبلدات والقرى المتاحة في المصدر، ولا تمثل حصرًا كاملًا للأحياء؛ أحياء دمشق غير مكتملة، وتظهر أسماء المواقع التي تفتقد الاسم العربي بالإنجليزية.',
    byGovernorate: governors.map((g, index) => ({
      id: g.id,
      name: g.name,
      localities: queues[index].length - 1,
      targets: queues[index].length
    }))
  };
}

module.exports = { governors, localities, targets, findTarget, summary, PLATFORMS };
