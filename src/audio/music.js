// Score: the music-box lullaby (title and game), the low drone (game only) and
// the heartbeat. A lookahead scheduler queues notes slightly ahead of time from
// update(), so frame hiccups don't make the box stutter.

import { approach, heartbeat, lullabyParams, tension } from './curves.js';
import { LULLABY, LULLABY_BASS, noteBars } from './melody.js';
import { AUDIO_TUNING as T } from './tuning.js';

const LOOKAHEAD = 0.15;
const BARS = noteBars();

export function createMusic(engine) {
  const r = engine.rand;
  let drone = null;
  let step = 0;
  let nextNote = 0;
  let nextBeat = 0;
  let tense = 0;
  let heart = 0;
  let mutedUntil = 0;

  function buildDrone() {
    const ac = engine.ac;
    const out = ac.createGain();
    out.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = T.music.droneCutoff;
    lp.Q.value = 3;
    lp.connect(out).connect(engine.nodes.music);
    const oscs = [
      ['sawtooth', 55, 0.5],
      ['sawtooth', 55.35, 0.5], // slow beating against the first
      ['triangle', 82.1, 0.35], // a slightly flat fifth
    ].map(([type, f, g]) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gg = ac.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(lp);
      o.start();
      return o;
    });
    // The filter breathes slowly.
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ac.createGain();
    lfoAmt.gain.value = 60;
    lfo.connect(lfoAmt).connect(lp.frequency);
    lfo.start();
    // Room tone: a dark hiss so silence never feels like a muted tab.
    const room = ac.createBufferSource();
    const len = ac.sampleRate * 2;
    room.buffer = ac.createBuffer(1, len, ac.sampleRate);
    const d = room.buffer.getChannelData(0);
    let lpState = 0;
    for (let i = 0; i < len; i++) {
      lpState += (r() * 2 - 1 - lpState) * 0.05;
      d[i] = lpState * 4;
    }
    room.loop = true;
    const roomGain = ac.createGain();
    roomGain.gain.value = 0;
    room.connect(roomGain).connect(engine.nodes.sfx);
    room.start();
    return { out, lp, roomGain, nodes: [...oscs, lfo, room] };
  }

  /**
   * @param {number} dt
   * @param {{inGame: boolean, dist: number, floors: number, state: string|null}} s
   *   dist: listener → Doodle (Infinity if none); floors: storeys between you
   */
  function update(dt, { inGame, dist, floors, state }) {
    if (!engine.ready()) return;
    const now = engine.now();
    if (!drone) drone = buildDrone();

    const sameFloor = floors === 0;
    tense = approach(tense, inGame ? tension(dist, { state, sameFloor }) : 0, dt, T.tension.smoothing);
    const m = T.music;
    drone.out.gain.setTargetAtTime(inGame ? m.droneGain + m.droneTensionGain * tense : 0, now, 0.6);
    drone.lp.frequency.setTargetAtTime(m.droneCutoff + m.droneTensionCutoff * tense, now, 0.6);
    drone.roomGain.gain.setTargetAtTime(inGame ? m.roomTone : 0, now, 0.6);

    // ---- lullaby
    const lp = lullabyParams(tense, { inGame });
    if (nextNote < now - 0.25) nextNote = now + 0.05; // after a stall (hidden tab), don't burst
    while (nextNote < now + LOOKAHEAD) {
      const k = step % LULLABY.length;
      const note = LULLABY[k];
      if (nextNote >= mutedUntil) {
        const cents = lp.centsDepth * (0.6 * Math.sin(nextNote * 0.37) + 0.4 * Math.sin(nextNote * 0.13 + 1) + 0.3 * (r() - 0.5)) - 25 * tense;
        if (r() >= lp.skipChance) engine.play('musicNote', { bus: 'music', time: nextNote, midi: note.m, cents, gain: lp.gain });
        if (BARS[k].downbeat)
          engine.play('musicNote', { bus: 'music', time: nextNote, midi: LULLABY_BASS[BARS[k].bar % LULLABY_BASS.length], cents: cents * 0.7, gain: lp.gain * m.bassGain });
      }
      nextNote += note.beats * m.beatSeconds * lp.tempoMul * (1 + (r() - 0.5) * 0.04 * (1 + 3 * tense));
      step++;
    }

    // ---- heartbeat
    const hb = inGame ? heartbeat(dist, { chasing: state === 'chase', sameFloor, asleep: state === 'sleep' }) : { intensity: 0, bpm: 60 };
    heart = approach(heart, hb.intensity, dt, T.heartbeat.smoothing);
    if (heart > T.heartbeat.threshold) {
      if (nextBeat < now) nextBeat = now + 0.05;
      while (nextBeat < now + LOOKAHEAD) {
        engine.play('heartbeat', { bus: 'heart', time: nextBeat, gain: heart * T.heartbeat.gain });
        nextBeat += 60 / Math.max(30, hb.bpm);
      }
    }
  }

  return {
    update,
    get tension() {
      return tense;
    },
    get heart() {
      return heart;
    },
    /** Start the lullaby from the top (a new day). */
    restart(delay = 0) {
      step = 0;
      nextNote = engine.now() + delay;
    },
    /** Silence the lullaby for a while (game over, escape stingers). */
    mute(seconds) {
      mutedUntil = engine.now() + seconds;
    },
    unmute() {
      mutedUntil = 0;
    },
    dispose() {
      for (const node of drone?.nodes ?? []) node.stop();
      drone?.out.disconnect();
      drone = null;
    },
  };
}
