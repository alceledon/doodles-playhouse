import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../../src/core/contracts.js';
import { FAKE_KEY, createFakeLeaderboard } from '../../src/leaderboard/fake.js';

function fakeStorage({ broken = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem(k) {
      if (broken) throw new Error('SecurityError');
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (broken) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
  };
}

const run = (patch = {}) => ({ name: 'AL', seconds: 500, days: 2, route: 'garage', difficulty: 'normal', ...patch });

test('fake board: same API, seeded and sorted on every difficulty', async () => {
  const lb = createFakeLeaderboard({ latencyMs: 0 });
  assert.equal(lb.enabled, true);
  assert.equal(lb.canSubmit, true);
  for (const d of DIFFICULTIES) {
    const rows = await lb.top(d);
    assert.ok(rows.length >= 3, `${d} has seed runs`);
    for (let k = 1; k < rows.length; k++) assert.ok(rows[k - 1].seconds <= rows[k].seconds, `${d} is fastest first`);
    for (const r of rows) {
      assert.deepEqual(Object.keys(r).sort(), ['at', 'days', 'id', 'name', 'route', 'seconds']);
      assert.match(r.name, /^[A-Z0-9]{1,6}$/);
      assert.ok(r.seconds >= 60);
    }
  }
  assert.equal((await lb.top('normal', 2)).length, 2);
});

test('fake board: submit ranks the run and puts it on the board', async () => {
  const lb = createFakeLeaderboard({ latencyMs: 0 });
  const before = await lb.top('normal', 100);
  const ahead = before.filter((r) => r.seconds < 500.004).length;
  const res = await lb.submit(run({ seconds: 500.004 }));
  assert.equal(res.rank, ahead + 1);
  assert.equal(res.entry.seconds, 500, 'rounded to 2 decimals like the real one');
  assert.equal(await lb.rankOf('normal', 500), ahead + 1, 'a tie shares the place');
  const after = await lb.top('normal', 100);
  assert.equal(after.length, before.length + 1);
  assert.ok(after.some((r) => r.id === res.id && r.name === 'AL'));
  assert.equal(await lb.rankOf('normal', 1), 1);
  // Returned rows are copies: editing them doesn't touch the board.
  after[0].name = 'HACKED';
  assert.notEqual((await lb.top('normal', 1))[0].name, 'HACKED');
});

test('fake board: the same checks as the real one', async () => {
  const lb = createFakeLeaderboard({ latencyMs: 0 });
  for (const patch of [{ name: '' }, { name: 'sh1t' }, { name: '5H1T' }, { seconds: 30 }, { days: 0 }, { route: 'roof' }, { difficulty: 'insane' }]) {
    await assert.rejects(lb.submit(run(patch)), (err) => err.kind === 'invalid', JSON.stringify(patch));
  }
  await assert.rejects(lb.top('insane'), (err) => err.kind === 'invalid');
  lb.canSubmit = false;
  await assert.rejects(lb.submit(run()), (err) => err.kind === 'disabled');
  assert.equal(createFakeLeaderboard({ allowSubmit: false, latencyMs: 0 }).canSubmit, false);
});

test('fake board: failNext makes the next calls fail, then it recovers', async () => {
  const lb = createFakeLeaderboard({ latencyMs: 0 });
  lb.failNext('offline');
  await assert.rejects(lb.top('easy'), (err) => err.kind === 'offline');
  assert.ok((await lb.top('easy')).length > 0);
  const before = (await lb.top('normal', 100)).length;
  lb.failNext('rejected', 2);
  await assert.rejects(lb.submit(run()), (err) => err.kind === 'rejected' && err.status === 403);
  await assert.rejects(lb.submit(run()), (err) => err.kind === 'rejected');
  assert.equal((await lb.top('normal', 100)).length, before, 'failed posts added nothing');
  await lb.submit(run());
  assert.equal((await lb.top('normal', 100)).length, before + 1);
});

test('fake board: kept in storage across instances; junk or broken storage falls back to the seed', async () => {
  const storage = fakeStorage();
  const a = createFakeLeaderboard({ storage, latencyMs: 0 });
  const { id } = await a.submit(run({ name: 'KEPT', difficulty: 'hard', seconds: 61 }));
  assert.ok(storage.data.has(FAKE_KEY));
  const b = createFakeLeaderboard({ storage, latencyMs: 0 });
  assert.equal((await b.top('hard', 1))[0].id, id);
  const second = await b.submit(run({ name: 'NEXT', difficulty: 'hard', seconds: 62 }));
  assert.notEqual(second.id, id, 'ids keep counting up');

  storage.data.set(FAKE_KEY, '{nope');
  assert.ok((await createFakeLeaderboard({ storage, latencyMs: 0 }).top('hard')).length > 0);
  const broken = createFakeLeaderboard({ storage: fakeStorage({ broken: true }), latencyMs: 0 });
  await broken.submit(run());
  assert.ok((await broken.top('normal')).length > 0);
});

test('fake board: latency is real time', async () => {
  const lb = createFakeLeaderboard({ latencyMs: 30 });
  const t0 = Date.now();
  await lb.top('practice');
  assert.ok(Date.now() - t0 >= 25);
});
