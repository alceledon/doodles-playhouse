import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceGain,
  floorMuffle,
  floorsBetween,
  heartbeat,
  jingleInterval,
  lullabyParams,
  midiToHz,
  noiseRange,
  pantParams,
  reverbSend,
  tension,
  volumeToGain,
  approach,
} from '../../src/audio/curves.js';
import { AUDIO_TUNING as T } from '../../src/audio/tuning.js';

test('distance gain is full up close, falls off monotonically, and is silent at the range', () => {
  const curve = { ref: 1.5, rolloff: 0.85, range: 30 };
  assert.equal(distanceGain(0, curve), 1);
  assert.equal(distanceGain(1.5, curve), 1);
  let prev = 1;
  for (let d = 0; d <= 32; d += 0.5) {
    const g = distanceGain(d, curve);
    assert.ok(g >= 0 && g <= 1, `gain in [0,1] at ${d} m`);
    assert.ok(g <= prev + 1e-12, `non-increasing at ${d} m`);
    prev = g;
  }
  assert.equal(distanceGain(30, curve), 0);
  assert.equal(distanceGain(100, curve), 0);
  assert.equal(distanceGain(NaN, curve), 0);
});

test('the collar jingle is still audible across a big room (it is the main warning)', () => {
  assert.ok(distanceGain(10, T.doodle) > 0.1);
  assert.ok(distanceGain(20, T.doodle) > 0.03);
});

test('floors between sounds come from floor ids, or height when ids are missing', () => {
  assert.equal(floorsBetween('ground', 'ground'), 0);
  assert.equal(floorsBetween('basement', 'upstairs'), 2);
  assert.equal(floorsBetween('attic', 'basement'), 3);
  assert.equal(floorsBetween(null, 'ground', 3.2, 0.1), 1);
  assert.equal(floorsBetween(undefined, undefined, 0, 0.4), 0);
  assert.equal(floorsBetween(undefined, undefined), 0);
});

test('sounds through floors are quieter and duller, more so with each floor', () => {
  assert.deepEqual(floorMuffle(0), { gain: 1, cutoff: 20000 });
  const one = floorMuffle(1);
  const two = floorMuffle(2);
  assert.ok(one.gain < 1 && two.gain < one.gain);
  assert.ok(one.cutoff < 20000 && two.cutoff < one.cutoff);
});

test('a NOISE is audible further the louder it is, within limits', () => {
  assert.equal(noiseRange(0), T.oneShot.minRange);
  assert.equal(noiseRange(undefined), T.oneShot.minRange);
  assert.ok(noiseRange(8) > noiseRange(5));
  assert.equal(noiseRange(1000), T.oneShot.maxRange);
});

test('reverb send grows with distance', () => {
  assert.equal(reverbSend(0), T.reverbSend.near);
  assert.ok(reverbSend(8) > reverbSend(2));
  assert.equal(reverbSend(1000), T.reverbSend.far);
});

test('volume maps to a gain in [0, 1] and survives junk', () => {
  assert.equal(volumeToGain(0), 0);
  assert.equal(volumeToGain(1), 1);
  assert.ok(volumeToGain(0.5) > 0 && volumeToGain(0.5) < 0.5);
  assert.equal(volumeToGain(-3), 0);
  assert.equal(volumeToGain(7), 1);
  assert.equal(volumeToGain('loud'), 0);
});

test('the jingle speeds up with Doodle and stops when it stands still', () => {
  assert.equal(jingleInterval(0), Infinity);
  assert.equal(jingleInterval(undefined), Infinity);
  const patrol = jingleInterval(2.5);
  const chase = jingleInterval(4.6);
  assert.ok(Number.isFinite(patrol) && chase < patrol);
  assert.ok(jingleInterval(100) >= T.doodle.jingle.minInterval);
});

test('panting is faster and louder in a chase', () => {
  const calm = pantParams(0, false);
  const chase = pantParams(1, true);
  assert.ok(chase.interval < calm.interval);
  assert.ok(chase.gain > calm.gain);
});

test('the heartbeat rises as Doodle closes in, and a chase keeps it high', () => {
  assert.equal(heartbeat(Infinity).intensity, 0);
  assert.equal(heartbeat(50).intensity, 0);
  const far = heartbeat(12);
  const near = heartbeat(3);
  assert.ok(near.intensity > far.intensity);
  assert.ok(near.bpm > far.bpm);
  assert.ok(heartbeat(40, { chasing: true }).intensity >= T.heartbeat.chaseFloor);
  assert.ok(heartbeat(4, { sameFloor: false }).intensity < heartbeat(4).intensity);
  assert.ok(heartbeat(0).bpm <= T.heartbeat.maxBpm);
  assert.equal(heartbeat(1, { asleep: true }).intensity, 0, 'a sleeping Doodle is not scary yet');
});

test('tension: chase is maximal, alert states have a floor, distance does the rest', () => {
  assert.equal(tension(100, { state: 'chase' }), 1);
  assert.equal(tension(100, { state: 'patrol' }), 0);
  assert.equal(tension(100, { state: 'sniff' }), T.tension.alert);
  assert.ok(tension(5, { state: 'patrol' }) > tension(15, { state: 'patrol' }));
  assert.ok(tension(5, { state: 'sleep' }) < tension(5, { state: 'patrol' }));
});

test('the music box detunes, slows and misses notes as tension rises', () => {
  const calm = lullabyParams(0);
  const tense = lullabyParams(0.8);
  const chase = lullabyParams(1);
  assert.ok(tense.centsDepth > calm.centsDepth);
  assert.ok(tense.tempoMul > calm.tempoMul);
  assert.equal(calm.skipChance, 0);
  assert.ok(chase.gain <= tense.gain && chase.gain === T.music.chaseGain);
  assert.equal(lullabyParams(0, { inGame: false }).gain, T.music.titleGain);
});

test('approach() is frame-rate independent', () => {
  const once = approach(0, 1, 0.2, 0.5);
  let stepped = 0;
  for (let k = 0; k < 4; k++) stepped = approach(stepped, 1, 0.05, 0.5);
  assert.ok(Math.abs(once - stepped) < 1e-12);
  assert.equal(approach(3, 7, 1, 0), 7);
});

test('midiToHz', () => {
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(81) - 880) < 1e-9);
  assert.ok(Math.abs(midiToHz(69, 1200) - 880) < 1e-9);
});
