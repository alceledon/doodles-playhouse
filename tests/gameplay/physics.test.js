// Player movement and tennis-ball physics against the fixture's colliders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_BODY } from '../../src/core/contracts.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { canStand, overlappingY, slideMove, targetSpeed, updateStamina, wishDir } from '../../src/player/movement.js';
import { createBall, stepBall, BALL_RADIUS } from '../../src/gameplay/ball.js';
import { firstBoxHit, isOccluded } from '../../src/gameplay/raycast.js';
import { createPathFollower } from '../../src/player/path.js';
import { tuningFor } from '../../src/gameplay/tuning.js';

const R = PLAYER_BODY.radius;
const walk = (world, from, dx, dz, crouched = false, steps = 60) => {
  const boxes = overlappingY(world.colliders('ground'), 0, crouched ? PLAYER_BODY.crouchHeight : PLAYER_BODY.height);
  let p = { ...from };
  for (let k = 0; k < steps; k++) p = slideMove(p, dx / steps, dz / steps, R, boxes);
  return p;
};

test('walls stop the player, even at speed', () => {
  const world = createMiniHouse();
  // Hall → kitchen wall at x=6 (z 0..3.5): walk hard east from (5, 2).
  const p = walk(world, { x: 5, z: 2 }, 3, 0);
  assert.ok(p.x <= 6 - 0.1 - R + 1e-6, `x=${p.x}`);
  // One big step can't tunnel through either.
  const q = slideMove({ x: 5, z: 2 }, 2, 0, R, overlappingY(world.colliders('ground'), 0, PLAYER_BODY.height));
  assert.ok(q.x < 6, `x=${q.x}`);
});

test('walls slide you along instead of stopping you dead', () => {
  const world = createMiniHouse();
  const p = walk(world, { x: 5, z: 1.5 }, 2, 1);
  assert.ok(p.z > 2.3, `slid to z=${p.z}`);
});

test('closed doors block; open doors let you through', () => {
  const world = createMiniHouse();
  const door = world.doors.find((d) => d.id === 'hallKitchen');
  assert.ok(walk(world, { x: 5, z: 4 }, 2, 0).x < 6);
  door.setOpen(true);
  assert.ok(walk(world, { x: 5, z: 4 }, 2, 0).x > 6.5);
});

test('the crawl tunnel lets you through crouched, not standing, and you cannot stand inside', () => {
  const world = createMiniHouse();
  // Play tunnel: ceiling box x 3..4.5, z 3.9..5.1, minY 0.8. Enter from the west at z 4.5.
  const standing = walk(world, { x: 2, z: 4.5 }, 2, 0, false);
  assert.ok(standing.x < 3, `standing stopped at x=${standing.x}`);
  const crouched = walk(world, { x: 2, z: 4.5 }, 2, 0, true);
  assert.ok(crouched.x > 3.5, `crouched got to x=${crouched.x}`);
  assert.equal(canStand({ x: 3.7, z: 4.5 }, 0, world.colliders('ground')), false);
  assert.equal(canStand({ x: 2, z: 4.5 }, 0, world.colliders('ground')), true);
});

test('the wall under a landing does not stop you at the top of a stair ramp', () => {
  // A 3:4 ramp rising toward +Z ends at z=5.5, flush with the lower floor's
  // wall under the landing (top at y=3). Touching that wall, feet are 0.19 m
  // below the landing, so the wall's top edge must count as a step.
  const wall = { minX: 8, maxX: 9.5, minY: 0, maxY: 3, minZ: 5.5, maxZ: 5.6 };
  const feetY = 3 - R * 0.75;
  const boxes = overlappingY([wall], feetY, PLAYER_BODY.height);
  assert.equal(boxes.length, 0);
  const p = slideMove({ x: 8.75, z: 5.5 - R }, 0, 0.3, R, boxes);
  assert.ok(p.z > 5.5, `moved onto the landing (z=${p.z})`);
  // On the floor below, the same wall still blocks.
  assert.equal(overlappingY([wall], 0, PLAYER_BODY.height).length, 1);
  // A crate 0.25 m tall is not a step.
  assert.equal(overlappingY([{ minX: 0, maxX: 1, minY: 0, maxY: 0.25, minZ: 0, maxZ: 1 }], 0, PLAYER_BODY.height).length, 1);
});

test('speeds: walk 3, sprint 5, crouch 1.5, battery caps at 2.2', () => {
  const m = tuningFor('normal').move;
  assert.equal(targetSpeed({}, m), 3);
  assert.equal(targetSpeed({ sprinting: true }, m), 5);
  assert.equal(targetSpeed({ crouched: true }, m), 1.5);
  assert.equal(targetSpeed({ sprinting: true, carryingBattery: true }, m), 2.2);
  assert.equal(targetSpeed({ crouched: true, carryingBattery: true }, m), 1.5);
});

test('wishDir follows the yaw convention (0 faces -Z, positive turns left)', () => {
  const close = (a, b) => assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9, JSON.stringify(a));
  close(wishDir(0, 1, 0), { x: 0, z: -1 });
  close(wishDir(0, 0, 1), { x: 1, z: 0 });
  close(wishDir(Math.PI / 2, 1, 0), { x: -1, z: 0 });
  assert.equal(wishDir(0, 0, 0), null);
});

test('stamina drains while sprinting, and running dry locks sprint out for a while', () => {
  const t = tuningFor('normal').stamina;
  const s = { stamina: 1, exhausted: false, rest: 0 };
  for (let k = 0; k < 50; k++) updateStamina(s, true, 0.1, t);
  assert.equal(s.stamina, 0);
  assert.equal(s.exhausted, true);
  for (let k = 0; k < 10; k++) updateStamina(s, false, 0.1, t);
  assert.ok(s.stamina > 0 && s.exhausted);
  for (let k = 0; k < 40; k++) updateStamina(s, false, 0.1, t);
  assert.equal(s.exhausted, false);
});

test('a thrown ball bounces around the hall and comes to rest inside it', () => {
  const world = createMiniHouse();
  const floorY = Object.fromEntries(world.floors.map((f) => [f.id, f.y]));
  const env = {
    boxes: (floorId) => world.colliders(floorId),
    heightAt: world.heightAt,
    floorY: (id) => floorY[id],
  };
  const tuning = tuningFor('normal').ball;
  // Thrown hard at the hall/kitchen wall.
  const ball = createBall({ x: 4.5, y: 1.1, z: 2 }, { x: 9, y: 2, z: 0.5 }, 'ground');
  let impacts = 0;
  for (let k = 0; k < 600 && !ball.resting; k++) impacts += stepBall(ball, 1 / 60, env, tuning).length;
  assert.equal(ball.resting, true);
  assert.ok(impacts >= 2, `impacts ${impacts}`);
  assert.ok(ball.pos.x < 6 && ball.pos.x > 0 && ball.pos.z > 0 && ball.pos.z < 8, JSON.stringify(ball.pos));
  assert.ok(Math.abs(ball.pos.y - BALL_RADIUS) < 1e-6, `y=${ball.pos.y}`);
});

test('a ball rolls down the stairs ramp', () => {
  const world = createMiniHouse();
  const env = { boxes: (f) => world.colliders(f), heightAt: world.heightAt, floorY: (id) => (id === 'upstairs' ? 3 : 0) };
  const ball = createBall({ x: 4.6, y: 3.1, z: 7.45 }, { x: -3, y: 0, z: 0 }, 'upstairs');
  for (let k = 0; k < 900 && !ball.resting; k++) stepBall(ball, 1 / 60, env, tuningFor('normal').ball);
  assert.equal(ball.floorId, 'ground');
  assert.ok(ball.pos.y < 1.6, JSON.stringify(ball.pos));
});

test('look rays are blocked by walls but not by what they hit', () => {
  const world = createMiniHouse();
  const boxes = world.colliders('ground');
  const eye = { x: 5, y: 1.1, z: 2 };
  const east = { x: 1, y: 0, z: 0 };
  const wall = firstBoxHit(eye, east, boxes, 5);
  assert.ok(Math.abs(wall.t - 0.9) < 1e-6);
  // Something 2 m east is behind the wall...
  assert.equal(isOccluded(eye, east, 2, { x: 7, y: 1.1, z: 2 }, boxes), true);
  // ...but a point on the wall's own face isn't, and neither is an item tucked into furniture.
  assert.equal(isOccluded(eye, east, 0.9, { x: 5.9, y: 1.1, z: 2 }, boxes), false);
  const counterItem = { x: 8, y: 0.6, z: 7.6 };
  const from = { x: 8, y: 1.1, z: 6.5 };
  const d = Math.hypot(0, counterItem.y - from.y, counterItem.z - from.z);
  const dir = { x: 0, y: (counterItem.y - from.y) / d, z: (counterItem.z - from.z) / d };
  assert.equal(isOccluded(from, dir, d, counterItem, world.colliders('ground')), false);
});

test('path follower walks a link polyline end to end, both ways', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 2 }];
  const f = createPathFollower(pts);
  assert.equal(f.total, 3);
  assert.deepEqual(f.advance(1.5).pos, { x: 1, y: 0, z: 0.5 });
  const end = f.advance(10);
  assert.equal(end.done, true);
  assert.deepEqual(end.pos, { x: 1, y: 0, z: 2 });
  const back = createPathFollower(pts, true);
  assert.deepEqual(back.advance(10).pos, { x: 0, y: 0, z: 0 });
});
