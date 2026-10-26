import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_DEFAULTS } from '../../src/core/contracts.js';
import {
  BEST_KEY,
  SETTINGS_KEY,
  loadBestTimes,
  loadSettings,
  recordBestTime,
  sanitizeSettings,
  saveSettings,
} from '../../src/ui/settings.js';

/** A localStorage stand-in. `broken` makes every call throw, like a sandboxed iframe. */
function fakeStorage(initial = {}, { broken = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(k) {
      if (broken) throw new Error('SecurityError');
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      if (broken) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
  };
}

test('sanitize: junk becomes the defaults, with exactly the contract keys', () => {
  for (const junk of [null, undefined, 42, 'x', [], {}]) assert.deepEqual(sanitizeSettings(junk), { ...SETTINGS_DEFAULTS });
  assert.deepEqual(Object.keys(sanitizeSettings({ extra: 1 })).sort(), Object.keys(SETTINGS_DEFAULTS).sort());
});

test('sanitize: clamps numbers, rejects wrong types and unknown qualities', () => {
  const s = sanitizeSettings({ mouseSensitivity: 99, invertY: 'yes', volume: -1, quality: 'ultra' });
  assert.equal(s.mouseSensitivity, 3);
  assert.equal(s.invertY, SETTINGS_DEFAULTS.invertY);
  assert.equal(s.volume, 0);
  assert.equal(s.quality, SETTINGS_DEFAULTS.quality);
  assert.equal(sanitizeSettings({ mouseSensitivity: 0 }).mouseSensitivity, 0.2);
  assert.equal(sanitizeSettings({ mouseSensitivity: NaN }).mouseSensitivity, SETTINGS_DEFAULTS.mouseSensitivity);
  assert.equal(sanitizeSettings({ volume: '0.5' }).volume, SETTINGS_DEFAULTS.volume);
  assert.equal(sanitizeSettings({ volume: 1.0000001 }).volume, 1);
  assert.equal(sanitizeSettings({ touchSensitivity: 99 }).touchSensitivity, 3);
  assert.equal(sanitizeSettings({ touchSensitivity: 0 }).touchSensitivity, 0.2);
  assert.equal(sanitizeSettings({ touchSensitivity: '2' }).touchSensitivity, SETTINGS_DEFAULTS.touchSensitivity);
});

test('touch look sensitivity is its own setting, defaulting to 1', () => {
  assert.equal(SETTINGS_DEFAULTS.touchSensitivity, 1);
  const s = sanitizeSettings({ mouseSensitivity: 2.5 });
  assert.equal(s.touchSensitivity, 1, 'the mouse setting does not leak into touch');
  assert.equal(sanitizeSettings({ touchSensitivity: 1.234 }).touchSensitivity, 1.23);
});

test('sanitize: keeps valid values', () => {
  const good = { mouseSensitivity: 1.75, invertY: true, volume: 0.35, quality: 'high', touchSensitivity: 0.6 };
  assert.deepEqual(sanitizeSettings(good), good);
});

test('settings round-trip through storage', () => {
  const st = fakeStorage();
  assert.equal(saveSettings(st, { mouseSensitivity: 2, invertY: true, volume: 0.5, quality: 'low', touchSensitivity: 1.5 }), true);
  assert.deepEqual(loadSettings(st), { mouseSensitivity: 2, invertY: true, volume: 0.5, quality: 'low', touchSensitivity: 1.5 });
  // Settings saved before touchSensitivity existed load with its default.
  const old = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ mouseSensitivity: 2, invertY: true, volume: 0.5, quality: 'low' }) });
  assert.equal(loadSettings(old).touchSensitivity, SETTINGS_DEFAULTS.touchSensitivity);
  assert.ok(st.data.has(SETTINGS_KEY));
});

test('saved settings are sanitized on the way in and out', () => {
  const st = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ mouseSensitivity: -5, quality: 'potato' }) });
  assert.deepEqual(loadSettings(st), { ...SETTINGS_DEFAULTS, mouseSensitivity: 0.2 });
  saveSettings(st, { volume: 9 });
  assert.equal(JSON.parse(st.data.get(SETTINGS_KEY)).volume, 1);
});

test('missing, corrupt or throwing storage falls back to defaults without crashing', () => {
  assert.deepEqual(loadSettings(null), { ...SETTINGS_DEFAULTS });
  assert.deepEqual(loadSettings(fakeStorage({ [SETTINGS_KEY]: '{not json' })), { ...SETTINGS_DEFAULTS });
  const broken = fakeStorage({}, { broken: true });
  assert.deepEqual(loadSettings(broken), { ...SETTINGS_DEFAULTS });
  assert.equal(saveSettings(broken, SETTINGS_DEFAULTS), false);
  assert.equal(saveSettings(null, SETTINGS_DEFAULTS), false);
});

test('best times: the first finish is a record, slower is not, faster is', () => {
  const st = fakeStorage();
  assert.deepEqual(recordBestTime(st, 'normal', 300), { isNew: true, best: 300 });
  assert.deepEqual(recordBestTime(st, 'normal', 320), { isNew: false, best: 300 });
  assert.deepEqual(recordBestTime(st, 'normal', 300), { isNew: false, best: 300 }, 'a tie is not a new best');
  assert.deepEqual(recordBestTime(st, 'normal', 250.5), { isNew: true, best: 250.5 });
  assert.deepEqual(loadBestTimes(st), { normal: 250.5 });
});

test('best times are kept per difficulty', () => {
  const st = fakeStorage();
  recordBestTime(st, 'easy', 100);
  recordBestTime(st, 'hard', 900);
  assert.equal(recordBestTime(st, 'hard', 950).isNew, false);
  assert.deepEqual(loadBestTimes(st), { easy: 100, hard: 900 });
});

test('best times ignore junk input and junk storage', () => {
  const st = fakeStorage();
  for (const bad of [0, -1, NaN, Infinity, '12', null]) assert.equal(recordBestTime(st, 'normal', bad).isNew, false);
  assert.equal(recordBestTime(st, 'nightmare', 10).isNew, false);
  assert.deepEqual(loadBestTimes(st), {});
  const corrupt = fakeStorage({ [BEST_KEY]: JSON.stringify({ normal: 'fast', easy: -3, hard: 42, bogus: 1 }) });
  assert.deepEqual(loadBestTimes(corrupt), { hard: 42 });
  assert.deepEqual(recordBestTime(fakeStorage({}, { broken: true }), 'normal', 10), { isNew: true, best: 10 });
});
