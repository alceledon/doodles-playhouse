// The first-person player: input, pointer lock, mouse look, walking with
// collision and stairs, crouch, sprint and stamina, head bob, footsteps,
// the flashlight, hiding, and riding slides / crawl tunnels.
//
// Owns the Player object (contracts.js). It never decides game rules: clicks
// and keys are handed to the callbacks (onPrimary, onSecondary, onDrop, onKey).
// Touch controls (touch.js) feed it through `stick`, touchLook() and the
// toggles; in touch mode there's no pointer lock.

import * as THREE from 'three';
import { EVENTS } from '../core/events.js';
import { ITEMS, PLAYER_BODY, SETTINGS_DEFAULTS, STOREY_HEIGHT } from '../core/contracts.js';
import { angleDiff, clamp, copy, lerp, lerpV } from '../core/math.js';
import { isTouchMode } from '../core/device.js';
import { combineMove, idleStick } from './joystick.js';
import { bodyHeight, canStand, overlappingY, pushOut, slideMove, targetSpeed, updateStamina, wishDir } from './movement.js';
import { createPathFollower, yawOf } from './path.js';

const R = PLAYER_BODY.radius;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param {Object} opts
 * @param {THREE.Camera} opts.camera
 * @param {HTMLCanvasElement} opts.canvas
 * @param {Object} opts.world
 * @param {Object} opts.bus
 * @param {Object} opts.tuning           tuningFor(difficulty)
 * @param {Object} [opts.settings]
 * @param {() => Object[]} [opts.extraBlockers]   boxes Gameplay adds (the garage doorway)
 * @param {() => string|null} [opts.heldItemId]
 * @param {() => void} [opts.onPrimary]   left click / E
 * @param {() => void} [opts.onSecondary] right click
 * @param {() => void} [opts.onDrop]      G
 * @param {(code: string) => void} [opts.onKey]  any other key (debug keys)
 */
export function createPlayerController({
  camera, canvas, world, bus, tuning, settings = SETTINGS_DEFAULTS,
  extraBlockers = () => [], heldItemId = () => null,
  onPrimary = () => {}, onSecondary = () => {}, onDrop = () => {}, onKey = () => {},
}) {
  const floorY = Object.fromEntries(world.floors.map((f) => [f.id, f.y]));
  let sensitivity = settings.mouseSensitivity ?? 1;
  let touchSensitivity = settings.touchSensitivity ?? 1;
  let invertY = !!settings.invertY;
  bus.on(EVENTS.SETTINGS_CHANGED, ({ settings: s }) => {
    if (!s) return;
    sensitivity = s.mouseSensitivity ?? sensitivity;
    touchSensitivity = s.touchSensitivity ?? touchSensitivity;
    invertY = !!s.invertY;
  });

  const start = world.anchors.startBed;
  let eyeH = PLAYER_BODY.eyeHeight;
  const player = {
    pos: copy(start.pos),
    floorId: start.floorId,
    yaw: start.rotY ?? 0,
    pitch: 0,
    crouched: false,
    sprinting: false,
    hidden: false,
    hideSpotId: null,
    flashlightOn: false,
    get held() {
      return heldItemId();
    },
    stamina: 1,
    moving: false,
    /** {linkId, kind} while riding a slide or crawling a tunnel */
    onLink: null,
    eyePos() {
      const h = hideSpot();
      if (h) return copy(h.eyePos);
      return { x: player.pos.x, y: player.pos.y + eyeH, z: player.pos.z };
    },
    visibility() {
      if (player.hidden) return 0;
      const light = world.lightLevelAt(player.eyePos(), player.floorId);
      const v = light + (player.flashlightOn ? tuning.flashlight.visibility : 0);
      return clamp(v * (player.crouched ? tuning.crouchVisibility : 1), 0, 1);
    },
  };
  const hideSpot = () => (player.hideSpotId ? world.anchors.hideSpots.find((h) => h.id === player.hideSpotId) : null);

  // ---- flashlight -------------------------------------------------------------
  const fl = tuning.flashlight;
  const flashlight = new THREE.SpotLight(0xfff2d0, 0, fl.distance, fl.angle, fl.penumbra, fl.decay);
  flashlight.position.set(0.08, -0.06, 0);
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight, flashlight.target);
  function setFlashlight(on) {
    player.flashlightOn = on;
    // Intensity, not visibility: toggling a light's visibility recompiles every shader.
    flashlight.intensity = on ? fl.intensity : 0;
  }

  // ---- input ------------------------------------------------------------------
  const keys = new Set();
  let enabled = false;
  let noclip = false;
  let wantCrouch = false;
  let lastPause = -1e9;

  function requestPause() {
    const now = performance.now();
    if (now - lastPause < 250) return;
    lastPause = now;
    bus.emit(EVENTS.PAUSE_REQUEST, {});
  }

  function toggleCrouch() {
    if (enabled && !player.hidden && !riding) wantCrouch = !wantCrouch;
  }
  function toggleFlashlight() {
    if (enabled) setFlashlight(!player.flashlightOn);
  }

  const onKeyDown = (e) => {
    if (!enabled) return;
    keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyC':
        toggleCrouch();
        break;
      case 'KeyF':
        toggleFlashlight();
        break;
      case 'KeyE':
        onPrimary();
        break;
      case 'KeyG':
        onDrop();
        break;
      case 'Escape':
        // With the pointer locked the browser eats Esc and we see the lock drop instead.
        if (document.pointerLockElement !== canvas) requestPause();
        break;
      default:
        onKey(e.code);
    }
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onMouseMove = (e) => {
    if (!enabled || document.pointerLockElement !== canvas) return;
    look(clamp(e.movementX, -300, 300), clamp(e.movementY, -300, 300));
  };
  const onMouseDown = (e) => {
    if (!enabled) return;
    if (document.pointerLockElement !== canvas) {
      requestPointerLock(); // the click that locks the mouse isn't an action
      return;
    }
    if (e.button === 0) onPrimary();
    else if (e.button === 2) onSecondary();
  };
  const onContextMenu = (e) => e.preventDefault();
  const onLockChange = () => {
    if (enabled && document.pointerLockElement !== canvas) requestPause();
  };
  // Switching apps or tabs mid-play pauses (touch has no pointer lock to lose).
  const onVisibility = () => {
    if (enabled && document.hidden) requestPause();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('visibilitychange', onVisibility);

  function requestPointerLock() {
    if (isTouchMode()) return; // touch looks by dragging; a lock would only hide nothing
    try {
      const p = canvas.requestPointerLock?.();
      p?.catch?.(() => {}); // refused right after Esc; the next canvas click retries
    } catch {}
  }
  function exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Mouse look in pixels (also used by debug.look). */
  function look(dx, dy) {
    turn(dx, dy, tuning.look.sensitivity * sensitivity);
  }
  /** Touch look in CSS pixels dragged. */
  function touchLook(dx, dy) {
    turn(dx, dy, tuning.look.touch * touchSensitivity);
  }
  function turn(dx, dy, k) {
    player.yaw -= dx * k;
    player.pitch -= dy * k * (invertY ? -1 : 1);
    clampLook();
  }
  function clampLook() {
    const h = hideSpot();
    if (h) {
      player.yaw = h.yaw + clamp(angleDiff(h.yaw, player.yaw), -tuning.look.hideYaw, tuning.look.hideYaw);
      player.pitch = clamp(player.pitch, -tuning.look.hidePitch, tuning.look.hidePitch);
    } else {
      player.yaw = wrapAngle(player.yaw);
      player.pitch = clamp(player.pitch, -tuning.look.pitchLimit, tuning.look.pitchLimit);
    }
  }

  // ---- movement ---------------------------------------------------------------
  const stam = { stamina: 1, exhausted: false, rest: 1 };
  const vel = { x: 0, z: 0 };
  let fallSpeed = 0;
  let stepTimer = 0;
  let bobPhase = 0;
  let bobAmp = 0;

  /** Colliders that can touch a body standing at feetY: every nearby floor, Y-filtered, plus Gameplay's own. */
  function boxesAround(feetY, height, x = player.pos.x, z = player.pos.z, reach = 2.5) {
    const out = [];
    for (const f of world.floors) {
      if (f.y > feetY + height + 0.1 || f.y + STOREY_HEIGHT * 1.5 < feetY) continue;
      for (const b of world.colliders(f.id))
        if (b.maxX > x - reach && b.minX < x + reach && b.maxZ > z - reach && b.minZ < z + reach) out.push(b);
    }
    out.push(...extraBlockers());
    return overlappingY(out, feetY, height);
  }

  const input = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
  /** The touch stick's analog move; touch.js writes it, zero when idle. */
  const stick = idleStick();
  const move = { fwd: 0, strafe: 0, scale: 1, sprint: false }; // reused every frame

  function updateWalking(dt) {
    const pos = player.pos;
    // Crouch is a toggle; standing back up waits until there's headroom.
    if (wantCrouch) player.crouched = true;
    else if (player.crouched && (noclip || canStand(pos, pos.y, boxesAround(pos.y, PLAYER_BODY.height)))) player.crouched = false;

    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    // Keys as before; with none pressed, the touch stick (analog, rim = sprint).
    combineMove(input('KeyW', 'ArrowUp') - input('KeyS', 'ArrowDown'), input('KeyD', 'ArrowRight') - input('KeyA', 'ArrowLeft'), shift, stick, move);
    const dir = wishDir(player.yaw, move.fwd, move.strafe);
    const carryingBattery = heldItemId() === ITEMS.CAR_BATTERY;
    const wantsSprint = !!dir && move.sprint && !player.crouched && !carryingBattery && !stam.exhausted && stam.stamina > 0;
    const speed = dir ? targetSpeed({ crouched: player.crouched, sprinting: wantsSprint, carryingBattery }, tuning.move) * move.scale * (noclip ? 2 : 1) : 0;

    // Accelerate toward the wanted velocity.
    const tx = dir ? dir.x * speed : 0;
    const tz = dir ? dir.z * speed : 0;
    const cx = tx - vel.x;
    const cz = tz - vel.z;
    const change = Math.hypot(cx, cz);
    const maxChange = tuning.move.accel * dt;
    const k = change > maxChange ? maxChange / change : 1;
    vel.x += cx * k;
    vel.z += cz * k;

    const before = { x: pos.x, z: pos.z };
    if (noclip) {
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      pos.y += (input('Space', 'Space') - input('KeyQ', 'KeyQ')) * 4 * dt;
      player.floorId = nearestFloor(pos.y);
    } else {
      const height = bodyHeight(player.crouched);
      const next = slideMove(pos, vel.x * dt, vel.z * dt, R, boxesAround(pos.y, height));
      const ground = world.heightAt(next.x, next.z, player.floorId);
      if (ground.y > pos.y + tuning.move.maxStep) {
        vel.x = vel.z = 0; // a ledge, not a step
      } else {
        pos.x = next.x;
        pos.z = next.z;
      }
      followGround(dt);
    }

    const moved = Math.hypot(pos.x - before.x, pos.z - before.z);
    player.moving = moved / Math.max(dt, 1e-6) > 0.2;
    player.sprinting = wantsSprint && player.moving;
    updateStamina(stam, player.sprinting, dt, tuning.stamina);
    player.stamina = stam.stamina;

    // Head bob and footsteps.
    bobPhase += moved * tuning.bob.freq;
    const amp = !player.moving ? 0 : player.crouched ? tuning.bob.crouch : player.sprinting ? tuning.bob.sprint : tuning.bob.walk;
    bobAmp = lerp(bobAmp, amp, Math.min(1, dt * 8));
    if (player.moving && !noclip) {
      stepTimer -= dt;
      if (stepTimer <= 0) {
        stepTimer = player.crouched ? tuning.steps.crouch : player.sprinting ? tuning.steps.sprint : tuning.steps.walk;
        footstep();
      }
    } else stepTimer = Math.min(stepTimer, 0.12); // the first step comes quickly
  }

  function followGround(dt) {
    const pos = player.pos;
    const ground = world.heightAt(pos.x, pos.z, player.floorId);
    if (ground.y < pos.y - 0.35 || fallSpeed > 0) {
      fallSpeed += tuning.move.gravity * dt;
      pos.y -= fallSpeed * dt;
      if (pos.y <= ground.y) {
        pos.y = ground.y;
        fallSpeed = 0;
      }
    } else pos.y = ground.y;
    player.floorId = ground.floorId;
  }

  function nearestFloor(y) {
    let best = player.floorId;
    let bestD = Infinity;
    for (const f of world.floors)
      if (Math.abs(y - f.y - 0.5) < bestD) {
        bestD = Math.abs(y - f.y - 0.5);
        best = f.id;
      }
    return best;
  }

  function footstep() {
    const { pos, floorId } = player;
    const surface = Math.abs(pos.y - (floorY[floorId] ?? pos.y)) > 0.05 ? 'stairs' : 'wood';
    bus.emit(EVENTS.FOOTSTEP, { pos: copy(pos), floorId, surface, sprint: player.sprinting, crouch: player.crouched });
    const loudness = player.crouched ? 0 : player.sprinting ? tuning.noise.sprintStep : tuning.noise.walkStep;
    if (loudness > 0) bus.emit(EVENTS.NOISE, { pos: copy(pos), floorId, loudness, kind: 'step' });
  }

  // ---- hiding -----------------------------------------------------------------
  function hide(spot) {
    if (player.hidden) return;
    blendCamera();
    player.hidden = true;
    player.hideSpotId = spot.id;
    player.pos = copy(spot.pos);
    player.floorId = spot.floorId;
    player.yaw = spot.yaw;
    player.pitch = 0;
    vel.x = vel.z = 0;
    player.moving = player.sprinting = false;
    bus.emit(EVENTS.HIDE, { spotId: spot.id, pos: copy(spot.pos), floorId: spot.floorId });
  }

  function unhide() {
    const spot = hideSpot();
    if (!spot) return;
    blendCamera();
    player.hidden = false;
    player.hideSpotId = null;
    player.pos = copy(spot.exitPos);
    player.floorId = spot.floorId;
    const ground = world.heightAt(spot.exitPos.x, spot.exitPos.z, spot.floorId);
    player.pos.y = ground.y;
    player.floorId = ground.floorId;
    bus.emit(EVENTS.UNHIDE, { spotId: spot.id });
  }

  // ---- slides and tunnels -------------------------------------------------------
  let riding = null;

  function ride(link, reverse = false) {
    if (riding || player.hidden) return;
    const follower = createPathFollower(link.points, reverse);
    const slide = link.kind === 'slide';
    riding = {
      link,
      follower,
      slide,
      speed: slide ? tuning.link.slideStart : tuning.link.crawlSpeed,
      startFloor: (reverse ? link.to : link.from).floorId,
      endFloor: (reverse ? link.from : link.to).floorId,
    };
    if (link.crawl) player.crouched = wantCrouch = true;
    vel.x = vel.z = 0;
    player.sprinting = false;
    player.onLink = { linkId: link.id, kind: link.kind };
    blendCamera();
    const first = follower.sample(0.01);
    player.yaw = yawOf(first.dir);
    player.pitch = slide ? -0.25 : -0.05;
    bus.emit(EVENTS.LINK_ENTER, { linkId: link.id, kind: link.kind });
  }

  function updateRide(dt) {
    const r = riding;
    if (r.slide) r.speed = Math.min(tuning.link.slideMax, r.speed + tuning.link.slideAccel * dt);
    const s = r.follower.advance(r.speed * dt);
    player.pos = s.pos;
    player.floorId = r.follower.progress() > 0.5 ? r.endFloor : r.startFloor;
    player.moving = true;
    bobPhase += r.speed * dt * tuning.bob.freq;
    bobAmp = lerp(bobAmp, r.slide ? 0.01 : tuning.bob.crouch, Math.min(1, dt * 8));
    if (s.done) finishRide();
  }

  function finishRide() {
    const { link, follower, endFloor, slide } = riding;
    riding = null;
    player.onLink = null;
    const end = copy(follower.end);
    const ground = world.heightAt(end.x, end.z, endFloor);
    const free = pushOut(end, R, boxesAround(ground.y, bodyHeight(player.crouched), end.x, end.z));
    player.pos = { x: free.x, y: ground.y, z: free.z };
    player.floorId = ground.floorId;
    player.moving = false;
    if (slide) player.pitch = 0;
    bus.emit(EVENTS.LINK_EXIT, { linkId: link.id, kind: link.kind, pos: copy(player.pos), floorId: player.floorId });
    if (slide) bus.emit(EVENTS.NOISE, { pos: copy(player.pos), floorId: player.floorId, loudness: tuning.noise.splash, kind: 'splash' });
  }

  // ---- camera -----------------------------------------------------------------
  let blend = null; // {from: Vec3, t: 0..1}: eases the camera into/out of hide spots and links

  function blendCamera(seconds = 0.3) {
    blend = { from: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, t: 0, rate: 1 / seconds };
  }

  function placeCamera(dt) {
    const eye = player.eyePos();
    const bob = player.hidden ? 0 : bobAmp;
    const s = Math.sin(bobPhase * Math.PI * 2);
    const side = Math.sin(bobPhase * Math.PI) * bob * 0.6;
    let x = eye.x + Math.cos(player.yaw) * side;
    let y = eye.y + s * bob;
    let z = eye.z - Math.sin(player.yaw) * side;
    if (blend) {
      blend.t = Math.min(1, blend.t + dt * blend.rate);
      const e = blend.t * blend.t * (3 - 2 * blend.t);
      ({ x, y, z } = lerpV(blend.from, { x, y, z }, e));
      if (blend.t >= 1) blend = null;
    }
    camera.position.set(x, y, z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }

  // ---- per frame --------------------------------------------------------------
  function update(dt) {
    if (!enabled) return;
    if (riding) updateRide(dt);
    else if (!player.hidden) updateWalking(dt);
    const target = riding ? (riding.slide ? tuning.link.slideEye : tuning.link.crawlEye) : player.crouched ? PLAYER_BODY.crouchEyeHeight : PLAYER_BODY.eyeHeight;
    eyeH = lerp(eyeH, target, Math.min(1, dt * 10));
    placeCamera(dt);
  }

  function setEnabled(on) {
    if (on === enabled) return;
    enabled = on;
    keys.clear();
    vel.x = vel.z = 0;
    player.moving = player.sprinting = false;
    if (on) {
      // Pick up where the cutscene left the camera, if it ended near the eye.
      const eye = player.eyePos();
      const near = Math.hypot(camera.position.x - eye.x, camera.position.y - eye.y, camera.position.z - eye.z) < 1.5;
      if (near && !player.hidden && !riding) {
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        player.yaw = e.y;
        player.pitch = e.x;
        clampLook();
        blendCamera(0.25);
      }
    }
  }

  /** Put the player somewhere, cancelling hiding and rides (startDay, teleport). */
  function placeAt(pos, floorId, yaw = player.yaw) {
    riding = null;
    player.onLink = null;
    player.hidden = false;
    player.hideSpotId = null;
    player.pos = copy(pos);
    player.floorId = floorId;
    player.yaw = yaw;
    player.pitch = 0;
    vel.x = vel.z = 0;
    fallSpeed = 0;
    blend = null;
    eyeH = player.crouched ? PLAYER_BODY.crouchEyeHeight : PLAYER_BODY.eyeHeight;
    const eye = player.eyePos();
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }

  /** Start of a day: in bed, standing, rested, light off. */
  function wake(spot) {
    player.crouched = wantCrouch = false;
    stam.stamina = 1;
    stam.exhausted = false;
    player.stamina = 1;
    setFlashlight(false);
    placeAt(spot.pos, spot.floorId, spot.rotY ?? 0);
  }

  /** Unit look direction. */
  function forward() {
    const cp = Math.cos(player.pitch);
    return { x: -Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('visibilitychange', onVisibility);
    camera.remove(flashlight, flashlight.target);
    flashlight.dispose();
  }

  return {
    player,
    update,
    setEnabled,
    isEnabled: () => enabled,
    requestPointerLock,
    exitPointerLock,
    look,
    touchLook,
    toggleCrouch,
    toggleFlashlight,
    requestPause,
    stick,
    hide,
    unhide,
    ride,
    isRiding: () => !!riding,
    cancelRide: () => {
      riding = null;
      player.onLink = null;
    },
    placeAt,
    wake,
    forward,
    boxesAround,
    setNoclip: (on) => (noclip = !!on),
    isNoclip: () => noclip,
    setFlashlight,
    keys,
    bob: () => ({ phase: bobPhase, amp: bobAmp }),
    dispose,
  };
}
