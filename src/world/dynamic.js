// Doors and containers: the moving meshes, tagged for Gameplay's look-ray,
// eased toward whatever state build.js says they're in. The state itself
// (isOpen, locked, colliders, events) lives in build.js; this file only
// animates it.

import * as THREE from 'three';
import { Bucket, pushBox, pushRound, partMatrix } from './geom.js';

const DOOR_COLORS = [0xf07ab8, 0x3a7be0, 0x45b85a, 0xf5d03a, 0x8a52d0, 0x2fb8a8, 0xf08a24];
const ease = (t) => t * t * (3 - 2 * t);

function hash(str) {
  let h = 7;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Geometry for one door leaf, extending along +X from its hinge, floor at y = 0. */
function leafGeometry(len, h, style, color) {
  const b = new Bucket();
  const box = (x, y, z, sx, sy, sz, c) => pushBox(b, partMatrix({ p: [x, y, z] }), [sx / 2, sy / 2, sz / 2], c, 0.6);
  const t = 0.06;
  box(len / 2, h / 2, 0, len, h, t, color);
  const lighter = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25).getHex();
  if (style === 'old') {
    for (let i = 1; i < 5; i++) box((len * i) / 5, h / 2, 0, 0.012, h - 0.04, t + 0.006, 0x3a2414);
    box(0.12, h * 0.8, 0, 0.18, 0.06, t + 0.012, 0x2a2a2a);
    box(0.12, h * 0.2, 0, 0.18, 0.06, t + 0.012, 0x2a2a2a);
  } else if (style === 'front') {
    box(len / 2, h * 0.3, 0, len * 0.7, h * 0.36, t + 0.016, lighter);
    box(len / 2, h * 0.76, 0, len * 0.6, h * 0.26, t + 0.004, 0x1a2440); // dark glass
    box(len / 2, h * 0.76, 0, 0.03, h * 0.26, t + 0.012, color);
  } else {
    box(len * 0.5, h * 0.72, 0, len * 0.7, h * 0.34, t + 0.016, lighter);
    box(len * 0.5, h * 0.27, 0, len * 0.7, h * 0.34, t + 0.016, lighter);
  }
  for (const z of [-t / 2 - 0.03, t / 2 + 0.03]) pushRound(b, { s: 'sph', p: [len - 0.12, 1.0, z], d: [0.04], c: 0xc8a040, seg: 8 });
  return b.geometry();
}

function rollupGeometry(w, h) {
  const b = new Bucket();
  pushBox(b, partMatrix({ p: [0, h / 2, 0] }), [0.03, h / 2, w / 2], 0xb8c0c8, 0.6);
  for (let y = 0.15; y < h; y += 0.3) pushBox(b, partMatrix({ p: [-0.035, y, 0] }), [0.012, 0.04, w / 2 - 0.02], 0x8a929a, 0.6);
  pushBox(b, partMatrix({ p: [-0.05, 1.0, 0] }), [0.02, 0.04, 0.2], 0x404448, 0.6);
  return b.geometry();
}

/**
 * @returns {{group: THREE.Group, interactables: THREE.Object3D[], update: (dt: number) => void,
 *            syncDoor: (door) => void, syncContainer: (c) => void, dispose: () => void}}
 */
export function buildDynamic(world, material) {
  const group = new THREE.Group();
  group.name = 'worldDynamic';
  const interactables = [];
  const geometries = [];
  const anims = new Map(); // id → [{ t, target, speed, apply }]
  const woodMat = material('wood');

  const track = (id, anim) => {
    if (!anims.has(id)) anims.set(id, []);
    anims.get(id).push(anim);
  };
  const tag = (mesh, kind, id) => {
    mesh.userData.interact = { kind, id };
    interactables.push(mesh);
    return mesh;
  };

  // ---- doors ----
  for (const spec of world.geo.doorSpecs) {
    const len = spec.to - spec.from;
    const h = spec.height - 0.02;
    if (spec.kind === 'rollup') {
      const g = rollupGeometry(len - 0.04, h);
      geometries.push(g);
      const mesh = tag(new THREE.Mesh(g, woodMat), 'door', spec.id);
      const base = new THREE.Vector3(spec.at, spec.y, (spec.from + spec.to) / 2);
      if (spec.axis === 'x') {
        base.set((spec.from + spec.to) / 2, spec.y, spec.at);
        mesh.rotation.y = Math.PI / 2;
      }
      mesh.position.copy(base);
      group.add(mesh);
      // rolls up into the wall above the opening
      track(spec.id, { t: 0, target: 0, speed: 0.7, apply: (e) => (mesh.position.y = base.y + e * (h - 0.12)) });
      continue;
    }
    const color = spec.style === 'front' ? 0xc8303a : spec.style === 'old' ? 0x6e4528 : DOOR_COLORS[hash(spec.id) % DOOR_COLORS.length];
    const leaves = spec.kind === 'double'
      ? [{ hinge: 'from', len: len / 2 }, { hinge: 'to', len: len / 2 }]
      : [{ hinge: spec.hinge, len }];
    for (const leaf of leaves) {
      // Double leaves overlap 1 cm at the center so a look-ray down the middle can't slip between them.
      const g = leafGeometry(leaf.len - (spec.kind === 'double' ? 0.005 : 0.02), h, spec.style, color);
      geometries.push(g);
      const at = leaf.hinge === 'from' ? spec.from + 0.01 : spec.to - 0.01;
      // the second leaf of a double door sits 1 mm off the first's plane so their overlap can't z-fight
      const off = spec.kind === 'double' && leaf.hinge === 'to' ? 0.001 : 0;
      const pivot = new THREE.Group();
      let baseYaw;
      if (spec.axis === 'x') {
        pivot.position.set(at, spec.y, spec.at + off);
        baseYaw = leaf.hinge === 'from' ? 0 : Math.PI;
      } else {
        pivot.position.set(spec.at + off, spec.y, at);
        baseYaw = leaf.hinge === 'from' ? -Math.PI / 2 : Math.PI / 2;
      }
      // open toward the swing side: try +90°, flip if the free end goes the wrong way
      const n = spec.axis === 'x' ? [0, spec.swing] : [spec.swing, 0];
      const dirAt = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];
      const plus = dirAt(baseYaw + Math.PI / 2);
      const delta = plus[0] * n[0] + plus[1] * n[1] > 0 ? Math.PI / 2 : -Math.PI / 2;
      pivot.rotation.y = baseYaw;
      const mesh = tag(new THREE.Mesh(g, woodMat), 'door', spec.id);
      pivot.add(mesh);
      group.add(pivot);
      track(spec.id, { t: 0, target: 0, speed: 2.2, apply: (e) => (pivot.rotation.y = baseYaw + delta * 0.94 * e) });
    }
  }

  // ---- containers ----
  for (const mv of world.geo.moving) {
    const b = new Bucket();
    for (const pt of mv.parts) {
      if (pt.s === 'box') pushBox(b, partMatrix(pt), [pt.d[0] / 2, pt.d[1] / 2, pt.d[2] / 2], pt.c, 0.6);
      else pushRound(b, pt);
    }
    const g = b.geometry();
    geometries.push(g);
    const pivot = new THREE.Group();
    pivot.position.set(mv.pivot.x, mv.pivot.y, mv.pivot.z);
    pivot.rotation.y = mv.yaw;
    const mesh = tag(new THREE.Mesh(g, woodMat), 'container', mv.containerId);
    pivot.add(mesh);
    group.add(pivot);
    const m = mv.motion;
    let apply;
    if (m.type === 'slide') apply = (e) => mesh.position.set(m.dir[0] * m.dist * e, m.dir[1] * m.dist * e, m.dir[2] * m.dist * e);
    else if (m.axis === 'x') apply = (e) => (mesh.rotation.x = m.angle * e);
    else apply = (e) => (mesh.rotation.y = m.angle * e);
    track(mv.containerId, { t: 0, target: 0, speed: m.type === 'slide' ? 3.5 : 2.6, apply });
  }

  function setTarget(id, open) {
    for (const a of anims.get(id) ?? []) a.target = open ? 1 : 0;
  }

  return {
    group,
    interactables,
    syncDoor: (door) => setTarget(door.id, door.isOpen),
    syncContainer: (c) => setTarget(c.id, c.isOpen),
    update(dt) {
      for (const list of anims.values())
        for (const a of list) {
          if (a.t === a.target) continue;
          const step = a.speed * dt;
          a.t = a.target > a.t ? Math.min(a.target, a.t + step) : Math.max(a.target, a.t - step);
          a.apply(ease(a.t));
        }
    },
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}
