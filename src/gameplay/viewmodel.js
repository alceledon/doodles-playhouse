// The held item, drawn in the bottom-right of the view. It hangs off the
// camera just inside the player's collision radius, so it never pokes
// through walls, and its materials glow a little so it reads in the dark.

import * as THREE from 'three';
import { ITEMS } from '../core/contracts.js';

const BASE = new THREE.Vector3(0.115, -0.092, -0.205);

/** Per-item hand pose: rotation (radians), size of its longest side (m), extra offset. */
const POSES = {
  [ITEMS.PADLOCK_KEY]: { rot: [0.5, 2.2, 0.35], size: 0.07 },
  [ITEMS.JEEP_KEY]: { rot: [0.5, 2.2, 0.35], size: 0.065 },
  [ITEMS.TOY_CHEST_KEY]: { rot: [0.5, 2.2, 0.35], size: 0.08 },
  [ITEMS.HAMMER]: { rot: [0.2, 1.3, 1.25], size: 0.11, off: [0.01, 0.012, 0] },
  [ITEMS.CAR_BATTERY]: { rot: [0.15, 0.5, 0.05], size: 0.085, off: [-0.005, -0.018, 0.01] },
  [ITEMS.FUSE]: { rot: [0.3, 0.9, 0.5], size: 0.05 },
  [ITEMS.TENNIS_BALL]: { rot: [0.3, 0.4, 0], size: 0.045 },
  [ITEMS.TREATS]: { rot: [0.1, 0.5, -0.1], size: 0.075 },
  [ITEMS.LAUNCHER]: { rot: [0.02, 0.06, 0], size: 0.085, off: [-0.012, -0.004, 0] },
  [ITEMS.DART]: { rot: [0.1, 0.25, 0], size: 0.07 },
};

export function createViewModel({ camera, kit }) {
  const holder = new THREE.Group();
  holder.name = 'viewModel';
  holder.position.copy(BASE);
  camera.add(holder);
  let model = null;
  let shownId = null;
  let clones = [];
  const kick = { x: 0, y: 0, z: 0, rx: 0 }; // spring offset from use animations
  let raise = 0; // 0 = up, 1 = lowered out of view (just picked up)

  function clear() {
    if (model) holder.remove(model);
    for (const m of clones) m.dispose();
    clones = [];
    model = null;
  }

  function show(itemId) {
    if (itemId === shownId) return;
    shownId = itemId;
    clear();
    if (!itemId) return;
    const pose = POSES[itemId] ?? { rot: [0, 0, 0], size: 0.07 };
    const inner = kit.item(itemId);
    inner.scale.setScalar(1);
    inner.rotation.set(...pose.rot);
    // Own materials: brighter than the world copy, and drawn over nothing else.
    inner.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material.clone();
      if (m.map) {
        m.emissiveMap = m.map; // glow in the texture's own colors
        m.emissive.setRGB(0.25, 0.25, 0.25);
      } else m.emissive.copy(m.color).multiplyScalar(0.22);
      m.emissiveIntensity = 1;
      clones.push(m);
      o.material = m;
    });
    // Fit and center it.
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(inner);
    const size = bounds.getSize(new THREE.Vector3());
    const s = pose.size / Math.max(size.x, size.y, size.z, 1e-3);
    const center = bounds.getCenter(new THREE.Vector3());
    inner.position.sub(center);
    wrap.scale.setScalar(s);
    if (pose.off) wrap.position.set(...pose.off);
    model = wrap;
    holder.add(model);
    raise = 1;
  }

  /** A little motion for an action: 'throw', 'fire', 'drop', 'pickup'. */
  function play(kind) {
    if (kind === 'throw') Object.assign(kick, { z: -0.05, y: 0.02, rx: -0.5 });
    else if (kind === 'fire') Object.assign(kick, { z: 0.03, y: 0.006, rx: 0.25 });
    else if (kind === 'drop') raise = 1;
    else if (kind === 'pickup') raise = 1;
  }

  /**
   * @param {boolean} visible  false while hidden, in cutscenes and menus
   * @param {{phase: number, amp: number}} bob  the head bob, for sway
   */
  function update(dt, itemId, visible, bob = { phase: 0, amp: 0 }) {
    show(itemId);
    holder.visible = visible && !!model;
    const k = Math.min(1, dt * 12);
    kick.x += (0 - kick.x) * k;
    kick.y += (0 - kick.y) * k;
    kick.z += (0 - kick.z) * k;
    kick.rx += (0 - kick.rx) * k;
    raise = Math.max(0, raise - dt * 5);
    const sway = Math.sin(bob.phase * Math.PI) * bob.amp * 0.35;
    const lift = Math.abs(Math.sin(bob.phase * Math.PI * 2)) * bob.amp * 0.2;
    holder.position.set(BASE.x + sway + kick.x, BASE.y - lift + kick.y - raise * 0.08, BASE.z + kick.z);
    holder.rotation.set(kick.rx, 0, 0);
  }

  function dispose() {
    clear();
    camera.remove(holder);
  }

  return { update, play, dispose };
}
