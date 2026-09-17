const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, uploadPending } = require('../property-media');
const photo = { name:'house.jpg', type:'image/jpeg', size:1024 };
test('mobile attachments enforce the displayed count, format and size limits', () => {
  assert.doesNotThrow(() => validate(Array(12).fill(photo), 'images'));
  assert.throws(() => validate(Array(13).fill(photo), 'images'), /12/);
  assert.throws(() => validate([{...photo,size:8*1024*1024+1}], 'images'), /8/);
  assert.throws(() => validate([{...photo,type:'image/heic',name:'house.heic'}], 'images'), /غير مدعومة/);
  assert.doesNotThrow(() => validate([{name:'tour.MOV',type:'',size:4096}], 'videos'));
  assert.throws(() => validate([{name:'tour.mp4',type:'video/mp4',size:100*1024*1024+1}], 'videos'), /100/);
  assert.throws(() => validate(Array(4).fill({name:'tour.mp4',type:'video/mp4',size:4096}), 'videos'), /3/);
  assert.throws(() => validate([{...photo,size:0}], 'images'), /فارغ/);
});
test('a partial upload retains failures and retries only files that are not uploaded', async () => {
  const items = [{kind:'images',file:photo},{kind:'videos',file:{name:'tour.mp4'}}];
  const sent = [];
  let fail = true;
  const send = async item => { sent.push(item.kind); if (item.kind === 'videos' && fail) throw Error('offline'); };
  const remaining = await uploadPending(items, send);
  assert.deepEqual(sent, ['images','videos']);
  assert.deepEqual(remaining, [items[1]]);
  assert.equal(items[0].uploaded, true);
  fail = false;
  assert.deepEqual(await uploadPending(items, send), []);
  assert.deepEqual(sent, ['images','videos','videos']);
  assert.ok(items.every(item => item.uploaded && !item.error));
});
