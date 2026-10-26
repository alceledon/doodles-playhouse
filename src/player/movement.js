// Player movement math. Pure logic on plain {x, y, z}: speeds, stamina, and a
// circle sliding against World's collider boxes. A box blocks the body only
// where their Y ranges overlap, so crouching (0.7 m) fits under a crawl
// ceiling that stops you standing (1.25 m), and rugs never block.

import { PLAYER_BODY } from '../core/contracts.js';
import { clamp } from '../core/math.js';

/** Bottom of the body's blocking range above the feet: rugs (maxY < 0.05) never block. */
export const FOOT_CLEARANCE = 0.05;

export const bodyHeight = (crouched) => (crouched ? PLAYER_BODY.crouchHeight : PLAYER_BODY.height);

/** Boxes whose Y range overlaps the body standing at feetY with this height. */
export function overlappingY(boxes, feetY, height) {
  const lo = feetY + FOOT_CLEARANCE;
  const hi = feetY + height;
  return boxes.filter((b) => b.maxY > lo && b.minY < hi);
}

/** Does a floor-plane circle at (x, z) overlap any of these boxes? */
export function circleHitsAny(x, z, radius, boxes) {
  for (const b of boxes) {
    const cx = clamp(x, b.minX, b.maxX);
    const cz = clamp(z, b.minZ, b.maxZ);
    if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius - 1e-9) return true;
  }
  return false;
}

/** Push a circle out of every box it overlaps (a few passes for corners). */
export function pushOut(p, radius, boxes, passes = 4) {
  let x = p.x;
  let z = p.z;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const b of boxes) {
      const cx = clamp(x, b.minX, b.maxX);
      const cz = clamp(z, b.minZ, b.maxZ);
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        x += (dx / d) * (radius - d);
        z += (dz / d) * (radius - d);
      } else {
        // Center inside the box: leave by the nearest edge.
        const exits = [
          [x - b.minX, -1, 0], [b.maxX - x, 1, 0],
          [z - b.minZ, 0, -1], [b.maxZ - z, 0, 1],
        ].sort((a, c) => a[0] - c[0]);
        const [depth, ex, ez] = exits[0];
        x += ex * (depth + radius);
        z += ez * (depth + radius);
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/**
 * Move a circle by (dx, dz), sliding along walls. Sub-steps so a fast move
 * can't tunnel through a thin wall.
 * @param {Object[]} boxes  already filtered to the body's Y range
 */
export function slideMove(p, dx, dz, radius, boxes) {
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / (radius * 0.4)));
  let cur = { x: p.x, z: p.z };
  for (let k = 0; k < steps; k++) cur = pushOut({ x: cur.x + dx / steps, z: cur.z + dz / steps }, radius, boxes);
  return cur;
}

/** Can the player stand up here (nothing overhead within standing height)? */
export function canStand(p, feetY, boxes, radius = PLAYER_BODY.radius) {
  return !circleHitsAny(p.x, p.z, radius * 0.95, overlappingY(boxes, feetY, PLAYER_BODY.height));
}

/** Target speed (m/s) for the current stance. The battery caps it and stops sprinting. */
export function targetSpeed({ crouched, sprinting, carryingBattery }, move) {
  const base = crouched ? move.crouch : sprinting ? move.sprint : move.walk;
  return carryingBattery ? Math.min(base, move.battery) : base;
}

/** World-space unit move direction for yaw and WASD input (fwd/strafe in -1..1), or null. */
export function wishDir(yaw, fwd, strafe) {
  if (!fwd && !strafe) return null;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const x = -sin * fwd + cos * strafe;
  const z = -cos * fwd - sin * strafe;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

/**
 * Stamina bookkeeping.
 * @param {{stamina: number, exhausted: boolean, rest: number}} s   mutated
 * @param {boolean} sprinting  sprinting and actually moving this frame
 */
export function updateStamina(s, sprinting, dt, tuning) {
  if (sprinting) {
    s.stamina = Math.max(0, s.stamina - tuning.drain * dt);
    s.rest = 0;
    if (s.stamina <= 0) s.exhausted = true;
  } else {
    s.rest += dt;
    if (s.rest >= tuning.regenDelay) s.stamina = Math.min(1, s.stamina + tuning.regen * dt);
  }
  if (s.exhausted && s.stamina >= tuning.recoverAt) s.exhausted = false;
  return s;
}
