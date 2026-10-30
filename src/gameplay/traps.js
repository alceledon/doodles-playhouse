// Noise traps. Pure logic: which candidate spots get a squeaky toy or block
// tower this run, and proximity triggers for every trap (World's creaky
// planks and piano included).
//
//   squeaky  squeaks each time you step on it (re-arms once you step off)
//   creaky   creaks each time you step on it
//   piano    plinks when you bump into it (not when you creep past crouched)
//   blocks   the tower topples once; startDay() rebuilds it

import { PLAYER_BODY } from '../core/contracts.js';
import { dist2D } from '../core/math.js';

/** NOISE kind and tuning.noise key for each trap kind. */
export const TRAP_NOISE = Object.freeze({ squeaky: 'squeak', creaky: 'creak', piano: 'piano', blocks: 'blocks' });

/**
 * @param {Object[]} spots  world.anchors.traps
 * @returns {{fixed: Object[], placed: Object[], all: Object[]}}  placed = the squeaky/blocks spots Gameplay builds props on
 */
export function placeTraps(spots, rng, tuning) {
  const fixed = spots.filter((t) => t.kind === 'creaky' || t.kind === 'piano');
  const placed = [];
  for (const kind of ['squeaky', 'blocks']) {
    const candidates = spots.filter((t) => t.kind === kind);
    if (!candidates.length) continue;
    const frac = tuning.traps[kind] ?? 0;
    const n = Math.min(candidates.length, Math.max(frac > 0 ? 1 : 0, Math.round(candidates.length * frac)));
    placed.push(...rng.shuffle(candidates).slice(0, n));
  }
  return { fixed, placed, all: [...fixed, ...placed] };
}

export function trapLoudness(kind, crouched, tuning) {
  const base = tuning.noise[TRAP_NOISE[kind]] ?? 0;
  return crouched && (kind === 'squeaky' || kind === 'creaky') ? base * tuning.noise.crouchTrapFactor : base;
}

/**
 * @param {Object[]} spots  the active trap spots (placeTraps().all)
 */
export function createTrapTriggers(spots, tuning) {
  // Arming is per body (co-op: one player stepping off doesn't re-arm a toy the other stands on);
  // a toppled tower is toppled for everyone. A body not seen yet starts armed.
  const states = spots.map((spot) => ({ spot, unarmed: new Set(), toppled: false }));
  const enterR = (s) => s.radius + PLAYER_BODY.radius * 0.6;
  const leaveR = (s) => s.radius + PLAYER_BODY.radius + 0.3;

  /**
   * Call every frame with a player's feet.
   * @returns {{spot: Object, loudness: number}[]} traps that went off this frame
   */
  function update(pos, floorId, { crouched = false, playerId = 'host' } = {}) {
    const out = [];
    for (const st of states) {
      const s = st.spot;
      const sameFloor = s.floorId === floorId && Math.abs(pos.y - s.pos.y) < 0.9;
      const d = sameFloor ? dist2D(pos, s.pos) : Infinity;
      if (d > leaveR(s)) st.unarmed.delete(playerId);
      if (st.unarmed.has(playerId) || st.toppled || d >= enterR(s)) continue;
      if (s.kind === 'piano' && crouched) continue; // creeping past doesn't bump it
      st.unarmed.add(playerId);
      if (s.kind === 'blocks') st.toppled = true;
      out.push({ spot: s, loudness: trapLoudness(s.kind, crouched, tuning) });
    }
    return out;
  }

  /**
   * Start of a day: towers rebuilt, everything armed, except what someone wakes up standing on.
   * `pos, floorId` is the host's bed; `others` adds more beds as [{pos, floorId, playerId}].
   */
  function rearm(pos = null, floorId = null, others = []) {
    const beds = [...(pos ? [{ pos, floorId, playerId: 'host' }] : []), ...others];
    for (const st of states) {
      st.toppled = false;
      st.unarmed.clear();
      for (const b of beds) if (st.spot.floorId === b.floorId && dist2D(b.pos, st.spot.pos) <= leaveR(st.spot)) st.unarmed.add(b.playerId);
    }
  }

  /** Co-op mirror: which towers are down (arming stays the host's business). */
  function setToppled(ids) {
    const down = new Set(ids);
    let changed = false;
    for (const st of states) {
      const t = down.has(st.spot.id);
      if (st.toppled !== t) changed = true;
      st.toppled = t;
    }
    return changed;
  }

  return {
    update,
    rearm,
    setToppled,
    isToppled: (id) => states.find((st) => st.spot.id === id)?.toppled ?? false,
    toppled: () => states.filter((st) => st.toppled).map((st) => st.spot.id),
    spots: () => states.map((st) => st.spot),
  };
}
