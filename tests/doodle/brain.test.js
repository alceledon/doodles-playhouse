import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOODLE_BODY } from '../../src/core/contracts.js';
import { setup, place, makePlayer, EVENTS, DT } from './helpers.js';

const states = (sim) => sim.of(EVENTS.DOODLE_STATE).map((e) => e.payload.state);

/** Doodle in the kitchen at (8.5, 6) facing -Z with the player 3.5 m dead ahead, under the kitchen lamp. */
function standoff(opts) {
  const sim = setup(opts);
  place(sim, 8.5, 6, 'ground', 0);
  const player = makePlayer(8.5, 0, 2.5);
  return { sim, player };
}

test('sleeps for wakeDelay, then patrols', () => {
  const sim = setup({ wakeDelay: 8 });
  assert.equal(sim.doodle.state, 'sleep');
  assert.equal(sim.doodle.pose, 'sleep');
  sim.run(7.9);
  assert.equal(sim.doodle.state, 'sleep');
  assert.equal(sim.doodle.speed, 0);
  sim.run(0.2);
  assert.equal(sim.doodle.state, 'patrol');
  sim.run(1);
  assert.ok(Math.abs(sim.doodle.speed - 2.5) < 0.2, `patrol speed ${sim.doodle.speed}`);
});

test('noise → investigate (loudness radius, damped through floors)', () => {
  let sim = setup();
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 3, y: 3, z: 4 }, floorId: 'upstairs', loudness: 6, kind: 'squeak' });
  assert.equal(sim.doodle.state, 'patrol', 'upstairs, 6 m loud is only ~2 m down here');
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 3, y: 0, z: 4 }, floorId: 'ground', loudness: 6, kind: 'squeak' });
  assert.equal(sim.doodle.state, 'investigate');
  assert.deepEqual(sim.of(EVENTS.DOODLE_STATE).at(-1).payload, { state: 'investigate', prev: 'patrol' });

  // It walks there, looks around, then goes back to patrolling.
  sim = setup();
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 8, y: 0, z: 2.25 }, floorId: 'ground', loudness: 8, kind: 'creak' });
  assert.ok(sim.run(5, null, () => Math.hypot(sim.doodle.pos.x - 8, sim.doodle.pos.z - 2.25) < 0.1), 'reached the noise');
  assert.ok(Math.abs(sim.doodle.speed) < 4);
  assert.ok(sim.run(6, null, () => sim.doodle.state === 'patrol'));
});

test('sight → chase: SPOTTED once, hunt mood, chase speed, then the catch', () => {
  const { sim, player } = standoff();
  assert.ok(sim.run(1, player, () => sim.doodle.state === 'chase'), 'spotted within a second');
  assert.ok(sim.time < 0.6, `took ${sim.time.toFixed(2)} s`);
  assert.equal(sim.count(EVENTS.SPOTTED), 1);
  assert.equal(sim.doodle.mood, 'hunt');
  sim.run(0.25, player);
  assert.ok(sim.doodle.speed > 4, `chase speed ${sim.doodle.speed}`);
  assert.ok(sim.run(3, player, () => sim.count(EVENTS.CAUGHT) > 0));
  assert.deepEqual(sim.first(EVENTS.CAUGHT).payload, { how: 'tackle' });
});

test('lose sight → search (LOST_TRACK), then back to patrol', () => {
  const { sim, player } = standoff({ tuning: { trackTime: 0 } });
  sim.run(1, player, () => sim.doodle.state === 'chase');
  player.moveTo(2, 3, 2, 'upstairs'); // gone (it can't see another floor)
  assert.ok(sim.run(4, player, () => sim.doodle.state === 'search'), 'searching where it lost you');
  assert.equal(sim.count(EVENTS.LOST_TRACK), 1);
  assert.ok(Math.hypot(sim.doodle.pos.x - 8.5, sim.doodle.pos.z - 2.5) < 1, 'went to the last place it saw you');
  assert.deepEqual(states(sim).slice(-2), ['chase', 'search']);
  assert.ok(sim.run(12, null, () => sim.doodle.state === 'patrol'));
});

test('for a moment after losing sight it still tracks you (trackTime)', () => {
  const { sim, player } = standoff({ tuning: { trackTime: 1 } });
  sim.run(1, player, () => sim.doodle.state === 'chase');
  player.moveTo(1, 0, 1); // behind the hall wall: not visible, but it "heard" where you went
  sim.run(0.3, player);
  assert.ok(Math.hypot(sim.doodle.debug.target.x - 1, sim.doodle.debug.target.z - 1) < 0.5);
});

test('sees you hide → pulls you out; unseen hides are safe for a while', () => {
  // Seen: Doodle in the kitchen watching the player duck into the cabinet.
  let sim = setup();
  place(sim, 8.5, 4.5, 'ground', Math.PI); // facing +Z
  let player = makePlayer(9.2, 0, 6.5);
  sim.run(DT, player);
  assert.ok(sim.doodle.debug.senses.sight.visible);
  player.hidden = true;
  player.hideSpotId = 'hideKitchenCabinet';
  sim.bus.emit(EVENTS.HIDE, { spotId: 'hideKitchenCabinet', pos: { x: 9.2, y: 0, z: 7.0 }, floorId: 'ground' });
  assert.equal(sim.doodle.state, 'chase');
  assert.ok(sim.run(4, player, () => sim.count(EVENTS.CAUGHT) > 0));
  assert.deepEqual(sim.first(EVENTS.CAUGHT).payload, { how: 'pulledOut' });

  // Unseen: hiding under the upstairs bed while Doodle prowls downstairs.
  sim = setup();
  player = makePlayer(5.3, 3, 3.6, 'upstairs');
  player.hidden = true;
  player.hideSpotId = 'hideUnderBed';
  sim.bus.emit(EVENTS.HIDE, { spotId: 'hideUnderBed', pos: { x: 5.3, y: 3, z: 3.45 }, floorId: 'upstairs' });
  assert.equal(sim.doodle.state, 'patrol');
  sim.run(20, player);
  assert.equal(sim.count(EVENTS.CAUGHT), 0, 'not caught in the first 20 s');
});

test('a long hide gets sniffed out', () => {
  const sim = setup();
  const player = makePlayer(5.3, 3, 3.6, 'upstairs');
  player.hidden = true;
  player.hideSpotId = 'hideUnderBed';
  sim.bus.emit(EVENTS.HIDE, { spotId: 'hideUnderBed', pos: { x: 5.3, y: 3, z: 3.45 }, floorId: 'upstairs' });
  let sniffed = false;
  const got = sim.run(150, player, () => {
    sniffed ||= sim.doodle.state === 'sniff';
    return sim.count(EVENTS.CAUGHT) > 0;
  });
  assert.ok(got, 'sniffed out eventually');
  assert.ok(sniffed);
  assert.ok(sim.first(EVENTS.CAUGHT).t >= sim.doodle.tuning.hideSniffTime);
  assert.deepEqual(sim.first(EVENTS.CAUGHT).payload, { how: 'pulledOut' });
  assert.equal(sim.doodle.floorId, 'upstairs');
});

test('keeping still in the dark nearby: it smells you, closes in and catches you', () => {
  const sim = setup();
  place(sim, 8.5, 5.5, 'ground', 0);
  const player = makePlayer(8.5, 0, 2.5, 'ground', { vis: 0 }); // crouched in the dark: seen only up close
  player.crouched = true;
  assert.ok(sim.run(30, player, () => sim.count(EVENTS.CAUGHT) > 0));
  assert.ok(states(sim).includes('sniff'));
});

test('scent it can smell but not reach (you, in a crawl tunnel) does not make it dither', () => {
  const sim = setup();
  place(sim, 2, 4.5, 'ground', -Math.PI / 2);
  const player = makePlayer(3.75, 0, 4.5, 'ground', { vis: 0 });
  player.crouched = true;
  sim.run(40, player);
  assert.equal(sim.count(EVENTS.CAUGHT), 0);
  assert.ok(states(sim).includes('sniff'));
  assert.ok(sim.count(EVENTS.DOODLE_STATE) < 25, `${sim.count(EVENTS.DOODLE_STATE)} state changes in 40 s`);
});

test('follows a scent trail to where it ends', () => {
  // The player walks from the kitchen through the door to the hall's far corner
  // while Doodle sleeps, then leaves (no more scent). Doodle wakes and tracks it.
  const sim = setup({ wakeDelay: 6 });
  sim.door('hallKitchen').setOpen(true);
  const trail = [[8, 3], [6.75, 4], [5.25, 4], [2, 2], [1, 1]];
  const player = makePlayer(8, 0, 3);
  for (let k = 1; k < trail.length; k++) {
    const [ax, az] = trail[k - 1];
    const [bx, bz] = trail[k];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (3 * DT));
    for (let s = 1; s <= n; s++) {
      player.moveTo(ax + ((bx - ax) * s) / n, 0, az + ((bz - az) * s) / n);
      sim.run(DT, player);
    }
  }
  assert.equal(sim.doodle.state, 'sleep');
  let closest = Infinity;
  const done = sim.run(30, null, () => {
    if (sim.doodle.state === 'sniff') closest = Math.min(closest, Math.hypot(sim.doodle.pos.x - 1, sim.doodle.pos.z - 1));
    return closest < 1;
  });
  assert.ok(done, `got within ${closest.toFixed(2)} m of the trail's end while sniffing`);
  assert.ok(states(sim).includes('sniff'));
});

test('CAUGHT is emitted exactly once per catch', () => {
  const sim = setup();
  place(sim, 8.5, 4, 'ground', 0);
  const player = makePlayer(8.5, 0, 4 - DOODLE_BODY.catchRange + 0.3);
  sim.run(3, player);
  assert.equal(sim.count(EVENTS.CAUGHT), 1);
  assert.equal(sim.doodle.state, 'catch');
  assert.equal(sim.doodle.pose, 'pounce');
  assert.equal(sim.doodle.mood, 'hunt');
  sim.run(3, player);
  assert.equal(sim.count(EVENTS.CAUGHT), 1, 'no repeats');
  // Next day: reset re-arms it.
  place(sim, 8.5, 4, 'ground', 0);
  sim.run(1, player);
  assert.equal(sim.count(EVENTS.CAUGHT), 2);
});

test('no catch through a wall, while hidden, or inside a crawl tunnel', () => {
  const sim = setup();
  // Kitchen side of the hall wall, player on the hall side 0.75 m away.
  place(sim, 6.35, 6, 'ground', Math.PI / 2);
  sim.run(0.3, makePlayer(5.6, 0, 6));
  assert.equal(sim.count(EVENTS.CAUGHT), 0);
  // Hidden right next to it (unseen).
  place(sim, 8.5, 4, 'ground', 0);
  const hidden = makePlayer(8.5, 0, 4.5);
  hidden.hidden = true;
  sim.run(0.3, hidden);
  assert.equal(sim.count(EVENTS.CAUGHT), 0);
  // Crouched just inside the play tunnel's mouth, Doodle at the opening.
  place(sim, 2.7, 4.5, 'ground', -Math.PI / 2);
  const crawling = makePlayer(3.3, 0, 4.5);
  crawling.crouched = true;
  sim.run(0.3, crawling);
  assert.equal(sim.count(EVENTS.CAUGHT), 0);
});

test('setActive(false): no AI and no events, even with everything going on', () => {
  const sim = setup();
  const before = { ...sim.doodle.pos };
  sim.doodle.setActive(false);
  const n = sim.events.length;
  const player = makePlayer(sim.doodle.pos.x, 0, sim.doodle.pos.z - 0.5);
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 3, y: 0, z: 3 }, floorId: 'ground', loudness: 20, kind: 'other' });
  sim.bus.emit(EVENTS.TREAT_DROPPED, { treatId: 't1', pos: { x: 8, y: 0, z: 5 }, floorId: 'ground' });
  sim.bus.emit(EVENTS.DART_FIRED, { origin: { x: 9, y: 1.1, z: 3 }, dir: { x: -0.55, y: -0.05, z: 0.83 }, range: 20 });
  sim.run(3, player);
  const fromDoodle = sim.events.slice(n).filter((e) => ![EVENTS.NOISE, EVENTS.TREAT_DROPPED, EVENTS.DART_FIRED].includes(e.type));
  assert.deepEqual(fromDoodle, []);
  assert.equal(sim.doodle.state, 'patrol');
  assert.deepEqual(sim.doodle.pos, before);
  assert.equal(sim.doodle.speed, 0);
});
