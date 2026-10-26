// Doodle's hearing and sight, plus the dart hit test. Pure logic on plain
// {x, y, z} objects.
//
// Line of sight is tested against world.colliders(floorId) rather than nav
// cells: nav cells mark low furniture and stairwell holes as solid (you can
// see over a bed) and doorways as open whether or not the door is closed.

import { angleDiff, dist2D, yawTo } from '../core/math.js';

// Eyes sit over the body center rather than out on the snout, so a Doodle
// nosing a wall can't see through it.
const EYE_HEIGHT = 1.3;
const PLAYER_CHEST = 0.9; // where it looks for a standing player
const PLAYER_CHEST_CROUCHED = 0.45;

/** floorId → 0, 1, 2... from the lowest floor up. */
export function floorRanks(world) {
  const sorted = world.floors.slice().sort((a, b) => a.y - b.y);
  return Object.fromEntries(sorted.map((f, k) => [f.id, k]));
}

export const floorsApart = (ranks, a, b) => Math.abs((ranks[a] ?? 0) - (ranks[b] ?? 0));

// ---------------------------------------------------------------------------
// Hearing
// ---------------------------------------------------------------------------

/** Hearing radius for a noise as heard from another floor, scaled by difficulty. */
export function heardRadius(loudness, floors, tuning) {
  return loudness * tuning.hearing * tuning.floorDamping ** floors;
}

/**
 * @param {{pos: Vec3, floorId: string, loudness: number}} noise
 * @param {{pos: Vec3, floorId: string}} doodle
 * @returns {{heard: boolean, radius: number, dist: number}}
 */
export function hear(noise, doodle, ranks, tuning) {
  const radius = heardRadius(noise.loudness ?? 0, floorsApart(ranks, noise.floorId, doodle.floorId), tuning);
  const dist = dist2D(noise.pos, doodle.pos);
  return { heard: dist <= radius, radius, dist };
}

// ---------------------------------------------------------------------------
// Line of sight
// ---------------------------------------------------------------------------

/** Does segment a→b pass through box b? (slab test; touching the surface counts) */
export function segmentHitsBox(a, b, box) {
  let t0 = 0;
  let t1 = 1;
  for (const [p, q, lo, hi] of [
    [a.x, b.x, box.minX, box.maxX],
    [a.y, b.y, box.minY, box.maxY],
    [a.z, b.z, box.minZ, box.maxZ],
  ]) {
    const d = q - p;
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
      continue;
    }
    let ta = (lo - p) / d;
    let tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

const contains = (box, p) => p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY && p.z > box.minZ && p.z < box.maxZ;

/** Is the segment a→b blocked by any collider on these floors? Boxes containing an endpoint are skipped. */
export function segmentBlocked(world, floorIds, a, b) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z);
  const maxZ = Math.max(a.z, b.z);
  for (const floorId of floorIds)
    for (const box of world.colliders(floorId)) {
      if (box.maxX < minX || box.minX > maxX || box.maxZ < minZ || box.minZ > maxZ) continue;
      if (contains(box, a) || contains(box, b)) continue;
      if (segmentHitsBox(a, b, box)) return true;
    }
  return false;
}

/** Where Doodle looks from. */
export const eyePoint = (doodle) => ({ x: doodle.pos.x, y: doodle.pos.y + EYE_HEIGHT, z: doodle.pos.z });

export const playerTarget = (player) => ({
  x: player.pos.x,
  y: player.pos.y + (player.crouched ? PLAYER_CHEST_CROUCHED : PLAYER_CHEST),
  z: player.pos.z,
});

/** Sight range for the player's current visibility (0..1). sqrt so dim light still reads at mid range. */
export function sightRange(visibility, tuning) {
  const v = Math.max(0, Math.min(1, visibility));
  return tuning.sightMin + (tuning.sightMax - tuning.sightMin) * Math.sqrt(v);
}

/**
 * Can Doodle see the player right now?
 * @returns {{visible: boolean, dist: number, range: number, inCone: boolean, reason: string}}
 */
export function look(doodle, player, world, tuning, { blind = false } = {}) {
  const out = { visible: false, dist: Infinity, range: 0, inCone: false, reason: '' };
  if (!player) return { ...out, reason: 'no player' };
  if (player.hidden) return { ...out, reason: 'hidden' };
  if (blind) return { ...out, reason: 'blind' };
  if (player.floorId !== doodle.floorId) return { ...out, reason: 'other floor' };
  const dist = dist2D(doodle.pos, player.pos);
  const range = Math.max(sightRange(player.visibility(), tuning), tuning.closeSense);
  out.dist = dist;
  out.range = range;
  if (dist > range) return { ...out, reason: 'too far' };
  out.inCone = Math.abs(angleDiff(doodle.yaw, yawTo(doodle.pos, player.pos))) <= tuning.fov / 2;
  if (!out.inCone && dist > tuning.closeSense) return { ...out, reason: 'outside cone' };
  if (segmentBlocked(world, [doodle.floorId], eyePoint(doodle), playerTarget(player))) return { ...out, reason: 'blocked' };
  out.visible = true;
  return out;
}

/**
 * Nothing between Doodle and the player at snout height: no catching through
 * walls or closed doors, but it can lean over a ball-pit rim or a low counter.
 */
export function canReach(doodle, player, world) {
  const a = { x: doodle.pos.x, y: doodle.pos.y + 1.0, z: doodle.pos.z };
  const b = { x: player.pos.x, y: player.pos.y + 1.0, z: player.pos.z };
  return !segmentBlocked(world, [doodle.floorId], a, b);
}

// ---------------------------------------------------------------------------
// Darts
// ---------------------------------------------------------------------------

/** Distance along a unit ray to a sphere, or null if it misses within range. */
export function raySphere(origin, dir, range, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0; // starts inside
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= range ? t : null;
}

/** The floor whose surface is closest below a point (where a shot was fired from). */
export function floorAt(world, y) {
  let best = world.floors[0]?.id ?? null;
  let bestY = -Infinity;
  for (const f of world.floors) if (f.y <= y + 0.1 && f.y > bestY) [best, bestY] = [f.id, f.y];
  return best;
}

/**
 * Dart vs Doodle: a ray against bounds(), stopped by walls on the shooter's and
 * Doodle's floors.
 * @returns {number|null} hit distance
 */
export function dartHits(shot, bounds, doodleFloorId, world) {
  const len = Math.hypot(shot.dir.x, shot.dir.y, shot.dir.z) || 1;
  const dir = { x: shot.dir.x / len, y: shot.dir.y / len, z: shot.dir.z / len };
  const t = raySphere(shot.origin, dir, shot.range ?? 30, bounds.center, bounds.radius);
  if (t === null) return null;
  const hit = { x: shot.origin.x + dir.x * t, y: shot.origin.y + dir.y * t, z: shot.origin.z + dir.z * t };
  const floors = [...new Set([floorAt(world, shot.origin.y), doodleFloorId])];
  return segmentBlocked(world, floors, shot.origin, hit) ? null : t;
}
