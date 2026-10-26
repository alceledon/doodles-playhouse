import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { NAV, flagsAt, worldToCell, refKey } from '../../src/core/navgrid.js';
import { findPath, lockedCells, planRoute, lineWalkable } from '../../src/doodle/path.js';
import { createMover } from '../../src/doodle/mover.js';
import { setup, place, EVENTS } from './helpers.js';

const cell = (world, floorId, x, z) => worldToCell(world.nav, floorId, x, z);

test('A* crosses the stairs from the kennel to the start bed', () => {
  const world = createMiniHouse();
  const blocked = lockedCells(world.doors);
  const { steps, complete } = findPath(world.nav, cell(world, 'ground', 6.9, 6.4), cell(world, 'upstairs', 5.3, 3.7), { blocked });
  assert.ok(complete);
  const links = steps.filter((s) => s.link).map((s) => s.link.id);
  assert.deepEqual(links, ['stairs']);
  assert.equal(steps[0].ref.floorId, 'ground');
  assert.equal(steps.at(-1).ref.floorId, 'upstairs');
});

test('the route follows the stair link points and the mover changes floor halfway up', () => {
  const world = createMiniHouse();
  const kennel = world.anchors.kennel;
  const bed = world.anchors.startBed;
  const plan = planRoute(world, kennel.pos, kennel.floorId, bed.pos, bed.floorId);
  assert.ok(plan.complete);
  const stairs = world.nav.links.find((l) => l.id === 'stairs');
  const onLink = plan.route.filter((w) => w.link);
  assert.deepEqual(
    onLink.map((w) => [w.x, w.y, w.z]),
    stairs.points.slice(1).map((p) => [p.x, p.y, p.z]),
  );
  // Ends exactly on the bed spot.
  const end = plan.route.at(-1);
  assert.ok(Math.hypot(end.x - bed.pos.x, end.z - bed.pos.z) < 1e-9);

  const mover = createMover(world);
  mover.setRoute(plan.route);
  const body = { pos: { ...kennel.pos }, floorId: kennel.floorId, yaw: 0, pitch: 0 };
  let switchedAt = null;
  for (let k = 0; k < 600 && !mover.done; k++) {
    mover.step(body, 1 / 30, 2.5, 7);
    if (switchedAt === null && body.floorId === 'upstairs') switchedAt = body.pos.y;
  }
  assert.ok(mover.done);
  assert.equal(body.floorId, 'upstairs');
  assert.ok(Math.abs(switchedAt - 1.5) < 0.2, `switched floor at y=${switchedAt}`);
});

test('smoothed routes are short: a straight hall walk is one segment', () => {
  const world = createMiniHouse();
  const plan = planRoute(world, { x: 1, y: 0, z: 2 }, 'ground', { x: 5, y: 0, z: 2 }, 'ground');
  assert.equal(plan.route.length, 1);
  assert.ok(lineWalkable(world.nav, 'ground', { x: 1, z: 2 }, { x: 5, z: 2 }));
  assert.ok(!lineWalkable(world.nav, 'ground', { x: 4, z: 2 }, { x: 8, z: 2 })); // through the hall/kitchen wall
});

test('never uses the crawl tunnel or the slide', () => {
  const world = createMiniHouse();
  const blocked = lockedCells(world.doors);
  // Tunnel ends: hall (5.25, 1.25) and kitchen (6.75, 1.25), either side of the wall.
  const a = findPath(world.nav, cell(world, 'ground', 5.25, 1.25), cell(world, 'ground', 6.75, 1.25), { blocked });
  assert.ok(a.complete);
  assert.ok(!a.steps.some((s) => s.link), 'no link between hall and kitchen');
  assert.ok(!a.steps.some((s) => flagsAt(world.nav, s.ref) & NAV.PLAYER_ONLY), 'no PLAYER_ONLY cells');
  const door = world.doors.find((d) => d.id === 'hallKitchen');
  const doorKeys = new Set(door.cells.map(refKey));
  assert.ok(a.steps.some((s) => doorKeys.has(refKey(s.ref))), 'goes through the hallKitchen doorway');

  // Slide top (bedroom) to the ball pit: must take the stairs.
  const b = findPath(world.nav, cell(world, 'upstairs', 6.25, 1.25), cell(world, 'ground', 8.25, 2.25), { blocked });
  assert.ok(b.complete);
  assert.deepEqual(b.steps.filter((s) => s.link).map((s) => s.link.id), ['stairs']);

  // Inside the play tunnel is unreachable: A* returns a partial path that stops outside.
  const c = findPath(world.nav, cell(world, 'ground', 1, 1), cell(world, 'ground', 3.75, 4.5), { blocked });
  assert.ok(!c.complete);
  assert.ok(!c.steps.some((s) => flagsAt(world.nav, s.ref) & NAV.PLAYER_ONLY));
});

test('locked doors are solid until unlocked', () => {
  const world = createMiniHouse();
  const garage = world.doors.find((d) => d.id === 'garage');
  const inside = cell(world, 'ground', 11.75, 6);
  let r = findPath(world.nav, cell(world, 'ground', 10, 4), inside, { blocked: lockedCells(world.doors) });
  assert.ok(!r.complete);
  garage.setLocked(false);
  r = findPath(world.nav, cell(world, 'ground', 10, 4), inside, { blocked: lockedCells(world.doors) });
  assert.ok(r.complete);
});

test('walking through the hallKitchen door opens it (and Doodle ignores its own creak)', () => {
  const sim = setup();
  const door = sim.door('hallKitchen');
  assert.equal(door.isOpen, false);
  // A noise in the hall sends Doodle from the kennel (kitchen) through the door.
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 2, y: 0, z: 4 }, floorId: 'ground', loudness: 15, kind: 'other' });
  assert.equal(sim.doodle.state, 'investigate');
  const reachedHall = sim.run(10, null, () => sim.doodle.pos.x < 3);
  assert.ok(reachedHall, 'got into the hall');
  assert.equal(door.isOpen, true);
  const opened = sim.of(EVENTS.DOOR_OPENED);
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].payload, { doorId: 'hallKitchen', by: 'doodle' });
  // Its own door noise didn't redirect it: still headed for the hall noise.
  assert.equal(sim.doodle.state, 'investigate');
  assert.ok(sim.doodle.debug.target.x < 3);
});

test('never opens a locked door', () => {
  const sim = setup();
  place(sim, 3, 1);
  // A noise just outside the locked front door: Doodle walks up to it but can't open it.
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 3, y: 0, z: 0.2 }, floorId: 'ground', loudness: 10, kind: 'other' });
  sim.run(6);
  assert.equal(sim.door('front').isOpen, false);
  assert.equal(sim.count(EVENTS.DOOR_OPENED), 0);
});
