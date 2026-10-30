// Debug overlays for the World: the nav grids (one coloured tile per cell) and
// markers for every anchor. Built lazily the first time they're switched on.
//
// Nav colours: green = anyone walks, yellow = doorway, magenta = player-only
// crawl space. Anchor colours: yellow spawns (orange inside a container),
// green hide spots (with a line to the hidden eye), red traps (white = creaky),
// magenta drawings, blue patrol, white lamps, cyan link paths, pink start bed,
// lilac co-op start bed, brown kennel, red exits.

import * as THREE from 'three';
import { NAV } from '../core/navgrid.js';

function navOverlay(world) {
  const group = new THREE.Group();
  group.name = 'navOverlay';
  const tile = new THREE.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, fog: false });
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const g of Object.values(world.nav.floors)) {
    const cells = [];
    for (let j = 0; j < g.h; j++)
      for (let i = 0; i < g.w; i++) {
        const f = g.cells[j * g.w + i];
        if (f & (NAV.WALK | NAV.DOOR)) cells.push([i, j, f]);
      }
    const mesh = new THREE.InstancedMesh(tile, mat, cells.length);
    cells.forEach(([i, j, f], k) => {
      m.makeTranslation(g.originX + (i + 0.5) * world.nav.cellSize, g.y + 0.03, g.originZ + (j + 0.5) * world.nav.cellSize);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c.set(f & NAV.PLAYER_ONLY ? 0xff40ff : f & NAV.DOOR ? 0xffe040 : 0x40ff70));
    });
    mesh.renderOrder = 5;
    group.add(mesh);
  }
  return { group, dispose: () => (tile.dispose(), mat.dispose()) };
}

function anchorOverlay(world) {
  const group = new THREE.Group();
  group.name = 'anchorOverlay';
  const geos = [];
  const mats = new Map();
  const mat = (color) => {
    if (!mats.has(color)) mats.set(color, new THREE.MeshBasicMaterial({ color, fog: false, depthTest: false, transparent: true, opacity: 0.85 }));
    return mats.get(color);
  };
  const cube = new THREE.BoxGeometry(1, 1, 1);
  geos.push(cube);
  const marker = (pos, color, size = 0.12, h = size) => {
    const mesh = new THREE.Mesh(cube, mat(color));
    mesh.scale.set(size, h, size);
    mesh.position.set(pos.x, pos.y + h / 2, pos.z);
    mesh.renderOrder = 10;
    group.add(mesh);
  };
  const lines = [];
  const lineColors = [];
  const line = (a, b, color) => {
    const col = new THREE.Color(color);
    lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    lineColors.push(col.r, col.g, col.b, col.r, col.g, col.b);
  };
  const a = world.anchors;
  for (const list of Object.values(a.spawns)) for (const s of list) marker(s.pos, s.containerId ? 0xff9020 : 0xffe020, 0.1);
  for (const h of a.hideSpots) {
    marker(h.pos, 0x30e060, 0.16);
    line(h.pos, h.eyePos, 0x30e060);
    line(h.eyePos, { x: h.eyePos.x - Math.sin(h.yaw) * 0.4, y: h.eyePos.y, z: h.eyePos.z - Math.cos(h.yaw) * 0.4 }, 0xffffff);
    marker(h.exitPos, 0x1a8a3a, 0.08, 0.02);
  }
  for (const t of a.traps) marker(t.pos, t.kind === 'creaky' ? 0xffffff : t.kind === 'piano' ? 0xff40a0 : t.kind === 'blocks' ? 0xff6020 : 0xff2020, t.radius * 2, 0.03);
  for (const d of a.drawings) marker(d.pos, 0xff40ff, 0.2, 0.2);
  for (const p of a.patrol) marker(p.pos, 0x4080ff, 0.12, 1.6);
  for (const l of a.lamps) marker(l.pos, 0xffffff, 0.14);
  for (const l of world.nav.links) for (let i = 1; i < l.points.length; i++) line(l.points[i - 1], l.points[i], l.kind === 'stairs' ? 0x40e0ff : l.kind === 'slide' ? 0xffd040 : 0xff40ff);
  marker(a.startBed.pos, 0xff80c0, 0.3, 0.05);
  if (a.startBed2) marker(a.startBed2.pos, 0xc080ff, 0.3, 0.05);
  marker(a.kennel.pos, 0x8a5a2a, 0.5, 0.05);
  marker(a.kennelBed.pos, 0xc08040, 0.15);
  marker(a.frontDoor.exit.pos, 0xff3030, 0.3, 2);
  marker(a.garage.exit.pos, 0xff3030, 0.3, 2);
  for (const c of world.containers) marker(c.itemSpot.pos, 0xffb060, 0.06);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  geos.push(lg);
  const lm = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, fog: false, transparent: true });
  mats.set('lines', lm);
  const ls = new THREE.LineSegments(lg, lm);
  ls.renderOrder = 11;
  group.add(ls);
  return { group, dispose: () => (geos.forEach((g) => g.dispose()), [...mats.values()].forEach((m) => m.dispose())) };
}

/** Lazily-built overlays you toggle on and off. */
export function createWorldDebug(root, world) {
  const made = {};
  const toggle = (name, build, on) => {
    if (on && !made[name]) {
      made[name] = build(world);
      root.add(made[name].group);
    }
    if (made[name]) made[name].group.visible = on;
  };
  return {
    showNav: (on = true) => toggle('nav', navOverlay, on),
    showAnchors: (on = true) => toggle('anchors', anchorOverlay, on),
    dispose() {
      for (const o of Object.values(made)) o.dispose();
    },
  };
}
