// Tennis-ball physics: a small sphere with gravity that bounces off World's
// collider boxes, floors (via heightAt, so it rolls down stairs) and the
// ceiling. Pure logic on plain {x, y, z}.

import { STOREY_HEIGHT } from '../core/contracts.js';
import { clamp } from '../core/math.js';

export const BALL_RADIUS = 0.04;
const GRAVITY = 9.8;
const SUBSTEP = 1 / 120;

export function createBall(pos, vel, floorId) {
  return { pos: { ...pos }, vel: { ...vel }, floorId, time: 0, resting: false, bounces: 0 };
}

/**
 * Advance the ball. Returns the impacts this step ({speed, pos}), loudest
 * first, so the caller can make noise.
 * @param {{boxes: (floorId: string, y: number) => Object[], heightAt: Function, floorY: (floorId: string) => number}} env
 * @param {Object} tuning  tuningFor().ball
 */
export function stepBall(ball, dt, env, tuning) {
  const impacts = [];
  const r = BALL_RADIUS;
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  const { pos, vel } = ball;
  for (let k = 0; k < steps && !ball.resting; k++) {
    ball.time += h;
    vel.y -= GRAVITY * h;
    pos.x += vel.x * h;
    pos.y += vel.y * h;
    pos.z += vel.z * h;

    for (const b of env.boxes(ball.floorId, pos.y)) {
      if (b.maxY < pos.y - r || b.minY > pos.y + r) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cy = clamp(pos.y, b.minY, b.maxY);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      let nx = pos.x - cx;
      let ny = pos.y - cy;
      let nz = pos.z - cz;
      const d2 = nx * nx + ny * ny + nz * nz;
      if (d2 >= r * r) continue;
      let depth;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        nx /= d;
        ny /= d;
        nz /= d;
        depth = r - d;
      } else {
        // Center inside the box: leave by the nearest face.
        const faces = [
          [pos.x - b.minX, -1, 0, 0], [b.maxX - pos.x, 1, 0, 0],
          [pos.y - b.minY, 0, -1, 0], [b.maxY - pos.y, 0, 1, 0],
          [pos.z - b.minZ, 0, 0, -1], [b.maxZ - pos.z, 0, 0, 1],
        ].sort((a, c) => a[0] - c[0]);
        [depth, nx, ny, nz] = faces[0];
        depth += r;
      }
      pos.x += nx * depth;
      pos.y += ny * depth;
      pos.z += nz * depth;
      const vn = vel.x * nx + vel.y * ny + vel.z * nz;
      if (vn < 0) {
        const e = ny > 0.7 ? tuning.restitution : tuning.wallRestitution;
        vel.x -= (1 + e) * vn * nx;
        vel.y -= (1 + e) * vn * ny;
        vel.z -= (1 + e) * vn * nz;
        if (-vn > 0.8) impacts.push({ speed: -vn, pos: { ...pos } });
      }
    }

    const ground = env.heightAt(pos.x, pos.z, ball.floorId);
    ball.floorId = ground.floorId;
    let grounded = false;
    if (pos.y - r <= ground.y) {
      pos.y = ground.y + r;
      grounded = true;
      if (vel.y < 0) {
        const vn = -vel.y;
        if (vn > 0.8) impacts.push({ speed: vn, pos: { ...pos } });
        vel.y = vn > 0.6 ? vn * tuning.restitution : 0;
        if (vn > 0.6) ball.bounces += 1;
      }
    }
    const ceiling = env.floorY(ball.floorId) + STOREY_HEIGHT - 0.12;
    if (pos.y + r > ceiling && vel.y > 0) {
      pos.y = ceiling - r;
      vel.y = -vel.y * tuning.wallRestitution;
    }
    if (grounded && vel.y === 0) {
      const f = Math.max(0, 1 - tuning.rollFriction * h);
      vel.x *= f;
      vel.z *= f;
      if (Math.hypot(vel.x, vel.z) < 0.12) ball.resting = true;
    }
    if (ball.time > tuning.maxFlight) {
      pos.y = ground.y + r;
      ball.resting = true;
    }
  }
  if (ball.resting) vel.x = vel.y = vel.z = 0;
  return impacts.sort((a, b) => b.speed - a.speed);
}
