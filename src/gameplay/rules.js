// The game rules, without any rendering: what a look-target says, what a click
// on it does, and everything that follows (items, locks, escapes, traps,
// treats, the ball, darts). Pure logic over the plain World objects, so the
// tests drive whole escapes on the mini-house fixture.
//
// A target is the userData.interact tag of whatever the player looks at:
// {kind, id} from World (door, container, hide, linkEntry, fuseBox, jeep,
// opener, keypad, piano) or from Gameplay's own meshes (item, lock). Keypad
// dials are {kind: 'lock', id: 'keypad', dial: 0..3}.
//
// interact()/useHeld() return null, {message} (a one-off prompt), or
// {action, ...} for the 3D layer to act on: 'hide', 'link', 'throw', 'treat',
// 'fire', 'escaped', plus cosmetic ones ('pickup', 'lock', 'dial', ...).
//
// Every rule acts for a player: the `player` argument's `id` ('host' solo) picks
// the hand. Co-op (docs/CONTRACTS.md, "Co-op"): the host runs everything here,
// for both bodies, and snapshot() is the shared state as plain JSON. A guest's
// rules build the same run from the same seed, never change shared state
// themselves, and follow the host through applySnapshot().

import { ITEMS, LOCKS, ROUTES, PLAYER_BODY } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { clamp, copy, dist2D } from '../core/math.js';
import { circleHitsAny, overlappingY, pushOut } from '../player/movement.js';
import { tuningFor } from './tuning.js';
import { BALL_RADIUS, createBall, stepBall } from './ball.js';
import { createItems, itemName, pickSpawns } from './items.js';
import { assignDigits, createKeypad, DIAL_COLORS, generateCode } from './keypad.js';
import { createLocks, LOCK_NAMES, LOCK_NEEDS, listWords } from './locks.js';
import { createTrapTriggers, placeTraps, TRAP_NOISE } from './traps.js';

const HIDE_TEXT = {
  ballpit: 'hide in the ball pit',
  chest: 'hide in the toy chest',
  fort: 'hide in the blanket fort',
  underbed: 'hide under the bed',
  wardrobe: 'hide in the wardrobe',
  cabinet: 'hide in the cabinet',
};

export const SNAPSHOT_VERSION = 1;
const OCCUPIED = "Someone's already hiding here";
const r3 = (v) => Math.round(v * 1000) / 1000 || 0; // || 0: no -0, which JSON can't carry
const packV = (p) => [r3(p.x), r3(p.y), r3(p.z)];
const unpackV = (a) => ({ x: a[0], y: a[1], z: a[2] });

/**
 * Where a player wakes each day: the host (and a solo player) in startBed; a co-op guest in
 * startBed2, or, if World has none, standing beside startBed (to its right, nudged clear of walls).
 */
export function wakeSpot(world, playerId = 'host') {
  const { startBed, startBed2 } = world.anchors;
  if (playerId !== 'guest') return startBed;
  if (startBed2) return startBed2;
  const rot = startBed.rotY ?? 0;
  const want = { x: startBed.pos.x + Math.cos(rot) * 0.7, z: startBed.pos.z - Math.sin(rot) * 0.7 };
  const boxes = overlappingY(world.colliders(startBed.floorId), startBed.pos.y, PLAYER_BODY.height);
  const free = pushOut(want, PLAYER_BODY.radius, boxes);
  const g = world.heightAt(free.x, free.z, startBed.floorId);
  return { ...startBed, id: `${startBed.id}.guest`, pos: { x: free.x, y: g.y, z: free.z }, floorId: g.floorId };
}

/**
 * @param {{world: Object, bus: Object, rng: Object, difficulty?: string, tuning?: Object, coop?: {role: 'host'|'guest', rule?: string}|null}} opts
 */
export function createRules({ world, bus, rng, difficulty = 'normal', tuning = tuningFor(difficulty), coop = null }) {
  const { anchors } = world;
  const localId = coop?.role === 'guest' ? 'guest' : 'host';
  const isGuest = localId === 'guest';
  /**
   * Payload fields naming the player an event is about, plus `at` (where it happened, e.g.
   * {pos, floorId}) so the partner's game can place the sound. None for a solo run's player.
   */
  const who = (pid = localId, at = null) => (coop || pid !== localId ? { playerId: pid, ...at } : {});
  const pidOf = (player) => player?.id ?? localId;

  const items = createItems({ bus, tuning, placements: pickSpawns(world, rng.fork('spawns'), tuning.items), localId, tagAll: !!coop });
  const code = generateCode(rng.fork('keypad'));
  const keypad = createKeypad(code);
  const drawings = assignDigits(anchors.drawings, code, rng.fork('drawings'));
  const locks = createLocks({ world, bus, tuning, who: (pid, at) => who(pid ?? localId, at) });
  const traps = placeTraps(anchors.traps, rng.fork('traps'), tuning);
  const triggers = createTrapTriggers(traps.all, tuning);
  /** treatId → {treatId, pos, floorId}: dropped and not eaten yet */
  const treats = new Map();
  let treatCount = 0;
  let ballId = null; // the last ball thrown: the one Doodle fetches
  let ballNoisy = false; // has this throw made its landing noise yet?
  let ballBy = localId; // who threw it: its bounces and landing are their sounds
  /** Every body in play (set by the 3D layer): who's hiding where. */
  let bodies = () => [];

  const doorById = (id) => world.doors.find((d) => d.id === id);
  const containerById = (id) => world.containers.find((c) => c.id === id);
  const hideById = (id) => anchors.hideSpots.find((h) => h.id === id);
  const linkById = (id) => world.nav.links.find((l) => l.id === id);
  const heldId = (player) => items.heldItemId(pidOf(player));
  const holding = (itemId, player) => heldId(player) === itemId;
  const containerOpen = (id) => !id || containerById(id)?.isOpen === true;
  const canPickUp = (inst) => !!inst && inst.where === 'world' && containerOpen(inst.containerId);
  const isFrontDoor = (id) => id === anchors.frontDoor.doorId;
  const isGarageDoor = (id) => id === anchors.garage.doorId;
  const isChest = (id) => id === anchors.atticChest.containerId;
  const say = (message) => (message ? { message } : null);
  /** Is someone other than `player` hiding in this spot? */
  const hideTaken = (spotId, player) => bodies().some((b) => b && pidOf(b) !== pidOf(player) && b.hidden && b.hideSpotId === spotId);

  /** Is the player's link travel reversed (entering at the link's `to` end)? */
  function linkReversed(link, pos) {
    const a = link.points[0];
    const b = link.points[link.points.length - 1];
    return dist2D(pos, b) + Math.abs(pos.y - b.y) < dist2D(pos, a) + Math.abs(pos.y - a.y);
  }

  function bodyInDoorway(door, player) {
    const boxes = overlappingY([door.collider], player.pos.y, PLAYER_BODY.height);
    return circleHitsAny(player.pos.x, player.pos.z, PLAYER_BODY.radius, boxes);
  }

  // ---- prompts ---------------------------------------------------------------

  function describeLock(target, player) {
    if (target.id === LOCKS.KEYPAD) {
      if (locks.isOpen(LOCKS.KEYPAD)) return 'Keypad: unlocked';
      const color = DIAL_COLORS[target.dial]?.name ?? 'colored';
      return `Click: turn the ${color} dial · Right click: back`;
    }
    if (locks.isOpen(target.id)) return null;
    const needs = LOCK_NEEDS[target.id];
    if (target.id === LOCKS.PLANK) return holding(needs, player) ? 'Click: pull off the plank' : `Nailed shut: needs the ${itemName(needs)}`;
    if (target.id === LOCKS.PADLOCK) return holding(needs, player) ? 'Click: unlock the padlock' : `Locked: needs the ${itemName(needs)}`;
    return needs ? `Locked: needs the ${itemName(needs)}` : 'Locked';
  }

  function describeDoor(d) {
    if (!d) return null;
    if (isFrontDoor(d.id)) {
      if (!d.locked) return 'Click: open the front door and escape!';
      const left = locks.remaining(ROUTES.FRONT_DOOR).map((l) => LOCK_NAMES[l]);
      return left.length ? `Locked: ${listWords(left)}` : 'Locked';
    }
    if (isGarageDoor(d.id)) {
      if (d.locked) return locks.garagePowered() ? 'Locked: press the garage door opener' : 'Locked: the garage door opener has no power';
      return d.isOpen ? 'Click: close the garage door' : 'Click: open the garage door';
    }
    if (d.locked) return 'Locked';
    return d.isOpen ? 'Click: close the door' : 'Click: open the door';
  }

  function describeContainer(c, player) {
    if (!c) return null;
    const noun = isChest(c.id) ? 'toy chest' : c.kind;
    if (c.locked) {
      if (isChest(c.id)) return holding(LOCK_NEEDS[LOCKS.ATTIC_CHEST], player) ? 'Click: unlock the toy chest' : `Locked: needs the ${itemName(ITEMS.TOY_CHEST_KEY)}`;
      return 'Locked';
    }
    return c.isOpen ? `Click: close the ${noun}` : `Click: open the ${noun}`;
  }

  function describeJeep(player) {
    const needKey = !locks.isOpen(LOCKS.JEEP_KEY);
    const needBattery = !locks.isOpen(LOCKS.JEEP_BATTERY);
    if (!needKey && !needBattery) return 'Click: start the Jeep';
    if (needKey && holding(ITEMS.JEEP_KEY, player)) return 'Click: put in the Jeep Key';
    if (needBattery && holding(ITEMS.CAR_BATTERY, player)) return 'Click: put in the Car Battery';
    const missing = [needKey && itemName(ITEMS.JEEP_KEY), needBattery && itemName(ITEMS.CAR_BATTERY)].filter(Boolean);
    return `Jeep: needs the ${listWords(missing)}`;
  }

  /** The prompt for a look target, or null. `player` needs pos and crouched (and id in co-op). */
  function describe(target, player) {
    if (!target) return null;
    const { kind, id } = target;
    switch (kind) {
      case 'item': {
        const inst = items.get(id);
        if (!canPickUp(inst)) return null;
        const name = itemName(inst.itemId);
        if (inst.itemId === ITEMS.DART && holding(ITEMS.LAUNCHER, player)) return `Click: load the ${name}`;
        if (inst.itemId === ITEMS.TREATS) return `Click: pick up ${name} (${inst.uses} left)`;
        if (inst.itemId === ITEMS.LAUNCHER) return `Click: pick up ${name} (${inst.uses} shots)`;
        return `Click: pick up ${name}`;
      }
      case 'lock':
        return describeLock(target, player);
      case 'keypad':
        return locks.isOpen(LOCKS.KEYPAD) ? 'Keypad: unlocked' : 'Keypad: turn the colored dials to the code';
      case 'door':
        return describeDoor(doorById(id));
      case 'container':
        return describeContainer(containerById(id), player);
      case 'hide': {
        const h = hideById(id);
        if (!h) return null;
        return hideTaken(id, player) ? OCCUPIED : `Click: ${HIDE_TEXT[h.kind] ?? 'hide'}`;
      }
      case 'linkEntry': {
        const link = linkById(id);
        if (!link) return null;
        if (link.kind === 'slide') return link.oneWay && linkReversed(link, player.pos) ? "You can't climb up the slide" : 'Click: go down the slide';
        if (link.crawl) return player.crouched ? 'Click: crawl through the tunnel' : 'Crouch (C) to crawl into the tunnel';
        return 'Click: go through';
      }
      case 'fuseBox':
        if (locks.garagePowered()) return 'Fuse box: the power is on';
        return holding(ITEMS.FUSE, player) ? 'Click: put in the Fuse' : `Fuse box: needs a ${itemName(ITEMS.FUSE)}`;
      case 'opener': {
        if (!locks.garagePowered()) return 'No power: the fuse box needs a Fuse';
        return locks.garageDoor()?.isOpen ? 'Click: close the garage door' : 'Click: open the garage door';
      }
      case 'jeep':
        return describeJeep(player);
      case 'piano':
        return 'Click: play the piano';
      default:
        return null;
    }
  }

  // ---- actions ---------------------------------------------------------------

  /** Use the held item on a lock; the item is used up if it fits. */
  function useItemOn(lockId, player) {
    const result = locks.tryItem(lockId, heldId(player), pidOf(player));
    if (result === 'opened') items.consumeHeld(pidOf(player));
    return result;
  }

  function interactLock(target, dir, player) {
    if (target.id === LOCKS.KEYPAD) {
      if (locks.isOpen(LOCKS.KEYPAD) || target.dial == null || !(target.dial >= 0 && target.dial < keypad.digits.length)) return null;
      const digit = keypad.roll(target.dial, dir);
      bus.emit(EVENTS.KEYPAD_ROLLED, { index: target.dial, digit, pos: copy(anchors.frontDoor.keypad.pos), ...who(pidOf(player)) });
      if (keypad.matches()) locks.solveKeypad(pidOf(player));
      return { action: 'dial', dial: target.dial };
    }
    if (locks.isOpen(target.id)) return null;
    if (useItemOn(target.id, player) === 'opened') return { action: 'lock', lockId: target.id };
    return say(describeLock(target, player));
  }

  function interactDoor(d, player) {
    if (!d) return null;
    if (isFrontDoor(d.id)) {
      if (locks.openFrontDoor(pidOf(player)) === 'escaped') return { action: 'escaped', route: ROUTES.FRONT_DOOR };
      return say(describeDoor(d));
    }
    if (d.locked) return say(describeDoor(d));
    if (d.isOpen && bodies().concat(player).some((b) => b && !b.hidden && !b.down && bodyInDoorway(d, b)))
      return say(pidOf(player) === localId || bodyInDoorway(d, player) ? 'Step out of the doorway first' : 'Someone is in the doorway');
    d.setOpen(!d.isOpen, 'player');
    return { action: 'door', open: d.isOpen };
  }

  function interactContainer(c, player) {
    if (!c) return null;
    if (c.locked) {
      if (isChest(c.id) && useItemOn(LOCKS.ATTIC_CHEST, player) === 'opened') return { action: 'lock', lockId: LOCKS.ATTIC_CHEST };
      return say(describeContainer(c, player));
    }
    c.setOpen(!c.isOpen);
    return { action: 'container', open: c.isOpen };
  }

  function interactJeep(player) {
    if (!locks.isOpen(LOCKS.JEEP_KEY) && holding(ITEMS.JEEP_KEY, player)) {
      useItemOn(LOCKS.JEEP_KEY, player);
      return { action: 'lock', lockId: LOCKS.JEEP_KEY };
    }
    if (!locks.isOpen(LOCKS.JEEP_BATTERY) && holding(ITEMS.CAR_BATTERY, player)) {
      useItemOn(LOCKS.JEEP_BATTERY, player);
      return { action: 'lock', lockId: LOCKS.JEEP_BATTERY };
    }
    const result = locks.startJeep(pidOf(player));
    if (result === 'escaped') return { action: 'escaped', route: ROUTES.GARAGE };
    if (result === 'doorClosed') return { action: 'jeep', message: 'Vroom! But the garage door is closed!' };
    return say(describeJeep(player));
  }

  /** Left click / E on a target. `player` needs pos, floorId and crouched (and id in co-op). */
  function interact(target, player) {
    if (!target) return null;
    const { kind, id } = target;
    switch (kind) {
      case 'item': {
        const inst = items.get(id);
        if (!canPickUp(inst)) return null;
        const result = items.pickUp(id, pidOf(player));
        return result.ok ? { action: 'pickup', itemId: inst.itemId, ...result } : null;
      }
      case 'lock':
        return interactLock(target, 1, player);
      case 'keypad':
        return say(describe(target, player));
      case 'door':
        return interactDoor(doorById(id), player);
      case 'container':
        return interactContainer(containerById(id), player);
      case 'hide': {
        const spot = hideById(id);
        if (!spot) return null;
        return hideTaken(id, player) ? say(OCCUPIED) : { action: 'hide', spot };
      }
      case 'linkEntry': {
        const link = linkById(id);
        if (!link) return null;
        const reverse = linkReversed(link, player.pos);
        if (reverse && link.oneWay) return say("You can't climb up the slide");
        if (link.crawl && !player.crouched) return say('Crouch (C) to crawl into the tunnel');
        return { action: 'link', link, reverse };
      }
      case 'fuseBox':
        if (!locks.garagePowered() && useItemOn(LOCKS.FUSE_BOX, player) === 'opened') return { action: 'lock', lockId: LOCKS.FUSE_BOX };
        return say(describe(target, player));
      case 'opener': {
        const result = locks.pressOpener();
        if (result === 'noPower') return say(describe(target, player));
        if (result === 'blocked') return say("It won't budge");
        return { action: 'opener', result };
      }
      case 'jeep':
        return interactJeep(player);
      case 'piano': {
        const spot = anchors.traps.find((t) => t.id === id) ?? { kind: 'piano', pos: copy(player.pos), floorId: player.floorId };
        emitTrap(spot, tuning.noise.piano, pidOf(player));
        return { action: 'piano', spot };
      }
      default:
        return null;
    }
  }

  /** Would a click on this target use the held item on it? */
  function acceptsHeld(target, player) {
    const h = heldId(player);
    if (!h || !target) return false;
    switch (target.kind) {
      case 'lock':
        return LOCK_NEEDS[target.id] === h && !locks.isOpen(target.id);
      case 'fuseBox':
        return h === ITEMS.FUSE && !locks.garagePowered();
      case 'jeep':
        return (h === ITEMS.JEEP_KEY && !locks.isOpen(LOCKS.JEEP_KEY)) || (h === ITEMS.CAR_BATTERY && !locks.isOpen(LOCKS.JEEP_BATTERY));
      case 'container':
        return isChest(target.id) && h === ITEMS.TOY_CHEST_KEY && containerById(target.id)?.locked === true;
      default:
        return false;
    }
  }

  /** Right click: the held item on the target if it fits, else the item's own use. */
  function useHeld(target, player) {
    if (target?.kind === 'lock' && target.id === LOCKS.KEYPAD) return interactLock(target, -1, player);
    if (acceptsHeld(target, player)) return interact(target, player);
    const h = items.held(pidOf(player));
    if (!h) return null;
    switch (h.itemId) {
      case ITEMS.TENNIS_BALL:
        return { action: 'throw' };
      case ITEMS.TREATS:
        return { action: 'treat' };
      case ITEMS.LAUNCHER:
        return h.uses > 0 ? { action: 'fire' } : say('Out of darts: find a Squeaky Dart');
      case ITEMS.DART:
        return say('Load it into the Squeaky-toy Launcher');
      default:
        return null;
    }
  }

  /**
   * Would this click or right click change shared state? A co-op guest sends those to the host as
   * intents, and runs the rest (hiding, links, one-off messages) itself. Asks without acting.
   */
  function needsHost(kind, target, player) {
    if (kind === 'drop') return !!items.held(pidOf(player));
    if (kind === 'primary') return !!target && !['hide', 'linkEntry', 'keypad'].includes(target.kind);
    if (target?.kind === 'lock' && target.id === LOCKS.KEYPAD) return true;
    if (acceptsHeld(target, player)) return true;
    const h = items.held(pidOf(player));
    return h?.itemId === ITEMS.TENNIS_BALL || h?.itemId === ITEMS.TREATS || (h?.itemId === ITEMS.LAUNCHER && h.uses > 0);
  }

  // ---- defenses --------------------------------------------------------------

  /** G: drop the held item (makes noise). */
  const drop = (pos, floorId, pid = localId) => items.drop(pos, floorId, { pid });

  function dropTreat(pos, floorId, pid = localId) {
    if (isGuest || items.heldItemId(pid) !== ITEMS.TREATS) return null;
    const treatId = `treat${++treatCount}`;
    treats.set(treatId, { treatId, pos: copy(pos), floorId });
    items.spendCharge(pid);
    bus.emit(EVENTS.TREAT_DROPPED, { treatId, pos: copy(pos), floorId, ...who(pid) });
    return treatId;
  }

  // Darts in the air, until they hit Doodle or reach the end of their range. A miss lands as a
  // dart you can pick up again; only the host makes that item, so its id is the same for both.
  const darts = [];
  let dartCount = 0;
  let firing = null; // the dart whose DART_FIRED is going out: Doodle may answer DOODLE_HIT inside it
  /** Darts a guest has seen land: a late snapshot mustn't bring them back. */
  const landedDarts = new Set();

  function fireDart(origin, dir, range, floorId, pid = localId) {
    if (isGuest) return false;
    const h = items.held(pid);
    if (h?.itemId !== ITEMS.LAUNCHER || !(h.uses > 0)) return false;
    items.spendCharge(pid);
    // The visible dart leaves a little ahead of and below the eye.
    const o = { x: origin.x + dir.x * 0.3, y: origin.y + dir.y * 0.3 - 0.04, z: origin.z + dir.z * 0.3 };
    const dart = { id: `dart${++dartCount}`, origin: o, dir: copy(dir), range: Math.max(0.3, range - 0.3), traveled: 0, floorId, stopAt: null, hit: false };
    darts.push(dart);
    firing = dart;
    bus.emit(EVENTS.DART_FIRED, { origin: copy(origin), dir: copy(dir), range, ...who(pid, { pos: copy(origin), floorId }) });
    firing = null;
    if (tuning.noise.dart > 0) bus.emit(EVENTS.NOISE, { pos: copy(origin), floorId, loudness: tuning.noise.dart, kind: 'dart', ...who(pid) });
    return true;
  }

  function dartHit(payload = {}) {
    if (payload.remote || isGuest) return;
    const d = firing ?? [...darts].reverse().find((x) => x.stopAt === null);
    if (!d) return;
    // If Doodle says where, stop there; otherwise just short of where the dart is now.
    d.stopAt = typeof payload.dist === 'number' ? payload.dist
      : payload.pos ? Math.hypot(payload.pos.x - d.origin.x, payload.pos.y - d.origin.y, payload.pos.z - d.origin.z)
      : d.traveled + 0.6;
    d.hit = true;
  }

  const dartEnd = (d) => Math.min(d.range, d.stopAt ?? Infinity);

  function updateDarts(dt) {
    for (let k = darts.length - 1; k >= 0; k--) {
      const d = darts[k];
      d.traveled += tuning.dart.speed * dt;
      const end = dartEnd(d);
      if (d.traveled < end) continue;
      darts.splice(k, 1);
      if (isGuest) {
        landedDarts.add(d.id);
        continue;
      }
      if (d.hit) continue;
      const back = Math.max(0, end - 0.15);
      const x = d.origin.x + d.dir.x * back;
      const z = d.origin.z + d.dir.z * back;
      const g = world.heightAt(x, z, d.floorId);
      items.spawn(ITEMS.DART, { x, y: g.y, z }, g.floorId, { rotY: Math.atan2(-d.dir.x, -d.dir.z) });
    }
  }

  // The tennis ball. throwBall() with a flight simulates it here (host); without one, the caller
  // reports ballImpact/ballLanded itself.
  const flights = [];
  const floorY = Object.fromEntries(world.floors.map((f) => [f.id, f.y]));
  const ballEnv = {
    boxes: (floorId) => world.colliders(floorId),
    heightAt: world.heightAt,
    floorY: (id) => floorY[id] ?? 0,
  };

  /** The ball leaves your hand. `flight` {origin, vel} starts the physics here. */
  function throwBall(pos, floorId, pid = localId, flight = null) {
    if (isGuest || items.heldItemId(pid) !== ITEMS.TENNIS_BALL) return null;
    const inst = items.release('flying', pid);
    ballId = inst.id;
    ballNoisy = false;
    ballBy = pid;
    if (flight) {
      const ball = createBall(flight.origin, flight.vel, floorId);
      inst.pos = { x: ball.pos.x, y: ball.pos.y - BALL_RADIUS, z: ball.pos.z };
      inst.floorId = floorId;
      flights.push({ inst, ball });
    }
    bus.emit(EVENTS.BALL_THROWN, { pos: copy(pos), floorId, ...who(pid) });
    return inst;
  }

  /** A bounce. The first one is loud enough to draw Doodle; later ones are small. */
  function ballImpact(pos, floorId, speed) {
    if (speed < 1.2) return;
    const loudness = ballNoisy ? tuning.noise.ball * clamp(speed / 8, 0.15, 0.6) : tuning.noise.ball;
    ballNoisy = true;
    bus.emit(EVENTS.NOISE, { pos: copy(pos), floorId, loudness, kind: 'ball', ...who(ballBy) });
  }

  /** The ball came to rest: Doodle goes to fetch it from here. */
  function ballLanded(inst, pos, floorId) {
    if (inst.where !== 'flying') return;
    if (!ballNoisy) ballImpact(pos, floorId, 99);
    items.place(inst, pos, floorId);
    bus.emit(EVENTS.BALL_LANDED, { pos: copy(pos), floorId, ...who(ballBy) });
  }

  function updateFlights(dt) {
    for (let k = flights.length - 1; k >= 0; k--) {
      const { inst, ball } = flights[k];
      if (inst.where !== 'flying') {
        flights.splice(k, 1); // fetched in mid-air, or a new day
        continue;
      }
      const impacts = stepBall(ball, dt, ballEnv, tuning.ball);
      if (impacts.length) ballImpact(impacts[0].pos, ball.floorId, impacts[0].speed);
      const rest = { x: ball.pos.x, y: ball.pos.y - BALL_RADIUS, z: ball.pos.z };
      inst.pos = rest;
      inst.floorId = ball.floorId;
      items.touch();
      if (ball.resting) {
        flights.splice(k, 1);
        ballLanded(inst, rest, ball.floorId);
      }
    }
  }

  const ballInstance = () => items.get(ballId) ?? items.list().find((i) => i.itemId === ITEMS.TENNIS_BALL && i.where === 'world');

  /**
   * Carry out a 'throw', 'treat' or 'fire' result for a body: {pos, floorId, eye, dir} plus
   * `treat` (the floor spot ahead, {pos, floorId}) and `range` (the dart's reach to the first wall).
   * @returns {boolean} whether it happened
   */
  function perform(action, body, pid = localId) {
    switch (action) {
      case 'throw': {
        const { eye, dir } = body;
        const s = tuning.ball.throwSpeed;
        const origin = { x: eye.x + dir.x * 0.2, y: eye.y - 0.08 + dir.y * 0.2, z: eye.z + dir.z * 0.2 };
        const vel = { x: dir.x * s, y: dir.y * s + tuning.ball.lift, z: dir.z * s };
        return !!throwBall(copy(body.pos), body.floorId, pid, { origin, vel });
      }
      case 'treat':
        return !!body.treat && !!dropTreat(body.treat.pos, body.treat.floorId, pid);
      case 'fire':
        return fireDart(body.eye, body.dir, body.range ?? tuning.dart.range, body.floorId, pid);
      default:
        return false;
    }
  }

  // Bus reactions are the host's: a guest gets their outcome in the next snapshot, and nobody
  // acts on a replay from the partner's game.
  if (!isGuest) {
    bus.on(EVENTS.BALL_FETCHED, (p) => {
      if (p?.remote) return;
      const inst = ballInstance();
      if (inst && (inst.where === 'world' || inst.where === 'flying')) items.place(inst, inst.pos, inst.floorId, { where: 'doodle' });
    });
    bus.on(EVENTS.BALL_RETURNED, (p) => {
      if (p?.remote) return;
      const inst = items.list().find((i) => i.itemId === ITEMS.TENNIS_BALL && i.where === 'doodle') ?? ballInstance();
      if (inst && inst.where !== 'held' && inst.where !== 'gone') items.place(inst, p.pos, p.floorId);
    });
    bus.on(EVENTS.TREAT_EATEN, (p) => {
      if (!p?.remote) treats.delete(p?.treatId);
    });
    bus.on(EVENTS.DOODLE_HIT, dartHit);
  }

  // ---- traps -----------------------------------------------------------------

  function emitTrap(spot, loudness, pid = localId) {
    bus.emit(EVENTS.TRAP, { kind: spot.kind, pos: copy(spot.pos), floorId: spot.floorId, ...who(pid) });
    if (loudness > 0) bus.emit(EVENTS.NOISE, { pos: copy(spot.pos), floorId: spot.floorId, loudness, kind: TRAP_NOISE[spot.kind] ?? 'other', ...who(pid) });
  }

  /** Every frame a player is on foot: fire any trap they stepped on (host: for either body). */
  function updateTraps(player) {
    if (isGuest || player.hidden || player.down) return [];
    const pid = pidOf(player);
    const fired = triggers.update(player.pos, player.floorId, { crouched: player.crouched, playerId: pid });
    for (const { spot, loudness } of fired) emitTrap(spot, loudness, pid);
    return fired;
  }

  // ---- escapes on foot -------------------------------------------------------

  /** Walking out through the open front door, whoever opened it. Host only. */
  function walkOut(player) {
    if (isGuest || player.hidden || player.down) return false;
    const door = locks.frontDoor();
    if (!door?.isOpen || player.floorId !== door.floorId) return false;
    const exit = anchors.frontDoor.exit.pos;
    return dist2D(player.pos, exit) < dist2D(door.pos, exit) - 0.3 && locks.escape(ROUTES.FRONT_DOOR, pidOf(player));
  }

  // ---- day flow --------------------------------------------------------------

  /**
   * Re-arm traps (except under a waking player: the host's startBed plus `others`, each
   * {pos, floorId, playerId}); a ball Doodle was still carrying turns up on its bed.
   */
  function startDay(others = []) {
    const bed = anchors.startBed;
    triggers.rearm(bed.pos, bed.floorId, others);
    flights.length = 0;
    if (!isGuest)
      for (const inst of items.list())
        if (inst.itemId === ITEMS.TENNIS_BALL && (inst.where === 'doodle' || inst.where === 'flying'))
          items.place(inst, anchors.kennelBed.pos, anchors.kennelBed.floorId);
    items.emitHeld();
  }

  /** Caught (or knocked out): the held item falls where they were (no extra noise). Host only. */
  function onCaught(feetPos, floorId, pid = localId) {
    if (isGuest) return null;
    return items.drop(feetPos, floorId, { noise: false, pid });
  }

  function openAll() {
    if (isGuest) return;
    keypad.set(code);
    locks.openAll();
  }

  /** Per frame: the ball and darts in flight (a guest only moves its copies of the darts). */
  function update(dt) {
    if (!isGuest) updateFlights(dt);
    updateDarts(dt);
  }

  // ---- co-op: snapshots and intents ------------------------------------------------

  /** playerId → {n, say}: the last intent run for that player, and its one-off message. */
  const answers = {};

  /**
   * Run a guest's action here, the host, with the same rules (see README: intent format).
   * `proxy` is the host's copy of that player (gameplay.remote): a down player can't act.
   * @returns the rules result, or null
   */
  function applyIntent(pid, intent, proxy = null) {
    if (isGuest || pid === localId || !intent || typeof intent !== 'object') return null;
    const n = Number(intent.n) || 0;
    const last = answers[pid]?.n ?? 0;
    if (n && n <= last) return null; // already run: a resend
    answers[pid] = { n: n || last, say: null };
    if (proxy?.down) return null;
    const b = intent.body ?? {};
    const player = {
      id: pid,
      pos: b.pos ? copy(b.pos) : copy(proxy?.pos ?? anchors.startBed.pos),
      floorId: b.floorId ?? proxy?.floorId ?? anchors.startBed.floorId,
      crouched: !!(b.crouched ?? proxy?.crouched),
      hidden: false,
      hideSpotId: null,
    };
    let result = null;
    switch (intent.kind) {
      case 'primary':
        result = interact(intent.target, player);
        break;
      case 'secondary':
        result = useHeld(intent.target, player);
        break;
      case 'drop':
        if (b.drop) result = drop(b.drop.pos, b.drop.floorId, pid) ? { action: 'drop' } : null;
        break;
    }
    if (result && ['throw', 'treat', 'fire'].includes(result.action) && b.eye && b.dir) perform(result.action, { ...b, pos: player.pos, floorId: player.floorId }, pid);
    if (result?.message) answers[pid].say = result.message;
    return result;
  }

  /** Every shared thing, as compact plain JSON. Both peers build the same one from the same seed. */
  function snapshot() {
    const hands = items.hands();
    return {
      v: SNAPSHOT_VERSION,
      items: items.list().map((i) => ({
        id: i.id, i: i.itemId, w: i.where, p: packV(i.pos), f: i.floorId, c: i.containerId ?? null, r: r3(i.rotY ?? 0), u: i.uses ?? null,
      })),
      hands: { host: hands.host ?? null, guest: hands.guest ?? null },
      locks: locks.save(),
      keypad: keypad.entered(),
      treats: [...treats.values()].map((t) => ({ id: t.treatId, p: packV(t.pos), f: t.floorId })),
      ball: ballId,
      darts: darts.map((d) => ({ id: d.id, o: packV(d.origin), d: packV(d.dir), e: r3(Math.min(dartEnd(d), 1e3)), h: d.hit ? 1 : 0, f: d.floorId })),
      toppled: triggers.toppled(),
      doors: world.doors.map((d) => [d.id, d.isOpen ? 1 : 0, d.locked ? 1 : 0]),
      boxes: world.containers.map((c) => [c.id, c.isOpen ? 1 : 0, c.locked ? 1 : 0]),
      acks: Object.fromEntries(Object.entries(answers).map(([pid, a]) => [pid, [a.n, a.say]])),
    };
  }

  /**
   * Guest: become the host's snapshot. Idempotent and silent (doors and containers change with
   * by 'remote' and {silent: true}); HELD goes out when the local hand changed.
   * @returns {boolean} whether anything changed
   */
  function applySnapshot(snap) {
    if (!snap || typeof snap !== 'object' || snap.v !== SNAPSHOT_VERSION) return false;
    let changed = false;
    // Doors and containers first: what's open decides what the item view shows.
    const sync = (list, byId) => {
      for (const [id, open, locked] of list ?? []) {
        const o = byId(id);
        if (!o) continue;
        if (o.locked !== !!locked) {
          o.setLocked(!!locked);
          changed = true;
        }
        if (o.isOpen !== !!open) {
          o.setOpen(!!open, 'remote', { silent: true });
          changed = true;
        }
      }
    };
    sync(snap.doors, doorById);
    sync(snap.boxes, containerById);
    const list = (snap.items ?? []).map((s) => ({
      id: s.id, itemId: s.i, where: s.w, pos: unpackV(s.p), floorId: s.f, containerId: s.c ?? null, rotY: s.r ?? 0, uses: s.u ?? null,
    }));
    if (items.mirror(list, snap.hands ?? {})) changed = true;
    if (snap.locks && locks.load(snap.locks)) changed = true;
    if (typeof snap.keypad === 'string' && snap.keypad !== keypad.entered()) {
      keypad.set(snap.keypad);
      changed = true;
    }
    const treatIds = new Set();
    for (const t of snap.treats ?? []) {
      treatIds.add(t.id);
      if (treats.has(t.id)) continue;
      treats.set(t.id, { treatId: t.id, pos: unpackV(t.p), floorId: t.f });
      changed = true;
    }
    for (const id of [...treats.keys()])
      if (!treatIds.has(id)) {
        treats.delete(id);
        changed = true;
      }
    if ((snap.ball ?? null) !== ballId) {
      ballId = snap.ball ?? null;
      changed = true;
    }
    // Darts: a new one starts flying here from the snapshot; ours keeps its own progress.
    const dartIds = new Set();
    for (const s of snap.darts ?? []) {
      dartIds.add(s.id);
      if (landedDarts.has(s.id)) continue;
      let d = darts.find((x) => x.id === s.id);
      if (!d) {
        d = { id: s.id, origin: unpackV(s.o), dir: unpackV(s.d), range: s.e, traveled: 0, floorId: s.f, stopAt: null, hit: false };
        darts.push(d);
        changed = true;
      }
      if (d.range !== s.e || d.hit !== !!s.h) {
        d.range = s.e;
        d.hit = !!s.h;
        changed = true;
      }
    }
    for (let k = darts.length - 1; k >= 0; k--)
      if (!dartIds.has(darts[k].id)) {
        darts.splice(k, 1);
        changed = true;
      }
    for (const id of landedDarts) if (!dartIds.has(id)) landedDarts.delete(id);
    if (triggers.setToppled(snap.toppled ?? [])) changed = true;
    for (const [pid, [n, text]] of Object.entries(snap.acks ?? {}))
      if (answers[pid]?.n !== n || answers[pid]?.say !== text) {
        answers[pid] = { n, say: text };
        changed = true;
      }
    return changed;
  }

  return {
    tuning,
    localId,
    items,
    locks,
    keypad,
    code,
    drawings,
    traps,
    triggers,
    treats,
    darts,
    canPickUp,
    containerOpen,
    describe,
    interact,
    useHeld,
    acceptsHeld,
    needsHost,
    drop,
    dropTreat,
    fireDart,
    throwBall,
    ballImpact,
    ballLanded,
    perform,
    updateTraps,
    emitTrap,
    walkOut,
    update,
    startDay,
    onCaught,
    openAll,
    snapshot,
    applySnapshot,
    applyIntent,
    /** The last intent the host has run for a player: {n, say}, or undefined. */
    answer: (pid) => answers[pid],
    /** Tell the rules who is in play (for "someone's already hiding here"). */
    setBodies: (fn) => (bodies = fn),
    giveItem: (itemId, pos, floorId, pid = localId) => (isGuest ? null : items.give(itemId, pos, floorId, pid)),
    escape: (route, pid = localId) => locks.escape(route, pid),
  };
}
