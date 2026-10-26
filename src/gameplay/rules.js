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

import { ITEMS, LOCKS, ROUTES, PLAYER_BODY } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { clamp, copy, dist2D } from '../core/math.js';
import { circleHitsAny, overlappingY } from '../player/movement.js';
import { tuningFor } from './tuning.js';
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

/**
 * @param {{world: Object, bus: Object, rng: Object, difficulty?: string, tuning?: Object}} opts
 */
export function createRules({ world, bus, rng, difficulty = 'normal', tuning = tuningFor(difficulty) }) {
  const { anchors } = world;
  const items = createItems({ bus, tuning, placements: pickSpawns(world, rng.fork('spawns'), tuning.items) });
  const code = generateCode(rng.fork('keypad'));
  const keypad = createKeypad(code);
  const drawings = assignDigits(anchors.drawings, code, rng.fork('drawings'));
  const locks = createLocks({ world, bus, tuning });
  const traps = placeTraps(anchors.traps, rng.fork('traps'), tuning);
  const triggers = createTrapTriggers(traps.all, tuning);
  /** treatId → {treatId, pos, floorId}: dropped and not eaten yet */
  const treats = new Map();
  let treatCount = 0;
  let ballId = null; // the last ball thrown: the one Doodle fetches
  let ballNoisy = false; // has this throw made its landing noise yet?

  const doorById = (id) => world.doors.find((d) => d.id === id);
  const containerById = (id) => world.containers.find((c) => c.id === id);
  const hideById = (id) => anchors.hideSpots.find((h) => h.id === id);
  const linkById = (id) => world.nav.links.find((l) => l.id === id);
  const heldId = () => items.heldItemId();
  const holding = (itemId) => heldId() === itemId;
  const containerOpen = (id) => !id || containerById(id)?.isOpen === true;
  const canPickUp = (inst) => !!inst && inst.where === 'world' && containerOpen(inst.containerId);
  const isFrontDoor = (id) => id === anchors.frontDoor.doorId;
  const isGarageDoor = (id) => id === anchors.garage.doorId;
  const isChest = (id) => id === anchors.atticChest.containerId;
  const say = (message) => (message ? { message } : null);

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

  function describeLock(target) {
    if (target.id === LOCKS.KEYPAD) {
      if (locks.isOpen(LOCKS.KEYPAD)) return 'Keypad: unlocked';
      const color = DIAL_COLORS[target.dial]?.name ?? 'colored';
      return `Click: turn the ${color} dial · Right click: back`;
    }
    if (locks.isOpen(target.id)) return null;
    const needs = LOCK_NEEDS[target.id];
    if (target.id === LOCKS.PLANK) return holding(needs) ? 'Click: pull off the plank' : `Nailed shut: needs the ${itemName(needs)}`;
    if (target.id === LOCKS.PADLOCK) return holding(needs) ? 'Click: unlock the padlock' : `Locked: needs the ${itemName(needs)}`;
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

  function describeContainer(c) {
    if (!c) return null;
    const noun = isChest(c.id) ? 'toy chest' : c.kind;
    if (c.locked) {
      if (isChest(c.id)) return holding(LOCK_NEEDS[LOCKS.ATTIC_CHEST]) ? 'Click: unlock the toy chest' : `Locked: needs the ${itemName(ITEMS.TOY_CHEST_KEY)}`;
      return 'Locked';
    }
    return c.isOpen ? `Click: close the ${noun}` : `Click: open the ${noun}`;
  }

  function describeJeep() {
    const needKey = !locks.isOpen(LOCKS.JEEP_KEY);
    const needBattery = !locks.isOpen(LOCKS.JEEP_BATTERY);
    if (!needKey && !needBattery) return 'Click: start the Jeep';
    if (needKey && holding(ITEMS.JEEP_KEY)) return 'Click: put in the Jeep Key';
    if (needBattery && holding(ITEMS.CAR_BATTERY)) return 'Click: put in the Car Battery';
    const missing = [needKey && itemName(ITEMS.JEEP_KEY), needBattery && itemName(ITEMS.CAR_BATTERY)].filter(Boolean);
    return `Jeep: needs the ${listWords(missing)}`;
  }

  /** The prompt for a look target, or null. `player` needs pos and crouched. */
  function describe(target, player) {
    if (!target) return null;
    const { kind, id } = target;
    switch (kind) {
      case 'item': {
        const inst = items.get(id);
        if (!canPickUp(inst)) return null;
        const name = itemName(inst.itemId);
        if (inst.itemId === ITEMS.DART && holding(ITEMS.LAUNCHER)) return `Click: load the ${name}`;
        if (inst.itemId === ITEMS.TREATS) return `Click: pick up ${name} (${inst.uses} left)`;
        if (inst.itemId === ITEMS.LAUNCHER) return `Click: pick up ${name} (${inst.uses} shots)`;
        return `Click: pick up ${name}`;
      }
      case 'lock':
        return describeLock(target);
      case 'keypad':
        return locks.isOpen(LOCKS.KEYPAD) ? 'Keypad: unlocked' : 'Keypad: turn the colored dials to the code';
      case 'door':
        return describeDoor(doorById(id));
      case 'container':
        return describeContainer(containerById(id));
      case 'hide': {
        const h = hideById(id);
        return h ? `Click: ${HIDE_TEXT[h.kind] ?? 'hide'}` : null;
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
        return holding(ITEMS.FUSE) ? 'Click: put in the Fuse' : `Fuse box: needs a ${itemName(ITEMS.FUSE)}`;
      case 'opener': {
        if (!locks.garagePowered()) return 'No power: the fuse box needs a Fuse';
        return locks.garageDoor()?.isOpen ? 'Click: close the garage door' : 'Click: open the garage door';
      }
      case 'jeep':
        return describeJeep();
      case 'piano':
        return 'Click: play the piano';
      default:
        return null;
    }
  }

  // ---- actions ---------------------------------------------------------------

  /** Use the held item on a lock; the item is used up if it fits. */
  function useItemOn(lockId) {
    const result = locks.tryItem(lockId, heldId());
    if (result === 'opened') items.consumeHeld();
    return result;
  }

  function interactLock(target, dir) {
    if (target.id === LOCKS.KEYPAD) {
      if (locks.isOpen(LOCKS.KEYPAD) || target.dial == null) return null;
      keypad.roll(target.dial, dir);
      if (keypad.matches()) locks.solveKeypad();
      return { action: 'dial', dial: target.dial };
    }
    if (locks.isOpen(target.id)) return null;
    if (useItemOn(target.id) === 'opened') return { action: 'lock', lockId: target.id };
    return say(describeLock(target));
  }

  function interactDoor(d, player) {
    if (!d) return null;
    if (isFrontDoor(d.id)) {
      if (locks.openFrontDoor() === 'escaped') return { action: 'escaped', route: ROUTES.FRONT_DOOR };
      return say(describeDoor(d));
    }
    if (d.locked) return say(describeDoor(d));
    if (d.isOpen && bodyInDoorway(d, player)) return say('Step out of the doorway first');
    d.setOpen(!d.isOpen, 'player');
    return { action: 'door', open: d.isOpen };
  }

  function interactContainer(c) {
    if (!c) return null;
    if (c.locked) {
      if (isChest(c.id) && useItemOn(LOCKS.ATTIC_CHEST) === 'opened') return { action: 'lock', lockId: LOCKS.ATTIC_CHEST };
      return say(describeContainer(c));
    }
    c.setOpen(!c.isOpen);
    return { action: 'container', open: c.isOpen };
  }

  function interactJeep() {
    if (!locks.isOpen(LOCKS.JEEP_KEY) && holding(ITEMS.JEEP_KEY)) {
      useItemOn(LOCKS.JEEP_KEY);
      return { action: 'lock', lockId: LOCKS.JEEP_KEY };
    }
    if (!locks.isOpen(LOCKS.JEEP_BATTERY) && holding(ITEMS.CAR_BATTERY)) {
      useItemOn(LOCKS.JEEP_BATTERY);
      return { action: 'lock', lockId: LOCKS.JEEP_BATTERY };
    }
    const result = locks.startJeep();
    if (result === 'escaped') return { action: 'escaped', route: ROUTES.GARAGE };
    if (result === 'doorClosed') return { action: 'jeep', message: 'Vroom! But the garage door is closed!' };
    return say(describeJeep());
  }

  /** Left click / E on a target. `player` needs pos, floorId and crouched. */
  function interact(target, player) {
    if (!target) return null;
    const { kind, id } = target;
    switch (kind) {
      case 'item': {
        const inst = items.get(id);
        if (!canPickUp(inst)) return null;
        const result = items.pickUp(id);
        return result.ok ? { action: 'pickup', itemId: inst.itemId, ...result } : null;
      }
      case 'lock':
        return interactLock(target, 1);
      case 'keypad':
        return say(describe(target, player));
      case 'door':
        return interactDoor(doorById(id), player);
      case 'container':
        return interactContainer(containerById(id));
      case 'hide': {
        const spot = hideById(id);
        return spot ? { action: 'hide', spot } : null;
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
        if (!locks.garagePowered() && useItemOn(LOCKS.FUSE_BOX) === 'opened') return { action: 'lock', lockId: LOCKS.FUSE_BOX };
        return say(describe(target, player));
      case 'opener': {
        const result = locks.pressOpener();
        if (result === 'noPower') return say(describe(target, player));
        if (result === 'blocked') return say("It won't budge");
        return { action: 'opener', result };
      }
      case 'jeep':
        return interactJeep();
      case 'piano': {
        const spot = anchors.traps.find((t) => t.id === id) ?? { kind: 'piano', pos: copy(player.pos), floorId: player.floorId };
        emitTrap(spot, tuning.noise.piano);
        return { action: 'piano', spot };
      }
      default:
        return null;
    }
  }

  /** Would a click on this target use the held item on it? */
  function acceptsHeld(target) {
    const h = heldId();
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
    if (target?.kind === 'lock' && target.id === LOCKS.KEYPAD) return interactLock(target, -1);
    if (acceptsHeld(target)) return interact(target, player);
    const h = items.held();
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

  // ---- defenses --------------------------------------------------------------

  /** G: drop the held item (makes noise). */
  const drop = (pos, floorId) => items.drop(pos, floorId);

  function dropTreat(pos, floorId) {
    if (!holding(ITEMS.TREATS)) return null;
    const treatId = `treat${++treatCount}`;
    treats.set(treatId, { treatId, pos: copy(pos), floorId });
    items.spendCharge();
    bus.emit(EVENTS.TREAT_DROPPED, { treatId, pos: copy(pos), floorId });
    return treatId;
  }

  function fireDart(origin, dir, range, floorId) {
    const h = items.held();
    if (h?.itemId !== ITEMS.LAUNCHER || !(h.uses > 0)) return false;
    items.spendCharge();
    bus.emit(EVENTS.DART_FIRED, { origin: copy(origin), dir: copy(dir), range });
    if (tuning.noise.dart > 0) bus.emit(EVENTS.NOISE, { pos: copy(origin), floorId, loudness: tuning.noise.dart, kind: 'dart' });
    return true;
  }

  /** The ball leaves your hand. The 3D layer simulates it and calls ballImpact/ballLanded. */
  function throwBall(pos, floorId) {
    if (!holding(ITEMS.TENNIS_BALL)) return null;
    const inst = items.release('flying');
    ballId = inst.id;
    ballNoisy = false;
    bus.emit(EVENTS.BALL_THROWN, { pos: copy(pos), floorId });
    return inst;
  }

  /** A bounce. The first one is loud enough to draw Doodle; later ones are small. */
  function ballImpact(pos, floorId, speed) {
    if (speed < 1.2) return;
    const loudness = ballNoisy ? tuning.noise.ball * clamp(speed / 8, 0.15, 0.6) : tuning.noise.ball;
    ballNoisy = true;
    bus.emit(EVENTS.NOISE, { pos: copy(pos), floorId, loudness, kind: 'ball' });
  }

  /** The ball came to rest: Doodle goes to fetch it from here. */
  function ballLanded(inst, pos, floorId) {
    if (inst.where !== 'flying') return;
    if (!ballNoisy) ballImpact(pos, floorId, 99);
    items.place(inst, pos, floorId);
    bus.emit(EVENTS.BALL_LANDED, { pos: copy(pos), floorId });
  }

  const ballInstance = () => items.get(ballId) ?? items.list().find((i) => i.itemId === ITEMS.TENNIS_BALL && i.where === 'world');

  bus.on(EVENTS.BALL_FETCHED, () => {
    const inst = ballInstance();
    if (inst && (inst.where === 'world' || inst.where === 'flying')) items.place(inst, inst.pos, inst.floorId, { where: 'doodle' });
  });
  bus.on(EVENTS.BALL_RETURNED, ({ pos, floorId }) => {
    const inst = items.list().find((i) => i.itemId === ITEMS.TENNIS_BALL && i.where === 'doodle') ?? ballInstance();
    if (inst && inst.where !== 'held' && inst.where !== 'gone') items.place(inst, pos, floorId);
  });
  bus.on(EVENTS.TREAT_EATEN, ({ treatId }) => treats.delete(treatId));

  // ---- traps -----------------------------------------------------------------

  function emitTrap(spot, loudness) {
    bus.emit(EVENTS.TRAP, { kind: spot.kind, pos: copy(spot.pos), floorId: spot.floorId });
    if (loudness > 0) bus.emit(EVENTS.NOISE, { pos: copy(spot.pos), floorId: spot.floorId, loudness, kind: TRAP_NOISE[spot.kind] ?? 'other' });
  }

  /** Every frame the player is on foot: fire any trap they stepped on. */
  function updateTraps(player) {
    if (player.hidden) return [];
    const fired = triggers.update(player.pos, player.floorId, { crouched: player.crouched });
    for (const { spot, loudness } of fired) emitTrap(spot, loudness);
    return fired;
  }

  // ---- day flow --------------------------------------------------------------

  /** Re-arm traps; a ball Doodle was still carrying turns up on its bed. */
  function startDay() {
    const bed = anchors.startBed;
    triggers.rearm(bed.pos, bed.floorId);
    for (const inst of items.list())
      if (inst.itemId === ITEMS.TENNIS_BALL && (inst.where === 'doodle' || inst.where === 'flying'))
        items.place(inst, anchors.kennelBed.pos, anchors.kennelBed.floorId);
    items.emitHeld();
  }

  /** Caught: the held item falls where you were (no extra noise). */
  function onCaught(feetPos, floorId) {
    return items.drop(feetPos, floorId, { noise: false });
  }

  function openAll() {
    keypad.set(code);
    locks.openAll();
  }

  return {
    tuning,
    items,
    locks,
    keypad,
    code,
    drawings,
    traps,
    triggers,
    treats,
    canPickUp,
    containerOpen,
    describe,
    interact,
    useHeld,
    acceptsHeld,
    drop,
    dropTreat,
    fireDart,
    throwBall,
    ballImpact,
    ballLanded,
    updateTraps,
    emitTrap,
    startDay,
    onCaught,
    openAll,
    giveItem: (itemId, pos, floorId) => items.give(itemId, pos, floorId),
    escape: (route) => locks.escape(route),
  };
}
