// The co-op partner as a Player (contracts.js), built from the poses their game
// sends (~10 Hz). Pure logic, no three: it eases toward the newest pose so the
// avatar and Doodle's senses don't jump, and computes eyePos() and visibility()
// the same way the local player does.

import { PLAYER_BODY } from '../core/contracts.js';
import { angleDiff, clamp, copy, dist } from '../core/math.js';

/** Farther than this from the last shown spot and the partner just appears at the new one (a wake, a ride's end). */
const SNAP_DISTANCE = 2.5;
/** How fast the shown pose catches up with the newest one (1/s). */
const FOLLOW_RATE = 12;

/** How easy a body is to see: 0 hidden; else the lamp light at its eyes, plus the flashlight, less crouched. */
export function bodyVisibility(body, world, tuning) {
  if (body.hidden) return 0;
  const light = world.lightLevelAt(body.eyePos(), body.floorId);
  const v = light + (body.flashlightOn ? tuning.flashlight.visibility : 0);
  return clamp(v * (body.crouched ? tuning.crouchVisibility : 1), 0, 1);
}

/** A PlayerPose (contracts.js) rounded for the wire: centimeters, centiradians. */
export function makePose(p) {
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    id: p.id,
    pos: { x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z) },
    floorId: p.floorId,
    yaw: r2(p.yaw),
    pitch: r2(p.pitch),
    crouched: !!p.crouched,
    sprinting: !!p.sprinting,
    moving: !!p.moving,
    hidden: !!p.hidden,
    hideSpotId: p.hideSpotId ?? null,
    flashlightOn: !!p.flashlightOn,
    held: p.held ?? null,
    onLink: !!p.onLink,
    down: !!p.down,
  };
}

/**
 * @param {{world: Object, tuning: Object, id: 'host'|'guest', heldItemId?: () => string|null}} opts
 *   heldItemId: the partner's hand as the shared item state has it (better than their pose's)
 */
export function createRemotePlayer({ world, tuning, id, heldItemId = null }) {
  let latest = null; // the newest pose
  let present = false;
  let down = false; // knock-out, set here by setDown (a pose's `down` only adds to it)

  const hideSpot = () => (player.hideSpotId ? world.anchors.hideSpots.find((h) => h.id === player.hideSpotId) : null);

  const player = {
    id,
    pos: copy(world.anchors.startBed.pos),
    floorId: world.anchors.startBed.floorId,
    yaw: 0,
    pitch: 0,
    crouched: false,
    sprinting: false,
    hidden: false,
    hideSpotId: null,
    flashlightOn: false,
    get held() {
      return heldItemId ? heldItemId() : latest?.held ?? null;
    },
    stamina: 1,
    moving: false,
    onLink: false,
    get down() {
      return down || !!latest?.down || !present;
    },
    eyePos() {
      const h = hideSpot();
      if (h) return copy(h.eyePos);
      const eye = player.crouched ? PLAYER_BODY.crouchEyeHeight : player.onLink ? tuning.link.slideEye : PLAYER_BODY.eyeHeight;
      return { x: player.pos.x, y: player.pos.y + eye, z: player.pos.z };
    },
    visibility: () => (present ? bodyVisibility(player, world, tuning) : 0),
  };

  /** The partner's newest pose; null = they left (hidden from Doodle and drawn nowhere). */
  function setPose(pose) {
    if (!pose) {
      present = false;
      latest = null;
      player.hidden = true;
      player.hideSpotId = null;
      return;
    }
    const first = !present;
    latest = pose;
    present = true;
    for (const k of ['crouched', 'sprinting', 'moving', 'hidden', 'flashlightOn', 'onLink']) player[k] = !!pose[k];
    player.hideSpotId = pose.hideSpotId ?? null;
    player.floorId = pose.floorId ?? player.floorId;
    // Jumps (and hiding, which moves you into the prop) show at once; walking is eased in update().
    if (first || pose.hidden || dist(player.pos, pose.pos) > SNAP_DISTANCE) {
      player.pos = copy(pose.pos);
      player.yaw = pose.yaw;
      player.pitch = pose.pitch;
    }
  }

  function update(dt) {
    if (!latest) return;
    const k = 1 - Math.exp(-FOLLOW_RATE * dt);
    const p = latest.pos;
    player.pos = { x: player.pos.x + (p.x - player.pos.x) * k, y: player.pos.y + (p.y - player.pos.y) * k, z: player.pos.z + (p.z - player.pos.z) * k };
    player.yaw += angleDiff(player.yaw, latest.yaw) * k;
    player.pitch += (latest.pitch - player.pitch) * k;
  }

  return {
    player,
    setPose,
    update,
    setDown: (on) => (down = !!on),
    isPresent: () => present,
    pose: () => latest,
  };
}
