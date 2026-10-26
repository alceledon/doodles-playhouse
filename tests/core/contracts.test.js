// The fixture and the real World must satisfy the same contract and
// reachability rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorld, SPAWNED_ITEMS, FLOOR_IDS, DIFFICULTIES } from '../../src/core/contracts.js';
import { checkReachability, AGENTS, nearestPassable, reachableSet, refKey, NAV, flagsAt, parseKey } from '../../src/core/navgrid.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { buildWorldData } from '../../src/world/build.js';
import { createBus, EVENTS } from '../../src/core/events.js';

const WORLDS = {
  'mini-house fixture': () => createMiniHouse(),
  ...Object.fromEntries(DIFFICULTIES.map((d) => [`real world (${d})`, () => buildWorldData({ difficulty: d })])),
};

for (const [name, make] of Object.entries(WORLDS)) {
  test(`${name}: matches the World contract`, () => {
    assert.deepEqual(validateWorld(make()), []);
  });

  test(`${name}: passes the reachability rules`, () => {
    assert.deepEqual(checkReachability(make()), []);
  });

  test(`${name}: has a spawn candidate for every spawned item`, () => {
    const w = make();
    for (const item of SPAWNED_ITEMS) assert.ok(w.anchors.spawns[item]?.length > 0, item);
  });
}

test('validateWorld catches a broken world', () => {
  const w = createMiniHouse();
  w.anchors.drawings.pop();
  w.doors[0].cells = [{ floorId: 'ground', i: 999, j: 0 }];
  delete w.anchors.spawns.hammer;
  w.floors.push({ id: 'roof', y: 9 });
  const errors = validateWorld(w).join('\n');
  assert.match(errors, /drawings must have exactly 4/);
  assert.match(errors, /door "hallKitchen".cells/);
  assert.match(errors, /spawns.hammer/);
  assert.match(errors, /unknown floor id "roof"/);
});

test('fixture: floors use contract floor ids', () => {
  for (const f of createMiniHouse().floors) assert.ok(FLOOR_IDS.includes(f.id));
});

test('fixture: the play tunnel is player-only, so the Doodle must walk around through the door', () => {
  const w = createMiniHouse();
  const g = w.nav.floors.ground;
  const playerOnly = [];
  for (let k = 0; k < g.cells.length; k++) if (g.cells[k] & NAV.PLAYER_ONLY) playerOnly.push(k);
  assert.ok(playerOnly.length > 0);
  const kennel = nearestPassable(w.nav, 'ground', w.anchors.kennel.pos.x, w.anchors.kennel.pos.z, AGENTS.DOODLE);
  const seen = reachableSet(w.nav, kennel, AGENTS.DOODLE);
  for (const key of seen) assert.ok(!(flagsAt(w.nav, parseKey(key)) & NAV.PLAYER_ONLY), key);
});

test('fixture: stairs ramp height goes 0 → 3 and switches floor halfway', () => {
  const w = createMiniHouse();
  assert.deepEqual(w.heightAt(1, 7.5, 'ground'), { y: 0, floorId: 'ground' });
  assert.deepEqual(w.heightAt(5, 7.5, 'ground'), { y: 3, floorId: 'upstairs' });
  assert.equal(w.heightAt(3.2, 7.5, 'ground').floorId, 'upstairs');
  assert.deepEqual(w.heightAt(3, 3, 'upstairs'), { y: 3, floorId: 'upstairs' });
});

test('fixture: closed doors collide, open doors do not; locked doors refuse to open', () => {
  const bus = createBus();
  const heard = [];
  bus.on(EVENTS.NOISE, (n) => heard.push(n.kind));
  const w = createMiniHouse({ bus });
  const door = w.doors.find((d) => d.id === 'hallKitchen');
  assert.ok(w.colliders('ground').includes(door.collider));
  assert.equal(door.setOpen(true, 'doodle'), true);
  assert.ok(!w.colliders('ground').includes(door.collider));
  assert.deepEqual(heard, ['door']);
  const front = w.doors.find((d) => d.id === 'front');
  assert.equal(front.setOpen(true), false);
  front.setLocked(false);
  assert.equal(front.setOpen(true), true);
});

test('fixture: the attic chest starts locked and keeps its item spot inside', () => {
  const w = createMiniHouse();
  const chest = w.containers.find((c) => c.id === w.anchors.atticChest.containerId);
  assert.equal(chest.locked, true);
  assert.equal(chest.setOpen(true), false);
  assert.equal(chest.itemSpot.containerId, chest.id);
});

test('fixture: light is brighter under a lamp than in a far corner', () => {
  const w = createMiniHouse();
  const under = w.lightLevelAt({ x: 3, y: 1, z: 4 }, 'ground');
  const corner = w.lightLevelAt({ x: 11.5, y: 1, z: 7.5 }, 'ground');
  assert.ok(under > corner, `${under} vs ${corner}`);
  assert.ok(corner >= 0 && under <= 1);
});

test('fixture: the stairs link is usable by both; the slide is one-way and player-only', () => {
  const w = createMiniHouse();
  const stairs = w.nav.links.find((l) => l.kind === 'stairs');
  const slide = w.nav.links.find((l) => l.kind === 'slide');
  const doodleSeen = reachableSet(w.nav, stairs.from, AGENTS.DOODLE);
  assert.ok(doodleSeen.has(refKey(stairs.to)));
  assert.ok(slide.oneWay && slide.playerOnly);
});
