// World entry point: createWorld({ scene, bus, rng, difficulty }) → World.
//
// build.js makes the World data (pure, tested under node); this file dresses
// it: merged static meshes, animated doors and containers, the lamp pool,
// the moving set pieces and the debug overlays. See src/world/README.md.

import * as THREE from 'three';
import { buildWorldData } from './build.js';
import { createTextures } from './textures.js';
import { buildStaticMeshes } from './meshes.js';
import { buildDynamic } from './dynamic.js';
import { createLighting } from './lights.js';
import { createAnimated } from './animated.js';
import { createWorldDebug } from './debug.js';

/** createWorld({ scene, bus, rng, difficulty }) → World */
export function createWorld({ scene, bus, rng, difficulty = 'normal' }) {
  let dynamic = null;
  const world = buildWorldData({
    difficulty,
    bus,
    onDoorChange: (d) => dynamic?.syncDoor(d),
    onContainerChange: (c) => dynamic?.syncContainer(c),
  });

  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const tex = createTextures();
  const statics = buildStaticMeshes(world, tex);
  root.add(statics.group);
  dynamic = buildDynamic(world, statics.material);
  root.add(dynamic.group);
  const lighting = createLighting({ root, scene, world, tuning: world.tuning });
  const animated = createAnimated({ root, world, tex, material: statics.material, rng: rng.fork('decor'), tuning: world.tuning });

  // invisible-but-raycastable boxes for hide spots, link entries, the keypad, etc.
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const proxyGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const p of world.geo.proxies) {
    const b = p.box;
    const mesh = new THREE.Mesh(proxyGeo, proxyMat);
    mesh.scale.set(Math.max(b.maxX - b.minX, 0.02), Math.max(b.maxY - b.minY, 0.02), Math.max(b.maxZ - b.minZ, 0.02));
    mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    mesh.userData.interact = { ...p.tag };
    mesh.name = `${p.tag.kind}:${p.tag.id}`;
    root.add(mesh);
    world.interactables.push(mesh);
  }
  world.interactables.push(...dynamic.interactables);
  root.updateMatrixWorld(true);

  const debug = createWorldDebug(root, world);

  world.update = (dt, playerPos) => {
    dynamic.update(dt);
    lighting.update(dt, playerPos);
    animated.update(dt, playerPos);
  };

  world.dispose = () => {
    scene.remove(root);
    debug.dispose();
    animated.dispose();
    lighting.dispose();
    dynamic.dispose();
    statics.dispose();
    proxyGeo.dispose();
    proxyMat.dispose();
    tex.dispose();
  };

  /** World-area debug hooks (not part of the contract): window.__game.world.debug in ?debug=1 runs. */
  world.debug = {
    showNav: debug.showNav,
    showAnchors: debug.showAnchors,
    lights: lighting.debugInfo,
    tvOn: animated.tvOn,
    root,
  };
  return world;
}
