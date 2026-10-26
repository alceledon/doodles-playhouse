import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../../src/core/contracts.js';
import { EVENTS } from '../../src/core/events.js';
import { setup } from './helpers.js';

test('one hand: picking up a second item puts the first down where the second was', () => {
  const t = setup();
  const hammer = t.grab(ITEMS.HAMMER);
  const fuse = t.instOf(ITEMS.FUSE);
  const fuseSpot = { ...fuse.pos };
  t.player.pos = { ...fuse.pos };
  t.player.floorId = fuse.floorId;
  t.rules.interact({ kind: 'item', id: fuse.id }, t.player);

  assert.equal(t.rules.items.heldItemId(), ITEMS.FUSE);
  assert.equal(t.rules.items.list().filter((i) => i.where === 'held').length, 1);
  assert.equal(hammer.where, 'world');
  assert.deepEqual(hammer.pos, fuseSpot);
  assert.deepEqual(t.of(EVENTS.DROP).at(-1).itemId, ITEMS.HAMMER);
  assert.deepEqual(t.of(EVENTS.PICKUP).map((p) => p.itemId), [ITEMS.HAMMER, ITEMS.FUSE]);
  assert.deepEqual(t.of(EVENTS.HELD).at(-1), { itemId: ITEMS.FUSE, uses: null });
});

test('swapping into a drawer leaves the old item in the drawer', () => {
  // Find a seed where something spawned in a drawer (not the chest).
  let t;
  let inDrawer;
  for (let seed = 1; !inDrawer; seed++) {
    t = setup({ seed });
    inDrawer = t.rules.items.list().find((i) => i.containerId && i.containerId !== 'atticChest');
  }
  const drawerId = inDrawer.containerId;
  const first = t.grab(ITEMS.HAMMER);
  t.grab(inDrawer.itemId);
  assert.equal(first.where, 'world');
  assert.equal(first.containerId, drawerId);
  t.world.containers.find((c) => c.id === drawerId).setOpen(false);
  assert.equal(t.rules.canPickUp(first), false);
});

test('items in a closed container cannot be picked up until it opens', () => {
  const t = setup();
  const launcher = t.instOf(ITEMS.LAUNCHER);
  assert.equal(launcher.containerId, 'atticChest');
  assert.equal(t.rules.canPickUp(launcher), false);
  assert.equal(t.rules.describe({ kind: 'item', id: launcher.id }, t.player), null);
  assert.equal(t.rules.interact({ kind: 'item', id: launcher.id }, t.player), null);
  assert.equal(t.rules.items.heldItemId(), null);

  const drawer = t.world.containers.find((c) => c.id === 'kitchenDrawer');
  const item = t.rules.items.list().find((i) => i.containerId === 'kitchenDrawer');
  if (item) {
    assert.equal(t.rules.canPickUp(item), false);
    drawer.setOpen(true);
    assert.equal(t.rules.canPickUp(item), true);
  }
});

test('dropping makes a noise; being caught drops quietly', () => {
  const t = setup();
  t.grab(ITEMS.HAMMER);
  const before = t.of(EVENTS.NOISE).length;
  t.rules.drop({ x: 2, y: 0, z: 2 }, 'ground');
  const noise = t.of(EVENTS.NOISE).slice(before);
  assert.equal(noise.length, 1);
  assert.equal(noise[0].kind, 'drop');
  assert.ok(noise[0].loudness > 0);
  assert.equal(t.rules.items.heldItemId(), null);

  t.grab(ITEMS.HAMMER);
  const n2 = t.of(EVENTS.NOISE).length;
  t.rules.onCaught({ x: 1, y: 0, z: 1 }, 'ground');
  assert.equal(t.of(EVENTS.NOISE).length, n2);
  assert.equal(t.of(EVENTS.DROP).at(-1).itemId, ITEMS.HAMMER);
  assert.equal(t.rules.items.heldItemId(), null);
});

test('treats have 3 uses on normal, then the bag is gone', () => {
  const t = setup();
  t.grab(ITEMS.TREATS);
  assert.deepEqual(t.of(EVENTS.HELD).at(-1), { itemId: ITEMS.TREATS, uses: 3 });
  const ids = [];
  for (let k = 0; k < 3; k++) {
    assert.equal(t.rules.useHeld(null, t.player).action, 'treat');
    ids.push(t.rules.dropTreat({ x: 2, y: 0, z: 2 + k }, 'ground'));
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(t.of(EVENTS.TREAT_DROPPED).length, 3);
  assert.equal(t.rules.items.heldItemId(), null);
  assert.equal(t.rules.dropTreat({ x: 2, y: 0, z: 2 }, 'ground'), null);
  assert.equal(t.rules.items.list().find((i) => i.itemId === ITEMS.TREATS).where, 'gone');

  // Eaten treats are removed.
  assert.equal(t.rules.treats.size, 3);
  t.bus.emit(EVENTS.TREAT_EATEN, { treatId: ids[0] });
  assert.equal(t.rules.treats.size, 2);
});

test('treat uses follow the difficulty', () => {
  assert.equal(setup({ difficulty: 'easy' }).instOf(ITEMS.TREATS).uses, 4);
  assert.equal(setup({ difficulty: 'hard' }).instOf(ITEMS.TREATS).uses, 2);
});

test('the launcher holds 2 shots; a spare dart adds one', () => {
  const t = setup();
  t.world.containers.find((c) => c.id === 'atticChest').setLocked(false);
  t.grab(ITEMS.LAUNCHER);
  assert.deepEqual(t.of(EVENTS.HELD).at(-1), { itemId: ITEMS.LAUNCHER, uses: 2 });
  const fire = () => t.rules.fireDart({ x: 3, y: 1, z: 3 }, { x: 0, y: 0, z: -1 }, 10, 'ground');
  assert.equal(t.rules.useHeld(null, t.player).action, 'fire');
  assert.equal(fire(), true);
  assert.equal(fire(), true);
  assert.equal(fire(), false);
  assert.match(t.rules.useHeld(null, t.player).message, /Out of darts/);
  assert.equal(t.of(EVENTS.DART_FIRED).length, 2);
  assert.deepEqual(t.of(EVENTS.DART_FIRED)[0], { origin: { x: 3, y: 1, z: 3 }, dir: { x: 0, y: 0, z: -1 }, range: 10 });
  assert.equal(t.rules.items.heldItemId(), ITEMS.LAUNCHER); // an empty launcher stays in hand

  const dart = t.instOf(ITEMS.DART);
  assert.match(t.rules.describe({ kind: 'item', id: dart.id }, t.player), /load the Squeaky Dart/);
  t.rules.interact({ kind: 'item', id: dart.id }, t.player);
  assert.equal(dart.where, 'gone');
  assert.equal(t.rules.items.held().uses, 1);
  assert.equal(fire(), true);
});

test('holding a dart and picking up the launcher loads it', () => {
  const t = setup();
  t.world.containers.find((c) => c.id === 'atticChest').setLocked(false);
  t.grab(ITEMS.DART);
  t.grab(ITEMS.LAUNCHER);
  assert.equal(t.rules.items.held().uses, 3);
  assert.equal(t.rules.items.list().find((i) => i.itemId === ITEMS.DART).where, 'gone');
});

test('the tennis ball: thrown, landed, fetched and returned', () => {
  const t = setup();
  const ball = t.grab(ITEMS.TENNIS_BALL);
  assert.equal(t.rules.useHeld(null, t.player).action, 'throw');
  t.rules.throwBall({ x: 3, y: 1, z: 3 }, 'ground');
  assert.equal(ball.where, 'flying');
  assert.equal(t.rules.items.heldItemId(), null);
  assert.equal(t.of(EVENTS.BALL_THROWN).length, 1);

  t.rules.ballLanded(ball, { x: 4, y: 0.04, z: 5 }, 'ground');
  assert.equal(ball.where, 'world');
  assert.deepEqual(t.of(EVENTS.BALL_LANDED).at(-1), { pos: { x: 4, y: 0.04, z: 5 }, floorId: 'ground' });
  assert.ok(t.of(EVENTS.NOISE).some((n) => n.kind === 'ball'), 'landing is noisy');

  t.bus.emit(EVENTS.BALL_FETCHED, {});
  assert.equal(ball.where, 'doodle');
  assert.equal(t.rules.canPickUp(ball), false);
  const bed = t.world.anchors.kennelBed;
  t.bus.emit(EVENTS.BALL_RETURNED, { pos: bed.pos, floorId: bed.floorId });
  assert.equal(ball.where, 'world');
  assert.deepEqual(ball.pos, bed.pos);
});

test('a ball Doodle still has at the end of a day turns up on its bed', () => {
  const t = setup();
  const ball = t.grab(ITEMS.TENNIS_BALL);
  t.rules.throwBall({ x: 3, y: 1, z: 3 }, 'ground');
  t.rules.ballLanded(ball, { x: 4, y: 0.04, z: 5 }, 'ground');
  t.bus.emit(EVENTS.BALL_FETCHED, {});
  t.rules.startDay();
  assert.equal(ball.where, 'world');
  assert.deepEqual(ball.pos, t.world.anchors.kennelBed.pos);
});

test('items and locks persist across days', () => {
  const t = setup();
  const hammer = t.grab(ITEMS.HAMMER);
  t.rules.drop({ x: 2, y: 0, z: 2 }, 'ground');
  t.grab(ITEMS.PADLOCK_KEY);
  t.rules.interact({ kind: 'lock', id: 'padlock' }, t.player);
  t.rules.startDay();
  assert.deepEqual(hammer.pos, { x: 2, y: 0, z: 2 });
  assert.equal(t.rules.locks.isOpen('padlock'), true);
});
