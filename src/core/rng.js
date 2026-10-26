// Seeded random numbers. Every random choice that affects a run (item spawns,
// keypad code, squeaky-toy positions, Doodle patrol picks) must come from an
// RNG made here, so a seed reproduces a run exactly.

/** Hash any string (or number) to a 32-bit unsigned seed. */
export function hashSeed(value) {
  const str = String(value);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 generator.
 * @param {number|string} seed
 * @returns {Rng}
 *
 * @typedef {Object} Rng
 * @property {() => number} next            float in [0, 1)
 * @property {(min: number, max: number) => number} range  float in [min, max)
 * @property {(min: number, max: number) => number} int    integer in [min, max] inclusive
 * @property {(p: number) => boolean} chance  true with probability p
 * @property {<T>(arr: T[]) => T} pick
 * @property {<T>(arr: T[]) => T[]} shuffle  returns a new shuffled array
 * @property {(label: string) => Rng} fork  independent child stream, stable per label
 */
export function createRng(seed) {
  const base = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  let a = base;

  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick(arr) {
      if (!arr.length) throw new Error('pick() from an empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    // Forks depend only on the base seed and the label, so adding a new fork
    // in one area never shifts another area's random stream.
    fork: (label) => createRng(hashSeed(`${base}:${label}`)),
  };
}

/** A fresh random seed for a new run (not reproducible — that's the point). */
export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}
