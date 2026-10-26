// Walks a body along a route from path.js. Pure logic.
//
// - Moves in 3D toward each waypoint, so stair link points carry it up/down.
// - On a link it switches floorId halfway up, like world.heightAt does.
// - Looks a little ahead for closed doors on the route and asks the brain to
//   open them before it reaches the doorway.

import { angleDiff, yawTo } from '../core/math.js';
import { worldToCell, refKey } from '../core/navgrid.js';
import { doorIndex } from './path.js';

const ARRIVE = 0.05;
const DOOR_LOOKAHEAD = 1.4;

export function createMover(world) {
  const nav = world.nav;
  const doors = doorIndex(world.doors);
  let route = [];
  let idx = 0;

  /** Closed doors whose cells the next DOOR_LOOKAHEAD meters of route cross. */
  function doorsAhead(body) {
    const found = [];
    let prev = body.pos;
    let left = DOOR_LOOKAHEAD;
    for (let k = idx; k < route.length && left > 0; k++) {
      const w = route[k];
      if (w.link) {
        prev = w;
        continue; // stairs have no doors
      }
      const seg = Math.hypot(w.x - prev.x, w.z - prev.z);
      const len = Math.min(seg, left);
      const n = Math.max(1, Math.ceil(len / 0.2));
      for (let s = 0; s <= n; s++) {
        const t = seg > 0 ? (len * s) / n / seg : 0;
        const ref = worldToCell(nav, w.floorId, prev.x + (w.x - prev.x) * t, prev.z + (w.z - prev.z) * t);
        const door = ref && doors.get(refKey(ref));
        if (door && !door.isOpen && !found.includes(door)) found.push(door);
      }
      left -= seg;
      prev = w;
    }
    return found;
  }

  return {
    get route() {
      return route;
    },
    get index() {
      return idx;
    },
    /** True while the body is between the points of a link (don't re-plan mid-stairs). */
    get onLink() {
      return idx < route.length && !!route[idx].link;
    },
    get done() {
      return idx >= route.length;
    },
    setRoute(r) {
      route = r;
      idx = 0;
    },
    clear() {
      route = [];
      idx = 0;
    },
    doorsAhead,
    /**
     * Advance `body` ({pos, floorId, yaw, pitch}) along the route.
     * @returns {{moved: number, arrived: boolean}}
     */
    step(body, dt, speed, turnRate) {
      let budget = speed * dt;
      let moved = 0;
      let pitch = 0;
      let face = null;
      while (budget > 1e-9 && idx < route.length) {
        const w = route[idx];
        const dx = w.x - body.pos.x;
        const dy = w.y - body.pos.y;
        const dz = w.z - body.pos.z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= ARRIVE) {
          body.pos.x = w.x;
          body.pos.y = w.y;
          body.pos.z = w.z;
          if (!w.link) body.floorId = w.floorId;
          idx++;
          continue;
        }
        const s = Math.min(budget, d);
        body.pos.x += (dx / d) * s;
        body.pos.y += (dy / d) * s;
        body.pos.z += (dz / d) * s;
        budget -= s;
        moved += s;
        const flat = Math.hypot(dx, dz);
        if (w.link) {
          const { fromFloor, toFloor, midY } = w.link;
          const up = world.nav.floors[toFloor].y > world.nav.floors[fromFloor].y;
          body.floorId = (up ? body.pos.y >= midY : body.pos.y <= midY) ? toFloor : fromFloor;
          pitch = Math.atan2(dy, flat);
        } else body.floorId = w.floorId;
        if (flat > 0.02) face = yawTo(body.pos, w);
      }
      if (face !== null) turnToward(body, face, turnRate, dt);
      body.pitch = pitch;
      return { moved, arrived: idx >= route.length };
    },
  };
}

/** Rotate body.yaw toward a yaw at most turnRate rad/s. */
export function turnToward(body, yaw, turnRate, dt) {
  const d = angleDiff(body.yaw, yaw);
  const max = turnRate * dt;
  body.yaw = Math.atan2(Math.sin(body.yaw), Math.cos(body.yaw)) + (Math.abs(d) <= max ? d : Math.sign(d) * max);
}
