// A pretend leaderboard with the online client's API, for ?board=fake (dev and
// browser tests) and node tests. Entries live in memory, and in `storage` when
// given, so they survive a reload. Every board starts with a few made-up runs so
// none is empty. It applies the same checks as the real one, so the UI meets the
// same errors; failNext() makes the next call fail on purpose.

import { DIFFICULTIES } from '../core/contracts.js';
import { MESSAGES, leaderboardError } from './client.js';
import { boardOf, entryProblem, roundSeconds, timeProblem } from './entries.js';

export const FAKE_KEY = 'doodles-playhouse.fakeBoard.v1';

// [name, seconds, days, route] per difficulty.
const SEED = {
  practice: [['PIP', 198.4, 1, 'frontDoor'], ['LUNA', 232.9, 1, 'garage'], ['MAX', 275.1, 1, 'frontDoor'], ['KAI', 341.6, 1, 'garage'], ['BEA', 409.2, 1, 'frontDoor']],
  easy: [['ZOE', 356.7, 1, 'garage'], ['REX', 402.3, 2, 'frontDoor'], ['IVY', 455.8, 1, 'frontDoor'], ['JUNO', 538.4, 2, 'garage'], ['SAM', 612, 3, 'frontDoor'], ['OLLIE', 744.5, 2, 'garage']],
  normal: [['NOVA', 488.2, 2, 'frontDoor'], ['ACE', 521.7, 1, 'garage'], ['MILO', 603.9, 3, 'garage'], ['TESS', 689.4, 2, 'frontDoor'], ['BO', 777.1, 4, 'frontDoor'], ['RUBY', 902.6, 5, 'garage']],
  hard: [['GHOST', 701.3, 2, 'garage'], ['WREN', 866, 3, 'frontDoor'], ['FINN', 1012.8, 4, 'garage'], ['ELLA', 1240.5, 5, 'frontDoor']],
};

function seeded() {
  let n = 0;
  const boards = {};
  for (const d of DIFFICULTIES) {
    boards[d] = SEED[d].map(([name, seconds, days, route], k) => ({
      id: `seed-${d}-${k}`,
      name,
      seconds,
      days,
      route,
      at: new Date(Date.UTC(2026, 9, 1 + ((n++ * 3) % 27), 19, 30)).toISOString(),
    }));
  }
  return { next: 1, boards };
}

const validEntry = (e) => e && typeof e.id === 'string' && !entryProblem(e);

function load(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(FAKE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object' || !raw.boards) return null;
    const boards = {};
    for (const d of DIFFICULTIES) boards[d] = Array.isArray(raw.boards[d]) ? raw.boards[d].filter(validEntry) : [];
    return { next: Number.isInteger(raw.next) && raw.next > 0 ? raw.next : 1, boards };
  } catch {
    return null; // missing, junk or blocked storage: start from the seed
  }
}

const byTime = (a, b) => a.seconds - b.seconds || String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id);

/**
 * @param {Object} [opts]
 * @param {{getItem: Function, setItem: Function}|null} [opts.storage]  e.g. localStorage
 * @param {boolean} [opts.allowSubmit]
 * @param {number} [opts.latencyMs]  pretend network delay per call
 */
export function createFakeLeaderboard({ storage = null, allowSubmit = true, latencyMs = 250 } = {}) {
  const data = load(storage) ?? seeded();
  const failures = [];

  const save = () => {
    try {
      storage?.setItem(FAKE_KEY, JSON.stringify(data));
    } catch {}
  };

  /** The pretend round trip: wait, then fail if failNext() asked for it. */
  async function roundTrip() {
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    const kind = failures.shift();
    if (kind) throw leaderboardError(kind, MESSAGES[kind] ?? MESSAGES.server, { status: kind === 'rejected' ? 403 : kind === 'server' ? 500 : null });
  }

  function boardFor(difficulty) {
    if (!boardOf(difficulty)) throw leaderboardError('invalid', MESSAGES.difficulty);
    return data.boards[difficulty];
  }

  const ahead = (list, seconds) => list.filter((e) => e.seconds < seconds).length;

  const board = {
    enabled: true,
    /** Writable: set it false from the console (?debug=1: __game.leaderboard) to see the "test run" note. */
    canSubmit: !!allowSubmit,

    async top(difficulty, limit = 10) {
      const list = boardFor(difficulty);
      await roundTrip();
      const n = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 10));
      return [...list].sort(byTime).slice(0, n).map((e) => ({ ...e }));
    },

    async rankOf(difficulty, seconds) {
      const list = boardFor(difficulty);
      const s = roundSeconds(seconds);
      if (typeof s !== 'number' || !Number.isFinite(s)) throw leaderboardError('invalid', timeProblem(s));
      await roundTrip();
      return ahead(list, s) + 1;
    },

    async submit({ name, seconds, days, route, difficulty } = {}) {
      if (!board.canSubmit) throw leaderboardError('disabled', MESSAGES.readOnly);
      const list = boardFor(difficulty);
      const entry = { name, seconds: roundSeconds(seconds), days, route };
      const problem = entryProblem(entry);
      if (problem) throw leaderboardError('invalid', problem);
      await roundTrip();
      const posted = { id: `fake-${data.next++}`, ...entry, at: new Date().toISOString() };
      list.push(posted);
      save();
      return { id: posted.id, rank: ahead(list, posted.seconds) + 1, entry: { ...posted } };
    },

    /** Make the next `times` calls fail with this kind ('offline', 'rejected', 'server'). */
    failNext(kind = 'offline', times = 1) {
      for (let k = 0; k < times; k++) failures.push(kind);
    },
  };
  return board;
}
