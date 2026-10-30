import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboard, decodeEntry } from '../../src/leaderboard/client.js';
import { FIREBASE } from '../../src/leaderboard/config.js';

const CONFIG = { projectId: 'demo-proj', apiKey: 'KEY123' };
const BASE = 'https://firestore.googleapis.com/v1/projects/demo-proj/databases/(default)/documents';
const DOC = 'projects/demo-proj/databases/(default)/documents';

const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fetch that records each call and answers from the queue: a Response, an Error to throw, or a function. */
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal });
    const a = answers.shift();
    if (a === undefined) throw new Error(`unexpected fetch #${calls.length}: ${url}`);
    if (typeof a === 'function') return a(url, init);
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetch, calls };
}

const board = (fetch, opts = {}) => createLeaderboard({ config: CONFIG, fetch, ...opts });
const rejectsWith = (promise, kind) => assert.rejects(promise, (err) => {
  assert.equal(err.kind, kind, `expected kind ${kind}, got ${err.kind}: ${err.message}`);
  assert.ok(err.message, 'has a message for the player');
  return true;
});

const countAnswer = (ahead) => json([{ result: { aggregateFields: { ahead: { integerValue: String(ahead) } } }, readTime: '2026-10-28T12:00:00Z' }]);

test('submit: exact add request, then the rank query; rank = ahead + 1', async () => {
  const { fetch, calls } = fakeFetch(
    json({ name: `${DOC}/runs_normal/abc123`, fields: {}, createTime: '2026-10-28T12:00:00.5Z', updateTime: '2026-10-28T12:00:00.5Z' }),
    countAnswer(3),
  );
  const lb = board(fetch);
  assert.equal(lb.enabled, true);
  assert.equal(lb.canSubmit, true);
  const result = await lb.submit({ name: 'AL', seconds: 312.456, days: 2, route: 'garage', difficulty: 'normal' });
  assert.deepEqual(result, {
    id: 'abc123',
    rank: 4,
    entry: { id: 'abc123', name: 'AL', seconds: 312.46, days: 2, route: 'garage', at: '2026-10-28T12:00:00.5Z' },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${BASE}/runs_normal?key=KEY123`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body, {
    fields: {
      name: { stringValue: 'AL' },
      seconds: { doubleValue: 312.46 },
      days: { integerValue: '2' },
      route: { stringValue: 'garage' },
      v: { integerValue: '1' },
    },
  });
  assert.ok(calls[0].signal, 'every request can be aborted');

  assert.equal(calls[1].url, `${BASE}:runAggregationQuery?key=KEY123`);
  assert.deepEqual(calls[1].body, {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: 'runs_normal' }],
        where: { fieldFilter: { field: { fieldPath: 'seconds' }, op: 'LESS_THAN', value: { doubleValue: 312.46 } } },
      },
      aggregations: [{ alias: 'ahead', count: {} }],
    },
  });
});

test('submit: posted but the rank lookup failed → rank null, no second post', async () => {
  const { fetch, calls } = fakeFetch(json({ name: `${DOC}/runs_easy/xyz`, createTime: '2026-10-28T12:00:00Z' }), new TypeError('Failed to fetch'));
  const result = await board(fetch).submit({ name: 'ZOE', seconds: 400, days: 1, route: 'frontDoor', difficulty: 'easy' });
  assert.equal(result.id, 'xyz');
  assert.equal(result.rank, null);
  assert.equal(calls.length, 2);
});

test('submit: a failed post rejects and never asks for a rank', async () => {
  const { fetch, calls } = fakeFetch(json({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }, 403));
  await assert.rejects(board(fetch).submit({ name: 'AL', seconds: 300, days: 1, route: 'garage', difficulty: 'hard' }), (err) => {
    assert.equal(err.kind, 'rejected');
    assert.equal(err.status, 403);
    assert.equal(err.detail, 'Missing or insufficient permissions.');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('top: exact query, decodes integerValue strings and doubleValues', async () => {
  const { fetch, calls } = fakeFetch(
    json([
      { document: { name: `${DOC}/runs_hard/a1`, fields: { name: { stringValue: 'NOVA' }, seconds: { doubleValue: 301.5 }, days: { integerValue: '1' }, route: { stringValue: 'garage' }, v: { integerValue: '1' } }, createTime: '2026-10-01T10:00:00Z' }, readTime: 'r' },
      { document: { name: `${DOC}/runs_hard/b2`, fields: { name: { stringValue: 'MAX' }, seconds: { integerValue: '305' }, days: { integerValue: '3' }, route: { stringValue: 'frontDoor' }, v: { integerValue: '1' } }, createTime: '2026-10-02T10:00:00Z' }, readTime: 'r' },
    ]),
  );
  const rows = await board(fetch).top('hard', 5);
  assert.deepEqual(rows, [
    { id: 'a1', name: 'NOVA', seconds: 301.5, days: 1, route: 'garage', at: '2026-10-01T10:00:00Z' },
    { id: 'b2', name: 'MAX', seconds: 305, days: 3, route: 'frontDoor', at: '2026-10-02T10:00:00Z' },
  ]);
  assert.equal(typeof rows[1].seconds, 'number');
  assert.equal(typeof rows[1].days, 'number');
  assert.equal(calls[0].url, `${BASE}:runQuery?key=KEY123`);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {
    structuredQuery: {
      from: [{ collectionId: 'runs_hard' }],
      orderBy: [{ field: { fieldPath: 'seconds' }, direction: 'ASCENDING' }],
      limit: 5,
    },
  });
});

test('top: an empty board is [{readTime}] → []; the default limit is 10', async () => {
  const { fetch, calls } = fakeFetch(json([{ readTime: '2026-10-28T12:00:00Z' }]));
  assert.deepEqual(await board(fetch).top('practice'), []);
  assert.equal(calls[0].body.structuredQuery.limit, 10);
  assert.equal(calls[0].body.structuredQuery.from[0].collectionId, 'runs_practice');
});

test('decodeEntry tolerates missing fields', () => {
  const e = decodeEntry({ name: `${DOC}/runs_easy/q`, fields: { seconds: { doubleValue: 'NaN' } } });
  assert.equal(e.id, 'q');
  assert.equal(e.name, '');
  assert.ok(Number.isNaN(e.seconds));
  assert.equal(e.at, null);
});

test('rankOf: rank = ahead + 1, an empty count is first place', async () => {
  const { fetch, calls } = fakeFetch(countAnswer(0), countAnswer(41));
  const lb = board(fetch);
  assert.equal(await lb.rankOf('easy', 250), 1);
  assert.equal(await lb.rankOf('easy', 999.999), 42);
  assert.equal(calls[0].url, `${BASE}:runAggregationQuery?key=KEY123`);
  assert.deepEqual(calls[0].body.structuredAggregationQuery.structuredQuery.where.fieldFilter.value, { doubleValue: 250 });
  assert.deepEqual(calls[1].body.structuredAggregationQuery.structuredQuery.where.fieldFilter.value, { doubleValue: 1000 });
});

test('rankOf: a count that is missing or junk is a server error', async () => {
  const { fetch } = fakeFetch(json([{ readTime: 'r' }]), json({ nope: true }));
  const lb = board(fetch);
  await rejectsWith(lb.rankOf('normal', 300), 'server');
  await rejectsWith(lb.rankOf('normal', 300), 'server');
});

test('errors: network → offline, 403 → rejected, 500 → server, junk answers → server', async () => {
  const cases = [
    [new TypeError('Failed to fetch'), 'offline'],
    [json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403), 'rejected'],
    [json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429), 'rejected'],
    [json({ error: { code: 500, status: 'INTERNAL' } }, 500), 'server'],
    [json('<html>Bad gateway</html>', 502), 'server'],
    [json('not json at all'), 'server'],
    [json({ document: 'not an array' }), 'server'],
    [json([{ error: { code: 13 } }]), 'server'],
  ];
  for (const [answer, kind] of cases) {
    const { fetch } = fakeFetch(answer);
    await rejectsWith(board(fetch).top('normal'), kind);
  }
});

test('errors: a request that hangs times out as offline (with or without abort support)', async () => {
  const honorsAbort = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const ignoresAbort = () => new Promise(() => {});
  for (const hang of [honorsAbort, ignoresAbort]) {
    const { fetch } = fakeFetch(hang);
    const started = Date.now();
    await assert.rejects(board(fetch, { timeoutMs: 30 }).top('normal'), (err) => err.kind === 'offline' && /too long/.test(err.message));
    assert.ok(Date.now() - started < 1000);
  }
  // A body that never finishes counts too.
  const slowBody = () => ({ ok: true, status: 200, text: () => new Promise(() => {}) });
  const { fetch } = fakeFetch(slowBody);
  await rejectsWith(board(fetch, { timeoutMs: 30 }).top('normal'), 'offline');
});

test('invalid entries never reach the network', async () => {
  const { fetch, calls } = fakeFetch();
  const lb = board(fetch);
  const ok = { name: 'AL', seconds: 300, days: 2, route: 'garage', difficulty: 'normal' };
  const bad = [
    { name: '' },
    { name: 'al' },
    { name: 'TOOLONG' },
    { name: 'SH1T' },
    { seconds: 59.99 },
    { seconds: 86400 },
    { seconds: '300' },
    { days: 0 },
    { days: 6 },
    { days: 1.5 },
    { route: 'chimney' },
    { difficulty: 'insane' },
  ];
  for (const patch of bad) await rejectsWith(lb.submit({ ...ok, ...patch }), 'invalid');
  await rejectsWith(lb.submit(), 'invalid');
  await rejectsWith(lb.top('insane'), 'invalid');
  await rejectsWith(lb.rankOf('normal', NaN), 'invalid');
  assert.equal(calls.length, 0);
});

test('a blank project disables everything without touching the network', async () => {
  const { fetch, calls } = fakeFetch();
  for (const config of [{ projectId: '', apiKey: '' }, { projectId: '   ', apiKey: 'x' }, {}, null]) {
    const lb = createLeaderboard({ config, fetch });
    assert.equal(lb.enabled, false);
    assert.equal(lb.canSubmit, false);
    await rejectsWith(lb.top('normal'), 'disabled');
    await rejectsWith(lb.rankOf('normal', 300), 'disabled');
    await rejectsWith(lb.submit({ name: 'AL', seconds: 300, days: 1, route: 'garage', difficulty: 'normal' }), 'disabled');
  }
  assert.equal(calls.length, 0);
});

test('config.js has the shape the client reads, and the default client follows it', () => {
  assert.equal(typeof FIREBASE.projectId, 'string');
  assert.equal(typeof FIREBASE.apiKey, 'string');
  const lb = createLeaderboard({ fetch: async () => json([]) });
  assert.equal(lb.enabled, FIREBASE.projectId.trim() !== '');
});

test('allowSubmit false (dev runs): reads work, posting is refused before any request', async () => {
  const { fetch, calls } = fakeFetch(json([{ readTime: 'r' }]));
  const lb = board(fetch, { allowSubmit: false });
  assert.equal(lb.enabled, true);
  assert.equal(lb.canSubmit, false);
  await rejectsWith(lb.submit({ name: 'AL', seconds: 300, days: 1, route: 'garage', difficulty: 'normal' }), 'disabled');
  assert.equal(calls.length, 0);
  assert.deepEqual(await lb.top('normal'), []);
  assert.equal(calls.length, 1);
});

test('no API key: the URL has no ?key=', async () => {
  const { fetch, calls } = fakeFetch(json([{ readTime: 'r' }]));
  await createLeaderboard({ config: { projectId: 'demo-proj', apiKey: '' }, fetch }).top('easy');
  assert.equal(calls[0].url, `${BASE}:runQuery`);
});

test('co-op: posts name2 to the rule\'s board, and top/rankOf read that board', async () => {
  const { fetch, calls } = fakeFetch(
    json({ name: `${DOC}/coop_knockout_hard/k1`, createTime: '2026-10-29T12:00:00Z' }),
    countAnswer(0),
    json([{ document: { name: `${DOC}/coop_knockout_hard/k1`, fields: { name: { stringValue: 'AL' }, name2: { stringValue: 'BO' }, seconds: { doubleValue: 300 }, days: { integerValue: '1' }, route: { stringValue: 'garage' } } } }]),
  );
  const lb = board(fetch);
  const r = await lb.submit({ name: 'AL', name2: 'BO', seconds: 300, days: 1, route: 'garage', difficulty: 'hard', coop: 'knockout' });
  assert.equal(r.rank, 1);
  assert.equal(calls[0].url, `${BASE}/coop_knockout_hard?key=KEY123`);
  assert.deepEqual(calls[0].body.fields.name2, { stringValue: 'BO' });
  assert.equal(calls[1].body.structuredAggregationQuery.structuredQuery.from[0].collectionId, 'coop_knockout_hard');
  const top = await lb.top('hard', 10, { coop: 'knockout' });
  assert.equal(calls[2].body.structuredQuery.from[0].collectionId, 'coop_knockout_hard');
  assert.equal(top[0].name2, 'BO');
});

test('co-op: a missing or bad name2 is refused before anything is sent; unknown rules too', async () => {
  const { fetch, calls } = fakeFetch();
  const lb = board(fetch);
  await rejectsWith(lb.submit({ name: 'AL', seconds: 300, days: 1, route: 'garage', difficulty: 'hard', coop: 'shared' }), 'invalid');
  await rejectsWith(lb.submit({ name: 'AL', name2: 'b o', seconds: 300, days: 1, route: 'garage', difficulty: 'hard', coop: 'shared' }), 'invalid');
  await rejectsWith(lb.top('hard', 10, { coop: 'everyone' }), 'invalid');
  assert.equal(calls.length, 0);
});
