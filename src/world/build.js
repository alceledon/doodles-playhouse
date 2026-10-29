// Layout data → World data, with no THREE. Everything the other areas read
// (colliders, nav, heights, light levels, doors, containers, anchors) is built
// here, so `node --test` checks exactly what the game plays. index.js adds the
// meshes on top using `world.geo`, which describes what to draw.

import { EVENTS } from '../core/events.js';
import { NAV, rasterizeFloor, cellsInBox, worldToCell } from '../core/navgrid.js';
import { createRng } from '../core/rng.js';
import * as PROPS from './props.js';
import { placeProp } from './props.js';
import { tuningFor } from './tuning.js';
import { FLOORS, RAMPS, LINKS, ANCHORS, SET_PIECES } from './layout/index.js';

const EPS = 1e-6;
const v = (x, y, z) => ({ x, y, z });
const box = (minX, maxX, minY, maxY, minZ, maxZ) => ({ minX, maxX, minY, maxY, minZ, maxZ });
const inRect = (x, z, r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

// ---- geometry helpers --------------------------------------------------------------

/**
 * Cut a wall segment by the openings on its line. Returns pieces with
 * relative y ranges: full-height runs, lintels over openings, sills under them.
 */
export function cutWall(seg, openings, y1) {
  const y0 = seg.y0 ?? 0;
  const top = seg.y1 ?? y1;
  const ops = openings
    .filter((o) => o.axis === seg.axis && Math.abs(o.at - seg.at) < EPS && o.to > seg.from + EPS && o.from < seg.to - EPS)
    .map((o) => ({ ...o, from: Math.max(o.from, seg.from), to: Math.min(o.to, seg.to) }))
    .sort((a, b) => a.from - b.from);
  const pieces = [];
  let cur = seg.from;
  for (const o of ops) {
    if (o.from > cur + EPS) pieces.push({ from: cur, to: o.from, y0, y1: top, kind: 'wall' });
    if (o.top < top - EPS) pieces.push({ from: o.from, to: o.to, y0: o.top, y1: top, kind: 'lintel' });
    if ((o.bottom ?? 0) > y0 + EPS) pieces.push({ from: o.from, to: o.to, y0, y1: o.bottom, kind: 'sill' });
    cur = Math.max(cur, o.to);
  }
  if (cur < seg.to - EPS) pieces.push({ from: cur, to: seg.to, y0, y1: top, kind: 'wall' });
  return pieces;
}

/** rect minus holes → list of disjoint rects (grid decomposition over the cut lines). */
export function subtractRects(rect, holes) {
  const hs = holes.filter((h) => h.maxX > rect.minX + EPS && h.minX < rect.maxX - EPS && h.maxZ > rect.minZ + EPS && h.minZ < rect.maxZ - EPS);
  if (!hs.length) return [rect];
  const xs = new Set([rect.minX, rect.maxX]);
  const zs = new Set([rect.minZ, rect.maxZ]);
  for (const h of hs) {
    for (const x of [h.minX, h.maxX]) if (x > rect.minX && x < rect.maxX) xs.add(x);
    for (const z of [h.minZ, h.maxZ]) if (z > rect.minZ && z < rect.maxZ) zs.add(z);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j < Z.length - 1; j++) {
    let run = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2;
      const cz = (Z[j] + Z[j + 1]) / 2;
      const solid = !hs.some((h) => inRect(cx, cz, h));
      if (solid && run) run.maxX = X[i + 1];
      else if (solid) run = { minX: X[i], maxX: X[i + 1], minZ: Z[j], maxZ: Z[j + 1] };
      else if (run) {
        out.push(run);
        run = null;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

const rampY = (ramp, coord, yLow, yHigh) => {
  const t = Math.min(1, Math.max(0, (coord - ramp.lowAt) / (ramp.highAt - ramp.lowAt)));
  return { t, y: yLow + t * (yHigh - yLow) };
};

// ---- the builder ---------------------------------------------------------------------

/**
 * @param {{difficulty?: string, bus?: import('../core/events.js').Bus,
 *          onDoorChange?: (door) => void, onContainerChange?: (c) => void}} [opts]
 * @returns {import('../core/contracts.js').World & {geo: Object, staticBoxes: Object, tuning: Object}}
 */
export function buildWorldData({ difficulty = 'normal', bus = null, onDoorChange = null, onContainerChange = null } = {}) {
  const tuning = tuningFor(difficulty);
  const emit = (type, payload) => bus?.emit(type, payload);
  const floorById = Object.fromEntries(FLOORS.map((f) => [f.id, f]));
  const floorY = Object.fromEntries(FLOORS.map((f) => [f.id, f.y]));
  const floors = FLOORS.map((f) => ({ id: f.id, y: f.y }));

  const rooms = FLOORS.flatMap((f) => f.rooms.map((r) => ({ id: r.id, name: r.name, floorId: f.id, bounds: { ...r.bounds } })));
  function roomAt(pos, floorId) {
    for (const r of rooms) if (r.floorId === floorId && inRect(pos.x, pos.z, r.bounds)) return r;
    return null;
  }
  const roomIdAt = (floorId, x, z) => roomAt({ x, z }, floorId)?.id;

  /** Everything meshes.js needs to draw, grouped per floor. */
  const geo = {
    floors: [],
    wallBoxes: [],
    parts: Object.fromEntries(FLOORS.map((f) => [f.id, []])),
    rugs: [],
    moving: [],
    doorSpecs: [],
    proxies: [],
    decals: [],
    windows: [],
    creaky: [],
    ballPits: [],
    chutes: [],
    tunnels: [],
    mobiles: [],
    teddies: [],
    ramps: [],
    roof: null,
    setPieces: SET_PIECES,
  };
  const staticBoxes = Object.fromEntries(FLOORS.map((f) => [f.id, []]));
  const navHoles = Object.fromEntries(FLOORS.map((f) => [f.id, []]));
  const navMarks = Object.fromEntries(FLOORS.map((f) => [f.id, []]));
  const slabHoles = Object.fromEntries(FLOORS.map((f) => [f.id, [...(f.slabHoles ?? [])]]));
  const collidersDirty = Object.fromEntries(FLOORS.map((f) => [f.id, true])); // closed-door lists to rebuild
  const hideSpots = [];
  const wallSpots = {};
  const containerSpecs = [];

  // ---- ramps: holes in both floors' nav, holes in the upper slab ----
  for (const ramp of RAMPS) {
    navHoles[ramp.lowFloor].push(ramp.footprint);
    navHoles[ramp.highFloor].push(ramp.footprint);
    slabHoles[ramp.highFloor].push(ramp.footprint);
    geo.ramps.push({ ...ramp, yLow: floorY[ramp.lowFloor], yHigh: floorY[ramp.highFloor] });
  }

  // ---- per floor: walls, railings, props, containers, hides ----
  for (const f of FLOORS) {
    const y = f.y;
    const parts = geo.parts[f.id];
    const boxes = staticBoxes[f.id];
    const addPlaced = (placed, { collide = true } = {}) => {
      parts.push(...placed.parts);
      if (collide) boxes.push(...placed.colliders);
    };
    geo.floors.push({
      id: f.id, y, height: f.height, bounds: { ...f.bounds },
      rooms: f.rooms.map((r) => ({ ...r, bounds: { ...r.bounds } })),
      slabHoles: slabHoles[f.id],
    });
    if (f.roof) geo.roof = { floorId: f.id, y, bounds: { ...f.bounds }, ...f.roof };

    // walls (doors and arches cut openings)
    const openings = [
      ...f.openings,
      ...f.doors.map((d) => ({ axis: d.axis, at: d.at, from: d.from, to: d.to, bottom: 0, top: d.height })),
    ];
    for (const seg of f.walls) {
      const t = seg.t ?? 0.2;
      const b = f.bounds;
      // outer walls grow by half a thickness at the corners so they close; inner
      // walls stop at the outer wall's centreline, inside it, so no faces overlap
      const onEdge = (val, lo, hi) => Math.abs(val - lo) < EPS || Math.abs(val - hi) < EPS;
      const [along, across] = seg.axis === 'x' ? [[b.minX, b.maxX], [b.minZ, b.maxZ]] : [[b.minZ, b.maxZ], [b.minX, b.maxX]];
      const ext = { ...seg };
      if (onEdge(seg.at, ...across)) {
        if (onEdge(seg.from, ...along)) ext.from = seg.from - t / 2;
        if (onEdge(seg.to, ...along)) ext.to = seg.to + t / 2;
      }
      for (const pc of cutWall(ext, openings, f.height)) {
        const bx = seg.axis === 'x'
          ? box(pc.from, pc.to, y + pc.y0, y + pc.y1, seg.at - t / 2, seg.at + t / 2)
          : box(seg.at - t / 2, seg.at + t / 2, y + pc.y0, y + pc.y1, pc.from, pc.to);
        boxes.push(bx);
        geo.wallBoxes.push({ floorId: f.id, box: bx, axis: seg.axis, kind: pc.kind, gable: !!seg.gable, t });
      }
    }

    // railings
    for (const r of f.railings) {
      const h = r.h;
      const bx = r.axis === 'x' ? box(r.from, r.to, y, y + h, r.at - 0.05, r.at + 0.05) : box(r.at - 0.05, r.at + 0.05, y, y + h, r.from, r.to);
      boxes.push(bx);
      const len = r.to - r.from;
      const mid = (r.from + r.to) / 2;
      const at = (s, py, sx, sy, sz, c) => (r.axis === 'x' ? { s: 'box', p: [s, py, r.at], d: [sx, sy, sz], m: 'wood', c } : { s: 'box', p: [r.at, py, s], d: [sz, sy, sx], m: 'wood', c });
      parts.push(at(mid, y + h - 0.04, len, 0.08, 0.1, 0xf3e2c0));
      parts.push(at(mid, y + 0.06, len, 0.08, 0.08, 0xf3e2c0));
      const n = Math.max(2, Math.round(len / 0.28));
      for (let i = 0; i <= n; i++) parts.push(at(r.from + 0.03 + (i * (len - 0.06)) / n, y + h / 2, 0.045, h - 0.08, 0.045, i % 2 ? 0xf07ab8 : 0x9ad0f0));
    }

    // static props
    for (const pr of f.props) {
      const builder = PROPS[pr.type];
      if (!builder) throw new Error(`world: unknown prop type "${pr.type}"`);
      const placed = placeProp(builder(pr.opts ?? {}), pr.x, y + (pr.y ?? 0), pr.z, pr.rot ?? 0);
      if (pr.rugStyle) {
        geo.rugs.push({ floorId: f.id, style: pr.rugStyle, part: placed.parts[0], color: pr.opts?.color });
        continue;
      }
      addPlaced(placed);
      if (pr.tag) geo.proxies.push({ floorId: f.id, box: placed.boxes.use ?? boundsOf(placed.colliders), tag: pr.tag });
      if (placed.mobile) geo.mobiles.push({ floorId: f.id, pos: placed.points.mobile });
    }

    // wall-mounted interactables: keypad, garage opener, fuse box
    for (const wp of f.wallProps) {
      const placed = placeProp(PROPS[wp.type](), wp.x, y + wp.y, wp.z, wp.rot);
      parts.push(...placed.parts);
      const kind = wp.type === 'openerButton' ? 'opener' : wp.type;
      geo.proxies.push({ floorId: f.id, box: placed.boxes.use, tag: { kind, id: wp.id } });
      wallSpots[wp.id] = { id: wp.id, floorId: f.id, pos: placed.points.use, rotY: wp.rot, roomId: roomIdAt(f.id, wp.x, wp.z) };
    }

    // containers: static body + one moving part each
    for (const c of f.containers) {
      const placed = placeProp(PROPS[c.type](c.opts ?? {}), c.x, y, c.z, c.rot);
      addPlaced(placed);
      for (const mv of placed.moving) geo.moving.push({ floorId: f.id, containerId: c.id, ...mv });
      containerSpecs.push({ ...c, floorId: f.id, use: placed.points.use, item: placed.points.item, itemId: c.item, roomId: roomIdAt(f.id, c.x, c.z) });
    }

    // hiding spots
    for (const h of f.hides) {
      const local = PROPS[h.type](h.opts ?? {});
      const placed = placeProp(local, h.x, y, h.z, h.rot);
      addPlaced(placed);
      geo.proxies.push({ floorId: f.id, box: placed.boxes.use, tag: { kind: 'hide', id: h.id } });
      if (h.kind === 'ballpit') {
        navHoles[f.id].push(placed.boxes.hole);
        geo.ballPits.push({ floorId: f.id, inner: placed.boxes.inner });
      }
      if (placed.mobile) geo.mobiles.push({ floorId: f.id, pos: placed.points.mobile });
      hideSpots.push({
        id: h.id, kind: h.kind, floorId: f.id, roomId: roomIdAt(f.id, h.x, h.z), rotY: h.rot,
        pos: placed.points.use, eyePos: placed.points.eye, yaw: placed.yaws.eye, exitPos: placed.points.exit,
      });
    }

    // nav marks: crawl spaces (doors are added below)
    for (const m of f.marks) navMarks[f.id].push({ box: m.box, flags: m.crawl ? NAV.PLAYER_ONLY | NAV.CRAWL | NAV.WALK : m.flags });
    navHoles[f.id].push(...f.holes);

    // decals, windows
    for (const d of f.decals) geo.decals.push({ floorId: f.id, tex: d.tex, pos: v(d.x, y + d.y, d.z), rotY: d.rotY, w: d.w, h: d.h, floor: !!d.floor });
    for (const w of f.windows) geo.windows.push(windowGeo(f, w));
  }

  // ---- stairs: steps for the meshes ----
  for (const r of geo.ramps) {
    const n = 12;
    const style = r.style;
    const { inner } = r;
    const dir = Math.sign(r.highAt - r.lowAt);
    const run = Math.abs(r.highAt - r.lowAt) / n;
    const rise = (r.yHigh - r.yLow) / n;
    for (let k = 0; k < n; k++) {
      const z0 = r.lowAt + dir * k * run;
      const z1 = z0 + dir * run;
      const top = r.yLow + (k + 0.6) * rise;
      const cz = (z0 + z1) / 2;
      const w = inner.maxX - inner.minX;
      const cx = (inner.minX + inner.maxX) / 2;
      const color = style === 'rainbow' ? [0xd8343c, 0xf08a24, 0xf5d03a, 0x45b85a, 0x3a7be0, 0x8a52d0][k % 6] : k % 2 ? 0x6e4528 : 0x7a5030;
      geo.parts[r.lowFloor].push({ s: 'box', p: [cx, (r.yLow + top) / 2, cz], d: [w, top - r.yLow, run], m: 'wood', c: color });
      geo.parts[r.lowFloor].push({ s: 'box', p: [cx, top + 0.015, cz + dir * run * 0.1], d: [w, 0.03, run * 0.85], m: 'wood', c: style === 'rainbow' ? 0xf3e2c0 : 0x8a6040 });
    }
  }

  // ---- nav ----
  const doorFlags = NAV.DOOR | NAV.WALK;
  const doorSpecs = FLOORS.flatMap((f) => f.doors.map((d) => ({ ...d, floorId: f.id, y: f.y })));
  for (const d of doorSpecs) {
    d.cellBox = d.cellBox ?? (d.axis === 'x' ? { minX: d.from, maxX: d.to, minY: 0, maxY: 0, minZ: d.at - 0.5, maxZ: d.at + 0.5 } : { minX: d.at - 0.5, maxX: d.at + 0.5, minY: 0, maxY: 0, minZ: d.from, maxZ: d.to });
    navMarks[d.floorId].push({ box: d.cellBox, flags: doorFlags });
  }
  const nav = { cellSize: 0.5, floors: {}, links: [] };
  for (const f of FLOORS) {
    nav.floors[f.id] = rasterizeFloor({
      floorId: f.id, y: f.y, ...f.bounds,
      blockers: staticBoxes[f.id],
      holes: navHoles[f.id],
      marks: navMarks[f.id],
    });
  }
  const cell = (floorId, x, z) => worldToCell(nav, floorId, x, z);
  for (const r of RAMPS) {
    const dir = Math.sign(r.highAt - r.lowAt);
    const yLow = floorY[r.lowFloor];
    const yHigh = floorY[r.highFloor];
    const lowZ = r.lowAt - dir * 0.25;
    const highZ = r.highAt + dir * 0.25;
    nav.links.push({
      id: r.id, kind: 'stairs', from: cell(r.lowFloor, r.lane, lowZ), to: cell(r.highFloor, r.lane, highZ),
      oneWay: false, playerOnly: false, crawl: false,
      points: [v(r.lane, yLow, lowZ), v(r.lane, yLow, r.lowAt), v(r.lane, yHigh, r.highAt), v(r.lane, yHigh, highZ)],
    });
  }
  for (const l of LINKS) {
    nav.links.push({
      id: l.id, kind: l.kind, from: cell(l.from.floorId, l.from.x, l.from.z), to: cell(l.to.floorId, l.to.x, l.to.z),
      oneWay: l.oneWay, playerOnly: l.playerOnly, crawl: l.crawl,
      points: l.points.map(([x, y, z]) => v(x, y, z)),
    });
    if (l.chute) geo.chutes.push({ floorId: l.to.floorId, points: l.chute.map(([x, y, z]) => v(x, y, z)) });
    if (l.interior) geo.tunnels.push({ floorId: l.from.floorId, ...l.interior, points: l.interior.points.map(([x, y, z]) => v(x, y, z)) });
    for (const m of l.mouths ?? []) geo.proxies.push({ floorId: m.floorId, box: m.box, tag: { kind: 'linkEntry', id: l.id } });
  }

  // ---- doors ----
  const doors = doorSpecs.map((spec) => {
    const mid = (spec.from + spec.to) / 2;
    const pos = spec.axis === 'x' ? v(mid, spec.y, spec.at) : v(spec.at, spec.y, mid);
    const collider = spec.axis === 'x'
      ? box(spec.from, spec.to, spec.y, spec.y + spec.height, spec.at - 0.05, spec.at + 0.05)
      : box(spec.at - 0.05, spec.at + 0.05, spec.y, spec.y + spec.height, spec.from, spec.to);
    const loudness = spec.kind === 'rollup' ? 8 : 5;
    const door = {
      id: spec.id,
      floorId: spec.floorId,
      pos,
      isOpen: false,
      locked: !!spec.locked,
      collider,
      cells: cellsInBox(nav, spec.floorId, spec.cellBox),
      // silent: a co-op guest mirroring the host's door. It still moves and collides, but the
      // host already emitted the events, so emitting them again would double every sound.
      setOpen(open, by = 'player', { silent = false } = {}) {
        if (open === door.isOpen) return true;
        if (door.locked && open) return false;
        door.isOpen = open;
        collidersDirty[door.floorId] = true;
        if (!silent) {
          emit(open ? EVENTS.DOOR_OPENED : EVENTS.DOOR_CLOSED, { doorId: door.id, by });
          emit(EVENTS.NOISE, { pos: { ...door.pos }, floorId: door.floorId, loudness, kind: 'door' });
        }
        onDoorChange?.(door);
        return true;
      },
      setLocked(locked) {
        door.locked = locked;
        onDoorChange?.(door);
      },
    };
    geo.doorSpecs.push({ ...spec, pos });
    return door;
  });

  // ---- containers ----
  const containers = containerSpecs.map((spec) => {
    const c = {
      id: spec.id,
      kind: spec.kind,
      floorId: spec.floorId,
      pos: spec.use,
      isOpen: false,
      locked: !!spec.locked,
      itemSpot: { id: `${spec.id}.item`, floorId: spec.floorId, pos: spec.item, containerId: spec.id, roomId: spec.roomId },
      setOpen(open, by = 'player', { silent = false } = {}) {
        if (open === c.isOpen) return true;
        if (c.locked && open) return false;
        c.isOpen = open;
        if (!silent) {
          emit(open ? EVENTS.CONTAINER_OPENED : EVENTS.CONTAINER_CLOSED, { containerId: c.id, by });
          emit(EVENTS.NOISE, { pos: { ...c.pos }, floorId: c.floorId, loudness: 2.5, kind: 'container' });
        }
        onContainerChange?.(c);
        return true;
      },
      setLocked(locked) {
        c.locked = locked;
        onContainerChange?.(c);
      },
    };
    return c;
  });
  const containerById = Object.fromEntries(containers.map((c) => [c.id, c]));

  // ---- anchors ----
  const spotOf = (id, a) => ({ id, floorId: a.floorId, pos: v(a.x, floorY[a.floorId] + (a.y ?? 0), a.z), ...(a.rotY !== undefined ? { rotY: a.rotY } : {}), roomId: roomIdAt(a.floorId, a.x, a.z) });
  const spawns = {};
  const addSpawn = (item, s) => (spawns[item] ??= []).push(s);
  for (const spec of containerSpecs) if (spec.itemId) addSpawn(spec.itemId, containerById[spec.id].itemSpot);
  for (const f of FLOORS) for (const s of f.spawns) addSpawn(s.item, spotOf(s.id, { ...s, floorId: f.id }));

  const traps = [];
  for (const f of FLOORS)
    for (const t of f.traps) {
      if (t.kind === 'creaky' && (t.level ?? 0) > tuning.creakyLevel) continue;
      const spot = { id: t.id, kind: t.kind, floorId: f.id, pos: v(t.x, f.y, t.z), radius: t.radius, roomId: roomIdAt(f.id, t.x, t.z) };
      traps.push(spot);
      if (t.kind === 'creaky') geo.creaky.push(spot);
    }

  const lamps = FLOORS.flatMap((f) =>
    f.lamps.map((l) => ({
      id: l.id, floorId: f.id, pos: v(l.x, f.y + l.y, l.z), color: l.color, intensity: l.intensity, range: l.range,
      flicker: !!l.flicker, fixture: l.fixture ?? 'bulb', rotY: l.rotY ?? 0, cord: l.cord ?? 0, roomId: roomIdAt(f.id, l.x, l.z),
    })),
  );

  const anchors = {
    startBed: spotOf('startBed', ANCHORS.startBed),
    startBed2: spotOf('startBed2', ANCHORS.startBed2),
    kennel: spotOf('kennel', ANCHORS.kennel),
    kennelBed: spotOf('kennelBed', ANCHORS.kennelBed),
    patrol: FLOORS.flatMap((f) => f.patrol.map((p) => spotOf(p.id, { ...p, floorId: f.id }))),
    spawns,
    hideSpots,
    traps,
    drawings: FLOORS.flatMap((f) => f.drawings.map((d) => spotOf(d.id, { ...d, floorId: f.id }))),
    lamps,
    frontDoor: {
      doorId: ANCHORS.frontDoor.doorId,
      padlock: spotOf('frontPadlock', ANCHORS.frontDoor.padlock),
      plank: spotOf('frontPlank', ANCHORS.frontDoor.plank),
      keypad: { ...wallSpots[ANCHORS.frontDoor.keypadId], id: 'frontKeypad' },
      exit: spotOf('frontExit', ANCHORS.frontDoor.exit),
    },
    garage: {
      doorId: ANCHORS.garage.doorId,
      jeep: spotOf('jeep', ANCHORS.garage.jeep),
      opener: { ...wallSpots[ANCHORS.garage.openerId], id: 'garageOpener' },
      exit: spotOf('garageExit', ANCHORS.garage.exit),
    },
    fuseBox: wallSpots[ANCHORS.fuseBoxId],
    atticChest: { containerId: ANCHORS.atticChestId },
  };

  // ---- stuffed animals (data only; meshes.js instances them) ----
  geo.teddies = buildTeddies();

  // ---- queries ----
  const colliderCache = {};
  function colliders(floorId) {
    if (!staticBoxes[floorId]) return [];
    if (collidersDirty[floorId]) {
      const closed = doors.filter((d) => d.floorId === floorId && !d.isOpen).map((d) => d.collider);
      colliderCache[floorId] = staticBoxes[floorId].concat(closed);
      collidersDirty[floorId] = false;
    }
    return colliderCache[floorId];
  }

  function heightAt(x, z, floorHint = 'ground') {
    const hint = floorY[floorHint] !== undefined ? floorHint : 'ground';
    for (const r of RAMPS) {
      if (r.lowFloor !== hint && r.highFloor !== hint) continue;
      if (!inRect(x, z, r.footprint)) continue;
      const { t, y } = rampY(r, r.axis === 'z' ? z : x, floorY[r.lowFloor], floorY[r.highFloor]);
      return { y, floorId: t >= 0.5 ? r.highFloor : r.lowFloor };
    }
    return { y: floorY[hint], floorId: hint };
  }

  const lampsByFloor = Object.fromEntries(FLOORS.map((f) => [f.id, lamps.filter((l) => l.floorId === f.id)]));
  const moonByFloor = Object.fromEntries(FLOORS.map((f) => [f.id, geo.windows.filter((w) => w.floorId === f.id).map((w) => w.patch)]));
  /** Lamps in your room count fully; other rooms' lamps only spill 25% through doorways. Plus moonlight under windows. */
  function lightLevelAt(pos, floorId) {
    let level = 0.06;
    const here = roomAt(pos, floorId)?.id;
    for (const l of lampsByFloor[floorId] ?? []) {
      const d = Math.hypot(pos.x - l.pos.x, pos.y - l.pos.y, pos.z - l.pos.z);
      if (d >= l.range) continue;
      const k = 1 - d / l.range;
      level += l.intensity * k * k * (!here || l.roomId === here ? 1 : 0.25);
    }
    for (const p of moonByFloor[floorId] ?? []) {
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d < 1.6) level += 0.12 * (1 - d / 1.6);
    }
    return Math.min(1, Math.max(0, level));
  }

  return {
    floors,
    rooms,
    colliders,
    heightAt,
    lightLevelAt,
    roomAt,
    nav,
    doors,
    containers,
    anchors,
    interactables: [],
    update() {},
    dispose() {},
    // World-area extras (not part of the contract)
    geo,
    staticBoxes,
    tuning,
    difficulty,
  };
}

function boundsOf(boxes) {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)), maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)), maxY: Math.max(...boxes.map((b) => b.maxY)),
    minZ: Math.min(...boxes.map((b) => b.minZ)), maxZ: Math.max(...boxes.map((b) => b.maxZ)),
  };
}

/** A window on an exterior wall: the moonlit pane faces into the house, and a pool of moonlight lands on the floor below it. */
function windowGeo(f, w) {
  const b = f.bounds;
  const y = f.y;
  let pos;
  let rotY;
  let nx = 0;
  let nz = 0;
  if (w.axis === 'x') {
    const inward = Math.abs(w.at - b.minZ) < Math.abs(w.at - b.maxZ) ? 1 : -1; // +Z if on the north edge
    nz = inward;
    pos = v(w.center, y + w.bottom + w.h / 2, w.at + inward * 0.111);
    rotY = inward > 0 ? Math.PI : 0;
  } else {
    const inward = Math.abs(w.at - b.minX) < Math.abs(w.at - b.maxX) ? 1 : -1;
    nx = inward;
    pos = v(w.at + inward * 0.111, y + w.bottom + w.h / 2, w.center);
    rotY = inward > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  const reach = 0.6 + w.bottom * 0.5;
  return {
    floorId: f.id, pos, rotY, w: w.w, h: w.h, round: !!w.round,
    patch: { x: pos.x + nx * reach, z: pos.z + nz * reach, y: y + 0.006, w: w.w * 1.1, d: 1.2 + w.h * 0.6, nx, nz },
  };
}

/** Seated teddies plus the attic hoard, scattered with a fixed seed so the house looks the same every run. */
function buildTeddies() {
  const out = [];
  const tints = [0xb07a48, 0xc8955a, 0x8a5a32, 0xe8c890, 0xf0a0c0, 0x9ab8e8, 0xf0ece0, 0xd8b040, 0xa0d0a0];
  const rng = createRng('teddies');
  for (const s of SET_PIECES.teddySeats) {
    out.push({ floorId: s.floorId, pos: v(s.x, FLOORS.find((f) => f.id === s.floorId).y + s.y, s.z), yaw: s.rotY, scale: s.scale ?? 1, color: rng.pick(tints), watcher: !!s.watcher });
  }
  const h = SET_PIECES.hoard;
  const hr = createRng(h.seed);
  const fy = FLOORS.find((f) => f.id === h.floorId).y;
  for (let i = 0; i < h.count; i++) {
    const onFloor = i >= h.count - 8; // the last few spill off the mound onto the floorboards
    let x;
    let z;
    let y;
    if (onFloor) {
      x = h.cx + hr.range(-h.w / 2 - 0.2, h.w / 2 + 0.2);
      z = h.cz - h.d / 2 - hr.range(0.25, 0.6);
      y = fy;
    } else {
      x = h.cx + hr.range(-h.w / 2 + 0.25, h.w / 2 - 0.25);
      z = h.cz + hr.range(-h.d / 2 + 0.2, h.d / 2 - 0.2);
      y = fy + h.top + hr.range(0, 0.35);
    }
    const watcher = i < h.watchers;
    out.push({ floorId: h.floorId, pos: v(x, y, z), yaw: hr.range(-0.7, 0.7), scale: hr.range(0.75, 1.35), color: hr.pick(tints), watcher, tilt: onFloor ? hr.range(-0.4, 0.4) : hr.range(-0.2, 0.2) });
  }
  return out;
}
