import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAV, AGENTS, rasterizeFloor, neighbors, reachableSet, nearestPassable, worldToCell, cellCenter, refKey, flagsAt,
} from '../../src/core/navgrid.js';

const box = (minX, maxX, minY, maxY, minZ, maxZ) => ({ minX, maxX, minY, maxY, minZ, maxZ });

// 4 m x 2 m room split by a wall at x=2 with a 1 m gap at z 0.5..1.5 marked as a doorway.
function twoCells() {
  const floor = rasterizeFloor({
    floorId: 'ground', y: 0, minX: 0, maxX: 4, minZ: 0, maxZ: 2,
    blockers: [box(1.9, 2.1, 0, 3, 0, 0.5), box(1.9, 2.1, 0, 3, 1.5, 2)],
    marks: [{ box: box(1.5, 2.5, 0, 0, 0.5, 1.5), flags: NAV.DOOR | NAV.WALK }],
  });
  return { cellSize: 0.5, floors: { ground: floor }, links: [] };
}

test('rasterizeFloor sizes the grid and blocks wall cells', () => {
  const nav = twoCells();
  const g = nav.floors.ground;
  assert.equal(g.w, 8);
  assert.equal(g.h, 4);
  // A cell beside the wall segment is solid; the doorway cells carry DOOR.
  assert.equal(flagsAt(nav, worldToCell(nav, 'ground', 1.75, 0.25)), 0);
  assert.ok(flagsAt(nav, worldToCell(nav, 'ground', 1.75, 0.75)) & NAV.DOOR);
});

test('low things (rugs) and high things (crawl ceilings) do not block', () => {
  const g = rasterizeFloor({
    floorId: 'ground', y: 0, minX: 0, maxX: 2, minZ: 0, maxZ: 2,
    blockers: [box(0, 2, 0, 0.02, 0, 2), box(0, 2, 0.8, 1.2, 0, 2)],
  });
  assert.ok(g.cells.every((f) => f === NAV.WALK));
});

test('the doorway connects both halves; corners are not cut', () => {
  const nav = twoCells();
  const start = worldToCell(nav, 'ground', 0.25, 0.25);
  const seen = reachableSet(nav, start, AGENTS.PLAYER);
  assert.ok(seen.has(refKey(worldToCell(nav, 'ground', 3.75, 1.75))));
  for (const n of neighbors(nav, start, AGENTS.PLAYER)) {
    const c = cellCenter(nav, n.ref);
    assert.ok(Math.hypot(c.x - 0.25, c.z - 0.25) < 0.75);
  }
});

test('PLAYER_ONLY cells and playerOnly links are closed to the Doodle', () => {
  const nav = twoCells();
  const g = nav.floors.ground;
  // Seal the doorway for the Doodle by marking it player-only.
  for (let k = 0; k < g.cells.length; k++) if (g.cells[k] & NAV.DOOR) g.cells[k] |= NAV.PLAYER_ONLY;
  const start = worldToCell(nav, 'ground', 0.25, 0.25);
  const far = refKey(worldToCell(nav, 'ground', 3.75, 1.75));
  assert.ok(reachableSet(nav, start, AGENTS.PLAYER).has(far));
  assert.ok(!reachableSet(nav, start, AGENTS.DOODLE).has(far));
});

test('links join floors; oneWay links only go forward', () => {
  const a = rasterizeFloor({ floorId: 'ground', y: 0, minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
  const b = rasterizeFloor({ floorId: 'upstairs', y: 3, minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
  const nav = {
    cellSize: 0.5,
    floors: { ground: a, upstairs: b },
    links: [{
      id: 'slide', kind: 'slide', from: { floorId: 'upstairs', i: 0, j: 0 }, to: { floorId: 'ground', i: 0, j: 0 },
      oneWay: true, playerOnly: true, crawl: false, points: [{ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 4 }],
    }],
  };
  const top = { floorId: 'upstairs', i: 0, j: 0 };
  const bottom = { floorId: 'ground', i: 0, j: 0 };
  assert.ok(reachableSet(nav, top, AGENTS.PLAYER).has(refKey(bottom)));
  assert.ok(!reachableSet(nav, bottom, AGENTS.PLAYER).has(refKey(top)));
  assert.ok(!reachableSet(nav, top, AGENTS.DOODLE).has(refKey(bottom)));
  const viaLink = neighbors(nav, top, AGENTS.PLAYER).find((n) => n.link);
  assert.equal(viaLink.cost, 5);
});

test('nearestPassable snaps a wall-mounted spot to a standable cell', () => {
  const nav = twoCells();
  const ref = nearestPassable(nav, 'ground', 2.0, 0.1, AGENTS.PLAYER, 1.5);
  assert.ok(ref);
  assert.ok(flagsAt(nav, ref) & (NAV.WALK | NAV.DOOR));
  assert.equal(nearestPassable(nav, 'ground', 2.0, 0.1, AGENTS.PLAYER, 0.1), null);
});
