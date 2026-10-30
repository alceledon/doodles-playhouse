// Co-op: a host and a guest built from the same seed, each with its own bus and
// world, as two browsers would be. Intents go host-ward, snapshots guest-ward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../../src/core/contracts.js';
import { createBus, EVENTS } from '../../src/core/events.js';
import { createRng } from '../../src/core/rng.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { createRules, wakeSpot } from '../../src/gameplay/rules.js';
import { createRemotePlayer } from '../../src/player/remote.js';
import { tuningFor } from '../../src/gameplay/tuning.js';

function side(role, seed) {
  const bus = createBus();
  const events = [];
  for (const type of Object.values(EVENTS)) bus.on(type, (payload) => events.push({ type, payload }));
  const world = createMiniHouse({ bus });
  const rules = createRules({ world, bus, rng: createRng(seed), difficulty: 'normal', coop: { role, rule: 'shared' } });
  const of = (type) => events.filter((e) => e.type === type).map((e) => e.payload);
  return { bus, events, world, rules, of };
}

function pair(seed = 3) {
  const host = side('host', seed);
  const guest = side('guest', seed);
  const bed = host.world.anchors.startBed;
  const hostBody = { id: 'host', pos: { ...bed.pos }, floorId: bed.floorId, crouched: false, hidden: false };
  const guestBody = { id: 'guest', pos: { ...bed.pos }, floorId: bed.floorId, crouched: false, hidden: false };
  host.rules.setBodies(() => [hostBody, guestBody]);
  guest.rules.setBodies(() => [guestBody, hostBody]);
  let n = 0;
  /** The guest clicks: the intent runs on the host, and the guest mirrors the result. */
  function intent(kind, target, body = {}) {
    const result = host.rules.applyIntent('guest', { n: ++n, kind, target, body: { pos: { ...guestBody.pos }, floorId: guestBody.floorId, ...body } }, guestBody);
    sync();
    return result;
  }
  const sync = () => guest.rules.applySnapshot(JSON.parse(JSON.stringify(host.rules.snapshot())));
  const instOf = (itemId) => host.rules.items.list().find((i) => i.itemId === itemId && i.where === 'world');
  /** Open the item's container on the host (as the host player) so it can be picked up. */
  function reach(itemId) {
    const inst = instOf(itemId);
    if (inst.containerId) {
      const c = host.world.containers.find((x) => x.id === inst.containerId);
      c.setLocked(false);
      if (!c.isOpen) c.setOpen(true);
    }
    return inst;
  }
  return { host, guest, hostBody, guestBody, intent, sync, instOf, reach };
}

test('host and guest build the same initial snapshot from one seed', () => {
  for (const seed of [1, 2, 7]) {
    const { host, guest } = pair(seed);
    assert.deepEqual(guest.rules.snapshot(), host.rules.snapshot());
  }
});

test('a snapshot is compact plain JSON', () => {
  const { host } = pair();
  const snap = host.rules.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  assert.ok(JSON.stringify(snap).length < 40_000, `${JSON.stringify(snap).length} bytes`);
});

test("a guest's intent picks an item up on the host and lands in the guest's hand on the mirror", () => {
  const t = pair();
  const hammer = t.reach(ITEMS.HAMMER);
  const result = t.intent('primary', { kind: 'item', id: hammer.id }, { pos: { ...hammer.pos }, floorId: hammer.floorId });
  assert.equal(result.action, 'pickup');
  assert.equal(t.host.rules.items.heldItemId('guest'), ITEMS.HAMMER);
  assert.equal(t.host.rules.items.heldItemId('host'), null);
  // The host's events say whose pickup it was, and where; its own HUD hears nothing.
  assert.deepEqual(t.host.of(EVENTS.PICKUP).at(-1), { itemId: ITEMS.HAMMER, playerId: 'guest', pos: hammer.pos });
  assert.equal(t.host.of(EVENTS.HELD).length, 0);

  assert.equal(t.guest.rules.items.heldItemId(), ITEMS.HAMMER);
  assert.deepEqual(t.guest.of(EVENTS.HELD).at(-1), { itemId: ITEMS.HAMMER, uses: null });
  assert.deepEqual(t.guest.rules.snapshot(), t.host.rules.snapshot());
});

test('each hand is independent', () => {
  const t = pair();
  const hammer = t.reach(ITEMS.HAMMER);
  const fuse = t.reach(ITEMS.FUSE);
  const key = t.reach(ITEMS.PADLOCK_KEY);
  t.host.rules.interact({ kind: 'item', id: fuse.id }, t.hostBody);
  t.intent('primary', { kind: 'item', id: hammer.id });
  assert.equal(t.host.rules.items.heldItemId('host'), ITEMS.FUSE);
  assert.equal(t.host.rules.items.heldItemId('guest'), ITEMS.HAMMER);

  // A swap puts down only the guest's own item.
  const keySpot = { ...key.pos };
  t.intent('primary', { kind: 'item', id: key.id });
  assert.equal(t.host.rules.items.heldItemId('guest'), ITEMS.PADLOCK_KEY);
  assert.equal(t.host.rules.items.heldItemId('host'), ITEMS.FUSE);
  assert.equal(hammer.where, 'world');
  assert.deepEqual(hammer.pos, keySpot);

  // Prompts and locks read the acting player's hand.
  const plank = { kind: 'lock', id: 'plank' };
  assert.match(t.host.rules.describe(plank, t.hostBody), /needs the Hammer/);
  assert.match(t.guest.rules.describe({ kind: 'lock', id: 'padlock' }, t.guestBody), /Click: unlock the padlock/);
  assert.match(t.host.rules.describe({ kind: 'lock', id: 'padlock' }, t.hostBody), /needs the Padlock Key/);
  t.intent('primary', { kind: 'lock', id: 'padlock' });
  assert.equal(t.host.rules.locks.isOpen('padlock'), true);
  assert.equal(t.guest.rules.locks.isOpen('padlock'), true, 'mirrored');
  assert.equal(t.host.rules.items.heldItemId('host'), ITEMS.FUSE, "the host's fuse stays put");

  // A wrong-item answer comes back to the guest as its message.
  t.intent('primary', plank);
  assert.match(t.guest.rules.answer('guest').say, /Nailed shut: needs the Hammer/);
});

test('traps arm per player', () => {
  const t = pair();
  const creak = t.host.world.anchors.traps.find((s) => s.kind === 'creaky');
  const away = { x: 5, y: 0, z: 5 };
  for (const b of [t.hostBody, t.guestBody]) Object.assign(b, { pos: { ...away }, floorId: 'ground' });
  t.host.rules.updateTraps(t.hostBody);
  t.host.rules.updateTraps(t.guestBody);
  t.hostBody.pos = { ...creak.pos };
  assert.equal(t.host.rules.updateTraps(t.hostBody).length, 1);
  // The guest steps on while the host is still on it: theirs fires too.
  t.guestBody.pos = { ...creak.pos };
  assert.equal(t.host.rules.updateTraps(t.guestBody).length, 1);
  assert.deepEqual(t.host.of(EVENTS.TRAP).at(-1), { kind: 'creaky', pos: creak.pos, floorId: 'ground', playerId: 'guest' });
  assert.equal(t.host.of(EVENTS.NOISE).at(-1).playerId, 'guest');
  // Neither fires again until that body steps off.
  assert.equal(t.host.rules.updateTraps(t.hostBody).length, 0);
  t.guestBody.pos = { ...away };
  t.host.rules.updateTraps(t.guestBody);
  t.guestBody.pos = { ...creak.pos };
  assert.equal(t.host.rules.updateTraps(t.guestBody).length, 1);
  assert.equal(t.host.rules.updateTraps(t.hostBody).length, 0);
  // The guest's game never runs traps.
  assert.equal(t.guest.rules.updateTraps(t.guestBody).length, 0);
  assert.equal(t.guest.of(EVENTS.TRAP).length, 0);
});

test('treat and dart ids are only made on the host', () => {
  const t = pair();
  const treats = t.reach(ITEMS.TREATS);
  t.intent('primary', { kind: 'item', id: treats.id });
  assert.equal(t.guest.rules.dropTreat({ x: 2, y: 0, z: 2 }, 'ground'), null, 'a guest never drops a treat itself');
  const spot = { pos: { x: 2, y: 0, z: 2 }, floorId: 'ground' };
  const result = t.intent('secondary', null, { eye: { x: 2, y: 1.1, z: 2 }, dir: { x: 0, y: 0, z: -1 }, treat: spot });
  assert.equal(result.action, 'treat');
  assert.deepEqual([...t.host.rules.treats.keys()], ['treat1']);
  assert.deepEqual([...t.guest.rules.treats.keys()], ['treat1']);
  assert.equal(t.host.of(EVENTS.TREAT_DROPPED).at(-1).playerId, 'guest');
  assert.equal(t.guest.of(EVENTS.TREAT_DROPPED).length, 0);
  t.host.bus.emit(EVENTS.TREAT_EATEN, { treatId: 'treat1' });
  t.sync();
  assert.equal(t.guest.rules.treats.size, 0);

  // A missed dart lands as a new item: made on the host, mirrored by id.
  t.reach(ITEMS.LAUNCHER);
  const launcher = t.instOf(ITEMS.LAUNCHER);
  t.intent('primary', { kind: 'item', id: launcher.id });
  assert.equal(t.guest.rules.fireDart({ x: 3, y: 1, z: 3 }, { x: 0, y: 0, z: -1 }, 2, 'ground'), false);
  const shot = t.intent('secondary', null, { eye: { x: 3, y: 1, z: 3 }, dir: { x: 0, y: 0, z: -1 }, range: 2, floorId: 'ground' });
  assert.equal(shot.action, 'fire');
  assert.equal(t.host.of(EVENTS.DART_FIRED).at(-1).playerId, 'guest');
  assert.equal(t.guest.rules.darts.length, 1, 'the guest draws the flying dart');
  const before = new Set(t.host.rules.items.list().map((i) => i.id));
  for (let k = 0; k < 30; k++) {
    t.host.rules.update(1 / 30);
    t.guest.rules.update(1 / 30);
  }
  assert.equal(t.guest.rules.items.list().length, before.size, 'the guest made no item');
  const made = t.host.rules.items.list().filter((i) => !before.has(i.id));
  assert.equal(made.length, 1);
  assert.equal(made[0].itemId, ITEMS.DART);
  t.sync();
  assert.ok(t.guest.rules.items.get(made[0].id), 'the guest has the host-made dart');
  assert.equal(t.guest.rules.darts.length, 0);
  assert.deepEqual(t.guest.rules.snapshot(), t.host.rules.snapshot());
});

test('applying a snapshot twice changes nothing and says nothing', () => {
  const t = pair();
  const ball = t.reach(ITEMS.TENNIS_BALL);
  t.intent('primary', { kind: 'item', id: ball.id });
  const door = t.host.world.doors.find((d) => !d.locked);
  door.setOpen(true, 'player');
  const snap = JSON.parse(JSON.stringify(t.host.rules.snapshot()));
  assert.equal(t.guest.rules.applySnapshot(snap), true);
  assert.equal(t.guest.world.doors.find((d) => d.id === door.id).isOpen, true);
  const mirrored = t.guest.rules.snapshot();
  const count = t.guest.events.length;
  assert.equal(t.guest.rules.applySnapshot(snap), false);
  assert.equal(t.guest.events.length, count);
  assert.deepEqual(t.guest.rules.snapshot(), mirrored);
  assert.deepEqual(mirrored, snap);
});

test("a guest's thrown ball flies on the host and the guest sees it land", () => {
  const t = pair();
  const ball = t.reach(ITEMS.TENNIS_BALL);
  t.intent('primary', { kind: 'item', id: ball.id });
  const thrown = t.intent('secondary', null, { pos: { x: 8.5, y: 0, z: 5.5 }, floorId: 'ground', eye: { x: 8.5, y: 1.1, z: 5.5 }, dir: { x: 0, y: 0, z: -1 } });
  assert.equal(thrown.action, 'throw');
  assert.equal(t.guest.rules.items.get(ball.id).where, 'flying');
  assert.equal(t.guest.rules.items.heldItemId(), null);
  for (let k = 0; k < 400 && ball.where === 'flying'; k++) t.host.rules.update(1 / 60);
  assert.equal(ball.where, 'world');
  assert.equal(t.host.of(EVENTS.BALL_LANDED).length, 1);
  t.sync();
  assert.equal(t.guest.rules.items.get(ball.id).where, 'world');
  assert.equal(t.guest.of(EVENTS.BALL_LANDED).length, 0, 'the guest hears it as a replay, not from its own rules');
});

test('replays from the partner never change state', () => {
  const t = pair();
  const ball = t.reach(ITEMS.TENNIS_BALL);
  t.host.rules.interact({ kind: 'item', id: ball.id }, t.hostBody);
  t.host.rules.throwBall({ x: 3, y: 1, z: 3 }, 'ground');
  t.host.rules.ballLanded(ball, { x: 4, y: 0.04, z: 5 }, 'ground');
  t.host.bus.emit(EVENTS.BALL_FETCHED, { remote: true, playerId: 'guest' });
  assert.equal(ball.where, 'world');
  t.host.bus.emit(EVENTS.BALL_FETCHED, {});
  assert.equal(ball.where, 'doodle');
  // The guest ignores the host's replayed events too: its state comes in snapshots.
  t.sync();
  t.guest.bus.emit(EVENTS.BALL_RETURNED, { pos: { x: 1, y: 0, z: 1 }, floorId: 'ground', remote: true, playerId: 'host' });
  t.guest.bus.emit(EVENTS.BALL_RETURNED, { pos: { x: 1, y: 0, z: 1 }, floorId: 'ground' });
  assert.equal(t.guest.rules.items.get(ball.id).where, 'doodle');
});

test('a resent intent runs once, and a down player can do nothing', () => {
  const t = pair();
  const dial = { kind: 'lock', id: 'keypad', dial: 0 };
  const intent = { n: 1, kind: 'primary', target: dial, body: { pos: { ...t.guestBody.pos }, floorId: t.guestBody.floorId } };
  t.host.rules.applyIntent('guest', intent, t.guestBody);
  t.host.rules.applyIntent('guest', intent, t.guestBody);
  assert.equal(t.host.rules.keypad.digits[0], 1);
  assert.deepEqual(t.host.of(EVENTS.KEYPAD_ROLLED).at(-1), { index: 0, digit: 1, pos: t.host.world.anchors.frontDoor.keypad.pos, playerId: 'guest' });
  t.sync();
  assert.equal(t.guest.rules.keypad.digits[0], 1);
  t.host.rules.applyIntent('guest', { ...intent, n: 2 }, { ...t.guestBody, down: true });
  assert.equal(t.host.rules.keypad.digits[0], 1);
  assert.equal(t.host.rules.answer('guest').n, 2, 'still answered, so the guest stops waiting');
});

test('a caught guest drops their item where they were, quietly', () => {
  const t = pair();
  const hammer = t.reach(ITEMS.HAMMER);
  t.intent('primary', { kind: 'item', id: hammer.id });
  const noise = t.host.of(EVENTS.NOISE).length;
  t.host.rules.onCaught({ x: 1, y: 0, z: 1 }, 'ground', 'guest');
  assert.equal(hammer.where, 'world');
  assert.deepEqual(hammer.pos, { x: 1, y: 0, z: 1 });
  assert.equal(t.host.of(EVENTS.NOISE).length, noise);
  assert.equal(t.host.of(EVENTS.DROP).at(-1).playerId, 'guest');
  assert.equal(t.guest.rules.onCaught({ x: 1, y: 0, z: 1 }, 'ground'), null, "the guest's game leaves it to the host");
});

test('either player walking out of the open front door escapes, on the host only', () => {
  const t = pair();
  t.host.rules.openAll();
  const door = t.host.rules.locks.frontDoor();
  door.setOpen(true, 'player');
  t.sync();
  const exit = t.host.world.anchors.frontDoor.exit.pos;
  t.guestBody.pos = { ...exit };
  t.guestBody.floorId = door.floorId;
  assert.equal(t.guest.rules.walkOut(t.guestBody), false);
  assert.equal(t.host.rules.walkOut(t.guestBody), true);
  assert.deepEqual(t.host.of(EVENTS.ESCAPED), [{ route: 'frontDoor', playerId: 'guest' }]);
  assert.equal(t.host.rules.walkOut(t.hostBody), false, 'once per run');
});

test("two players can't hide in one spot", () => {
  const t = pair();
  const spot = t.host.world.anchors.hideSpots[0];
  const hide = { kind: 'hide', id: spot.id };
  assert.equal(t.host.rules.interact(hide, t.hostBody).action, 'hide');
  Object.assign(t.hostBody, { hidden: true, hideSpotId: spot.id });
  assert.equal(t.guest.rules.describe(hide, t.guestBody), "Someone's already hiding here");
  assert.deepEqual(t.guest.rules.interact(hide, t.guestBody), { message: "Someone's already hiding here" });
  assert.match(t.host.rules.describe(hide, t.hostBody), /^Click: hide/, 'your own spot is still yours');
});

test('the guest sends shared changes to the host and runs its own body itself', () => {
  const t = pair();
  const hammer = t.instOf(ITEMS.HAMMER);
  const g = t.guest.rules;
  assert.equal(g.needsHost('primary', { kind: 'item', id: hammer.id }, t.guestBody), true);
  assert.equal(g.needsHost('primary', { kind: 'door', id: 'x' }, t.guestBody), true);
  assert.equal(g.needsHost('primary', { kind: 'hide', id: 'x' }, t.guestBody), false);
  assert.equal(g.needsHost('primary', { kind: 'linkEntry', id: 'x' }, t.guestBody), false);
  assert.equal(g.needsHost('primary', null, t.guestBody), false);
  assert.equal(g.needsHost('drop', null, t.guestBody), false, 'nothing in hand');
  assert.equal(g.needsHost('secondary', { kind: 'lock', id: 'keypad', dial: 1 }, t.guestBody), true);
  assert.equal(g.needsHost('secondary', null, t.guestBody), false);
});

test('solo events carry no playerId', () => {
  const bus = createBus();
  const seen = [];
  bus.on(EVENTS.PICKUP, (p) => seen.push(p));
  const world = createMiniHouse({ bus });
  const rules = createRules({ world, bus, rng: createRng(3) });
  const hammer = rules.items.list().find((i) => i.itemId === ITEMS.HAMMER);
  if (hammer.containerId) world.containers.find((c) => c.id === hammer.containerId).setOpen(true);
  rules.interact({ kind: 'item', id: hammer.id }, { pos: hammer.pos, floorId: hammer.floorId });
  assert.deepEqual(seen, [{ itemId: ITEMS.HAMMER }]);
  assert.equal(rules.snapshot().hands.host, hammer.id);
});

test('the guest wakes in startBed2, or beside startBed', () => {
  const world = createMiniHouse();
  const bed = world.anchors.startBed;
  assert.equal(wakeSpot(world, 'host'), bed);
  const beside = wakeSpot(world, 'guest');
  assert.equal(beside.floorId, bed.floorId);
  const d = Math.hypot(beside.pos.x - bed.pos.x, beside.pos.z - bed.pos.z);
  assert.ok(d > 0.3 && d < 1.5, `${d} m from startBed`);
  world.anchors.startBed2 = { id: 'bunk', floorId: bed.floorId, pos: { x: 1, y: 3, z: 1 }, rotY: 0 };
  assert.equal(wakeSpot(world, 'guest'), world.anchors.startBed2);
});

test('the remote player eases toward its poses and reports eyes and visibility', () => {
  const world = createMiniHouse();
  const tuning = tuningFor('normal');
  const r = createRemotePlayer({ world, tuning, id: 'guest' });
  assert.equal(r.player.down, true, 'not here yet');
  assert.equal(r.player.visibility(), 0);
  const pose = (pos, extra = {}) => ({ id: 'guest', pos, floorId: 'ground', yaw: 0, pitch: 0, crouched: false, sprinting: false, moving: true, hidden: false, hideSpotId: null, flashlightOn: true, held: null, onLink: false, down: false, ...extra });
  r.setPose(pose({ x: 5, y: 0, z: 5 }));
  assert.deepEqual(r.player.pos, { x: 5, y: 0, z: 5 }, 'the first pose shows at once');
  assert.equal(r.player.down, false);
  r.setPose(pose({ x: 6, y: 0, z: 5 }));
  r.update(1 / 60);
  assert.ok(r.player.pos.x > 5 && r.player.pos.x < 6, 'walking is eased');
  for (let k = 0; k < 60; k++) r.update(1 / 60);
  assert.ok(Math.abs(r.player.pos.x - 6) < 0.01);
  assert.ok(Math.abs(r.player.eyePos().y - 1.1) < 1e-9);
  assert.ok(r.player.visibility() > 0, 'a lit flashlight shows');
  r.setPose(pose({ x: 6, y: 0, z: 5 }, { crouched: true }));
  assert.ok(Math.abs(r.player.eyePos().y - 0.55) < 1e-9);
  const spot = world.anchors.hideSpots[0];
  r.setPose(pose(spot.pos, { hidden: true, hideSpotId: spot.id }));
  assert.equal(r.player.visibility(), 0);
  assert.deepEqual(r.player.eyePos(), spot.eyePos);
  r.setDown(true);
  assert.equal(r.player.down, true);
  r.setDown(false);
  r.setPose(null);
  assert.equal(r.isPresent(), false);
  assert.equal(r.player.down, true, 'a partner who left is out of play');
  assert.equal(r.player.visibility(), 0);
});
