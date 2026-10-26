// The things that move on their own: the toy train circling the tea party,
// the old TV that flicks on with static, the nursery mobile, and the stuffed
// animals (InstancedMesh), some of which slowly turn their heads to watch you.

import * as THREE from 'three';
import { yawTo, angleDiff } from '../core/math.js';
import { Bucket, pushBox, pushRound, partMatrix } from './geom.js';

const HEAD_OFFSET = 0.26; // teddy neck height at scale 1

function geometryOf(parts) {
  const b = new Bucket();
  for (const pt of parts) {
    if (pt.s === 'box') pushBox(b, partMatrix(pt), [pt.d[0] / 2, pt.d[1] / 2, pt.d[2] / 2], pt.c, 0.3);
    else pushRound(b, pt);
  }
  return b.geometry();
}

// models face +X (train) or -Z (teddies) in local space
const box = (x, y, z, sx, sy, sz, c, extra) => ({ s: 'box', p: [x, y, z], d: [sx, sy, sz], c, ...extra });
const cyl = (x, y, z, r, h, c, extra) => ({ s: 'cyl', p: [x, y, z], d: [r, h, r], c, ...extra });
const sph = (x, y, z, r, c, extra) => ({ s: 'sph', p: [x, y, z], d: [r], c, ...extra });

function engineParts() {
  const wheels = [];
  for (const x of [-0.09, 0.09]) for (const z of [-0.07, 0.07]) wheels.push(cyl(x, 0.045, z, 0.04, 0.02, 0x1a1a1a, { rx: Math.PI / 2, seg: 8 }));
  return [
    box(0, 0.1, 0, 0.32, 0.1, 0.14, 0xd8343c),
    box(-0.08, 0.19, 0, 0.12, 0.12, 0.15, 0x3a7be0),
    box(-0.08, 0.26, 0, 0.15, 0.025, 0.17, 0xf5d03a),
    cyl(0.1, 0.19, 0, 0.025, 0.1, 0x1a1a1a, { seg: 6 }),
    cyl(0.14, 0.1, 0, 0.05, 0.06, 0x1a1a1a, { rz: Math.PI / 2, seg: 8 }),
    ...wheels,
  ];
}

function carParts(color, cargo) {
  const parts = [box(0, 0.09, 0, 0.24, 0.08, 0.13, color), box(0, 0.045, 0, 0.26, 0.02, 0.1, 0x303030)];
  for (const x of [-0.08, 0.08]) for (const z of [-0.07, 0.07]) parts.push(cyl(x, 0.04, z, 0.035, 0.02, 0x1a1a1a, { rx: Math.PI / 2, seg: 8 }));
  cargo.forEach((c, i) => parts.push(box(-0.06 + i * 0.06, 0.16, 0, 0.05, 0.05, 0.05, c, { ry: i * 0.4 })));
  return parts;
}

function teddyBodyParts() {
  return [
    sph(0, 0.15, 0, 0.13, 0xffffff, { seg: 8 }),
    sph(-0.075, 0.05, -0.07, 0.06, 0xffffff, { seg: 6 }),
    sph(0.075, 0.05, -0.07, 0.06, 0xffffff, { seg: 6 }),
    sph(-0.13, 0.18, -0.03, 0.05, 0xffffff, { seg: 6 }),
    sph(0.13, 0.18, -0.03, 0.05, 0xffffff, { seg: 6 }),
    sph(0, 0.14, -0.11, 0.06, 0xf0e0d0, { seg: 6 }), // tummy patch
  ];
}

function teddyHeadParts() {
  return [
    sph(0, 0.09, 0, 0.1, 0xffffff, { seg: 8 }),
    sph(-0.075, 0.17, 0, 0.04, 0xffffff, { seg: 6 }),
    sph(0.075, 0.17, 0, 0.04, 0xffffff, { seg: 6 }),
    sph(0, 0.065, -0.085, 0.045, 0xf4e8dc, { seg: 6 }),
    sph(-0.036, 0.11, -0.088, 0.016, 0x050505, { seg: 5 }),
    sph(0.036, 0.11, -0.088, 0.016, 0x050505, { seg: 5 }),
    sph(0, 0.078, -0.128, 0.016, 0x1a1010, { seg: 5 }),
  ];
}

export function createAnimated({ root, world, tex, material, rng, tuning }) {
  const { geo } = world;
  const geometries = [];
  const materials = [];
  const own = (g) => (geometries.push(g), g);
  const floorY = Object.fromEntries(world.floors.map((f) => [f.id, f.y]));
  const plastic = material('plastic');

  // ---- toy train ----
  const tr = geo.setPieces.train;
  const ty = floorY[tr.floorId];
  const cars = [
    new THREE.Mesh(own(geometryOf(engineParts())), plastic),
    new THREE.Mesh(own(geometryOf(carParts(0xf5d03a, [0xe83a3a, 0x3a7be0, 0x45b85a]))), plastic),
    new THREE.Mesh(own(geometryOf(carParts(0x45b85a, [0xf07ab8, 0xf5d03a]))), plastic),
  ];
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
  materials.push(headlightMat);
  const headlight = new THREE.Mesh(own(new THREE.SphereGeometry(0.022, 6, 4)), headlightMat);
  headlight.position.set(0.17, 0.1, 0);
  cars[0].add(headlight);
  for (const c of cars) root.add(c);
  let trainAngle = 0;
  const placeOnTrack = (mesh, a) => {
    const x = tr.cx + Math.cos(a) * tr.rx;
    const z = tr.cz + Math.sin(a) * tr.rz;
    const dx = -Math.sin(a) * tr.rx;
    const dz = Math.cos(a) * tr.rz;
    mesh.position.set(x, ty + 0.035, z);
    mesh.rotation.y = Math.atan2(-dz, dx);
  };

  // ---- the old TV ----
  const tv = geo.setPieces.tv;
  const tvMat = new THREE.MeshBasicMaterial({ map: tex.staticFrames, color: 0x0c0e10 });
  materials.push(tvMat);
  const screen = new THREE.Mesh(own(new THREE.PlaneGeometry(0.56, 0.42)), tvMat);
  const c = Math.cos(tv.rotY);
  const s = Math.sin(tv.rotY);
  const local = [0, 0.31, -0.268];
  screen.position.set(tv.x + local[0] * c + local[2] * s, floorY[tv.floorId] + tv.y + local[1], tv.z - local[0] * s + local[2] * c);
  screen.rotation.y = tv.rotY + Math.PI; // plane faces +Z; the TV faces its rotY
  root.add(screen);
  const tvLight = new THREE.PointLight(0x9ab8ff, 0, 6, 1.6);
  tvLight.position.set(tv.x - Math.sin(tv.rotY) * 0.6, floorY[tv.floorId] + tv.y + 0.4, tv.z - Math.cos(tv.rotY) * 0.6);
  root.add(tvLight);
  const tvRng = rng.fork('tv');
  let tvOn = false;
  let tvTimer = tvRng.range(4, 9); // first burst comes early so you meet it
  let frameTimer = 0;
  let frame = 0;

  // ---- nursery mobiles ----
  const mobiles = geo.mobiles.map((m) => {
    const ceil = floorY[m.floorId] + 3;
    const g = new THREE.Group();
    g.position.set(m.pos.x, m.pos.y, m.pos.z);
    const parts = [cyl(0, (ceil - m.pos.y) / 2, 0, 0.004, ceil - m.pos.y, 0xe0e0e0), box(0, 0, 0, 0.56, 0.012, 0.012, 0xf5d03a), box(0, 0, 0, 0.012, 0.012, 0.56, 0xf5d03a)];
    const hang = [[0.27, 0, 0xf5d03a], [-0.27, 0, 0x9ab8ff], [0, 0.27, 0xf07ab8], [0, -0.27, 0xffffff]];
    hang.forEach(([x, z, col], i) => {
      parts.push(cyl(x, -0.1, z, 0.003, 0.2, 0xe0e0e0));
      parts.push(i % 2 ? sph(x, -0.24, z, 0.05, col, { seg: 6 }) : box(x, -0.24, z, 0.09, 0.09, 0.02, col, { rz: Math.PI / 4 }));
    });
    const mesh = new THREE.Mesh(own(geometryOf(parts)), plastic);
    g.add(mesh);
    g.userData.baseY = m.pos.y;
    root.add(g);
    return g;
  });
  let clock = 0;

  // ---- stuffed animals ----
  const teddies = geo.teddies;
  const furMat = new THREE.MeshLambertMaterial({ map: tex.tiling('fur'), vertexColors: true });
  materials.push(furMat);
  const bodies = new THREE.InstancedMesh(own(geometryOf(teddyBodyParts())), furMat, teddies.length);
  const heads = new THREE.InstancedMesh(own(geometryOf(teddyHeadParts())), furMat, teddies.length);
  bodies.name = 'teddyBodies';
  heads.name = 'teddyHeads';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const baseMatrices = teddies.map((t, i) => {
    e.set(t.tilt ?? 0, t.yaw, 0, 'YXZ');
    q.setFromEuler(e);
    const bm = new THREE.Matrix4().compose(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z), q, new THREE.Vector3(t.scale, t.scale, t.scale));
    bodies.setMatrixAt(i, bm);
    col.set(t.color);
    bodies.setColorAt(i, col);
    heads.setColorAt(i, col);
    return bm;
  });
  const headYaw = new Float32Array(teddies.length);
  const neck = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const setHead = (i) => {
    neck.makeTranslation(0, HEAD_OFFSET, 0);
    turn.makeRotationY(headYaw[i]);
    m.copy(baseMatrices[i]).multiply(neck).multiply(turn);
    heads.setMatrixAt(i, m);
  };
  teddies.forEach((t, i) => {
    headYaw[i] = t.watcher ? 0 : (((i * 37) % 9) - 4) * 0.08; // a little lean on the quiet ones
    setHead(i);
  });
  bodies.instanceColor.needsUpdate = true;
  heads.instanceColor.needsUpdate = true;
  bodies.computeBoundingSphere();
  heads.computeBoundingSphere();
  root.add(bodies, heads);
  const watchers = teddies.map((t, i) => (t.watcher ? i : -1)).filter((i) => i >= 0);

  return {
    tvOn: () => tvOn,
    update(dt, playerPos) {
      // train: slow circuit, a little faster on the straights
      trainAngle += dt * 0.13;
      cars.forEach((car, i) => placeOnTrack(car, trainAngle - i * 0.11));

      // TV: off for a while, then a burst of flickering static
      tvTimer -= dt;
      if (tvTimer <= 0) {
        tvOn = !tvOn;
        tvTimer = tvOn ? tvRng.range(2.5, 5) : tvRng.range(tuning.tvIdle[0], tuning.tvIdle[1]);
      }
      if (tvOn) {
        frameTimer -= dt;
        if (frameTimer <= 0) {
          frameTimer = 0.05;
          frame = (frame + 1 + Math.floor(tvRng.next() * 3)) % 4;
          tex.staticFrames.offset.y = frame * 0.25;
        }
        const b = 0.75 + tvRng.next() * 0.25;
        tvMat.color.setScalar(b);
        tvLight.intensity = 3.2 * b;
      } else {
        tvMat.color.setHex(0x0c0e10);
        tvLight.intensity = 0;
      }

      clock += dt;
      for (const g of mobiles) {
        g.rotation.y += dt * 0.35;
        g.position.y = g.userData.baseY + Math.sin(clock * 1.3) * 0.015;
      }

      // watchers turn their heads toward you, slowly, when you're on their floor
      if (playerPos) {
        let dirty = false;
        for (const i of watchers) {
          const t = teddies[i];
          const sameFloor = Math.abs(playerPos.y - floorY[t.floorId]) < 2;
          const d = Math.hypot(playerPos.x - t.pos.x, playerPos.z - t.pos.z);
          let want = 0;
          if (sameFloor && d < 10) want = Math.max(-1.4, Math.min(1.4, angleDiff(t.yaw, yawTo(t.pos, playerPos))));
          const diff = want - headYaw[i];
          if (Math.abs(diff) < 1e-3) continue;
          const step = tuning.teddyTurnRate * dt;
          headYaw[i] += Math.max(-step, Math.min(step, diff));
          setHead(i);
          dirty = true;
        }
        if (dirty) heads.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const mm of materials) mm.dispose();
    },
  };
}

