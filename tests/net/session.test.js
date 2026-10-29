import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryServer } from '../../src/net/memory.js';
import { hostRoom, joinRoom } from '../../src/net/session.js';

/** Let every pending transport call and listener settle. */
const settle = async () => {
  for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
};

/** Bytes that always spell the same code, so tests can name the room. */
const fixedBytes = (n) => Uint8Array.from({ length: n }, (_, k) => k % 31);
const CODE = 'ABCDEF';

async function pair({ rule = 'shared', hostOpts = {}, guestOpts = {} } = {}) {
  const server = createMemoryServer();
  const clock = { t: 1000 };
  const now = () => clock.t;
  const host = await hostRoom({ transport: server.transport(), name: 'AL', difficulty: 'normal', rule, now, randomBytes: fixedBytes, ...hostOpts });
  const log = { host: [], guest: [] };
  for (const type of ['joined', 'left', 'message', 'set', 'status', 'error']) host.on(type, (p) => log.host.push({ type, p }));
  await settle();
  const guest = await joinRoom({ transport: server.transport(), code: CODE, name: 'BO', now, ...guestOpts });
  for (const type of ['joined', 'left', 'message', 'set', 'status', 'error']) guest.on(type, (p) => log.guest.push({ type, p }));
  /** Advance the clock and tick both sides, ms at a time. */
  const run = async (ms, step = 16, sides = [host, guest]) => {
    for (let k = 0; k < ms; k += step) {
      clock.t += step;
      for (const s of sides) s.tick(clock.t);
      await settle();
    }
  };
  return { server, clock, host, guest, log, run };
}

const of = (log, type) => log.filter((e) => e.type === type).map((e) => e.p);

test('hosting writes the room meta; joining claims the guest seat and says hello', async () => {
  const { server, host, guest, log, run } = await pair();
  assert.equal(host.code, CODE);
  await run(100);
  assert.deepEqual(of(log.host, 'joined'), [{ name: 'BO' }]);
  assert.equal(host.partnerName, 'BO');
  assert.equal(guest.partnerName, 'AL');
  const meta = server.read(`rooms/${CODE}/meta`);
  assert.equal(meta.guest, 'BO');
  assert.equal(meta.status, 'lobby');
  assert.equal(meta.rule, 'shared');
});

test('joining fails clearly: bad code, no room, full room, started game', async () => {
  const { server } = await pair();
  const t = server.transport();
  const kind = (kind) => (err) => (assert.equal(err.kind, kind), true);
  await assert.rejects(joinRoom({ transport: t, code: 'abc', name: 'X' }), kind('notFound'));
  await assert.rejects(joinRoom({ transport: t, code: 'ZZZZZZ', name: 'X' }), kind('notFound'));
  await assert.rejects(joinRoom({ transport: t, code: CODE, name: 'X' }), kind('full'));
  await t.put(`rooms/${CODE}/meta/status`, 'playing');
  await t.put(`rooms/${CODE}/meta/guest`, null);
  await assert.rejects(joinRoom({ transport: t, code: CODE, name: 'X' }), kind('started'));
});

test('messages arrive in order both ways, batched', async () => {
  const { server, host, guest, log, run } = await pair();
  const before = server.writes.length;
  for (let k = 0; k < 5; k++) host.send({ type: 'flow', step: 'n', k });
  guest.send({ type: 'intent', intent: { verb: 'primary' } });
  await run(64);
  assert.deepEqual(of(log.guest, 'message').map((m) => m.k), [0, 1, 2, 3, 4]);
  assert.deepEqual(of(log.host, 'message').map((m) => m.intent?.verb).filter(Boolean), ['primary']);
  const evWrites = server.writes.slice(before).filter((w) => w.path.includes('/h/ev/'));
  assert.equal(evWrites.length, 1, 'five messages in one write');
});

test('latest-wins channels: rate-limited, newest value only, and only the right side may write each', async () => {
  const { server, host, guest, log, run } = await pair();
  await run(200);
  const before = server.writes.filter((w) => w.path.endsWith('/h/pose')).length;
  for (let k = 0; k < 10; k++) host.set('pose', { k }); // all in one frame
  await run(16);
  for (let k = 10; k < 20; k++) host.set('pose', { k });
  await run(200);
  const poses = of(log.guest, 'set').filter((s) => s.channel === 'pose').map((s) => s.value.k);
  assert.deepEqual(poses, [9, 19]);
  assert.equal(server.writes.filter((w) => w.path.endsWith('/h/pose')).length - before, 2);
  assert.throws(() => guest.set('doodle', {}), /doesn't write/);
  assert.throws(() => host.set('teleport', {}), /unknown co-op channel/);
});

test('a batch that lands early waits for the one before it; a lost one is skipped after gapMs', async () => {
  const { server, host, log, run } = await pair();
  await run(100);
  const raw = server.transport();
  const ev = (seq) => `rooms/${CODE}/g/ev/e${String(seq).padStart(9, '0')}`;
  // The guest's own hello took seq 1 and a ping/pong may have followed; write well past them.
  const base = 50;
  await raw.put(ev(base + 2), JSON.stringify([{ type: 'flow', step: 'second' }]));
  await raw.put(ev(base + 1), JSON.stringify([{ type: 'flow', step: 'first' }]));
  await run(16, 16, [host]);
  // base+1 and base+2 wait for the real gap (3..base) to time out, then come in order.
  assert.deepEqual(of(log.host, 'message').map((m) => m.step).filter(Boolean), []);
  await run(3100, 50, [host]);
  assert.deepEqual(of(log.host, 'message').map((m) => m.step).filter(Boolean), ['first', 'second']);
});

test('pings measure lag; the receiver acks and the sender prunes what was read', async () => {
  const { server, host, guest, run } = await pair();
  await run(4500);
  assert.ok(host.lagMs !== null && host.lagMs >= 0, `host lag ${host.lagMs}`);
  assert.ok(guest.lagMs !== null, 'guest lag measured too');
  host.send({ type: 'flow', step: 'x' });
  await run(3500);
  const left = Object.keys(server.read(`rooms/${CODE}/h/ev`) ?? {});
  assert.ok(left.length <= 2, `acknowledged batches deleted, ${left.length} left`);
  assert.ok(server.read(`rooms/${CODE}/g/ack`), 'guest acks');
});

test('silence: waiting after waitingMs, gone after leftMs', async () => {
  const { host, log, run } = await pair({ hostOpts: { waitingMs: 1000, leftMs: 5000 } });
  await run(200);
  await run(1500, 50, [host]); // the guest stops ticking: no pings, no pongs
  assert.deepEqual(of(log.host, 'status').map((s) => s.status), ['waiting']);
  await run(4000, 50, [host]);
  assert.deepEqual(of(log.host, 'left'), [{ reason: 'timeout' }]);
  assert.deepEqual(of(log.host, 'status').map((s) => s.status), ['waiting', 'ok']);
  assert.equal(host.partnerName, null, 'the seat is free again');
});

test('the guest leaving says bye; the host keeps the room and a new guest can join', async () => {
  const { server, host, guest, log, run } = await pair();
  await run(100);
  await guest.close();
  await run(100, 16, [host]);
  assert.deepEqual(of(log.host, 'left'), [{ reason: 'left' }]);
  assert.equal(server.read(`rooms/${CODE}/meta/guest`), null);
  const again = await joinRoom({ transport: server.transport(), code: CODE, name: 'CY' });
  const got = [];
  again.on('message', (m) => got.push(m.step));
  await run(100, 16, [host, again]);
  assert.deepEqual(of(log.host, 'joined').map((j) => j.name), ['BO', 'CY']);
  host.send({ type: 'flow', step: 'hi' });
  await run(100, 16, [host, again]);
  assert.deepEqual(got, ['hi']);
});

test('the host leaving deletes the room, and the guest hears it', async () => {
  const { server, host, guest, log, run } = await pair();
  host.set('pose', { k: 1 });
  await run(200);
  await host.close();
  await run(100, 16, [guest]);
  assert.equal(server.read(`rooms/${CODE}`), null);
  assert.deepEqual(of(log.guest, 'left'), [{ reason: 'left' }]);
});
