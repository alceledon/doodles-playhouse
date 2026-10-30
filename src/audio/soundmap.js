// Which sound plays for which event. Pure data plus tiny lookups, so tests can
// check every NOISE kind and event maps to a voice that exists.
//
// Some sounds are not here because they're continuous rather than one event:
// Doodle's jingle / panting / snoring / sniffing / chewing / distant barks
// (doodle.js), the heartbeat and the music box + drone (music.js).
//
// Co-op: an event about the partner (see isPartnerPayload) never plays "in your
// head". Its in-head cues come from the partner instead (at: 'partner', see
// partnerCues), except the few that are music or a shared warning.

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
 * Event → sounds. Each cue: {sound, at, gain?, delay?, when?, partnerAt?}
 *   at: 'pos'     → positional at payload.pos (payload.floorId)
 *       'doodle'  → positional at Doodle's head
 *       'door'    → positional at the door named by payload.doorId
 *       'partner' → positional at the partner (payload.pos, else where they stand); never in your head
 *       null      → in your head (not positional)
 *   when: payload fields that must match for the cue to play.
 *   pass: payload fields handed to the voice (keypadClick's digit).
 *   partnerAt: where the cue plays when the event is the partner's. Without it, an in-head cue
 *     moves to 'partner' and a positioned one stays put. null keeps it in your head (music, a
 *     warning that's about both of you).
 */
export const EVENT_SOUNDS = Object.freeze({
  [EVENTS.SPOTTED]: [
    { sound: 'growl', at: 'doodle' },
    { sound: 'chaseStinger', at: null, delay: 0.12, partnerAt: null },
  ],
  // The partner's catch comes from Doodle, wherever it is, not from inside your head.
  [EVENTS.CAUGHT]: [{ sound: 'barkSting', at: null, partnerAt: 'doodle' }],
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
  [EVENTS.EXIT_UNLOCKED]: [{ sound: 'exitUnlocked', at: null, delay: 0.4, partnerAt: null }],
  [EVENTS.KEYPAD_ROLLED]: [{ sound: 'keypadClick', at: null, pass: ['digit'] }],
  [EVENTS.HIDE]: [{ sound: 'rustle', at: null }],
  [EVENTS.UNHIDE]: [{ sound: 'rustle', at: null, gain: 0.7 }],
  [EVENTS.LINK_ENTER]: [
    { sound: 'whoosh', at: null, when: { kind: 'slide' } },
    { sound: 'crawl', at: null, when: { kind: 'tunnel' } },
  ],
  [EVENTS.DOOR_CLOSED]: [{ sound: 'doorLatch', at: 'door', delay: 0.35 }],
  [EVENTS.DAY_START]: [{ sound: 'windup', at: null, partnerAt: null }],
  [EVENTS.WON]: [{ sound: 'escapeChime', at: null, partnerAt: null }],
  [EVENTS.GAME_OVER]: [{ sound: 'musicBoxDie', at: null, partnerAt: null }],
});

/** The cues for one event, after `when` filters. */
export function soundsForEvent(type, payload = {}) {
  const cues = EVENT_SOUNDS[type] ?? [];
  return cues.filter((c) => !c.when || Object.entries(c.when).every(([k, v]) => payload?.[k] === v));
}

/**
 * Is this event about the co-op partner rather than the local player? A playerId decides
 * (a replay of your own action, sent back by the host, is still yours); without one, a
 * replay (remote: true) is the partner's and anything else is local. Solo runs: always false.
 * @param {Object} payload
 * @param {'host'|'guest'} localId   the local player's id (player.id; 'host' when solo)
 */
export function isPartnerPayload(payload, localId = 'host') {
  const who = payload?.playerId;
  if (who !== undefined && who !== null) return who !== localId;
  return payload?.remote === true;
}

/** The cues for the partner's version of an event: in-head cues move to them (see partnerAt). */
export function partnerCues(type, payload = {}) {
  return soundsForEvent(type, payload).map((c) => {
    const at = Object.hasOwn(c, 'partnerAt') ? c.partnerAt : c.at === null ? 'partner' : c.at;
    return at === c.at ? c : { ...c, at };
  });
}

/** soundsForEvent or partnerCues, whichever this payload needs. */
export function cuesFor(type, payload = {}, localId = 'host') {
  return isPartnerPayload(payload, localId) ? partnerCues(type, payload) : soundsForEvent(type, payload);
}

/**
 * Where a partner sound comes from: the payload's own spot (pos, or a dart's origin), else
 * the partner's body at chest height. null when neither is known, and then it doesn't play.
 * @param {Object} payload
 * @param {{pos: {x: number, y: number, z: number}, floorId: string}|null} remote  the partner Player
 */
export function partnerPlace(payload, remote = null, chest = T.partner.chestHeight) {
  const pos = payload?.pos ?? payload?.origin ?? null;
  if (pos) return { pos, floorId: payload.floorId ?? remote?.floorId ?? null };
  if (remote?.pos) return { pos: { x: remote.pos.x, y: remote.pos.y + chest, z: remote.pos.z }, floorId: remote.floorId ?? null };
  return null;
}

/**
 * The floor the listener is on. Knocked out in co-op, the camera rides with the partner, so
 * their floor is the one that muffles sounds from the others.
 */
export function listenerFloor(player, remote = null) {
  if (player?.down && remote?.floorId) return remote.floorId;
  return player?.floorId ?? null;
}

/** Footstep loudness and tone by surface and gait. Crouched steps are nearly silent, as in the design. */
export function footstepParams({ surface = 'wood', sprint = false, crouch = false } = {}, t = T.footsteps) {
  const soft = surface === 'carpet' || surface === 'rug' || surface === 'balls';
  const hard = surface === 'tile' || surface === 'stone' || surface === 'concrete';
  const gain = crouch ? t.crouchGain : sprint ? t.sprintGain : t.gain;
  const cutoff = (soft ? 380 : hard ? 1600 : 800) * (sprint ? 1.3 : 1);
  return { gain: soft ? gain * 0.7 : gain, cutoff, heavy: sprint };
}
