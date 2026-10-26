// Which sound plays for which event. Pure data plus tiny lookups, so tests can
// check every NOISE kind and event maps to a voice that exists.
//
// Some sounds are not here because they're continuous rather than one event:
// Doodle's jingle / panting / snoring / sniffing / chewing / distant barks
// (doodle.js), the heartbeat and the music box + drone (music.js).

import { EVENTS } from '../core/events.js';
import { AUDIO_TUNING as T } from './tuning.js';

/** The NOISE kinds listed in events.js, plus 'tv', which World may emit when the TV flicks on. */
export const NOISE_KINDS = Object.freeze(['step', 'drop', 'door', 'container', 'squeak', 'creak', 'piano', 'blocks', 'splash', 'jeep', 'ball', 'dart', 'tv', 'other']);

/** NOISE kind → voice id. null = no sound here (FOOTSTEP already plays the player's steps). */
export const NOISE_SOUNDS = Object.freeze({
  step: null,
  drop: 'dropThud',
  door: 'doorCreak',
  container: 'drawer', // replaced by CONTAINER_SOUNDS when we know the container's kind
  squeak: 'squeak',
  creak: 'plankCreak',
  piano: 'toyPiano',
  blocks: 'blockClatter',
  splash: 'ballPitSplash',
  jeep: 'jeepEngine',
  ball: 'ballBounce',
  dart: 'dartPop',
  tv: 'tvStatic',
  other: 'thump',
});

/** Container kind → voice id, used for the NOISE that follows CONTAINER_OPENED/CLOSED. */
export const CONTAINER_SOUNDS = Object.freeze({ drawer: 'drawer', chest: 'lidCreak', cabinet: 'lidCreak', wardrobe: 'lidCreak' });

/** Unknown kinds fall back to a generic thump rather than silence. */
export function soundForNoise(kind) {
  return Object.hasOwn(NOISE_SOUNDS, kind) ? NOISE_SOUNDS[kind] : NOISE_SOUNDS.other;
}

/**
 * Event → sounds. Each cue: {sound, at, gain?, delay?, when?}
 *   at: 'pos'    → positional at payload.pos (payload.floorId)
 *       'doodle' → positional at Doodle's head
 *       'door'   → positional at the door named by payload.doorId
 *       null     → in your head (not positional)
 *   when: payload fields that must match for the cue to play.
 */
export const EVENT_SOUNDS = Object.freeze({
  [EVENTS.SPOTTED]: [
    { sound: 'growl', at: 'doodle' },
    { sound: 'chaseStinger', at: null, delay: 0.12 },
  ],
  [EVENTS.CAUGHT]: [{ sound: 'barkSting', at: null }],
  [EVENTS.LOST_TRACK]: [{ sound: 'huff', at: 'doodle' }],
  [EVENTS.DOODLE_STATE]: [
    { sound: 'yawn', at: 'doodle', when: { prev: 'sleep' } }, // it's awake
    { sound: 'jingle', at: 'doodle', gain: 1.3, delay: 1.1, when: { prev: 'sleep' } },
  ],
  [EVENTS.DOODLE_HIT]: [{ sound: 'yelp', at: 'doodle' }],
  [EVENTS.DOODLE_RECOVERED]: [
    { sound: 'jingle', at: 'doodle', gain: 1.4 },
    { sound: 'growl', at: 'doodle', gain: 0.45, delay: 0.3 },
  ],
  [EVENTS.TREAT_EATEN]: [{ sound: 'munch', at: 'doodle' }],
  [EVENTS.BALL_FETCHED]: [{ sound: 'jingle', at: 'doodle', gain: 1.2 }],
  [EVENTS.TREAT_DROPPED]: [{ sound: 'crinkle', at: 'pos' }],
  [EVENTS.BALL_THROWN]: [{ sound: 'whoosh', at: null, gain: 0.5 }],
  [EVENTS.DART_FIRED]: [{ sound: 'launch', at: null }],
  [EVENTS.PICKUP]: [{ sound: 'pickup', at: null }],
  [EVENTS.LOCK_OPENED]: [{ sound: 'unlock', at: null }],
  [EVENTS.EXIT_UNLOCKED]: [{ sound: 'exitUnlocked', at: null, delay: 0.4 }],
  [EVENTS.HIDE]: [{ sound: 'rustle', at: null }],
  [EVENTS.UNHIDE]: [{ sound: 'rustle', at: null, gain: 0.7 }],
  [EVENTS.LINK_ENTER]: [
    { sound: 'whoosh', at: null, when: { kind: 'slide' } },
    { sound: 'crawl', at: null, when: { kind: 'tunnel' } },
  ],
  [EVENTS.DOOR_CLOSED]: [{ sound: 'doorLatch', at: 'door', delay: 0.35 }],
  [EVENTS.DAY_START]: [{ sound: 'windup', at: null }],
  [EVENTS.WON]: [{ sound: 'escapeChime', at: null }],
  [EVENTS.GAME_OVER]: [{ sound: 'musicBoxDie', at: null }],
});

/** The cues for one event, after `when` filters. */
export function soundsForEvent(type, payload = {}) {
  const cues = EVENT_SOUNDS[type] ?? [];
  return cues.filter((c) => !c.when || Object.entries(c.when).every(([k, v]) => payload?.[k] === v));
}

/** Footstep loudness and tone by surface and gait. Crouched steps are nearly silent, as in the design. */
export function footstepParams({ surface = 'wood', sprint = false, crouch = false } = {}, t = T.footsteps) {
  const soft = surface === 'carpet' || surface === 'rug' || surface === 'balls';
  const hard = surface === 'tile' || surface === 'stone' || surface === 'concrete';
  const gain = crouch ? t.crouchGain : sprint ? t.sprintGain : t.gain;
  const cutoff = (soft ? 380 : hard ? 1600 : 800) * (sprint ? 1.3 : 1);
  return { gain: soft ? gain * 0.7 : gain, cutoff, heavy: sprint };
}
