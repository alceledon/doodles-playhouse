import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashSeed } from '../../src/core/rng.js';

test('same seed gives the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let k = 0; k < 20; k++) assert.equal(a.next(), b.next());
});

test('string seeds hash stably', () => {
  assert.equal(hashSeed('doodle'), hashSeed('doodle'));
  assert.notEqual(hashSeed('doodle'), hashSeed('poodle'));
  assert.equal(createRng('doodle').next(), createRng('doodle').next());
});

test('int stays inside [min, max] and hits both ends', () => {
  const r = createRng(7);
  const seen = new Set();
  for (let k = 0; k < 500; k++) {
    const v = r.int(1, 4);
    assert.ok(v >= 1 && v <= 4 && Number.isInteger(v));
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('shuffle is a permutation and does not mutate its input', () => {
  const r = createRng(1);
  const input = [1, 2, 3, 4, 5, 6];
  const out = r.shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort(), input);
});

test('forks are stable per label and independent of draw order', () => {
  const a = createRng(99);
  a.next();
  a.next();
  const b = createRng(99);
  assert.equal(a.fork('items').next(), b.fork('items').next());
  assert.notEqual(b.fork('items').next(), b.fork('traps').next());
});
