// Co-op rooms: codes, invite links, the room's paths, and the errors the lobby
// shows. Pure (node tests it).
//
// A room lives at rooms/{CODE} in the Realtime Database (database.rules.json):
//   meta  {v, host, guest?, difficulty, rule, status, created}   host writes it once; the guest claims meta/guest
//   h     what the host writes: pose, doodle, state (JSON strings, latest wins), ack, ev/{seq} (ordered batches)
//   g     what the guest writes: pose, ack, ev/{seq}
// Each side listens only to the other's half, so it never downloads its own writes.

import { COOP_RULE_IDS, DIFFICULTIES } from '../core/contracts.js';

/** No 0/O, 1/I/L: a code read over the phone survives. 31 letters, so 6 of them is ~887 million rooms. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const ROOM_VERSION = 1;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * A fresh room code. Not run randomness (it never touches a seed), so it comes from the
 * browser's crypto, injected for tests.
 * @param {(n: number) => Uint8Array} randomBytes
 */
export function makeCode(randomBytes = defaultRandomBytes) {
  let code = '';
  // Rejection sampling: 248 = 8 × 31, so every letter is equally likely.
  while (code.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH * 2)) {
      if (b < 248 && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

function defaultRandomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** What a player typed → a code, or null. Case, spaces and dashes don't matter. */
export function cleanCode(raw) {
  const code = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}

export const isCode = (code) => typeof code === 'string' && CODE_RE.test(code);

/**
 * The link a host sends. Keeps ?net= so a local two-tab test invites into the same transport.
 * @param {{origin: string, pathname: string, search?: string}} loc  usually `location`
 */
export function inviteLink(loc, code) {
  const params = new URLSearchParams();
  params.set('join', code);
  const net = new URLSearchParams(loc.search ?? '').get('net');
  if (net) params.set('net', net);
  return `${loc.origin}${loc.pathname}?${params}`;
}

export const roomPath = (code) => `rooms/${code}`;

/** The meta record the host writes when it opens a room. */
export function roomMeta({ host, difficulty, rule, created }) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`unknown difficulty "${difficulty}"`);
  if (!COOP_RULE_IDS.includes(rule)) throw new Error(`unknown co-op rule "${rule}"`);
  return { v: ROOM_VERSION, host, difficulty, rule, status: 'lobby', created };
}

export const NET_ERROR_KINDS = Object.freeze(['offline', 'rejected', 'server', 'disabled', 'notFound', 'full', 'started']);

/** What the player reads for each failure. */
export const NET_MESSAGES = Object.freeze({
  offline: 'Couldn’t reach the co-op server.',
  timeout: 'The co-op server took too long to answer.',
  rejected: 'The co-op server didn’t accept that.',
  server: 'The co-op server is having trouble. Try again in a bit.',
  disabled: 'Co-op isn’t set up.',
  notFound: 'There’s no game with that code.',
  full: 'That game already has two players.',
  started: 'That game has already started.',
  badCode: 'Codes are 6 letters and numbers.',
  hostLeft: 'Your friend left the game.',
  guestLeft: 'Your friend left. You’re on your own now.',
});

/**
 * @param {string} kind     one of NET_ERROR_KINDS
 * @param {string} message  shown to the player
 */
export function netError(kind, message = NET_MESSAGES[kind] ?? NET_MESSAGES.server, { status = null, cause } = {}) {
  const err = new Error(message, cause === undefined ? undefined : { cause });
  err.name = 'NetError';
  err.kind = kind;
  err.status = status;
  return err;
}
