// Doodle path planning. Pure logic: A* over the shared nav grid (using
// navgrid.js neighbors(), so Doodle agrees with everyone on what's passable),
// then string-pulling into a short list of waypoints that follow link points
// on stairs.
//
// The Doodle never uses playerOnly links or PLAYER_ONLY cells (neighbors()
// enforces both for AGENTS.DOODLE), and we additionally treat the cells of
// locked doors as solid.

import { AGENTS, cellCenter, isPassable, neighbors, refKey, worldToCell, nearestPassable } from '../core/navgrid.js';

const D = AGENTS.DOODLE;

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

/** refKey → door, for every doorway cell. Built once per door list. */
const doorIndexCache = new WeakMap();
export function doorIndex(doors) {
  let idx = doorIndexCache.get(doors);
  if (!idx) {
    idx = new Map();
    for (const door of doors) for (const ref of door.cells) idx.set(refKey(ref), door);
    doorIndexCache.set(doors, idx);
  }
  return idx;
}

/** Keys of cells the Doodle can't enter right now: every locked door's doorway. */
export function lockedCells(doors) {
  const out = new Set();
  for (const door of doors) if (door.locked) for (const ref of door.cells) out.add(refKey(ref));
  return out;
}

export const doodlePassable = (nav, ref, blocked) => isPassable(nav, ref, D) && !blocked?.has(refKey(ref));

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

/** Dense ids for every cell of every floor, so A* can use typed arrays. */
const layoutCache = new WeakMap();
function layout(nav) {
  let l = layoutCache.get(nav);
  if (!l) {
    const base = {};
    const floors = [];
    let total = 0;
    for (const [floorId, g] of Object.entries(nav.floors)) {
      base[floorId] = total;
      floors.push({ floorId, start: total, w: g.w });
      total += g.w * g.h;
    }
    l = { base, floors, total, g: new Float64Array(total), from: new Int32Array(total), seen: new Uint32Array(total), closed: new Uint32Array(total), gen: 0, via: new Map() };
    layoutCache.set(nav, l);
  }
  return l;
}

const idOf = (l, nav, ref) => l.base[ref.floorId] + ref.j * nav.floors[ref.floorId].w + ref.i;
function refOf(l, id) {
  let f = l.floors[0];
  for (const x of l.floors) if (x.start <= id) f = x;
  const k = id - f.start;
  return { floorId: f.floorId, i: k % f.w, j: Math.floor(k / f.w) };
}

/** Minimal binary heap of [priority, id]. */
function createHeap() {
  const pri = [];
  const ids = [];
  return {
    get size() {
      return ids.length;
    },
    push(p, id) {
      let k = ids.length;
      pri.push(p);
      ids.push(id);
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (pri[parent] <= p) break;
        pri[k] = pri[parent];
        ids[k] = ids[parent];
        k = parent;
      }
      pri[k] = p;
      ids[k] = id;
    },
    pop() {
      const top = ids[0];
      const lastP = pri.pop();
      const lastId = ids.pop();
      const n = ids.length;
      if (n > 0) {
        let k = 0;
        for (;;) {
          let c = 2 * k + 1;
          if (c >= n) break;
          if (c + 1 < n && pri[c + 1] < pri[c]) c++;
          if (pri[c] >= lastP) break;
          pri[k] = pri[c];
          ids[k] = ids[c];
          k = c;
        }
        pri[k] = lastP;
        ids[k] = lastId;
      }
      return top;
    },
  };
}

/**
 * A* from one cell to another for the Doodle.
 * @param {Object} nav
 * @param {CellRef} start
 * @param {CellRef} goal
 * @param {{blocked?: Set<string>, maxNodes?: number}} [opts]  blocked = refKeys treated as solid (locked doors)
 * @returns {{steps: {ref: CellRef, link?: Object, reverse?: boolean}[], complete: boolean, cost: number}}
 *   steps[0] is the start cell. A step with `link` was reached by crossing that link.
 *   When the goal can't be reached, the path leads to the explored cell closest to it (complete = false).
 */
export function findPath(nav, start, goal, { blocked = null, maxNodes = 60000 } = {}) {
  const l = layout(nav);
  if (++l.gen === 0xffffffff) {
    l.seen.fill(0);
    l.closed.fill(0);
    l.gen = 1;
  }
  const gen = l.gen;
  l.via.clear();
  const goalC = cellCenter(nav, goal);
  const h = (ref) => {
    const c = cellCenter(nav, ref);
    return Math.hypot(c.x - goalC.x, c.z - goalC.z);
  };
  const startId = idOf(l, nav, start);
  const goalId = idOf(l, nav, goal);
  const goalOk = doodlePassable(nav, goal, blocked);
  const heap = createHeap();
  l.g[startId] = 0;
  l.from[startId] = -1;
  l.seen[startId] = gen;
  heap.push(h(start), startId);
  let best = startId;
  let bestH = h(start);
  let expanded = 0;
  let found = false;

  while (heap.size && expanded < maxNodes) {
    const id = heap.pop();
    if (l.closed[id] === gen) continue;
    l.closed[id] = gen;
    expanded++;
    if (id === goalId) {
      found = true;
      break;
    }
    const ref = refOf(l, id);
    const hh = h(ref);
    if (hh < bestH) {
      bestH = hh;
      best = id;
    }
    for (const n of neighbors(nav, ref, D)) {
      if (blocked?.has(refKey(n.ref))) continue;
      const nid = idOf(l, nav, n.ref);
      if (l.closed[nid] === gen) continue;
      const g = l.g[id] + n.cost;
      if (l.seen[nid] === gen && g >= l.g[nid]) continue;
      l.seen[nid] = gen;
      l.g[nid] = g;
      l.from[nid] = id;
      if (n.link) l.via.set(nid, { link: n.link, reverse: n.reverse });
      else l.via.delete(nid);
      heap.push(g + h(n.ref), nid);
    }
  }

  const endId = found && goalOk ? goalId : best;
  const steps = [];
  for (let id = endId; id !== -1; id = l.from[id]) {
    const via = l.via.get(id);
    steps.push(via ? { ref: refOf(l, id), link: via.link, reverse: via.reverse } : { ref: refOf(l, id) });
    if (id === startId) break;
  }
  steps.reverse();
  return { steps, complete: found && goalOk, cost: l.g[endId] };
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Can the Doodle walk straight from a to b on one floor? Samples the line
 * plus two parallel lines `clearance` to each side, so smoothed paths don't
 * shave wall corners or squeeze diagonally past doorframes.
 */
export function lineWalkable(nav, floorId, a, b, blocked = null, clearance = 0.2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const nx = (-dz / len) * clearance;
  const nz = (dx / len) * clearance;
  const steps = Math.max(1, Math.ceil(len / (nav.cellSize * 0.25)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    for (const k of [0, -1, 1]) {
      const ref = worldToCell(nav, floorId, x + nx * k, z + nz * k);
      if (!ref || !doodlePassable(nav, ref, blocked)) return false;
    }
  }
  return true;
}

/** Greedy string-pull: keep only the points you can't skip past in a straight line. */
function pull(nav, floorId, pts, blocked) {
  const out = [];
  let k = 0;
  while (k < pts.length - 1) {
    let m = k + 1;
    while (m + 1 < pts.length && lineWalkable(nav, floorId, pts[k], pts[m + 1], blocked)) m++;
    out.push(pts[m]);
    k = m;
  }
  return out;
}

/**
 * Turn A* steps into waypoints the mover follows.
 * @param {Object} nav
 * @param {{ref: CellRef, link?: Object, reverse?: boolean}[]} steps   from findPath
 * @param {Vec3} startPos   where the Doodle is now
 * @param {Vec3|null} endPos   exact point to finish on (used if it's in the last cell's floor and reachable in a line)
 * @param {Set<string>} [blocked]
 * @returns {{x: number, y: number, z: number, floorId: string, link: null|{id: string, fromFloor: string, toFloor: string, midY: number}}[]}
 */
export function buildRoute(nav, steps, startPos, endPos, blocked = null) {
  if (!steps.length) return [];
  // Split the steps into same-floor runs joined by links.
  const runs = [];
  let run = { cells: [steps[0].ref], linkIn: null };
  for (let k = 1; k < steps.length; k++) {
    const s = steps[k];
    if (s.link) {
      runs.push(run);
      run = { cells: [s.ref], linkIn: s };
    } else run.cells.push(s.ref);
  }
  runs.push(run);

  const out = [];
  const flat = (p, floorId) => ({ x: p.x, y: nav.floors[floorId].y, z: p.z, floorId, link: null });
  let from = startPos;
  for (let r = 0; r < runs.length; r++) {
    const { cells } = runs[r];
    const floorId = cells[0].floorId;
    const next = runs[r + 1];
    const linkPts = next ? (next.linkIn.reverse ? next.linkIn.link.points.slice().reverse() : next.linkIn.link.points) : null;
    // Where this run ends: the link's first point, the exact goal, or the last cell's center.
    let end;
    if (linkPts) end = linkPts[0];
    else {
      const last = cells[cells.length - 1];
      const c = cellCenter(nav, last);
      const endRef = endPos && worldToCell(nav, floorId, endPos.x, endPos.z);
      end = endRef && refKey(endRef) === refKey(last) && doodlePassable(nav, endRef, blocked) ? endPos : c;
    }
    const pts = [from, ...cells.slice(1, -1).map((ref) => cellCenter(nav, ref)), end];
    for (const p of pull(nav, floorId, pts, blocked)) out.push(flat(p, floorId));
    if (linkPts) {
      const link = next.linkIn.link;
      const fromFloor = floorId;
      const toFloor = next.cells[0].floorId;
      const midY = (nav.floors[fromFloor].y + nav.floors[toFloor].y) / 2;
      const info = { id: link.id, fromFloor, toFloor, midY };
      for (let k = 1; k < linkPts.length; k++) out.push({ x: linkPts[k].x, y: linkPts[k].y, z: linkPts[k].z, floorId: toFloor, link: info });
      from = linkPts[linkPts.length - 1];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One-call planner
// ---------------------------------------------------------------------------

/**
 * Plan a route for the Doodle from where it stands to a target point.
 * @returns {{route: Object[], complete: boolean, goal: CellRef|null, end: Vec3|null, length: number}}
 *   end = where the route finishes (== target when complete and the target is standable)
 */
export function planRoute(world, from, fromFloorId, target, targetFloorId, { snapDist = 2.0 } = {}) {
  const nav = world.nav;
  const blocked = lockedCells(world.doors);
  const start = snapCell(nav, fromFloorId, from, blocked, 1.5);
  const goal = snapCell(nav, targetFloorId, target, blocked, snapDist);
  if (!start || !goal) return { route: [], complete: false, goal: null, end: null, length: 0 };
  const { steps, complete } = findPath(nav, start, goal, { blocked });
  const lastRef = steps[steps.length - 1].ref;
  const route = buildRoute(nav, steps, from, complete && targetFloorId === lastRef.floorId ? target : null, blocked);
  let length = 0;
  let prev = from;
  for (const w of route) {
    length += Math.hypot(w.x - prev.x, w.y - prev.y, w.z - prev.z);
    prev = w;
  }
  const end = route.length ? route[route.length - 1] : { ...from, floorId: fromFloorId };
  return { route, complete, goal, end, length };
}

/** Nearest Doodle-passable cell that isn't a locked doorway. */
export function snapCell(nav, floorId, p, blocked, maxDist) {
  const direct = worldToCell(nav, floorId, p.x, p.z);
  if (direct && doodlePassable(nav, direct, blocked)) return direct;
  const near = nearestPassable(nav, floorId, p.x, p.z, D, maxDist);
  if (near && !blocked?.has(refKey(near))) return near;
  if (!near) return null;
  // The nearest one is a locked doorway: widen the search by hand.
  const g = nav.floors[floorId];
  let best = null;
  let bestD = Infinity;
  const r = Math.ceil(maxDist / nav.cellSize) + 1;
  for (let j = near.j - r; j <= near.j + r; j++)
    for (let i = near.i - r; i <= near.i + r; i++) {
      const ref = { floorId, i, j };
      if (i < 0 || j < 0 || i >= g.w || j >= g.h || !doodlePassable(nav, ref, blocked)) continue;
      const c = cellCenter(nav, ref);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = ref;
      }
    }
  return best;
}
