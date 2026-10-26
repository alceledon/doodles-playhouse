// Following a nav link's polyline (slides and crawl tunnels). Pure logic.

import { lerpV } from '../core/math.js';

/**
 * @param {{x: number, y: number, z: number}[]} points
 * @param {boolean} [reverse]  walk it from the last point to the first
 */
export function createPathFollower(points, reverse = false) {
  const pts = reverse ? points.slice().reverse() : points.slice();
  const lens = [];
  let total = 0;
  for (let k = 1; k < pts.length; k++) {
    const l = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z);
    lens.push(l);
    total += l;
  }
  let s = 0;

  function sample(at) {
    let rest = Math.max(0, Math.min(at, total));
    for (let k = 0; k < lens.length; k++) {
      if (rest <= lens[k] || k === lens.length - 1) {
        const t = lens[k] > 0 ? Math.min(1, rest / lens[k]) : 1;
        const a = pts[k];
        const b = pts[k + 1];
        const len = lens[k] || 1;
        return { pos: lerpV(a, b, t), dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len } };
      }
      rest -= lens[k];
    }
    return { pos: { ...pts[0] }, dir: { x: 0, y: 0, z: -1 } };
  }

  return {
    total,
    start: pts[0],
    end: pts[pts.length - 1],
    progress: () => (total > 0 ? s / total : 1),
    /** Move ds meters along the path. */
    advance(ds) {
      s = Math.min(total, s + ds);
      return { ...sample(s), done: s >= total - 1e-6 };
    },
    sample,
  };
}

/** Yaw that faces a direction on the floor plane (0 = -Z). */
export const yawOf = (dir) => Math.atan2(-dir.x, -dir.z);
