// What the two games say to each other. Pure (node tests it).
//
// Two kinds of traffic, both under the sender's half of the room (room.js):
//  - Latest-wins channels (CHANNELS): the newest value replaces the last; a lost one doesn't
//    matter. Poses and the Doodle at ~10 Hz, the host's Gameplay snapshot when it changes.
//  - An ordered message list: ev/{seqKey} holds a JSON array of messages. Writes can land out of
//    order, so the reader delivers by sequence number and waits for gaps.
// Values travel as JSON strings, so the database never reshapes them (it drops nulls and empty
// objects and turns arrays into maps).

import { EVENTS } from '../core/events.js';

/** Latest-wins channels, and who writes each. */
export const CHANNELS = Object.freeze({ pose: 'both', doodle: 'host', state: 'host' });
export const CHANNEL_NAMES = Object.freeze(Object.keys(CHANNELS));

/**
 * Message types on the ordered list:
 *   hello {name}                          guest → host, on joining
 *   start {seed, difficulty, rule, names} host → guest: the run begins (names = {host, guest})
 *   bus   {event, payload}                either way: replay this event on the partner's bus
 *   intent {intent}                       guest → host: a Gameplay action to run for the guest
 *   flow  {step, ...}                     host → guest: run flow (day start, catch, escape...)
 *   ping  {id, t} / pong {id, t}          either way: round-trip time
 *   bye   {reason}                        either way: leaving on purpose
 */
export const MESSAGE_TYPES = Object.freeze(['hello', 'start', 'bus', 'intent', 'flow', 'ping', 'pong', 'bye']);

/**
 * Events each side forwards to the partner's bus, where they replay with `remote: true` and the
 * sender's playerId. The host forwards everything the guest should hear or see happen; the guest
 * forwards only what its own body does, which the host's Doodle senses. Run flow (CAUGHT,
 * ESCAPED, DAY_START...) never travels this way: main.js sends `flow` messages for it.
 */
export const FORWARDED = Object.freeze({
  host: Object.freeze(new Set([
    EVENTS.NOISE, EVENTS.FOOTSTEP, EVENTS.PICKUP, EVENTS.DROP, EVENTS.LOCK_OPENED, EVENTS.EXIT_UNLOCKED,
    EVENTS.HIDE, EVENTS.UNHIDE, EVENTS.LINK_ENTER, EVENTS.LINK_EXIT, EVENTS.TRAP, EVENTS.KEYPAD_ROLLED,
    EVENTS.BALL_THROWN, EVENTS.BALL_LANDED, EVENTS.TREAT_DROPPED, EVENTS.DART_FIRED, EVENTS.JEEP_STARTED,
    EVENTS.DOODLE_STATE, EVENTS.SPOTTED, EVENTS.LOST_TRACK, EVENTS.BALL_FETCHED, EVENTS.BALL_RETURNED,
    EVENTS.TREAT_EATEN, EVENTS.DOODLE_HIT, EVENTS.DOODLE_STUNNED, EVENTS.DOODLE_RECOVERED,
    EVENTS.DOOR_OPENED, EVENTS.DOOR_CLOSED, EVENTS.CONTAINER_OPENED, EVENTS.CONTAINER_CLOSED,
  ])),
  guest: Object.freeze(new Set([
    EVENTS.NOISE, EVENTS.FOOTSTEP, EVENTS.HIDE, EVENTS.UNHIDE, EVENTS.LINK_ENTER, EVENTS.LINK_EXIT,
  ])),
});

/**
 * Should this local event go to the partner? Never a replay (that would echo forever), and only
 * the local player's own: on the host, events about the guest (playerId 'guest') are the guest's
 * already. Positions are plain objects already, so the payload goes as is.
 * @param {'host'|'guest'} role
 */
export function shouldForward(role, type, payload) {
  if (!FORWARDED[role]?.has(type)) return false;
  if (payload?.remote) return false;
  return true;
}

/** The payload as the partner's bus gets it. A missing playerId means the sender's own player. */
export const replayPayload = (senderRole, payload) => ({ ...payload, playerId: payload?.playerId ?? senderRole, remote: true });

const SEQ_DIGITS = 9;
/** 7 → 'e000000007': sorts like the number, and is a legal RTDB key. */
export const seqKey = (n) => 'e' + String(n).padStart(SEQ_DIGITS, '0');
/** 'e000000007' → 7, or NaN for anything else. */
export const parseSeq = (key) => (/^e\d{9}$/.test(key) ? Number(key.slice(1)) : NaN);

export const encode = (value) => JSON.stringify(value);
/** undefined for anything that isn't a JSON string (a stranger's write, a truncated one). */
export function decode(text) {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A message the reader can act on: an object with a known type. */
export const isMessage = (m) => m !== null && typeof m === 'object' && MESSAGE_TYPES.includes(m.type);
