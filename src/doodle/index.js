// Doodle entry point: createDoodle({ scene, world, bus, rng, difficulty, puppet }) → Doodle.
//
// The brain (brain.js, pure logic) does all the thinking and moving; this file
// adds the three.js model and keeps the two in sync. See README.md.
// puppet: true (the co-op guest) swaps the brain for puppet.js, which only
// follows the host's snapshots and never touches the bus.
//
// Debug (?debug=1): window.__game.doodle.debug.overlay(true) shows the path,
// sight cone, hearing ring, noises and scent. &doodleOverlay=1 turns it on at start.

import { createDoodleCore } from './brain.js';
import { createDoodlePuppet } from './puppet.js';
import { createDoodleModel } from './model.js';
import { createDoodleOverlay } from './overlay.js';

/** createDoodle({ scene, world, bus, rng, difficulty, puppet }) → Doodle */
export function createDoodle({ scene, world, bus, rng, difficulty = 'normal', tuning = null, puppet = false }) {
  const doodle = puppet ? createDoodlePuppet({ world }) : createDoodleCore({ world, bus, rng, difficulty, tuning });
  const model = createDoodleModel();
  scene.add(model.object3d);
  doodle.model = model;

  let overlay = null;
  let shownPose = null;
  let shownMood = null;
  let shownCarry;

  // While active the brain owns the model. While inactive (cutscenes, pause)
  // the model keeps animating but its placement, pose and mood belong to
  // whoever drives the cutscene, so we leave them alone.
  function sync() {
    const o = model.object3d;
    o.position.set(doodle.pos.x, doodle.pos.y, doodle.pos.z);
    o.rotation.set(doodle.pitch ?? 0, doodle.yaw, 0, 'YXZ');
    if (doodle.pose !== shownPose) model.setPose((shownPose = doodle.pose));
    if (doodle.mood !== shownMood) model.setMood((shownMood = doodle.mood));
    if (doodle.carrying !== shownCarry) model.setCarrying((shownCarry = doodle.carrying));
    model.setGait(doodle.speed);
  }

  const think = doodle.update;
  doodle.update = (dt, players) => {
    const wasActive = doodle.active;
    think(dt, players);
    // Includes the frame it was switched off in (CAUGHT freezes it mid-update),
    // so the cutscene starts from the pounce rather than a frozen run cycle.
    if (wasActive) sync();
    if (!doodle.active) model.setGait(null);
    model.update(dt);
    overlay?.update(doodle, dt);
  };

  const resetBrain = doodle.reset;
  doodle.reset = (spot, opts) => {
    resetBrain(spot, opts);
    shownPose = shownMood = null;
    shownCarry = undefined;
    sync(); // contract: back at its own pos, asleep
  };

  const setActiveBrain = doodle.setActive;
  doodle.setActive = (on) => {
    setActiveBrain(on);
    if (on) {
      // Re-take the model from the cutscene on the next sync.
      shownPose = shownMood = null;
      shownCarry = undefined;
    } else model.setGait(null);
  };

  const disposeBrain = doodle.dispose;
  doodle.dispose = () => {
    disposeBrain();
    overlay?.dispose();
    overlay = null;
    scene.remove(model.object3d);
    model.dispose();
  };

  /** Toggle the debug overlay. Returns whether it's now on. */
  doodle.debug.overlay = (on = !overlay) => {
    if (puppet) return false; // nothing to show: the senses live on the host
    if (on && !overlay) overlay = createDoodleOverlay(scene);
    else if (!on && overlay) {
      overlay.dispose();
      overlay = null;
    }
    return !!overlay;
  };

  const params = new URLSearchParams(globalThis.location?.search ?? '');
  if (params.has('debug') && params.has('doodleOverlay')) doodle.debug.overlay(true);

  sync();
  return doodle;
}
