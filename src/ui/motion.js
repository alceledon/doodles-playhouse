// Pure helpers for the HUD and cutscenes: easing, paths, the wake-up blink,
// finding clear floor space for a camera move, and the HUD's continuous values.
// No DOM, no three, so `node --test` covers it.

import { DOODLE_STATES as S } from '../core/contracts.js';
import { circleHitsBox2D, clamp, dist2D, lerp } from '../core/math.js';
import { UI_TUNING } from './tuning.js';

export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** Overshoots a little before settling: a pounce. */
export const easeOutBack = (t, k = 1.7) => 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Unit vector on the floor for a yaw (0 faces -Z, positive turns left). */
export const forward = (yaw) => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });

/** Point at fraction t (0..1) along a polyline, by distance. */
export function pathPoint(points, t) {
  if (points.length === 1) return { ...points[0] };
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    seg.push(len);
    total += len;
  }
  let d = clamp(t, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? clamp(d / seg[i], 0, 1) : 1;
      const a = points[i];
      const b = points[i + 1];
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
    }
    d -= seg[i];
  }
  return { ...points[points.length - 1] };
}

/**
 * How far you can move from `from` along `dir` before a collider blocks a body
 * of `radius` spanning [yMin, yMax] (contract rule: boxes block only when Y overlaps).
 */
export function freeDistance(world, floorId, from, dir, max, { radius = 0.25, yMin = from.y, yMax = from.y + 0.6 } = {}) {
  const boxes = world?.colliders?.(floorId) ?? [];
  const blocked = (x, z) => boxes.some((b) => b.minY < yMax && b.maxY > yMin && circleHitsBox2D(x, z, radius, b));
  if (blocked(from.x, from.z)) return 0;
  for (let d = 0.1; d <= max + 1e-9; d += 0.1) if (blocked(from.x + dir.x * d, from.z + dir.z * d)) return Math.max(0, d - 0.1);
  return max;
}

/**
 * The yaw nearest `preferredYaw` with at least `need` meters clear, trying
 * ±45° steps. Falls back to the clearest direction.
 * @returns {{yaw: number, free: number}}
 */
export function clearDirection(world, floorId, from, preferredYaw, need, opts) {
  let best = { yaw: preferredYaw, free: -1 };
  for (const step of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const yaw = preferredYaw + (step * Math.PI) / 4;
    const free = freeDistance(world, floorId, from, forward(yaw), need, opts);
    if (free >= need) return { yaw, free };
    if (free > best.free) best = { yaw, free };
  }
  return best;
}

/**
 * Eyelid openness over the wake-up (0 = shut, 1 = open): a heavy half-open,
 * a slow blink, then open for good.
 */
export function lidOpenness(t) {
  const keys = [[0, 0], [0.12, 0], [0.34, 0.45], [0.44, 0.45], [0.52, 0.06], [0.62, 0.06], [0.95, 1], [1, 1]];
  const x = clamp(t, 0, 1);
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    if (x <= t1) return lerp(v0, v1, easeInOut((x - t0) / (t1 - t0 || 1)));
  }
  return 1;
}

/** How dark the HUD vignette should be (0..max) for the player and Doodle right now. */
export function vignetteLevel(player, doodle, t = UI_TUNING.hud) {
  if (!t.vignette || !player || !doodle || player.floorId !== doodle.floorId) return 0;
  let v = (1 - smoothstep(t.vignetteNear, t.vignetteFar, dist2D(player.pos, doodle.pos))) * t.vignetteMax;
  if (doodle.state === S.CHASE) v = Math.max(v, t.vignetteChase);
  return v;
}

/** The stamina bar: shown only while not full, red when low. */
export function staminaView(stamina, t = UI_TUNING.hud) {
  const s = Number.isFinite(stamina) ? clamp(stamina, 0, 1) : 1;
  return { visible: s < t.staminaHideAt, low: s < t.staminaLow, fraction: s };
}
