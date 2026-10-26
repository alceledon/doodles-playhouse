// Doodle's mesh: an oversized, fluffy, low-poly golden doodle built from
// lumpy blobs, animated entirely in code. Feet at y=0, facing -Z, shoulder
// about DOODLE_BODY.shoulderHeight.
//
// Implements the contract's DoodleModel (setPose / setMood / update) plus two
// extras index.js drives: setGait(speed) for leg cadence and setCarrying().

import * as THREE from 'three';
import { DOODLE_POSES } from '../core/contracts.js';
import { furTexture, tagTexture, collarTexture, ballTexture, glowTexture } from './textures.js';

const TAU = Math.PI * 2;
const HIP_Y = 0.78; // body center height when standing; shoulder ≈ HIP_Y + 0.40

// ---------------------------------------------------------------------------
// Pose targets. Every pose is a set of joint parameters; the model eases from
// one to the next and adds procedural motion (gait, breathing, wag) on top.
// Signs: bodyPitch + lifts the front; front/hind + swing feet forward;
// neck/head − tip the nose down; ears back is 0..1; tail is its tilt back.
// ---------------------------------------------------------------------------
const BASE = {
  bodyY: 0, bodyPitch: 0, bodyZ: 0, front: 0, hind: 0, swing: 0, bob: 0.015,
  neck: 0, head: 0, headYaw: 0, sweep: 0, jaw: 0.25, chomp: 0, tongue: 0.65, lick: 0,
  tail: 0.55, wag: 0.5, wagHz: 2.2, eyes: 1, earBack: 0, breathe: 1, gaitSpeed: 0, stride: 1.1,
};
const POSES = {
  idle: {},
  walk: { swing: 0.5, bob: 0.035, gaitSpeed: 1.6 },
  run: { swing: 0.85, bob: 0.07, neck: 0.1, jaw: 0.45, tongue: 1, tail: 0.9, stride: 1.9, gaitSpeed: 4.6 },
  sniff: { bodyY: -0.1, bodyPitch: -0.16, neck: -1.15, head: -0.6, sweep: 0.45, jaw: 0.05, tongue: 0, swing: 0.4, stride: 0.9 },
  eat: { bodyY: -0.12, bodyPitch: -0.18, neck: -1.25, head: -0.75, jaw: 0.1, chomp: 0.5, tongue: 0.15, wag: 0.9, wagHz: 4 },
  chew: { bodyY: -0.42, front: 1.3, hind: -1.3, neck: 0.15, head: -0.1, jaw: 0.15, chomp: 0.45, sweep: 0.2, tongue: 0, wag: 0.3, tail: 1.2 },
  sleep: { bodyY: -0.47, front: 1.35, hind: -1.35, neck: -0.9, head: 0.25, jaw: 0, tongue: 0, tail: 2.1, wag: 0.04, wagHz: 0.4, eyes: 0, breathe: 0.5, bob: 0 },
  pounce: {}, // animated specially (crouch → leap), see pounceTargets()
  lick: { neck: -0.4, head: -0.35, jaw: 0.6, tongue: 1, lick: 1, wag: 1, wagHz: 5 },
  drag: { bodyY: -0.06, neck: -0.55, head: -0.15, jaw: 0.12, tongue: 0, swing: 0.45, gaitSpeed: -0.9, tail: 1.1, wag: 0.2 },
};
const POUNCE_CROUCH = { ...BASE, bodyY: -0.16, bodyPitch: -0.12, front: 0.35, hind: 0.45, neck: -0.25, jaw: 0.4, tongue: 0 };
const POUNCE_LEAP = { ...BASE, bodyY: 0.22, bodyPitch: 0.55, bodyZ: -0.35, front: 1.15, hind: -0.6, neck: 0.3, head: -0.2, jaw: 1, tongue: 0.2, tail: 0.3 };

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A low-poly lumpy ellipsoid: an icosphere with deterministic per-vertex bumps. */
function blobGeometry(sx, sy, sz, { detail = 1, lump = 0.12, seed = 1 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    // Same position → same bump, so the flat-shaded faces stay watertight.
    const h = Math.sin(Math.round(v.x * 1e3) * 12.9898 + Math.round(v.y * 1e3) * 78.233 + Math.round(v.z * 1e3) * 37.719 + seed * 4.1) * 43758.5453;
    const r = 1 + (h - Math.floor(h) - 0.5) * 2 * lump;
    pos.setXYZ(k, v.x * sx * r, v.y * sy * r, v.z * sz * r);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createDoodleModel() {
  const fur = new THREE.MeshLambertMaterial({ map: furTexture(), flatShading: true });
  const furLight = new THREE.MeshLambertMaterial({ map: furTexture({ base: '#e6b864', light: '#fbe0a0', dark: '#bb8a42', seed: 11 }), flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a1a14, flatShading: true });
  const mouthMat = new THREE.MeshLambertMaterial({ color: 0x5a1018 });
  const tongueMat = new THREE.MeshLambertMaterial({ color: 0xe86a8a, flatShading: true });
  const toothMat = new THREE.MeshLambertMaterial({ color: 0xf4f0e0, flatShading: true });
  const collarMat = new THREE.MeshLambertMaterial({ map: collarTexture() });
  const tagFront = new THREE.MeshLambertMaterial({ map: tagTexture() });
  const tagEdge = new THREE.MeshLambertMaterial({ color: 0xc89a2a });
  // Eyeshine ignores lights and fog, so in a dark hallway the eyes show first.
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8ff8a, fog: false });
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xd8ff8a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.85 });
  const ballMat = new THREE.MeshLambertMaterial({ map: ballTexture() });
  const toyMat = new THREE.MeshLambertMaterial({ color: 0xff5fa8, flatShading: true });
  const materials = [fur, furLight, dark, mouthMat, tongueMat, toothMat, collarMat, tagFront, tagEdge, eyeMat, glowMat, ballMat, toyMat];

  let seed = 1;
  const blob = (parent, mat, [x, y, z], [sx, sy, sz], opts = {}) => {
    const m = new THREE.Mesh(blobGeometry(sx, sy, sz, { seed: seed++, ...opts }), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const group = (parent, [x, y, z]) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // ---- skeleton --------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'doodle';
  root.rotation.order = 'YXZ';
  const body = group(root, [0, HIP_Y, 0]);
  const torso = blob(body, fur, [0, 0, 0], [0.42, 0.4, 0.8], { lump: 0.1 });
  blob(body, furLight, [0, 0.06, -0.52], [0.37, 0.39, 0.33], { lump: 0.16 }); // chest fluff
  blob(body, fur, [0, 0.05, 0.55], [0.38, 0.36, 0.32], { lump: 0.14 }); // rump
  blob(body, furLight, [0, 0.3, -0.1], [0.3, 0.14, 0.5], { lump: 0.2 }); // curly back

  const legs = [];
  for (const [x, z, front] of [[-0.21, -0.5, true], [0.21, -0.5, true], [-0.21, 0.52, false], [0.21, 0.52, false]]) {
    const hip = group(body, [x, -0.12, z]);
    blob(hip, front ? furLight : fur, [0, -0.28, 0], [0.11, 0.33, 0.12], { lump: 0.14 });
    blob(hip, furLight, [0, -0.6, -0.04], [0.12, 0.075, 0.15], { lump: 0.1 }); // paw
    legs.push({ hip, front, side: x < 0 ? 0 : 1 });
  }

  const neck = group(body, [0, 0.22, -0.62]);
  blob(neck, furLight, [0, 0.2, -0.08], [0.18, 0.27, 0.18], { lump: 0.16 });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 5, 12), collarMat);
  collar.position.set(0, 0.06, -0.05);
  collar.rotation.x = Math.PI / 2 - 0.35;
  neck.add(collar);
  const tagPivot = group(neck, [0, 0.01, -0.24]);
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.012), [tagEdge, tagEdge, tagEdge, tagEdge, tagEdge, tagFront]);
  tag.position.set(0, -0.05, 0);
  tagPivot.add(tag);

  const head = group(neck, [0, 0.42, -0.18]);
  blob(head, fur, [0, 0, 0], [0.27, 0.25, 0.28], { lump: 0.14 }); // skull
  blob(head, furLight, [0, 0.17, 0.02], [0.21, 0.12, 0.19], { lump: 0.25 }); // top-knot curls
  blob(head, furLight, [0, -0.05, -0.27], [0.15, 0.1, 0.17], { lump: 0.12 }); // muzzle
  blob(head, dark, [0, -0.01, -0.43], [0.065, 0.045, 0.04], { lump: 0.05, detail: 0 }); // nose

  const eyes = [];
  for (const x of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.036, 0), eyeMat);
    eye.position.set(x, 0.06, -0.235);
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(x, 0.06, -0.27);
    glow.scale.setScalar(0.24);
    head.add(eye, glow);
    eyes.push(eye, glow);
  }

  const ears = [];
  for (const side of [-1, 1]) {
    const pivot = group(head, [side * 0.22, 0.08, -0.02]);
    blob(pivot, fur, [side * 0.035, -0.2, 0], [0.075, 0.23, 0.13], { lump: 0.22 });
    ears.push({ pivot, side });
  }

  // Mouth: fangs under the muzzle, a dark red cavity, and a hinged lower jaw
  // with the tongue. Teeth only show once the jaw is well open.
  const mouth = blob(head, mouthMat, [0, -0.16, -0.22], [0.105, 0.05, 0.13], { lump: 0, detail: 0 });
  const tooth = (parent, x, y, z, up, size = 1) => {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.02 * size, 0.07 * size, 4), toothMat);
    t.position.set(x, y, z);
    if (!up) t.rotation.x = Math.PI;
    parent.add(t);
  };
  const teeth = new THREE.Group();
  head.add(teeth);
  for (const [x, z, size] of [[-0.1, -0.33, 1.3], [-0.045, -0.39, 0.8], [0.045, -0.39, 0.8], [0.1, -0.33, 1.3]]) tooth(teeth, x, -0.165, z, false, size);
  const jaw = group(head, [0, -0.15, -0.08]);
  blob(jaw, furLight, [0, -0.03, -0.17], [0.12, 0.045, 0.16], { lump: 0.1 });
  const lowerTeeth = new THREE.Group();
  jaw.add(lowerTeeth);
  for (const x of [-0.075, 0.075]) tooth(lowerTeeth, x, 0.025, -0.28, true, 1.1);
  const tonguePivot = group(jaw, [0, 0.015, -0.06]);
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.016, 0.2), tongueMat);
  tongue.position.set(0, 0, -0.1);
  tonguePivot.add(tongue);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1), ballMat);
  ball.position.set(0, 0.05, -0.27);
  ball.visible = false;
  jaw.add(ball);
  const toy = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), toyMat); // the squeaky dart it chews
  toy.position.set(0, 0.04, -0.24);
  toy.visible = false;
  jaw.add(toy);

  const tail = group(body, [0, 0.2, 0.78]);
  let link = tail;
  for (let k = 0; k < 3; k++) {
    blob(link, k === 2 ? furLight : fur, [0, 0.1, 0], [0.1 - k * 0.012, 0.13, 0.1 - k * 0.012], { lump: 0.25 });
    link = group(link, [0, 0.17, 0.02]);
    link.rotation.x = 0.35; // each segment curls a little further back
  }

  // ---- animation state -----------------------------------------------------------
  let pose = 'idle';
  let poseLoop = true;
  let poseT = 0;
  let mood = 'calm';
  let gait = null; // m/s from the brain; null = use the pose's default cadence
  let carrying = null;
  let t = 0;
  let phase = 0;
  const cur = { ...BASE };
  const tmp = {};

  function targets() {
    if (pose === 'pounce') {
      const local = poseLoop ? poseT % 1.2 : poseT;
      const k = smooth(0.18, 0.42, local);
      for (const key in BASE) tmp[key] = lerp(POUNCE_CROUCH[key], POUNCE_LEAP[key], k);
      return tmp;
    }
    return Object.assign(tmp, BASE, POSES[pose]);
  }

  function update(dt) {
    t += dt;
    poseT += dt;
    const goal = targets();
    const hunt = mood === 'hunt' && pose !== 'sleep';
    if (hunt) {
      goal.earBack = 1;
      goal.jaw = Math.max(goal.jaw, 0.85);
      goal.tongue = Math.min(goal.tongue, 0.15);
      goal.tail = Math.min(goal.tail, 0.2);
      goal.wag = 0.2;
      goal.wagHz = 7;
    }
    if (carrying) {
      goal.jaw = 0.35;
      goal.tongue = 0;
    }
    toy.visible = pose === 'chew';
    if (toy.visible) goal.jaw = Math.max(goal.jaw, 0.3);
    const ease = 1 - Math.exp(-dt * (pose === 'pounce' ? 18 : 8));
    for (const key in BASE) cur[key] += (goal[key] - cur[key]) * ease;

    // Gait: legs cycle once per stride at the current speed.
    const speed = gait ?? goal.gaitSpeed;
    phase += (dt * speed * TAU) / Math.max(0.4, goal.stride);
    const swing = cur.swing * Math.min(1, Math.abs(speed) / 0.8);
    const gallop = goal.stride > 1.5;
    for (const leg of legs) {
      const off = gallop ? (leg.front ? 0 : Math.PI) + leg.side * 0.5 : (leg.front === (leg.side === 0) ? 0 : Math.PI);
      leg.hip.rotation.x = (leg.front ? cur.front : cur.hind) + Math.sin(phase + off) * swing;
    }

    const bob = Math.abs(Math.sin(phase)) * cur.bob * Math.min(1, Math.abs(speed));
    const breath = Math.sin(t * (cur.breathe > 0.7 ? 2.4 : 1.1)) * 0.02 * cur.breathe;
    body.position.set(0, HIP_Y + cur.bodyY + bob, cur.bodyZ);
    body.rotation.x = cur.bodyPitch + (gallop ? Math.sin(phase) * 0.07 * swing : 0);
    torso.scale.set(1 + breath * 0.5, 1 + breath, 1);

    neck.rotation.x = cur.neck + Math.sin(phase * 2) * 0.04 * swing + Math.sin(t * 9) * 0.04 * cur.lick;
    head.rotation.x = cur.head + Math.sin(t * 14) * 0.012 * cur.sweep;
    head.rotation.y = cur.headYaw + Math.sin(t * 1.6) * cur.sweep;
    head.rotation.z = pose === 'chew' ? Math.sin(t * 5) * 0.12 : 0;

    const chomp = cur.chomp * Math.abs(Math.sin(t * 7));
    const open = Math.min(1, cur.jaw + chomp);
    jaw.rotation.x = -open * 0.6;
    const bite = smooth(0.35, 0.65, open) * (hunt ? 1 : 0.4);
    teeth.scale.setScalar(Math.max(0.001, bite));
    lowerTeeth.scale.setScalar(Math.max(0.001, bite));
    mouth.visible = open > 0.15;
    tonguePivot.position.z = -0.03 - 0.12 * cur.tongue;
    tonguePivot.rotation.x = -0.65 * cur.tongue + Math.sin(t * 13) * 0.4 * cur.lick + Math.sin(t * 6) * 0.06 * cur.tongue;
    tonguePivot.visible = cur.tongue > 0.05 || open > 0.3;

    for (const { pivot, side } of ears) {
      const flop = Math.sin(phase * 2 + side) * 0.18 * swing + Math.sin(t * 1.3 + side) * 0.05;
      pivot.rotation.x = -1.7 * cur.earBack + flop;
      pivot.rotation.z = side * (0.12 + 0.15 * (1 - cur.earBack));
    }

    tail.rotation.x = cur.tail;
    tail.rotation.z = Math.sin(t * cur.wagHz * TAU) * cur.wag * 0.6;
    tagPivot.rotation.x = Math.sin(phase * 2) * 0.3 * swing;

    const eyesOpen = cur.eyes > 0.5;
    for (const e of eyes) e.visible = eyesOpen;
  }

  const model = {
    object3d: root,
    /** One of DOODLE_POSES. pounce plays once and holds unless {loop: true}. */
    setPose(next, { loop } = {}) {
      if (!DOODLE_POSES.includes(next)) return;
      pose = next;
      poseLoop = loop ?? next !== 'pounce';
      poseT = 0;
    },
    setMood(next) {
      mood = next === 'hunt' ? 'hunt' : 'calm';
      const color = mood === 'hunt' ? 0xff2a14 : 0xd8ff8a;
      eyeMat.color.setHex(color);
      glowMat.color.setHex(color);
    },
    /** Leg cadence from actual speed (m/s); null = the pose's own default. */
    setGait(speed) {
      gait = speed;
    },
    /** 'ball' shows the tennis ball in its mouth. */
    setCarrying(what) {
      carrying = what;
      ball.visible = what === 'ball';
    },
    update,
    get pose() {
      return pose;
    },
    get mood() {
      return mood;
    },
    dispose() {
      root.traverse((o) => o.geometry?.dispose?.());
      for (const m of materials) {
        m.map?.dispose?.();
        m.dispose();
      }
    },
  };
  update(0);
  return model;
}
