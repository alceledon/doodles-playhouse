// Pure audio math: distance and floor attenuation, Doodle rhythm rates, the
// heartbeat and the tension that detunes the lullaby. No Web Audio here, so
// `node --test` covers it.

import { DOODLE_STATES as S, FLOOR_IDS, STOREY_HEIGHT } from '../core/contracts.js';
import { clamp, lerp } from '../core/math.js';
import { AUDIO_TUNING as T } from './tuning.js';

export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Gain for a sound `d` meters away. Web Audio's 'inverse' model, faded to
 * exactly 0 at `range` so far sounds drop out instead of lingering.
 */
export function distanceGain(d, { ref = 1, rolloff = 1, range = 30 } = {}) {
  if (!(d < range)) return 0; // also catches NaN
  const inv = ref / (ref + rolloff * Math.max(0, d - ref));
  const tail = 1 - smoothstep(range * 0.6, range, d);
  return clamp(inv * tail, 0, 1);
}

/** How many storeys apart two sounds are, by floor id, else by height. */
export function floorsBetween(floorA, floorB, yA, yB) {
  const a = FLOOR_IDS.indexOf(floorA);
  const b = FLOOR_IDS.indexOf(floorB);
  if (a >= 0 && b >= 0) return Math.abs(a - b);
  if (Number.isFinite(yA) && Number.isFinite(yB)) return Math.round(Math.abs(yA - yB) / STOREY_HEIGHT);
  return 0;
}

/** Through floors, sounds get quieter and duller. */
export function floorMuffle(floors, { gainPerFloor, cutoffHz } = T.floors) {
  if (!(floors > 0)) return { gain: 1, cutoff: 20000 };
  return { gain: gainPerFloor ** floors, cutoff: cutoffHz / floors ** 1.3 };
}

/** How far away the player can hear a NOISE of this loudness (Doodle's hearing radius). */
export function noiseRange(loudness, t = T.oneShot) {
  return clamp((Number(loudness) || 0) * t.rangePerLoudness, t.minRange, t.maxRange);
}

export function reverbSend(d, { near, far, farDist } = T.reverbSend) {
  return lerp(near, far, clamp(d / farDist, 0, 1));
}

/** Master gain for the 0..1 volume setting: squared, which sounds closer to even steps. */
export function volumeToGain(v) {
  const x = clamp(Number(v) || 0, 0, 1);
  return x * x;
}

/** Seconds between collar jingles at this speed (Infinity when standing still). */
export function jingleInterval(speed, t = T.doodle.jingle) {
  if (!(speed > t.minSpeed)) return Infinity;
  return Math.max(t.minInterval, 1 / (speed * t.stepsPerMeter));
}

/** Panting gets faster and louder with speed, and fastest in a chase. */
export function pantParams(speed, chasing, t = T.doodle.pant) {
  const k = chasing ? 1 : clamp((speed || 0) / t.chaseSpeed, 0, 1);
  return { interval: lerp(t.calmInterval, t.chaseInterval, k), gain: lerp(t.calmGain, t.chaseGain, k) };
}

/** 1 when Doodle is within `near`, 0 beyond `far`. */
export function proximity(dist, near, far) {
  if (!Number.isFinite(dist)) return 0;
  return 1 - smoothstep(near, far, dist);
}

/**
 * Heartbeat from how close Doodle is. A chase pins it high; another floor
 * damps it, since you can hear Doodle but it can't reach you yet. A sleeping
 * Doodle doesn't count.
 * @returns {{intensity: number, bpm: number}} intensity 0 means no heartbeat
 */
export function heartbeat(dist, { chasing = false, sameFloor = true, asleep = false } = {}, t = T.heartbeat) {
  let p = asleep ? 0 : proximity(dist, t.near, t.far) * (sameFloor ? 1 : t.otherFloor);
  if (chasing) p = Math.max(p, t.chaseFloor);
  if (p < t.threshold) return { intensity: 0, bpm: t.minBpm };
  return { intensity: p, bpm: lerp(t.minBpm, t.maxBpm, p) };
}

/** 0..1: how tense the music should be right now. */
export function tension(dist, { state = null, sameFloor = true } = {}, t = T.tension) {
  if (state === S.CHASE || state === S.CATCH) return 1;
  let x = proximity(dist, t.near, t.far) * (sameFloor ? 1 : t.otherFloor) * (state === S.SLEEP ? t.asleep : 1);
  if (state === S.INVESTIGATE || state === S.SNIFF || state === S.SEARCH) x = Math.max(x, t.alert);
  return clamp(x, 0, 1);
}

/** How the music box behaves at a tension level: it detunes, slows and misses notes. */
export function lullabyParams(tensionLevel, { inGame = true } = {}, t = T.music) {
  const k = clamp(tensionLevel || 0, 0, 1);
  const base = inGame ? t.gameGain : t.titleGain;
  return {
    gain: k >= 1 ? t.chaseGain : lerp(base, Math.max(t.chaseGain, base * 0.6), k),
    centsDepth: t.wobbleCents + t.tensionCents * k,
    tempoMul: 1 + t.tempoDrop * k, // >1 = longer beats = slower
    skipChance: t.skipChance * k,
  };
}

/** Exponential smoothing that doesn't depend on frame rate. */
export function approach(current, target, dt, timeConstant) {
  if (!(timeConstant > 0)) return target;
  return target + (current - target) * Math.exp(-dt / timeConstant);
}

/** Midi note number to Hz, plus a detune in cents. */
export const midiToHz = (m, cents = 0) => 440 * 2 ** ((m - 69) / 12 + cents / 1200);
