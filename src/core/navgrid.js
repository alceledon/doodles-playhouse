// Shared navigation-grid semantics. World BUILDS grids with rasterizeFloor();
// Doodle SEARCHES them (its own A* in src/doodle/) using neighbors() from here,
// so everyone agrees on what "passable" and "connected" mean.
//
// One grid per floor, cells cellSize meters square. Cell (i, j) covers
// x in [originX + i*cs, originX + (i+1)*cs), z likewise with j. Floors are
// joined by NavLinks (stairs, slides, tunnels).

import { circleHitsBox2D, dist } from './math.js';

/** Cell flags (bitmask). A cell with neither WALK nor DOOR is solid. */
export const NAV = Object.freeze({
  WALK: 1, // anyone can stand here
  DOOR: 2, // doorway — passable; the Doodle opens closed doors as it walks through
  PLAYER_ONLY: 4, // the Doodle never enters (crawl spaces, the inside of play tunnels)
  CRAWL: 8, // the player must crouch here (low ceiling)
});

export const AGENTS = Object.freeze({ PLAYER: 'player', DOODLE: 'doodle' });

export const refKey = (ref) => `${ref.floorId}:${ref.i}:${ref.j}`;

export function parseKey(key) {
  const [floorId, i, j] = key.split(':');
  return { floorId, i: Number(i), j: Number(j) };
}

export const cellIndex = (grid, i, j) => j * grid.w + i;
export const inBounds = (grid, i, j) => i >= 0 && j >= 0 && i < grid.w && j < grid.h;

/** World position → cell on a floor, or null if off the grid. */
export function worldToCell(nav, floorId, x, z) {
  const g = nav.floors[floorId];
  if (!g) return null;
  const i = Math.floor((x - g.originX) / nav.cellSize);
  const j = Math.floor((z - g.originZ) / nav.cellSize);
  return inBounds(g, i, j) ? { floorId, i, j } : null;
}

/** Center of a cell, at the floor's surface height. */
export function cellCenter(nav, ref) {
  const g = nav.floors[ref.floorId];
  return {
    x: g.originX + (ref.i + 0.5) * nav.cellSize,
    y: g.y,
    z: g.originZ + (ref.j + 0.5) * nav.cellSize,
  };
}

export function flagsAt(nav, ref) {
  const g = nav.floors[ref.floorId];
  if (!g || !inBounds(g, ref.i, ref.j)) return 0;
  return g.cells[cellIndex(g, ref.i, ref.j)];
}

export function isPassable(nav, ref, agent) {
  const f = flagsAt(nav, ref);
  if (!(f & (NAV.WALK | NAV.DOOR))) return false;
  if (agent === AGENTS.DOODLE && f & NAV.PLAYER_ONLY) return false;
  return true;
}

const linkIndexCache = new WeakMap();

/** Map of refKey → links touching that cell, built once per nav object. */
function linkIndex(nav) {
  let idx = linkIndexCache.get(nav);
  if (!idx) {
    idx = new Map();
    for (const link of nav.links) {
      const push = (key, entry) => {
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push(entry);
      };
      push(refKey(link.from), { link, to: link.to, reverse: false });
      if (!link.oneWay) push(refKey(link.to), { link, to: link.from, reverse: true });
    }
    linkIndexCache.set(nav, idx);
  }
  return idx;
}

export function polylineLength(points) {
  let len = 0;
  for (let k = 1; k < points.length; k++) len += dist(points[k - 1], points[k]);
  return len;
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Passable neighbors of a cell for an agent: 8-way on the same floor (no
 * cutting corners past solid cells) plus any links leaving this cell.
 * @returns {{ref: CellRef, cost: number, link?: NavLink, reverse?: boolean}[]}
 */
export function neighbors(nav, ref, agent) {
  const out = [];
  const g = nav.floors[ref.floorId];
  if (!g) return out;
  const cs = nav.cellSize;
  for (const [di, dj] of DIRS) {
    const n = { floorId: ref.floorId, i: ref.i + di, j: ref.j + dj };
    if (!isPassable(nav, n, agent)) continue;
    if (di !== 0 && dj !== 0) {
      const a = { floorId: ref.floorId, i: ref.i + di, j: ref.j };
      const b = { floorId: ref.floorId, i: ref.i, j: ref.j + dj };
      if (!isPassable(nav, a, agent) || !isPassable(nav, b, agent)) continue;
      out.push({ ref: n, cost: cs * Math.SQRT2 });
    } else {
      out.push({ ref: n, cost: cs });
    }
  }
  const links = linkIndex(nav).get(refKey(ref));
  if (links)
    for (const { link, to, reverse } of links) {
      if (agent === AGENTS.DOODLE && link.playerOnly) continue;
      if (!isPassable(nav, to, agent)) continue;
      out.push({ ref: to, cost: polylineLength(link.points), link, reverse });
    }
  return out;
}

/**
 * Nearest passable cell to a world point on a floor, searching outward up to
 * maxDist meters. Use it to snap spots (items on shelves, wall objects) to
 * the cell you'd stand on to reach them.
 */
export function nearestPassable(nav, floorId, x, z, agent, maxDist = 1.5) {
  const g = nav.floors[floorId];
  if (!g) return null;
  const cs = nav.cellSize;
  const ci = Math.floor((x - g.originX) / cs);
  const cj = Math.floor((z - g.originZ) / cs);
  const maxR = Math.ceil(maxDist / cs) + 1;
  let best = null;
  let bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // ring only
        const ref = { floorId, i, j };
        if (!isPassable(nav, ref, agent)) continue;
        const c = cellCenter(nav, ref);
        const d = Math.hypot(c.x - x, c.z - z);
        if (d <= maxDist && d < bestD) {
          bestD = d;
          best = ref;
        }
      }
    }
    if (best && r * cs > bestD + cs) break;
  }
  return best;
}

/** Every cell key reachable from start for an agent (breadth-first). */
export function reachableSet(nav, start, agent) {
  const seen = new Set();
  if (!start || !isPassable(nav, start, agent)) return seen;
  const queue = [start];
  seen.add(refKey(start));
  while (queue.length) {
    const cur = queue.shift();
    for (const { ref } of neighbors(nav, cur, agent)) {
      const k = refKey(ref);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(ref);
      }
    }
  }
  return seen;
}

/** Cells whose centers lie inside a box's floor footprint. */
export function cellsInBox(nav, floorId, box) {
  const g = nav.floors[floorId];
  const out = [];
  if (!g) return out;
  const cs = nav.cellSize;
  for (let j = 0; j < g.h; j++) {
    const z = g.originZ + (j + 0.5) * cs;
    if (z < box.minZ || z > box.maxZ) continue;
    for (let i = 0; i < g.w; i++) {
      const x = g.originX + (i + 0.5) * cs;
      if (x >= box.minX && x <= box.maxX) out.push({ floorId, i, j });
    }
  }
  return out;
}

/**
 * Build one floor's grid.
 * A cell is WALK when a body of `clearance` radius at its center hits no
 * blocker whose Y range overlaps [y + 0.05, y + kneeHeight] (so rugs don't
 * block, and crawl-under ceilings above knee height don't either).
 * Then `holes` clear cells (stairwells, ball-pit interiors) and `marks` OR
 * extra flags onto cells (doorways → DOOR|WALK, crawl spaces →
 * PLAYER_ONLY|CRAWL|WALK). Marks are applied last and override blockers.
 *
 * @param {{floorId: string, y: number, minX: number, maxX: number, minZ: number, maxZ: number,
 *          cellSize?: number, blockers?: Box[], holes?: Box[], marks?: {box: Box, flags: number}[],
 *          clearance?: number, kneeHeight?: number}} spec
 * @returns {NavFloor}
 */
export function rasterizeFloor(spec) {
  const {
    floorId, y, minX, maxX, minZ, maxZ,
    cellSize = 0.5, blockers = [], holes = [], marks = [],
    clearance = 0.25, kneeHeight = 0.6,
  } = spec;
  const w = Math.ceil((maxX - minX) / cellSize - 1e-9);
  const h = Math.ceil((maxZ - minZ) / cellSize - 1e-9);
  const cells = new Uint8Array(w * h);
  const lo = y + 0.05;
  const hi = y + kneeHeight;
  const solid = blockers.filter((b) => b.maxY > lo && b.minY < hi);
  const inside = (x, z, b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  for (let j = 0; j < h; j++) {
    const z = minZ + (j + 0.5) * cellSize;
    for (let i = 0; i < w; i++) {
      const x = minX + (i + 0.5) * cellSize;
      let f = NAV.WALK;
      for (const b of solid)
        if (circleHitsBox2D(x, z, clearance, b)) {
          f = 0;
          break;
        }
      for (const b of holes) if (inside(x, z, b)) f = 0;
      for (const m of marks) if (inside(x, z, m.box)) f |= m.flags;
      cells[j * w + i] = f;
    }
  }
  return { floorId, y, originX: minX, originZ: minZ, w, h, cells };
}

/**
 * Reachability rules every World must satisfy (World's tests and the
 * coordinator's integration test both run this).
 * @returns {string[]} errors
 */
export function checkReachability(world) {
  const errors = [];
  const { nav, anchors } = world;
  const P = AGENTS.PLAYER;
  const D = AGENTS.DOODLE;
  const snap = (spot, agent) => nearestPassable(nav, spot.floorId, spot.pos.x, spot.pos.z, agent, 1.5);

  const start = snap(anchors.startBed, P);
  if (!start) return ['startBed has no passable cell within 1.5 m'];
  const playerSet = reachableSet(nav, start, P);

  const mustReach = [];
  const add = (spot, label) => spot && mustReach.push([spot, label]);
  add(anchors.kennel, 'kennel');
  add(anchors.kennelBed, 'kennelBed');
  add(anchors.fuseBox, 'fuseBox');
  for (const [k, s] of Object.entries(anchors.frontDoor)) if (k !== 'doorId' && k !== 'exit') add(s, `frontDoor.${k}`);
  for (const [k, s] of Object.entries(anchors.garage)) if (k !== 'doorId' && k !== 'exit') add(s, `garage.${k}`);
  for (const [item, spots] of Object.entries(anchors.spawns)) for (const s of spots) add(s, `spawns.${item} "${s.id}"`);
  for (const s of anchors.hideSpots) add(s, `hideSpot "${s.id}"`);
  for (const s of anchors.drawings) add(s, `drawing "${s.id}"`);
  for (const s of anchors.patrol) add(s, `patrol "${s.id}"`);
  for (const t of anchors.traps) add(t, `trap "${t.id}"`);
  for (const c of world.containers) add(c, `container "${c.id}"`);
  for (const [spot, label] of mustReach) {
    const ref = snap(spot, P);
    if (!ref) errors.push(`${label}: no passable cell within 1.5 m`);
    else if (!playerSet.has(refKey(ref))) errors.push(`${label}: not reachable by the player from startBed`);
  }

  for (const room of world.rooms) {
    const g = nav.floors[room.floorId];
    let found = false;
    for (const key of playerSet) {
      const r = parseKey(key);
      if (r.floorId !== room.floorId) continue;
      const c = cellCenter(nav, r);
      const b = room.bounds;
      if (c.x >= b.minX && c.x <= b.maxX && c.z >= b.minZ && c.z <= b.maxZ) {
        found = true;
        break;
      }
    }
    if (g && !found) errors.push(`room "${room.id}": no cell reachable by the player`);
  }

  // The Doodle must be able to hunt: from the kennel it reaches the start bed
  // and every patrol point. (It can never enter PLAYER_ONLY cells or use
  // playerOnly links — neighbors() enforces that.)
  const kennel = snap(anchors.kennel, D);
  if (!kennel) errors.push('kennel has no Doodle-passable cell within 1.5 m');
  else {
    const doodleSet = reachableSet(nav, kennel, D);
    const bed = snap(anchors.startBed, D);
    if (!bed || !doodleSet.has(refKey(bed))) errors.push('Doodle cannot reach the startBed from the kennel');
    for (const s of anchors.patrol) {
      const ref = snap(s, D);
      if (!ref || !doodleSet.has(refKey(ref))) errors.push(`patrol "${s.id}": Doodle cannot reach it`);
    }
  }
  return errors;
}
