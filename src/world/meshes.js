// Static meshes for the whole house, merged by material per floor: walls,
// floors, ceilings, the roof, stairs, every furniture part, rugs, decals,
// windows and their moonlight. Boxes and quads are written straight into
// per-material buckets; round parts (cylinders, spheres, tubes) come from
// THREE's geometries and are folded in with mergeGeometries.

import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { Bucket, pushBox, pushRound, partMatrix, windToward, ONE } from './geom.js';

const _c = new THREE.Color();
const EPS = 1e-4;
/** How far ceilings hang below the slab, so nothing on the slab plane can z-fight them. */
const CEILING_DROP = 0.004;

// ---- the builder -------------------------------------------------------------------

/**
 * @returns {{group: THREE.Group, floorGroups: Object<string, THREE.Group>, ballPits: THREE.InstancedMesh[], dispose: () => void}}
 */
export function buildStaticMeshes(world, tex) {
  const { geo } = world;
  const materials = new Map();
  const group = new THREE.Group();
  group.name = 'worldStatic';
  const floorGroups = {};
  const buckets = {}; // floorId → key → Bucket
  const bucket = (floorId, key) => {
    buckets[floorId] ??= new Map();
    if (!buckets[floorId].has(key)) buckets[floorId].set(key, new Bucket());
    return buckets[floorId].get(key);
  };
  const floorOf = Object.fromEntries(geo.floors.map((f) => [f.id, f]));

  function material(key) {
    if (materials.has(key)) return materials.get(key);
    let m;
    const lambert = (opts) => new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
    if (key.startsWith('tile:')) m = lambert({ map: tex.tiling(key.slice(5)) });
    else
      switch (key) {
        case 'plastic':
        case 'metal':
          m = lambert({});
          break;
        case 'wood':
          m = lambert({ map: tex.tiling('woodGrain') });
          break;
        case 'fabric':
          m = lambert({ map: tex.tiling('fabric') });
          break;
        case 'fabricDS':
          m = lambert({ map: tex.tiling('fabric'), side: THREE.DoubleSide });
          break;
        case 'fur':
          m = lambert({ map: tex.tiling('fur') });
          break;
        case 'slats':
          m = lambert({ map: tex.slats, alphaTest: 0.5, side: THREE.DoubleSide });
          break;
        case 'glow':
        case 'dark':
          m = new THREE.MeshBasicMaterial({ vertexColors: true });
          break;
        case 'decal':
          m = lambert({ map: tex.atlas, alphaTest: 0.5 });
          break;
        case 'window':
          m = new THREE.MeshBasicMaterial({ map: tex.atlas, alphaTest: 0.5, fog: false, vertexColors: true });
          break;
        case 'moonlight':
          m = new THREE.MeshBasicMaterial({ map: tex.atlas, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
          break;
        case 'glowStar':
          m = new THREE.MeshBasicMaterial({ map: tex.atlas, alphaTest: 0.5, vertexColors: true });
          break;
        case 'tunnel':
          m = lambert({ map: tex.tiling('roof'), side: THREE.BackSide });
          break;
        default:
          m = lambert({});
      }
    m.name = key;
    materials.set(key, m);
    return m;
  }

  const atlasUV = (name) => {
    const r = tex.uv(name);
    return [r.u0, r.v0, r.u1, r.v1];
  };
  const tileSize = (name) => tex.tiling(name).userData.size;

  // ---- parts ----
  // Parts of one prop often share a face plane exactly (a cushion flush with its
  // couch, a tub rim with its sides), and those faces z-fight. Each box grows by
  // 0.4..3.2 mm, cycling part to part, so flush neighbours end up apart.
  // Growing only ever pushes a face into the floor, a wall or the next part.
  let partSeq = 0;
  const grow = () => 0.0004 * (1 + (partSeq++ % 8));
  function addPart(floorId, pt) {
    if (pt.m === 'paper') {
      const m = partMatrix(pt);
      const half = [pt.d[0] / 2, pt.d[1] / 2, pt.d[2] / 2];
      pushBox(bucket(floorId, 'plastic'), m, half, 0xf4f0e6, 1, { skip: [3] });
      pushBox(bucket(floorId, 'decal'), m, half, 0xffffff, 1, { faces: [3], uvRect: atlasUV(pt.tex ?? 'drawing1') });
      return;
    }
    const b = bucket(floorId, pt.m);
    if (pt.s === 'box') {
      const size = pt.m === 'fabric' || pt.m === 'fabricDS' ? 0.3 : pt.m === 'fur' ? 0.25 : 0.6;
      const e = grow();
      pushBox(b, partMatrix(pt), [pt.d[0] / 2 + e, pt.d[1] / 2 + e, pt.d[2] / 2 + e], pt.c, size);
    } else pushRound(b, pt);
  }
  for (const [floorId, parts] of Object.entries(geo.parts)) for (const pt of parts) addPart(floorId, pt);

  // ---- walls: every face goes to the wallpaper of the room it faces ----
  const wallsByFloor = {};
  for (const wb of geo.wallBoxes) (wallsByFloor[wb.floorId] ??= []).push(wb.box);
  const insideOtherWall = (floorId, p, self) =>
    wallsByFloor[floorId].some((b) => b !== self && p.x > b.minX + EPS && p.x < b.maxX - EPS && p.y > b.minY + EPS && p.y < b.maxY - EPS && p.z > b.minZ + EPS && p.z < b.maxZ - EPS);
  const roomAt = (floorId, x, z) => floorOf[floorId].rooms.find((r) => x >= r.bounds.minX && x <= r.bounds.maxX && z >= r.bounds.minZ && z <= r.bounds.maxZ);
  const roof = geo.roof;
  const roofY = (x) => roof.y + roof.kneeY + (roof.ridgeY - roof.kneeY) * Math.max(0, 1 - Math.abs(x - roof.ridgeX) / ((roof.bounds.maxX - roof.bounds.minX) / 2));

  for (const wb of geo.wallBoxes) {
    const f = floorOf[wb.floorId];
    const b = wb.box;
    const top = f.y + f.height;
    const longAxis = wb.axis; // 'x': long faces are ±Z
    // cut points along the long axis at room edges, so each piece takes its own room's paper
    const lo = longAxis === 'x' ? b.minX : b.minZ;
    const hi = longAxis === 'x' ? b.maxX : b.maxZ;
    const cuts = new Set([lo, hi]);
    for (const r of f.rooms) for (const c of longAxis === 'x' ? [r.bounds.minX, r.bounds.maxX] : [r.bounds.minZ, r.bounds.maxZ]) if (c > lo + EPS && c < hi - EPS) cuts.add(c);
    const steps = [...cuts].sort((a, c) => a - c);

    for (const side of [-1, 1]) {
      // long faces
      const fixed = longAxis === 'x' ? (side > 0 ? b.maxZ : b.minZ) : side > 0 ? b.maxX : b.minX;
      const n = longAxis === 'x' ? new THREE.Vector3(0, 0, side) : new THREE.Vector3(side, 0, 0);
      for (let k = 0; k < steps.length - 1; k++) {
        const s0 = steps[k];
        const s1 = steps[k + 1];
        const mid = (s0 + s1) / 2;
        const sx = longAxis === 'x' ? mid : fixed + side * 0.06;
        const sz = longAxis === 'x' ? fixed + side * 0.06 : mid;
        const sample = new THREE.Vector3(sx, (b.minY + Math.min(b.maxY, top)) / 2, sz);
        if (insideOtherWall(wb.floorId, sample, b)) continue;
        const room = roomAt(wb.floorId, sx, sz);
        if (!room && wb.floorId === 'basement') continue; // underground: never seen
        const texName = room ? room.wall : 'exterior';
        const size = tileSize(texName);
        const P = (s, y) => (longAxis === 'x' ? new THREE.Vector3(s, y, fixed) : new THREE.Vector3(fixed, y, s));
        const uvOf = (p) => [(longAxis === 'x' ? p.x : p.z) / size, (p.y - f.y) / size];
        const bk = bucket(wb.floorId, `tile:${texName}`);
        const pts = wb.gable
          ? [P(s0, b.minY), P(s1, b.minY), P(s1, roofY(s1)), ...(roof.ridgeX > s0 && roof.ridgeX < s1 ? [P(roof.ridgeX, roof.y + roof.ridgeY)] : []), P(s0, roofY(s0))]
          : [P(s0, b.minY), P(s1, b.minY), P(s1, b.maxY), P(s0, b.maxY)];
        bk.poly(windToward(pts, n), n, uvOf, 0xffffff);
      }
      // end caps (door jambs) in painted trim
      const capFixed = longAxis === 'x' ? (side > 0 ? b.maxX : b.minX) : side > 0 ? b.maxZ : b.minZ;
      const capTop = wb.gable ? roof.y + roof.kneeY : b.maxY;
      const capSample = longAxis === 'x' ? new THREE.Vector3(capFixed + side * 0.06, (b.minY + capTop) / 2, (b.minZ + b.maxZ) / 2) : new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + capTop) / 2, capFixed + side * 0.06);
      // A cap lying in another wall's face plane (outer corners) would z-fight that face:
      // skip it when the point just behind the cap is inside another wall too.
      const behindCap = capSample.clone();
      if (longAxis === 'x') behindCap.x = capFixed - side * 0.01;
      else behindCap.z = capFixed - side * 0.01;
      if (!insideOtherWall(wb.floorId, capSample, b) && !insideOtherWall(wb.floorId, behindCap, b) && !(wb.floorId === 'basement' && !roomAt(wb.floorId, capSample.x, capSample.z))) {
        const half = [(b.maxX - b.minX) / 2, (capTop - b.minY) / 2, (b.maxZ - b.minZ) / 2];
        const m = new THREE.Matrix4().makeTranslation((b.minX + b.maxX) / 2, (b.minY + capTop) / 2, (b.minZ + b.maxZ) / 2);
        const fi = longAxis === 'x' ? (side > 0 ? 0 : 1) : side > 0 ? 2 : 3;
        pushBox(bucket(wb.floorId, 'wood'), m, half, 0xe8dcc8, 0.6, { faces: [fi] });
      }
    }
    // horizontal faces: lintel undersides, knee-wall tops
    const half = [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2, (b.maxZ - b.minZ) / 2];
    const m = new THREE.Matrix4().makeTranslation((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    if (b.minY > f.y + EPS) pushBox(bucket(wb.floorId, 'wood'), m, half, 0xe8dcc8, 0.6, { faces: [5] });
    if (b.maxY < top - EPS && !wb.gable) pushBox(bucket(wb.floorId, 'wood'), m, half, 0xe8dcc8, 0.6, { faces: [4] });
  }

  // ---- floors and ceilings, per room, minus the slab holes ----
  const holesAbove = (f) => geo.floors.find((g) => Math.abs(g.y - (f.y + 3)) < EPS)?.slabHoles ?? [];
  for (const f of geo.floors) {
    for (const r of f.rooms) {
      const fs = tileSize(r.floor);
      for (const rect of subtract(r.bounds, f.slabHoles)) {
        const y = f.y;
        bucket(f.id, `tile:${r.floor}`).quad(
          new THREE.Vector3(rect.minX, y, rect.maxZ), new THREE.Vector3(rect.maxX, y, rect.maxZ),
          new THREE.Vector3(rect.maxX, y, rect.minZ), new THREE.Vector3(rect.minX, y, rect.minZ),
          new THREE.Vector3(0, 1, 0), [rect.minX / fs, -rect.maxZ / fs, rect.maxX / fs, -rect.minZ / fs], 0xffffff,
        );
      }
      if (r.ceiling === 'roof') continue;
      const cname = r.ceiling ?? 'plain';
      const cs = tileSize(cname);
      for (const rect of subtract(r.bounds, holesAbove(f))) {
        // A few mm below the slab: furniture on the floor above has its bottom
        // faces on the slab plane, also facing down, and z-fought through here.
        const y = f.y + f.height - CEILING_DROP;
        bucket(f.id, `tile:${cname}`).quad(
          new THREE.Vector3(rect.minX, y, rect.minZ), new THREE.Vector3(rect.maxX, y, rect.minZ),
          new THREE.Vector3(rect.maxX, y, rect.maxZ), new THREE.Vector3(rect.minX, y, rect.maxZ),
          new THREE.Vector3(0, -1, 0), [rect.minX / cs, rect.minZ / cs, rect.maxX / cs, rect.maxZ / cs], 0xffffff,
        );
      }
    }
  }

  // ---- roof: the attic's pitched underside, shingles outside, flat roof elsewhere ----
  if (roof) {
    const { bounds: rb, y } = roof;
    const z0 = rb.minZ - 0.12;
    const z1 = rb.maxZ + 0.12;
    const knee = y + roof.kneeY;
    const ridge = y + roof.ridgeY;
    const inner = bucket(roof.floorId, 'tile:roof');
    const outer = bucket(roof.floorId, 'tile:shingles');
    for (const [xe, s] of [[rb.minX, 1], [rb.maxX, -1]]) {
      const e = new THREE.Vector3(xe, knee, 0);
      const nIn = new THREE.Vector3(s * (ridge - knee), -(Math.abs(roof.ridgeX - xe)), 0).normalize();
      const A = (z) => new THREE.Vector3(e.x, e.y, z);
      const Bp = (z) => new THREE.Vector3(roof.ridgeX, ridge, z);
      const pts = [A(z0), A(z1), Bp(z1), Bp(z0)];
      const uvIn = (p) => [p.z, Math.hypot(p.x - xe, p.y - knee)];
      inner.poly(windToward(pts, nIn), nIn, uvIn, 0xffffff);
      const nOut = nIn.clone().negate();
      const op = pts.map((p) => p.clone().addScaledVector(nIn, -0.04));
      outer.poly(windToward(op, nOut), nOut, uvIn, 0xffffff);
    }
    // flat roof over the rest of the upstairs (seen only from outside)
    const up = geo.floors.find((g) => Math.abs(g.y + g.height - y) < EPS);
    if (up) {
      const ub = up.bounds;
      const eaves = { minX: ub.minX - 0.1, maxX: ub.maxX + 0.1, minZ: ub.minZ - 0.1, maxZ: ub.maxZ + 0.1 };
      for (const rect of subtract(eaves, [rb]))
        outer.quad(
          new THREE.Vector3(rect.minX, y + 0.02, rect.maxZ), new THREE.Vector3(rect.maxX, y + 0.02, rect.maxZ),
          new THREE.Vector3(rect.maxX, y + 0.02, rect.minZ), new THREE.Vector3(rect.minX, y + 0.02, rect.minZ),
          new THREE.Vector3(0, 1, 0), [rect.minX, -rect.maxZ, rect.maxX, -rect.minZ], 0x9a8a9a,
        );
    }
  }

  // ---- rugs (atlas pictures stretched over the rug) ----
  for (const rug of geo.rugs) {
    const pt = rug.part;
    const name = { round: 'rugRound', rainbow: 'rugRainbow', runner: 'rugRunner', mat: 'rugMat' }[rug.style] ?? 'rugMat';
    const tint = rug.style === 'rainbow' || rug.style === 'runner' ? 0xffffff : rug.color ?? pt.c;
    const b = bucket(rug.floorId, 'decal');
    if (pt.s === 'cyl') {
      const r = pt.d[0];
      const cy = pt.p[1] + 0.006;
      const uv = tex.uv(name);
      const ring = [];
      for (let i = 0; i < 20; i++) {
        const a = (-i / 20) * Math.PI * 2;
        ring.push(new THREE.Vector3(pt.p[0] + Math.cos(a) * r, cy, pt.p[2] + Math.sin(a) * r));
      }
      b.poly(ring, new THREE.Vector3(0, 1, 0), (p) => [uv.u0 + ((p.x - pt.p[0]) / (2 * r) + 0.5) * (uv.u1 - uv.u0), uv.v0 + ((pt.p[2] - p.z) / (2 * r) + 0.5) * (uv.v1 - uv.v0)], tint);
    } else pushBox(b, partMatrix(pt), [pt.d[0] / 2, pt.d[1] / 2, pt.d[2] / 2], tint, 1, { faces: [4], uvRect: atlasUV(name) });
  }

  // ---- decals and the four code drawings ----
  for (const d of geo.decals) {
    const m = partMatrix({ p: [d.pos.x, d.pos.y, d.pos.z], ry: d.rotY });
    if (d.floor) pushBox(bucket(d.floorId, 'decal'), m, [d.w / 2, 0, d.h / 2], 0xffffff, 1, { faces: [4], uvRect: atlasUV(d.tex) });
    else pushBox(bucket(d.floorId, 'decal'), m, [d.w / 2, d.h / 2, 0], 0xffffff, 1, { faces: [3], uvRect: atlasUV(d.tex) });
  }
  for (const s of world.anchors.drawings) {
    const m = partMatrix({ p: [s.pos.x, s.pos.y, s.pos.z], ry: s.rotY ?? 0 });
    const back = partMatrix({ p: [s.pos.x + Math.sin(s.rotY) * 0.006, s.pos.y, s.pos.z + Math.cos(s.rotY) * 0.006], ry: s.rotY });
    pushBox(bucket(s.floorId, 'wood'), back, [0.36, 0.28, 0.008], 0xc0306a, 0.6, { skip: [3] });
    pushBox(bucket(s.floorId, 'decal'), m, [0.32, 0.24, 0], 0xffffff, 1, { faces: [3], uvRect: atlasUV('drawingCode') });
  }

  // ---- creaky planks: visibly paler boards ----
  for (const t of geo.creaky) {
    const m = partMatrix({ p: [t.pos.x, t.pos.y + 0.004, t.pos.z], ry: 0 });
    for (const dz of [-0.09, 0.09]) {
      const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, dz));
      pushBox(bucket(t.floorId, 'decal'), mm, [0.5, 0, 0.085], 0xffffff, 1, { faces: [4], uvRect: atlasUV('creaky') });
    }
  }

  // ---- windows: moonlit panes, frames, and moonlight pooled on the floor ----
  geo.windows.forEach((w, k) => {
    const m = partMatrix({ p: [w.pos.x, w.pos.y, w.pos.z], ry: w.rotY });
    const pic = w.round ? 'windowRound' : k % 3 === 0 ? 'window' : 'windowPlain';
    pushBox(bucket(w.floorId, 'window'), m, [w.w / 2, w.h / 2, 0], 0xffffff, 1, { faces: [3], uvRect: atlasUV(pic) });
    // seen from outside: a dim lamp-lit pane on the outer face of the wall
    if (w.floorId !== 'basement') {
      const out = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.225));
      pushBox(bucket(w.floorId, 'window'), out, [w.w / 2, w.h / 2, 0], k % 3 === 1 ? 0xffffff : 0x585068, 1, { faces: [2], uvRect: atlasUV('windowLit') });
    }
    if (!w.round) {
      const frame = (x, y, sx, sy) => {
        const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, -0.02));
        pushBox(bucket(w.floorId, 'wood'), mm, [sx / 2, sy / 2, 0.03], 0xf0e8dc, 0.6);
      };
      frame(0, w.h / 2 + 0.04, w.w + 0.16, 0.08);
      frame(0, -w.h / 2 - 0.05, w.w + 0.24, 0.1);
      frame(-w.w / 2 - 0.04, 0, 0.08, w.h);
      frame(w.w / 2 + 0.04, 0, 0.08, w.h);
    }
    const p = w.patch;
    const yaw = Math.atan2(p.nx, p.nz);
    pushBox(bucket(w.floorId, 'moonlight'), partMatrix({ p: [p.x, p.y, p.z], ry: yaw }), [p.w / 2, 0, p.d / 2], 0xffffff, 1, { faces: [4], uvRect: atlasUV('moonPatch') });
  });

  // ---- lamp fixtures (the glowing bulbs themselves live in lights.js) ----
  for (const l of world.anchors.lamps) {
    const f = floorOf[l.floorId];
    const ceil = f.y + (f.height ?? 3);
    const P = (pt) => addPart(l.floorId, pt);
    const { x, y, z } = l.pos;
    switch (l.fixture) {
      case 'ceiling':
        P({ s: 'cyl', p: [x, (y + ceil) / 2, z], d: [0.015, ceil - y, 0.015], m: 'metal', c: 0x404048 });
        P({ s: 'cone', p: [x, y + 0.05, z], d: [0.1, 0.16, 0.32], m: 'fabric', c: 0xf0e0c0, seg: 10 });
        break;
      case 'lantern':
        P({ s: 'cyl', p: [x, (y + ceil) / 2 + 0.15, z], d: [0.01, ceil - y - 0.3, 0.01], m: 'metal', c: 0x302820 });
        for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) P({ s: 'box', p: [x + dx, y, z + dz], d: [0.03, 0.34, 0.03], m: 'metal', c: 0x302820 });
        P({ s: 'box', p: [x, y + 0.19, z], d: [0.32, 0.04, 0.32], m: 'metal', c: 0x302820 });
        P({ s: 'cone', p: [x, y + 0.27, z], d: [0.02, 0.12, 0.2], m: 'metal', c: 0x302820, seg: 4 });
        break;
      case 'chandelier':
        P({ s: 'cyl', p: [x, (y + ceil) / 2, z], d: [0.012, ceil - y, 0.012], m: 'metal', c: 0xc8a040 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          P({ s: 'box', p: [x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2], d: [0.4, 0.02, 0.02], m: 'metal', c: 0xc8a040, ry: -a });
          P({ s: 'cone', p: [x + Math.cos(a) * 0.38, y + 0.06, z + Math.sin(a) * 0.38], d: [0.04, 0.1, 0.08], m: 'fabric', c: 0xf8c0d8, seg: 6 });
        }
        break;
      case 'bulb':
        P({ s: 'cyl', p: [x, (y + ceil) / 2 + 0.06, z], d: [0.008, ceil - y - 0.12, 0.008], m: 'dark', c: 0x101010 });
        P({ s: 'cyl', p: [x, y + 0.1, z], d: [0.03, 0.06, 0.03], m: 'metal', c: 0x6a6a6a });
        break;
      case 'night':
        P({ s: 'box', p: [x + Math.sin(l.rotY) * 0.02, y, z + Math.cos(l.rotY) * 0.02], d: [0.1, 0.12, 0.05], m: 'plastic', c: 0xf0f0f0, ry: l.rotY });
        break;
      case 'clip':
        P({ s: 'cone', p: [x, y + 0.04, z], d: [0.04, 0.12, 0.09], m: 'plastic', c: 0xf07ab8, seg: 8 });
        P({ s: 'box', p: [x, y - 0.1, z], d: [0.04, 0.16, 0.04], m: 'plastic', c: 0xf07ab8 });
        break;
      default:
        break;
    }
  }

  // ---- glow-in-the-dark stars: bedroom ceiling and the attic roof ----
  const starRng = createRng('glow-stars');
  const starUV = atlasUV('star');
  const kids = geo.floors.flatMap((f) => f.rooms.filter((r) => r.ceiling === 'stars').map((r) => ({ f, r })));
  for (const { f, r } of kids) {
    for (let i = 0; i < 26; i++) {
      const x = starRng.range(r.bounds.minX + 0.4, r.bounds.maxX - 0.4);
      const z = starRng.range(r.bounds.minZ + 0.4, r.bounds.maxZ - 0.4);
      const s = starRng.range(0.07, 0.14);
      const m = partMatrix({ p: [x, f.y + f.height - CEILING_DROP - 0.005, z], ry: starRng.range(0, 6.28) });
      pushBox(bucket(f.id, 'glowStar'), m, [s, 0, s], starRng.pick([0xd8ff9a, 0xfff6a0, 0xb0f0ff]), 1, { faces: [5], uvRect: starUV });
    }
  }
  if (roof) {
    for (let i = 0; i < 40; i++) {
      const sidePos = starRng.next() < 0.5 ? -1 : 1;
      const t = starRng.range(0.15, 0.95);
      const xe = sidePos < 0 ? roof.bounds.minX : roof.bounds.maxX;
      const x = xe + (roof.ridgeX - xe) * t;
      const y = roofY(x) - 0.03;
      const z = starRng.range(roof.bounds.minZ + 0.3, roof.bounds.maxZ - 0.3);
      const slope = Math.atan2(roof.ridgeY - roof.kneeY, Math.abs(roof.ridgeX - xe));
      const s = starRng.range(0.06, 0.12);
      const m = partMatrix({ p: [x, y, z], ry: 0, rz: -sidePos * slope });
      pushBox(bucket(roof.floorId, 'glowStar'), m, [s, 0, s], starRng.pick([0xd8ff9a, 0xfff6a0]), 1, { faces: [5], uvRect: starUV });
    }
  }

  // ---- the Big Slide's chute: a yellow half-pipe hanging into the ball pit ----
  for (const ch of geo.chutes) {
    const pts = ch.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const h = Math.hypot(dx, dz);
      const len = Math.hypot(h, b.y - a.y) + 0.06;
      const yaw = Math.atan2(-dz, dx);
      const pitch = Math.atan2(b.y - a.y, h);
      const base = { p: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], ry: yaw, rz: pitch };
      const m = partMatrix(base);
      // segments overlap at the joints; every other one is 1.5 mm fatter so the overlaps don't z-fight
      const e = (i % 2) * 0.0015;
      pushBox(bucket(ch.floorId, 'plastic'), m, [len / 2, 0.025 + e, 0.36 + e], 0xf5c020);
      for (const s of [-1, 1]) {
        const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.14, s * 0.36));
        pushBox(bucket(ch.floorId, 'plastic'), mm, [len / 2, 0.16 + e, 0.025 + e], 0xf08a24);
      }
    }
    // two rods holding it up from the ceiling
    for (const k of [1, 2]) {
      const p = pts[k];
      addPart(ch.floorId, { s: 'cyl', p: [p.x, (p.y + 3) / 2, p.z + 0.4], d: [0.015, 3 - p.y, 0.015], m: 'metal', c: 0x8a8a90 });
    }
  }

  // ---- crawl-tunnel insides (seen only from inside: back faces) ----
  for (const t of geo.tunnels) {
    for (let i = 0; i < t.points.length - 1; i++) {
      const a = t.points[i];
      const b = t.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const h = Math.hypot(dx, dz);
      const len = Math.hypot(h, b.y - a.y) + 0.12;
      const m = partMatrix({ p: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], ry: Math.atan2(-dz, dx), rz: Math.atan2(b.y - a.y, h) });
      // +4 mm: the lining's floor sat on the room's floor plane and z-fought it.
      // Segments overlap at the joints; every other one is 1.5 mm bigger so those don't z-fight.
      const e = (i % 2) * 0.0015;
      m.multiply(new THREE.Matrix4().makeTranslation(0, t.h / 2 + 0.004, 0));
      pushBox(bucket(t.floorId, 'tunnel'), m, [len / 2, t.h / 2 + e, t.w / 2 + e], 0x9a7a5a, 1);
    }
  }

  // ---- toy train track around the tea table ----
  const tr = geo.setPieces.train;
  const ty = floorOf[tr.floorId].y;
  const N = 48;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = [tr.cx + Math.cos(a0) * tr.rx, tr.cz + Math.sin(a0) * tr.rz];
    const p1 = [tr.cx + Math.cos(a1) * tr.rx, tr.cz + Math.sin(a1) * tr.rz];
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const nx = -dz / len;
    const nz = dx / len;
    for (const s of [-0.07, 0.07]) addPart(tr.floorId, { s: 'box', p: [mid[0] + nx * s, ty + 0.025, mid[1] + nz * s], d: [len + 0.01, 0.02, 0.018], m: 'metal', c: 0x9aa0a8, ry: yaw });
    addPart(tr.floorId, { s: 'box', p: [mid[0], ty + 0.008, mid[1]], d: [0.05, 0.016, 0.24], m: 'wood', c: 0x8a5a32, ry: yaw });
  }

  // ---- the old TV's cabinet (its screen is animated) ----
  const tv = geo.setPieces.tv;
  {
    const P = (pt) => addPart(tv.floorId, { ...pt, p: rotate(pt.p, tv), ry: (pt.ry ?? 0) + tv.rotY });
    P({ s: 'box', p: [0, 0.3, 0.02], d: [0.78, 0.6, 0.55], m: 'wood', c: 0x5a3a22 });
    P({ s: 'box', p: [0, 0.31, -0.255], d: [0.64, 0.48, 0.02], m: 'plastic', c: 0x1a1a1e });
    P({ s: 'cyl', p: [-0.12, 0.75, 0.05], d: [0.008, 0.4, 0.008], m: 'metal', c: 0xb0b0b8, rz: 0.5 });
    P({ s: 'cyl', p: [0.12, 0.75, 0.05], d: [0.008, 0.4, 0.008], m: 'metal', c: 0xb0b0b8, rz: -0.5 });
    P({ s: 'sph', p: [0, 0.62, 0.05], d: [0.06], m: 'plastic', c: 0x2a2a2e });
    P({ s: 'cyl', p: [0.3, 0.12, -0.26], d: [0.03, 0.02, 0.03], m: 'plastic', c: 0xd0d0d0, rx: Math.PI / 2 });
  }

  // ---- outside: grass and the moon, for the escape cutscenes ----
  const grass = bucket('ground', 'tile:grass');
  grass.quad(new THREE.Vector3(-30, -0.03, 50), new THREE.Vector3(56, -0.03, 50), new THREE.Vector3(56, -0.03, -36), new THREE.Vector3(-30, -0.03, -36), new THREE.Vector3(0, 1, 0), [-15, -25, 28, 18], 0x8aa08a);
  // a front path
  addPart('ground', { s: 'box', p: [12, -0.02, -4], d: [1.6, 0.02, 8], m: 'plastic', c: 0x6a6460 });
  addPart('ground', { s: 'box', p: [29, -0.02, 4], d: [10, 0.02, 3.2], m: 'plastic', c: 0x4a4a4e });
  const moonM = partMatrix({ p: [-18, 24, -42], ry: Math.atan2(30, 42) });
  pushBox(bucket('ground', 'window'), moonM, [3, 3, 0], 0xffffff, 1, { faces: [3], uvRect: atlasUV('moon') });

  // ---- ball pits: hundreds of balls, one InstancedMesh each ----
  const ballPits = [];
  const ballGeo = new THREE.IcosahedronGeometry(0.075, 0);
  const ballMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  materials.set('balls', ballMat);
  const ballRng = createRng('ball-pit');
  const colors = [0xe83a3a, 0x3a7be0, 0xf5d03a, 0x45b85a, 0xf07ab8, 0xf08a24, 0x8a52d0, 0xf0f0f0];
  for (const bp of geo.ballPits) {
    const b = bp.inner;
    const count = Math.round(((b.maxX - b.minX) * (b.maxZ - b.minZ)) / 0.012);
    const mesh = new THREE.InstancedMesh(ballGeo, ballMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const layer = i / count;
      m.compose(new THREE.Vector3(ballRng.range(b.minX + 0.07, b.maxX - 0.07), b.minY + 0.05 + layer * (b.maxY - b.minY + 0.05) + ballRng.range(-0.04, 0.04), ballRng.range(b.minZ + 0.07, b.maxZ - 0.07)), q, ONE);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, _c.set(ballRng.pick(colors)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = 'ballPit';
    ballPits.push({ floorId: bp.floorId, mesh });
  }

  // ---- assemble ----
  const geometries = [ballGeo];
  for (const f of geo.floors) {
    const g = new THREE.Group();
    g.name = `floor:${f.id}`;
    floorGroups[f.id] = g;
    group.add(g);
  }
  for (const [floorId, map] of Object.entries(buckets)) {
    for (const [key, bk] of map) {
      const gg = bk.geometry();
      if (!gg) continue;
      const mesh = new THREE.Mesh(gg, material(key));
      mesh.name = `${floorId}:${key}`;
      mesh.matrixAutoUpdate = false;
      if (key === 'moonlight') mesh.renderOrder = 2;
      floorGroups[floorId].add(mesh);
      geometries.push(gg);
    }
  }
  for (const bp of ballPits) floorGroups[bp.floorId].add(bp.mesh);

  return {
    group,
    floorGroups,
    material,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
}

function rotate([x, y, z], at) {
  const c = Math.cos(at.rotY);
  const s = Math.sin(at.rotY);
  return [at.x + x * c + z * s, at.y + y, at.z - x * s + z * c];
}

function subtract(rect, holes) {
  // same decomposition as build.js#subtractRects, duplicated to keep meshes.js free of build-time imports
  const hs = holes.filter((h) => h.maxX > rect.minX + EPS && h.minX < rect.maxX - EPS && h.maxZ > rect.minZ + EPS && h.minZ < rect.maxZ - EPS);
  if (!hs.length) return [rect];
  const X = [...new Set([rect.minX, rect.maxX, ...hs.flatMap((h) => [h.minX, h.maxX]).filter((x) => x > rect.minX && x < rect.maxX)])].sort((a, b) => a - b);
  const Z = [...new Set([rect.minZ, rect.maxZ, ...hs.flatMap((h) => [h.minZ, h.maxZ]).filter((z) => z > rect.minZ && z < rect.maxZ)])].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j < Z.length - 1; j++)
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2;
      const cz = (Z[j] + Z[j + 1]) / 2;
      if (!hs.some((h) => cx >= h.minX && cx <= h.maxX && cz >= h.minZ && cz <= h.maxZ)) out.push({ minX: X[i], maxX: X[i + 1], minZ: Z[j], maxZ: Z[j + 1] });
    }
  return out;
}
