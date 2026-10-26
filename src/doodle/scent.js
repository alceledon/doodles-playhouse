// The player's scent, as Doodle's nose sees it. Pure logic.
//
// - Crumbs: a timestamped point about every meter the player moves. They fade
//   and vanish after crumbLife. Doodle follows them toward the freshest one.
// - Pools: standing still (poolDelay+ s) or hiding builds a pool whose smell
//   radius grows the longer you stay, so a long hide draws Doodle in.

import { dist2D } from '../core/math.js';
import { floorsApart } from './senses.js';

const STILL_RADIUS = 0.6; // moving less than this counts as standing still
const SAME_POOL = 1.0; // standing within this of an old pool tops that pool up

/**
 * @param {Object} tuning   see tuning.js (nose, crumb*, pool*, smell*)
 * @param {Object<string, number>} ranks   floorRanks(world)
 */
export function createScent(tuning, ranks) {
  /** @type {{pos: Vec3, floorId: string, t: number}[]} */
  const crumbs = [];
  /** @type {{id: number, pos: Vec3, floorId: string, seconds: number, last: number, hideSpotId: string|null, checkedAt: number, recheckAt: number}[]} */
  const pools = [];
  let lastCrumb = null;
  let still = null; // {pos, floorId, since}
  let nextId = 1;
  const life = () => tuning.crumbLife * tuning.nose;

  function poolAt(pos, floorId, hideSpotId) {
    let pool = hideSpotId
      ? pools.find((p) => p.hideSpotId === hideSpotId)
      : pools.find((p) => !p.hideSpotId && p.floorId === floorId && dist2D(p.pos, pos) < SAME_POOL);
    if (!pool) {
      pool = { id: nextId++, pos: { x: pos.x, y: pos.y, z: pos.z }, floorId, seconds: 0, last: -Infinity, hideSpotId, checkedAt: -Infinity, recheckAt: -Infinity };
      pools.push(pool);
    }
    return pool;
  }

  /** How strong a pool smells right now: 1 while the player is in it, fading after they leave. */
  const poolFade = (pool, now) => Math.max(0, 1 - Math.max(0, now - pool.last - 0.5) / tuning.poolDecay);

  function poolRadius(pool, now) {
    const r = Math.min(tuning.poolMaxRadius, tuning.poolRadius0 + tuning.poolGrowth * pool.seconds);
    return r * tuning.nose * poolFade(pool, now);
  }

  /**
   * Advance one frame.
   * @param {number} now   brain clock
   * @param {number} dt
   * @param {Object|null} player
   * @param {{spotId: string, pos: Vec3, floorId: string}|null} hide   where the player is hiding (from HIDE)
   */
  function update(now, dt, player, hide) {
    while (crumbs.length && now - crumbs[0].t > life()) crumbs.shift();
    for (let k = pools.length - 1; k >= 0; k--) if (poolFade(pools[k], now) <= 0) pools.splice(k, 1);
    if (!player) return;

    if (player.hidden && hide) {
      const pool = poolAt(hide.pos, hide.floorId, hide.spotId);
      pool.seconds += dt;
      pool.last = now;
      still = null;
      return;
    }

    const pos = player.pos;
    if (!lastCrumb || lastCrumb.floorId !== player.floorId || dist2D(lastCrumb.pos, pos) >= tuning.crumbSpacing) {
      lastCrumb = { pos: { x: pos.x, y: pos.y, z: pos.z }, floorId: player.floorId, t: now };
      crumbs.push(lastCrumb);
    }

    if (!still || still.floorId !== player.floorId || dist2D(still.pos, pos) > STILL_RADIUS) {
      still = { pos: { x: pos.x, y: pos.y, z: pos.z }, floorId: player.floorId, since: now };
    } else if (now - still.since >= tuning.poolDelay) {
      const pool = poolAt(still.pos, still.floorId, null);
      pool.seconds += dt;
      pool.last = now;
    }
  }

  /**
   * The best thing to sniff toward from `at`: the freshest crumb within smell
   * range, or a pool whose radius reaches us, whichever is fresher.
   * @param {number} now
   * @param {Vec3} at
   * @param {string} floorId
   * @param {{after?: number, maxAge?: number}} [opts]  after = only scent newer than this; maxAge = ignore older crumbs
   * @returns {{kind: 'crumb'|'pool', pos: Vec3, floorId: string, t: number, pool?: Object}|null}
   */
  function smell(now, at, floorId, { after = -Infinity, maxAge = life() } = {}) {
    let best = null;
    const reach = (r, f) => r * tuning.smellFloorDamping ** floorsApart(ranks, f, floorId);
    const crumbRange = tuning.smellRange * tuning.nose;
    for (let k = crumbs.length - 1; k >= 0; k--) {
      const c = crumbs[k];
      if (c.t <= after || now - c.t > maxAge) break; // crumbs are in time order
      if (best && c.t <= best.t) break;
      if (dist2D(c.pos, at) <= reach(crumbRange, c.floorId)) best = { kind: 'crumb', pos: c.pos, floorId: c.floorId, t: c.t };
    }
    for (const p of pools) {
      if (p.last <= after || p.last <= p.checkedAt || now < p.recheckAt) continue; // nothing new here
      if (dist2D(p.pos, at) > reach(poolRadius(p, now), p.floorId)) continue;
      if (!best || p.last >= best.t) best = { kind: 'pool', pos: p.pos, floorId: p.floorId, t: p.last, pool: p };
    }
    return best;
  }

  return {
    crumbs,
    pools,
    update,
    smell,
    poolRadius,
    /**
     * Doodle sniffed a pool and found nothing: skip it until the player adds to
     * it again, and in any case for `recheck` seconds.
     */
    markChecked(pool, now, recheck = 0) {
      pool.checkedAt = pool.last;
      pool.recheckAt = now + recheck;
    },
    clear() {
      crumbs.length = 0;
      pools.length = 0;
      lastCrumb = null;
      still = null;
    },
  };
}
