import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as publicList } from '../functions/api/carousel.js';
import { onRequestGet as adminList, onRequestPost, onRequestPatch, onRequestDelete } from '../functions/api/admin/carousel.js';
import { onRequestGet as readImage } from '../functions/api/carousel-image/[id].js';
import { onRequestGet as readAdminImage } from '../functions/api/admin/carousel-image/[id].js';
import { onRequest as adminMiddleware } from '../functions/api/admin/_middleware.js';

function createBucket() {
  const data = new Map();
  const versions = new Map();
  let revision = 0;
  return {
    get: async key => data.has(key) ? {
      json: async () => JSON.parse(new TextDecoder().decode(data.get(key))),
      body: data.get(key),
      httpEtag: versions.get(key),
    } : null,
    put: async (key, contents, options) => {
      const condition = options?.onlyIf;
      if (condition?.get('If-None-Match') === '*' && data.has(key)) return null;
      if (condition?.has('If-Match') && condition.get('If-Match') !== versions.get(key)) return null;
      data.set(key, typeof contents === 'string' ? new TextEncoder().encode(contents) : contents);
      versions.set(key, `"${++revision}"`);
      return { httpEtag: versions.get(key) };
    },
    delete: async key => data.delete(key),
    data,
  };
}

const key = 'carousel/manifest.json';

test('empty public carousel returns no slides', async () => {
  const result = await publicList({ env: {AUSO_MEDIA:createBucket()} });
  assert.deepEqual((await result.json()).slides, []);
});

test('upload image, update metadata/position, remove and read image', async () => {
  const bucket = createBucket();
  const env = { auso_media:bucket };
  const upload = new FormData();
  upload.append('title', 'AUSO motion control');
  upload.append('description', 'Siemens drives');
  upload.append('image', new File([new Uint8Array([0xff,0xd8,0xff,...Array(24).fill(1)])], 'photo.jpg', {type:'image/jpeg'}));
  const created = await onRequestPost({request:new Request('https://test.com/api/admin/carousel', {method:'POST',body:upload}),env});
  assert.equal(created.status,201);
  const slide = (await created.json()).slide;
  assert.match(slide.id, /^[0-9a-f-]+\.jpg$/);
  const image = await readImage({params:{id:slide.id},env});
  assert.equal(image.headers.get('content-type'),'image/jpeg');
  const admin = await adminList({env});
  const { slides, etag } = await admin.json();
  assert.equal(slides.length,1);
  const edit = await onRequestPatch({ request:new Request('https://test.com/api/admin/carousel', {
    method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({etag,slides:[{id:slide.id,title:'New title',description:'Updated text',active:false}]})
  }),env});
  assert.equal(edit.status,200);
  const hidden = await publicList({env});
  assert.equal((await hidden.json()).slides.length,0);
  assert.equal((await readImage({params:{id:slide.id},env})).status,404);
  assert.equal((await readAdminImage({params:{id:slide.id},env})).status,200);
  const removed = await onRequestDelete({request:new Request(`https://test.com/api/admin/carousel?id=${slide.id}`,{method:'DELETE'}),env});
  assert.equal(removed.status,200);
  assert.equal(bucket.data.has(key),true);
  assert.equal(bucket.data.has(`carousel/images/${slide.id}`),false);
});

test('reject mismatched mime or invalid image', async () => {
  const env = {AUSO_MEDIA:createBucket()};
  const upload = new FormData();
  upload.append('image', new File([new Uint8Array(25)],'fake.jpg',{type:'image/jpeg'}));
  const result = await onRequestPost({request:new Request('https://test.com', {method:'POST',body:upload}), env});
  assert.equal(result.status,400);
});

test('publishes the new order and rejects a stale edit', async () => {
  const env = { AUSO_MEDIA: createBucket() };
  const slides = ['first', 'second'].map(id => ({ id, title: id, active: true }));
  await env.AUSO_MEDIA.put(key, JSON.stringify({ slides }));
  const { etag } = await (await adminList({ env })).json();
  const reorder = () => onRequestPatch({ env, request: new Request('https://test.com', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ etag, slides: [...slides].reverse() }),
  }) });
  assert.equal((await reorder()).status, 200);
  const result = await (await publicList({ env })).json();
  assert.deepEqual(result.slides.map(slide => slide.id), ['second', 'first']);
  assert.equal((await reorder()).status, 409);
});

test('deny admin when JWT configuration is missing', async () => {
  const denied = await adminMiddleware({request:new Request('https://test.com/api/admin/carousel'),env:{},next:async()=>Response.json({shouldNotGetHere:true})});
  assert.equal(denied.status,503);
});

test('reject an invalid or missing Access token with admin account configured', async () => {
  const env = {
    CF_ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com',
    CF_ACCESS_AUD:'test-audience',
  };
  const denied = await adminMiddleware({ request:new Request('https://test.com/api/admin/carousel',{headers:{'Cf-Access-Jwt-Assertion':'fake.token.value'}}),env,next:async()=>Response.json({ok:true})});
  assert.equal(denied.status,403);
});

test('accepts a correctly signed token only for Leonardo administrative Gmail', async () => {
  const domain = 'https://auso-test.cloudflareaccess.com';
  const aud = 'auso-admin-aud';
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid = 'auso-test-key';
  const base64 = (data) => Buffer.from(data).toString('base64url');
  async function signToken(email) {
    const header = base64(JSON.stringify({alg:'RS256',typ:'JWT',kid:'auso-test-key'}));
    const payload = base64(JSON.stringify({iss:domain,aud:[aud],email,exp:Math.floor(Date.now()/1000)+900}));
    const content = `${header}.${payload}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(content));
    return `${content}.${base64(new Uint8Array(signature))}`;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, `${domain}/cdn-cgi/access/certs`);
    return Response.json({keys:[jwk]});
  };
  try {
    for (const [email, expected] of [
      ['leonardo.pulido89@gmail.com', 201],
      ['someoneelse@gmail.com', 403],
    ]) {
      const token = await signToken(email);
      const response = await adminMiddleware({
        request: new Request('https://ausoautomation.com/api/admin/carousel', {
          headers: {'Cf-Access-Jwt-Assertion': token},
        }),
        env: {CF_ACCESS_TEAM_DOMAIN:domain, CF_ACCESS_AUD:aud},
        next:async () => Response.json({ok:true}, {status:201}),
      });
      assert.equal(response.status, expected, `Admin access result for ${email}`);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      if (expected === 201) {
        assert.match(response.headers.get('Content-Type'), /application\/json/);
        assert.deepEqual(await response.json(), {ok:true});
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});
