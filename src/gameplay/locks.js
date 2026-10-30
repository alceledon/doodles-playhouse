// Locks and escapes. Pure logic over the World's plain door/container objects:
// it opens locks, unlocks doors, and emits LOCK_OPENED, EXIT_UNLOCKED,
// JEEP_STARTED and ESCAPED.
//
//   Front door: padlock (Padlock Key) + plank (Hammer) + keypad (crayon code).
//               All three open → door.setLocked(false); opening it = ESCAPED.
//   Garage:     fuse box (Fuse) powers the opener; the opener unlocks and opens
//               the garage door. The Jeep needs the Jeep Key and Car Battery;
//               starting it is very loud, and drives out if the door is open.
//   Attic chest: Toy Chest Key → unlocked and opened (the launcher is inside).

import { ITEMS, LOCKS, LOCK_IDS, ROUTES } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { copy } from '../core/math.js';

/** Which item opens each lock. The keypad takes the code instead. */
export const LOCK_NEEDS = Object.freeze({
  [LOCKS.PADLOCK]: ITEMS.PADLOCK_KEY,
  [LOCKS.PLANK]: ITEMS.HAMMER,
  [LOCKS.KEYPAD]: null,
  [LOCKS.FUSE_BOX]: ITEMS.FUSE,
  [LOCKS.JEEP_KEY]: ITEMS.JEEP_KEY,
  [LOCKS.JEEP_BATTERY]: ITEMS.CAR_BATTERY,
  [LOCKS.ATTIC_CHEST]: ITEMS.TOY_CHEST_KEY,
});

/** Every lock on a route must be open for EXIT_UNLOCKED. */
export const ROUTE_LOCKS = Object.freeze({
  [ROUTES.FRONT_DOOR]: Object.freeze([LOCKS.PADLOCK, LOCKS.PLANK, LOCKS.KEYPAD]),
  [ROUTES.GARAGE]: Object.freeze([LOCKS.FUSE_BOX, LOCKS.JEEP_KEY, LOCKS.JEEP_BATTERY]),
});

export const LOCK_NAMES = Object.freeze({
  [LOCKS.PADLOCK]: 'padlock',
  [LOCKS.PLANK]: 'plank',
  [LOCKS.KEYPAD]: 'keypad',
  [LOCKS.FUSE_BOX]: 'fuse box',
  [LOCKS.JEEP_KEY]: 'Jeep Key',
  [LOCKS.JEEP_BATTERY]: 'Car Battery',
  [LOCKS.ATTIC_CHEST]: 'toy chest',
});

/** "a", "a and b", "a, b and c" */
export function listWords(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/**
 * @param {{world: import('../core/contracts.js').World, bus: import('../core/events.js').Bus, tuning: Object, who?: (playerId: string, at?: Object) => Object}} opts
 *   who: extra payload fields naming the player behind an event, and (co-op) where it happened:
 *   at = {pos, floorId}. Empty in a solo run, so solo payloads stay as they were.
 */
export function createLocks({ world, bus, tuning, who = () => ({}) }) {
  const open = new Set();
  const unlockedRoutes = new Set();
  let escapedRoute = null;
  const { anchors } = world;
  const frontDoor = () => world.doors.find((d) => d.id === anchors.frontDoor.doorId);
  const garageDoor = () => world.doors.find((d) => d.id === anchors.garage.doorId);
  const chest = () => world.containers.find((c) => c.id === anchors.atticChest.containerId);

  const isOpen = (lockId) => open.has(lockId);
  const remaining = (route) => ROUTE_LOCKS[route].filter((l) => !open.has(l));

  /** Where a lock's hardware is, so co-op sounds can be placed: {pos, floorId}. */
  function lockSpot(lockId) {
    const spot = {
      [LOCKS.PADLOCK]: anchors.frontDoor.padlock,
      [LOCKS.PLANK]: anchors.frontDoor.plank,
      [LOCKS.KEYPAD]: anchors.frontDoor.keypad,
      [LOCKS.FUSE_BOX]: anchors.fuseBox,
      [LOCKS.JEEP_KEY]: anchors.garage.jeep,
      [LOCKS.JEEP_BATTERY]: anchors.garage.jeep,
      [LOCKS.ATTIC_CHEST]: chest(),
    }[lockId];
    return spot ? { pos: copy(spot.pos), floorId: spot.floorId } : null;
  }
  /** An exit's door, for EXIT_UNLOCKED. */
  function routeSpot(route) {
    const door = route === ROUTES.GARAGE ? garageDoor() : frontDoor();
    return door ? { pos: copy(door.pos), floorId: door.floorId } : null;
  }

  function openLock(lockId, playerId) {
    if (!LOCK_IDS.includes(lockId) || open.has(lockId)) return false;
    open.add(lockId);
    bus.emit(EVENTS.LOCK_OPENED, { lockId, ...who(playerId, lockSpot(lockId)) });
    if (lockId === LOCKS.ATTIC_CHEST) {
      const c = chest();
      c?.setLocked(false);
      c?.setOpen(true);
    }
    for (const route of Object.values(ROUTES)) {
      if (unlockedRoutes.has(route) || remaining(route).length) continue;
      unlockedRoutes.add(route);
      // The garage door itself is unlocked by the opener, not here.
      if (route === ROUTES.FRONT_DOOR) frontDoor()?.setLocked(false);
      bus.emit(EVENTS.EXIT_UNLOCKED, { route, ...who(playerId, routeSpot(route)) });
    }
    return true;
  }

  /**
   * Use an item on a lock.
   * @returns {'opened'|'alreadyOpen'|'wrongItem'|'needsCode'}
   */
  function tryItem(lockId, itemId, playerId) {
    if (open.has(lockId)) return 'alreadyOpen';
    const needs = LOCK_NEEDS[lockId];
    if (needs === null) return 'needsCode';
    if (!itemId || itemId !== needs) return 'wrongItem';
    openLock(lockId, playerId);
    return 'opened';
  }

  /** The keypad opens when its dials show the code (the caller checks that). */
  const solveKeypad = (playerId) => openLock(LOCKS.KEYPAD, playerId);

  /** @returns {'noPower'|'opened'|'closed'|'blocked'} */
  function pressOpener() {
    if (!open.has(LOCKS.FUSE_BOX)) return 'noPower';
    const door = garageDoor();
    door.setLocked(false);
    const want = !door.isOpen;
    if (!door.setOpen(want, 'player')) return 'blocked';
    return want ? 'opened' : 'closed';
  }

  const jeepReady = () => open.has(LOCKS.JEEP_KEY) && open.has(LOCKS.JEEP_BATTERY);

  /** @returns {'notReady'|'doorClosed'|'escaped'} — starting is loud either way */
  function startJeep(playerId) {
    if (!jeepReady()) return 'notReady';
    const spot = anchors.garage.jeep;
    bus.emit(EVENTS.JEEP_STARTED, { pos: copy(spot.pos), floorId: spot.floorId, ...who(playerId) });
    bus.emit(EVENTS.NOISE, { pos: copy(spot.pos), floorId: spot.floorId, loudness: tuning.noise.jeep, kind: 'jeep', ...who(playerId) });
    if (!garageDoor().isOpen) return 'doorClosed';
    escape(ROUTES.GARAGE, playerId);
    return 'escaped';
  }

  /** @returns {'locked'|'escaped'} */
  function openFrontDoor(playerId) {
    const door = frontDoor();
    if (door.locked) return 'locked';
    door.setOpen(true, 'player');
    escape(ROUTES.FRONT_DOOR, playerId);
    return 'escaped';
  }

  /** ESCAPED goes out once per run. */
  function escape(route, playerId) {
    if (escapedRoute) return false;
    escapedRoute = route;
    bus.emit(EVENTS.ESCAPED, { route, ...who(playerId) });
    return true;
  }

  /** Co-op: the lock state as plain JSON, and putting it back silently (doors travel separately). */
  const save = () => ({ open: [...open], routes: [...unlockedRoutes], escaped: escapedRoute });
  function load(state) {
    const same = (set, list) => set.size === list.length && list.every((x) => set.has(x));
    const changed = !same(open, state.open ?? []) || !same(unlockedRoutes, state.routes ?? []) || escapedRoute !== (state.escaped ?? null);
    open.clear();
    for (const id of state.open ?? []) open.add(id);
    unlockedRoutes.clear();
    for (const r of state.routes ?? []) unlockedRoutes.add(r);
    escapedRoute = state.escaped ?? null;
    return changed;
  }

  /** Debug: every lock open, both exit doors unlocked (the garage door still needs opening). */
  function openAll() {
    for (const id of LOCK_IDS) openLock(id);
    garageDoor()?.setLocked(false);
  }

  return {
    isOpen,
    remaining,
    openLock,
    tryItem,
    solveKeypad,
    pressOpener,
    jeepReady,
    startJeep,
    openFrontDoor,
    escape,
    openAll,
    lockSpot,
    save,
    load,
    garagePowered: () => open.has(LOCKS.FUSE_BOX),
    routeUnlocked: (route) => unlockedRoutes.has(route),
    escaped: () => escapedRoute,
    frontDoor,
    garageDoor,
    chest,
  };
}
