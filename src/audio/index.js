// Audio entry point: createAudio({ bus, camera }) → Audio (see contracts.js).
// Wires bus events to voices (soundmap.js), runs Doodle's continuous sounds
// (doodle.js) and the score (music.js), and keeps the HRTF listener on the
// camera. Everything is synthesized (synth.js); there are no audio files.

import { EVENTS } from '../core/events.js';
import { setCueTarget, setDuckTarget } from './cues.js';
import { createDoodleVoice } from './doodle.js';
import { createEngine } from './engine.js';
import { createMusic } from './music.js';
import { noiseRange } from './curves.js';
import { CONTAINER_SOUNDS, EVENT_SOUNDS, footstepParams, soundForNoise, soundsForEvent } from './soundmap.js';
import { VOICES } from './synth.js';
import { AUDIO_TUNING as T } from './tuning.js';

/** createAudio({ bus, camera }) → Audio */
export function createAudio({ bus, camera }) {
  const engine = createEngine();
  const music = createMusic(engine);
  const dog = createDoodleVoice(engine);
  let world = null;
  let doodle = null;
  let containerKind = null; // kind of the container that just opened/closed, for the NOISE that follows

  // Browsers only allow sound after a user gesture. main.js calls unlock() after
  // the title screen, but we also listen ourselves so the title music starts on
  // the first click, and so ?difficulty=… (no title click) still gets sound.
  const gestureEvents = ['pointerdown', 'keydown', 'touchend'];
  const onGesture = () => {
    engine.start();
    if (engine.ready()) for (const e of gestureEvents) removeEventListener(e, onGesture, true);
  };
  for (const e of gestureEvents) addEventListener(e, onGesture, true);
  // Creating a context before any gesture logs a warning and starts suspended.
  const mayStart = () => !globalThis.navigator?.userActivation || navigator.userActivation.hasBeenActive;

  const subs = [];
  const on = (type, fn) => subs.push(bus.on(type, fn));

  on(EVENTS.NOISE, ({ pos, floorId, loudness, kind }) => {
    let id = soundForNoise(kind);
    if (kind === 'container' && containerKind) id = CONTAINER_SOUNDS[containerKind] ?? id;
    containerKind = null;
    if (id && pos) engine.play(id, { pos, floorId, range: noiseRange(loudness) });
  });

  on(EVENTS.FOOTSTEP, (p) => engine.play('footstep', footstepParams(p)));

  const rememberContainer = ({ containerId }) => {
    containerKind = world?.containers?.find((c) => c.id === containerId)?.kind ?? null;
  };
  on(EVENTS.CONTAINER_OPENED, rememberContainer);
  on(EVENTS.CONTAINER_CLOSED, rememberContainer);

  // Table-driven one-shots (soundmap.js EVENT_SOUNDS).
  function playCue(c, payload) {
    const opts = { gain: c.gain ?? 1, delay: c.delay ?? 0 };
    if (c.at === 'doodle') {
      if (dog.play(c.sound, opts)) return;
      if (doodle) return; // known but inaudible this frame: stay quiet rather than play in your head
    } else if (c.at === 'pos' && payload?.pos) {
      return engine.play(c.sound, { ...opts, pos: payload.pos, floorId: payload.floorId });
    } else if (c.at === 'door') {
      const door = world?.doors?.find((d) => d.id === payload?.doorId);
      if (door) return engine.play(c.sound, { ...opts, pos: { ...door.pos, y: door.pos.y + 1 }, floorId: door.floorId });
    }
    engine.play(c.sound, opts);
  }
  for (const type of Object.keys(EVENT_SOUNDS)) on(type, (payload) => soundsForEvent(type, payload).forEach((c) => playCue(c, payload)));

  // Run flow and the score.
  on(EVENTS.RUN_START, () => {
    music.unmute();
    engine.setPaused(false);
    engine.setDuck(1, 0.3);
  });
  on(EVENTS.DAY_START, () => {
    music.unmute();
    music.restart(1.1); // after the wind-up
    engine.setDuck(1, 0.5);
  });
  on(EVENTS.PAUSED, () => engine.setPaused(true));
  on(EVENTS.RESUMED, () => engine.setPaused(false));
  on(EVENTS.GAME_OVER, () => music.mute(7));
  on(EVENTS.WON, () => music.mute(4));
  on(EVENTS.CAUGHT, () => music.mute(3.5));

  setCueTarget((name, opts) => engine.play(name, opts));
  setDuckTarget((level, seconds) => engine.setDuck(level, seconds));

  return {
    unlock() {
      if (mayStart()) engine.start();
    },
    setVolume(v) {
      engine.setVolume(v);
    },
    update(dt, ctx = {}) {
      world = ctx.world ?? null;
      doodle = ctx.doodle ?? null;
      if (!engine.ready()) return;
      const player = ctx.player ?? null;
      engine.setListener(ctx.camera ?? camera, player?.floorId);
      const heard = dog.update(dt, doodle);
      music.update(dt, {
        inGame: !!player,
        dist: heard?.dist ?? Infinity,
        floors: heard?.floors ?? 0,
        state: doodle?.state ?? null,
      });
    },
    dispose() {
      for (const off of subs) off();
      for (const e of gestureEvents) removeEventListener(e, onGesture, true);
      setCueTarget(null);
      setDuckTarget(null);
      music.dispose();
      dog.dispose();
      engine.dispose();
    },

    // ---- extras for the dev page and debugging (not in the contract) ----
    /** Play any voice now: play(id, {pos, floorId, gain, ...}). */
    play: (id, opts) => engine.play(id, opts),
    voices: Object.keys(VOICES),
    measure: (id, params, seconds) => engine.measure(id, params, seconds),
    engine,
    get state() {
      return {
        context: engine.ac?.state ?? 'none',
        tension: music.tension,
        heart: music.heart,
        doodle: dog.last,
        voiceCap: T.voiceCap,
      };
    },
  };
}
