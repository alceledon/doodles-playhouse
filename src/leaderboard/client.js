// The online leaderboard: Cloud Firestore through its REST API with plain fetch
// (no Firebase SDK, no dependencies). Pure: no DOM and no `three`, so node tests
// it with a fake fetch.
//
// One collection per difficulty (entries.js#BOARDS). firestore.rules lets anyone
// read and add runs, never change or delete them; entries.js mirrors those rules,
// so nothing invalid is ever sent.
//
// Every failure rejects with an Error whose `kind` the UI can branch on:
//   offline   network error or timeout
//   rejected  4xx, e.g. the rules said no
//   server    5xx or an answer that isn't what Firestore sends
//   disabled  no project configured, or this client may not post (dev runs)
//   invalid   the entry failed entries.js's checks (nothing was sent)

import { FIREBASE } from './config.js';
import { SCHEMA_VERSION, boardOf, entryProblem, roundSeconds, timeProblem } from './entries.js';

export const ERROR_KINDS = Object.freeze(['offline', 'rejected', 'server', 'disabled', 'invalid']);

/** What the player reads for each failure (the fake board says the same). */
export const MESSAGES = Object.freeze({
  offline: 'Couldn’t reach the leaderboard.',
  timeout: 'The leaderboard took too long to answer.',
  rejected: 'The leaderboard didn’t accept that.',
  server: 'The leaderboard is having trouble. Try again in a bit.',
  disabled: 'The leaderboard isn’t set up.',
  readOnly: 'Test runs don’t go on the leaderboard.',
  difficulty: 'There’s no board for that difficulty.',
});

/**
 * @param {'offline'|'rejected'|'server'|'disabled'|'invalid'} kind
 * @param {string} message  shown to the player
 * @param {{status?: number|null, detail?: string, cause?: unknown}} [extra]  status: HTTP status; detail: Firestore's own message
 */
export function leaderboardError(kind, message, { status = null, detail = '', cause } = {}) {
  const err = new Error(message, cause === undefined ? undefined : { cause });
  err.name = 'LeaderboardError';
  err.kind = kind;
  err.status = status;
  err.detail = detail;
  return err;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A Firestore number field: integerValue arrives as a string, doubleValue as a number (or "NaN"). */
const decodeNumber = (v) => (v?.integerValue !== undefined ? Number(v.integerValue) : v?.doubleValue !== undefined ? Number(v.doubleValue) : NaN);
const decodeString = (v) => (typeof v?.stringValue === 'string' ? v.stringValue : '');
/** 'projects/p/databases/(default)/documents/runs_normal/abc123' → 'abc123' */
const docId = (doc) => (typeof doc?.name === 'string' ? doc.name.split('/').pop() : '');

/** A Firestore document → Entry {id, name, seconds, days, route, at}. `at` is the createTime (ISO string). */
export function decodeEntry(doc) {
  const f = doc?.fields ?? {};
  return {
    id: docId(doc),
    name: decodeString(f.name),
    seconds: decodeNumber(f.seconds),
    days: decodeNumber(f.days),
    route: decodeString(f.route),
    at: typeof doc?.createTime === 'string' ? doc.createTime : null,
  };
}

const encodeEntry = ({ name, seconds, days, route }) => ({
  name: { stringValue: name },
  seconds: { doubleValue: seconds },
  days: { integerValue: String(days) },
  route: { stringValue: route },
  v: { integerValue: String(SCHEMA_VERSION) },
});

/**
 * @param {Object} [opts]
 * @param {{projectId: string, apiKey: string}} [opts.config]
 * @param {typeof fetch} [opts.fetch]
 * @param {boolean} [opts.allowSubmit]  false for dev runs: they read the board but never post
 * @param {number} [opts.timeoutMs]     per request
 */
export function createLeaderboard({ config = FIREBASE, fetch: fetchFn = globalThis.fetch, allowSubmit = true, timeoutMs = 8000 } = {}) {
  const projectId = typeof config?.projectId === 'string' ? config.projectId.trim() : '';
  const apiKey = typeof config?.apiKey === 'string' ? config.apiKey.trim() : '';
  const enabled = projectId !== '' && typeof fetchFn === 'function';
  const canSubmit = enabled && !!allowSubmit;
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const url = (path) => base + path + (apiKey ? `?key=${encodeURIComponent(apiKey)}` : '');

  /** POST JSON to base + path and return the parsed answer, or throw a kind-tagged error. */
  async function post(path, body) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    // Raced against the request too, so a fetch that ignores the signal still times out.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(leaderboardError('offline', MESSAGES.timeout));
        ctrl?.abort();
      }, timeoutMs);
    });
    const offline = (err) => (err?.kind ? err : leaderboardError('offline', MESSAGES.offline, { cause: err }));
    try {
      let res;
      try {
        res = await Promise.race([
          fetchFn(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl?.signal }),
          timeout,
        ]);
      } catch (err) {
        throw offline(err);
      }
      let text;
      try {
        text = await Promise.race([res.text(), timeout]);
      } catch (err) {
        throw offline(err);
      }
      const data = parseJson(text);
      if (!res.ok) {
        const detail = (Array.isArray(data) ? data[0] : data)?.error?.message ?? '';
        const kind = res.status >= 400 && res.status < 500 ? 'rejected' : 'server';
        throw leaderboardError(kind, MESSAGES[kind], { status: res.status, detail });
      }
      if (data === undefined) throw leaderboardError('server', MESSAGES.server, { status: res.status, detail: 'not JSON' });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function boardFor(difficulty) {
    if (!enabled) throw leaderboardError('disabled', MESSAGES.disabled);
    const board = boardOf(difficulty);
    if (!board) throw leaderboardError('invalid', MESSAGES.difficulty);
    return board;
  }

  /** The fastest `limit` runs on a difficulty's board, fastest first. */
  async function top(difficulty, limit = 10) {
    const board = boardFor(difficulty);
    const n = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 10));
    const data = await post(':runQuery', {
      structuredQuery: {
        from: [{ collectionId: board }],
        orderBy: [{ field: { fieldPath: 'seconds' }, direction: 'ASCENDING' }],
        limit: n,
      },
    });
    // An empty result is [{readTime}]; anything not an array, or carrying an error, isn't a result.
    if (!Array.isArray(data) || data.some((r) => r?.error)) throw leaderboardError('server', MESSAGES.server, { detail: 'bad runQuery answer' });
    return data.filter((r) => r?.document).map((r) => decodeEntry(r.document)).filter((e) => Number.isFinite(e.seconds));
  }

  /** Where a time would place: 1 + the runs strictly faster (ties share a place). */
  async function rankOf(difficulty, seconds) {
    const board = boardFor(difficulty);
    const s = roundSeconds(seconds); // compared at the precision times are stored with
    if (typeof s !== 'number' || !Number.isFinite(s)) throw leaderboardError('invalid', timeProblem(s));
    const data = await post(':runAggregationQuery', {
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: board }],
          where: { fieldFilter: { field: { fieldPath: 'seconds' }, op: 'LESS_THAN', value: { doubleValue: s } } },
        },
        aggregations: [{ alias: 'ahead', count: {} }],
      },
    });
    const row = Array.isArray(data) ? data.find((r) => r?.result) : null;
    const ahead = decodeNumber(row?.result?.aggregateFields?.ahead);
    if (!Number.isInteger(ahead) || ahead < 0) throw leaderboardError('server', MESSAGES.server, { detail: 'bad count answer' });
    return ahead + 1;
  }

  /**
   * Post a finished run, then look up its place.
   * @returns {Promise<{id: string, rank: number|null, entry: Object}>}  rank is null when the run
   *   was posted but its place couldn't be fetched (never post again in that case: it's on the board).
   */
  async function submit({ name, seconds, days, route, difficulty } = {}) {
    if (!enabled) throw leaderboardError('disabled', MESSAGES.disabled);
    if (!canSubmit) throw leaderboardError('disabled', MESSAGES.readOnly);
    const board = boardFor(difficulty);
    const entry = { name, seconds: roundSeconds(seconds), days, route };
    const problem = entryProblem(entry);
    if (problem) throw leaderboardError('invalid', problem);
    const doc = await post(`/${board}`, { fields: encodeEntry(entry) });
    const id = docId(doc);
    if (!id) throw leaderboardError('server', MESSAGES.server, { detail: 'no document name' });
    let rank = null;
    try {
      rank = await rankOf(difficulty, entry.seconds);
    } catch {
      // Posted, place unknown: the UI says so rather than offering a second post.
    }
    return { id, rank, entry: { id, ...entry, at: typeof doc.createTime === 'string' ? doc.createTime : null } };
  }

  return { enabled, canSubmit, top, submit, rankOf };
}
