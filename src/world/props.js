// Prop library: furniture and toys as plain data, never THREE. Each builder
// returns a prop in LOCAL space (origin on the floor at the footprint centre,
// front facing -Z like a camera at yaw 0). placeProp() moves it into the
// world. meshes.js turns `parts` into merged geometry; build.js turns
// `colliders` into the collision and nav data, so both always agree.
//
// Part: { s: 'box'|'cyl'|'sph'|'cone', p: [x,y,z] centre, d: size, m: material, c: 0xRRGGBB,
//         ry?, rx?, rz?, seg? }
//   box  d = [sx, sy, sz]      cyl/cone d = [radiusTop, height, radiusBottom]      sph d = [r]
// Materials: plastic, wood, fabric, metal, glow (unlit), dark (unlit black), fur.
//
// Extras a builder may add (all local): points {name: [x,y,z]}, boxes {name: Box},
// yaws {name: number}, moving [{ pivot: [x,y,z], parts, motion }].
//   motion = { type: 'slide', dir: [x,y,z], dist } | { type: 'hinge', axis: 'x'|'y', angle }
//   (hinge angles are radians about the pivot's local axis; parts are relative to the pivot)

const HALF_PI = Math.PI / 2;

// ---- part + box helpers ------------------------------------------------------

const B = (x, y, z, sx, sy, sz, m, c, extra) => ({ s: 'box', p: [x, y, z], d: [sx, sy, sz], m, c, ...extra });
/** box by its min corner on the floor: x0..x0+sx, y0.., z0.. */
const BM = (x0, y0, z0, sx, sy, sz, m, c, extra) => B(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2, sx, sy, sz, m, c, extra);
const CY = (x, y, z, r, h, m, c, extra) => ({ s: 'cyl', p: [x, y, z], d: [r, h, r], m, c, ...extra });
const CO = (x, y, z, rTop, h, rBot, m, c, extra) => ({ s: 'cone', p: [x, y, z], d: [rTop, h, rBot], m, c, ...extra });
const SP = (x, y, z, r, m, c, extra) => ({ s: 'sph', p: [x, y, z], d: [r], m, c, ...extra });
const K = (minX, maxX, minY, maxY, minZ, maxZ) => ({ minX, maxX, minY, maxY, minZ, maxZ });

/** Bounding box of a part (ignores rx/rz tilt, which is only used on small decor). */
function partBox(pt) {
  const [x, y, z] = pt.p;
  let hx;
  let hy;
  let hz;
  if (pt.s === 'box') [hx, hy, hz] = [pt.d[0] / 2, pt.d[1] / 2, pt.d[2] / 2];
  else if (pt.s === 'sph') hx = hy = hz = pt.d[0];
  else if (pt.s === 'tube') [hx, hy, hz] = [pt.d[1] / 2, pt.d[0], pt.d[0]]; // along X
  else {
    const r = Math.max(pt.d[0], pt.d[2]);
    [hx, hy, hz] = [r, pt.d[1] / 2, r];
  }
  if (pt.s === 'box' && pt.ry) {
    const c = Math.abs(Math.cos(pt.ry));
    const s = Math.abs(Math.sin(pt.ry));
    [hx, hz] = [hx * c + hz * s, hx * s + hz * c];
  }
  return K(x - hx, x + hx, y - hy, y + hy, z - hz, z + hz);
}

/** AABB around a list of parts — handy when a whole prop is one solid lump. */
export function aabb(parts) {
  const out = K(Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity);
  for (const pt of parts) {
    const b = partBox(pt);
    out.minX = Math.min(out.minX, b.minX);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxY = Math.max(out.maxY, b.maxY);
    out.minZ = Math.min(out.minZ, b.minZ);
    out.maxZ = Math.max(out.maxZ, b.maxZ);
  }
  return out;
}

// ---- placement -----------------------------------------------------------------

const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** Rotate a local point by yaw `rot` (Three.js convention: +X turns toward -Z) and offset. */
export function xform([lx, ly, lz], x, y, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [r6(x + lx * c + lz * s), r6(y + ly), r6(z - lx * s + lz * c)];
}

function xformBox(b, x, y, z, rot) {
  const corners = [
    xform([b.minX, 0, b.minZ], x, 0, z, rot),
    xform([b.maxX, 0, b.minZ], x, 0, z, rot),
    xform([b.minX, 0, b.maxZ], x, 0, z, rot),
    xform([b.maxX, 0, b.maxZ], x, 0, z, rot),
  ];
  return {
    minX: Math.min(...corners.map((q) => q[0])),
    maxX: Math.max(...corners.map((q) => q[0])),
    minY: r6(y + b.minY),
    maxY: r6(y + b.maxY),
    minZ: Math.min(...corners.map((q) => q[2])),
    maxZ: Math.max(...corners.map((q) => q[2])),
  };
}

function xformPart(pt, x, y, z, rot) {
  return { ...pt, p: xform(pt.p, x, y, z, rot), ry: (pt.ry ?? 0) + rot };
}

/**
 * Move a local prop into the world: floor point (x, y, z), yaw rot.
 * Points come back as {x, y, z}; moving parts keep pivot-relative parts and gain a world pivot + yaw.
 */
export function placeProp(local, x, y, z, rot = 0) {
  const toV = (q) => ({ x: q[0], y: q[1], z: q[2] });
  const out = {
    parts: local.parts.map((pt) => xformPart(pt, x, y, z, rot)),
    colliders: (local.colliders ?? []).map((b) => xformBox(b, x, y, z, rot)),
    points: {},
    boxes: {},
    yaws: {},
    moving: (local.moving ?? []).map((mv) => ({ ...mv, pivot: toV(xform(mv.pivot, x, y, z, rot)), yaw: rot })),
    rot,
  };
  for (const [k, q] of Object.entries(local.points ?? {})) out.points[k] = toV(xform(q, x, y, z, rot));
  for (const [k, b] of Object.entries(local.boxes ?? {})) out.boxes[k] = xformBox(b, x, y, z, rot);
  for (const [k, a] of Object.entries(local.yaws ?? {})) out.yaws[k] = a + rot;
  for (const k of Object.keys(local)) if (!(k in out) && k !== 'moving') out[k] = local[k];
  return out;
}

// ---- palette -------------------------------------------------------------------

export const COLORS = {
  red: 0xd8343c, orange: 0xf08a24, yellow: 0xf5d03a, green: 0x45b85a, teal: 0x2fb8a8, blue: 0x3a7be0,
  purple: 0x8a52d0, pink: 0xf07ab8, white: 0xece6dc, cream: 0xf3e2c0, black: 0x1a1618,
  wood: 0xb07a48, darkWood: 0x6e4528, paleWood: 0xd9b07a, gray: 0x8a8a90, darkGray: 0x4a4a52,
  steel: 0xa8b0b8, brass: 0xc8a040, fur: 0xd8a860, brown: 0x8a5a32, mint: 0x9ee8c8, lilac: 0xc0a0f0,
};
const C = COLORS;
const RAINBOW = [C.red, C.orange, C.yellow, C.green, C.blue, C.purple];

// ---- generic furniture -----------------------------------------------------------

/** Four legs under a rectangle w x d, legs h tall. */
function legs(w, d, h, m, c, t = 0.06, inset = 0.05) {
  const x = w / 2 - inset - t / 2;
  const z = d / 2 - inset - t / 2;
  return [
    B(-x, h / 2, -z, t, h, t, m, c), B(x, h / 2, -z, t, h, t, m, c),
    B(-x, h / 2, z, t, h, t, m, c), B(x, h / 2, z, t, h, t, m, c),
  ];
}

export function table({ w = 1.4, d = 0.8, h = 0.75, top = C.wood, leg = C.darkWood } = {}) {
  const parts = [B(0, h - 0.03, 0, w, 0.06, d, 'wood', top), ...legs(w, d, h - 0.06, 'wood', leg)];
  return { parts, colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)] };
}

export function roundTable({ r = 0.75, h = 0.5, top = C.white, leg = C.pink } = {}) {
  const parts = [CY(0, h - 0.03, 0, r, 0.06, 'plastic', top, { seg: 14 }), CY(0, (h - 0.06) / 2, 0, 0.08, h - 0.06, 'plastic', leg), CY(0, 0.02, 0, 0.35, 0.04, 'plastic', leg)];
  return { parts, colliders: [K(-r * 0.85, r * 0.85, 0, h, -r * 0.85, r * 0.85)] };
}

export function kidChair({ color = C.blue, seat = 0.3 } = {}) {
  const parts = [
    B(0, seat, 0, 0.36, 0.05, 0.36, 'plastic', color),
    B(0, seat + 0.22, 0.16, 0.36, 0.4, 0.04, 'plastic', color),
    ...legs(0.36, 0.36, seat - 0.025, 'plastic', color, 0.04, 0.02),
  ];
  return { parts, colliders: [K(-0.18, 0.18, 0, seat + 0.42, -0.18, 0.18)] };
}

export function chair({ color = C.wood } = {}) {
  const parts = [
    B(0, 0.45, 0, 0.44, 0.05, 0.44, 'wood', color),
    B(0, 0.75, 0.2, 0.44, 0.55, 0.04, 'wood', color),
    ...legs(0.44, 0.44, 0.425, 'wood', color, 0.045, 0.02),
  ];
  return { parts, colliders: [K(-0.22, 0.22, 0, 1.02, -0.22, 0.22)] };
}

export function couch({ w = 2.0, color = 0x7a4a8c } = {}) {
  const d = 0.9;
  const parts = [
    B(0, 0.22, 0, w, 0.3, d, 'fabric', color),
    B(0, 0.42, -0.05, w - 0.3, 0.12, d - 0.2, 'fabric', 0x9a6aae),
    B(0, 0.62, d / 2 - 0.12, w, 0.6, 0.24, 'fabric', color),
    B(-w / 2 + 0.12, 0.45, 0, 0.24, 0.35, d, 'fabric', color),
    B(w / 2 - 0.12, 0.45, 0, 0.24, 0.35, d, 'fabric', color),
    B(-0.45, 0.6, 0.15, 0.4, 0.32, 0.14, 'fabric', C.yellow, { rx: -0.3 }), // cushion
  ];
  return { parts, colliders: [K(-w / 2, w / 2, 0, 0.92, -d / 2, d / 2)] };
}

export function bookshelf({ w = 1.0, h = 1.5, d = 0.35, color = C.wood, seed = 1 } = {}) {
  const parts = [
    B(-w / 2 + 0.02, h / 2, 0, 0.04, h, d, 'wood', color), B(w / 2 - 0.02, h / 2, 0, 0.04, h, d, 'wood', color),
    B(0, h / 2, d / 2 - 0.01, w, h, 0.02, 'wood', color),
  ];
  const shelves = Math.round(h / 0.38);
  for (let i = 0; i <= shelves; i++) {
    const y = Math.min(h - 0.02, 0.02 + i * (h / shelves));
    parts.push(B(0, y, 0, w - 0.06, 0.03, d, 'wood', color));
    if (i === shelves) break;
    // books: a row of colourful slabs, deterministic per shelf
    let x = -w / 2 + 0.06;
    let k = seed * 7 + i * 3;
    while (x < w / 2 - 0.12) {
      k = (k * 1103515245 + 12345) & 0x7fffffff;
      const bw = 0.04 + (k % 5) * 0.012;
      const bh = 0.18 + ((k >> 4) % 6) * 0.025;
      if ((k >> 8) % 7 !== 0) parts.push(B(x + bw / 2, y + 0.015 + bh / 2, 0.02, bw, bh, d * 0.75, 'plastic', RAINBOW[(k >> 3) % 6]));
      x += bw + 0.008;
    }
  }
  return { parts, colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)] };
}

export function shelfUnit({ w = 1.2, h = 1.6, d = 0.45, color = C.gray, boxes = true, seed = 3 } = {}) {
  const parts = [
    B(-w / 2 + 0.03, h / 2, -d / 2 + 0.03, 0.05, h, 0.05, 'metal', color), B(w / 2 - 0.03, h / 2, -d / 2 + 0.03, 0.05, h, 0.05, 'metal', color),
    B(-w / 2 + 0.03, h / 2, d / 2 - 0.03, 0.05, h, 0.05, 'metal', color), B(w / 2 - 0.03, h / 2, d / 2 - 0.03, 0.05, h, 0.05, 'metal', color),
  ];
  const levels = [0.08, 0.6, 1.1, h - 0.03];
  let k = seed;
  for (const y of levels) {
    parts.push(B(0, y, 0, w, 0.03, d, 'metal', color));
    if (!boxes || y > h - 0.1) continue;
    k = (k * 48271) % 2147483647;
    const bw = 0.3 + (k % 4) * 0.06;
    const bh = 0.2 + ((k >> 3) % 4) * 0.05;
    parts.push(B(-w / 4, y + 0.015 + bh / 2, 0, bw, bh, d * 0.8, 'fabric', 0xb08a58));
    if (k % 3) parts.push(B(w / 4, y + 0.015 + 0.12, 0, 0.32, 0.24, d * 0.7, 'plastic', RAINBOW[k % 6]));
  }
  return { parts, colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)] };
}

export function boxStack({ seed = 1, n = 3 } = {}) {
  const parts = [];
  let y = 0;
  let k = seed * 9301 + 49297;
  for (let i = 0; i < n; i++) {
    k = (k * 9301 + 49297) % 233280;
    const s = 0.62 - i * 0.1 - (k % 3) * 0.03;
    const h = 0.32 + (k % 4) * 0.05;
    parts.push(B(((k % 5) - 2) * 0.02, y + h / 2, 0, s, h, s * 0.9, 'fabric', 0xb08a58, { ry: ((k % 7) - 3) * 0.06 }));
    parts.push(B(((k % 5) - 2) * 0.02, y + h - 0.01, 0, s * 0.3, 0.02, s * 0.92, 'plastic', 0xd8c890, { ry: ((k % 7) - 3) * 0.06 }));
    y += h;
  }
  return { parts, colliders: [K(-0.34, 0.34, 0, y, -0.3, 0.3)] };
}

export function rug({ w = 2, d = 1.4, color = C.red, round = false, y = 0.005 } = {}) {
  // Rugs never collide (maxY < 0.05). Their pattern comes from meshes.js via `rugStyle`.
  return {
    parts: round ? [CY(0, y, 0, w / 2, 0.01, 'fabric', color, { seg: 18 })] : [B(0, y, 0, w, 0.01, d, 'fabric', color)],
    colliders: [],
  };
}

// ---- containers ------------------------------------------------------------------
// Containers return { parts, colliders, moving, points: {use, item} }. The item
// spot sits inside the container in BOTH states: Gameplay keeps items still, so
// a drawer's item rests just behind its front panel, where an open drawer's back
// still covers it and the gap above lets you see it.

export function drawerUnit({ w = 0.9, h = 0.85, d = 0.5, color = C.white, front = C.pink, knob = C.yellow } = {}) {
  const t = 0.03;
  const dy = 0.12;
  const dh = 0.34;
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, 'wood', color), B(w / 2 - t / 2, h / 2, 0, t, h, d, 'wood', color),
    B(0, h - t / 2, 0, w, t, d, 'wood', color), B(0, h / 2, d / 2 - t / 2, w, h, t, 'wood', color),
    B(0, dy - 0.04, 0, w - 2 * t, 0.02, d - t, 'wood', color),
    B(0, 0.04, 0, w, 0.08, d, 'wood', color), // plinth
    B(0, 0.64, 0, w - 2 * t, 0.02, d - t, 'wood', color), // shelf over the open cubby
    B(0.2, 0.71, 0.02, 0.16, 0.12, 0.2, 'plastic', C.teal), // a toy on the shelf
  ];
  const dw = w - 2 * t - 0.02;
  const dd = d - t - 0.02;
  // drawer, pivot at the closed front face centre, so the motion is a pure slide along -Z
  const drawer = [
    B(0, dh / 2, 0.01, dw + 0.01, dh, 0.025, 'wood', front),
    B(0, 0.01, dd / 2, dw - 0.02, 0.02, dd - 0.02, 'wood', color),
    B(-dw / 2 + 0.01, dh * 0.35, dd / 2, 0.02, dh * 0.7, dd - 0.02, 'wood', color),
    B(dw / 2 - 0.01, dh * 0.35, dd / 2, 0.02, dh * 0.7, dd - 0.02, 'wood', color),
    B(0, dh * 0.35, dd - 0.01, dw - 0.02, dh * 0.7, 0.02, 'wood', color),
    SP(0, dh * 0.55, -0.02, 0.035, 'plastic', knob),
  ];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)],
    moving: [{ pivot: [0, dy, -d / 2], parts: drawer, motion: { type: 'slide', dir: [0, 0, -1], dist: 0.34 } }],
    points: { use: [0, dy + dh / 2, -d / 2 - 0.02], item: [0, dy + 0.02, -d / 2 + 0.09] },
  };
}

export function cabinet({ w = 0.8, h = 0.9, d = 0.5, color = C.white, door = C.teal, knob = C.yellow } = {}) {
  const t = 0.03;
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, 'wood', color), B(w / 2 - t / 2, h / 2, 0, t, h, d, 'wood', color),
    B(0, h - t / 2, 0, w, t, d, 'wood', color), B(0, h / 2, d / 2 - t / 2, w, h, t, 'wood', color),
    B(0, 0.05, 0, w, 0.1, d, 'wood', color), B(0, h * 0.55, 0.03, w - 2 * t, 0.02, d - 0.08, 'wood', color),
  ];
  const dw = w - 0.02;
  // door hinged on the cabinet's left (local -X) front edge, swinging out toward -Z
  const doorParts = [B(dw / 2, (h - 0.1) / 2, 0, dw, h - 0.12, 0.025, 'wood', door), SP(dw - 0.07, (h - 0.1) * 0.55, -0.03, 0.03, 'plastic', knob)];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)],
    moving: [{ pivot: [-w / 2 + 0.01, 0.1, -d / 2 - 0.0125], parts: doorParts, motion: { type: 'hinge', axis: 'y', angle: -1.9 } }],
    points: { use: [0, h * 0.5, -d / 2 - 0.02], item: [0, 0.11, -d / 2 + 0.18] },
  };
}

export function wardrobeContainer({ w = 1.1, h = 1.8, d = 0.6, color = C.lilac, door = 0xd8c0ff, knob = C.yellow } = {}) {
  const t = 0.04;
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, 'wood', color), B(w / 2 - t / 2, h / 2, 0, t, h, d, 'wood', color),
    B(0, h - t / 2, 0, w, t, d, 'wood', color), B(0, h / 2, d / 2 - t / 2, w, h, t, 'wood', color),
    B(0, 0.05, 0, w, 0.1, d, 'wood', color), CY(0, h - 0.25, 0.05, 0.015, w - 0.1, 'metal', C.steel, { rz: HALF_PI }),
    B(-0.2, h - 0.6, 0.05, 0.3, 0.55, 0.04, 'fabric', C.pink, { ry: 0.3 }), // a dress on the rail
  ];
  const dw = w / 2 - 0.01;
  const left = [B(dw / 2, (h - 0.12) / 2, 0, dw, h - 0.14, 0.025, 'wood', door), SP(dw - 0.06, h * 0.5, -0.03, 0.03, 'plastic', knob)];
  const right = [B(-dw / 2, (h - 0.12) / 2, 0, dw, h - 0.14, 0.025, 'wood', door), SP(-dw + 0.06, h * 0.5, -0.03, 0.03, 'plastic', knob)];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)],
    moving: [
      { pivot: [-w / 2 + 0.01, 0.11, -d / 2 - 0.0125], parts: left, motion: { type: 'hinge', axis: 'y', angle: -1.8 } },
      { pivot: [w / 2 - 0.01, 0.11, -d / 2 - 0.0125], parts: right, motion: { type: 'hinge', axis: 'y', angle: 1.8 } },
    ],
    points: { use: [0, 1.0, -d / 2 - 0.02], item: [0, 0.11, -d / 2 + 0.2] },
  };
}

export function chestContainer({ w = 0.9, h = 0.55, d = 0.55, color = C.red, lid = C.yellow, band = C.brass, old = false } = {}) {
  const t = 0.04;
  const m = old ? 'wood' : 'plastic';
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, m, color), B(w / 2 - t / 2, h / 2, 0, t, h, d, m, color),
    B(0, h / 2, -d / 2 + t / 2, w, h, t, m, color), B(0, h / 2, d / 2 - t / 2, w, h, t, m, color),
    B(0, 0.03, 0, w, 0.06, d, m, color),
  ];
  if (old) parts.push(B(-w / 2 + 0.12, h / 2, -d / 2 - 0.005, 0.05, h, 0.01, 'metal', band), B(w / 2 - 0.12, h / 2, -d / 2 - 0.005, 0.05, h, 0.01, 'metal', band));
  // lid: pivot on the back top edge, lid extends toward -Z; +angle about X lifts the front
  const lidParts = [B(0, 0.04, -d / 2, w + 0.02, 0.08, d + 0.02, m, lid), B(0, 0.02, -d - 0.005, 0.12, 0.08, 0.02, 'metal', band)];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h + 0.08, -d / 2, d / 2)],
    moving: [{ pivot: [0, h, d / 2], parts: lidParts, motion: { type: 'hinge', axis: 'x', angle: 1.9 } }],
    points: { use: [0, h, -d / 2 - 0.02], item: [0, 0.07, 0] },
  };
}

// ---- hide props -------------------------------------------------------------------
// Each returns { parts, colliders, boxes: {use}, points: {use, eye, exit}, yaws: {eye} }.
// The prop is hollow where the eye goes, and its doors have see-through slats
// (material 'slats', alpha-tested) so the hidden camera can look out.

export function wardrobeHide({ w = 1.2, h = 1.9, d = 0.7, color = 0x5a7ad0, door = 0x86a8f0 } = {}) {
  const t = 0.04;
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, 'wood', color), B(w / 2 - t / 2, h / 2, 0, t, h, d, 'wood', color),
    B(0, h - t / 2, 0, w, t, d, 'wood', color), B(0, h / 2, d / 2 - t / 2, w, h, t, 'wood', color),
    B(0, 0.04, 0, w, 0.08, d, 'wood', color),
    B(-w / 4, h / 2 + 0.02, -d / 2 + 0.015, w / 2 - 0.02, h - 0.14, 0.02, 'slats', door),
    B(w / 4, h / 2 + 0.02, -d / 2 + 0.015, w / 2 - 0.02, h - 0.14, 0.02, 'slats', door),
    SP(-0.06, h * 0.5, -d / 2 - 0.02, 0.03, 'plastic', C.yellow), SP(0.06, h * 0.5, -d / 2 - 0.02, 0.03, 'plastic', C.yellow),
    B(0.25, 1.2, 0.15, 0.32, 0.6, 0.06, 'fabric', C.green, { ry: -0.4 }), // coat
  ];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)],
    boxes: { use: K(-w / 2, w / 2, 0.1, h - 0.1, -d / 2 - 0.03, -d / 2 + 0.05) },
    points: { use: [0, 1.0, -d / 2 - 0.03], eye: [0, 1.05, -d / 2 + 0.2], exit: [0, 0, -d / 2 - 0.65] },
    yaws: { eye: 0 },
  };
}

export function cabinetHide({ w = 1.3, h = 1.0, d = 0.7, color = C.white, door = C.mint } = {}) {
  const t = 0.04;
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, 'wood', color), B(w / 2 - t / 2, h / 2, 0, t, h, d, 'wood', color),
    B(0, h - t / 2, 0, w, t, d, 'wood', color), B(0, h / 2, d / 2 - t / 2, w, h, t, 'wood', color),
    B(0, 0.04, 0, w, 0.08, d, 'wood', color),
    B(-w / 4, h / 2, -d / 2 + 0.015, w / 2 - 0.02, h - 0.12, 0.02, 'slats', door),
    B(w / 4, h / 2, -d / 2 + 0.015, w / 2 - 0.02, h - 0.12, 0.02, 'slats', door),
    SP(-0.06, h * 0.6, -d / 2 - 0.02, 0.03, 'plastic', C.pink), SP(0.06, h * 0.6, -d / 2 - 0.02, 0.03, 'plastic', C.pink),
  ];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)],
    boxes: { use: K(-w / 2, w / 2, 0.08, h - 0.04, -d / 2 - 0.03, -d / 2 + 0.05) },
    points: { use: [0, h / 2, -d / 2 - 0.03], eye: [0, 0.48, -d / 2 + 0.22], exit: [0, 0, -d / 2 - 0.6] },
    yaws: { eye: 0 },
  };
}

export function chestHide({ w = 1.4, h = 0.75, d = 0.85, color = C.blue, lid = C.yellow, old = false } = {}) {
  const t = 0.05;
  const m = old ? 'wood' : 'plastic';
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, m, color), B(w / 2 - t / 2, h / 2, 0, t, h, d, m, color),
    B(0, h / 2, -d / 2 + t / 2, w, h, t, m, color), B(0, h / 2, d / 2 - t / 2, w, h, t, m, color),
    B(0, 0.03, 0, w, 0.06, d, m, color),
    // lid propped open a crack at the front so the hidden kid can peek out
    B(0, h + 0.06, 0.01, w + 0.04, 0.07, d + 0.04, m, lid, { rx: -0.09 }),
    B(0, h + 0.02, -d / 2 - 0.01, 0.06, 0.06, 0.06, 'plastic', C.white), // the toy block propping it
  ];
  if (old) parts.push(B(-w / 2 + 0.15, h / 2, -d / 2 - 0.005, 0.06, h, 0.01, 'metal', C.brass), B(w / 2 - 0.15, h / 2, -d / 2 - 0.005, 0.06, h, 0.01, 'metal', C.brass));
  else for (let i = 0; i < 4; i++) parts.push(B(-0.45 + i * 0.3, h * 0.5, -d / 2 - 0.006, 0.2, 0.2, 0.012, 'plastic', RAINBOW[i + 1])); // letter blocks
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h + 0.12, -d / 2, d / 2)],
    boxes: { use: K(-w / 2, w / 2, 0, h + 0.12, -d / 2 - 0.02, d / 2) },
    points: { use: [0, h, -d / 2 - 0.03], eye: [0, h - 0.02, -d / 2 + 0.25], exit: [0, 0, -d / 2 - 0.6] },
    yaws: { eye: 0 },
  };
}

/** Blanket fort over two chairs. Its opening faces -Z. */
export function fortHide({ w = 1.8, d = 1.8, h = 1.1, color = C.pink, color2 = C.yellow } = {}) {
  const parts = [
    // the draped blanket: roof plus three sagging walls, opening at the front
    B(0, h, 0.05, w, 0.04, d - 0.1, 'fabric', color, { rx: 0.06 }),
    B(-w / 2, h / 2, 0.05, 0.04, h, d - 0.1, 'fabric', color2),
    B(w / 2, h / 2, 0.05, 0.04, h, d - 0.1, 'fabric', color2),
    B(0, h / 2, d / 2, w, h, 0.04, 'fabric', color),
    B(-w / 2 + 0.3, h * 0.82, -d / 2 + 0.12, 0.6, h * 0.36, 0.03, 'fabric', color, { ry: 0.25 }), // flap
    B(0, 0.04, 0.1, w - 0.2, 0.08, d - 0.4, 'fabric', 0x6a8ad8), // pillow floor
    CY(-w / 2 + 0.1, h / 2, -d / 2 + 0.1, 0.03, h, 'wood', C.wood), CY(w / 2 - 0.1, h / 2, -d / 2 + 0.1, 0.03, h, 'wood', C.wood),
    SP(w / 2 - 0.35, 0.25, d / 2 - 0.3, 0.17, 'glow', 0xfff0a0), // a little torch left on inside
  ];
  return {
    parts,
    colliders: [K(-w / 2 - 0.02, w / 2 + 0.02, 0, h + 0.05, -d / 2, d / 2 + 0.02)],
    boxes: { use: K(-w / 2, w / 2, 0, h, -d / 2 - 0.02, d / 2) },
    points: { use: [0, 0.6, -d / 2 - 0.03], eye: [0, 0.5, 0.15], exit: [0, 0, -d / 2 - 0.6] },
    yaws: { eye: 0 },
  };
}

/** Play tent: a triangular-ish prism of striped fabric, open at the front. */
export function tentHide({ w = 1.6, d = 1.6, h = 1.3, color = C.teal, color2 = C.white } = {}) {
  const lean = Math.atan2(w / 2, h);
  const side = Math.hypot(w / 2, h);
  const parts = [
    B(-w / 4, h / 2, 0.05, 0.04, side, d - 0.1, 'fabric', color, { rz: -lean }),
    B(w / 4, h / 2, 0.05, 0.04, side, d - 0.1, 'fabric', color2, { rz: lean }),
    B(0, h * 0.45, d / 2 - 0.02, w * 0.8, h * 0.9, 0.04, 'fabric', color),
    CY(0, h + 0.05, 0, 0.03, 0.2, 'wood', C.wood), CO(0, h + 0.2, 0, 0, 0.15, 0.07, 'plastic', C.red),
    B(0, 0.03, 0.05, w - 0.3, 0.06, d - 0.3, 'fabric', C.yellow),
  ];
  return {
    parts,
    colliders: [K(-w / 2, w / 2, 0, h, -d / 2, d / 2)],
    boxes: { use: K(-w / 2, w / 2, 0, h, -d / 2 - 0.02, d / 2) },
    points: { use: [0, 0.6, -d / 2 - 0.03], eye: [0, 0.45, 0.1], exit: [0, 0, -d / 2 - 0.6] },
    yaws: { eye: 0 },
  };
}

/**
 * Bunk bed. Its long axis runs along local X and its open side (ladder) faces -Z.
 * underbed: adds the hide points (camera lies under the bottom bunk, looking out the front).
 */
export function bunkBed({ len = 2.1, w = 1.0, color = C.blue, sheet = C.yellow, sheet2 = C.pink, underbed = false } = {}) {
  const post = 0.08;
  const parts = [];
  for (const [x, z] of [[-len / 2 + post / 2, -w / 2 + post / 2], [len / 2 - post / 2, -w / 2 + post / 2], [-len / 2 + post / 2, w / 2 - post / 2], [len / 2 - post / 2, w / 2 - post / 2]])
    parts.push(B(x, 0.85, z, post, 1.7, post, 'wood', color));
  for (const y of [0.42, 1.32]) {
    parts.push(B(0, y, 0, len, 0.08, w, 'wood', color)); // frame
    parts.push(B(0, y + 0.1, 0, len - 0.12, 0.14, w - 0.1, 'fabric', 0xf0ece0)); // mattress
    parts.push(B(0.1, y + 0.19, 0, len - 0.4, 0.05, w - 0.06, 'fabric', y < 1 ? sheet : sheet2)); // blanket
    parts.push(B(-len / 2 + 0.25, y + 0.22, 0, 0.3, 0.1, w - 0.3, 'fabric', C.white)); // pillow
  }
  parts.push(B(0, 1.55, -w / 2 + 0.04, len - 0.2, 0.06, 0.04, 'wood', color)); // top guard rail
  parts.push(B(0, 1.55, w / 2 - 0.04, len - 0.2, 0.06, 0.04, 'wood', color));
  for (let i = 0; i < 5; i++) parts.push(B(len / 2 - 0.05, 0.25 + i * 0.28, -w / 2 - 0.02, 0.05, 0.04, 0.3, 'wood', C.yellow)); // ladder rungs
  const out = { parts, colliders: [K(-len / 2, len / 2, 0, 1.7, -w / 2, w / 2)] };
  if (underbed) {
    out.boxes = { use: K(-len / 2, len / 2, 0, 0.45, -w / 2 - 0.02, w / 2) };
    out.points = { use: [0, 0.3, -w / 2 - 0.03], eye: [0, 0.16, -w / 2 + 0.25], exit: [0, 0, -w / 2 - 0.65] };
    out.yaws = { eye: 0 };
  }
  return out;
}

/** Crib on tall legs; underbed hide (the camera lies under it). */
export function crib({ len = 1.4, w = 0.8, color = C.white, mobile = true } = {}) {
  const parts = [];
  for (const [x, z] of [[-len / 2, -w / 2], [len / 2, -w / 2], [-len / 2, w / 2], [len / 2, w / 2]]) parts.push(B(x * 0.97, 0.55, z * 0.95, 0.06, 1.1, 0.06, 'wood', color));
  parts.push(B(0, 0.48, 0, len, 0.06, w, 'wood', color), B(0, 0.56, 0, len - 0.1, 0.1, w - 0.08, 'fabric', C.mint));
  for (let i = -6; i <= 6; i++) {
    parts.push(B(i * (len / 14), 0.82, -w / 2 + 0.02, 0.025, 0.5, 0.025, 'wood', color));
    parts.push(B(i * (len / 14), 0.82, w / 2 - 0.02, 0.025, 0.5, 0.025, 'wood', color));
  }
  parts.push(B(0, 1.07, -w / 2 + 0.02, len, 0.04, 0.05, 'wood', color), B(0, 1.07, w / 2 - 0.02, len, 0.04, 0.05, 'wood', color));
  parts.push(SP(-0.3, 0.7, 0.05, 0.1, 'fur', 0xe8c890)); // a little bear asleep inside
  return {
    parts,
    colliders: [K(-len / 2, len / 2, 0, 1.1, -w / 2, w / 2)],
    boxes: { use: K(-len / 2, len / 2, 0, 0.5, -w / 2 - 0.02, w / 2) },
    points: { use: [0, 0.3, -w / 2 - 0.03], eye: [0, 0.16, -w / 2 + 0.2], exit: [0, 0, -w / 2 - 0.6], mobile: [0, 1.75, 0] },
    yaws: { eye: 0 },
    mobile,
  };
}

/**
 * Ball pit: a square rim with an inner hole. Balls are instanced by meshes.js
 * inside `boxes.inner`. Front (-Z) is where you climb in.
 */
export function ballPit({ w = 3, d = 3, h = 0.6 } = {}) {
  const t = 0.18;
  const parts = [];
  const rimColors = [C.red, C.blue, C.yellow, C.green];
  const walls = [
    K(-w / 2, w / 2, 0, h, -d / 2, -d / 2 + t), K(-w / 2, w / 2, 0, h, d / 2 - t, d / 2),
    K(-w / 2, -w / 2 + t, 0, h, -d / 2 + t, d / 2 - t), K(w / 2 - t, w / 2, 0, h, -d / 2 + t, d / 2 - t),
  ];
  walls.forEach((b, i) => {
    parts.push(B((b.minX + b.maxX) / 2, h / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, h, b.maxZ - b.minZ, 'fabric', rimColors[i]));
    parts.push(B((b.minX + b.maxX) / 2, h + 0.03, (b.minZ + b.maxZ) / 2, b.maxX - b.minX + 0.02, 0.06, b.maxZ - b.minZ + 0.02, 'fabric', C.white));
  });
  parts.push(B(0, 0.02, 0, w - 2 * t, 0.04, d - 2 * t, 'fabric', C.blue));
  const inner = K(-w / 2 + t, w / 2 - t, 0.05, h - 0.1, -d / 2 + t, d / 2 - t);
  return {
    parts,
    colliders: walls,
    boxes: { use: K(-w / 2, w / 2, 0, h + 0.1, -d / 2 - 0.02, d / 2), inner, hole: K(-w / 2, w / 2, 0, h, -d / 2, d / 2) },
    points: { use: [0, h, -d / 2 - 0.03], eye: [0, 0.32, 0.3], exit: [0, 0, -d / 2 - 0.6] },
    yaws: { eye: 0 },
  };
}

// ---- toys & decor -------------------------------------------------------------------

export function toyPiano({ color = C.red } = {}) {
  const w = 1.1;
  const parts = [
    ...legs(w, 0.45, 0.32, 'plastic', color, 0.07, 0.04),
    B(0, 0.5, 0.02, w, 0.36, 0.45, 'plastic', color),
    B(0, 0.69, -0.12, w - 0.1, 0.03, 0.18, 'plastic', C.white),
    B(0, 0.86, 0.17, w - 0.05, 0.3, 0.06, 'plastic', color), // music rest
    B(0, 0.74, 0.14, 0.3, 0.2, 0.01, 'plastic', C.cream, { rx: -0.2 }), // sheet music
  ];
  for (let i = 0; i < 9; i++) if (i % 7 !== 2 && i % 7 !== 6) parts.push(B(-0.4 + i * 0.1 + 0.05, 0.72, -0.08, 0.05, 0.03, 0.1, 'dark', C.black));
  return { parts, colliders: [K(-w / 2, w / 2, 0, 1.0, -0.23, 0.25)], points: { use: [0, 0.7, -0.25] } };
}

export function drumKit() {
  const parts = [
    CY(0, 0.3, 0, 0.3, 0.28, 'plastic', C.blue, { rx: HALF_PI, seg: 12 }),
    CY(0, 0.3, -0.15, 0.24, 0.01, 'plastic', C.white, { rx: HALF_PI, seg: 12 }),
    CY(0.45, 0.45, -0.1, 0.17, 0.14, 'plastic', C.red, { seg: 10 }), CY(0.45, 0.2, -0.1, 0.02, 0.4, 'metal', C.steel),
    CY(-0.45, 0.9, 0.05, 0.22, 0.015, 'metal', C.brass, { seg: 10, rz: 0.15 }), CY(-0.45, 0.45, 0.05, 0.015, 0.9, 'metal', C.steel),
  ];
  return { parts, colliders: [K(-0.65, 0.65, 0, 0.6, -0.3, 0.3)] };
}

export function xylophone() {
  const parts = [...legs(0.8, 0.4, 0.35, 'wood', C.paleWood, 0.04, 0.03), B(0, 0.37, 0, 0.8, 0.04, 0.4, 'wood', C.paleWood)];
  RAINBOW.forEach((c, i) => parts.push(B(-0.3 + i * 0.12, 0.41, 0, 0.09, 0.03, 0.34 - i * 0.03, 'plastic', c)));
  parts.push(CY(0.2, 0.42, 0.24, 0.012, 0.3, 'wood', C.wood, { rz: HALF_PI, ry: 0.4 }), SP(0.33, 0.42, 0.18, 0.025, 'plastic', C.red));
  return { parts, colliders: [K(-0.4, 0.4, 0, 0.45, -0.2, 0.2)] };
}

export function rockingHorse({ color = 0xe85a3a, mane = C.yellow, sheet = false } = {}) {
  if (sheet) {
    // dust sheet thrown over it: just a lumpy ghost shape
    const parts = [B(0, 0.45, 0, 1.0, 0.7, 0.45, 'fabric', 0xe0dcd0, { rz: 0.05 }), SP(0.35, 0.85, 0, 0.22, 'fabric', 0xe0dcd0), B(0, 0.06, 0, 1.1, 0.1, 0.55, 'fabric', 0xd8d4c8)];
    return { parts, colliders: [K(-0.55, 0.55, 0, 1.0, -0.28, 0.28)] };
  }
  const parts = [
    B(0, 0.08, -0.18, 1.0, 0.06, 0.05, 'wood', C.wood, { rz: 0 }), B(0, 0.08, 0.18, 1.0, 0.06, 0.05, 'wood', C.wood),
    B(-0.25, 0.25, 0, 0.05, 0.35, 0.4, 'wood', C.wood), B(0.25, 0.25, 0, 0.05, 0.35, 0.4, 'wood', C.wood),
    B(0, 0.5, 0, 0.7, 0.25, 0.25, 'plastic', color), B(0.38, 0.72, 0, 0.18, 0.35, 0.18, 'plastic', color, { rz: -0.4 }),
    B(0.5, 0.86, 0, 0.26, 0.15, 0.16, 'plastic', color), B(0.3, 0.8, 0, 0.12, 0.3, 0.06, 'fabric', mane, { rz: -0.4 }),
    B(-0.38, 0.5, 0, 0.12, 0.25, 0.05, 'fabric', mane, { rz: 0.6 }), B(0, 0.64, 0, 0.3, 0.04, 0.27, 'plastic', C.blue),
    SP(0.55, 0.9, 0.08, 0.02, 'dark', C.black), SP(0.55, 0.9, -0.08, 0.02, 'dark', C.black),
  ];
  return { parts, colliders: [K(-0.5, 0.6, 0, 0.95, -0.22, 0.22)] };
}

export function floorLamp({ shade = 0xf0c070, pole = C.brass, h = 1.55 } = {}) {
  const parts = [
    CY(0, 0.02, 0, 0.2, 0.04, 'metal', pole, { seg: 10 }), CY(0, h / 2, 0, 0.02, h, 'metal', pole),
    CO(0, h, 0, 0.16, 0.28, 0.26, 'fabric', shade, { seg: 10 }),
  ];
  return { parts, colliders: [K(-0.2, 0.2, 0, h + 0.15, -0.2, 0.2)], points: { bulb: [0, h - 0.04, 0] } };
}

export function coatRack() {
  const parts = [CY(0, 0.8, 0, 0.03, 1.6, 'wood', C.darkWood), CY(0, 0.03, 0, 0.22, 0.06, 'wood', C.darkWood, { seg: 8 })];
  for (let i = 0; i < 4; i++) parts.push(B(Math.cos(i * HALF_PI) * 0.12, 1.55, Math.sin(i * HALF_PI) * 0.12, 0.18, 0.03, 0.03, 'wood', C.darkWood, { ry: -i * HALF_PI }));
  parts.push(B(0.1, 1.15, 0.05, 0.3, 0.7, 0.12, 'fabric', C.yellow), B(-0.08, 1.25, -0.1, 0.22, 0.5, 0.1, 'fabric', C.red, { ry: 0.6 }));
  return { parts, colliders: [K(-0.22, 0.22, 0, 1.65, -0.22, 0.22)] };
}

export function bench({ w = 1.2, color = C.paleWood, cushion = C.teal } = {}) {
  const parts = [...legs(w, 0.4, 0.38, 'wood', color), B(0, 0.4, 0, w, 0.05, 0.4, 'wood', color), B(0, 0.45, 0, w - 0.1, 0.06, 0.36, 'fabric', cushion)];
  parts.push(B(-0.3, 0.06, 0, 0.12, 0.12, 0.26, 'plastic', C.red), B(-0.12, 0.06, 0.02, 0.12, 0.12, 0.26, 'plastic', C.red)); // little boots
  return { parts, colliders: [K(-w / 2, w / 2, 0, 0.5, -0.2, 0.2)] };
}

export function umbrellaStand() {
  const parts = [CY(0, 0.25, 0, 0.13, 0.5, 'metal', C.darkGray, { seg: 10 }), CY(0.03, 0.55, 0, 0.012, 0.6, 'plastic', C.black, { rz: 0.1 }), CO(0.06, 0.75, 0, 0.02, 0.35, 0.07, 'fabric', C.yellow, { rz: 0.1 })];
  return { parts, colliders: [K(-0.14, 0.14, 0, 0.9, -0.14, 0.14)] };
}

export function beanbag({ color = C.orange } = {}) {
  return { parts: [SP(0, 0.25, 0, 0.42, 'fabric', color, { seg: 8 }), SP(0, 0.42, 0.12, 0.3, 'fabric', color)], colliders: [K(-0.4, 0.4, 0, 0.6, -0.4, 0.4)] };
}

export function toyBox({ color = C.green, lid = C.yellow } = {}) {
  const parts = [B(0, 0.25, 0, 0.8, 0.5, 0.5, 'plastic', color), B(0, 0.53, 0.02, 0.84, 0.06, 0.54, 'plastic', lid, { rx: -0.05 })];
  parts.push(SP(-0.2, 0.62, -0.05, 0.08, 'plastic', C.red), B(0.15, 0.6, 0, 0.1, 0.1, 0.1, 'plastic', C.blue, { ry: 0.5 }));
  return { parts, colliders: [K(-0.4, 0.4, 0, 0.6, -0.25, 0.27)] };
}

/** Wooden block tower. Decor only (Gameplay places the trap ones). */
export function blockTower({ n = 6, seed = 2 } = {}) {
  const parts = [];
  let k = seed;
  for (let i = 0; i < n; i++) {
    k = (k * 16807) % 2147483647;
    parts.push(B(((k % 5) - 2) * 0.012, 0.06 + i * 0.1, 0, 0.1, 0.1, 0.1, 'plastic', RAINBOW[k % 6], { ry: (k % 9) * 0.1 }));
  }
  return { parts, colliders: [] };
}

export function sleepingBag({ color = C.purple } = {}) {
  return { parts: [B(0, 0.06, 0, 0.7, 0.12, 1.6, 'fabric', color), B(0, 0.08, 0.6, 0.5, 0.14, 0.3, 'fabric', C.white), B(0, 0.1, -0.2, 0.68, 0.12, 0.9, 'fabric', 0x5a3a90, { rx: 0.05 })], colliders: [] };
}

export function easel() {
  const parts = [
    B(-0.25, 0.7, 0, 0.04, 1.45, 0.04, 'wood', C.paleWood, { rz: -0.12 }), B(0.25, 0.7, 0, 0.04, 1.45, 0.04, 'wood', C.paleWood, { rz: 0.12 }),
    B(0, 0.65, 0.3, 0.04, 1.3, 0.04, 'wood', C.paleWood, { rx: 0.35 }),
    B(0, 0.95, -0.03, 0.6, 0.5, 0.02, 'paper', C.white, { rx: -0.08, tex: 'drawing2' }),
    B(0, 0.67, -0.04, 0.62, 0.04, 0.08, 'wood', C.paleWood),
  ];
  return { parts, colliders: [K(-0.35, 0.35, 0, 1.4, -0.15, 0.4)] };
}

export function paintShelf() {
  const out = bookshelf({ w: 1.0, h: 1.1, d: 0.35, color: C.white, seed: 9 });
  return out;
}

export function tvStandDrawer() {
  return drawerUnit({ w: 1.2, h: 0.62, d: 0.5, color: C.darkWood, front: C.wood, knob: C.brass });
}

export function sink({ color = C.white } = {}) {
  const parts = [CY(0, 0.4, 0.05, 0.08, 0.8, 'plastic', color, { seg: 8 }), B(0, 0.85, 0, 0.6, 0.14, 0.45, 'plastic', color), B(0, 0.92, -0.02, 0.44, 0.02, 0.3, 'dark', 0x2a3038), CY(0, 1.0, 0.18, 0.02, 0.18, 'metal', C.steel), B(0, 1.08, 0.12, 0.03, 0.03, 0.14, 'metal', C.steel)];
  return { parts, colliders: [K(-0.3, 0.3, 0, 1.0, -0.23, 0.23)] };
}

export function toilet() {
  const parts = [B(0, 0.2, 0.02, 0.36, 0.4, 0.45, 'plastic', C.white), B(0, 0.42, -0.03, 0.4, 0.05, 0.5, 'plastic', C.white), B(0, 0.62, 0.22, 0.42, 0.42, 0.18, 'plastic', C.white), B(0, 0.85, 0.22, 0.44, 0.04, 0.2, 'plastic', C.white)];
  return { parts, colliders: [K(-0.22, 0.22, 0, 0.88, -0.28, 0.31)] };
}

export function bathtub({ len = 1.6, w = 0.75 } = {}) {
  const t = 0.08;
  const parts = [
    B(0, 0.28, -w / 2 + t / 2, len, 0.56, t, 'plastic', C.white), B(0, 0.28, w / 2 - t / 2, len, 0.56, t, 'plastic', C.white),
    B(-len / 2 + t / 2, 0.28, 0, t, 0.56, w, 'plastic', C.white), B(len / 2 - t / 2, 0.28, 0, t, 0.56, w, 'plastic', C.white),
    B(0, 0.06, 0, len, 0.12, w, 'plastic', C.white), B(0, 0.4, 0, len - 0.2, 0.02, w - 0.2, 'glow', 0x4a7088), // still water
    SP(0.2, 0.45, 0.05, 0.06, 'plastic', C.yellow), SP(0.26, 0.5, 0.05, 0.035, 'plastic', C.yellow), // rubber duck
    SP(-0.3, 0.45, -0.1, 0.05, 'plastic', C.yellow), SP(-0.26, 0.49, -0.1, 0.03, 'plastic', C.yellow),
    CY(len / 2 - 0.1, 0.7, 0, 0.02, 0.3, 'metal', C.steel),
  ];
  return { parts, colliders: [K(-len / 2, len / 2, 0, 0.56, -w / 2, w / 2)] };
}

export function hamper({ color = C.lilac } = {}) {
  return { parts: [CY(0, 0.3, 0, 0.22, 0.6, 'fabric', color, { seg: 8 }), B(0.05, 0.62, 0, 0.3, 0.06, 0.18, 'fabric', C.pink, { rz: 0.4 })], colliders: [K(-0.22, 0.22, 0, 0.62, -0.22, 0.22)] };
}

export function counterRun({ len = 2.4, color = C.white, top = C.mint, stove = false, sinkAt = null } = {}) {
  // a play-kitchen counter, length along X, front -Z
  const d = 0.6;
  const parts = [B(0, 0.42, 0.02, len, 0.84, d - 0.04, 'wood', color), B(0, 0.87, 0, len + 0.04, 0.06, d, 'wood', top)];
  for (let i = 0; i < Math.round(len / 0.6); i++) {
    const x = -len / 2 + 0.3 + i * 0.6;
    parts.push(B(x, 0.42, -d / 2 + 0.005, 0.54, 0.74, 0.01, 'wood', i % 2 ? C.pink : C.teal));
    parts.push(SP(x + 0.18, 0.55, -d / 2 - 0.01, 0.025, 'plastic', C.yellow));
  }
  if (stove) {
    parts.push(B(-len / 2 + 0.4, 0.905, 0, 0.6, 0.02, 0.5, 'dark', 0x222226));
    for (const [x, z] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.12], [0.14, 0.12]]) parts.push(CY(-len / 2 + 0.4 + x, 0.92, z, 0.08, 0.02, 'metal', 0x6a6a72, { seg: 10 }));
    parts.push(CY(-len / 2 + 0.26, 0.98, -0.1, 0.1, 0.12, 'metal', C.steel, { seg: 10 }), CY(-len / 2 + 0.55, 0.96, 0.12, 0.12, 0.06, 'metal', 0x484850, { seg: 10 }));
  }
  if (sinkAt !== null) {
    parts.push(B(sinkAt, 0.905, 0, 0.5, 0.02, 0.36, 'dark', 0x2a3038), CY(sinkAt, 1.02, 0.22, 0.02, 0.24, 'metal', C.steel), B(sinkAt, 1.13, 0.15, 0.03, 0.03, 0.16, 'metal', C.steel));
  }
  return { parts, colliders: [K(-len / 2, len / 2, 0, 0.9, -d / 2, d / 2)] };
}

export function fridge({ color = C.white } = {}) {
  const parts = [B(0, 0.85, 0, 0.7, 1.7, 0.65, 'plastic', color), B(0, 1.2, -0.33, 0.66, 0.01, 0.005, 'dark', C.black), B(-0.25, 1.4, -0.34, 0.04, 0.3, 0.03, 'metal', C.steel), B(-0.25, 0.8, -0.34, 0.04, 0.3, 0.03, 'metal', C.steel)];
  parts.push(B(0.12, 1.5, -0.335, 0.2, 0.15, 0.01, 'paper', C.white, { tex: 'drawing1' }), SP(0.02, 1.62, -0.34, 0.025, 'plastic', C.red), SP(0.2, 1.0, -0.34, 0.025, 'plastic', C.green));
  return { parts, colliders: [K(-0.35, 0.35, 0, 1.7, -0.33, 0.33)] };
}

export function workbench({ len = 1.8, d = 0.7 } = {}) {
  const parts = [...legs(len, d, 0.86, 'wood', C.darkWood, 0.08), B(0, 0.89, 0, len, 0.06, d, 'wood', C.wood), B(0, 0.25, 0, len - 0.1, 0.03, d - 0.1, 'wood', C.darkWood)];
  parts.push(B(0.5, 0.95, 0.1, 0.25, 0.06, 0.1, 'metal', C.red), B(-0.3, 0.93, 0, 0.3, 0.02, 0.06, 'metal', C.steel, { ry: 0.3 }), CY(-0.6, 0.97, 0.15, 0.06, 0.1, 'metal', 0x5a8a5a, { seg: 8 }));
  return { parts, colliders: [K(-len / 2, len / 2, 0, 0.95, -d / 2, d / 2)] };
}

export function jeep({ color = 0xe0408a, trim = C.white } = {}) {
  // a big ride-on toy jeep, front facing -Z
  const parts = [
    B(0, 0.38, 0, 0.9, 0.34, 1.45, 'plastic', color),
    B(0, 0.62, 0.15, 0.86, 0.16, 0.8, 'plastic', color),
    B(0, 0.6, -0.48, 0.86, 0.18, 0.45, 'plastic', color), // hood
    B(0, 0.85, -0.25, 0.8, 0.3, 0.04, 'plastic', 0x9ad0f0, { rx: 0.25 }), // windscreen
    B(0, 0.52, 0.3, 0.6, 0.18, 0.35, 'plastic', C.black), // seat
    CY(0, 0.82, -0.12, 0.13, 0.03, 'plastic', C.black, { rx: -0.9, seg: 10 }), // steering wheel
    B(0, 0.5, -0.74, 0.7, 0.14, 0.05, 'plastic', trim), // grille
    SP(-0.3, 0.55, -0.73, 0.06, 'glow', 0xfff4c0), SP(0.3, 0.55, -0.73, 0.06, 'glow', 0xfff4c0),
    B(0, 1.05, 0.55, 0.86, 0.04, 0.05, 'plastic', trim), B(-0.42, 0.85, 0.55, 0.04, 0.45, 0.04, 'plastic', trim), B(0.42, 0.85, 0.55, 0.04, 0.45, 0.04, 'plastic', trim),
    B(-0.15, 0.72, -0.48, 0.18, 0.06, 0.12, 'plastic', C.yellow), // battery hatch
  ];
  for (const [x, z] of [[-0.47, -0.45], [0.47, -0.45], [-0.47, 0.45], [0.47, 0.45]]) {
    parts.push(CY(x, 0.2, z, 0.2, 0.14, 'plastic', C.black, { rz: HALF_PI, seg: 10 }), CY(x * 1.02, 0.2, z, 0.1, 0.15, 'plastic', C.white, { rz: HALF_PI, seg: 8 }));
  }
  return { parts, colliders: [K(-0.55, 0.55, 0, 1.08, -0.76, 0.6)], boxes: { use: K(-0.5, 0.5, 0.2, 1.0, -0.76, 0.6) }, points: { use: [0, 0.7, -0.2] } };
}

export function dogHouse({ w = 2.2, d = 2.2, h = 1.5, color = 0xb04a3a, roof = 0x5a3a2a } = {}) {
  // opening at the front (-Z)
  const t = 0.1;
  const parts = [
    B(-w / 2 + t / 2, h / 2, 0, t, h, d, 'wood', color), B(w / 2 - t / 2, h / 2, 0, t, h, d, 'wood', color),
    B(0, h / 2, d / 2 - t / 2, w, h, t, 'wood', color),
    B(-w / 2 + 0.35, h / 2, -d / 2 + t / 2, 0.7, h, t, 'wood', color), B(w / 2 - 0.35, h / 2, -d / 2 + t / 2, 0.7, h, t, 'wood', color),
    B(0, h - 0.15, -d / 2 + t / 2, w, 0.3, t, 'wood', color),
    B(-w / 4 - 0.05, h + 0.32, 0, w / 2 + 0.35, 0.08, d + 0.2, 'wood', roof, { rz: 0.55 }),
    B(w / 4 + 0.05, h + 0.32, 0, w / 2 + 0.35, 0.08, d + 0.2, 'wood', roof, { rz: -0.55 }),
    B(0, h + 0.2, -d / 2 + t / 2, w * 0.7, 0.35, t, 'wood', color),
    B(0, h - 0.12, -d / 2 - 0.01, 0.8, 0.18, 0.02, 'paper', C.white, { tex: 'doodleName' }),
    B(0, 0.05, 0, w - 0.2, 0.1, d - 0.2, 'fabric', 0x7a6050), // old straw blanket
  ];
  return { parts, colliders: [K(-w / 2, w / 2, 0, h + 0.6, -d / 2, d / 2)] };
}

export function dogBed({ r = 0.9, color = 0x8a3a3a } = {}) {
  // chewed up: a lumpy torus with a bite out of it, plus stuffing
  const parts = [CY(0, 0.06, 0, r - 0.2, 0.1, 'fabric', 0xb07060, { seg: 12 })];
  for (let i = 0; i < 11; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(SP(Math.cos(a) * (r - 0.12), 0.16, Math.sin(a) * (r - 0.12), 0.18 + (i % 3) * 0.02, 'fabric', color));
  }
  parts.push(SP(Math.cos(5.9) * r, 0.05, Math.sin(5.9) * r, 0.08, 'fabric', C.white), SP(Math.cos(6.1) * (r + 0.2), 0.04, Math.sin(6.1) * (r + 0.2), 0.06, 'fabric', C.white));
  return { parts, colliders: [] };
}

export function bone({ len = 0.32, color = 0xf0e8d8 } = {}) {
  return {
    parts: [CY(0, 0.035, 0, 0.03, len, 'plastic', color, { rz: HALF_PI }), SP(-len / 2, 0.04, -0.03, 0.04, 'plastic', color), SP(-len / 2, 0.04, 0.03, 0.04, 'plastic', color), SP(len / 2, 0.04, -0.03, 0.04, 'plastic', color), SP(len / 2, 0.04, 0.03, 0.04, 'plastic', color)],
    colliders: [],
  };
}

export function bowl({ color = C.red, food = 0x7a4a2a } = {}) {
  return { parts: [CO(0, 0.06, 0, 0.18, 0.12, 0.14, 'plastic', color, { seg: 10 }), CY(0, 0.1, 0, 0.15, 0.02, 'fabric', food, { seg: 10 })], colliders: [] };
}

export function chewedToy({ color = C.yellow } = {}) {
  return { parts: [SP(0, 0.1, 0, 0.1, 'fur', color), SP(0.12, 0.08, 0.03, 0.06, 'fur', color), SP(-0.1, 0.03, 0.12, 0.05, 'fabric', C.white), SP(0.02, 0.18, 0, 0.04, 'fur', color)], colliders: [] };
}

export function boiler() {
  const parts = [CY(0, 1.0, 0, 0.55, 2.0, 'metal', 0x8a7a6a, { seg: 12 }), CY(0, 2.05, 0, 0.45, 0.1, 'metal', 0x6a5a4a, { seg: 12 }), CY(0, 2.5, 0.2, 0.1, 0.9, 'metal', 0x5a5a5a)];
  parts.push(B(0, 0.5, -0.53, 0.35, 0.25, 0.08, 'metal', 0x3a3a3a), B(0, 0.5, -0.575, 0.25, 0.12, 0.01, 'glow', 0xff6a20)); // fire window
  parts.push(CY(0.35, 1.5, -0.5, 0.08, 0.04, 'metal', C.white, { rx: HALF_PI, seg: 10 }), B(0.35, 1.5, -0.525, 0.01, 0.06, 0.005, 'dark', C.black, { rz: 0.8 }));
  return { parts, colliders: [K(-0.56, 0.56, 0, 2.95, -0.6, 0.56)] };
}

export function waterHeater() {
  const parts = [CY(0, 0.8, 0, 0.32, 1.6, 'metal', 0xc8c8c0, { seg: 10 }), CY(0, 1.65, 0, 0.12, 0.1, 'metal', 0x8a8a80, { seg: 8 }), CY(0, 2.3, 0, 0.05, 1.3, 'metal', 0x9a6a3a)];
  return { parts, colliders: [K(-0.33, 0.33, 0, 2.95, -0.33, 0.33)] };
}

export function washer({ color = C.white, dryer = false } = {}) {
  const parts = [B(0, 0.45, 0, 0.62, 0.9, 0.62, 'plastic', color), CY(0, 0.45, -0.31, 0.21, 0.02, 'metal', C.steel, { rx: HALF_PI, seg: 14 }), CY(0, 0.45, -0.32, 0.16, 0.01, dryer ? 'dark' : 'glow', dryer ? 0x202024 : 0x3a5a70, { rx: HALF_PI, seg: 14 })];
  parts.push(B(0, 0.82, -0.3, 0.55, 0.1, 0.02, 'plastic', 0xd0d0d8), SP(0.2, 0.82, -0.32, 0.025, 'plastic', C.red));
  return { parts, colliders: [K(-0.31, 0.31, 0, 0.9, -0.31, 0.31)] };
}

export function laundryBasket({ color = C.blue } = {}) {
  const parts = [B(0, 0.17, 0, 0.6, 0.34, 0.42, 'plastic', color), B(-0.1, 0.36, 0, 0.3, 0.12, 0.3, 'fabric', C.pink, { rz: 0.2 }), B(0.12, 0.38, 0.02, 0.26, 0.1, 0.26, 'fabric', C.white, { ry: 0.4 }), B(0.3, 0.05, -0.3, 0.2, 0.06, 0.1, 'fabric', C.green, { ry: 0.5 })];
  return { parts, colliders: [K(-0.3, 0.3, 0, 0.42, -0.21, 0.21)] };
}

export function ironingBoard() {
  const parts = [B(0, 0.8, 0, 1.2, 0.03, 0.34, 'fabric', 0x9ad0f0), B(0, 0.4, 0, 0.03, 0.8, 0.03, 'metal', C.steel, { rz: 0.5 }), B(0, 0.4, 0, 0.03, 0.8, 0.03, 'metal', C.steel, { rz: -0.5 })];
  return { parts, colliders: [K(-0.6, 0.6, 0, 0.82, -0.17, 0.17)] };
}

export function fuseBox() {
  const parts = [B(0, 0, 0.04, 0.45, 0.6, 0.08, 'metal', 0x6a7078), B(0, 0, -0.005, 0.4, 0.55, 0.01, 'metal', 0x8a9098), B(0.13, -0.05, -0.02, 0.06, 0.12, 0.03, 'metal', C.black), B(0, 0.2, -0.012, 0.3, 0.08, 0.005, 'paper', C.yellow, { tex: 'danger' })];
  return { parts, colliders: [], boxes: { use: K(-0.23, 0.23, -0.31, 0.31, -0.02, 0.09) }, points: { use: [0, 0, -0.03] } };
}

export function keypad() {
  const parts = [B(0, 0, 0.02, 0.22, 0.3, 0.05, 'plastic', 0x2a2a30), B(0, 0.09, -0.006, 0.17, 0.06, 0.01, 'glow', 0x40ff80)];
  const colors = [C.red, C.yellow, C.blue, C.green, C.orange, C.purple, C.pink, C.teal, C.white];
  for (let i = 0; i < 9; i++) parts.push(B(-0.06 + (i % 3) * 0.06, 0.02 - Math.floor(i / 3) * 0.055, -0.008, 0.045, 0.04, 0.012, 'plastic', colors[i]));
  parts.push(B(0, -0.13, -0.008, 0.045, 0.04, 0.012, 'plastic', C.white));
  return { parts, colliders: [], boxes: { use: K(-0.12, 0.12, -0.16, 0.16, -0.02, 0.05) }, points: { use: [0, 0, -0.02] } };
}

export function openerButton() {
  const parts = [B(0, 0, 0.02, 0.14, 0.22, 0.04, 'plastic', C.white), CY(0, 0.03, -0.005, 0.035, 0.03, 'plastic', C.red, { rx: HALF_PI, seg: 10 }), B(0, -0.06, -0.002, 0.08, 0.03, 0.005, 'glow', 0xff3020)];
  return { parts, colliders: [], boxes: { use: K(-0.08, 0.08, -0.12, 0.12, -0.03, 0.05) }, points: { use: [0, 0, -0.02] } };
}

export function cone() {
  return { parts: [CO(0, 0.22, 0, 0.02, 0.44, 0.13, 'plastic', C.orange, { seg: 8 }), B(0, 0.01, 0, 0.3, 0.02, 0.3, 'plastic', C.orange), CY(0, 0.25, 0, 0.075, 0.06, 'plastic', C.white, { seg: 8 })], colliders: [K(-0.15, 0.15, 0, 0.45, -0.15, 0.15)] };
}

export function tire() {
  return { parts: [CY(0, 0.12, 0, 0.32, 0.24, 'fabric', 0x222222, { seg: 12 }), CY(0, 0.125, 0, 0.16, 0.25, 'dark', C.black, { seg: 10 })], colliders: [K(-0.32, 0.32, 0, 0.25, -0.32, 0.32)] };
}

export function teaSet() {
  const parts = [CY(0, 0.06, 0, 0.07, 0.12, 'plastic', C.white, { seg: 8 }), CO(0, 0.14, 0, 0.02, 0.04, 0.05, 'plastic', C.pink, { seg: 8 }), B(0.09, 0.07, 0, 0.06, 0.02, 0.015, 'plastic', C.white, { rz: 0.5 })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(CY(Math.cos(a) * 0.4, 0.015, Math.sin(a) * 0.4, 0.07, 0.01, 'plastic', C.white, { seg: 8 }), CY(Math.cos(a) * 0.4, 0.045, Math.sin(a) * 0.4, 0.035, 0.05, 'plastic', RAINBOW[i], { seg: 8 }));
  }
  parts.push(CY(0.15, 0.04, 0.2, 0.1, 0.06, 'plastic', 0xf8c8a0, { seg: 10 }), CY(0.15, 0.075, 0.2, 0.1, 0.01, 'plastic', 0xffffff, { seg: 10 })); // a cake
  return { parts, colliders: [] };
}

export function changingTable() {
  return drawerUnit({ w: 1.0, h: 0.9, d: 0.55, color: C.white, front: C.mint, knob: C.pink });
}

export function rockingChair() {
  const parts = [
    B(0, 0.42, 0, 0.5, 0.05, 0.5, 'wood', C.white), B(0, 0.8, 0.24, 0.5, 0.7, 0.04, 'wood', C.white, { rx: 0.15 }),
    B(-0.23, 0.22, 0, 0.04, 0.4, 0.04, 'wood', C.white), B(0.23, 0.22, 0, 0.04, 0.4, 0.04, 'wood', C.white),
    B(-0.23, 0.04, 0, 0.04, 0.05, 0.9, 'wood', C.white), B(0.23, 0.04, 0, 0.04, 0.05, 0.9, 'wood', C.white),
    B(0, 0.48, -0.02, 0.44, 0.08, 0.44, 'fabric', C.pink), SP(0, 0.65, 0.05, 0.13, 'fur', 0xc89870), SP(0, 0.85, 0.05, 0.1, 'fur', 0xc89870),
  ];
  return { parts, colliders: [K(-0.27, 0.27, 0, 1.2, -0.45, 0.45)] };
}

/** A pile of teddy-coloured lumps under the instanced teddies, so the hoard reads as a mound. */
export function hoardMound({ w = 5, d = 3, h = 0.55 } = {}) {
  const parts = [B(0, h / 2, 0, w, h, d, 'fur', 0xa07850)];
  for (let i = 0; i < 9; i++) parts.push(SP(-w / 2 + 0.4 + (i % 5) * (w / 5), h, -d / 2 + 0.4 + Math.floor(i / 5) * 1.2, 0.35, 'fur', [0xb08858, 0xc8a070, 0x907050][i % 3]));
  return { parts, colliders: [K(-w / 2, w / 2, 0, h + 0.2, -d / 2, d / 2)] };
}

export function dressForm() {
  return { parts: [CY(0, 0.7, 0, 0.02, 1.4, 'wood', C.darkWood), CO(0, 1.15, 0, 0.16, 0.5, 0.2, 'fabric', 0xe8d8c8, { seg: 10 }), SP(0, 1.42, 0, 0.1, 'fabric', 0xe8d8c8), CY(0, 0.02, 0, 0.22, 0.04, 'wood', C.darkWood, { seg: 8 })], colliders: [K(-0.22, 0.22, 0, 1.5, -0.22, 0.22)] };
}

export function pipeRun({ len = 6, axis = 'x', r = 0.07, color = 0x7a6a5a } = {}) {
  const parts = [CY(0, 0, 0, r, len, 'metal', color, axis === 'x' ? { rz: HALF_PI } : { rx: HALF_PI })];
  return { parts, colliders: [] };
}

/** The Big Slide's top: a little platform lip around the hatch. Interact to slide. */
export function slideEntry() {
  const parts = [
    B(0, 0.12, 0.45, 1.0, 0.24, 0.1, 'plastic', C.red), B(0.45, 0.12, 0, 0.1, 0.24, 1.0, 'plastic', C.red), B(0, 0.12, -0.45, 1.0, 0.24, 0.1, 'plastic', C.red),
    B(0, 0.005, 0, 0.8, 0.01, 0.8, 'dark', C.black),
    B(-0.48, 0.75, 0.48, 0.08, 1.5, 0.08, 'plastic', C.blue), B(-0.48, 0.75, -0.48, 0.08, 1.5, 0.08, 'plastic', C.blue),
    B(-0.48, 1.52, 0, 0.1, 0.1, 1.04, 'plastic', C.yellow), B(-0.48, 1.75, 0, 0.04, 0.36, 0.9, 'paper', C.white, { tex: 'slideSign', ry: HALF_PI }),
  ];
  return { parts, colliders: [K(-0.5, 0.5, 0, 0.6, -0.5, 0.5)], boxes: { use: K(-0.5, 0.5, 0, 0.6, -0.5, 0.5) }, points: { use: [-0.5, 0.3, 0] } };
}

// ---- crawl spaces -------------------------------------------------------------------
// Their low roofs (minY 0.8) are what makes them crawl-only; the nav marks in the
// floor specs cover every cell under them so the Doodle never paths inside.

/** Wooden duct in the laundry: a crawl-in mouth (front, -Z), then a sealed sloping run. */
export function crawlDuct({ len = 5.9, d = 1.5, crawl = 1.5, color = 0x8a6a4a, trim = 0xf5d03a } = {}) {
  const z0 = -len / 2;
  const zc = z0 + crawl;
  const side = d / 2 - 0.1; // inner face of the outer (+X) panel
  const parts = [
    B(d / 2 - 0.05, 1.5, 0, 0.1, 3, len, 'wood', color), // outer side panel, floor to ceiling
    B(-0.05, 1.9, z0 + 0.05, d - 0.1, 2.2, 0.1, 'wood', color), // face above the mouth
    B(-0.05, 0.875, (z0 + zc) / 2 + 0.05, d - 0.1, 0.15, crawl - 0.1, 'wood', 0x5a4030), // crawl roof
    B(-0.05, 0.01, (z0 + zc) / 2, d - 0.1, 0.02, crawl, 'wood', 0x4a3424), // floorboards inside
    B(-0.05, 0.84, z0 - 0.01, d - 0.05, 0.08, 0.04, 'plastic', trim), // painted mouth frame
    B(side - 0.02, 0.4, z0 - 0.01, 0.06, 0.8, 0.04, 'plastic', trim),
    B(0.4, 1.4, z0 - 0.01, 0.6, 0.35, 0.02, 'paper', C.white, { tex: 'tunnelSign' }),
  ];
  return {
    parts,
    colliders: [
      K(side, d / 2, 0, 3, z0, len / 2),
      K(-d / 2, side, 0.8, 0.95, z0, zc),
      K(-d / 2, side, 0, 3, zc, len / 2),
    ],
  };
}

/** Cubby under the play-kitchen counter where the duct comes up. Opening faces -Z. */
export function cubby({ w = 2.0, d = 1.4 } = {}) {
  const parts = [
    B(-w / 2 + 0.05, 0.475, 0, 0.1, 0.95, d, 'wood', C.white), // side panel
    B(0, 0.875, 0, w, 0.15, d, 'wood', C.white), // counter top
    B(0, 0.97, 0, w + 0.04, 0.04, d + 0.02, 'wood', C.mint),
    B(0, 0.75, -d / 2 + 0.01, w, 0.1, 0.02, 'wood', C.pink), // skirt over the opening
    B(-w / 2 + 0.35, 0.4, -d / 2 - 0.25, 0.5, 0.62, 0.025, 'wood', C.teal, { ry: -1.1 }), // its little door, hanging open
    B(0.55, 0.004, 0.1, 0.7, 0.008, 0.8, 'dark', C.black), // the hatch down into the duct
    B(0.7, 0.4, d / 2 - 0.06, 0.7, 0.75, 0.04, 'wood', 0x6e4528, { rx: 0.12 }), // hatch lid leaning on the wall
    CY(-0.4, 1.05, 0.1, 0.12, 0.12, 'metal', C.steel, { seg: 10 }), CY(0.2, 1.03, -0.2, 0.1, 0.08, 'metal', C.red, { seg: 10 }),
  ];
  return {
    parts,
    colliders: [K(-w / 2, -w / 2 + 0.1, 0, 0.95, -d / 2, d / 2), K(-w / 2, w / 2, 0.8, 0.95, -d / 2, d / 2)],
  };
}

/** Rainbow play tube through the bedroom/playroom wall, along local X. */
export function playTube({ len = 3, r = 0.42 } = {}) {
  const parts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    parts.push({ s: 'tube', p: [x, r, 0], d: [r, len / n], axis: 'x', m: 'fabricDS', c: RAINBOW[i % 6] });
  }
  parts.push({ s: 'tube', p: [-len / 2 + 0.03, r, 0], d: [r + 0.04, 0.06], axis: 'x', m: 'plastic', c: C.white });
  parts.push({ s: 'tube', p: [len / 2 - 0.03, r, 0], d: [r + 0.04, 0.06], axis: 'x', m: 'plastic', c: C.white });
  // split at the wall it passes through (local x = 0) so nothing overlaps the wall itself
  const colliders = [];
  for (const [x0, x1] of [[-len / 2, -0.1], [0.1, len / 2]])
    colliders.push(K(x0, x1, 0, 0.9, -0.55, -0.5), K(x0, x1, 0, 0.9, 0.5, 0.55), K(x0, x1, 0.8, 0.9, -0.55, 0.55));
  return { parts, colliders };
}
