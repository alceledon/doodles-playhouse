// Procedural low-poly models for everything Gameplay puts in the world:
// items, the padlock and plank, keypad dials, squeaky toys, block towers,
// treats and darts. Lambert materials with pixel textures. Every model's
// origin is where it rests (its base), facing -Z.
//
// createModelKit() caches geometries and materials for one run and frees
// them all in dispose().

import * as THREE from 'three';
import { ITEMS } from '../core/contracts.js';
import { BALL_RADIUS } from './ball.js';
import {
  batteryTexture, blockTexture, brassTexture, dialTexture, fuzzTexture, metalTexture, tennisTexture, treatBagTexture, woodTexture,
} from './textures.js';

/** How much bigger than life items are drawn, so a kid can spot a key on a dark floor. */
const ITEM_SCALE = {
  [ITEMS.PADLOCK_KEY]: 1.6,
  [ITEMS.JEEP_KEY]: 1.6,
  [ITEMS.TOY_CHEST_KEY]: 1.4,
  [ITEMS.FUSE]: 1.7,
  [ITEMS.DART]: 1.4,
};

export function createModelKit() {
  const geometries = new Map();
  const materials = new Map();

  const geo = (key, make) => {
    if (!geometries.has(key)) geometries.set(key, make());
    return geometries.get(key);
  };
  /**
   * Lambert material, cached by color + texture + emissive. Small or dark items get a faint
   * emissive glow so they can be found in the dark; `glowMap` makes a texture glow in its own colours.
   */
  const mat = (color, { map = null, emissive = 0, emissiveIntensity = 1, glowMap = false, transparent = false, opacity = 1, key = '' } = {}) => {
    const k = `${color}|${map?.uuid ?? ''}|${emissive}|${emissiveIntensity}|${glowMap}|${opacity}|${key}`;
    if (!materials.has(k)) {
      const m = new THREE.MeshLambertMaterial({ color, map, emissive, emissiveIntensity, transparent, opacity });
      if (glowMap && map) m.emissiveMap = map;
      materials.set(k, m);
    }
    return materials.get(k);
  };
  const box = (w, h, d) => geo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, seg = 8) => geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const sphere = (r, w = 8, h = 6) => geo(`sph${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
  const torus = (r, t, arc = Math.PI * 2) => geo(`tor${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 4, 10, arc));

  const part = (geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  const group = (...children) => {
    const g = new THREE.Group();
    g.add(...children);
    return g;
  };

  const brass = () => mat(0xffffff, { map: brassTexture(), emissive: 0x3a2a05 });
  const metal = () => mat(0xffffff, { map: metalTexture() });
  const wood = (light = false) => mat(0xffffff, { map: woodTexture(light) });

  // ---- items -----------------------------------------------------------------

  const builders = {
    [ITEMS.PADLOCK_KEY]: () =>
      group(
        part(torus(0.022, 0.007), brass(), -0.045, 0.007, 0, Math.PI / 2),
        part(box(0.07, 0.012, 0.012), brass(), 0.01, 0.007, 0),
        part(box(0.012, 0.012, 0.018), brass(), 0.035, 0.007, 0.012),
        part(box(0.01, 0.012, 0.012), brass(), 0.02, 0.007, 0.01),
      ),
    [ITEMS.HAMMER]: () =>
      group(
        part(box(0.24, 0.03, 0.032), wood(), 0, 0.017, 0),
        part(box(0.036, 0.04, 0.11), metal(), 0.13, 0.02, 0),
        part(box(0.03, 0.03, 0.04), metal(), 0.13, 0.02, -0.07, 0, 0, 0),
      ),
    // A toy-car key: a chunky teal fob, so it doesn't vanish on a dark floor.
    [ITEMS.JEEP_KEY]: () =>
      group(
        part(box(0.046, 0.018, 0.036), mat(0x2fc4d8, { emissive: 0x0a3a44 }), -0.022, 0.009, 0),
        part(box(0.05, 0.008, 0.014), mat(0xffffff, { map: metalTexture(), emissive: 0x202020 }), 0.026, 0.006, 0),
        part(torus(0.016, 0.004), mat(0xe03c31, { emissive: 0x300000 }), -0.056, 0.005, 0, Math.PI / 2),
      ),
    [ITEMS.CAR_BATTERY]: () =>
      group(
        part(box(0.26, 0.18, 0.17), mat(0xffffff, { map: batteryTexture(), emissive: 0x5a5a5a, glowMap: true }), 0, 0.09, 0),
        part(cyl(0.017, 0.017, 0.025, 6), mat(0xe03c31, { emissive: 0x300000 }), -0.08, 0.19, 0),
        part(cyl(0.017, 0.017, 0.025, 6), mat(0x2b2b2b), 0.08, 0.19, 0),
        part(torus(0.05, 0.008, Math.PI), mat(0x2b2b2b), 0, 0.18, 0),
      ),
    [ITEMS.FUSE]: () =>
      group(
        part(cyl(0.012, 0.012, 0.046, 6), mat(0xffb347, { emissive: 0x402000, transparent: true, opacity: 0.85 }), 0, 0.014, 0, 0, 0, Math.PI / 2),
        part(cyl(0.014, 0.014, 0.012, 6), metal(), -0.028, 0.014, 0, 0, 0, Math.PI / 2),
        part(cyl(0.014, 0.014, 0.012, 6), metal(), 0.028, 0.014, 0, 0, 0, Math.PI / 2),
      ),
    [ITEMS.TOY_CHEST_KEY]: () =>
      group(
        part(cyl(0.034, 0.034, 0.016, 5), mat(0xff6fb5, { emissive: 0x30081a }), -0.06, 0.008, 0),
        part(box(0.09, 0.018, 0.02), mat(0x9b59d0, { emissive: 0x1a0828 }), 0.01, 0.009, 0),
        part(box(0.016, 0.018, 0.028), mat(0x9b59d0), 0.045, 0.009, 0.02),
        part(box(0.016, 0.018, 0.02), mat(0x9b59d0), 0.022, 0.009, 0.016),
      ),
    [ITEMS.TENNIS_BALL]: () =>
      group(part(geo('ball', () => new THREE.IcosahedronGeometry(BALL_RADIUS, 1)), mat(0xffffff, { map: tennisTexture(), emissive: 0x1a2200 }), 0, BALL_RADIUS, 0)),
    [ITEMS.TREATS]: () =>
      group(
        part(box(0.12, 0.15, 0.05), mat(0xffffff, { map: treatBagTexture() }), 0, 0.075, 0),
        part(box(0.124, 0.02, 0.03), mat(0xa47a46), 0, 0.16, 0),
      ),
    [ITEMS.LAUNCHER]: () =>
      group(
        part(box(0.08, 0.07, 0.2), mat(0xf28c28, { emissive: 0x2a1000 }), 0, 0.075, 0.02),
        part(cyl(0.024, 0.024, 0.14, 8), mat(0x3b7ddd), 0, 0.085, -0.13, Math.PI / 2),
        part(box(0.04, 0.09, 0.045), mat(0x3b7ddd), 0, 0.03, 0.09, -0.3),
        part(box(0.084, 0.014, 0.12), mat(0xf2c230), 0, 0.105, 0.02),
        part(sphere(0.02, 6, 4), mat(0xff6fb5, { emissive: 0x300818 }), 0, 0.085, -0.205),
      ),
    [ITEMS.DART]: () => dartModel(),
  };

  function dartModel() {
    return group(
      part(cyl(0.007, 0.007, 0.09, 5), mat(0x3fae49), 0, 0.012, 0, Math.PI / 2),
      part(sphere(0.016, 6, 4), mat(0xff6fb5, { emissive: 0x300818 }), 0, 0.014, -0.05),
      part(box(0.03, 0.004, 0.02), mat(0xf2c230), 0, 0.012, 0.04),
      part(box(0.004, 0.03, 0.02), mat(0xf2c230), 0, 0.012, 0.04),
    );
  }

  /** A fresh model of an item, origin at its base. */
  function item(itemId) {
    const g = (builders[itemId] ?? builders[ITEMS.FUSE])();
    g.scale.setScalar(ITEM_SCALE[itemId] ?? 1);
    g.name = `item:${itemId}`;
    return g;
  }

  // ---- front door hardware ------------------------------------------------------

  /** Padlock on a hasp, front face toward -Z... the caller turns it to face out of the door. */
  function padlock() {
    const g = group(
      part(box(0.05, 0.16, 0.012), metal(), 0, 0, 0.012),
      part(box(0.075, 0.085, 0.036), brass(), 0, -0.02, -0.012),
      part(torus(0.024, 0.007, Math.PI), metal(), 0, 0.022, -0.012),
      part(box(0.012, 0.024, 0.004), mat(0x1b1b1f), 0, -0.025, -0.031),
    );
    g.scale.setScalar(1.4);
    return g;
  }

  /** A board nailed across the door, centered, `length` along X. */
  function plank(length) {
    const g = group(part(box(length, 0.16, 0.035), wood(true), 0, 0, 0));
    for (const x of [-length / 2 + 0.07, length / 2 - 0.07])
      for (const y of [-0.04, 0.04]) g.add(part(cyl(0.008, 0.008, 0.012, 5), mat(0x55585e), x, y, -0.022, Math.PI / 2));
    return g;
  }

  // ---- keypad ---------------------------------------------------------------------

  /** One dial: a colored frame with a digit window. Call setDigit to change the number. */
  function dial(color) {
    const face = new THREE.MeshLambertMaterial({ map: dialTexture(0, color.css), emissive: 0x222222 });
    materials.set(`dialFace${color.name}${materials.size}`, face);
    const g = group(
      part(box(0.07, 0.1, 0.03), mat(color.hex, { emissive: color.hex, emissiveIntensity: 0.15 }), 0, 0, 0),
      part(geo('dialFace', () => new THREE.PlaneGeometry(0.05, 0.072)), face, 0, 0, -0.0155, 0, Math.PI, 0),
    );
    g.userData.setDigit = (d) => {
      face.map = dialTexture(d, color.css);
      face.needsUpdate = true;
    };
    return g;
  }

  function plate(w, h, d, color = 0x3a3742) {
    return part(box(w, h, d), mat(color), 0, 0, 0);
  }

  /** A small indicator light; setOn(true/false) swaps red/green. */
  function led(onColor = 0x44ff66, offColor = 0xff3322) {
    const m = new THREE.MeshLambertMaterial({ color: offColor, emissive: offColor, emissiveIntensity: 0.9 });
    materials.set(`led${materials.size}`, m);
    const mesh = part(sphere(0.012, 6, 4), m);
    mesh.userData.setOn = (on) => {
      m.color.setHex(on ? onColor : offColor);
      m.emissive.setHex(on ? onColor : offColor);
    };
    return mesh;
  }

  // ---- traps -----------------------------------------------------------------------

  function squeakyToy(variant = 0) {
    if (variant % 2 === 0) {
      // rubber duck
      const yellow = mat(0xffffff, { map: fuzzTexture('#f6d02f', ['#ffe46a', '#e0b820'], 'duck'), emissive: 0x2a2000 });
      return group(
        part(sphere(0.06, 8, 6), yellow, 0, 0.05, 0),
        part(sphere(0.04, 8, 6), yellow, 0, 0.11, -0.035),
        part(box(0.035, 0.012, 0.03), mat(0xf28c28), 0, 0.105, -0.075),
        part(sphere(0.008, 4, 3), mat(0x111111), 0.022, 0.125, -0.06),
        part(sphere(0.008, 4, 3), mat(0x111111), -0.022, 0.125, -0.06),
      );
    }
    // squeaky bone
    const pink = mat(0xff8fc8, { emissive: 0x2a0818 });
    return group(
      part(cyl(0.022, 0.022, 0.16, 6), pink, 0, 0.025, 0, 0, 0, Math.PI / 2),
      part(sphere(0.032, 6, 4), pink, -0.085, 0.03, -0.02),
      part(sphere(0.032, 6, 4), pink, -0.085, 0.03, 0.02),
      part(sphere(0.032, 6, 4), pink, 0.085, 0.03, -0.02),
      part(sphere(0.032, 6, 4), pink, 0.085, 0.03, 0.02),
    );
  }

  /** Toy blocks; the caller stacks and animates them. */
  function block(k) {
    return part(box(0.12, 0.12, 0.12), mat(0xffffff, { map: blockTexture(k) }));
  }

  function treat() {
    const brown = mat(0xa8713a, { emissive: 0x1a0d00 });
    return group(
      part(box(0.06, 0.016, 0.018), brown, 0, 0.008, 0),
      part(box(0.02, 0.016, 0.032), brown, -0.03, 0.008, 0),
      part(box(0.02, 0.016, 0.032), brown, 0.03, 0.008, 0),
    );
  }

  /** Invisible raycast target. Three's raycaster ignores `visible`, so proxies stay hidden but hittable. */
  const proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
  materials.set('proxy', proxyMaterial);
  function proxySphere(r) {
    return new THREE.Mesh(sphere(r, 6, 4), proxyMaterial);
  }
  function proxyBox(w, h, d) {
    return new THREE.Mesh(box(w, h, d), proxyMaterial);
  }

  function dispose() {
    for (const g of geometries.values()) g.dispose();
    for (const m of materials.values()) m.dispose();
    geometries.clear();
    materials.clear();
  }

  return { item, dart: dartModel, padlock, plank, dial, plate, led, squeakyToy, block, treat, proxySphere, proxyBox, mat, dispose };
}
