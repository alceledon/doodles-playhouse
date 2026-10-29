import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, createHub, getAt, normalize, opFor, patchAt, setAt, splitPath } from '../../src/net/tree.js';

test('splitPath ignores slashes and refuses segments a URL could abuse', () => {
  assert.deepEqual(splitPath('/rooms//ABC/h/'), ['rooms', 'ABC', 'h']);
  assert.deepEqual(splitPath(''), []);
  for (const bad of ['rooms/..', 'a/b.c', 'a/$x', 'a/b?c', 'a/b#', 'a/%2e']) assert.throws(() => splitPath(bad), /bad path segment/);
});

test('normalize drops nulls, undefined, NaN and empty objects like the database', () => {
  assert.deepEqual(normalize({ a: 1, b: null, c: undefined, d: {}, e: { f: null }, g: NaN, h: 'x' }), { a: 1, h: 'x' });
  assert.equal(normalize({ a: null }), null);
  assert.equal(normalize(undefined), null);
});

test('setAt writes, deletes and prunes parents left empty', () => {
  let t = setAt(null, 'rooms/A/h/pose', 'p1');
  t = setAt(t, 'rooms/A/meta', { v: 1 });
  assert.equal(getAt(t, 'rooms/A/h/pose'), 'p1');
  t = setAt(t, 'rooms/A/h/pose', null);
  assert.equal(getAt(t, 'rooms/A/h'), null, 'h vanished with its last child');
  assert.deepEqual(getAt(t, 'rooms/A'), { meta: { v: 1 } });
  t = setAt(t, 'rooms/A/meta', null);
  assert.equal(t, null, 'the whole tree is empty');
  assert.equal(setAt(null, 'x/y', null), null, 'deleting nothing is fine');
});

test('patchAt sets and deletes several children', () => {
  let t = setAt(null, 'ev', { e1: 'a', e2: 'b', e3: 'c' });
  t = patchAt(t, 'ev', { e1: null, e2: null, e4: 'd' });
  assert.deepEqual(t, { ev: { e3: 'c', e4: 'd' } });
});

test('opFor: relative path below the listener, a full put when a parent changes, nothing elsewhere', () => {
  const read = () => ({ pose: 'p' });
  assert.deepEqual(opFor('rooms/A/h', 'rooms/A/h/pose', 'put', 'p', read), { op: 'put', path: '/pose', data: 'p' });
  assert.deepEqual(opFor('rooms/A/h', 'rooms/A/h', 'patch', { pose: 'p' }, read), { op: 'patch', path: '/', data: { pose: 'p' } });
  assert.deepEqual(opFor('rooms/A/h', 'rooms/A', 'put', null, read), { op: 'put', path: '/', data: { pose: 'p' } });
  assert.equal(opFor('rooms/A/h', 'rooms/A/g/pose', 'put', 'x', read), null);
  assert.equal(opFor('rooms/A/h', 'rooms/A', 'patch', { g: 1 }, read), null, 'a patch above that misses us');
  assert.equal(opFor('rooms/A/h', 'rooms/AB/h', 'put', 1, read), null, 'segment-wise, not string prefix');
});

test('applyOp keeps a mirror in step with put and patch ops', () => {
  let m = applyOp(null, { op: 'put', path: '/', data: { pose: 'a', ev: { e1: 'x' } } });
  m = applyOp(m, { op: 'put', path: '/pose', data: 'b' });
  m = applyOp(m, { op: 'patch', path: '/ev', data: { e1: null, e2: 'y' } });
  assert.deepEqual(m, { pose: 'b', ev: { e2: 'y' } });
  assert.equal(applyOp(m, { op: 'put', path: '/', data: null }), null);
});

test('createHub sends the current value first, then each change', async () => {
  let tree = setAt(null, 'r/h/pose', 'a');
  const hub = createHub((p) => getAt(tree, p));
  const got = [];
  const off = hub.listen('r/h', (op) => got.push(op));
  await Promise.resolve();
  tree = setAt(tree, 'r/h/pose', 'b');
  hub.notify('r/h/pose', 'put', 'b');
  off();
  hub.notify('r/h/pose', 'put', 'c');
  assert.deepEqual(got, [
    { op: 'put', path: '/', data: { pose: 'a' } },
    { op: 'put', path: '/pose', data: 'b' },
  ]);
});
