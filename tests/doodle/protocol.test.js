// The CONTRACTS.md event protocols, driven over a real bus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, place, makePlayer, EVENTS } from './helpers.js';

const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function throwBall(sim, pos, floorId = 'ground') {
  sim.bus.emit(EVENTS.BALL_THROWN, { pos: { x: 8, y: 1, z: 4 }, floorId });
  sim.bus.emit(EVENTS.BALL_LANDED, { pos, floorId });
  sim.bus.emit(EVENTS.NOISE, { pos, floorId, loudness: 8, kind: 'ball' });
}

test('ball: fetch → BALL_FETCHED at the ball → carried to kennelBed → BALL_RETURNED', () => {
  const sim = setup();
  const ball = { x: 10.5, y: 0, z: 4 };
  let fetchedAt = null;
  sim.bus.on(EVENTS.BALL_FETCHED, () => (fetchedAt = { ...sim.doodle.pos }));
  throwBall(sim, ball);
  assert.equal(sim.doodle.state, 'distracted');
  assert.ok(sim.run(20, null, () => sim.count(EVENTS.BALL_RETURNED) > 0), 'returned the ball');
  assert.equal(sim.count(EVENTS.BALL_FETCHED), 1);
  assert.equal(sim.count(EVENTS.BALL_RETURNED), 1);
  assert.ok(sim.first(EVENTS.BALL_FETCHED).t < sim.first(EVENTS.BALL_RETURNED).t);
  assert.ok(d2(fetchedAt, ball) <= sim.doodle.tuning.itemReach + 0.5, 'picked it up where it landed');
  const { pos, floorId } = sim.first(EVENTS.BALL_RETURNED).payload;
  const bed = sim.world.anchors.kennelBed;
  assert.equal(floorId, bed.floorId);
  assert.ok(d2(pos, bed.pos) < 1e-6, 'dropped on the kennel bed');
  assert.equal(sim.doodle.carrying, null);
  sim.run(0.1);
  assert.equal(sim.doodle.state, 'patrol');
});

test('ball: picking it up first cancels the fetch', () => {
  const sim = setup();
  throwBall(sim, { x: 2, y: 0, z: 2 }); // in the hall, through the door
  sim.run(1);
  assert.equal(sim.doodle.state, 'distracted');
  sim.bus.emit(EVENTS.PICKUP, { itemId: 'tennisBall' });
  assert.equal(sim.doodle.state, 'investigate', 'comes to see who took it');
  sim.run(10);
  assert.equal(sim.count(EVENTS.BALL_FETCHED), 0);
  assert.equal(sim.count(EVENTS.BALL_RETURNED), 0);
});

test('ball: a thrown ball does not break a chase while it can still see you', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const player = makePlayer(8.5, 0, 2.5);
  sim.run(1, player, () => sim.doodle.state === 'chase');
  throwBall(sim, { x: 2, y: 0, z: 2 });
  assert.equal(sim.doodle.state, 'chase');
});

test('ball: caught while carrying it → wakes up still holding it and returns it', () => {
  const sim = setup();
  throwBall(sim, { x: 10.5, y: 0, z: 4 });
  sim.run(10, null, () => sim.count(EVENTS.BALL_FETCHED) > 0);
  assert.equal(sim.doodle.carrying, 'ball');
  sim.doodle.setActive(false); // catch cutscene / next day
  sim.doodle.reset(sim.world.anchors.kennel, { wakeDelay: 1 });
  sim.doodle.setActive(true);
  assert.equal(sim.count(EVENTS.BALL_RETURNED), 0);
  assert.ok(sim.run(10, null, () => sim.count(EVENTS.BALL_RETURNED) > 0));
});

test('treat: walks over, eats for ~5 s, emits TREAT_EATEN, and it breaks a chase', () => {
  let sim = setup();
  sim.bus.emit(EVENTS.TREAT_DROPPED, { treatId: 'treat-1', pos: { x: 9, y: 0, z: 4.5 }, floorId: 'ground' });
  assert.equal(sim.doodle.state, 'distracted');
  let eatingFrom = null;
  assert.ok(sim.run(15, null, () => {
    if (sim.doodle.pose === 'eat' && eatingFrom === null) eatingFrom = sim.time;
    return sim.count(EVENTS.TREAT_EATEN) > 0;
  }));
  assert.deepEqual(sim.first(EVENTS.TREAT_EATEN).payload, { treatId: 'treat-1' });
  assert.ok(Math.abs(sim.first(EVENTS.TREAT_EATEN).t - eatingFrom - 5) < 0.1, 'ate for 5 s');
  sim.run(0.1);
  assert.equal(sim.doodle.state, 'patrol');

  // Mid-chase: drop a treat in its path and the chase ends.
  sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const player = makePlayer(8.5, 0, 2.5);
  sim.run(1, player, () => sim.doodle.state === 'chase');
  sim.bus.emit(EVENTS.TREAT_DROPPED, { treatId: 'treat-2', pos: { x: 8.5, y: 0, z: 4 }, floorId: 'ground' });
  assert.equal(sim.doodle.state, 'distracted');
  assert.equal(sim.count(EVENTS.LOST_TRACK), 1);
  player.moveTo(1, 0, 1); // run off while it eats
  assert.ok(sim.run(10, player, () => sim.count(EVENTS.TREAT_EATEN) > 0));
  assert.equal(sim.count(EVENTS.CAUGHT), 0);
});

test('treat: Hard ignores about half of them', () => {
  let ignored = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const sim = setup({ difficulty: 'hard', seed });
    sim.bus.emit(EVENTS.TREAT_DROPPED, { treatId: `t${seed}`, pos: { x: 8, y: 0, z: 5 }, floorId: 'ground' });
    if (sim.doodle.state !== 'distracted') ignored++;
  }
  assert.ok(ignored >= 10 && ignored <= 30, `${ignored}/40 ignored`);
  const normal = setup();
  normal.bus.emit(EVENTS.TREAT_DROPPED, { treatId: 'n', pos: { x: 8, y: 0, z: 5 }, floorId: 'ground' });
  assert.equal(normal.doodle.state, 'distracted');
});

test('dart: hit → DOODLE_HIT, STUNNED for the difficulty stun time, then DOODLE_RECOVERED', () => {
  for (const [difficulty, seconds] of [['easy', 30], ['normal', 20], ['hard', 12]]) {
    const sim = setup({ difficulty });
    const origin = { x: 9, y: 1.1, z: 3 };
    const c = sim.doodle.bounds().center;
    const v = { x: c.x - origin.x, y: c.y - origin.y, z: c.z - origin.z };
    const l = Math.hypot(v.x, v.y, v.z);
    sim.bus.emit(EVENTS.DART_FIRED, { origin, dir: { x: v.x / l, y: v.y / l, z: v.z / l }, range: 20 });
    assert.equal(sim.count(EVENTS.DOODLE_HIT), 1, difficulty);
    assert.deepEqual(sim.first(EVENTS.DOODLE_STUNNED).payload, { seconds });
    assert.ok(sim.first(EVENTS.DOODLE_HIT).t <= sim.first(EVENTS.DOODLE_STUNNED).t);
    assert.equal(sim.doodle.state, 'stunned');
    sim.run(0.1);
    assert.equal(sim.doodle.pose, 'chew');
    sim.run(seconds - 0.3);
    assert.equal(sim.count(EVENTS.DOODLE_RECOVERED), 0);
    assert.equal(sim.doodle.speed, 0);
    sim.run(0.5);
    assert.equal(sim.count(EVENTS.DOODLE_RECOVERED), 1);
    assert.equal(sim.doodle.state, 'investigate', 'goes to see where the dart came from');
  }
});

test('dart: misses and walls do nothing', () => {
  const sim = setup();
  sim.bus.emit(EVENTS.DART_FIRED, { origin: { x: 9, y: 1.1, z: 3 }, dir: { x: 1, y: 0, z: 0 }, range: 20 });
  sim.bus.emit(EVENTS.DART_FIRED, { origin: { x: 3, y: 1.1, z: 6.4 }, dir: { x: 1, y: 0, z: 0 }, range: 20 }); // hall → kitchen wall
  assert.equal(sim.count(EVENTS.DOODLE_HIT), 0);
  assert.equal(sim.doodle.state, 'patrol');
});

test('stunning drops a carried ball where it stands', () => {
  const sim = setup();
  throwBall(sim, { x: 10.5, y: 0, z: 4 });
  sim.run(10, null, () => sim.count(EVENTS.BALL_FETCHED) > 0);
  sim.doodle.stun(5);
  assert.equal(sim.count(EVENTS.BALL_RETURNED), 1);
  assert.ok(d2(sim.first(EVENTS.BALL_RETURNED).payload.pos, sim.doodle.pos) < 1e-6);
  assert.equal(sim.doodle.carrying, null);
});

test('LINK_ENTER mid-chase: loses track (it cannot follow into a tunnel or slide)', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const player = makePlayer(8.5, 0, 2.5);
  sim.run(1, player, () => sim.doodle.state === 'chase');
  sim.bus.emit(EVENTS.LINK_ENTER, { linkId: 'hallKitchenTunnel', kind: 'tunnel' });
  assert.equal(sim.doodle.state, 'search');
  assert.equal(sim.count(EVENTS.LOST_TRACK), 1);
  // While the player is inside the link it can't see them even standing in the open.
  sim.run(1, player);
  assert.notEqual(sim.doodle.state, 'chase');
});

test('DOODLE_STATE carries {state, prev} for every change', () => {
  const sim = setup({ wakeDelay: 0.5 });
  sim.run(1);
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 9, y: 0, z: 3 }, floorId: 'ground', loudness: 9, kind: 'other' });
  const changes = sim.of(EVENTS.DOODLE_STATE).map((e) => e.payload);
  for (let k = 1; k < changes.length; k++) assert.equal(changes[k].prev, changes[k - 1].state);
  assert.deepEqual(changes.slice(-2).map((c) => c.state), ['patrol', 'investigate']);
});
