// Everything Gameplay shows in the world, kept in sync with the rules each
// frame: item meshes (and their invisible hit proxies), the padlock, plank
// and keypad dials on the front door, the crayon code digits on the
// drawings, squeaky toys and block towers, dropped treats, the flying ball
// and darts, and the fuse box / opener lights. The ball and darts fly in the
// rules (rules.js simulates them on the host; a co-op guest gets them in
// snapshots); this only draws them.
//
// Proxies carry userData.interact like World's meshes, so the interaction
// raycast treats both the same way.

import * as THREE from 'three';
import { ITEMS, LOCKS } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { copy } from '../core/math.js';
import { createRng } from '../core/rng.js';
import { DIAL_COLORS } from './keypad.js';
import { createModelKit } from './models.js';
import { crayonDigitTexture } from './textures.js';

/** Unit vector a wall object with this yaw faces (out of the wall). */
export const facingOf = (rotY = 0) => ({ x: -Math.sin(rotY), y: 0, z: -Math.cos(rotY) });
/** The object's own right-hand side (so a viewer facing it sees this as their left). */
const rightOf = (rotY = 0) => ({ x: Math.cos(rotY), y: 0, z: -Math.sin(rotY) });

const visibleDeep = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};

export function createGameplayView({ scene, camera, world, rules, tuning, bus }) {
  const kit = createModelKit();
  const root = new THREE.Group();
  root.name = 'gameplay';
  scene.add(root);
  const perRun = []; // textures/materials made for this run only
  const { anchors } = world;
  const cosmetic = createRng('gameplay-view'); // looks only; never the run's rng

  const isMine = (o) => {
    for (let n = o; n; n = n.parent) if (n === root || n === camera) return true;
    return false;
  };

  // ---- placing things on World's surfaces ---------------------------------------
  const ray = new THREE.Raycaster();
  scene.updateMatrixWorld(true);
  /**
   * Where a wall-mounted thing should sit: cast from in front of the spot back
   * toward the wall and take the first World surface, so our padlock, dials
   * and digits land on World's door, keypad housing and drawings whatever
   * their thickness. Falls back to the spot itself.
   */
  function surfaceAt(spot, { front = 0.3, behind = 0.15 } = {}) {
    const f = facingOf(spot.rotY);
    ray.set(new THREE.Vector3(spot.pos.x + f.x * front, spot.pos.y, spot.pos.z + f.z * front), new THREE.Vector3(-f.x, 0, -f.z));
    ray.far = front + behind;
    const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.isMesh && !isMine(h.object) && visibleDeep(h.object));
    return hit ? { x: hit.point.x, y: spot.pos.y, z: hit.point.z } : copy(spot.pos);
  }

  function mount(obj, spot, out = 0.0) {
    const s = surfaceAt(spot);
    const f = facingOf(spot.rotY);
    obj.position.set(s.x + f.x * out, s.y, s.z + f.z * out);
    obj.rotation.y = spot.rotY ?? 0;
    root.add(obj);
    return obj;
  }

  const targets = [];
  function proxy(mesh, tag, parent) {
    mesh.userData.interact = tag;
    mesh.userData.active = true;
    parent.add(mesh);
    targets.push(mesh);
    return mesh;
  }

  // ---- items --------------------------------------------------------------------
  const itemViews = new Map(); // instance id → {group, proxy}

  function itemView(inst) {
    let v = itemViews.get(inst.id);
    if (v) return v;
    const group = new THREE.Group();
    group.add(kit.item(inst.itemId));
    const size = inst.itemId === ITEMS.CAR_BATTERY ? 0.24 : inst.itemId === ITEMS.TENNIS_BALL ? 0.12 : 0.16;
    const p = proxy(kit.proxySphere(size), { kind: 'item', id: inst.id }, group);
    p.position.y = Math.min(size * 0.6, 0.12);
    root.add(group);
    v = { group, proxy: p };
    itemViews.set(inst.id, v);
    return v;
  }

  // A co-op guest hears about a flying ball ~10 times a second: ease toward it.
  const smooth = rules.localId === 'guest';
  const flyingAt = new THREE.Vector3();

  function syncItems(dt) {
    const seen = new Set();
    for (const inst of rules.items.list()) {
      seen.add(inst.id);
      const v = itemView(inst);
      const inWorld = inst.where === 'world';
      const flying = inst.where === 'flying';
      v.group.visible = flying || (inWorld && rules.containerOpen(inst.containerId));
      v.proxy.userData.active = inWorld && rules.canPickUp(inst);
      if (inWorld) {
        v.group.position.set(inst.pos.x, inst.pos.y, inst.pos.z);
        v.group.rotation.set(0, inst.rotY ?? 0, 0);
      } else if (flying) {
        const p = v.group.position;
        const k = smooth && v.flying ? Math.min(1, dt * 14) : 1;
        flyingAt.set(inst.pos.x, inst.pos.y, inst.pos.z);
        const dx = (flyingAt.x - p.x) * k;
        const dz = (flyingAt.z - p.z) * k;
        p.lerp(flyingAt, k);
        if (v.flying) {
          // Roll the way it's going.
          v.group.rotation.x += dz * 25;
          v.group.rotation.z -= dx * 25;
        }
      }
      v.flying = flying;
    }
    // Instances a co-op snapshot took away.
    for (const [id, v] of itemViews)
      if (!seen.has(id)) {
        root.remove(v.group);
        const t = targets.indexOf(v.proxy);
        if (t >= 0) targets.splice(t, 1);
        itemViews.delete(id);
      }
  }

  // ---- darts ----------------------------------------------------------------------------
  const dartViews = new Map(); // rules dart id → mesh

  function syncDarts() {
    const live = new Set();
    for (const d of rules.darts) {
      live.add(d.id);
      let mesh = dartViews.get(d.id);
      if (!mesh) {
        mesh = kit.dart();
        mesh.scale.setScalar(1.4);
        mesh.position.set(d.origin.x, d.origin.y, d.origin.z);
        // Object3D.lookAt points +Z at the target; the model's nose is -Z.
        mesh.lookAt(d.origin.x - d.dir.x, d.origin.y - d.dir.y, d.origin.z - d.dir.z);
        root.add(mesh);
        dartViews.set(d.id, mesh);
      }
      const t = Math.min(d.traveled, d.range, d.stopAt ?? Infinity);
      mesh.position.set(d.origin.x + d.dir.x * t, d.origin.y + d.dir.y * t, d.origin.z + d.dir.z * t);
    }
    for (const [id, mesh] of dartViews)
      if (!live.has(id)) {
        root.remove(mesh);
        dartViews.delete(id);
      }
  }

  // ---- treats ---------------------------------------------------------------------
  const treatViews = new Map();
  function syncTreats() {
    for (const [id, t] of rules.treats) {
      if (treatViews.has(id)) continue;
      const m = kit.treat();
      m.position.set(t.pos.x, t.pos.y, t.pos.z);
      m.rotation.y = cosmetic.range(0, Math.PI * 2);
      root.add(m);
      treatViews.set(id, m);
    }
    for (const [id, m] of treatViews)
      if (!rules.treats.has(id)) {
        root.remove(m);
        treatViews.delete(id);
      }
  }

  // ---- front door hardware ------------------------------------------------------------
  const fd = anchors.frontDoor;
  const frontDoor = world.doors.find((d) => d.id === fd.doorId);
  const fallers = []; // locks dropping to the floor once opened

  const padlock = mount(kit.padlock(), fd.padlock, 0.03);
  proxy(kit.proxyBox(0.16, 0.26, 0.12), { kind: 'lock', id: LOCKS.PADLOCK }, padlock);

  // The plank spans the doorway: its length comes from the door collider's width.
  const r = rightOf(fd.plank.rotY);
  const c = frontDoor.collider;
  const doorWidth = Math.abs(r.x) * (c.maxX - c.minX) + Math.abs(r.z) * (c.maxZ - c.minZ);
  const plankLen = Math.min(2, Math.max(0.8, doorWidth + 0.3));
  const plank = mount(kit.plank(plankLen), fd.plank, 0.02);
  plank.children[0].rotation.z = 0.12;
  proxy(kit.proxyBox(plankLen, 0.28, 0.12), { kind: 'lock', id: LOCKS.PLANK }, plank);

  function dropLock(obj, spot, ahead) {
    for (const t of targets) if (t.parent === obj) t.userData.active = false;
    const f = facingOf(spot.rotY);
    const floor = world.heightAt(obj.position.x + f.x * ahead, obj.position.z + f.z * ahead, spot.floorId).y;
    const endQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, (spot.rotY ?? 0) + cosmetic.range(-0.5, 0.5), 0, 'YXZ'));
    fallers.push({
      obj,
      from: obj.position.clone(),
      to: new THREE.Vector3(obj.position.x + f.x * ahead, floor + 0.03, obj.position.z + f.z * ahead),
      q0: obj.quaternion.clone(),
      q1: endQ,
      t: 0,
    });
  }

  function updateFallers(dt) {
    for (let k = fallers.length - 1; k >= 0; k--) {
      const f = fallers[k];
      f.t = Math.min(1, f.t + dt * 2.2);
      const e = f.t * f.t; // falling: speeds up
      f.obj.position.lerpVectors(f.from, f.to, e);
      f.obj.quaternion.slerpQuaternions(f.q0, f.q1, Math.min(1, f.t * 1.3));
      if (f.t >= 1) fallers.splice(k, 1);
    }
  }

  // ---- keypad dials -----------------------------------------------------------------
  const keypad = new THREE.Group();
  keypad.add(kit.plate(0.36, 0.2, 0.02));
  const dials = DIAL_COLORS.map((color, i) => {
    const d = kit.dial(color);
    // Local +X is the keypad's own right, i.e. the viewer's left: dial 0 (red) reads first.
    d.position.set(0.135 - i * 0.09, -0.01, -0.02);
    keypad.add(d);
    proxy(kit.proxyBox(0.085, 0.12, 0.06), { kind: 'lock', id: LOCKS.KEYPAD, dial: i }, d);
    return { group: d, shown: 0, pulse: 0 };
  });
  const keypadLed = kit.led();
  keypadLed.position.set(0, 0.075, -0.015);
  keypad.add(keypadLed);
  mount(keypad, fd.keypad, 0.012);

  function updateDials(dt) {
    const open = rules.locks.isOpen(LOCKS.KEYPAD);
    keypadLed.userData.setOn(open);
    dials.forEach((d, i) => {
      const digit = rules.keypad.digits[i];
      if (digit !== d.shown) {
        d.shown = digit;
        d.group.userData.setDigit(digit);
        d.pulse = 1;
      }
      d.pulse = Math.max(0, d.pulse - dt * 7);
      d.group.position.z = -0.02 + d.pulse * 0.008;
    });
    if (open) for (const t of targets) if (t.userData.interact.id === LOCKS.KEYPAD) t.userData.active = false;
  }

  // ---- crayon code digits on the drawings ----------------------------------------------
  for (const a of rules.drawings) {
    const tex = crayonDigitTexture(a.digit, a.color.css, a.position);
    const material = new THREE.MeshLambertMaterial({
      map: tex, transparent: true, alphaTest: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      emissive: a.color.hex, emissiveIntensity: 0.06,
    });
    perRun.push(tex, material);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), material);
    perRun.push(plane.geometry);
    const s = surfaceAt(a.spot);
    const f = facingOf(a.spot.rotY);
    const rr = rightOf(a.spot.rotY);
    // A bit to the viewer's right of center, so World's drawing still shows.
    plane.position.set(s.x + f.x * 0.006 - rr.x * 0.12, s.y + 0.04, s.z + f.z * 0.006 - rr.z * 0.12);
    plane.rotation.y = (a.spot.rotY ?? 0) + Math.PI; // the plane's front (+Z) faces out of the wall
    plane.rotation.z = cosmetic.range(-0.2, 0.2);
    plane.name = `codeDigit:${a.spot.id}`;
    root.add(plane);
  }

  // ---- fuse box and opener lights ------------------------------------------------------
  const fuseGroup = new THREE.Group();
  const fuseModel = kit.item(ITEMS.FUSE);
  fuseModel.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  fuseModel.position.set(0, -0.02, -0.02);
  fuseModel.visible = false;
  const fuseLed = kit.led();
  fuseLed.position.set(0, 0.1, -0.02);
  fuseGroup.add(fuseModel, fuseLed);
  mount(fuseGroup, anchors.fuseBox, 0.01);
  const openerLed = kit.led();
  const openerGroup = new THREE.Group();
  openerLed.position.set(0, 0.09, -0.01);
  openerGroup.add(openerLed);
  mount(openerGroup, anchors.garage.opener, 0.01);

  function updateLights() {
    const powered = rules.locks.garagePowered();
    fuseModel.visible = powered;
    fuseLed.userData.setOn(powered);
    openerLed.userData.setOn(powered);
  }

  // ---- noise-trap props ------------------------------------------------------------------
  const trapProps = new Map(); // spot id → {spot, group, blocks?, anim}
  rules.traps.placed.forEach((spot, k) => {
    const group = new THREE.Group();
    group.position.set(spot.pos.x, spot.pos.y, spot.pos.z);
    group.rotation.y = spot.rotY ?? cosmetic.range(0, Math.PI * 2);
    root.add(group);
    const prop = { spot, group, squash: 0, blocks: null };
    if (spot.kind === 'squeaky') group.add(kit.squeakyToy(k));
    else {
      prop.blocks = [];
      for (let b = 0; b < 5; b++) {
        const m = kit.block(k * 5 + b);
        group.add(m);
        prop.blocks.push({ mesh: m, home: new THREE.Vector3(cosmetic.range(-0.015, 0.015), 0.06 + b * 0.12, cosmetic.range(-0.015, 0.015)), spin: cosmetic.range(-0.3, 0.3), vel: null });
      }
      stackBlocks(prop);
    }
    trapProps.set(spot.id, prop);
  });

  function stackBlocks(prop) {
    for (const b of prop.blocks) {
      b.mesh.position.copy(b.home);
      b.mesh.rotation.set(0, b.spin, 0);
      b.vel = null;
    }
  }

  // A co-op guest runs no traps: the host's TRAP events (replayed) show which prop went off.
  if (rules.localId === 'guest')
    bus.on(EVENTS.TRAP, (p) => {
      if (!p?.pos) return;
      for (const prop of trapProps.values())
        if (prop.spot.kind === p.kind && Math.hypot(prop.spot.pos.x - p.pos.x, prop.spot.pos.z - p.pos.z) < 0.05) trapsFired([{ spot: prop.spot }]);
    });

  function trapsFired(fired) {
    for (const { spot } of fired) {
      const prop = trapProps.get(spot.id);
      if (!prop) continue;
      if (spot.kind === 'squeaky') prop.squash = 1;
      if (spot.kind === 'blocks')
        prop.blocks.forEach((b, k) => {
          const a = cosmetic.range(0, Math.PI * 2);
          const out = 0.6 + k * 0.25;
          b.vel = { x: Math.cos(a) * out, y: 0.5 + cosmetic.range(0, 1), z: Math.sin(a) * out, rx: cosmetic.range(-6, 6), rz: cosmetic.range(-6, 6) };
        });
    }
  }

  function updateTrapProps(dt) {
    for (const prop of trapProps.values()) {
      if (prop.squash > 0) {
        prop.squash = Math.max(0, prop.squash - dt * 4);
        const s = 1 - Math.sin(prop.squash * Math.PI) * 0.4;
        prop.group.scale.set(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5);
      }
      if (!prop.blocks) continue;
      for (const b of prop.blocks) {
        if (!b.vel) continue;
        const p = b.mesh.position;
        b.vel.y -= 9.8 * dt;
        p.x += b.vel.x * dt;
        p.y += b.vel.y * dt;
        p.z += b.vel.z * dt;
        b.mesh.rotation.x += b.vel.rx * dt;
        b.mesh.rotation.z += b.vel.rz * dt;
        if (p.y <= 0.06) {
          p.y = 0.06;
          b.vel.y = Math.abs(b.vel.y) * 0.25;
          b.vel.x *= 0.5;
          b.vel.z *= 0.5;
          b.vel.rx *= 0.4;
          b.vel.rz *= 0.4;
          if (Math.abs(b.vel.y) < 0.3) {
            // Settle flat on a face so it doesn't float on an edge.
            b.mesh.rotation.x = Math.round(b.mesh.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
            b.mesh.rotation.z = Math.round(b.mesh.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
            b.vel = null;
          }
        }
      }
    }
  }

  // ---- per frame -----------------------------------------------------------------------
  const opened = new Set();
  function update(dt) {
    if (!opened.has(LOCKS.PADLOCK) && rules.locks.isOpen(LOCKS.PADLOCK)) {
      opened.add(LOCKS.PADLOCK);
      dropLock(padlock, fd.padlock, 0.25);
    }
    if (!opened.has(LOCKS.PLANK) && rules.locks.isOpen(LOCKS.PLANK)) {
      opened.add(LOCKS.PLANK);
      dropLock(plank, fd.plank, 0.45);
    }
    syncDarts();
    syncItems(dt);
    syncTreats();
    updateFallers(dt);
    updateDials(dt);
    updateLights();
    updateTrapProps(dt);
    // The look raycast runs before the next render: keep our proxies' matrices current.
    root.updateMatrixWorld();
  }

  /** Start of a day: block towers are rebuilt. */
  function resetDay() {
    for (const prop of trapProps.values()) if (prop.blocks) stackBlocks(prop);
  }

  function dispose() {
    scene.remove(root);
    for (const d of perRun) d.dispose();
    kit.dispose();
  }

  syncItems(0);
  updateDials(0);

  return {
    kit,
    root,
    targets: () => targets.filter((t) => t.userData.active && visibleDeep(t.parent)),
    update,
    trapsFired,
    resetDay,
    surfaceAt,
    dispose,
  };
}

