import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { tuningFor } from '../../src/doodle/tuning.js';
import { floorRanks, hear, look, dartHits, sightRange } from '../../src/doodle/senses.js';
import { createScent } from '../../src/doodle/scent.js';
import { makePlayer } from './helpers.js';

const N = tuningFor('normal');
const body = (x, z, floorId = 'ground', yaw = 0) => ({ pos: { x, y: floorId === 'ground' ? 0 : 3, z }, floorId, yaw });

test('tuning: speeds and stun times per difficulty', () => {
  assert.equal(N.patrolSpeed, 2.5);
  assert.equal(N.chaseSpeed, 4.6);
  assert.ok(tuningFor('easy').chaseSpeed < N.chaseSpeed && tuningFor('easy').hearing < N.hearing);
  assert.ok(tuningFor('hard').chaseSpeed > N.chaseSpeed && tuningFor('hard').nose > N.nose);
  assert.ok(tuningFor('hard').chaseSpeed < 5, 'a sprinting player (5 m/s) still outruns it');
  assert.deepEqual(['easy', 'normal', 'hard'].map((d) => tuningFor(d).stunTime), [30, 20, 12]);
  assert.equal(tuningFor('hard').treatIgnoreChance, 0.5);
  assert.equal(tuningFor('practice').stunTime, 30);
});

test('hearing: loudness is a radius, damped per floor and scaled by difficulty', () => {
  const world = createMiniHouse();
  const ranks = floorRanks(world);
  const d = body(3, 6);
  const near = { pos: { x: 3, y: 0, z: 1.5 }, floorId: 'ground', loudness: 5 };
  assert.ok(hear(near, d, ranks, N).heard);
  assert.ok(!hear({ ...near, floorId: 'upstairs' }, d, ranks, N).heard, '5 m through a floor is ~1.75 m');
  assert.ok(!hear(near, d, ranks, tuningFor('easy')).heard, 'Easy hears 30% less');
  assert.ok(hear({ ...near, loudness: 3.6 }, d, ranks, tuningFor('hard')).heard);
});

test('sight: a 110° cone, range set by visibility, blocked by walls and closed doors', () => {
  const world = createMiniHouse();
  const d = body(8.5, 6, 'ground', 0); // in the kitchen, facing -Z
  const ahead = makePlayer(8.5, 0, 2.5);
  assert.ok(look(d, ahead, world, N).visible);

  const behind = makePlayer(8.5, 0, 7.5 + 0.0);
  behind.pos.z = 7.2; // 1.2+ m behind, outside the cone and closeSense
  d.pos.z = 5.5;
  assert.equal(look(d, behind, world, N).reason, 'outside cone');
  d.pos.z = 6;

  assert.ok(look(d, makePlayer(10.9, 0, 4), world, N).inCone, '50° off to the right: inside the 55° half-angle');
  assert.equal(look(d, makePlayer(11.4, 0, 4.2), world, N).reason, 'outside cone', '58° off');

  const dark = makePlayer(8.5, 0, 2.5, 'ground', { vis: 0 });
  assert.equal(look(d, dark, world, N).reason, 'too far', 'crouched in the dark it only sees ~1.5 m');
  assert.ok(sightRange(0.1, N) > 5, 'dim light still reads at mid range');

  const otherFloor = makePlayer(8.5, 3, 2.5, 'upstairs');
  assert.equal(look(d, otherFloor, world, N).reason, 'other floor');

  // Hall player seen from the kitchen side of the hallKitchen doorway: only while the door is open.
  const k = body(7.5, 4, 'ground', Math.PI / 2); // facing -X, toward the doorway
  const hall = makePlayer(5, 0, 3.8);
  assert.equal(look(k, hall, world, N).reason, 'blocked');
  world.doors.find((x) => x.id === 'hallKitchen').setOpen(true);
  assert.ok(look(k, hall, world, N).visible);

  const wallBetween = makePlayer(3, 0, 6.4);
  assert.equal(look(body(7.5, 6.4, 'ground', Math.PI / 2), wallBetween, world, N).reason, 'blocked');

  const hidden = makePlayer(8.5, 0, 2.5);
  hidden.hidden = true;
  assert.equal(look(d, hidden, world, N).reason, 'hidden');
});

test('darts: ray vs bounds, stopped by walls', () => {
  const world = createMiniHouse();
  const bounds = { center: { x: 6.9, y: 0.8, z: 6.4 }, radius: 0.8 };
  const aim = (from) => {
    const v = { x: bounds.center.x - from.x, y: bounds.center.y - from.y, z: bounds.center.z - from.z };
    const l = Math.hypot(v.x, v.y, v.z);
    return { origin: from, dir: { x: v.x / l, y: v.y / l, z: v.z / l }, range: 20 };
  };
  assert.ok(dartHits(aim({ x: 9, y: 1.1, z: 3 }), bounds, 'ground', world) !== null);
  assert.equal(dartHits({ ...aim({ x: 9, y: 1.1, z: 3 }), dir: { x: 1, y: 0, z: 0 } }, bounds, 'ground', world), null, 'aimed away');
  assert.equal(dartHits({ ...aim({ x: 9, y: 1.1, z: 3 }), range: 2 }, bounds, 'ground', world), null, 'out of range');
  assert.equal(dartHits(aim({ x: 3, y: 1.1, z: 6.4 }), bounds, 'ground', world), null, 'through the hall wall');
});

test('scent: crumbs every meter, freshest in range wins; standing still grows a pool', () => {
  const world = createMiniHouse();
  const scent = createScent(N, floorRanks(world));
  const p = makePlayer(1, 0, 2);
  let now = 0;
  for (let x = 1; x <= 5; x += 0.1) {
    p.pos.x = x;
    scent.update(now, 0.1, p, null);
    now += 0.1;
  }
  assert.ok(scent.crumbs.length >= 4 && scent.crumbs.length <= 6, `${scent.crumbs.length} crumbs`);
  const best = scent.smell(now, { x: 2, y: 0, z: 3 }, 'ground');
  assert.equal(best.kind, 'crumb');
  assert.equal(best.t, scent.crumbs.at(-1).t, 'picks the freshest crumb within 4 m');
  assert.equal(scent.smell(now, { x: 2, y: 0, z: 3 }, 'ground', { after: best.t }), null);
  assert.equal(scent.smell(now + 100, { x: 2, y: 0, z: 3 }, 'ground'), null, 'crumbs decay');

  // Stand still: after poolDelay a pool appears and its radius grows.
  for (let k = 0; k < 100; k++) {
    scent.update(now, 0.1, p, null);
    now += 0.1;
  }
  assert.equal(scent.pools.length, 1);
  const r = scent.poolRadius(scent.pools[0], now);
  assert.ok(r > N.poolRadius0 + 3, `pool radius ${r}`);
  const far = scent.smell(now, { x: 5 - r + 0.5, y: 0, z: 2 }, 'ground');
  assert.equal(far?.kind, 'pool');
});
