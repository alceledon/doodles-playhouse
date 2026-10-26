// Items: names, per-run spawn picks, and the one-hand rule. Pure logic (no
// three), so node --test covers it. The view layer polls `version()` and
// re-syncs meshes when it changes.
//
// An item instance is { id, itemId, where, pos, floorId, containerId, rotY, uses }:
//   where = 'world'  resting at pos (inside containerId if set: grabbable only once it's open)
//         | 'held'   in the player's hand (only ever one)
//         | 'flying' a thrown tennis ball, mid-air
//         | 'doodle' the ball in Doodle's mouth
//         | 'gone'   used up (key in its lock, last treat eaten, dart loaded)

import { ITEMS, SPAWNED_ITEMS } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { copy } from '../core/math.js';

export const ITEM_INFO = Object.freeze({
  [ITEMS.PADLOCK_KEY]: { name: 'Padlock Key' },
  [ITEMS.HAMMER]: { name: 'Hammer' },
  [ITEMS.JEEP_KEY]: { name: 'Jeep Key' },
  [ITEMS.CAR_BATTERY]: { name: 'Car Battery' },
  [ITEMS.FUSE]: { name: 'Fuse' },
  [ITEMS.TOY_CHEST_KEY]: { name: 'Toy Chest Key' },
  [ITEMS.TENNIS_BALL]: { name: 'Tennis Ball' },
  [ITEMS.TREATS]: { name: 'Bag of Treats' },
  [ITEMS.LAUNCHER]: { name: 'Squeaky-toy Launcher' },
  [ITEMS.DART]: { name: 'Squeaky Dart' },
});

export const itemName = (itemId) => ITEM_INFO[itemId]?.name ?? itemId;

/**
 * Pick where every item starts this run. One spot per spawned item (darts:
 * `spareDarts` of them), never two items on one spot or in one container,
 * and the launcher always in the attic chest. Nothing else may spawn in the
 * attic chest, or its own key could end up locked inside it.
 * @param {import('../core/contracts.js').World} world
 * @param {import('../core/rng.js').Rng} rng
 * @returns {{itemId: string, spot: import('../core/contracts.js').Spot}[]}
 */
export function pickSpawns(world, rng, { spareDarts = 1 } = {}) {
  const { anchors } = world;
  const chestId = anchors.atticChest?.containerId;
  const chest = world.containers.find((c) => c.id === chestId);
  const used = new Set();
  const claim = (spot) => {
    used.add(spot.id);
    if (spot.containerId) used.add(`container:${spot.containerId}`);
  };
  const isFree = (spot) => !used.has(spot.id) && !(spot.containerId && used.has(`container:${spot.containerId}`));
  const out = [];
  if (chest) {
    claim(chest.itemSpot);
    out.push({ itemId: ITEMS.LAUNCHER, spot: chest.itemSpot });
  }
  for (const itemId of SPAWNED_ITEMS) {
    const candidates = (anchors.spawns[itemId] ?? []).filter((s) => s.containerId !== chestId);
    const count = itemId === ITEMS.DART ? spareDarts : 1;
    for (let n = 0; n < count; n++) {
      const free = candidates.filter(isFree);
      // A required item must spawn even if World gave too few spots; spare darts just don't.
      const pool = free.length ? free : itemId === ITEMS.DART ? [] : candidates;
      if (!pool.length) break;
      const spot = rng.pick(pool);
      claim(spot);
      out.push({ itemId, spot });
    }
  }
  return out;
}

/**
 * The item registry and the hand.
 * @param {{bus: import('../core/events.js').Bus, tuning: Object, placements?: {itemId: string, spot: Object}[]}} opts
 */
export function createItems({ bus, tuning, placements = [] }) {
  const instances = new Map();
  let heldId = null;
  let counter = 0;
  let version = 0;
  const changed = () => version++;

  const defaultUses = (itemId) =>
    itemId === ITEMS.TREATS ? tuning.items.treatUses : itemId === ITEMS.LAUNCHER ? tuning.items.launcherShots : null;

  function spawn(itemId, pos, floorId, { containerId = null, rotY = 0, uses } = {}) {
    const inst = {
      id: `${itemId}#${++counter}`,
      itemId,
      where: 'world',
      pos: copy(pos),
      floorId,
      containerId,
      rotY,
      uses: uses ?? defaultUses(itemId),
    };
    instances.set(inst.id, inst);
    changed();
    return inst;
  }

  for (const { itemId, spot } of placements) spawn(itemId, spot.pos, spot.floorId, { containerId: spot.containerId ?? null, rotY: spot.rotY ?? 0 });

  const held = () => (heldId ? instances.get(heldId) : null);
  const heldItemId = () => held()?.itemId ?? null;

  function emitHeld() {
    const h = held();
    bus.emit(EVENTS.HELD, { itemId: h?.itemId ?? null, uses: h?.uses ?? null });
  }

  function take(inst) {
    inst.where = 'held';
    inst.containerId = null;
    heldId = inst.id;
    bus.emit(EVENTS.PICKUP, { itemId: inst.itemId });
    emitHeld();
    changed();
  }

  /** Put an instance down at a spot without any noise (swaps, catches, debug). */
  function place(inst, pos, floorId, { containerId = null, rotY = inst.rotY, where = 'world' } = {}) {
    if (inst.id === heldId) heldId = null;
    inst.where = where;
    inst.pos = copy(pos);
    inst.floorId = floorId;
    inst.containerId = containerId;
    inst.rotY = rotY;
    changed();
  }

  /**
   * Pick an item up. One hand: whatever you were holding is put down where the
   * new item was (in Granny style). A dart and the launcher combine instead.
   * @returns {{ok: boolean, swapped?: Object, loaded?: boolean}}
   */
  function pickUp(id) {
    const inst = instances.get(id);
    if (!inst || inst.where !== 'world') return { ok: false };
    const cur = held();
    if (cur?.itemId === ITEMS.LAUNCHER && inst.itemId === ITEMS.DART) {
      inst.where = 'gone';
      cur.uses += 1;
      bus.emit(EVENTS.PICKUP, { itemId: inst.itemId });
      emitHeld();
      changed();
      return { ok: true, loaded: true };
    }
    if (cur?.itemId === ITEMS.DART && inst.itemId === ITEMS.LAUNCHER) {
      cur.where = 'gone';
      heldId = null;
      inst.uses += 1;
      take(inst);
      return { ok: true, loaded: true };
    }
    let swapped = null;
    if (cur) {
      place(cur, inst.pos, inst.floorId, { containerId: inst.containerId, rotY: inst.rotY });
      bus.emit(EVENTS.DROP, { itemId: cur.itemId, pos: copy(cur.pos), floorId: cur.floorId });
      if (tuning.noise.swap > 0) bus.emit(EVENTS.NOISE, { pos: copy(cur.pos), floorId: cur.floorId, loudness: tuning.noise.swap, kind: 'drop' });
      swapped = cur;
    }
    take(inst);
    return { ok: true, swapped };
  }

  /** Drop the held item at pos. Dropping makes noise (not when you're caught). */
  function drop(pos, floorId, { noise = true } = {}) {
    const cur = held();
    if (!cur) return null;
    place(cur, pos, floorId);
    bus.emit(EVENTS.DROP, { itemId: cur.itemId, pos: copy(pos), floorId });
    if (noise) bus.emit(EVENTS.NOISE, { pos: copy(pos), floorId, loudness: tuning.noise.drop, kind: 'drop' });
    emitHeld();
    return cur;
  }

  /** The held item is used up (a key in its lock). */
  function consumeHeld() {
    const cur = held();
    if (!cur) return null;
    cur.where = 'gone';
    heldId = null;
    emitHeld();
    changed();
    return cur;
  }

  /** Spend one use of the held treats/launcher. Empty treats vanish; an empty launcher stays in hand. */
  function spendCharge() {
    const cur = held();
    if (!cur || !(cur.uses > 0)) return -1;
    cur.uses -= 1;
    if (cur.itemId === ITEMS.TREATS && cur.uses <= 0) consumeHeld();
    else {
      emitHeld();
      changed();
    }
    return cur.uses;
  }

  /** The held item leaves your hand without landing anywhere yet (a thrown ball). */
  function release(where = 'flying') {
    const cur = held();
    if (!cur) return null;
    cur.where = where;
    heldId = null;
    emitHeld();
    changed();
    return cur;
  }

  /** Debug: put an item in your hand, reusing its instance if one is still around. */
  function give(itemId, dropPos, floorId) {
    const cur = held();
    if (cur?.itemId === itemId) return cur;
    if (cur) place(cur, dropPos, floorId);
    let inst = [...instances.values()].find((i) => i.itemId === itemId && i.where === 'world');
    if (!inst) inst = spawn(itemId, dropPos, floorId);
    take(inst);
    return inst;
  }

  return {
    get: (id) => instances.get(id),
    list: () => [...instances.values()],
    held,
    heldItemId,
    spawn,
    place,
    pickUp,
    drop,
    consumeHeld,
    spendCharge,
    release,
    give,
    emitHeld,
    touch: changed,
    version: () => version,
  };
}
