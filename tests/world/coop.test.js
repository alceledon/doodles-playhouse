// Co-op additions: silent/remote door and container changes, and the guest's wake spot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorld, FLOOR_Y, PLAYER_BODY } from '../../src/core/contracts.js';
import { checkReachability, nearestPassable, reachableSet, refKey, AGENTS } from '../../src/core/navgrid.js';
import { createBus, EVENTS } from '../../src/core/events.js';
import { circleHitsBox2D } from '../../src/core/math.js';
import { buildWorldData } from '../../src/world/build.js';

const WATCHED = [EVENTS.DOOR_OPENED, EVENTS.DOOR_CLOSED, EVENTS.CONTAINER_OPENED, EVENTS.CONTAINER_CLOSED, EVENTS.NOISE];

/** A world on a fresh bus, recording every door/container/noise event and every sync callback. */
function setup() {
  const bus = createBus();
  const seen = [];
  for (const t of WATCHED) bus.on(t, (p) => seen.push([t, p]));
  const synced = [];
  const w = buildWorldData({ bus, onDoorChange: (d) => synced.push(['door', d.id, d.isOpen]), onContainerChange: (c) => synced.push(['container', c.id, c.isOpen]) });
  return { w, seen, synced };
}

test('door: a silent open/close changes state, colliders and the animation, but emits nothing', () => {
  const { w, seen, synced } = setup();
  const d = w.doors.find((x) => x.id === 'hallMusic');
  assert.ok(w.colliders(d.floorId).includes(d.collider));
  assert.equal(d.setOpen(true, 'remote', { silent: true }), true);
  assert.equal(d.isOpen, true);
  assert.ok(!w.colliders(d.floorId).includes(d.collider), 'still collides after a silent open');
  assert.deepEqual(synced, [['door', 'hallMusic', true]]);
  assert.equal(d.setOpen(false, 'remote', { silent: true }), true);
  assert.equal(d.isOpen, false);
  assert.ok(w.colliders(d.floorId).includes(d.collider), 'no collider after a silent close');
  assert.deepEqual(synced, [['door', 'hallMusic', true], ['door', 'hallMusic', false]]);
  assert.deepEqual(seen, []);
});

test('door: silent keeps the no-op and the lock', () => {
  const { w, seen, synced } = setup();
  const d = w.doors.find((x) => x.id === 'frontDoor');
  assert.equal(d.locked, true);
  assert.equal(d.setOpen(true, 'remote', { silent: true }), false);
  assert.equal(d.isOpen, false);
  assert.equal(d.setOpen(false, 'remote', { silent: true }), true); // already closed
  assert.deepEqual(synced, []);
  assert.deepEqual(seen, []);
});

test("door: by: 'remote' reaches DOOR_OPENED/CLOSED, and a loud remote change still makes NOISE", () => {
  const { w, seen } = setup();
  const d = w.doors.find((x) => x.id === 'hallMusic');
  d.setOpen(true, 'remote');
  d.setOpen(false, 'remote');
  assert.deepEqual(seen.map(([t]) => t), [EVENTS.DOOR_OPENED, EVENTS.NOISE, EVENTS.DOOR_CLOSED, EVENTS.NOISE]);
  assert.deepEqual(seen[0][1], { doorId: 'hallMusic', by: 'remote' });
  assert.deepEqual(seen[2][1], { doorId: 'hallMusic', by: 'remote' });
});

test('container: a silent open/close changes state and the animation, but emits nothing', () => {
  const { w, seen, synced } = setup();
  const c = w.containers.find((x) => x.id === 'bedroomDresser');
  assert.equal(c.setOpen(true, 'remote', { silent: true }), true);
  assert.equal(c.isOpen, true);
  assert.equal(c.setOpen(true, 'remote', { silent: true }), true); // already open: nothing new
  assert.equal(c.setOpen(false, 'remote', { silent: true }), true);
  assert.equal(c.isOpen, false);
  assert.deepEqual(synced, [['container', 'bedroomDresser', true], ['container', 'bedroomDresser', false]]);
  const chest = w.containers.find((x) => x.locked);
  assert.equal(chest.setOpen(true, 'remote', { silent: true }), false);
  assert.equal(chest.isOpen, false);
  assert.deepEqual(seen, []);
});

test('container: by reaches CONTAINER_OPENED/CLOSED (player by default)', () => {
  const { w, seen } = setup();
  const c = w.containers.find((x) => x.id === 'bedroomDresser');
  c.setOpen(true);
  c.setOpen(false, 'remote');
  assert.deepEqual(seen.map(([t]) => t), [EVENTS.CONTAINER_OPENED, EVENTS.NOISE, EVENTS.CONTAINER_CLOSED, EVENTS.NOISE]);
  assert.deepEqual(seen[0][1], { containerId: 'bedroomDresser', by: 'player' });
  assert.deepEqual(seen[2][1], { containerId: 'bedroomDresser', by: 'remote' });
});

test('startBed2: the guest wakes on the upstairs floor in the Kids\' Bedroom, clear of furniture and the host', () => {
  const w = buildWorldData();
  assert.deepEqual(validateWorld(w), []);
  assert.deepEqual(checkReachability(w), []);
  const { startBed, startBed2: s } = w.anchors;
  assert.ok(s, 'anchors.startBed2 missing');
  assert.equal(s.floorId, 'upstairs');
  assert.equal(s.pos.y, FLOOR_Y.upstairs);
  assert.deepEqual(w.heightAt(s.pos.x, s.pos.z, s.floorId), { y: FLOOR_Y.upstairs, floorId: 'upstairs' });
  assert.equal(s.roomId, 'kidsBedroom');
  assert.equal(w.roomAt(s.pos, s.floorId).id, 'kidsBedroom');
  assert.equal(s.rotY, startBed.rotY);
  // Not inside any collider a standing body could touch (closed doors included).
  const { radius: r, height: h } = PLAYER_BODY;
  const hits = w.colliders(s.floorId).filter((b) => b.minY < s.pos.y + h && b.maxY > s.pos.y + 0.05 && circleHitsBox2D(s.pos.x, s.pos.z, r, b));
  assert.deepEqual(hits, []);
  // The two players don't wake inside each other.
  assert.ok(Math.hypot(s.pos.x - startBed.pos.x, s.pos.z - startBed.pos.z) >= 2 * r + 0.1);
  // Same nav region as startBed: the guest can walk wherever the host can.
  const a = nearestPassable(w.nav, s.floorId, s.pos.x, s.pos.z, AGENTS.PLAYER, 0.5);
  const b = nearestPassable(w.nav, startBed.floorId, startBed.pos.x, startBed.pos.z, AGENTS.PLAYER, 0.5);
  assert.ok(a && b, 'no passable cell near a wake spot');
  assert.ok(reachableSet(w.nav, b, AGENTS.PLAYER).has(refKey(a)), 'startBed2 is cut off from startBed');
});
