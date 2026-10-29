// Co-op words and logic for the menus, the lobby and the in-game notices.
// Pure (tests import it): no DOM, just strings, input cleaning and a small
// notice state machine that hud-side code (notices.js) renders.

import { COOP_RULE_IDS, DIFFICULTIES } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { cleanName, nameProblem } from '../leaderboard/entries.js';
import { CODE_ALPHABET, CODE_LENGTH, NET_MESSAGES, cleanCode } from '../net/room.js';

// Whose event is it? Shared with Audio, which lives in soundmap.js.
export { isPartnerPayload } from '../audio/soundmap.js';

export const COOP_TEXT = Object.freeze({
  play: 'Play with a friend',
  playLine: 'Two players online, one Doodle.',
  title: 'PLAY WITH\nA FRIEND',
  host: 'Host a game',
  hostLine: 'Pick the rules and send your friend a link.',
  join: 'Join a game',
  joinLine: 'Type the code your friend sent you.',
  nameLabel: 'Your name',
  namePlaceholder: 'NAME',
  codeLabel: 'Room code',
  codePlaceholder: 'CODE',
  next: 'Next',
  back: 'Back',
  joinGo: 'Join',
  pickDifficulty: 'How hard?',
  pickRule: 'What happens when Doodle catches one of you?',
  // Lobby
  lobbyTitle: 'ROOM',
  inviteLabel: 'Invite link',
  copy: 'Copy',
  copied: 'Copied!',
  copyFailed: 'Select the link and copy it',
  share: 'Share',
  shareText: 'Come escape Doodle’s Playhouse with me!',
  start: 'Start',
  cancel: 'Cancel',
  you: 'You',
  friend: 'Friend',
  host_: 'Host',
  noFriendYet: 'not here yet',
  waitingFriend: 'Waiting for your friend…',
  ok: 'OK',
  // Win screen
  postCoop: 'Post our time',
  coopBoardsNote: 'The host can post this run to the co-op board.',
});

/** The catch rules, one line each (the host's menu, the lobby, the win screen). */
export const RULE_INFO = Object.freeze({
  shared: { name: 'Shared', line: 'Any catch ends the day for both of you.' },
  knockout: { name: 'Knock-out', line: 'A caught player watches the other until the next day.' },
});

/** Leaderboard modes: the solo boards, then one per co-op rule. */
export const BOARD_MODES = Object.freeze(['solo', ...COOP_RULE_IDS]);
export const BOARD_MODE_NAMES = Object.freeze({ solo: 'Solo', ...Object.fromEntries(COOP_RULE_IDS.map((r) => [r, RULE_INFO[r].name])) });

/** top()'s third argument for a board mode: none for solo. */
export const boardOpts = (mode) => (COOP_RULE_IDS.includes(mode) ? { coop: mode } : undefined);

/** "AL & BO" for a co-op entry, the name alone for a solo one. */
export const teamName = (name, name2) => (name2 ? `${name ?? ''} & ${name2}` : String(name ?? ''));

// ---- menu input ---------------------------------------------------------------------

/** A typed name → {name (cleaned), problem (null when the board would take it)}. */
export function checkName(raw) {
  const name = cleanName(raw);
  return { name, problem: nameProblem(name) };
}

const ALPHABET = new Set(CODE_ALPHABET);

/**
 * What the code field shows while typing: upper case, only code letters, at most 6.
 * A pasted invite link gives its ?join= code.
 */
export function typedCode(raw) {
  let s = String(raw ?? '');
  const m = /[?&]join=([^&#\s]*)/i.exec(s);
  if (m) s = m[1];
  return [...s.toUpperCase()].filter((c) => ALPHABET.has(c)).join('').slice(0, CODE_LENGTH);
}

/** A typed code → {code (null unless valid), problem}. */
export function checkCode(raw) {
  const code = cleanCode(typedCode(raw));
  return { code, problem: code ? null : NET_MESSAGES.badCode };
}

/**
 * The host's finished choice, or {problem}. Name cleaned; difficulty and rule must be known.
 * @returns {{choice: import('../core/contracts.js').CoopChoice|null, problem: string|null}}
 */
export function hostChoice({ name, difficulty, rule }) {
  const n = checkName(name);
  if (n.problem) return { choice: null, problem: n.problem };
  if (!DIFFICULTIES.includes(difficulty)) return { choice: null, problem: 'Pick a difficulty.' };
  if (!COOP_RULE_IDS.includes(rule)) return { choice: null, problem: 'Pick a rule.' };
  return { choice: { role: 'host', name: n.name, difficulty, rule }, problem: null };
}

/** The guest's finished choice, or {problem} (the name's first, then the code's). */
export function joinChoice({ name, code }) {
  const n = checkName(name);
  if (n.problem) return { choice: null, problem: n.problem };
  const c = checkCode(code);
  if (c.problem) return { choice: null, problem: c.problem };
  return { choice: { role: 'join', name: n.name, code: c.code }, problem: null };
}

// ---- lobby ----------------------------------------------------------------------------

/**
 * The lobby's status line and whether Start can be pressed.
 * @param {{role: 'host'|'guest', partnerName: string|null, status?: string}} info
 */
export function lobbyView({ role, partnerName = null, status } = {}) {
  const friend = partnerName || null;
  let line;
  if (status) line = status;
  else if (!friend) line = COOP_TEXT.waitingFriend;
  else if (role === 'host') line = `${friend} is here. Press Start when you’re ready!`;
  else line = `Waiting for ${friend} to start…`;
  return { status: line, canStart: role === 'host' && !!friend, showStart: role === 'host' };
}

// ---- in-game notices --------------------------------------------------------------------

const who = (name) => (name ? String(name) : 'your friend');
const Who = (name) => (name ? String(name) : 'Your friend');

export const joinedText = (name) => `${Who(name)} joined`;
export const leftText = (name, reason) => (reason === 'timeout' ? `${Who(name)} lost connection` : `${Who(name)} left`);
export const caughtText = (name) => `Doodle caught ${who(name)}!`;
export const spectatingText = (name) => `Spectating ${who(name)}`;
export const waitingText = (name) => `Waiting for ${who(name)}…`;
/** The debug lag readout. */
export const lagText = (ms) => (Number.isFinite(ms) && ms >= 0 ? `lag ${Math.round(ms)} ms` : 'lag –');

/**
 * Notice state: the partner's name (remembered from PARTNER_JOINED, the lobby, PLAYER_DOWN),
 * the two persistent banners and the lag. reduceNotices returns a new state and the toasts to show.
 * @typedef {{partner: string|null, spectating: string|null, waiting: string|null, lagMs: number|null}} NoticeState
 */
export const initialNotices = () => ({ partner: null, spectating: null, waiting: null, lagMs: null });

/**
 * @param {NoticeState} s
 * @param {string} type     an EVENTS value, or 'dayCard' / 'reset' from the UI itself
 * @param {Object} [p]      the payload
 * @returns {{state: NoticeState, toasts: string[]}}
 */
export function reduceNotices(s, type, p = {}) {
  const state = { ...s };
  const toasts = [];
  switch (type) {
    case EVENTS.PARTNER_JOINED:
      if (p.name) state.partner = String(p.name);
      toasts.push(joinedText(state.partner));
      break;
    case EVENTS.PARTNER_LEFT:
      if (p.name) state.partner = String(p.name);
      toasts.push(leftText(state.partner, p.reason));
      state.waiting = null;
      state.spectating = null; // nobody left to watch
      break;
    case EVENTS.PLAYER_DOWN:
      if (p.local) state.spectating = spectatingText(state.partner);
      else {
        if (p.name) state.partner = String(p.name);
        toasts.push(caughtText(state.partner));
      }
      break;
    case EVENTS.PLAYER_UP:
      if (p.local) state.spectating = null;
      break;
    case EVENTS.NET_STATUS:
      state.waiting = p.status === 'waiting' ? waitingText(state.partner) : null;
      if (p.lagMs === null || Number.isFinite(p.lagMs)) state.lagMs = p.lagMs ?? null;
      break;
    case 'partnerName': // the lobby told us
      state.partner = p.name ? String(p.name) : state.partner;
      break;
    case 'dayCard': // a new day: everyone is back up
      state.spectating = null;
      break;
    case 'reset':
      return { state: { ...initialNotices(), partner: state.partner }, toasts };
    default:
      break;
  }
  return { state, toasts };
}
