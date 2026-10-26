// Runs every synth voice against a strict fake AudioContext. It can't tell us
// how a voice sounds, but it catches wiring bugs (connecting to nothing),
// NaN parameters and exponential ramps to zero, which real Web Audio rejects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES } from '../../src/audio/synth.js';
import { createRng } from '../../src/core/rng.js';

function fakeContext() {
  const errors = [];
  const finite = (v, what) => Number.isFinite(v) || errors.push(`${what} got ${v}`);
  const param = (name, value = 0) => ({
    __param: name,
    value,
    setValueAtTime: (v, t) => (finite(v, `${name}.setValueAtTime`), finite(t, `${name} time`)),
    linearRampToValueAtTime: (v, t) => (finite(v, `${name}.linearRamp`), finite(t, `${name} time`)),
    exponentialRampToValueAtTime: (v, t) => {
      finite(v, `${name}.exponentialRamp`);
      finite(t, `${name} time`);
      if (v === 0) errors.push(`${name}.exponentialRamp to 0`);
    },
    setTargetAtTime: (v, t, c) => (finite(v, `${name}.setTarget`), finite(c, `${name} timeConstant`)),
  });
  let nodes = 0;
  const node = (kind, params = {}) => {
    nodes++;
    const n = {
      __node: kind,
      connections: 0,
      connect(dest) {
        if (!dest || !(dest.__node || dest.__param)) errors.push(`${kind}.connect(${dest})`);
        n.connections++;
        return dest;
      },
      disconnect() {},
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, param(`${kind}.${k}`, v)])),
    };
    return n;
  };
  const source = (kind, params) => {
    const n = node(kind, params);
    n.start = (t = 0) => finite(t, `${kind}.start`);
    n.stop = (t = 0) => finite(t, `${kind}.stop`);
    return n;
  };
  const ac = {
    sampleRate: 8000,
    currentTime: 0,
    createGain: () => node('gain', { gain: 1 }),
    createBiquadFilter: () => Object.assign(node('filter', { frequency: 350, Q: 1, gain: 0 }), { type: 'lowpass' }),
    createOscillator: () => Object.assign(source('osc', { frequency: 440, detune: 0 }), { type: 'sine', setPeriodicWave() {} }),
    createBufferSource: () => Object.assign(source('buffer', { playbackRate: 1 }), { buffer: null, loop: false }),
    createWaveShaper: () => Object.assign(node('shaper'), { curve: null }),
    createPeriodicWave: () => ({}),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ac, errors, count: () => nodes };
}

for (const [id, voice] of Object.entries(VOICES)) {
  test(`voice "${id}" schedules cleanly`, () => {
    const { ac, errors, count } = fakeContext();
    const out = ac.createGain();
    const rng = createRng(id);
    const dur = voice({ ac, out, t: 0.5, r: () => rng.next() }, {});
    assert.deepEqual(errors, []);
    assert.ok(Number.isFinite(dur) && dur > 0, `returns a positive duration (got ${dur})`);
    assert.ok(dur < 12, 'rings for a sane time');
    assert.ok(count() > 1, 'builds some nodes');
  });
}
