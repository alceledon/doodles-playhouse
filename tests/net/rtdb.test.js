import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRtdbTransport } from '../../src/net/rtdb.js';

const URL_BASE = 'https://demo-rtdb.firebaseio.com';
const res = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body), keepalive: init.keepalive });
    const a = answers.shift();
    if (a === undefined) throw new Error(`unexpected fetch ${url}`);
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetch, calls };
}

/** Records instances; tests fire named events at them. */
class FakeEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.last = this;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type, data) {
    for (const fn of this.listeners[type] ?? []) fn({ data: data === undefined ? undefined : JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

const transport = (fetch, opts = {}) => createRtdbTransport({ databaseURL: URL_BASE + '/', fetch, EventSource: FakeEventSource, ...opts });

test('REST verbs map onto path.json', async () => {
  const { fetch, calls } = fakeFetch(res({ v: 1 }), res('x'), res({}), res(null), res(null));
  const t = transport(fetch);
  assert.deepEqual(await t.get('rooms/ABCDEF/meta'), { v: 1 });
  await t.put('rooms/ABCDEF/h/pose', 'x');
  await t.patch('rooms/ABCDEF/h/ev', { e000000001: null });
  await t.remove('rooms/ABCDEF', { keepalive: true });
  assert.equal(await t.get('rooms/NOPE22/meta'), null);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ['GET', `${URL_BASE}/rooms/ABCDEF/meta.json`],
    ['PUT', `${URL_BASE}/rooms/ABCDEF/h/pose.json`],
    ['PATCH', `${URL_BASE}/rooms/ABCDEF/h/ev.json`],
    ['DELETE', `${URL_BASE}/rooms/ABCDEF.json`],
    ['GET', `${URL_BASE}/rooms/NOPE22/meta.json`],
  ]);
  assert.equal(calls[1].body, 'x');
  assert.deepEqual(calls[2].body, { e000000001: null });
  assert.equal(calls[3].keepalive, true, 'a page closing can still delete its room');
});

test('create: the rules refusing (permission denied) means "already taken", other failures throw', async () => {
  const { fetch } = fakeFetch(res({ v: 1 }), res({ error: 'Permission denied' }, 401), res({ error: 'boom' }, 500), new TypeError('Failed to fetch'));
  const t = transport(fetch);
  assert.equal(await t.create('rooms/ABCDEF/meta', { v: 1 }), true);
  assert.equal(await t.create('rooms/ABCDEF/meta/guest', 'BO'), false);
  await assert.rejects(t.create('rooms/ABCDEF/meta/guest', 'BO'), (e) => e.kind === 'server');
  await assert.rejects(t.get('rooms/ABCDEF/meta'), (e) => e.kind === 'offline');
});

test('a hung request times out as offline', async () => {
  const t = transport(() => new Promise(() => {}), { timeoutMs: 20 });
  await assert.rejects(t.get('rooms/ABCDEF/meta'), (e) => e.kind === 'offline' && /too long/.test(e.message));
});

test('bad URLs and paths are refused before anything is sent', async () => {
  assert.throws(() => createRtdbTransport({ databaseURL: 'http://insecure.example.com', fetch: () => {} }));
  assert.throws(() => createRtdbTransport({ databaseURL: 'https://x.firebaseio.com/sub/path', fetch: () => {} }));
  const { fetch, calls } = fakeFetch();
  await assert.rejects(transport(fetch).get('rooms/../secrets'), /bad path segment/);
  assert.equal(calls.length, 0);
});

test('listen turns SSE put/patch events into ops; cancel reports an error; unsubscribe closes', () => {
  const t = transport(() => {});
  const ops = [];
  const errors = [];
  const off = t.listen('rooms/ABCDEF/h', (op) => ops.push(op), (e) => errors.push(e.kind));
  const es = FakeEventSource.last;
  assert.equal(es.url, `${URL_BASE}/rooms/ABCDEF/h.json`);
  es.fire('put', { path: '/', data: { pose: 'p' } });
  es.fire('patch', { path: '/ev', data: { e000000001: 'm' } });
  es.fire('keep-alive', null);
  es.fire('put', 'not an object');
  es.listeners.put[0]({ data: '{broken' });
  es.fire('cancel', null);
  assert.deepEqual(ops, [
    { op: 'put', path: '/', data: { pose: 'p' } },
    { op: 'patch', path: '/ev', data: { e000000001: 'm' } },
  ]);
  assert.deepEqual(errors, ['rejected']);
  off();
  assert.equal(es.closed, true);
});
