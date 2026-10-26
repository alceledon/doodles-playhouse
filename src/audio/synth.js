// Every sound in the game, synthesized with Web Audio: no files, no network.
//
// A voice is (v, opts) => seconds, where v = {ac, out, t, r}:
//   ac   AudioContext (or OfflineAudioContext)
//   out  the node to connect into (the engine adds distance, panning, reverb)
//   t    start time in ac.currentTime units
//   r    cosmetic random () → [0, 1); never Math.random, so renders are repeatable
// It schedules its nodes and returns roughly how long it rings.
//
// Nothing here touches globals at import time, so tests can import VOICES.

import { midiToHz } from './curves.js';
import { clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const noiseCache = new WeakMap();
function noiseBuffer(ac) {
  let b = noiseCache.get(ac);
  if (!b) {
    b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = b.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < d.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = s / 2147483648 - 1;
    }
    noiseCache.set(ac, b);
  }
  return b;
}

// An impulse train with every harmonic equally loud: rung through narrow
// bandpass filters it makes wood creaks and buzzy voices.
const pulseCache = new WeakMap();
function pulseWave(ac) {
  let w = pulseCache.get(ac);
  if (!w) {
    const n = 96;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = 1;
    w = ac.createPeriodicWave(real, imag);
    pulseCache.set(ac, w);
  }
  return w;
}

const fuzzCurves = new Map();
function fuzz(v, k) {
  const ws = v.ac.createWaveShaper();
  if (!fuzzCurves.has(k)) {
    const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    fuzzCurves.set(k, c);
  }
  ws.curve = fuzzCurves.get(k);
  return ws;
}

/** Connect nodes in a row (the last may be an AudioParam); returns the last. */
function link(...nodes) {
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
  return nodes[nodes.length - 1];
}

function G(v, value = 0) {
  const g = v.ac.createGain();
  g.gain.value = value;
  return g;
}

function F(v, type, freq, Q = 1) {
  const f = v.ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

function osc(v, type, f, t0, t1, ...chain) {
  const o = v.ac.createOscillator();
  if (type === 'pulse') o.setPeriodicWave(pulseWave(v.ac));
  else o.type = type;
  o.frequency.setValueAtTime(f, t0);
  link(o, ...chain);
  o.start(t0);
  o.stop(t1);
  return o;
}

function noise(v, t0, t1, ...chain) {
  const s = v.ac.createBufferSource();
  s.buffer = noiseBuffer(v.ac);
  s.loop = true;
  link(s, ...chain);
  s.start(t0, v.r() * 1.9);
  s.stop(t1);
  return s;
}

/** Percussive envelope: near-silence → peak in `a` seconds → near-silence after `d` more. */
function perc(param, t, a, peak, d) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  param.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** Swell envelope: rise over `a`, hold until `t + hold`, fall over `rel`. */
function swell(param, t, a, peak, hold, rel) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  param.setValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, hold));
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(a, hold) + rel);
}

/** A pitched blip with an optional glide. Returns its end time. */
function blip(v, { type = 'sine', f, f2 = f, t = v.t, a = 0.003, d = 0.2, peak = 0.3, dest = v.out }) {
  const g = G(v);
  perc(g.gain, t, a, peak, d);
  const o = osc(v, type, f, t, t + a + d + 0.03, g, dest);
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  return t + a + d;
}

/** A filtered noise hit, with an optional filter sweep. Returns its end time. */
function hiss(v, { t = v.t, a = 0.002, d = 0.1, peak = 0.2, type = 'bandpass', f = 1000, f2 = f, Q = 1, dest = v.out }) {
  const flt = F(v, type, f, Q);
  if (f2 !== f) {
    flt.frequency.setValueAtTime(f, t);
    flt.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  }
  const g = G(v);
  perc(g.gain, t, a, peak, d);
  noise(v, t, t + a + d + 0.03, flt, g, dest);
  return t + a + d;
}

/** Stick-slip creak: an impulse train whose rate wanders, rung through wooden resonances. */
function creak(v, { t = v.t, dur = 0.9, rate = [20, 45], formants = [[700, 9], [1400, 12]], peak = 0.35, dest = v.out }) {
  const out = G(v);
  out.connect(dest);
  // Stick-slip comes in uneven pushes, so the level bumps around.
  out.gain.setValueAtTime(0.0001, t);
  const steps = 6;
  for (let k = 1; k <= steps; k++) out.gain.linearRampToValueAtTime(k === steps ? 0.0001 : peak * (0.35 + v.r() * 0.65), t + (dur * k) / steps);
  const excite = G(v, 9); // makeup gain: narrow bandpasses keep only a few harmonics
  for (const [f, q] of formants) link(excite, F(v, 'bandpass', f * (0.9 + v.r() * 0.2), q), out);
  const o = osc(v, 'pulse', rate[0], t, t + dur + 0.05, excite);
  for (let k = 1; k <= 4; k++) o.frequency.linearRampToValueAtTime(rate[0] + (rate[1] - rate[0]) * v.r(), t + (dur * k) / 4);
  return dur;
}

/** One music-box tine: a pure tone with a faint metallic overtone and a pin pluck. */
function tine(v, f, t, peak, dest = v.out) {
  const d = clamp(2.6 - f / 800, 0.5, 2.2); // high tines ring shorter
  blip(v, { f, t, a: 0.002, d, peak, dest });
  blip(v, { f: f * 3.98, t, a: 0.001, d: d * 0.25, peak: peak * 0.16, dest });
  blip(v, { f: f * 6.27, t, a: 0.001, d: d * 0.08, peak: peak * 0.07, dest });
  hiss(v, { t, a: 0.001, d: 0.006, peak: peak * 0.12, f: 5000, Q: 2, dest });
  return t + d;
}

/** A toy-piano key: a struck metal rod, brighter and shorter than a tine. */
function toyKey(v, f, t, peak) {
  blip(v, { f, t, a: 0.002, d: 0.9, peak, type: 'triangle' });
  blip(v, { f: f * 2, t, a: 0.002, d: 0.4, peak: peak * 0.3 });
  blip(v, { f: f * 5.04, t, a: 0.001, d: 0.12, peak: peak * 0.2 });
  hiss(v, { t, a: 0.001, d: 0.012, peak: peak * 0.3, f: 3500, Q: 1.5 });
  return t + 0.95;
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export const VOICES = {
  // ---- Doodle ----------------------------------------------------------------

  /** Collar tag and bell clinking: 2-3 tiny inharmonic hits. */
  jingle(v, o = {}) {
    const g = o.gain ?? 1;
    const hits = 2 + Math.floor(v.r() * 2);
    let end = v.t;
    for (let k = 0; k < hits; k++) {
      const t = v.t + k * (0.018 + v.r() * 0.03);
      const f = 2300 + v.r() * 1300;
      const peak = g * (0.2 + v.r() * 0.1) * (k ? 0.7 : 1);
      for (const [ratio, amp, dec] of [[1, 1, 0.28], [2.76, 0.5, 0.16], [5.4, 0.25, 0.08]])
        end = Math.max(end, blip(v, { f: f * ratio, t, a: 0.002, d: dec * (0.7 + v.r() * 0.6), peak: peak * amp }));
      hiss(v, { t, a: 0.001, d: 0.02, peak: peak * 0.4, type: 'highpass', f: 6000 });
    }
    return end - v.t;
  },

  /** One pant: a breathy "hah" out, a thinner breath in. */
  pant(v, o = {}) {
    const g = o.gain ?? 1;
    const ex = 0.15 + v.r() * 0.05;
    for (const [f, q, amp] of [[1000, 1.4, 1], [2300, 2, 0.5]])
      hiss(v, { t: v.t, a: 0.03, d: ex, peak: 0.5 * g * amp, f: f * (0.9 + v.r() * 0.2), Q: q });
    const ti = v.t + ex + 0.06;
    hiss(v, { t: ti, a: 0.04, d: 0.1, peak: 0.16 * g, f: 1900, Q: 1.5 });
    return ti + 0.2 - v.t;
  },

  /** A low rough growl: a buzzing tone chopped at ~26 Hz, distorted and dulled. */
  growl(v, o = {}) {
    const g = o.gain ?? 1;
    const t = v.t;
    const dur = o.duration ?? 1.4;
    const out = G(v);
    out.connect(v.out);
    swell(out.gain, t, 0.22, 0.9 * g, dur - 0.4, 0.4);
    const rough = G(v, 0.55);
    osc(v, 'square', 22 + v.r() * 9, t, t + dur, G(v, 0.45), rough.gain);
    link(rough, fuzz(v, 3), F(v, 'lowpass', 700, 0.8), out);
    const f0 = 85 + v.r() * 15;
    const saw = osc(v, 'sawtooth', f0 * 0.9, t, t + dur, rough);
    saw.frequency.linearRampToValueAtTime(f0 * 1.1, t + dur * 0.4);
    saw.frequency.linearRampToValueAtTime(f0 * 0.85, t + dur);
    noise(v, t, t + dur, F(v, 'bandpass', 320, 1.2), G(v, 0.7), rough);
    return dur;
  },

  /** A woof: a falling buzzy tone through dog-mouth formants. pitch < 1 = bigger dog. */
  bark(v, o = {}) {
    const g = o.gain ?? 1;
    const t = v.t;
    const p = (o.pitch ?? 1) * (0.92 + v.r() * 0.16);
    const dur = 0.2 * (o.long ?? 1);
    const out = G(v);
    out.connect(v.out);
    perc(out.gain, t, 0.008, 0.8 * g, dur);
    const body = G(v, 1);
    const shaper = link(body, fuzz(v, o.drive ?? 2.5));
    for (const [f, q, amp] of [[600, 3, 1], [1300, 4, 0.6], [2400, 5, 0.25]]) link(shaper, F(v, 'bandpass', f * p, q), G(v, amp * 2), out);
    const saw = osc(v, 'sawtooth', 430 * p, t, t + dur + 0.05, body);
    saw.frequency.exponentialRampToValueAtTime(230 * p, t + dur);
    noise(v, t, t + dur + 0.05, G(v, 0.3), body);
    return dur + 0.1;
  },

  /** CAUGHT: a huge close bark over a sub hit and a dissonant stab. */
  barkSting(v) {
    const t = v.t;
    VOICES.bark(v, { gain: 1.4, pitch: 0.72, drive: 6, long: 1.7 });
    VOICES.bark({ ...v, t: t + 0.03 }, { gain: 0.8, pitch: 0.55, drive: 8, long: 1.4 });
    blip(v, { f: 70, f2: 30, t, a: 0.004, d: 0.55, peak: 1 });
    hiss(v, { t, a: 0.002, d: 0.6, peak: 0.35, type: 'lowpass', f: 3000, f2: 300 });
    const lp = F(v, 'lowpass', 5000, 1.5);
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 1.5);
    const out = G(v);
    perc(out.gain, t, 0.01, 0.3, 1.5);
    link(lp, out, v.out);
    for (const m of [45, 46, 51, 57, 58]) osc(v, 'sawtooth', midiToHz(m), t, t + 1.6, lp);
    return 1.7;
  },

  /** Chase start: a timpani hit, a low tritone cluster and a bending screech. */
  chaseStinger(v) {
    const t = v.t;
    blip(v, { f: 90, f2: 45, t, a: 0.005, d: 0.8, peak: 0.8 });
    hiss(v, { t, a: 0.002, d: 0.25, peak: 0.3, type: 'lowpass', f: 900 });
    const out = G(v);
    out.connect(v.out);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.25, t + 0.18);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const lp = F(v, 'lowpass', 2400, 0.7);
    lp.connect(out);
    for (const [m, cents] of [[33, -12], [33, 9], [39, 0], [40, 6]]) osc(v, 'sawtooth', midiToHz(m, cents), t, t + 2.3, lp);
    const sg = G(v);
    perc(sg.gain, t + 0.02, 0.15, 0.08, 1.8);
    sg.connect(v.out);
    const sc = osc(v, 'sine', 1900, t, t + 2.2, sg);
    sc.frequency.exponentialRampToValueAtTime(1250, t + 2);
    osc(v, 'sine', 7, t, t + 2.2, G(v, 40), sc.frequency); // vibrato
    return 2.4;
  },

  /** Sleep breathing: a slow fluttering rumble in, a soft sigh out. */
  snore(v, o = {}) {
    const g = o.gain ?? 1;
    const t = v.t;
    const out = G(v);
    out.connect(v.out);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5 * g, t + 0.9);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    const flutter = G(v, 0.6);
    osc(v, 'sine', 20 + v.r() * 6, t, t + 1.6, G(v, 0.4), flutter.gain);
    link(flutter, out);
    noise(v, t, t + 1.6, F(v, 'lowpass', 420, 2.5), G(v, 1.5), flutter);
    osc(v, 'triangle', 68, t, t + 1.6, G(v, 0.25), flutter);
    hiss(v, { t: t + 1.5, a: 0.15, d: 0.7, peak: 0.12 * g, f: 900, Q: 0.8 });
    return 2.4;
  },

  /** Lost you: a frustrated huff and a short whine. */
  huff(v) {
    hiss(v, { a: 0.02, d: 0.3, peak: 0.45, f: 900, Q: 1 });
    blip(v, { type: 'triangle', f: 650, f2: 470, t: v.t + 0.25, a: 0.05, d: 0.4, peak: 0.07 });
    return 0.8;
  },

  /** Dart hit: a sharp yelp that bends up then falls. */
  yelp(v) {
    const t = v.t;
    const out = G(v);
    perc(out.gain, t, 0.01, 0.5, 0.32);
    link(out, v.out);
    const bp = F(v, 'bandpass', 1700, 1.2);
    link(bp, fuzz(v, 2), out);
    const o = osc(v, 'triangle', 900, t, t + 0.4, bp);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(650, t + 0.33);
    return 0.4;
  },

  /** Stunned: Doodle gnawing the squeaky dart. */
  chew(v, o = {}) {
    const g = o.gain ?? 1;
    if (v.r() < 0.6) VOICES.squeak(v, { gain: 0.5 * g, pitch: 1.15 + v.r() * 0.3 });
    hiss(v, { t: v.t + 0.05, a: 0.004, d: 0.06, peak: 0.2 * g, f: 2200, Q: 1 });
    return 0.6;
  },

  /** Treat eaten: wet crunches. */
  munch(v) {
    let t = v.t;
    for (let k = 0; k < 6; k++) {
      hiss(v, { t, a: 0.003, d: 0.04 + v.r() * 0.03, peak: 0.35, f: 2400 + v.r() * 800, Q: 1 });
      hiss(v, { t, a: 0.004, d: 0.05, peak: 0.2, type: 'lowpass', f: 600 });
      t += 0.1 + v.r() * 0.08;
    }
    return t - v.t + 0.1;
  },

  /** Catch cutscene: a big wet slurp right in your face. */
  lick(v, o = {}) {
    const g = o.gain ?? 1;
    const t = v.t;
    hiss(v, { t, a: 0.05, d: 0.28, peak: 0.6 * g, f: 500, f2: 2200, Q: 4 });
    hiss(v, { t, a: 0.03, d: 0.2, peak: 0.3 * g, type: 'lowpass', f: 900 });
    blip(v, { f: 300, f2: 620, t: t + 0.2, a: 0.01, d: 0.07, peak: 0.25 * g });
    return 0.45;
  },

  /** Sniffing: quick sharp inhales. */
  sniff(v, o = {}) {
    const g = o.gain ?? 1;
    const n = 2 + Math.floor(v.r() * 2);
    for (let k = 0; k < n; k++) hiss(v, { t: v.t + k * 0.13, a: 0.02, d: 0.07, peak: 0.45 * g, f: 2800, Q: 1.5 });
    return n * 0.13 + 0.1;
  },

  /** Waking up: a stretchy whining yawn. */
  yawn(v) {
    const t = v.t;
    const out = G(v);
    swell(out.gain, t, 0.15, 0.12, 0.8, 0.35);
    out.connect(v.out);
    const o = osc(v, 'triangle', 500, t, t + 1.2, F(v, 'bandpass', 1200, 1.5), out);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    o.frequency.exponentialRampToValueAtTime(420, t + 1.1);
    hiss(v, { t, a: 0.3, d: 0.8, peak: 0.15, f: 800, Q: 0.7 });
    return 1.3;
  },

  // ---- music and stingers ----------------------------------------------------

  /** Lub-dub: two dull thumps, the second softer. */
  heartbeat(v, o = {}) {
    const g = o.gain ?? 0.8;
    const t = v.t;
    blip(v, { f: 62, f2: 38, t, a: 0.008, d: 0.13, peak: 0.9 * g });
    hiss(v, { t, a: 0.004, d: 0.07, peak: 0.35 * g, type: 'lowpass', f: 220 });
    blip(v, { f: 70, f2: 44, t: t + 0.19, a: 0.008, d: 0.11, peak: 0.65 * g });
    hiss(v, { t: t + 0.19, a: 0.004, d: 0.05, peak: 0.25 * g, type: 'lowpass', f: 200 });
    return 0.4;
  },

  /** One music-box note. opts: {midi, cents, gain} */
  musicNote(v, o = {}) {
    return tine(v, midiToHz(o.midi ?? 81, o.cents ?? 0), v.t, 0.3 * (o.gain ?? 1)) - v.t;
  },

  /** Day card: one deep bell toll. */
  toll(v) {
    const f = 98;
    for (const [ratio, amp, dec] of [[0.5, 0.45, 6], [1, 0.55, 5], [1.19, 0.3, 3.5], [1.5, 0.18, 3], [2, 0.4, 2.5], [2.52, 0.12, 1.6], [3.01, 0.1, 1.2], [4.2, 0.06, 0.7]])
      blip(v, { f: f * ratio * (1 + (v.r() - 0.5) * 0.004), a: 0.004, d: dec, peak: 0.35 * amp });
    hiss(v, { a: 0.002, d: 0.05, peak: 0.08, type: 'lowpass', f: 1500 });
    return 6;
  },

  /** A new day: the music box being wound. */
  windup(v) {
    let t = v.t;
    let gap = 0.085;
    for (let k = 0; k < 10; k++) {
      hiss(v, { t, a: 0.001, d: 0.012, peak: 0.3, f: 3500, Q: 3 });
      blip(v, { f: 2100, t, a: 0.001, d: 0.015, peak: 0.06 });
      t += gap;
      gap *= 0.96;
    }
    blip(v, { f: 330, f2: 300, t, a: 0.002, d: 0.5, peak: 0.08, type: 'triangle' }); // spring settling
    return t - v.t + 0.5;
  },

  /** Game over: the music box running down, slowing and sagging flat. */
  musicBoxDie(v) {
    const notes = [76, 74, 71, 69, 68, 64];
    let t = v.t;
    let gap = 0.5;
    notes.forEach((m, k) => {
      tine(v, midiToHz(m, -60 * k * k * 0.3), t, 0.28 * (1 - k * 0.12));
      t += gap;
      gap *= 1.3;
    });
    return t - v.t + 1.5;
  },

  /** Escape: a rising major arpeggio, finally in tune. */
  escapeChime(v) {
    [72, 76, 79, 84, 88].forEach((m, k) => tine(v, midiToHz(m), v.t + k * 0.14, 0.26));
    tine(v, midiToHz(96), v.t + 0.9, 0.1);
    return 2.6;
  },

  /** The night outside: a few crickets. opts: {duration} */
  crickets(v, o = {}) {
    const dur = o.duration ?? 6;
    const t0 = v.t;
    for (const f of [4200, 4650, 5100]) {
      const g = G(v);
      g.gain.setValueAtTime(0, t0);
      let t = t0 + v.r() * 0.6;
      while (t < t0 + dur - 0.3) {
        const amp = 0.04 * (0.6 + v.r() * 0.4) * Math.min(1, (t - t0) / 1.5); // fade in
        for (let p = 0; p < 3; p++) {
          g.gain.setValueAtTime(amp, t + p * 0.03);
          g.gain.setValueAtTime(0, t + p * 0.03 + 0.018);
        }
        t += 0.5 + v.r() * 0.45;
      }
      osc(v, 'sine', f * (0.98 + v.r() * 0.04), t0, t0 + dur, g, v.out);
    }
    return dur;
  },

  // ---- world noises --------------------------------------------------------

  doorCreak(v) {
    return creak(v, { dur: 0.9 + v.r() * 0.4, rate: [18, 50], formants: [[620, 8], [1250, 10], [2300, 12]], peak: 0.45 });
  },

  doorLatch(v) {
    hiss(v, { a: 0.001, d: 0.02, peak: 0.35, f: 2500, Q: 2 });
    blip(v, { f: 140, f2: 90, a: 0.003, d: 0.09, peak: 0.45 });
    hiss(v, { t: v.t + 0.05, a: 0.001, d: 0.015, peak: 0.2, f: 3200, Q: 2 });
    return 0.3;
  },

  /** A wooden drawer sliding, then knocking against its stop. */
  drawer(v) {
    const t = v.t;
    const out = G(v);
    swell(out.gain, t, 0.05, 0.35, 0.28, 0.06);
    out.connect(v.out);
    const rough = G(v, 0.6);
    osc(v, 'square', 40 + v.r() * 15, t, t + 0.45, G(v, 0.4), rough.gain);
    noise(v, t, t + 0.45, F(v, 'bandpass', 850 + v.r() * 200, 1.2), rough, out);
    blip(v, { f: 160, f2: 100, t: t + 0.36, a: 0.002, d: 0.08, peak: 0.4 });
    hiss(v, { t: t + 0.36, a: 0.001, d: 0.02, peak: 0.25, f: 2000, Q: 1.5 });
    return 0.6;
  },

  /** A chest lid, cabinet or wardrobe door: a short creak, then a thunk. */
  lidCreak(v) {
    const dur = creak(v, { dur: 0.5 + v.r() * 0.2, rate: [25, 60], formants: [[800, 8], [1600, 10]], peak: 0.4 });
    blip(v, { f: 120, f2: 70, t: v.t + dur, a: 0.003, d: 0.12, peak: 0.45 });
    hiss(v, { t: v.t + dur, a: 0.002, d: 0.05, peak: 0.2, type: 'lowpass', f: 900 });
    return dur + 0.2;
  },

  /** A rubber squeaky toy: squeeze up with a wobble, then a thin re-inflating wheeze. */
  squeak(v, o = {}) {
    const g = o.gain ?? 1;
    const t = v.t;
    const p = (o.pitch ?? 1) * (0.9 + v.r() * 0.25);
    const dur = 0.22 + v.r() * 0.1;
    const out = G(v);
    perc(out.gain, t, 0.015, 0.45 * g, dur);
    out.connect(v.out);
    const s = osc(v, 'triangle', 700 * p, t, t + dur + 0.05, F(v, 'bandpass', 2000 * p, 0.9), out);
    s.frequency.exponentialRampToValueAtTime(1600 * p, t + 0.06);
    s.frequency.exponentialRampToValueAtTime(1150 * p, t + dur);
    osc(v, 'sine', 28, t, t + dur, G(v, 60 * p), s.frequency);
    hiss(v, { t, d: dur, peak: 0.04 * g, f: 3000 });
    const t2 = t + dur + 0.08;
    const w = G(v);
    perc(w.gain, t2, 0.02, 0.14 * g, 0.12);
    w.connect(v.out);
    const s2 = osc(v, 'triangle', 1300 * p, t2, t2 + 0.17, F(v, 'bandpass', 2200 * p, 1), w);
    s2.frequency.exponentialRampToValueAtTime(1700 * p, t2 + 0.14);
    return t2 + 0.17 - t;
  },

  /** A creaky floorboard: a deep short groan. */
  plankCreak(v) {
    return creak(v, { dur: 0.45 + v.r() * 0.2, rate: [12, 30], formants: [[340, 7], [760, 9], [1500, 10]], peak: 0.6 });
  },

  /** A bumped toy piano: a few clashing keys at once. opts: {notes} */
  toyPiano(v, o = {}) {
    const base = 72 + Math.floor(v.r() * 6);
    const cluster = [base, base + 1, base + 6, base + (v.r() < 0.5 ? 11 : 13)];
    const notes = o.notes ?? cluster.slice(0, 2 + Math.floor(v.r() * 3));
    let end = v.t;
    notes.forEach((m, k) => (end = Math.max(end, toyKey(v, midiToHz(m, (v.r() - 0.5) * 30), v.t + k * 0.02 + v.r() * 0.03, 0.22))));
    return end - v.t;
  },

  /** A toppled block tower: wooden knocks that spread out as the blocks settle. */
  blockClatter(v) {
    let t = v.t;
    let gap = 0.04;
    const n = 7 + Math.floor(v.r() * 6);
    for (let k = 0; k < n; k++) {
      const amp = 0.45 * (1 - k / (n + 2)) * (0.6 + v.r() * 0.4);
      hiss(v, { t, a: 0.001, d: 0.03 + v.r() * 0.04, peak: amp, f: 1400 + v.r() * 1600, Q: 5 });
      blip(v, { type: 'triangle', f: 380 + v.r() * 500, t, a: 0.001, d: 0.05, peak: amp * 0.6 });
      t += gap * (0.5 + v.r());
      gap *= 1.15;
    }
    return t - v.t + 0.1;
  },

  /** Landing in the ball pit: a whump and a cascade of hollow plastic clicks. */
  ballPitSplash(v) {
    const t0 = v.t;
    hiss(v, { t: t0, a: 0.04, d: 0.5, peak: 0.3, type: 'lowpass', f: 1800, f2: 400 });
    blip(v, { f: 90, f2: 50, t: t0, d: 0.25, peak: 0.6 });
    for (let k = 0; k < 45; k++) {
      const t = t0 + 0.02 + v.r() ** 2 * 0.9; // dense at first
      const amp = 0.14 * (0.4 + v.r() * 0.6) * (1 - (t - t0) / 1.1);
      blip(v, { f: 900 + v.r() * 1100, t, a: 0.001, d: 0.025, peak: amp });
      hiss(v, { t, a: 0.001, d: 0.012, peak: amp * 0.5, f: 3500 + v.r() * 2000, Q: 3 });
    }
    return 1.2;
  },

  /** The Jeep: a starter crank, then the engine catches and revs. opts: {drive} skips the crank. */
  jeepEngine(v, o = {}) {
    const t = v.t;
    const driving = !!o.drive;
    const dur = o.duration ?? (driving ? 4.5 : 3.2);
    let tc = t;
    if (!driving) {
      for (let k = 0; k < 3; k++) {
        const tk = t + k * 0.25;
        const cg = G(v);
        perc(cg.gain, tk, 0.02, 0.25, 0.16);
        cg.connect(v.out);
        const chop = G(v, 0.5);
        osc(v, 'square', 14, tk, tk + 0.2, G(v, 0.5), chop.gain);
        osc(v, 'triangle', 140, tk, tk + 0.2, chop, cg);
      }
      tc = t + 0.75;
    }
    const out = G(v);
    swell(out.gain, tc, 0.1, 0.5, dur - 0.6, 0.6);
    const lp = F(v, 'lowpass', 900, 1);
    link(lp, out, v.out);
    const pre = G(v, 0.5);
    link(pre, fuzz(v, 4), lp);
    const f0 = driving ? 50 : 34;
    for (const [type, mul] of [['sawtooth', 1], ['square', 0.5], ['sawtooth', 1.02]]) {
      const e = osc(v, type, f0 * mul, tc, tc + dur, pre);
      e.frequency.linearRampToValueAtTime((driving ? 64 : 58) * mul, tc + 0.6);
      e.frequency.linearRampToValueAtTime((driving ? 60 : 40) * mul, tc + 1.6);
    }
    noise(v, tc, tc + dur, F(v, 'lowpass', 300), G(v, 0.4), lp);
    return tc - t + dur;
  },

  /** A tennis ball bouncing to rest. */
  ballBounce(v, o = {}) {
    let t = v.t;
    let gap = 0.42;
    let amp = 0.5 * (o.gain ?? 1);
    for (let k = 0; k < 5; k++) {
      blip(v, { f: 210, f2: 110, t, a: 0.002, d: 0.07, peak: amp });
      hiss(v, { t, a: 0.001, d: 0.03, peak: amp * 0.4, type: 'lowpass', f: 1200 });
      t += gap;
      gap *= 0.68;
      amp *= 0.62;
    }
    return t - v.t + 0.1;
  },

  /** A foam dart smacking into something. */
  dartPop(v) {
    hiss(v, { a: 0.001, d: 0.05, peak: 0.4, f: 1500, Q: 1.2 });
    blip(v, { f: 240, f2: 110, a: 0.002, d: 0.06, peak: 0.45 });
    blip(v, { f: 620, f2: 300, t: v.t + 0.04, a: 0.002, d: 0.04, peak: 0.15 });
    return 0.2;
  },

  /** The launcher firing: a springy thwip. */
  launch(v) {
    blip(v, { type: 'triangle', f: 300, f2: 1600, a: 0.002, d: 0.07, peak: 0.3 });
    hiss(v, { a: 0.005, d: 0.15, peak: 0.22, f: 2000, f2: 800, Q: 1.5 });
    hiss(v, { a: 0.001, d: 0.01, peak: 0.3, f: 4000, Q: 2 });
    return 0.25;
  },

  dropThud(v) {
    blip(v, { f: 120, f2: 55, a: 0.003, d: 0.16, peak: 0.6 });
    hiss(v, { a: 0.002, d: 0.07, peak: 0.3, type: 'lowpass', f: 600 });
    return 0.25;
  },

  /** Generic knock for NOISE kinds we don't know. */
  thump(v) {
    blip(v, { f: 85, f2: 60, a: 0.003, d: 0.22, peak: 0.5 });
    hiss(v, { a: 0.001, d: 0.015, peak: 0.25, f: 1800, Q: 1.5 });
    return 0.3;
  },

  /** The old TV: crackly static over mains hum. opts: {duration} */
  tvStatic(v, o = {}) {
    const t = v.t;
    const dur = o.duration ?? 3;
    const out = G(v);
    out.connect(v.out);
    out.gain.setValueAtTime(0.0001, t);
    for (let x = 0; x < dur; x += 0.03) out.gain.setValueAtTime((0.12 + v.r() * 0.18) * Math.min(1, (dur - x) / 0.3), t + x);
    out.gain.setValueAtTime(0.0001, t + dur);
    noise(v, t, t + dur, F(v, 'highpass', 900, 0.7), out);
    osc(v, 'sawtooth', 120, t, t + dur, F(v, 'lowpass', 400), G(v, 0.25), out);
    osc(v, 'sine', 15600, t, t + dur, G(v, 0.03), out); // flyback whine
    return dur;
  },

  // ---- the player ------------------------------------------------------------

  /** One step. opts from soundmap.footstepParams: {gain, cutoff, heavy} */
  footstep(v, o = {}) {
    const t = v.t;
    const g = o.gain ?? 0.3;
    const heavy = !!o.heavy;
    hiss(v, { t, a: 0.004, d: heavy ? 0.12 : 0.08, peak: g, type: 'lowpass', f: o.cutoff ?? 800, Q: 0.8 });
    blip(v, { f: heavy ? 95 : 120, f2: 60, t, a: 0.003, d: heavy ? 0.12 : 0.07, peak: g * 0.8 });
    if (v.r() < 0.12) creak(v, { t: t + 0.02, dur: 0.18, rate: [30, 60], formants: [[520, 8]], peak: g * 0.3 });
    return 0.3;
  },

  pickup(v) {
    hiss(v, { a: 0.01, d: 0.12, peak: 0.12, f: 2500, Q: 0.7 });
    blip(v, { f: 1300, f2: 1500, t: v.t + 0.05, a: 0.002, d: 0.04, peak: 0.08 });
    return 0.2;
  },

  /** A lock giving way: click-clack, a clunk and a little metal ring. */
  unlock(v) {
    const t = v.t;
    hiss(v, { t, a: 0.001, d: 0.015, peak: 0.35, f: 3000, Q: 2 });
    hiss(v, { t: t + 0.09, a: 0.001, d: 0.015, peak: 0.3, f: 2600, Q: 2 });
    blip(v, { type: 'triangle', f: 180, f2: 120, t: t + 0.09, a: 0.002, d: 0.06, peak: 0.25 });
    blip(v, { f: 2300, t: t + 0.09, a: 0.001, d: 0.35, peak: 0.06 });
    blip(v, { f: 3150, t: t + 0.09, a: 0.001, d: 0.25, peak: 0.04 });
    return 0.5;
  },

  /** A whole exit is open: three hopeful music-box notes. */
  exitUnlocked(v) {
    [84, 88, 91].forEach((m, k) => tine(v, midiToHz(m), v.t + k * 0.12, 0.22));
    return 1.6;
  },

  /** Cloth rustling (hiding, crawling). */
  rustle(v, o = {}) {
    const g = o.gain ?? 1;
    let t = v.t;
    for (let k = 0; k < 5; k++) {
      hiss(v, { t, a: 0.02, d: 0.06 + v.r() * 0.04, peak: (0.1 + v.r() * 0.1) * g, f: 2500, Q: 0.6 });
      t += 0.05 + v.r() * 0.05;
    }
    return t - v.t + 0.15;
  },

  whoosh(v, o = {}) {
    const g = o.gain ?? 1;
    const t = v.t;
    const flt = F(v, 'bandpass', 300, 1.5);
    flt.frequency.setValueAtTime(300, t);
    flt.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    flt.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const out = G(v);
    swell(out.gain, t, 0.2, 0.4 * g, 0.3, 0.3);
    noise(v, t, t + 0.65, flt, out, v.out);
    return 0.65;
  },

  /** Into a crawl tunnel: knees on wood and a rustle. */
  crawl(v) {
    for (let k = 0; k < 3; k++) blip(v, { f: 100, f2: 70, t: v.t + k * 0.28, a: 0.003, d: 0.08, peak: 0.25 });
    VOICES.rustle(v, { gain: 0.7 });
    return 0.9;
  },

  /** A treat bag crinkling. */
  crinkle(v) {
    for (let k = 0; k < 25; k++)
      hiss(v, { t: v.t + v.r() * 0.4, a: 0.001, d: 0.006 + v.r() * 0.009, peak: 0.05 + v.r() * 0.1, f: 4000 + v.r() * 3000, Q: 2 });
    return 0.5;
  },

  /** Catch cutscene: your body hitting the floor. */
  thud(v) {
    blip(v, { f: 75, f2: 32, a: 0.003, d: 0.35, peak: 0.9 });
    hiss(v, { a: 0.002, d: 0.2, peak: 0.5, type: 'lowpass', f: 500 });
    return 0.4;
  },

  /** Waking after a catch: a sharp breath in. */
  gasp(v) {
    hiss(v, { a: 0.12, d: 0.3, peak: 0.25, f: 1200, f2: 2600, Q: 1.5 });
    return 0.5;
  },
};

/** Sound board groups for the dev page; every voice appears once (tests check). */
export const VOICE_GROUPS = Object.freeze({
  doodle: ['jingle', 'pant', 'growl', 'bark', 'barkSting', 'snore', 'sniff', 'yawn', 'huff', 'yelp', 'chew', 'munch', 'lick'],
  music: ['chaseStinger', 'heartbeat', 'musicNote', 'toll', 'windup', 'musicBoxDie', 'escapeChime', 'exitUnlocked', 'crickets'],
  world: ['doorCreak', 'doorLatch', 'drawer', 'lidCreak', 'squeak', 'plankCreak', 'toyPiano', 'blockClatter', 'ballPitSplash', 'jeepEngine', 'ballBounce', 'dartPop', 'dropThud', 'thump', 'tvStatic'],
  player: ['footstep', 'pickup', 'unlock', 'rustle', 'whoosh', 'crawl', 'crinkle', 'launch', 'thud', 'gasp'],
});
