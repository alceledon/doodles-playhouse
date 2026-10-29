// Audio entry point: createAudio({ bus, camera }) → Audio (see contracts.js).
// Wires bus events to voices (soundmap.js), runs Doodle's continuous sounds
// (doodle.js) and the score (music.js), and keeps the HRTF listener on the
// camera. Everything is synthesized (synth.js); there are no audio files.
//
// Co-op: the partner's events (soundmap.js#isPartnerPayload) play where the
// partner is, never in your head. The heartbeat and Doodle's sounds are heard
// from the one listener, the camera, so they're always about what you hear.

import { EVENTS } from '../core/events.js';
import { setCueTarget, setDuckTarget } from './cues.js';
import { createDoodleVoice } from './doodle.js';
import { createEngine } from './engine.js';
import { createMusic } from './music.js';
import { noiseRange } from './curves.js';
import { CONTAINER_SOUNDS, EVENT_SOUNDS, cuesFor, footstepParams, isPartnerPayload, listenerFloor, partnerPlace, soundForNoise } from './soundmap.js';
import { VOICES } from './synth.js';
import { AUDIO_TUNING as T } from './tuning.js';

/** createAudio({ bus, camera }) → Audio */
export function createAudio({ bus, camera }) {
  const engine = createEngine();
  const music = createMusic(engine);
  const dog = createDoodleVoice(engine);
  let world = null;
  let doodle = null;
  let remote = null; // co-op: the partner Player (update's ctx.remote)
  let localId = 'host'; // the local player's id; a solo run is 'host'
  let containerKind = null; // kind of the container that just opened/closed, for the NOISE that follows

  // Browsers only allow sound after a user gesture. main.js calls unlock() after
  // the title screen, but we also listen ourselves so the title music starts on
  // the first click, and so ?difficulty=… (no title click) still gets sound.
  // iOS only counts the end of a touch (touchend, pointerup, click) as a gesture.
  const gestureEvents = ['pointerdown', 'keydown', 'touchend', 'pointerup', 'click'];
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

  on(EVENTS.FOOTSTEP, (p) => {
    if (!isPartnerPayload(p, localId)) return engine.play('footstep', footstepParams(p));
    const at = partnerPlace(p, remote);
    if (at) engine.play('footstep', { ...footstepParams(p), ...at, range: T.partner.footstepRange });
  });

  const rememberContainer = ({ containerId }) => {
    containerKind = world?.containers?.find((c) => c.id === containerId)?.kind ?? null;
  };
  on(EVENTS.CONTAINER_OPENED, rememberContainer);
  on(EVENTS.CONTAINER_CLOSED, rememberContainer);

  // Table-driven one-shots (soundmap.js EVENT_SOUNDS).
  function playCue(c, payload, partner) {
    const opts = { gain: c.gain ?? 1, delay: c.delay ?? 0 };
    for (const k of c.pass ?? []) if (payload?.[k] !== undefined) opts[k] = payload[k];
    if (c.at === 'partner') {
      const at = partnerPlace(payload, remote);
      if (at) engine.play(c.sound, { ...opts, ...at, range: T.partner.range });
      return; // nowhere to put it: stay quiet rather than play in your head
    }
    if (c.at === 'doodle') {
      if (dog.play(c.sound, opts)) return;
      if (doodle) return; // known but inaudible this frame: stay quiet rather than play in your head
    } else if (c.at === 'pos' && payload?.pos) {
      return engine.play(c.sound, { ...opts, pos: payload.pos, floorId: payload.floorId });
    } else if (c.at === 'door') {
      const door = world?.doors?.find((d) => d.id === payload?.doorId);
      if (door) return engine.play(c.sound, { ...opts, pos: { ...door.pos, y: door.pos.y + 1 }, floorId: door.floorId });
    }
    if (partner && c.at !== null) return; // the partner's sound, unplaced: never in your head
    engine.play(c.sound, opts);
  }
  for (const type of Object.keys(EVENT_SOUNDS))
    on(type, (payload) => {
      const partner = isPartnerPayload(payload, localId);
      for (const c of cuesFor(type, payload, localId)) playCue(c, payload, partner);
    });

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
  // A knocked-out partner's catch doesn't stop your run, so the lullaby goes on.
  on(EVENTS.CAUGHT, (p) => !isPartnerPayload(p, localId) && music.mute(3.5));

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
      remote = ctx.remote ?? null;
      const player = ctx.player ?? null;
      if (player?.id) localId = player.id;
      if (!engine.ready()) return;
      engine.setListener(ctx.camera ?? camera, listenerFloor(player, remote));
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
