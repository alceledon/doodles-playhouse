// Settings and best times, persisted in localStorage. Pure: every function
// takes the storage object, so tests pass a fake one. Storage can be missing or
// throw (private mode, sandboxed iframes), so every access is wrapped.

import { DIFFICULTIES, SETTINGS_DEFAULTS } from '../core/contracts.js';
import { clamp } from '../core/math.js';

export const SETTINGS_KEY = 'doodles-playhouse.settings.v1';
export const BEST_KEY = 'doodles-playhouse.best.v1';
export const QUALITIES = Object.freeze(['low', 'medium', 'high']);
export const SENSITIVITY_RANGE = Object.freeze({ min: 0.2, max: 3, step: 0.05 });

/** The browser's localStorage, or null if it can't be used. */
export function getStorage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Coerce anything into a valid Settings object (exactly the contract's keys). */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = SETTINGS_DEFAULTS;
  const sens = num(s.mouseSensitivity);
  const vol = num(s.volume);
  return {
    mouseSensitivity: sens === null ? d.mouseSensitivity : Math.round(clamp(sens, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max) * 100) / 100,
    invertY: typeof s.invertY === 'boolean' ? s.invertY : d.invertY,
    volume: vol === null ? d.volume : Math.round(clamp(vol, 0, 1) * 100) / 100,
    quality: QUALITIES.includes(s.quality) ? s.quality : d.quality,
  };
}

function readJson(storage, key) {
  try {
    const text = storage?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSettings = (storage) => sanitizeSettings(readJson(storage, SETTINGS_KEY));
/** @returns {boolean} false if it couldn't be saved (the game still works) */
export const saveSettings = (storage, settings) => writeJson(storage, SETTINGS_KEY, sanitizeSettings(settings));

// ---- best times --------------------------------------------------------------

const validTime = (s) => typeof s === 'number' && Number.isFinite(s) && s > 0;

/** {difficulty: seconds} for each difficulty with a valid record. */
export function loadBestTimes(storage) {
  const raw = readJson(storage, BEST_KEY);
  const out = {};
  if (raw && typeof raw === 'object') for (const d of DIFFICULTIES) if (validTime(raw[d])) out[d] = raw[d];
  return out;
}

/**
 * Record a finished run.
 * @returns {{isNew: boolean, best: number|null}}  isNew: this beat (or set) the record
 */
export function recordBestTime(storage, difficulty, seconds) {
  const best = loadBestTimes(storage);
  if (!DIFFICULTIES.includes(difficulty) || !validTime(seconds)) return { isNew: false, best: best[difficulty] ?? null };
  const prev = best[difficulty];
  if (prev !== undefined && prev <= seconds) return { isNew: false, best: prev };
  best[difficulty] = seconds;
  writeJson(storage, BEST_KEY, best);
  return { isNew: true, best: seconds };
}
