import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENTS } from '../../src/core/events.js';
import { CONTAINER_KINDS } from '../../src/core/contracts.js';
import { CONTAINER_SOUNDS, EVENT_SOUNDS, NOISE_KINDS, NOISE_SOUNDS, cuesFor, footstepParams, listenerFloor, partnerCues, partnerPlace, soundForNoise, soundsForEvent } from '../../src/audio/soundmap.js';
import { VOICES, VOICE_GROUPS } from '../../src/audio/synth.js';
import { LULLABY, LULLABY_BASS, noteBars, BEATS_PER_BAR } from '../../src/audio/melody.js';

test('every NOISE kind listed in events.js has an entry', () => {
  const src = readFileSync(new URL('../../src/core/events.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes("NOISE: 'noise'"));
  const kinds = [...line.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).filter((k) => k !== 'noise');
  assert.ok(kinds.length >= 10, 'parsed the kinds from the events.js comment');
  for (const k of kinds) {
    assert.ok(NOISE_KINDS.includes(k), `NOISE_KINDS has "${k}"`);
    assert.ok(Object.hasOwn(NOISE_SOUNDS, k), `NOISE_SOUNDS maps "${k}"`);
  }
});

test('every mapped voice exists', () => {
  for (const [kind, id] of Object.entries(NOISE_SOUNDS)) if (id !== null) assert.ok(VOICES[id], `NOISE "${kind}" → "${id}" exists`);
  for (const [kind, id] of Object.entries(CONTAINER_SOUNDS)) assert.ok(VOICES[id], `container "${kind}" → "${id}" exists`);
  for (const [type, cues] of Object.entries(EVENT_SOUNDS))
    for (const c of cues) {
      assert.ok(VOICES[c.sound], `${type} → "${c.sound}" exists`);
      assert.ok([null, 'pos', 'doodle', 'door'].includes(c.at), `${type} cue has a known "at"`);
    }
});

test('event sound keys are real events', () => {
  const known = new Set(Object.values(EVENTS));
  for (const type of Object.keys(EVENT_SOUNDS)) assert.ok(known.has(type), `"${type}" is in EVENTS`);
});

test('the required reactions are wired', () => {
  const ids = (type, payload) => soundsForEvent(type, payload).map((c) => c.sound);
  assert.ok(ids(EVENTS.SPOTTED).includes('growl'));
  assert.ok(ids(EVENTS.SPOTTED).includes('chaseStinger'));
  assert.ok(ids(EVENTS.CAUGHT).includes('barkSting'));
  for (const [kind, id] of [['door', 'doorCreak'], ['container', 'drawer'], ['squeak', 'squeak'], ['creak', 'plankCreak'], ['piano', 'toyPiano'], ['blocks', 'blockClatter'], ['splash', 'ballPitSplash'], ['jeep', 'jeepEngine'], ['ball', 'ballBounce'], ['dart', 'dartPop'], ['drop', 'dropThud']])
    assert.equal(soundForNoise(kind), id, `NOISE ${kind}`);
});

test('player steps are not doubled: FOOTSTEP plays them, NOISE "step" does not', () => {
  assert.equal(soundForNoise('step'), null);
});

test('unknown NOISE kinds still make a sound', () => {
  assert.equal(soundForNoise('kazoo'), NOISE_SOUNDS.other);
  assert.equal(soundForNoise(undefined), NOISE_SOUNDS.other);
});

test('every container kind has a sound', () => {
  for (const k of CONTAINER_KINDS) assert.ok(CONTAINER_SOUNDS[k], k);
});

test('`when` filters pick the right cue', () => {
  assert.deepEqual(soundsForEvent(EVENTS.LINK_ENTER, { kind: 'slide' }).map((c) => c.sound), ['whoosh']);
  assert.deepEqual(soundsForEvent(EVENTS.LINK_ENTER, { kind: 'tunnel' }).map((c) => c.sound), ['crawl']);
  assert.ok(soundsForEvent(EVENTS.DOODLE_STATE, { state: 'patrol', prev: 'sleep' }).some((c) => c.sound === 'yawn'));
  assert.deepEqual(soundsForEvent(EVENTS.DOODLE_STATE, { state: 'chase', prev: 'patrol' }), []);
  assert.deepEqual(soundsForEvent('notAnEvent'), []);
});

test('footsteps: sprint is loudest, crouch nearly silent, soft floors are muffled', () => {
  const walk = footstepParams({});
  const sprint = footstepParams({ sprint: true });
  const crouch = footstepParams({ crouch: true });
  assert.ok(sprint.gain > walk.gain && walk.gain > crouch.gain);
  assert.ok(crouch.gain < 0.1);
  assert.ok(footstepParams({ surface: 'carpet' }).cutoff < walk.cutoff);
  assert.ok(footstepParams({ surface: 'tile' }).cutoff > walk.cutoff);
  assert.equal(sprint.heavy, true);
});

test('every voice is on the dev sound board exactly once', () => {
  const listed = Object.values(VOICE_GROUPS).flat();
  assert.equal(new Set(listed).size, listed.length, 'no duplicates');
  assert.deepEqual([...listed].sort(), Object.keys(VOICES).sort());
});

test('the lullaby is whole bars of 3/4 with a bass note per bar', () => {
  const beats = LULLABY.reduce((a, n) => a + n.beats, 0);
  assert.equal(beats % BEATS_PER_BAR, 0);
  assert.equal(beats / BEATS_PER_BAR, LULLABY_BASS.length);
  const bars = noteBars();
  assert.equal(bars[0].downbeat, true);
  assert.equal(bars.filter((b) => b.downbeat).length, LULLABY_BASS.length);
});

// ---- co-op ---------------------------------------------------------------------

test('KEYPAD_ROLLED clicks, and the voice hears the digit', () => {
  const [c] = soundsForEvent(EVENTS.KEYPAD_ROLLED, { index: 1, digit: 3 });
  assert.equal(c.sound, 'keypadClick');
  assert.ok(VOICES.keypadClick);
  assert.deepEqual(c.pass, ['digit']);
});

test('the local player’s events sound as before; the partner’s never play in your head', () => {
  const local = cuesFor(EVENTS.PICKUP, { itemId: 'hammer' }, 'host');
  assert.deepEqual(local, soundsForEvent(EVENTS.PICKUP, {}), 'solo: unchanged');
  const replayed = { itemId: 'hammer', pos: { x: 1, y: 0, z: 2 }, playerId: 'guest', remote: true };
  for (const type of [EVENTS.PICKUP, EVENTS.HIDE, EVENTS.UNHIDE, EVENTS.KEYPAD_ROLLED, EVENTS.LOCK_OPENED, EVENTS.BALL_THROWN, EVENTS.DART_FIRED]) {
    const cues = cuesFor(type, replayed, 'host');
    assert.ok(cues.length > 0, type);
    for (const c of cues) assert.equal(c.at, 'partner', `${type} → ${c.sound} comes from the partner`);
  }
  for (const kind of ['slide', 'tunnel']) assert.ok(cuesFor(EVENTS.LINK_ENTER, { kind, playerId: 'guest' }, 'host').every((c) => c.at === 'partner'));
});

test('every in-head cue has a partner rule: from the partner, or kept on purpose', () => {
  const kept = new Set();
  for (const [type, cues] of Object.entries(EVENT_SOUNDS))
    for (const c of cues) {
      const p = { ...Object.fromEntries(Object.entries(c.when ?? {})), playerId: 'guest' };
      const pc = partnerCues(type, p).find((x) => x.sound === c.sound);
      assert.ok(pc, `${type} ${c.sound}`);
      if (c.at !== null) assert.equal(pc.at, c.at, `${type} ${c.sound}: positioned cues stay where they were`);
      else if (pc.at === null) kept.add(c.sound);
      assert.ok([null, 'pos', 'doodle', 'door', 'partner'].includes(pc.at));
    }
  // Only music and shared warnings stay in your head when the partner sets them off.
  assert.deepEqual([...kept].sort(), ['chaseStinger', 'escapeChime', 'exitUnlocked', 'musicBoxDie', 'windup']);
  assert.equal(partnerCues(EVENTS.CAUGHT, { playerId: 'guest' })[0].at, 'doodle', 'the partner’s catch comes from Doodle');
});

test('Doodle and world sounds replayed from the host keep their positions', () => {
  const fromHost = { playerId: 'host', remote: true };
  assert.deepEqual(cuesFor(EVENTS.SPOTTED, fromHost, 'guest').map((c) => c.at), ['doodle', null]);
  assert.deepEqual(cuesFor(EVENTS.DOOR_CLOSED, { ...fromHost, doorId: 'd' }, 'guest').map((c) => c.at), ['door']);
  assert.deepEqual(cuesFor(EVENTS.TREAT_DROPPED, { ...fromHost, pos: { x: 0, y: 0, z: 0 } }, 'guest').map((c) => c.at), ['pos']);
});

test('partnerPlace: the payload spot first, else the partner’s body, else nowhere', () => {
  const remote = { pos: { x: 4, y: 3, z: -2 }, floorId: 'upstairs' };
  assert.deepEqual(partnerPlace({ pos: { x: 1, y: 0, z: 1 }, floorId: 'ground' }, remote), { pos: { x: 1, y: 0, z: 1 }, floorId: 'ground' });
  assert.deepEqual(partnerPlace({ pos: { x: 1, y: 0, z: 1 } }, remote), { pos: { x: 1, y: 0, z: 1 }, floorId: 'upstairs' });
  assert.deepEqual(partnerPlace({ origin: { x: 2, y: 1, z: 0 } }, null), { pos: { x: 2, y: 1, z: 0 }, floorId: null }, 'a dart’s origin');
  assert.deepEqual(partnerPlace({}, remote, 1), { pos: { x: 4, y: 4, z: -2 }, floorId: 'upstairs' });
  assert.equal(partnerPlace({}, null), null);
});

test('listenerFloor: your own floor, or the partner’s while you watch through their eyes', () => {
  assert.equal(listenerFloor({ floorId: 'ground' }, null), 'ground');
  assert.equal(listenerFloor({ floorId: 'ground', down: false }, { floorId: 'attic' }), 'ground');
  assert.equal(listenerFloor({ floorId: 'ground', down: true }, { floorId: 'attic' }), 'attic');
  assert.equal(listenerFloor({ floorId: 'ground', down: true }, null), 'ground');
  assert.equal(listenerFloor(null), null);
});
