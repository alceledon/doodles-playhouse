import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDirection, easeInOut, easeOutBack, forward, freeDistance, lidOpenness, pathPoint, staminaView, vignetteLevel } from '../../src/ui/motion.js';
import { UI_TUNING } from '../../src/ui/tuning.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('easing curves start at 0 and end at 1', () => {
  for (const f of [easeInOut, easeOutBack]) {
    assert.ok(close(f(0), 0));
    assert.ok(close(f(1), 1));
  }
  assert.ok(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => easeOutBack(t))) > 1, 'the pounce overshoots');
});

test('forward() matches the contract axes: yaw 0 faces -Z, positive yaw turns left', () => {
  const f0 = forward(0);
  assert.ok(close(f0.x, 0) && close(f0.z, -1));
  const left = forward(Math.PI / 2);
  assert.ok(close(left.x, -1) && close(left.z, 0));
});

test('pathPoint walks a polyline by distance', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 3 }];
  assert.deepEqual(pathPoint(pts, 0), { x: 0, y: 0, z: 0 });
  assert.deepEqual(pathPoint(pts, 1), { x: 1, y: 0, z: 3 });
  const q = pathPoint(pts, 0.25); // 1 m along a 4 m path: the first corner
  assert.ok(close(q.x, 1) && close(q.z, 0));
  const h = pathPoint(pts, 0.625); // 2.5 m along
  assert.ok(close(h.x, 1) && close(h.z, 1.5));
  assert.deepEqual(pathPoint(pts, 7), { x: 1, y: 0, z: 3 }, 'clamped');
  assert.deepEqual(pathPoint([{ x: 2, y: 2, z: 2 }], 0.5), { x: 2, y: 2, z: 2 });
});

test('freeDistance stops before walls and honours the Y-overlap rule', () => {
  const wall = { minX: 2, maxX: 2.2, minY: 0, maxY: 3, minZ: -5, maxZ: 5 };
  const rug = { minX: 0.5, maxX: 1.5, minY: 0, maxY: 0.03, minZ: -1, maxZ: 1 };
  const world = { colliders: () => [wall, rug] };
  const d = freeDistance(world, 'ground', { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 5, { radius: 0.25, yMin: 0.05, yMax: 1 });
  assert.ok(d < 2 - 0.25 + 1e-6 && d > 1.5, `stops short of the wall (got ${d})`);
  assert.equal(freeDistance(world, 'ground', { x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 3), 3, 'nothing behind');
  assert.equal(freeDistance(null, 'ground', { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 2), 2, 'no world, no walls');
});

test('clearDirection prefers the asked yaw and turns away from walls', () => {
  const wallAhead = { minX: -5, maxX: 5, minY: 0, maxY: 3, minZ: -1.2, maxZ: -1 }; // just in front (-Z)
  const world = { colliders: () => [wallAhead] };
  const free = clearDirection({ colliders: () => [] }, 'ground', { x: 0, y: 0, z: 0 }, 0.3, 2);
  assert.ok(close(free.yaw, 0.3) && free.free >= 2);
  const turned = clearDirection(world, 'ground', { x: 0, y: 0, z: 0 }, 0, 2, { yMin: 0.1, yMax: 1 });
  assert.ok(turned.free >= 2, 'found a clear way');
  assert.ok(Math.abs(Math.sin(turned.yaw)) > 0.5 || Math.cos(turned.yaw) < 0, 'not straight into the wall');
});

test('clearDirection works on the mini-house fixture', () => {
  const world = createMiniHouse();
  const k = world.anchors.kennel;
  const dir = clearDirection(world, k.floorId, k.pos, 0, 1.5, { yMin: 0.1, yMax: 0.8 });
  assert.ok(dir.free > 0.5);
});

test('the wake blink starts shut, ends open and stays in [0, 1]', () => {
  assert.equal(lidOpenness(0), 0);
  assert.equal(lidOpenness(1), 1);
  for (let t = 0; t <= 1; t += 0.01) {
    const o = lidOpenness(t);
    assert.ok(o >= 0 && o <= 1, `t=${t}`);
  }
  assert.ok(lidOpenness(0.56) < lidOpenness(0.4), 'there is a blink in the middle');
});

test('vignette: none on another floor or far away, strong up close, held in a chase', () => {
  const player = { pos: { x: 0, y: 0, z: 0 }, floorId: 'ground' };
  const at = (x, floorId = 'ground', state = 'patrol') => ({ pos: { x, y: 0, z: 0 }, floorId, state });
  assert.equal(vignetteLevel(player, null), 0);
  assert.equal(vignetteLevel(null, at(1)), 0);
  assert.equal(vignetteLevel(player, at(1, 'upstairs')), 0);
  assert.equal(vignetteLevel(player, at(50)), 0);
  assert.ok(close(vignetteLevel(player, at(1)), UI_TUNING.hud.vignetteMax));
  assert.ok(vignetteLevel(player, at(5)) > vignetteLevel(player, at(8)));
  assert.ok(vignetteLevel(player, at(50, 'ground', 'chase')) >= UI_TUNING.hud.vignetteChase);
});

test('stamina bar: hidden when full, red when low', () => {
  assert.equal(staminaView(1).visible, false);
  assert.equal(staminaView(0.5).visible, true);
  assert.equal(staminaView(0.5).low, false);
  assert.equal(staminaView(0.1).low, true);
  assert.equal(staminaView(-1).fraction, 0);
  assert.equal(staminaView(undefined).visible, false);
});
