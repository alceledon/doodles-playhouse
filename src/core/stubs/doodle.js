// STUB Doodle: an orange box-dog that sleeps, then walks straight at the
// player when they share a floor (through walls — it's a stub), otherwise
// wanders between patrol points. Enough to exercise the catch → next day loop.

import * as THREE from 'three';
import { EVENTS } from '../events.js';
import { DOODLE_BODY, DOODLE_STATES as S } from '../contracts.js';
import { copy, dist2D, yawTo } from '../math.js';

/** createDoodle({ scene, world, bus, rng, difficulty }) → Doodle */
export function createDoodle({ scene, world, bus, rng }) {
  const group = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({ color: 0xd9a441 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.3), fur);
  body.position.y = 0.8;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), fur);
  head.position.set(0, 1.25, -0.8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), eyeMat);
    eye.position.set(x, 1.32, -1.08);
    group.add(eye);
  }
  group.add(body, head);
  scene.add(group);

  const model = {
    object3d: group,
    setPose() {},
    setMood: (mood) => eyeMat.color.setHex(mood === 'hunt' ? 0xff2020 : 0xfff0a0),
    update() {},
  };

  const doodle = {
    pos: copy(world.anchors.kennel.pos),
    floorId: world.anchors.kennel.floorId,
    yaw: 0,
    state: S.SLEEP,
    speed: 0,
    model,
    bounds: () => ({ center: { x: doodle.pos.x, y: doodle.pos.y + 0.8, z: doodle.pos.z }, radius: 0.8 }),
    update,
    reset(spot, { wakeDelay = 8 } = {}) {
      doodle.pos = copy(spot.pos);
      doodle.floorId = spot.floorId;
      sleepLeft = wakeDelay;
      stunLeft = 0;
      setState(S.SLEEP);
      sync();
    },
    setActive: (on) => (active = on),
    stun(seconds) {
      stunLeft = seconds;
      setState(S.STUNNED);
      bus.emit(EVENTS.DOODLE_STUNNED, { seconds });
    },
    dispose: () => scene.remove(group),
    debug: { path: [], target: null, senses: {} },
  };

  let active = false;
  let sleepLeft = 8;
  let stunLeft = 0;
  let patrolTarget = null;

  function setState(next) {
    if (next === doodle.state) return;
    const prev = doodle.state;
    doodle.state = next;
    model.setMood(next === S.CHASE ? 'hunt' : 'calm');
    bus.emit(EVENTS.DOODLE_STATE, { state: next, prev });
    if (next === S.CHASE) bus.emit(EVENTS.SPOTTED, { pos: copy(doodle.pos) });
  }

  function moveToward(target, speed, dt) {
    const d = dist2D(doodle.pos, target);
    doodle.yaw = yawTo(doodle.pos, target);
    const step = Math.min(d, speed * dt);
    if (d > 1e-6) {
      doodle.pos.x += ((target.x - doodle.pos.x) / d) * step;
      doodle.pos.z += ((target.z - doodle.pos.z) / d) * step;
    }
    doodle.speed = speed;
    return d - step;
  }

  function update(dt, player) {
    if (!active) {
      doodle.speed = 0;
      return;
    }
    if (doodle.state === S.SLEEP) {
      sleepLeft -= dt;
      if (sleepLeft <= 0) setState(S.PATROL);
    } else if (doodle.state === S.STUNNED) {
      stunLeft -= dt;
      doodle.speed = 0;
      if (stunLeft <= 0) {
        setState(S.PATROL);
        bus.emit(EVENTS.DOODLE_RECOVERED, {});
      }
    } else if (player && !player.hidden && player.floorId === doodle.floorId) {
      setState(S.CHASE);
      moveToward(player.pos, 2.2, dt);
      if (dist2D(doodle.pos, player.pos) < DOODLE_BODY.catchRange) {
        setState(S.CATCH);
        bus.emit(EVENTS.CAUGHT, { how: 'tackle' });
      }
    } else {
      if (doodle.state === S.CHASE) bus.emit(EVENTS.LOST_TRACK, {});
      setState(S.PATROL);
      const options = world.anchors.patrol.filter((s) => s.floorId === doodle.floorId);
      if (!patrolTarget || patrolTarget.floorId !== doodle.floorId) patrolTarget = options.length ? rng.pick(options) : null;
      if (patrolTarget && moveToward(patrolTarget.pos, 1.4, dt) < 0.1) patrolTarget = null;
    }
    doodle.pos.y = world.heightAt(doodle.pos.x, doodle.pos.z, doodle.floorId).y;
    sync();
  }

  function sync() {
    group.position.set(doodle.pos.x, doodle.pos.y, doodle.pos.z);
    group.rotation.y = doodle.yaw;
  }

  sync();
  return doodle;
}
