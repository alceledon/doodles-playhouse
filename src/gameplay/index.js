// Gameplay entry point: createGameplay() wires the player controller, the
// rules (items, locks, escapes, traps, defenses), the world-side view and the
// held-item view model into the Gameplay object from contracts.js.
//
//   rules.js       what everything means (pure, tested)
//   ../player/     input, movement, camera, hiding, slides and tunnels
//   view.js        meshes for items, lock hardware, code digits, traps, ball, darts
//   viewmodel.js   the item in your hand

import * as THREE from 'three';
import { EVENTS } from '../core/events.js';
import { ITEM_IDS, SETTINGS_DEFAULTS, STOREY_HEIGHT } from '../core/contracts.js';
import { copy, dist2D } from '../core/math.js';
import { circleHitsAny } from '../player/movement.js';
import { createPlayerController } from '../player/controller.js';
import { tuningFor } from './tuning.js';
import { createRules } from './rules.js';
import { firstBoxHit, isOccluded } from './raycast.js';
import { createGameplayView } from './view.js';
import { createViewModel } from './viewmodel.js';

const taggedAncestor = (o) => {
  for (let n = o; n; n = n.parent) if (n.userData?.interact) return n;
  return null;
};
const visibleDeep = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const sameTarget = (a, b) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id && a.dial === b.dial);

/** createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings }) → Gameplay */
export function createGameplay({ scene, camera, canvas, world, bus, rng, difficulty = 'normal', settings = SETTINGS_DEFAULTS }) {
  const tuning = tuningFor(difficulty);
  const debugKeys = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  const rules = createRules({ world, bus, rng, difficulty, tuning });
  const garageDoor = rules.locks.garageDoor();

  const controller = createPlayerController({
    camera, canvas, world, bus, tuning, settings: { ...SETTINGS_DEFAULTS, ...settings },
    // You only leave through the garage in the Jeep: its doorway stays solid on foot.
    extraBlockers: () => (garageDoor?.isOpen ? [garageDoor.collider] : []),
    heldItemId: () => rules.items.heldItemId(),
    onPrimary: primary,
    onSecondary: secondary,
    onDrop: dropHeld,
    onKey: debugKey,
  });
  const player = controller.player;
  const view = createGameplayView({ scene, camera, world, rules, tuning, bus });
  const viewModel = createViewModel({ camera, kit: view.kit });

  // ---- what you're looking at -----------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const rayO = new THREE.Vector3();
  const rayD = new THREE.Vector3();
  let target = null;

  function findTarget() {
    if (player.hidden || controller.isRiding()) return null;
    const eye = player.eyePos();
    const dir = controller.forward();
    raycaster.set(rayO.set(eye.x, eye.y, eye.z), rayD.set(dir.x, dir.y, dir.z));
    raycaster.far = tuning.reach;
    const hits = [];
    for (const h of raycaster.intersectObjects(world.interactables, true)) {
      const tagged = taggedAncestor(h.object);
      if (tagged && visibleDeep(h.object)) hits.push({ t: h.distance, point: h.point, tag: tagged.userData.interact, own: false });
    }
    for (const h of raycaster.intersectObjects(view.targets(), false)) hits.push({ t: h.distance, point: h.point, tag: h.object.userData.interact, own: true });
    if (!hits.length) return null;
    hits.sort((a, b) => a.t - b.t);
    // No grabbing through walls.
    const boxes = world.colliders(player.floorId);
    const seen = hits.filter((h) => !isOccluded(eye, dir, h.t, h.point, boxes));
    if (!seen.length) return null;
    let best = seen[0];
    if (!best.own) {
      // Our targets sit on or in World's props: an item in an open drawer, a dial on the keypad housing.
      const inside = seen.find(
        (h) => h.own && (h.t < best.t + 0.35 || (best.tag.kind === 'container' && h.tag.kind === 'item' && rules.items.get(h.tag.id)?.containerId === best.tag.id)),
      );
      if (inside) best = inside;
    }
    return best.tag;
  }

  // ---- prompts ------------------------------------------------------------------------
  let lastPrompt;
  let message = null; // a one-off line ("Locked: needs ...") that outranks the look prompt for a moment
  let messageLeft = 0;
  let messageTarget = null;

  function showMessage(text) {
    message = text;
    messageLeft = tuning.messageSeconds;
    messageTarget = target;
  }

  function setPrompt(text) {
    if (text === lastPrompt) return;
    lastPrompt = text;
    bus.emit(EVENTS.PROMPT, { text });
  }

  function updatePrompt(dt) {
    if (messageLeft > 0 && !sameTarget(target, messageTarget)) messageLeft = 0;
    messageLeft -= dt;
    if (messageLeft > 0) return setPrompt(message);
    if (player.hidden) return setPrompt('Click: stop hiding');
    if (controller.isRiding()) return setPrompt(null);
    setPrompt(rules.describe(target, player));
  }

  // ---- actions ----------------------------------------------------------------------------
  function primary() {
    if (!controller.isEnabled()) return;
    if (player.hidden) return controller.unhide();
    if (controller.isRiding()) return;
    handle(rules.interact(target ?? findTarget(), player));
  }

  function secondary() {
    if (!controller.isEnabled() || player.hidden || controller.isRiding()) return;
    handle(rules.useHeld(target ?? findTarget(), player));
  }

  function handle(result) {
    if (!result) return;
    if (result.message) showMessage(result.message);
    switch (result.action) {
      case 'hide':
        controller.hide(result.spot);
        break;
      case 'link':
        controller.ride(result.link, result.reverse);
        break;
      case 'throw':
        throwBall();
        break;
      case 'treat':
        dropTreat();
        break;
      case 'fire':
        fireDart();
        break;
      case 'pickup':
        viewModel.play('pickup');
        break;
    }
    target = findTarget();
  }

  /** A spot on the floor in front of you, pulled back if a wall is in the way. */
  function floorAhead(distance) {
    const f = { x: -Math.sin(player.yaw), y: 0, z: -Math.cos(player.yaw) };
    const from = { x: player.pos.x, y: player.pos.y + 0.15, z: player.pos.z };
    const low = controller.boxesAround(player.pos.y, 0.4);
    const wall = firstBoxHit(from, f, low, distance + 0.1);
    let d = wall ? Math.max(0, wall.t - 0.12) : distance;
    if (circleHitsAny(from.x + f.x * d, from.z + f.z * d, 0.06, low)) d = 0;
    const x = from.x + f.x * d;
    const z = from.z + f.z * d;
    const g = world.heightAt(x, z, player.floorId);
    return { pos: { x, y: g.y, z }, floorId: g.floorId };
  }

  function dropHeld() {
    if (!controller.isEnabled() || player.hidden || controller.isRiding() || !rules.items.held()) return;
    const { pos, floorId } = floorAhead(0.45);
    rules.drop(pos, floorId);
    viewModel.play('drop');
  }

  function dropTreat() {
    const { pos, floorId } = floorAhead(0.6);
    rules.dropTreat(pos, floorId);
    viewModel.play('drop');
  }

  function throwBall() {
    const eye = player.eyePos();
    const f = controller.forward();
    const inst = rules.throwBall(copy(player.pos), player.floorId);
    if (!inst) return;
    const s = tuning.ball.throwSpeed;
    const origin = { x: eye.x + f.x * 0.2, y: eye.y - 0.08 + f.y * 0.2, z: eye.z + f.z * 0.2 };
    view.throwBall(inst, origin, { x: f.x * s, y: f.y * s + tuning.ball.lift, z: f.z * s }, player.floorId);
    viewModel.play('throw');
  }

  function fireDart() {
    const eye = player.eyePos();
    const dir = controller.forward();
    let range = tuning.dart.range;
    const wall = firstBoxHit(eye, dir, controller.boxesAround(player.pos.y, 2.6, eye.x, eye.z, range), range);
    if (wall) range = wall.t;
    // Floors and ceilings aren't boxes: stop at those planes too.
    const floor = player.pos.y;
    if (dir.y < -1e-3) range = Math.min(range, (eye.y - floor) / -dir.y);
    if (dir.y > 1e-3) range = Math.min(range, (floor + STOREY_HEIGHT - 0.1 - eye.y) / dir.y);
    const firedAt = performance.now();
    if (!rules.fireDart(eye, dir, range, player.floorId)) return;
    view.fireDart(eye, dir, range, player.floorId, firedAt);
    viewModel.play('fire');
  }

  function debugKey(code) {
    if (!debugKeys) return;
    const digit = /^Digit(\d)$/.exec(code);
    if (digit) {
      const k = (Number(digit[1]) + 9) % 10; // 1..9 then 0 → ITEM_IDS[0..9]
      if (ITEM_IDS[k]) debug.giveItem(ITEM_IDS[k]);
    } else if (code === 'KeyN') bus.emit(EVENTS.NOISE, { pos: copy(player.pos), floorId: player.floorId, loudness: 12, kind: 'other' });
    else if (code === 'KeyV') controller.setNoclip(!controller.isNoclip());
    else if (code === 'KeyL') rules.openAll();
  }

  // ---- escape on foot through an open front door -------------------------------------------
  function checkWalkOut() {
    const door = rules.locks.frontDoor();
    if (!door?.isOpen || player.floorId !== door.floorId) return;
    const exit = world.anchors.frontDoor.exit.pos;
    if (dist2D(player.pos, exit) < dist2D(door.pos, exit) - 0.3) rules.escape('frontDoor');
  }

  // ---- per frame -----------------------------------------------------------------------------
  function update(dt) {
    // World-side motion (ball, darts, falling locks) carries on during cutscenes.
    view.update(dt);
    if (!controller.isEnabled()) {
      viewModel.update(dt, rules.items.heldItemId(), false);
      return;
    }
    controller.update(dt);
    if (!player.hidden && !controller.isRiding()) {
      const fired = rules.updateTraps(player);
      if (fired.length) view.trapsFired(fired);
      checkWalkOut();
    }
    target = findTarget();
    updatePrompt(dt);
    viewModel.update(dt, rules.items.heldItemId(), !player.hidden, controller.bob());
  }

  function startDay() {
    controller.wake(world.anchors.startBed);
    rules.startDay();
    view.resetDay();
    target = null;
    messageLeft = 0;
    setPrompt(null);
  }

  function onCaught() {
    // The held item falls where you were (in front of the hide spot if you were pulled out).
    const g = world.heightAt(player.pos.x, player.pos.z, player.floorId);
    rules.onCaught({ x: player.pos.x, y: g.y, z: player.pos.z }, g.floorId);
    if (player.hidden) controller.unhide();
    controller.cancelRide();
  }

  function setControlsEnabled(enabled) {
    controller.setEnabled(enabled);
    if (!enabled) {
      messageLeft = 0;
      setPrompt(null);
    }
  }

  const debug = {
    giveItem(id) {
      const g = world.heightAt(player.pos.x, player.pos.z, player.floorId);
      rules.giveItem(id, { x: player.pos.x, y: g.y, z: player.pos.z }, g.floorId);
    },
    setNoclip: (on) => controller.setNoclip(on),
    teleport(pos, floorId) {
      controller.placeAt(pos, floorId);
    },
    openAllLocks: () => rules.openAll(),
    keypadCode: () => rules.code,
    // Extras for dev pages and automated checks.
    rules,
    controller,
    view,
    /** Face a point (or set yaw/pitch directly). */
    lookAt(p) {
      const eye = player.eyePos();
      player.yaw = Math.atan2(-(p.x - eye.x), -(p.z - eye.z));
      player.pitch = Math.atan2(p.y - eye.y, Math.hypot(p.x - eye.x, p.z - eye.z));
    },
    target: () => target ?? findTarget(),
    interact: () => primary(),
    use: () => secondary(),
    drop: () => dropHeld(),
  };

  return {
    player,
    update,
    startDay,
    onCaught,
    setControlsEnabled,
    requestPointerLock: () => controller.requestPointerLock(),
    exitPointerLock: () => controller.exitPointerLock(),
    dispose() {
      controller.dispose();
      viewModel.dispose();
      view.dispose();
    },
    debug,
  };
}

