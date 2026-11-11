import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AUSO_ADMIN_EMAIL } from '../functions/_access.js';
import { onRequestPost } from '../functions/api/admin/materials.js';
import { onRequestGet as courses } from '../functions/api/portal/courses.js';
import { onRequestGet as download } from '../functions/api/portal/download/[id].js';
import { onRequest as clientAccess } from '../functions/api/portal/_middleware.js';

test('a signed-out request never reaches the downloads API', async () => {
  const response = await clientAccess({
    request: new Request('https://example.com/api/portal/courses'),
    env: { CF_ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com', CF_PORTAL_ACCESS_AUD:'portal' },
    data: {},
    next: () => assert.fail('The route must require a verified identity'),
  });
  assert.equal(response.status, 403);
});

test('admin can create courses, upload and assign materials; each client can only download theirs', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../migrations/portal/0001_initial.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind: (...args) => ({
        first: async () => statement.get(...args) ?? null,
        all: async () => ({results:statement.all(...args)}),
        run: async () => ({ meta: statement.run(...args) }),
      }) };
    },
  };
  const bucket = new Map();
  const reads = [];
  const env = { PORTAL_DB: db, AUSO_DOWNLOADS: {
    put: async (key, stream) => bucket.set(key, await new Response(stream).arrayBuffer()),
    delete: async key => bucket.delete(key),
    get: async key => { reads.push(key); return bucket.has(key) ? {body:bucket.get(key)} : null; },
  } };
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No external services should be called'));
  // Node does not provide the Workers stream primitive.
  const original = globalThis.FixedLengthStream;
  globalThis.FixedLengthStream = class extends TransformStream {
    constructor(size) {
      let received = 0;
      super({
        transform(chunk, controller) { received += chunk.byteLength; controller.enqueue(chunk); },
        flush() { assert.equal(received, size); },
      });
    }
  };
  t.after(() => {
    if (original === undefined) delete globalThis.FixedLengthStream;
    else globalThis.FixedLengthStream = original;
  });
  const base = 'https://example.com/api/admin/materials';
  const send = payload => onRequestPost({ env, request:new Request(base, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
  }) });
  async function create(title, filename, email) {
    const created = await send({ action:'course', title });
    assert.equal(created.status, 201);
    const {id:course} = await created.json();
    const query = new URLSearchParams({upload:'1', course, name:filename});
    const uploaded = await onRequestPost({ env, request:new Request(base + '?' + query, {
      method:'POST', headers:{'Content-Length':String(filename.length)}, body:filename,
    }) });
    assert.equal(uploaded.status, 201);
    const {id} = await uploaded.json();
    assert.equal((await send({action:'assign', course, email})).status, 200);
    return {course, id};
  }
  const alice = 'alice@example.com';
  const bob = 'bob@example.com';
  const plc = await create('PLC', 'PLC.zip', alice);
  const hmi = await create('HMI', 'HMI.pdf', bob);
  for (const [clientEmail, title, allowed, denied, filename] of [
    [alice, 'PLC', plc, hmi, 'PLC.zip'],
    [bob, 'HMI', hmi, plc, 'HMI.pdf'],
  ]) {
    const data = {clientEmail};
    const list = await (await courses({env,data})).json();
    assert.equal(list.isAdmin, false);
    assert.deepEqual(list.courses.map(item => [item.title, item.files[0].id]), [[title,allowed.id]]);
    const before = reads.length;
    assert.equal((await download({env,data,params:{id:denied.id}})).status, 404);
    assert.equal(reads.length, before, 'Unauthorized download must not access storage');
    const response = await download({env,data,params:{id:allowed.id}});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Disposition'), /attachment/);
    assert.equal(await response.text(), filename);
  }
  const adminView = await courses({env,data:{clientEmail:AUSO_ADMIN_EMAIL}});
  assert.equal(adminView.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await adminView.json(), { courses: [], isAdmin: true });
  assert.equal((await send({action:'revoke',course:plc.course,email:alice})).status, 200);
  assert.equal((await download({env,data:{clientEmail:alice},params:{id:plc.id}})).status, 404);
  const group = { action:'assign-batch', courses:[plc.course], emails:[alice, bob, bob.toUpperCase()] };
  assert.deepEqual(await (await send(group)).json(), { added:2 });
  assert.deepEqual(await (await send(group)).json(), { added:0 });
  const client = { action:'assign-batch', courses:[plc.course,hmi.course], emails:[alice] };
  assert.deepEqual(await (await send(client)).json(), { added:1 });
  assert.equal((await send({ ...group, emails:['new@example.com','mal escrito'] })).status, 400);
  assert.deepEqual((await (await courses({env,data:{clientEmail:'new@example.com'}})).json()).courses, []);
  const list = await (await courses({env,data:{clientEmail:alice}})).json();
  assert.deepEqual(list.courses.map(item => item.title), ['HMI','PLC']);
  const replace = (course, name) => onRequestPost({ env, request:new Request(base + '?' +
    new URLSearchParams({upload:'1', course, name, replace:plc.id}), {
    method:'POST', headers:{'Content-Length':'7'}, body:'updated',
  }) });
  assert.equal((await replace(hmi.course, 'v2.zip')).status, 404);
  assert.equal((await replace(plc.course, 'v2.pdf')).status, 400);
  assert.equal(await (await download({env,data:{clientEmail:alice},params:{id:plc.id}})).text(), 'PLC.zip');
  assert.deepEqual(await (await replace(plc.course, 'v2.zip')).json(), {id:plc.id});
  assert.equal(await (await download({env,data:{clientEmail:alice},params:{id:plc.id}})).text(), 'updated');
  assert.equal((await send({action:'delete-file',course:hmi.course,id:plc.id})).status, 404);
  assert.equal((await send({action:'delete-file',course:plc.course,id:plc.id})).status, 200);
  assert.equal((await download({env,data:{clientEmail:alice},params:{id:plc.id}})).status, 404);
  const after = await (await courses({env,data:{clientEmail:alice}})).json();
  assert.deepEqual(after.courses.find(item => item.title === 'PLC').files, []);
  assert.equal(bucket.size, 1);
});
