// The co-op transport for real play: Firebase Realtime Database through its REST
// API, with plain fetch for writes and EventSource (Server-Sent Events) to hear
// changes. No Firebase SDK, no dependencies. Pure: fetch and EventSource are
// injected, so node tests it with fakes.
//
// database.rules.json decides what anyone may write; the database URL is public.
// Transport shape: see memory.js.

import { NET_MESSAGES, netError } from './room.js';
import { splitPath } from './tree.js';

/**
 * @param {Object} opts
 * @param {string} opts.databaseURL   e.g. https://doodles-playhouse-default-rtdb.firebaseio.com
 * @param {typeof fetch} [opts.fetch]
 * @param {typeof EventSource} [opts.EventSource]
 * @param {number} [opts.timeoutMs]   per request
 */
export function createRtdbTransport({ databaseURL, fetch: fetchFn = globalThis.fetch, EventSource: ES = globalThis.EventSource, timeoutMs = 8000 }) {
  const base = String(databaseURL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(base)) throw new Error(`co-op databaseURL must be an https origin, got "${databaseURL}"`);
  const url = (path) => `${base}/${splitPath(path).join('/')}.json`;

  /** One REST call; resolves with the parsed answer or throws a kind-tagged error. */
  async function request(method, path, body, { keepalive = false } = {}) {
    const target = url(path); // a bad path is our bug, not the network's: let it throw as itself
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    // Raced against the request too, so a fetch that ignores the signal still times out.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(netError('offline', NET_MESSAGES.timeout));
        ctrl?.abort();
      }, timeoutMs);
    });
    const offline = (err) => (err?.kind ? err : netError('offline', NET_MESSAGES.offline, { cause: err }));
    try {
      const init = { method, keepalive, signal: ctrl?.signal };
      // No Content-Type: the database parses the body as JSON regardless.
      if (body !== undefined) init.body = JSON.stringify(body);
      let res;
      try {
        res = await Promise.race([fetchFn(target, init), timeout]);
      } catch (err) {
        throw offline(err);
      }
      let text;
      try {
        text = await Promise.race([res.text(), timeout]);
      } catch (err) {
        throw offline(err);
      }
      if (!res.ok) {
        const kind = res.status >= 400 && res.status < 500 ? 'rejected' : 'server';
        throw netError(kind, NET_MESSAGES[kind], { status: res.status });
      }
      try {
        return JSON.parse(text);
      } catch {
        throw netError('server', NET_MESSAGES.server, { status: res.status });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function listen(path, onOp, onError = () => {}) {
    if (typeof ES !== 'function') throw netError('disabled', NET_MESSAGES.disabled);
    const es = new ES(url(path));
    const handle = (op) => (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg && typeof msg.path === 'string') onOp({ op, path: msg.path, data: msg.data ?? null });
    };
    es.addEventListener('put', handle('put'));
    es.addEventListener('patch', handle('patch'));
    // The rules stopped letting us read (the room was deleted under us, usually).
    es.addEventListener('cancel', () => onError(netError('rejected', NET_MESSAGES.rejected)));
    // Network blips: EventSource reconnects by itself, and the database then sends a fresh put at '/'.
    return () => es.close();
  }

  return {
    get: (path) => request('GET', path),
    put: (path, value, opts) => request('PUT', path, value ?? null, opts).then(() => {}),
    patch: (path, children) => request('PATCH', path, children).then(() => {}),
    /** Rules refuse the write when something is already there (meta, meta/guest), which reads as false. */
    create: (path, value) =>
      request('PUT', path, value).then(
        () => true,
        (err) => {
          if (err.kind === 'rejected') return false;
          throw err;
        },
      ),
    remove: (path, opts) => request('DELETE', path, undefined, opts).then(() => {}),
    listen,
  };
}
