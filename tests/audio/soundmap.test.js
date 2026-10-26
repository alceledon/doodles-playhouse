import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENTS } from '../../src/core/events.js';
import { CONTAINER_KINDS } from '../../src/core/contracts.js';
import { CONTAINER_SOUNDS, EVENT_SOUNDS, NOISE_KINDS, NOISE_SOUNDS, footstepParams, soundForNoise, soundsForEvent } from '../../src/audio/soundmap.js';
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
