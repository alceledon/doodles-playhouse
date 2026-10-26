// The Web Audio graph: context, mix buses, house reverb, the HRTF listener, and
// play(): one-shot voices, optionally positioned in the house.
//
//   voices ─► [distance gain ─► floor lowpass ─► HRTF panner] ─► sfx ─┐
//                                     └► reverb send ─► convolver ─────┤
//   music box / drone ─► music ──────────────────────────────────────┤
//   heartbeat ─► heart ───────────────────────────────────────────────┴► master (volume) ─► duck ─► pause lowpass ─► limiter ─► out
//
// The context is created lazily from a user gesture (browser autoplay rules).

import { createRng } from '../core/rng.js';
import { dist } from '../core/math.js';
import { distanceGain, floorMuffle, floorsBetween, reverbSend, volumeToGain } from './curves.js';
import { VOICES } from './synth.js';
import { AUDIO_TUNING as T } from './tuning.js';

export function createEngine() {
  // Cosmetic randomness only (pitch jitter, bark timing): it never affects a run.
  const rng = createRng('doodle-audio');
  const r = () => rng.next();

  let ac = null;
  let n = null; // graph nodes
  let volume = 0.8;
  let paused = false;
  let active = 0;
  const listener = { pos: { x: 0, y: 0, z: 0 }, floorId: null };

  const ready = () => !!ac && ac.state === 'running';

  /** Create or resume the context. Returns true if it exists. */
  function start() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return true;
    }
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return false;
    ac = new Ctx({ latencyHint: 'interactive' });
    build();
    return true;
  }

  function build() {
    const gain = (v) => {
      const g = ac.createGain();
      g.gain.value = v;
      return g;
    };
    n = {
      master: gain(volumeToGain(volume)),
      pauseLp: ac.createBiquadFilter(),
      limiter: ac.createDynamicsCompressor(),
      sfx: gain(T.buses.sfx),
      music: gain(T.buses.music),
      heart: gain(T.buses.heart),
      reverbIn: gain(1),
      reverb: ac.createConvolver(),
      reverbOut: gain(T.buses.reverbReturn),
      musicSend: gain(0.35),
      duck: gain(1),
    };
    n.pauseLp.type = 'lowpass';
    n.pauseLp.frequency.value = 20000;
    n.limiter.threshold.value = -6;
    n.limiter.knee.value = 6;
    n.limiter.ratio.value = 8;
    n.limiter.attack.value = 0.003;
    n.limiter.release.value = 0.2;
    n.reverb.buffer = impulse(T.reverb.seconds, T.reverb.decay);
    n.sfx.connect(n.master);
    n.music.connect(n.master);
    n.heart.connect(n.master);
    n.music.connect(n.musicSend).connect(n.reverbIn);
    n.reverbIn.connect(n.reverb).connect(n.reverbOut).connect(n.master);
    n.master.connect(n.duck).connect(n.pauseLp).connect(n.limiter).connect(ac.destination);
  }

  /** A generated room: stereo noise with an exponential tail, darker as it decays. */
  function impulse(seconds, decay) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const smooth = 0.2 + 0.75 * k; // more smoothing = less treble later in the tail
        lp += (r() * 2 - 1 - lp) * (1 - smooth);
        d[i] = lp * (1 - k) ** decay;
      }
    }
    return buf;
  }

  function setPos(node, prefix, p, smooth) {
    const t = ac.currentTime;
    const [x, y, z] = prefix === 'position' ? ['positionX', 'positionY', 'positionZ'] : prefix === 'forward' ? ['forwardX', 'forwardY', 'forwardZ'] : ['upX', 'upY', 'upZ'];
    if (smooth) {
      node[x].setTargetAtTime(p.x, t, smooth);
      node[y].setTargetAtTime(p.y, t, smooth);
      node[z].setTargetAtTime(p.z, t, smooth);
    } else {
      node[x].value = p.x;
      node[y].value = p.y;
      node[z].value = p.z;
    }
  }

  function makePanner(pos) {
    const p = ac.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.rolloffFactor = 0; // we attenuate ourselves (curves.js), so distance and floors agree everywhere
    if (p.positionX) setPos(p, 'position', pos);
    else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  /** Copy the camera into the Web Audio listener. Reads matrixWorld so it needs no three import. */
  function setListener(camera, floorId) {
    if (!ac || !camera) return;
    camera.updateMatrixWorld?.();
    const e = camera.matrixWorld.elements;
    const pos = { x: e[12], y: e[13], z: e[14] };
    const fwd = { x: -e[8], y: -e[9], z: -e[10] };
    const up = { x: e[4], y: e[5], z: e[6] };
    listener.pos = pos;
    listener.floorId = floorId ?? listener.floorId;
    const L = ac.listener;
    if (L.positionX) {
      setPos(L, 'position', pos, 0.012);
      setPos(L, 'forward', fwd, 0.012);
      setPos(L, 'up', up, 0.012);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Gain, lowpass and reverb send for a source at pos/floorId, as heard by the listener now. */
  function placement(pos, floorId, curve) {
    const d = dist(listener.pos, pos);
    const floors = floorsBetween(floorId, listener.floorId, pos.y, listener.pos.y);
    const m = floorMuffle(floors);
    return { dist: d, floors, gain: distanceGain(d, curve) * m.gain, cutoff: m.cutoff, send: reverbSend(d) };
  }

  /**
   * Play a voice.
   * @param {string} id  a key of VOICES
   * @param {Object} [o]
   *   pos, floorId  position it in the house (else it plays "in your head")
   *   range         audible distance for a positional sound (m)
   *   gain, delay   linear gain; seconds from now
   *   time          absolute start time (ac.currentTime units), instead of delay
   *   bus           'sfx' | 'music' | 'heart'
   *   dest          an AudioNode to play into instead (e.g. Doodle's emitter)
   *   ...rest       passed to the voice
   * @returns {boolean} false if it didn't play (no context, too far, too busy)
   */
  function play(id, { pos = null, floorId = null, range = null, gain = 1, delay = 0, time = null, bus = 'sfx', dest = null, ...params } = {}) {
    if (!ready()) return false;
    const voice = VOICES[id];
    if (!voice) {
      console.warn(`[audio] unknown voice "${id}"`);
      return false;
    }
    if (active >= T.voiceCap) return false;
    const t = time ?? ac.currentTime + 0.01 + Math.max(0, delay);
    const input = ac.createGain();
    input.gain.value = gain * (T.trim[id] ?? 1);
    const chain = [input];
    if (dest) input.connect(dest);
    else if (pos) {
      const curve = { ...T.oneShot, range: range ?? T.oneShot.minRange };
      const p = placement(pos, floorId, curve);
      if (p.gain < 0.002) return false; // too far to hear: skip the work
      const att = ac.createGain();
      att.gain.value = p.gain;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = p.cutoff;
      const pan = makePanner(pos);
      const send = ac.createGain();
      send.gain.value = p.send;
      input.connect(att).connect(lp).connect(pan).connect(n[bus] ?? n.sfx);
      lp.connect(send).connect(n.reverbIn);
      chain.push(att, lp, pan, send);
    } else input.connect(n[bus] ?? n.sfx);

    let dur = 1;
    try {
      dur = voice({ ac, out: input, t, r }, params);
    } catch (err) {
      console.error(`[audio] voice "${id}" failed`, err);
    }
    active++;
    const wait = Math.max(0, t - ac.currentTime) + dur + 0.5;
    setTimeout(() => {
      active--;
      for (const node of chain) node.disconnect();
    }, wait * 1000);
    return true;
  }

  /**
   * A persistent positional source (Doodle). Voices play into `input` via
   * play(id, {dest: emitter.input}); place() moves it every frame.
   */
  function emitter(curve) {
    const input = ac.createGain();
    const att = ac.createGain();
    att.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    const pan = makePanner(listener.pos);
    const send = ac.createGain();
    send.gain.value = 0;
    input.connect(att).connect(lp).connect(pan).connect(n.sfx);
    lp.connect(send).connect(n.reverbIn);
    return {
      input,
      /** Move it; returns {dist, floors}. */
      place(pos, floorId) {
        const p = placement(pos, floorId, curve);
        const t = ac.currentTime;
        att.gain.setTargetAtTime(p.gain, t, 0.05);
        lp.frequency.setTargetAtTime(p.cutoff, t, 0.05);
        send.gain.setTargetAtTime(p.send, t, 0.1);
        if (pan.positionX) setPos(pan, 'position', pos, 0.02);
        else pan.setPosition(pos.x, pos.y, pos.z);
        return p;
      },
      silence() {
        att.gain.setTargetAtTime(0, ac.currentTime, 0.1);
      },
      dispose() {
        for (const node of [input, att, lp, pan, send]) node.disconnect();
      },
    };
  }

  function applyMaster() {
    if (!n) return;
    const t = ac.currentTime;
    n.master.gain.setTargetAtTime(volumeToGain(volume) * (paused ? T.pause.gain : 1), t, 0.05);
    n.pauseLp.frequency.setTargetAtTime(paused ? T.pause.cutoff : 20000, t, 0.08);
  }

  /**
   * Render one voice offline and report its level, for calibrating gains
   * (the dev page's "measure" button), trim included. Peak and loudest-50 ms RMS, in dBFS.
   */
  async function measure(id, params = {}, seconds = 3) {
    const Offline = globalThis.OfflineAudioContext;
    const voice = VOICES[id];
    if (!Offline || !voice) return null;
    const off = new Offline(1, Math.ceil(44100 * seconds), 44100);
    const out = off.createGain();
    out.gain.value = T.trim[id] ?? 1;
    out.connect(off.destination);
    const mrng = createRng(`measure-${id}`);
    voice({ ac: off, out, t: 0.01, r: () => mrng.next() }, params);
    const data = (await off.startRendering()).getChannelData(0);
    let peak = 0;
    let bad = 0;
    for (const x of data) {
      if (!Number.isFinite(x)) bad++;
      else peak = Math.max(peak, Math.abs(x));
    }
    // Loudness of the loudest 50 ms, a fair way to compare short and long sounds.
    const win = Math.floor(off.sampleRate * 0.05);
    let loudest = 0;
    for (let i = 0; i + win <= data.length; i += win >> 1) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += Number.isFinite(data[j]) ? data[j] * data[j] : 0;
      loudest = Math.max(loudest, sum / win);
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return { id, peakDb: db(peak), loudDb: db(Math.sqrt(loudest)), nonFinite: bad };
  }

  return {
    get ac() {
      return ac;
    },
    get nodes() {
      return n;
    },
    listener,
    rand: r,
    ready,
    start,
    now: () => ac?.currentTime ?? 0,
    play,
    emitter,
    placement,
    setListener,
    measure,
    setVolume(v) {
      volume = Number.isFinite(v) ? v : volume;
      applyMaster();
    },
    setPaused(on) {
      paused = !!on;
      applyMaster();
    },
    /** Fade the whole mix to `level` (1 = normal) over roughly `seconds`. */
    setDuck(level, seconds = 0.5) {
      if (n) n.duck.gain.setTargetAtTime(Math.max(0, level), ac.currentTime, Math.max(0.01, seconds / 3));
    },
    dispose() {
      if (ac && ac.state !== 'closed') ac.close().catch(() => {});
      ac = null;
      n = null;
    },
  };
}
