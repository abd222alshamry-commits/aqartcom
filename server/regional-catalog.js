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

// Six priority governorates get one turn each, then one of the other eight.
// Each governorate wraps its own queue, so small areas are revisited regularly.
const SEARCH_PLAN = 'priority-six-v1';
const PRIORITY_IDS = Object.freeze(['sy-damascus','sy-aleppo','sy-latakia','sy-hama','sy-tartus','sy-homs']);
const priorityGovernors = Object.freeze(PRIORITY_IDS.map(id => governors.find(g => g.id === id)));
const otherGovernors = governors.filter(g => !PRIORITY_IDS.includes(g.id));
const searchQueues = new Map(governors.map(g => {
  const places = targets.filter(t => t.governorateId === g.id && t.kind !== 'governorate');
  const rank = t => t.name === g.name ? 0 : t.kind === 'city' ? 1 : 2;
  places.sort((a,b) => rank(a)-rank(b));
  return [g.id, [targetById.get(g.id), ...places]];
}));
function searchTaskAt(cursor) {
  const platformCount = PLATFORMS.length;
  const turn = Math.floor(cursor/platformCount), slot = turn%7, round = Math.floor(turn/7);
  const governor = slot<6 ? priorityGovernors[slot] : otherGovernors[round%otherGovernors.length];
  const visit = slot<6 ? round : Math.floor(round/otherGovernors.length);
  const queue = searchQueues.get(governor.id);
  return {target:queue[visit%queue.length],platform:PLATFORMS[cursor%platformCount]};
}

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

module.exports = { governors, localities, targets, findTarget, summary, PLATFORMS, SEARCH_PLAN, priorityGovernors, searchTaskAt };
