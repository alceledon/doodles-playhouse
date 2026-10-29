// STUB Gameplay: a bare first-person controller so the game loop runs end to
// end before the real src/gameplay/ lands. Also the "target" the Doodle dev
// page drives around. No items or locks: use debug.openAllLocks() then walk
// out the front door (or the garage door) to escape.
//
// Keys: WASD move, mouse look, Shift sprint, C crouch, F flashlight,
//       E / left click interact, N make a loud noise (for testing the Doodle).

import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { PLAYER_BODY, SETTINGS_DEFAULTS } from '../contracts.js';
import { circleHitsBox2D, copy } from '../math.js';

const REACH = 2.2;

/** createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings }) → Gameplay */
export function createGameplay({ scene, camera, canvas, world, bus, settings = SETTINGS_DEFAULTS }) {
  let sensitivity = settings.mouseSensitivity;
  let invertY = settings.invertY;
  bus.on(EVENTS.SETTINGS_CHANGED, ({ settings: s }) => {
    sensitivity = s.mouseSensitivity;
    invertY = s.invertY;
  });

  const start = world.anchors.startBed;
  const player = {
    id: 'host',
    pos: copy(start.pos),
    floorId: start.floorId,
    yaw: start.rotY ?? 0,
    pitch: 0,
    crouched: false,
    sprinting: false,
    hidden: false,
    hideSpotId: null,
    flashlightOn: false,
    held: null,
    stamina: 1,
    moving: false,
    eyePos: () => (player.hidden ? copy(hideSpot().eyePos) : { x: player.pos.x, y: player.pos.y + eyeHeight(), z: player.pos.z }),
    visibility() {
      if (player.hidden) return 0;
      const light = world.lightLevelAt(player.eyePos(), player.floorId);
      return Math.min(1, (player.flashlightOn ? 0.6 : 0) + light) * (player.crouched ? 0.6 : 1);
    },
  };
  const eyeHeight = () => (player.crouched ? PLAYER_BODY.crouchEyeHeight : PLAYER_BODY.eyeHeight);
  const hideSpot = () => world.anchors.hideSpots.find((h) => h.id === player.hideSpotId);

  const flashlight = new THREE.SpotLight(0xfff2d0, 0, 14, 0.45, 0.5, 1.5);
  flashlight.position.set(0, 0, 0);
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight, flashlight.target);

  // ---- input ----------------------------------------------------------------
  const keys = new Set();
  let controls = false;
  let noclip = false;
  const onKeyDown = (e) => {
    if (!controls) return;
    keys.add(e.code);
    if (e.code === 'KeyF') {
      player.flashlightOn = !player.flashlightOn;
      flashlight.intensity = player.flashlightOn ? 8 : 0;
    }
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyN') bus.emit(EVENTS.NOISE, { pos: copy(player.pos), floorId: player.floorId, loudness: 12, kind: 'other' });
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onMouseMove = (e) => {
    if (!controls || document.pointerLockElement !== canvas) return;
    const k = 0.0022 * sensitivity;
    player.yaw -= e.movementX * k;
    player.pitch -= e.movementY * k * (invertY ? -1 : 1);
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  };
  const onMouseDown = (e) => {
    if (!controls) return;
    if (document.pointerLockElement !== canvas) return requestPointerLock();
    if (e.button === 0) interact();
  };
  const onLockChange = () => {
    if (controls && document.pointerLockElement !== canvas) bus.emit(EVENTS.PAUSE_REQUEST, {});
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('pointerlockchange', onLockChange);

  function requestPointerLock() {
    try {
      const p = canvas.requestPointerLock?.();
      p?.catch?.(() => {}); // re-locking too soon after Esc is refused; the next click retries
    } catch {}
  }

  // ---- interaction ----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  let lastPrompt;
  function target() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hit = raycaster.intersectObjects(world.interactables, false).find((h) => h.object.visible);
    return hit?.object.userData.interact ?? null;
  }
  function promptFor(t) {
    if (player.hidden) return 'E: stop hiding';
    if (!t) return null;
    if (t.kind === 'door') {
      const d = world.doors.find((x) => x.id === t.id);
      return d.locked ? 'Locked' : d.isOpen ? 'E: close door' : 'E: open door';
    }
    if (t.kind === 'container') {
      const c = world.containers.find((x) => x.id === t.id);
      return c.locked ? 'Locked' : c.isOpen ? 'E: close' : 'E: open';
    }
    if (t.kind === 'hide') return 'E: hide';
    if (t.kind === 'linkEntry') return 'E: go through';
    return `(stub) ${t.kind}`;
  }
  function interact() {
    if (player.hidden) {
      const h = hideSpot();
      player.hidden = false;
      player.hideSpotId = null;
      player.pos = copy(h.exitPos);
      player.floorId = h.floorId;
      bus.emit(EVENTS.UNHIDE, { spotId: h.id });
      return;
    }
    const t = target();
    if (!t) return;
    if (t.kind === 'door') {
      const d = world.doors.find((x) => x.id === t.id);
      d.setOpen(!d.isOpen, 'player');
    } else if (t.kind === 'container') {
      const c = world.containers.find((x) => x.id === t.id);
      c.setOpen(!c.isOpen);
    } else if (t.kind === 'hide') {
      const h = world.anchors.hideSpots.find((x) => x.id === t.id);
      player.hidden = true;
      player.hideSpotId = h.id;
      player.yaw = h.yaw;
      player.pitch = 0;
      bus.emit(EVENTS.HIDE, { spotId: h.id, pos: copy(h.pos), floorId: h.floorId });
    } else if (t.kind === 'linkEntry') {
      const link = world.nav.links.find((l) => l.id === t.id);
      const pts = link.points;
      const fromStart = Math.hypot(player.pos.x - pts[0].x, player.pos.z - pts[0].z) < Math.hypot(player.pos.x - pts.at(-1).x, player.pos.z - pts.at(-1).z);
      if (!fromStart && link.oneWay) return;
      const end = fromStart ? pts.at(-1) : pts[0];
      const endRef = fromStart ? link.to : link.from;
      bus.emit(EVENTS.LINK_ENTER, { linkId: link.id, kind: link.kind });
      player.pos = copy(end);
      player.floorId = endRef.floorId;
      bus.emit(EVENTS.LINK_EXIT, { linkId: link.id, kind: link.kind, pos: copy(end), floorId: endRef.floorId });
      if (link.kind === 'slide') bus.emit(EVENTS.NOISE, { pos: copy(end), floorId: endRef.floorId, loudness: 9, kind: 'splash' });
    }
  }

  // ---- movement -------------------------------------------------------------
  let stepTimer = 0;
  function blocked(x, z, y, height) {
    for (const b of world.colliders(player.floorId))
      if (b.minY < y + height && b.maxY > y + 0.05 && circleHitsBox2D(x, z, PLAYER_BODY.radius, b)) return true;
    return false;
  }

  function update(dt) {
    if (!controls) return;
    if (!player.hidden) {
      player.crouched = keys.has('KeyC');
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      player.moving = fwd !== 0 || strafe !== 0;
      player.sprinting = player.moving && !player.crouched && keys.has('ShiftLeft') && player.stamina > 0;
      const speed = player.crouched ? 1.5 : player.sprinting ? 5 : 3;
      player.stamina = Math.max(0, Math.min(1, player.stamina + (player.sprinting ? -dt / 4 : dt / 6)));
      if (player.moving) {
        const sin = Math.sin(player.yaw);
        const cos = Math.cos(player.yaw);
        const len = Math.hypot(fwd, strafe);
        const vx = ((-sin * fwd + cos * strafe) / len) * speed * dt;
        const vz = ((-cos * fwd - sin * strafe) / len) * speed * dt;
        const height = player.crouched ? PLAYER_BODY.crouchHeight : PLAYER_BODY.height;
        if (noclip || !blocked(player.pos.x + vx, player.pos.z, player.pos.y, height)) player.pos.x += vx;
        if (noclip || !blocked(player.pos.x, player.pos.z + vz, player.pos.y, height)) player.pos.z += vz;
        if (noclip) {
          if (keys.has('Space')) player.pos.y += 4 * dt;
          if (keys.has('KeyQ')) player.pos.y -= 4 * dt;
        }
        stepTimer -= dt;
        if (stepTimer <= 0) {
          stepTimer = player.sprinting ? 0.3 : 0.5;
          bus.emit(EVENTS.FOOTSTEP, { pos: copy(player.pos), floorId: player.floorId, surface: 'wood', sprint: player.sprinting, crouch: player.crouched });
          if (player.sprinting) bus.emit(EVENTS.NOISE, { pos: copy(player.pos), floorId: player.floorId, loudness: 7, kind: 'step' });
        }
      }
      if (!noclip) {
        const h = world.heightAt(player.pos.x, player.pos.z, player.floorId);
        player.pos.y = h.y;
        player.floorId = h.floorId;
      }
      checkEscape();
    }
    const eye = player.eyePos();
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    const text = promptFor(target());
    if (text !== lastPrompt) {
      lastPrompt = text;
      bus.emit(EVENTS.PROMPT, { text });
    }
  }

  function checkEscape() {
    const front = world.doors.find((d) => d.id === world.anchors.frontDoor.doorId);
    const garage = world.doors.find((d) => d.id === world.anchors.garage.doorId);
    const out = (door, spot) => door.isOpen && Math.hypot(player.pos.x - spot.pos.x, player.pos.z - spot.pos.z) < Math.hypot(door.pos.x - spot.pos.x, door.pos.z - spot.pos.z) - 0.4;
    if (out(front, world.anchors.frontDoor.exit)) bus.emit(EVENTS.ESCAPED, { route: 'frontDoor' });
    else if (out(garage, world.anchors.garage.exit)) bus.emit(EVENTS.ESCAPED, { route: 'garage' });
  }

  return {
    player,
    update,
    startDay() {
      player.pos = copy(start.pos);
      player.floorId = start.floorId;
      player.yaw = start.rotY ?? 0;
      player.pitch = 0;
      player.hidden = false;
      player.hideSpotId = null;
      player.stamina = 1;
      const eye = player.eyePos();
      camera.position.set(eye.x, eye.y, eye.z);
      camera.rotation.set(0, player.yaw, 0, 'YXZ');
    },
    onCaught() {
      if (player.held) bus.emit(EVENTS.DROP, { itemId: player.held, pos: copy(player.pos), floorId: player.floorId });
      player.held = null;
      bus.emit(EVENTS.HELD, { itemId: null, uses: null });
    },
    setControlsEnabled(enabled) {
      controls = enabled;
      if (!enabled) keys.clear();
    },
    requestPointerLock,
    exitPointerLock: () => document.pointerLockElement && document.exitPointerLock(),
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('pointerlockchange', onLockChange);
      camera.remove(flashlight, flashlight.target);
    },
    debug: {
      giveItem(id) {
        player.held = id;
        bus.emit(EVENTS.HELD, { itemId: id, uses: null });
      },
      setNoclip: (on) => (noclip = on),
      teleport(pos, floorId) {
        player.pos = copy(pos);
        player.floorId = floorId;
      },
      openAllLocks() {
        for (const id of [world.anchors.frontDoor.doorId, world.anchors.garage.doorId]) world.doors.find((d) => d.id === id).setLocked(false);
      },
      keypadCode: () => '0000',
    },
  };
}
