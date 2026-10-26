import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { EVENTS } from '../../src/core/events.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { createTrapTriggers, placeTraps } from '../../src/gameplay/traps.js';
import { tuningFor } from '../../src/gameplay/tuning.js';
import { setup } from './helpers.js';

const count = (difficulty, seed = 1) => placeTraps(createMiniHouse().anchors.traps, createRng(seed), tuningFor(difficulty)).placed.length;

test('trap props are placed on candidate spots, more on Hard', () => {
  const world = createMiniHouse();
  const candidates = world.anchors.traps.filter((t) => t.kind === 'squeaky' || t.kind === 'blocks');
  for (let seed = 0; seed < 20; seed++) {
    const { placed, fixed } = placeTraps(world.anchors.traps, createRng(seed), tuningFor('normal'));
    for (const p of placed) assert.ok(candidates.includes(p));
    assert.equal(new Set(placed.map((p) => p.id)).size, placed.length);
    assert.deepEqual(fixed.map((f) => f.kind).sort(), ['creaky', 'piano']);
  }
  assert.ok(count('hard') > count('normal'), `hard ${count('hard')} vs normal ${count('normal')}`);
  assert.ok(count('normal') >= count('easy'));
  assert.ok(count('easy') >= 2, 'at least one of each kind');
});

test('trap placement is deterministic per seed', () => {
  const world = createMiniHouse();
  const ids = (seed) => placeTraps(world.anchors.traps, createRng(seed), tuningFor('hard')).placed.map((p) => p.id).join();
  assert.equal(ids(4), ids(4));
});

test('stepping on a trap fires once, and again after stepping off', () => {
  const tuning = tuningFor('normal');
  const spot = { id: 's', kind: 'squeaky', floorId: 'ground', pos: { x: 0, y: 0, z: 0 }, radius: 0.3 };
  const traps = createTrapTriggers([spot], tuning);
  assert.equal(traps.update({ x: 2, y: 0, z: 0 }, 'ground').length, 0);
  const fired = traps.update({ x: 0.1, y: 0, z: 0 }, 'ground');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].loudness, tuning.noise.squeak);
  assert.equal(traps.update({ x: 0.05, y: 0, z: 0 }, 'ground').length, 0); // still on it
  traps.update({ x: 2, y: 0, z: 0 }, 'ground');
  assert.equal(traps.update({ x: 0, y: 0, z: 0.1 }, 'ground', { crouched: true })[0].loudness, tuning.noise.squeak * tuning.noise.crouchTrapFactor);
  // Another floor doesn't count.
  traps.update({ x: 2, y: 0, z: 0 }, 'ground');
  assert.equal(traps.update({ x: 0, y: 3, z: 0 }, 'upstairs').length, 0);
});

test('block towers topple once per day', () => {
  const spot = { id: 'b', kind: 'blocks', floorId: 'ground', pos: { x: 0, y: 0, z: 0 }, radius: 0.4 };
  const traps = createTrapTriggers([spot], tuningFor('normal'));
  assert.equal(traps.update({ x: 0.2, y: 0, z: 0 }, 'ground').length, 1);
  assert.equal(traps.isToppled('b'), true);
  traps.update({ x: 3, y: 0, z: 0 }, 'ground');
  assert.equal(traps.update({ x: 0.2, y: 0, z: 0 }, 'ground').length, 0);
  traps.rearm();
  assert.equal(traps.isToppled('b'), false);
  assert.equal(traps.update({ x: 0.2, y: 0, z: 0 }, 'ground').length, 1);
});

test('creeping past the piano does not bump it', () => {
  const spot = { id: 'p', kind: 'piano', floorId: 'upstairs', pos: { x: 0, y: 3, z: 0 }, radius: 0.6 };
  const traps = createTrapTriggers([spot], tuningFor('normal'));
  assert.equal(traps.update({ x: 0.3, y: 3, z: 0 }, 'upstairs', { crouched: true }).length, 0);
  assert.equal(traps.update({ x: 0.3, y: 3, z: 0 }, 'upstairs').length, 1);
});

test('rules emit TRAP + NOISE, and clicking the piano plays it', () => {
  const t = setup();
  const creak = t.world.anchors.traps.find((s) => s.kind === 'creaky');
  t.player.pos = { x: 5, y: 0, z: 5 };
  t.player.floorId = 'ground';
  t.rules.updateTraps(t.player);
  t.player.pos = { ...creak.pos };
  t.rules.updateTraps(t.player);
  assert.deepEqual(t.of(EVENTS.TRAP).at(-1), { kind: 'creaky', pos: creak.pos, floorId: 'ground' });
  assert.equal(t.of(EVENTS.NOISE).at(-1).kind, 'creak');

  const piano = t.world.anchors.traps.find((s) => s.kind === 'piano');
  t.rules.interact({ kind: 'piano', id: piano.id }, t.player);
  assert.equal(t.of(EVENTS.TRAP).at(-1).kind, 'piano');
  assert.equal(t.of(EVENTS.NOISE).at(-1).kind, 'piano');
});

test('hidden players set off nothing', () => {
  const t = setup();
  const creak = t.world.anchors.traps.find((s) => s.kind === 'creaky');
  Object.assign(t.player, { pos: { ...creak.pos }, floorId: 'ground', hidden: true });
  assert.equal(t.rules.updateTraps(t.player).length, 0);
});
