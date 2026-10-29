// Two players against one Doodle (co-op), and the guest's puppet Doodle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoodlePuppet } from '../../src/doodle/puppet.js';
import { setup, place, makePlayer, EVENTS, DT } from './helpers.js';

const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** makePlayer with a co-op id. */
function makeCoop(id, x, y, z, floorId = 'ground', opts) {
  const p = makePlayer(x, y, z, floorId, opts);
  p.id = id;
  p.down = false;
  return p;
}

const targetOf = (sim) => sim.doodle.debug.senses.targetId;
const personOf = (sim, id) => sim.doodle.debug.senses.players.find((p) => p.id === id);

test('two players: it chases the one it can see, and CAUGHT names them', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const host = makeCoop('host', 2, 3, 2, 'upstairs'); // out of sight on another floor
  const guest = makeCoop('guest', 8.5, 0, 2.5); // dead ahead under the kitchen lamp
  assert.ok(sim.run(1, [host, guest], () => sim.doodle.state === 'chase'));
  assert.equal(targetOf(sim), 'guest');
  assert.ok(sim.run(3, [host, guest], () => sim.count(EVENTS.CAUGHT) > 0));
  assert.deepEqual(sim.first(EVENTS.CAUGHT).payload, { how: 'tackle', playerId: 'guest' });
  assert.equal(sim.count(EVENTS.CAUGHT), 1);
});

test('a solo Player with id "host" gets CAUGHT {how, playerId: "host"}', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const host = makeCoop('host', 8.5, 0, 2.5);
  assert.ok(sim.run(4, host, () => sim.count(EVENTS.CAUGHT) > 0));
  assert.deepEqual(sim.first(EVENTS.CAUGHT).payload, { how: 'tackle', playerId: 'host' });
});

test('a down player is ignored: not seen, not caught, no scent', () => {
  const sim = setup();
  place(sim, 8.5, 4, 'ground', 0);
  const host = makeCoop('host', 2, 3, 2, 'upstairs');
  const guest = makeCoop('guest', 8.5, 0, 3.5); // in catch range, in plain sight
  guest.down = true;
  sim.run(3, [host, guest]);
  assert.equal(sim.count(EVENTS.CAUGHT), 0);
  assert.equal(sim.count(EVENTS.SPOTTED), 0);
  assert.notEqual(targetOf(sim), 'guest');
  assert.equal(sim.doodle.debug.senses.crumbs.filter((c) => c.floorId === 'ground').length, 0, 'a down player leaves no trail');
});

test('releaseCatch: lets go, pauses, then hunts the other player down', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const host = makeCoop('host', 1, 0, 1); // in the hall, out of sight
  const guest = makeCoop('guest', 8.5, 0, 2.5);
  assert.ok(sim.run(4, [host, guest], () => sim.count(EVENTS.CAUGHT) > 0));
  assert.equal(sim.first(EVENTS.CAUGHT).payload.playerId, 'guest');

  sim.doodle.releaseCatch('guest');
  assert.equal(sim.doodle.state, 'search');
  // Knock-out: the guest spectates now. Even still standing there (not yet marked down) it's forgotten.
  const at = { ...sim.doodle.pos };
  const pause = sim.doodle.tuning.releasePause;
  sim.run(pause - 0.3, [host, guest]);
  assert.ok(d2(sim.doodle.pos, at) < 1e-6, 'stands still through the pause');
  assert.equal(sim.count(EVENTS.CAUGHT), 1, 'no catch during the pause, even with the guest in reach');
  assert.equal(sim.doodle.speed, 0);

  assert.ok(sim.run(60, [host, guest], () => sim.count(EVENTS.CAUGHT) > 1), 'got the host too');
  assert.deepEqual(sim.of(EVENTS.CAUGHT)[1].payload, { how: 'tackle', playerId: 'host' });
  assert.ok(sim.of(EVENTS.DOODLE_STATE).some((e) => e.payload.prev === 'search' && e.payload.state === 'investigate'), 'went looking for them');

  // A new day forgets the knock-out: the guest is fair game again.
  place(sim, 8.5, 6, 'ground', 0);
  sim.run(4, [guest], () => sim.count(EVENTS.CAUGHT) > 2);
  assert.equal(sim.of(EVENTS.CAUGHT)[2]?.payload.playerId, 'guest');
});

test('target hysteresis: two players unseen at nearly the same distance do not flip-flop', () => {
  const sim = setup();
  place(sim, 4, 4, 'ground', 0);
  const host = makeCoop('host', 2, 3, 2, 'upstairs');
  const guest = makeCoop('guest', 2, 3, 2, 'upstairs');
  let switches = 0;
  let last = null;
  for (let k = 0; k < 150; k++) {
    // Each frame a different one is half a meter nearer.
    const near = k % 2 ? host : guest;
    const far = k % 2 ? guest : host;
    near.moveTo(sim.doodle.pos.x + 3, 3, sim.doodle.pos.z, 'upstairs');
    far.moveTo(sim.doodle.pos.x + 3.5, 3, sim.doodle.pos.z, 'upstairs');
    sim.run(DT, [host, guest]);
    const t = targetOf(sim);
    if (last !== null && t !== last) switches++;
    last = t;
  }
  assert.equal(switches, 0, `${switches} switches in 5 s`);
});

test('two players in view: it stays on its target, and takes the other when the first vanishes', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const host = makeCoop('host', 8, 0, 2.5);
  const guest = makeCoop('guest', 9, 0, 2.5);
  sim.run(0.6, [host, guest], () => sim.doodle.state === 'chase');
  const first = targetOf(sim);
  const seen = new Set();
  sim.run(0.3, [host, guest], () => (seen.add(targetOf(sim)), false));
  assert.deepEqual([...seen], [first], 'no switching between two visible players');
  // The target ducks upstairs: it goes after the other one, still in plain sight.
  const gone = first === 'host' ? host : guest;
  gone.moveTo(2, 3, 2, 'upstairs');
  assert.ok(sim.run(0.5, [host, guest], () => targetOf(sim) !== first), 'switched to the one still in view');
  assert.ok(['chase', 'catch'].includes(sim.doodle.state));
  if (sim.count(EVENTS.CAUGHT)) assert.notEqual(sim.first(EVENTS.CAUGHT).payload.playerId, first);
});

test('hiding is per player: pulling out the guest leaves the hidden host alone', () => {
  const sim = setup();
  place(sim, 8.5, 4.5, 'ground', Math.PI); // facing +Z, watching the kitchen cabinet
  const host = makeCoop('host', 5.3, 3, 3.6, 'upstairs');
  host.hidden = true;
  host.hideSpotId = 'hideUnderBed';
  sim.bus.emit(EVENTS.HIDE, { spotId: 'hideUnderBed', pos: { x: 5.3, y: 3, z: 3.45 }, floorId: 'upstairs', playerId: 'host' });
  assert.equal(sim.doodle.state, 'patrol', 'the host hid unseen');

  const guest = makeCoop('guest', 9.2, 0, 6.5);
  sim.run(DT, [host, guest]);
  assert.equal(personOf(sim, 'guest').visible, true);
  guest.hidden = true;
  guest.hideSpotId = 'hideKitchenCabinet';
  // The guest's HIDE reaches the host's game as a replay.
  sim.bus.emit(EVENTS.HIDE, { spotId: 'hideKitchenCabinet', pos: { x: 9.2, y: 0, z: 7.0 }, floorId: 'ground', playerId: 'guest', remote: true });
  assert.equal(sim.doodle.state, 'chase');
  assert.equal(targetOf(sim), 'guest');
  assert.ok(sim.run(4, [host, guest], () => sim.count(EVENTS.CAUGHT) > 0));
  assert.deepEqual(sim.first(EVENTS.CAUGHT).payload, { how: 'pulledOut', playerId: 'guest' });
  assert.equal(personOf(sim, 'host').hidden, true, "the host's hide is untouched");

  // The guest's UNHIDE doesn't unhide the host either.
  sim.bus.emit(EVENTS.UNHIDE, { spotId: 'hideKitchenCabinet', playerId: 'guest', remote: true });
  sim.run(DT, [host, guest]);
  assert.equal(personOf(sim, 'guest').hidden, false);
  assert.equal(personOf(sim, 'host').hidden, true);
});

test("links are per player: the guest's tunnel doesn't end the chase on the host", () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  const host = makeCoop('host', 8.5, 0, 2.5);
  const guest = makeCoop('guest', 1, 0, 1);
  sim.run(1, [host, guest], () => sim.doodle.state === 'chase');
  assert.equal(targetOf(sim), 'host');
  sim.bus.emit(EVENTS.LINK_ENTER, { linkId: 'hallKitchenTunnel', kind: 'tunnel', playerId: 'guest', remote: true });
  assert.equal(sim.doodle.state, 'chase');
  sim.run(DT, [host, guest]);
  assert.equal(personOf(sim, 'guest').inLink, true);
  sim.bus.emit(EVENTS.LINK_ENTER, { linkId: 'hallKitchenTunnel', kind: 'tunnel', playerId: 'host' });
  assert.equal(sim.doodle.state, 'search', 'its own target going in still loses it');
});

test("the guest's replayed NOISE is heard like any other", () => {
  const sim = setup();
  sim.bus.emit(EVENTS.NOISE, { pos: { x: 3, y: 0, z: 4 }, floorId: 'ground', loudness: 6, kind: 'squeak', playerId: 'guest', remote: true });
  assert.equal(sim.doodle.state, 'investigate');
});

test('smell follows the fresher of the two trails', () => {
  // Both walk while it sleeps: the host early, then the guest later toward the hall corner.
  const sim = setup({ wakeDelay: 8 });
  sim.door('hallKitchen').setOpen(true);
  const host = makeCoop('host', 10.5, 0, 3);
  const guest = makeCoop('guest', 8, 0, 3);
  const walk = (p, trail, others) => {
    for (let k = 1; k < trail.length; k++) {
      const [ax, az] = trail[k - 1];
      const [bx, bz] = trail[k];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (3 * DT));
      for (let s = 1; s <= n; s++) {
        p.moveTo(ax + ((bx - ax) * s) / n, 0, az + ((bz - az) * s) / n);
        sim.run(DT, [p, ...others]);
      }
    }
  };
  walk(host, [[10.5, 3], [10.5, 6]], []);
  walk(guest, [[8, 3], [6.75, 4], [5.25, 4], [2, 2], [1, 1]], []);
  assert.equal(sim.doodle.state, 'sleep');
  let closest = Infinity;
  const done = sim.run(30, null, () => {
    if (sim.doodle.state === 'sniff') closest = Math.min(closest, Math.hypot(sim.doodle.pos.x - 1, sim.doodle.pos.z - 1));
    return closest < 1;
  });
  assert.ok(done, `followed the guest's fresher trail to within ${closest.toFixed(2)} m of its end`);
});

test('snapshot(): plain JSON with everything the puppet draws', () => {
  const sim = setup();
  place(sim, 8.5, 6, 'ground', 0);
  sim.run(1, makeCoop('host', 8.5, 0, 2.5), () => sim.doodle.state === 'chase');
  const snap = sim.doodle.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  for (const k of ['pos', 'yaw', 'pitch', 'pose', 'mood', 'carrying', 'speed', 'state', 'floorId'])
    assert.ok(k in snap, `snapshot has ${k}`);
  assert.equal(snap.state, 'chase');
  assert.equal(snap.mood, 'hunt');
  assert.equal(snap.floorId, 'ground');
});

test('puppet: emits nothing, mirrors state, and converges on the host Doodle at 10 Hz', () => {
  const host = setup();
  place(host, 8.5, 6, 'ground', 0);
  const player = makeCoop('host', 1, 0, 1);
  host.bus.emit(EVENTS.NOISE, { pos: { x: 1, y: 0, z: 1 }, floorId: 'ground', loudness: 20, kind: 'other' });

  // The guest's game: its own bus and world, where nothing but the puppet runs.
  const guest = setup();
  const puppet = createDoodlePuppet({ world: guest.world });
  puppet.reset(guest.world.anchors.kennel);
  puppet.setActive(true);
  const before = guest.events.length;

  let worst = 0;
  let sinceSnap = 1;
  for (let k = 0; k < 120; k++) {
    host.run(DT, player);
    if ((sinceSnap += DT) >= 0.1) {
      sinceSnap = 0;
      puppet.applySnapshot(JSON.parse(JSON.stringify(host.doodle.snapshot())));
      assert.equal(puppet.state, host.doodle.state);
      assert.equal(puppet.floorId, host.doodle.floorId);
      assert.equal(puppet.speed, Math.round(host.doodle.speed * 100) / 100);
    }
    puppet.update(DT);
    if (k > 10) worst = Math.max(worst, d2(puppet.pos, host.doodle.pos));
  }
  assert.ok(worst < 0.6, `trailed the host Doodle by at most ${worst.toFixed(2)} m`);
  // Let the host stop: the puppet settles right on it.
  host.doodle.setActive(false);
  puppet.applySnapshot(host.doodle.snapshot());
  puppet.update(0.1);
  puppet.applySnapshot(host.doodle.snapshot());
  for (let k = 0; k < 30; k++) puppet.update(DT);
  assert.ok(d2(puppet.pos, host.doodle.pos) < 0.01);
  assert.ok(Math.abs(puppet.yaw - host.doodle.yaw) < 0.01);
  assert.equal(guest.events.length, before, 'the puppet emitted nothing');
  assert.equal(puppet.pose, host.doodle.pose);
});

test('puppet: jumps across big gaps, ignores snapshots while inactive, and reset() sticks', () => {
  const { world } = setup();
  const puppet = createDoodlePuppet({ world });
  puppet.reset(world.anchors.kennel);
  puppet.setActive(true);
  const snap = (x, z, extra = {}) => ({ pos: { x, y: 0, z }, yaw: 1, pitch: 0, pose: 'run', mood: 'hunt', carrying: null, speed: 4, state: 'chase', floorId: 'ground', ...extra });

  puppet.applySnapshot(snap(8, 3));
  puppet.update(DT);
  assert.ok(d2(puppet.pos, { x: 8, z: 3 }) < 1e-6, 'the first snapshot is a jump');
  puppet.applySnapshot(snap(8, 3.4));
  puppet.update(DT);
  const glide = d2(puppet.pos, { x: 8, z: 3.4 });
  assert.ok(glide > 0.05 && glide < 0.4, `a small step glides (${glide.toFixed(2)} m to go)`);
  puppet.applySnapshot(snap(2, 2));
  puppet.update(DT);
  assert.ok(d2(puppet.pos, { x: 2, z: 2 }) < 1e-6, 'a gap over 3 m is a jump');
  assert.equal(puppet.pose, 'run');
  assert.equal(puppet.mood, 'hunt');

  // A cutscene owns the model: snapshots no longer move it.
  puppet.setActive(false);
  const held = { ...puppet.pos };
  puppet.applySnapshot(snap(3, 2, { state: 'catch', pose: 'pounce' }));
  for (let k = 0; k < 10; k++) puppet.update(DT);
  assert.deepEqual(puppet.pos, held);
  assert.equal(puppet.speed, 0);
  puppet.setActive(true);
  assert.equal(puppet.state, 'catch', 'back on, it mirrors the latest snapshot');
  puppet.update(DT);
  assert.ok(d2(puppet.pos, { x: 3, z: 2 }) < 1e-6);

  // Next day: asleep in the kennel until the host says otherwise.
  puppet.reset(world.anchors.kennel);
  for (let k = 0; k < 10; k++) puppet.update(DT);
  assert.ok(d2(puppet.pos, world.anchors.kennel.pos) < 1e-6);
  assert.equal(puppet.state, 'sleep');
  assert.equal(puppet.pose, 'sleep');
  const b = puppet.bounds();
  assert.ok(b.radius > 0 && Number.isFinite(b.center.y));
});
