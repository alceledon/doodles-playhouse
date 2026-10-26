// Ray tests against World's collider boxes. Pure math on plain {x, y, z}, so
// it's shared by the interaction raycast (no grabbing through walls), the
// dart (stops at the first wall) and the tests.

/**
 * Slab test: distance along a unit ray to where it enters the box, 0 if it
 * starts inside, or null if it misses within maxT.
 */
export function rayBox(origin, dir, box, maxT = Infinity) {
  let tMin = 0;
  let tMax = maxT;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.y, dir.y, box.minY, box.maxY],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** The nearest box a ray enters within maxT: {t, box} or null. */
export function firstBoxHit(origin, dir, boxes, maxT = Infinity) {
  let best = null;
  for (const box of boxes) {
    const t = rayBox(origin, dir, box, maxT);
    if (t !== null && (!best || t < best.t)) best = { t, box };
  }
  return best;
}

export const boxContains = (box, p, margin = 0) =>
  p.x >= box.minX - margin && p.x <= box.maxX + margin &&
  p.y >= box.minY - margin && p.y <= box.maxY + margin &&
  p.z >= box.minZ - margin && p.z <= box.maxZ + margin;

/**
 * Is a look-ray hit at distance hitT (point hitPoint) hidden behind a wall?
 * Boxes that contain the hit point don't count: they're the thing itself (a
 * door's collider) or what it's tucked into (an item in a drawer).
 */
export function isOccluded(origin, dir, hitT, hitPoint, boxes, margin = 0.1) {
  for (const box of boxes) {
    if (boxContains(box, hitPoint, margin)) continue;
    const t = rayBox(origin, dir, box, hitT);
    if (t !== null && t < hitT - 0.02) return true;
  }
  return false;
}
