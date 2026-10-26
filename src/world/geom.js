// Geometry helpers shared by the static and dynamic mesh builders: a
// per-material triangle bucket, box writing with metre-scaled UVs, and the
// part transform (yaw outermost, matching props.js).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ONE = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/** Per-material triangle soup: position, normal, uv, color (all non-indexed). */
export class Bucket {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.extra = [];
  }
  /** a, b, c, d: world Vector3 corners, counter-clockwise seen from the front. */
  quad(a, b, c, d, n, uv, color) {
    _c.set(color);
    const [u0, v0, u1, v1] = uv;
    const verts = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [a, u0, v0], [c, u1, v1], [d, u0, v1]];
    for (const [p, u, w] of verts) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(u, w);
      this.col.push(_c.r, _c.g, _c.b);
    }
  }
  poly(points, n, uvOf, color) {
    for (let i = 1; i < points.length - 1; i++) {
      _c.set(color);
      for (const p of [points[0], points[i], points[i + 1]]) {
        const [u, w] = uvOf(p);
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        this.uv.push(u, w);
        this.col.push(_c.r, _c.g, _c.b);
      }
    }
  }
  geometry() {
    const parts = [];
    if (this.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      parts.push(g);
    }
    parts.push(...this.extra);
    if (!parts.length) return null;
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (parts.length > 1) for (const p of parts) p.dispose();
    merged.computeBoundingSphere();
    return merged;
  }
}

// ---- part geometry ------------------------------------------------------------------

export function partMatrix(pt) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pt.rx ?? 0, pt.ry ?? 0, pt.rz ?? 0, 'YXZ'));
  return new THREE.Matrix4().compose(_v.set(pt.p[0], pt.p[1], pt.p[2]).clone(), q, ONE);
}

// local box faces: corners counter-clockwise from outside, with the face's (w, h) axes
const FACES = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], wh: [2, 1] },
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], wh: [2, 1] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], wh: [0, 1] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], wh: [0, 1] },
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], wh: [0, 2] },
  { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], wh: [0, 2] },
];

/** Write a box part into a bucket. size = metres per texture repeat; skip = face indices to leave out. */
export function pushBox(bucket, m, half, color, size = 1, { skip = null, uvRect = null, faces = null } = {}) {
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const dims = [half[0] * 2, half[1] * 2, half[2] * 2];
  (faces ?? [0, 1, 2, 3, 4, 5]).forEach((fi) => {
    if (skip?.includes(fi)) return;
    const f = FACES[fi];
    const pts = f.c.map(([x, y, z]) => new THREE.Vector3(x * half[0], y * half[1], z * half[2]).applyMatrix4(m));
    const n = new THREE.Vector3(...f.n).applyMatrix3(nm).normalize();
    const uv = uvRect ?? [0, 0, dims[f.wh[0]] / size, dims[f.wh[1]] / size];
    bucket.quad(pts[0], pts[1], pts[2], pts[3], n, uv, color);
  });
}

const geoCache = new Map();
function roundGeometry(pt) {
  const seg = pt.seg ?? 8;
  const key = `${pt.s}:${pt.d.join(',')}:${seg}:${pt.axis ?? ''}`;
  if (!geoCache.has(key)) {
    let g;
    if (pt.s === 'sph') g = new THREE.SphereGeometry(pt.d[0], seg, Math.max(4, Math.round(seg * 0.6)));
    else if (pt.s === 'tube') {
      g = new THREE.CylinderGeometry(pt.d[0], pt.d[0], pt.d[1], 12, 1, true);
      g.rotateZ(Math.PI / 2);
    } else g = new THREE.CylinderGeometry(pt.d[0], pt.d[2], pt.d[1], seg);
    const ng = g.toNonIndexed();
    g.dispose();
    // scale UVs from 0..1 to roughly metres so tiling textures keep their density
    const uv = ng.getAttribute('uv');
    const circ = 2 * Math.PI * Math.max(pt.d[0], pt.d[2] ?? 0, 0.02);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * 2, uv.getY(i) * (pt.d[1] ?? pt.d[0] * 2) * 2);
    geoCache.set(key, ng);
  }
  return geoCache.get(key);
}

export function pushRound(bucket, pt) {
  const g = roundGeometry(pt).clone();
  g.applyMatrix4(partMatrix(pt));
  _c.set(pt.c);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bucket.extra.push(g);
}

/** Reverse a convex polygon if its winding faces away from n. */
export function windToward(pts, n) {
  const a = pts[0];
  const u = new THREE.Vector3().subVectors(pts[1], a);
  const w = new THREE.Vector3().subVectors(pts[2], a);
  return u.cross(w).dot(n) >= 0 ? pts : pts.slice().reverse();
}

