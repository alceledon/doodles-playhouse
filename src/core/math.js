// Small vector helpers on plain {x, y, z} objects. Pure-logic code (nav, AI,
// items, locks) uses these instead of THREE.Vector3 so it runs under node --test.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const copy = (p) => ({ x: p.x, y: p.y, z: p.z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpV = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Distance on the floor plane (ignores height). */
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function normalize(a) {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/** Yaw (radians) facing from a to b on the floor plane. 0 = facing -Z, matching a Three.js camera's default view direction. */
export const yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** Smallest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Is a point inside an axis-aligned box? (Box = {minX,maxX,minY,maxY,minZ,maxZ}) */
export const pointInBox = (p, b) =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY && p.z >= b.minZ && p.z <= b.maxZ;

/** Does a floor-plane circle overlap a box's floor-plane footprint? */
export function circleHitsBox2D(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}
