// STUB World: the mini-house fixture rendered as gray boxes, with tagged
// interactable markers. main.js uses it until src/world/index.js exists, and
// the Doodle/Gameplay dev pages use it as their test level.

import * as THREE from 'three';
import { createMiniHouse } from '../fixtures/mini-house.js';

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function boxMesh(b, material) {
  const sx = Math.max(b.maxX - b.minX, 0.02);
  const sy = Math.max(b.maxY - b.minY, 0.02);
  const sz = Math.max(b.maxZ - b.minZ, 0.02);
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  return m;
}

function tag(mesh, kind, id) {
  mesh.userData.interact = { kind, id };
  return mesh;
}

/** createWorld({ scene, bus, rng, difficulty }) → World */
export function createWorld({ scene, bus }) {
  const doorMeshes = new Map();
  const containerMeshes = new Map();
  const world = createMiniHouse({
    bus,
    onDoorChange: (d) => syncDoor(d),
    onContainerChange: (c) => syncContainer(c),
  });
  const root = new THREE.Group();
  root.name = 'stubWorld';
  scene.add(root);
  const interactables = world.interactables;

  // floors, ceilings, stairs
  const floorMat = mat(0x3a3540);
  const slabs = [
    { minX: 0, maxX: 12, minY: -0.1, maxY: 0, minZ: 0, maxZ: 8 }, // ground floor
    { minX: 0, maxX: 7, minY: 2.9, maxY: 3, minZ: 0, maxZ: 7 }, // upstairs floor, minus stairwell
    { minX: 0, maxX: 1, minY: 2.9, maxY: 3, minZ: 7, maxZ: 8 },
    { minX: 5, maxX: 7, minY: 2.9, maxY: 3, minZ: 7, maxZ: 8 },
    { minX: 7, maxX: 12, minY: 2.9, maxY: 3, minZ: 0, maxZ: 8 }, // kitchen ceiling
    { minX: 0, maxX: 7, minY: 6, maxY: 6.1, minZ: 0, maxZ: 8 }, // bedroom ceiling
  ];
  for (const s of slabs) root.add(boxMesh(s, floorMat));
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 0.9), mat(0x6b5a4a));
  ramp.position.set(3, 1.5, 7.45);
  ramp.rotation.z = Math.atan2(3, 4);
  root.add(ramp);

  const wallMat = { ground: mat(0x8a8494), upstairs: mat(0x948a84) };
  for (const [floorId, boxes] of Object.entries(world.staticBoxes)) for (const b of boxes) root.add(boxMesh(b, wallMat[floorId]));

  // doors
  for (const d of world.doors) {
    const m = tag(boxMesh(d.collider, mat(d.locked ? 0x8a2a2a : 0xc8a060)), 'door', d.id);
    root.add(m);
    doorMeshes.set(d.id, m);
    interactables.push(m);
  }
  function syncDoor(d) {
    const m = doorMeshes.get(d.id);
    if (!m) return;
    m.visible = !d.isOpen; // stub: open doors just vanish
    m.material.color.setHex(d.locked ? 0x8a2a2a : 0xc8a060);
  }

  // containers
  for (const c of world.containers) {
    const m = tag(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), mat(c.locked ? 0x7a3aa0 : 0x3a6ab0)), 'container', c.id);
    m.position.set(c.pos.x, c.pos.y, c.pos.z);
    root.add(m);
    containerMeshes.set(c.id, m);
    interactables.push(m);
  }
  function syncContainer(c) {
    const m = containerMeshes.get(c.id);
    if (!m) return;
    m.material.color.setHex(c.isOpen ? 0x9ad0ff : c.locked ? 0x7a3aa0 : 0x3a6ab0);
  }

  // interactable markers
  const marker = (pos, color, kind, id, size = 0.3) => {
    const m = tag(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat(color, { emissive: color, emissiveIntensity: 0.3 })), kind, id);
    m.position.set(pos.x, pos.y + (pos.y % 3 === 0 ? size / 2 : 0), pos.z);
    root.add(m);
    interactables.push(m);
    return m;
  };
  const a = world.anchors;
  for (const h of a.hideSpots) marker(h.pos, 0x3aa05a, 'hide', h.id, 0.4);
  for (const l of world.nav.links) {
    if (l.kind === 'stairs') continue;
    marker(l.points[0], 0xd0b030, 'linkEntry', l.id);
    if (!l.oneWay) marker(l.points[l.points.length - 1], 0xd0b030, 'linkEntry', l.id);
  }
  marker(a.fuseBox.pos, 0xb05030, 'fuseBox', 'fuseBox');
  marker({ ...a.garage.jeep.pos, y: 0.8 }, 0xe04080, 'jeep', 'jeep', 0.4);
  marker(a.garage.opener.pos, 0x30b0b0, 'opener', 'opener', 0.2);
  marker(a.frontDoor.keypad.pos, 0x30b0b0, 'keypad', 'keypad', 0.2);
  for (const t of a.traps) if (t.kind === 'piano') marker(t.pos, 0xffffff, 'piano', t.id, 0.5);

  // crayon drawings (not interactable)
  for (const d of a.drawings) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), mat(0xf4e8c8, { side: THREE.DoubleSide }));
    m.position.set(d.pos.x, d.pos.y, d.pos.z);
    m.rotation.y = d.rotY ?? 0;
    root.add(m);
  }

  // lights
  root.add(new THREE.HemisphereLight(0x6a5d8c, 0x1a1420, 0.6));
  const lampLights = a.lamps.map((l) => {
    const light = new THREE.PointLight(l.color, l.intensity * 6, l.range * 1.5, 2);
    light.position.set(l.pos.x, l.pos.y, l.pos.z);
    root.add(light);
    return { lamp: l, light };
  });
  scene.fog = new THREE.Fog(0x07060c, 3, 18);

  let t = 0;
  world.update = (dt) => {
    t += dt;
    for (const { lamp, light } of lampLights)
      if (lamp.flicker) light.intensity = lamp.intensity * 6 * (Math.sin(t * 13) > 0.85 ? 0.2 : 1);
  };
  world.dispose = () => scene.remove(root);
  return world;
}
