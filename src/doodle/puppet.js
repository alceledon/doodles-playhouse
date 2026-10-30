// The co-op guest's Doodle: no brain, just the host's Doodle redrawn from its
// snapshots (brain.js#snapshot, ~10 Hz). Pure logic like the brain; index.js
// adds the same model on top.
//
// It never touches the bus: the host's Doodle already emitted everything, and
// the net layer replays what the guest should hear.

import { DOODLE_STATES as S } from '../core/contracts.js';
import { angleDiff, copy } from '../core/math.js';

const FOLLOW = 14; // 1/s: how fast the drawn Doodle closes on where it should be
const LEAD_MAX = 0.15; // s it extrapolates a snapshot along the Doodle's velocity, at most
const MAX_SPEED = 9; // m/s: the lunge is 7.5 at most
const SNAP_DIST = 3; // m: farther than this from the snapshot, jump straight there
const SNAP_FLOOR_DIST = 1; // m: a floor change this far away jumps (stairs flip floorId mid-ramp, so a near one glides)

/**
 * @param {{world: Object}} opts
 * @returns {Object} the contract's Doodle, minus `model`
 */
export function createDoodlePuppet({ world }) {
  const kennel = world.anchors.kennel;
  const doodle = {
    pos: copy(kennel.pos),
    floorId: kennel.floorId,
    yaw: kennel.rotY ?? 0,
    pitch: 0,
    state: S.SLEEP,
    speed: 0,
    pose: 'sleep',
    mood: 'calm',
    carrying: null,
    puppet: true,
    bounds,
    update,
    reset,
    setActive,
    applySnapshot,
    snapshot,
    stun() {}, // the host decides darts
    releaseCatch() {}, // ...and catches
    dispose() {},
    get active() {
      return active;
    },
    debug: { path: [], target: null, senses: {} },
  };

  let active = false;
  let snap = null; // latest snapshot, with its velocity estimate
  let clock = 0;
  let snapNext = true; // jump to the next snapshot instead of gliding to it
  let shownFloor = doodle.floorId; // floor of the snapshot the drawn position last followed

  /** The host's latest snapshot. Velocity comes from the gap to the previous one, timed on our clock. */
  function applySnapshot(next) {
    if (!next?.pos) return;
    const prev = snap;
    const vel = { x: 0, y: 0, z: 0 };
    const gap = prev ? clock - prev.at : 0;
    if (prev && prev.floorId === next.floorId && gap > 0.02 && gap < 0.5) {
      vel.x = (next.pos.x - prev.pos.x) / gap;
      vel.y = (next.pos.y - prev.pos.y) / gap;
      vel.z = (next.pos.z - prev.pos.z) / gap;
      // Faster than it can run (or lunge) means a teleport (reset, a jump in the feed): don't extrapolate it.
      if (Math.hypot(vel.x, vel.y, vel.z) > MAX_SPEED) vel.x = vel.y = vel.z = 0;
    }
    snap = { ...next, pos: copy(next.pos), vel, at: clock };
    if (active) mirror();
  }

  /** What Audio and UI read follows the snapshot at once; only the drawn position glides. */
  function mirror() {
    doodle.state = snap.state ?? doodle.state;
    doodle.speed = snap.speed ?? 0;
    doodle.floorId = snap.floorId ?? doodle.floorId;
  }

  function update(dt) {
    if (!(dt > 0)) return;
    clock += dt;
    if (!active) doodle.speed = 0; // like the brain: frozen while a cutscene has it
    if (!active || !snap) return;
    const lead = Math.min(LEAD_MAX, clock - snap.at);
    const goal = {
      x: snap.pos.x + snap.vel.x * lead,
      y: snap.pos.y + snap.vel.y * lead,
      z: snap.pos.z + snap.vel.z * lead,
    };
    const far = Math.hypot(goal.x - doodle.pos.x, goal.y - doodle.pos.y, goal.z - doodle.pos.z);
    const otherFloor = snap.floorId !== shownFloor && far > SNAP_FLOOR_DIST;
    if (snapNext || far > SNAP_DIST || otherFloor) {
      doodle.pos = goal;
      doodle.yaw = snap.yaw ?? doodle.yaw;
      doodle.pitch = snap.pitch ?? 0;
      snapNext = false;
    } else {
      const k = 1 - Math.exp(-FOLLOW * dt);
      doodle.pos.x += (goal.x - doodle.pos.x) * k;
      doodle.pos.y += (goal.y - doodle.pos.y) * k;
      doodle.pos.z += (goal.z - doodle.pos.z) * k;
      doodle.yaw += angleDiff(doodle.yaw, snap.yaw ?? doodle.yaw) * k;
      doodle.pitch += ((snap.pitch ?? 0) - doodle.pitch) * k;
    }
    shownFloor = snap.floorId;
    doodle.pose = snap.pose ?? doodle.pose;
    doodle.mood = snap.mood ?? doodle.mood;
    doodle.carrying = snap.carrying ?? null;
  }

  function bounds() {
    const lying = doodle.state === S.SLEEP || doodle.state === S.STUNNED;
    return { center: { x: doodle.pos.x, y: doodle.pos.y + (lying ? 0.45 : 0.8), z: doodle.pos.z }, radius: lying ? 0.7 : 0.8 };
  }

  /** Start of day, like the brain's: asleep at the spot until the host's snapshots say otherwise. */
  function reset(spot) {
    doodle.pos = copy(spot.pos);
    doodle.floorId = shownFloor = spot.floorId;
    if (spot.rotY !== undefined) doodle.yaw = spot.rotY;
    doodle.pitch = 0;
    doodle.speed = 0;
    doodle.state = S.SLEEP;
    doodle.pose = 'sleep';
    doodle.mood = 'calm';
    snap = null; // a snapshot from before the reset would drag it back to where it caught you
    snapNext = true;
  }

  /** false: stop following snapshots (a cutscene owns the model). Back on, it jumps to the host's Doodle. */
  function setActive(on) {
    if (on && !active) snapNext = true;
    active = !!on;
    if (active && snap) mirror();
  }

  function snapshot() {
    return {
      pos: copy(doodle.pos),
      yaw: doodle.yaw,
      pitch: doodle.pitch,
      pose: doodle.pose,
      mood: doodle.mood,
      carrying: doodle.carrying,
      speed: doodle.speed,
      state: doodle.state,
      floorId: doodle.floorId,
    };
  }

  return doodle;
}
