import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, SPAWNED_ITEMS, DIFFICULTIES } from '../../src/core/contracts.js';
import { createRng } from '../../src/core/rng.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { pickSpawns } from '../../src/gameplay/items.js';
import { tuningFor } from '../../src/gameplay/tuning.js';

const layout = (picks) => picks.map((p) => `${p.itemId}@${p.spot.id}`).join(',');

test('spawns are deterministic per seed', () => {
  const world = createMiniHouse();
  for (const seed of [1, 2, 99, 'abc']) {
    assert.equal(layout(pickSpawns(world, createRng(seed), { spareDarts: 1 })), layout(pickSpawns(world, createRng(seed), { spareDarts: 1 })));
  }
});

test('different seeds give different layouts', () => {
  const world = createMiniHouse();
  const seen = new Set();
  for (let seed = 0; seed < 30; seed++) seen.add(layout(pickSpawns(world, createRng(seed), { spareDarts: 1 })));
  assert.ok(seen.size > 5, `only ${seen.size} distinct layouts`);
});

test('every item spawns once, on one of its own candidate spots', () => {
  const world = createMiniHouse();
  for (let seed = 0; seed < 40; seed++) {
    const picks = pickSpawns(world, createRng(seed), { spareDarts: 1 });
    for (const itemId of SPAWNED_ITEMS) {
      const mine = picks.filter((p) => p.itemId === itemId);
      assert.equal(mine.length, 1, `${itemId} seed ${seed}`);
      assert.ok(world.anchors.spawns[itemId].includes(mine[0].spot), `${itemId} spot is a candidate`);
    }
  }
});

test('the launcher is always in the attic chest, and nothing else is', () => {
  const world = createMiniHouse();
  const chest = world.containers.find((c) => c.id === world.anchors.atticChest.containerId);
  for (let seed = 0; seed < 40; seed++) {
    const picks = pickSpawns(world, createRng(seed), { spareDarts: 1 });
    const launcher = picks.filter((p) => p.itemId === ITEMS.LAUNCHER);
    assert.equal(launcher.length, 1);
    assert.equal(launcher[0].spot, chest.itemSpot);
    assert.equal(picks.filter((p) => p.spot.containerId === chest.id).length, 1);
  }
});

test('no two items share a spot or a container', () => {
  const world = createMiniHouse();
  for (let seed = 0; seed < 40; seed++) {
    const picks = pickSpawns(world, createRng(seed), { spareDarts: 2 });
    const ids = picks.map((p) => p.spot.id);
    assert.equal(new Set(ids).size, ids.length);
    const containers = picks.map((p) => p.spot.containerId).filter(Boolean);
    assert.equal(new Set(containers).size, containers.length);
  }
});

test('spare darts follow the difficulty, limited by free spots', () => {
  const world = createMiniHouse();
  const darts = (d) => pickSpawns(world, createRng(5), tuningFor(d).items).filter((p) => p.itemId === ITEMS.DART).length;
  assert.equal(darts('normal'), 1);
  assert.equal(darts('easy'), 2);
  assert.equal(darts('hard'), 0);
  for (const d of DIFFICULTIES) assert.ok(darts(d) <= world.anchors.spawns.dart.length);
});

test('a required item still spawns if World gave too few spots', () => {
  const world = createMiniHouse();
  const shared = world.anchors.spawns.hammer[0];
  world.anchors.spawns.fuse = [shared];
  world.anchors.spawns.hammer = [shared];
  const picks = pickSpawns(world, createRng(1), { spareDarts: 1 });
  assert.equal(picks.filter((p) => p.itemId === ITEMS.FUSE).length, 1);
  assert.equal(picks.filter((p) => p.itemId === ITEMS.HAMMER).length, 1);
});
