// Leaderboard entry rules, shared by the online client, the fake board and the
// win screen. Pure (node tests it). firestore.rules enforces the same limits on
// the server, so a run that passes entryProblem() is one the rules will take.

import { DIFFICULTIES, MAX_DAYS, ROUTES } from '../core/contracts.js';

/** Runs faster than this don't go on the board (a minute: nobody escapes that fast legitimately). */
export const MIN_SECONDS = 60;
/** Runs this long or longer don't either (the rules' upper bound). */
export const MAX_SECONDS = 86400;
export const NAME_MAX = 6;
/** Bumped if the document shape ever changes; the rules require exactly this. */
export const SCHEMA_VERSION = 1;

const NAME_RE = /^[A-Z0-9]{1,6}$/;
const ROUTE_IDS = Object.values(ROUTES);

/** One Firestore collection per difficulty, so ordering by seconds needs no composite index. */
export const BOARDS = Object.freeze(Object.fromEntries(DIFFICULTIES.map((d) => [d, `runs_${d}`])));

/** 'normal' → 'runs_normal'; null for an unknown difficulty. */
export const boardOf = (difficulty) => (Object.hasOwn(BOARDS, difficulty) ? BOARDS[difficulty] : null);

/** Times are stored to 2 decimals; numbers round, anything else passes through for timeProblem to reject. */
export const roundSeconds = (seconds) => (typeof seconds === 'number' ? Math.round(seconds * 100) / 100 : seconds);

/** What a player typed → a name the board takes: uppercase A–Z and 0–9 only, at most 6. Accents are dropped (é → E). */
export function cleanName(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, NAME_MAX);
}

// A short list of obvious obscenities and slurs, matched as substrings after
// undoing leetspeak. Kept reversed so the source doesn't read as a list of
// slurs and a code search for one doesn't land here. It only catches the
// obvious; a bad entry that slips through is deleted by hand in the console.
const BLOCKED = 'KCUF TIHS TNUC KCOC KCID YSSUP TAWT KNAW HCTIB TULS EROHW SINEP NROP TSIPAR IZAN RELTIH KKK GAF GGIN KNIHC EKIK DRATER YNNART EKYD ODEP'
  .split(' ')
  .map((w) => [...w].reverse().join(''));
const LEET = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 7: 'T', 8: 'B' };
const unleet = (s) => s.replace(/[0134578]/g, (d) => LEET[d]);

/** True if the name contains a blocked word, digits read as letters (5H1T). */
export function isBlockedName(name) {
  const n = unleet(cleanName(name));
  return BLOCKED.some((w) => n.includes(w));
}

/** null if the board takes this name as is, else a short reason to show the player. */
export function nameProblem(name) {
  if (typeof name !== 'string' || name === '') return 'Type a name first.';
  if (!NAME_RE.test(name)) return 'Use up to 6 letters (A–Z) or numbers.';
  if (isBlockedName(name)) return 'Pick a different name.';
  return null;
}

/** null if the board takes this time (already rounded to 2 decimals), else a reason. */
export function timeProblem(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'That time isn’t a number.';
  if (seconds < MIN_SECONDS) return 'Runs under a minute don’t go on the board.';
  if (seconds >= MAX_SECONDS) return 'That run took too long to count.';
  return null;
}

/** Mirrors firestore.rules: null if the entry would be accepted, else the first problem. */
export function entryProblem({ name, seconds, days, route } = {}) {
  const bad = nameProblem(name) ?? timeProblem(seconds);
  if (bad) return bad;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return `Days used must be 1 to ${MAX_DAYS}.`;
  if (!ROUTE_IDS.includes(route)) return 'Unknown way out.';
  return null;
}

/**
 * Display ranks for entries sorted fastest first. Ties share a rank (1, 2, 2, 4),
 * matching rankOf(), which counts the strictly faster runs.
 * @param {{seconds: number}[]} entries
 * @returns {number[]}
 */
export function ranksOf(entries) {
  const ranks = [];
  entries.forEach((e, k) => ranks.push(k > 0 && e.seconds === entries[k - 1].seconds ? ranks[k - 1] : k + 1));
  return ranks;
}
