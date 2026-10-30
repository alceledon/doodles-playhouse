// Gameplay entry point: createGameplay() wires the player controller, the
// rules (items, locks, escapes, traps, defenses), the world-side view and the
// held-item view model into the Gameplay object from contracts.js.
//
//   rules.js       what everything means (pure, tested)
//   ../player/     input, movement, camera, hiding, slides and tunnels, touch controls,
//                  and in co-op the partner (remote.js) and their avatar (avatar.js)
//   view.js        meshes for items, lock hardware, code digits, traps, ball, darts
//   viewmodel.js   the item in your hand
//
// Co-op (`coop: {role, rule}`, docs/CONTRACTS.md "Co-op"): the host runs every
// rule for both players; the guest mirrors the host's snapshots and sends its
// clicks as intents. See README.md for both formats.

import * as THREE from 'three';
import { EVENTS } from '../core/events.js';
import { ITEM_IDS, ITEMS, LOCKS, SETTINGS_DEFAULTS, STOREY_HEIGHT } from '../core/contracts.js';
import { copy } from '../core/math.js';
import { circleHitsAny } from '../player/movement.js';
import { createPlayerController } from '../player/controller.js';
import { createTouchControls } from '../player/touch.js';
import { createRemotePlayer, makePose } from '../player/remote.js';
import { createAvatar } from '../player/avatar.js';
import { tuningFor } from './tuning.js';
import { createRules, wakeSpot } from './rules.js';
import { firstBoxHit, isOccluded } from './raycast.js';
import { createGameplayView } from './view.js';
import { createViewModel } from './viewmodel.js';

/** How long a guest's prompt shows "…" waiting for the host before giving up. */
const PENDING_SECONDS = 3;

const taggedAncestor = (o) => {
  for (let n = o; n; n = n.parent) if (n.userData?.interact) return n;
  return null;
};
const visibleDeep = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const sameTarget = (a, b) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id && a.dial === b.dial);

/** createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings, coop? }) → Gameplay */
export function createGameplay({ scene, camera, canvas, world, bus, rng, difficulty = 'normal', settings = SETTINGS_DEFAULTS, coop = null }) {
  const tuning = tuningFor(difficulty);
  const debugKeys = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  const role = coop ? (coop.role === 'guest' ? 'guest' : 'host') : null;
  const isGuest = role === 'guest';
  const localId = role ?? 'host';
  const partnerId = localId === 'host' ? 'guest' : 'host';
  const rules = createRules({ world, bus, rng, difficulty, tuning, coop: role ? { role, rule: coop.rule } : null });
  const garageDoor = rules.locks.garageDoor();
  const bed = wakeSpot(world, localId);

  const controller = createPlayerController({
    camera, canvas, world, bus, tuning, settings: { ...SETTINGS_DEFAULTS, ...settings },
    // You only leave through the garage in the Jeep: its doorway stays solid on foot.
    extraBlockers: () => (garageDoor?.isOpen ? [garageDoor.collider] : []),
    heldItemId: () => rules.items.heldItemId(),
    onPrimary: primary,
    onSecondary: secondary,
    onDrop: dropHeld,
    onKey: debugKey,
    id: localId,
    start: bed,
  });
  const player = controller.player;
  const view = createGameplayView({ scene, camera, world, rules, tuning, bus });
  const viewModel = createViewModel({ camera, kit: view.kit });
  // Shown only in touch mode (core/device.js); under the UI layer so menus cover it.
  const touch = createTouchControls({
    mount: canvas.parentElement ?? document.body,
    controller,
    bus,
    heldItemId: () => rules.items.heldItemId(),
    actions: {
      interact: () => primary(),
      use: () => secondary(),
      drop: () => dropHeld(),
      tap: (x, y) => tapAt(x, y),
      pause: () => controller.requestPause(),
    },
  });

  // ---- the co-op partner ---------------------------------------------------------------
  const partner = role ? createRemotePlayer({ world, tuning, id: partnerId, heldItemId: () => rules.items.heldItemId(partnerId) }) : null;
  const remote = partner?.player ?? null;
  const avatar = role ? createAvatar({ scene, kit: view.kit, tuning, role: partnerId }) : null;
  const partnerHere = () => !!partner?.isPresent();
  rules.setBodies(() => (partnerHere() ? [player, remote] : [player]));

  // ---- what you're looking at -----------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const rayO = new THREE.Vector3();
  const rayD = new THREE.Vector3();
  let target = null;

  function findTarget() {
    if (player.hidden || player.down || controller.isRiding()) return null;
    return targetAlong(player.eyePos(), controller.forward());
  }

  /** The usable thing a ray from `eye` along unit `dir` hits first: in reach and not behind a wall. */
  function targetAlong(eye, dir) {
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

  // A touch tap aims through the tapped pixel instead of the screen center.
  const tapCaster = new THREE.Raycaster();
  const tapNdc = new THREE.Vector2();
  /** Tap at client (x, y): interact with what's under it if it's in reach. Returns true if it did something. */
  function tapAt(x, y) {
    if (!controller.isEnabled() || controller.isRiding() || player.down) return false;
    if (player.hidden) {
      controller.unhide(); // like a click while hidden: the prompt says "Tap: stop hiding"
      return true;
    }
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    tapNdc.set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
    camera.updateMatrixWorld();
    tapCaster.setFromCamera(tapNdc, camera);
    const hit = targetAlong(tapCaster.ray.origin, tapCaster.ray.direction);
    if (!hit) return false;
    act('primary', hit);
    return true;
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
    if (pending) return setPrompt('…');
    if (messageLeft > 0) return setPrompt(message);
    if (player.hidden) return setPrompt('Click: stop hiding');
    if (controller.isRiding()) return setPrompt(null);
    setPrompt(rules.describe(target, player));
  }

  // ---- co-op guest: intents ------------------------------------------------------------
  let intentSink = null;
  let intentCount = 0;
  let pending = null; // {n, left}: an intent the host hasn't answered yet
  let answered = 0; // the last intent number whose answer we've shown

  /** What the host needs to run an action for this body (see README: intents). */
  function intentBody() {
    const eye = player.eyePos();
    const dir = controller.forward();
    return {
      pos: copy(player.pos),
      floorId: player.floorId,
      crouched: player.crouched,
      eye,
      dir,
      drop: floorAhead(0.45),
      treat: floorAhead(0.6),
      range: dartRange(eye, dir),
    };
  }

  function sendIntent(kind, t) {
    if (!intentSink) return;
    const n = ++intentCount;
    pending = { n, left: PENDING_SECONDS };
    intentSink({ n, kind, target: t ? { kind: t.kind, id: t.id, ...(t.dial != null ? { dial: t.dial } : {}) } : null, body: intentBody() });
  }

  // ---- actions ----------------------------------------------------------------------------
  function primary() {
    if (!controller.isEnabled() || player.down) return;
    if (player.hidden) return controller.unhide();
    if (controller.isRiding()) return;
    act('primary', target ?? findTarget());
  }

  function secondary() {
    if (!controller.isEnabled() || player.hidden || player.down || controller.isRiding()) return;
    act('secondary', target ?? findTarget());
  }

  /** Run a click here, or (co-op guest) send it to the host when it changes shared state. */
  function act(kind, t) {
    if (isGuest && rules.needsHost(kind, t, player)) {
      // A throw, shot or treat shows in your hand at once; the host's answer follows.
      const own = kind === 'secondary' && !rules.acceptsHeld(t, player) && !(t?.kind === 'lock' && t.id === LOCKS.KEYPAD);
      const anim = { [ITEMS.TENNIS_BALL]: 'throw', [ITEMS.LAUNCHER]: 'fire', [ITEMS.TREATS]: 'drop' }[rules.items.heldItemId()];
      if (own && anim) viewModel.play(anim);
      return sendIntent(kind, t);
    }
    handle(kind === 'secondary' ? rules.useHeld(t, player) : rules.interact(t, player));
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

  /** How far a dart from the eye flies before the first wall, floor or ceiling. */
  function dartRange(eye, dir) {
    let range = tuning.dart.range;
    const wall = firstBoxHit(eye, dir, controller.boxesAround(player.pos.y, 2.6, eye.x, eye.z, range), range);
    if (wall) range = wall.t;
    // Floors and ceilings aren't boxes: stop at those planes too.
    const floor = player.pos.y;
    if (dir.y < -1e-3) range = Math.min(range, (eye.y - floor) / -dir.y);
    if (dir.y > 1e-3) range = Math.min(range, (floor + STOREY_HEIGHT - 0.1 - eye.y) / dir.y);
    return range;
  }

  function dropHeld() {
    if (!controller.isEnabled() || player.hidden || player.down || controller.isRiding() || !rules.items.held()) return;
    if (isGuest) {
      viewModel.play('drop');
      return sendIntent('drop', null);
    }
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
    if (rules.perform('throw', { pos: copy(player.pos), floorId: player.floorId, eye: player.eyePos(), dir: controller.forward() })) viewModel.play('throw');
  }

  function fireDart() {
    const eye = player.eyePos();
    const dir = controller.forward();
    if (rules.fireDart(eye, dir, dartRange(eye, dir), player.floorId)) viewModel.play('fire');
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

  /** Feet on the floor under a body (a caught player's item lands here). */
  function feetOf(p) {
    const g = world.heightAt(p.pos.x, p.pos.z, p.floorId);
    return { pos: { x: p.pos.x, y: g.y, z: p.pos.z }, floorId: g.floorId };
  }

  // ---- per frame -----------------------------------------------------------------------------
  function update(dt) {
    // World-side motion (ball, darts, falling locks) carries on during cutscenes.
    rules.update(dt);
    view.update(dt);
    if (partner) {
      partner.update(dt);
      avatar.update(dt, remote, partnerHere());
      // The host runs the partner's body too, even while its own player is frozen or spectating.
      if (!isGuest && partnerHere() && !remote.down && !remote.hidden && !remote.onLink) {
        const fired = rules.updateTraps(remote);
        if (fired.length) view.trapsFired(fired);
        rules.walkOut(remote);
      }
    }
    if (pending && (pending.left -= dt) <= 0) pending = null;
    if (!controller.isEnabled()) {
      viewModel.update(dt, rules.items.heldItemId(), false);
      return;
    }
    controller.update(dt);
    if (!player.hidden && !player.down && !controller.isRiding()) {
      const fired = rules.updateTraps(player);
      if (fired.length) view.trapsFired(fired);
      rules.walkOut(player);
    }
    target = findTarget();
    updatePrompt(dt);
    viewModel.update(dt, rules.items.heldItemId(), !player.hidden && !player.down, controller.bob());
    touch.update();
  }

  function startDay() {
    controller.wake(bed);
    // The host keeps traps under the guest's bed quiet too.
    const guestBed = role === 'host' ? wakeSpot(world, 'guest') : null;
    rules.startDay(guestBed ? [{ pos: guestBed.pos, floorId: guestBed.floorId, playerId: 'guest' }] : []);
    view.resetDay();
    target = null;
    messageLeft = 0;
    pending = null;
    setPrompt(null);
  }

  /** Caught: the player's held item falls where they were. In co-op the host also does this for the guest. */
  function onCaught(playerId = localId) {
    if (playerId !== localId) {
      if (remote && !isGuest) {
        const at = feetOf(remote);
        rules.onCaught(at.pos, at.floorId, playerId);
      }
      return;
    }
    // The held item falls where you were (in front of the hide spot if you were pulled out).
    const at = feetOf(player);
    rules.onCaught(at.pos, at.floorId);
    if (player.hidden) controller.unhide();
    controller.cancelRide();
  }

  function setControlsEnabled(enabled) {
    controller.setEnabled(enabled);
    touch.setEnabled(enabled); // hidden with the HUD during menus and cutscenes
    if (!enabled) {
      messageLeft = 0;
      setPrompt(null);
    }
  }

  // ---- co-op hooks ---------------------------------------------------------------------------
  /** Knock-out: a down player can't act and drops what they held (the host drops it, for either). */
  function setDown(playerId, down) {
    const isLocal = playerId === localId;
    const body = isLocal ? player : remote;
    if (!body) return;
    if (down) onCaught(playerId);
    if (isLocal) {
      player.down = !!down;
      if (down) {
        pending = null;
        setPrompt(null);
      }
    } else partner.setDown(down);
  }

  function applySnapshot(snap) {
    const before = rules.items.held();
    const changed = rules.applySnapshot(snap);
    const after = rules.items.held();
    if (after && after !== before) viewModel.play('pickup');
    const answer = rules.answer(localId);
    if (answer && answer.n > answered) {
      answered = answer.n;
      if (pending && answer.n >= pending.n) pending = null;
      if (answer.say) showMessage(answer.say);
    }
    return changed;
  }

  const debug = {
    giveItem(id) {
      const at = feetOf(player);
      rules.giveItem(id, at.pos, at.floorId);
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
    partner,
    avatar,
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
    /** A touch tap at client (x, y), as touch.js sends it. */
    tap: (x, y) => tapAt(x, y),
    touch,
  };

  const gameplay = {
    player,
    /** co-op: the partner while they're here (null solo, before their first pose, and after they leave) */
    get remote() {
      return partnerHere() ? remote : null;
    },
    update,
    startDay,
    onCaught,
    setControlsEnabled,
    requestPointerLock: () => controller.requestPointerLock(),
    exitPointerLock: () => controller.exitPointerLock(),
    dispose() {
      avatar?.dispose();
      touch.dispose();
      controller.dispose();
      viewModel.dispose();
      view.dispose();
    },
    debug,
  };
  if (role) {
    Object.assign(gameplay, {
      pose: () => makePose({ ...player, held: rules.items.heldItemId(), onLink: !!player.onLink }),
      setRemotePose: (pose) => partner.setPose(pose),
      setDown,
    });
    if (isGuest)
      Object.assign(gameplay, {
        applySnapshot,
        setIntentSink: (fn) => (intentSink = typeof fn === 'function' ? fn : null),
      });
    else
      Object.assign(gameplay, {
        snapshot: () => rules.snapshot(),
        // Before the guest's first pose lands the intent's own body is all there is to go on.
        applyIntent: (playerId, intent) => rules.applyIntent(playerId, intent, partnerHere() ? remote : null),
      });
  }
  return gameplay;
}
