// A co-op session: one host and one guest talking through a transport (rtdb.js,
// local.js or memory.js). Pure apart from the transport, and driven by tick(now)
// so node tests it with a fake clock.
//
// hostRoom() opens a room and waits for a guest; joinRoom() joins one. Both
// return a Session:
//   session.set(channel, value)   latest-wins: 'pose' (both), 'doodle' and 'state' (host)
//   session.send(message)         ordered and reliable: see protocol.js#MESSAGE_TYPES
//   session.tick(now)             call every frame (or on a timer in the lobby): sends, pings, timeouts
//   session.on(type, fn)          'set' {channel, value} · 'message' (the message) · 'joined' {name}
//                                 'left' {reason: 'left'|'timeout'} · 'status' {status, lagMs} · 'error' (Error)
//   session.close({reason})       say bye; the host also deletes the room

import { CHANNELS, decode, encode, isMessage, parseSeq, seqKey } from './protocol.js';
import { NET_MESSAGES, isCode, makeCode, netError, roomMeta, roomPath } from './room.js';
import { applyOp, joinPath } from './tree.js';

export const SESSION_DEFAULTS = Object.freeze({
  rateHz: 10, // each latest-wins channel at most this often
  batchMs: 50, // queued messages go out together at most this often
  pingMs: 2000, // round-trip probe, and the heartbeat that proves we're still here
  waitingMs: 3000, // partner silent this long: status 'waiting'
  leftMs: 20000, // ...and this long: they're gone. Long enough for a host's tab to come back from the background
  gapMs: 3000, // a missing batch this old is given up on, so one lost write can't stall the stream
  pruneMs: 3000, // delete our batches the partner has acknowledged
});

/**
 * Open a room as host. Resolves once the room exists; the guest arrives later as a 'joined' event.
 * @param {Object} opts
 * @param {Object} opts.transport
 * @param {string} opts.name            host's name (cleaned already)
 * @param {string} opts.difficulty
 * @param {'shared'|'knockout'} opts.rule
 * @param {() => number} [opts.now]     wall clock ms (Date.now): only compared with itself
 * @param {(n: number) => Uint8Array} [opts.randomBytes]
 */
export async function hostRoom({ transport, name, difficulty, rule, now = Date.now, randomBytes, ...opts }) {
  for (let tries = 0; tries < 5; tries++) {
    const code = makeCode(randomBytes);
    const meta = roomMeta({ host: name, difficulty, rule, created: now() });
    if (await transport.create(joinPath(roomPath(code), 'meta'), meta)) {
      return createSession({ transport, role: 'host', code, name, partnerName: null, meta, now, ...opts });
    }
  }
  throw netError('server', NET_MESSAGES.server);
}

/**
 * Join a host's room.
 * @returns {Promise<Session>} rejects with kind 'notFound' | 'started' | 'full' | 'offline' | ...
 */
export async function joinRoom({ transport, code, name, now = Date.now, ...opts }) {
  if (!isCode(code)) throw netError('notFound', NET_MESSAGES.badCode);
  const base = roomPath(code);
  const meta = await transport.get(joinPath(base, 'meta'));
  if (!meta || typeof meta !== 'object') throw netError('notFound');
  if (meta.status !== 'lobby') throw netError('started');
  if (meta.guest) throw netError('full');
  if (!(await transport.create(joinPath(base, 'meta/guest'), name))) throw netError('full');
  const session = createSession({ transport, role: 'guest', code, name, partnerName: meta.host, meta, now, ...opts });
  session.send({ type: 'hello', name });
  return session;
}

/**
 * @typedef {ReturnType<typeof createSession>} Session
 */
export function createSession({ transport, role, code, name, partnerName = null, meta = null, now = Date.now, ...opts }) {
  const o = { ...SESSION_DEFAULTS, ...opts };
  const base = roomPath(code);
  const mine = role === 'host' ? 'h' : 'g';
  const theirs = role === 'host' ? 'g' : 'h';
  const outPath = (p) => joinPath(base, mine, p);

  const handlers = new Map();
  const emit = (type, payload) => {
    for (const fn of [...(handlers.get(type) ?? [])]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`co-op "${type}" handler:`, err);
      }
    }
  };

  const s = {
    role,
    code,
    name,
    partnerName,
    meta,
    /** Half the smoothed round trip, ms; null until the first pong. */
    lagMs: null,
    status: 'ok',
    closed: false,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    set,
    send,
    tick,
    close,
    /** Host: mark the room started (or ended), so nobody else can join it. */
    setStatus: (status) => transport.put(joinPath(base, 'meta/status'), status).catch(() => {}),
  };

  // ---- outgoing ----
  const channels = new Map(); // channel → {text, sentText, lastAt, busy}
  let queue = [];
  let lastBatchAt = -Infinity;
  let nextSeq = 1;
  const sentSeqs = [];
  let lastPruneAt = -Infinity;
  let pingId = 0;
  let lastPingAt = -Infinity;
  let ackText = null;

  function set(channel, value) {
    if (!Object.hasOwn(CHANNELS, channel)) throw new Error(`unknown co-op channel "${channel}"`);
    if (CHANNELS[channel] !== 'both' && CHANNELS[channel] !== role) throw new Error(`the ${role} doesn't write "${channel}"`);
    const c = channels.get(channel) ?? { text: null, sentText: null, lastAt: -Infinity, busy: false };
    c.text = encode(value);
    channels.set(channel, c);
  }

  function send(message) {
    if (!isMessage(message)) throw new Error(`not a co-op message: ${JSON.stringify(message)}`);
    queue.push(message);
  }

  function flushChannels(t) {
    for (const [channel, c] of channels) {
      if (c.busy || c.text === c.sentText || t - c.lastAt < 1000 / o.rateHz) continue;
      const text = c.text;
      c.busy = true;
      c.lastAt = t;
      // A failed write isn't retried: the next value replaces it anyway.
      transport.put(outPath(channel), text).then(
        () => (c.sentText = text),
        () => {},
      ).finally(() => (c.busy = false));
    }
  }

  function writeBatch(seq, text, attempt = 0) {
    transport.put(outPath(`ev/${seqKey(seq)}`), text).catch((err) => {
      if (attempt < 3 && !s.closed) setTimeout(() => writeBatch(seq, text, attempt + 1), 250 * 2 ** attempt);
      else emit('error', err);
    });
  }

  function flushQueue(t, force = false) {
    if (!queue.length || (!force && t - lastBatchAt < o.batchMs)) return;
    const seq = nextSeq++;
    const text = encode(queue);
    queue = [];
    lastBatchAt = t;
    sentSeqs.push(seq);
    writeBatch(seq, text);
  }

  /** Delete our batches the partner has read, so a reconnect doesn't re-download the whole game. */
  function prune(t) {
    if (t - lastPruneAt < o.pruneMs) return;
    lastPruneAt = t;
    const acked = Number(decode(mirror?.ack));
    if (!Number.isFinite(acked)) return;
    const done = sentSeqs.filter((q) => q <= acked);
    if (!done.length) return;
    sentSeqs.splice(0, done.length);
    transport.patch(outPath('ev'), Object.fromEntries(done.map((q) => [seqKey(q), null]))).catch(() => {});
  }

  // ---- incoming ----
  let mirror = null;
  const lastSeen = new Map(); // channel → text already handed out
  let delivered = 0; // highest batch seq handed out
  let gapSince = null;
  let lastHeard = now();
  let present = role === 'guest'; // the host has a partner only after hello

  const unlisten = transport.listen(joinPath(base, theirs), (op) => {
    if (s.closed) return;
    const had = mirror !== null;
    mirror = applyOp(mirror, op);
    // Their whole half vanished: the host deleted the room (its bye may have gone with it).
    if (had && mirror === null && role === 'guest') return partnerGone('left');
    readMirror();
  }, (err) => emit('error', err));

  function readMirror() {
    for (const channel of Object.keys(CHANNELS)) {
      const text = mirror?.[channel];
      if (typeof text !== 'string' || lastSeen.get(channel) === text) continue;
      lastSeen.set(channel, text);
      lastHeard = now();
      const value = decode(text);
      if (value !== undefined) emit('set', { channel, value });
    }
    deliverBatches(now());
  }

  function deliverBatches(t) {
    const pending = Object.keys(mirror?.ev ?? {})
      .map(parseSeq)
      .filter((q) => q > delivered)
      .sort((a, b) => a - b);
    for (const q of pending) {
      if (q !== delivered + 1) {
        // A gap: an earlier write is still on its way. Wait, but not forever.
        gapSince ??= t;
        if (t - gapSince < o.gapMs) break;
      }
      gapSince = null;
      delivered = q;
      // Only what the partner's game loop sends counts as hearing from them, not acks: those keep
      // flowing from a tab in the background whose game has stopped.
      lastHeard = now();
      const batch = decode(mirror.ev[seqKey(q)]);
      if (Array.isArray(batch)) for (const m of batch) if (isMessage(m)) receive(m);
      if (s.closed) return;
    }
    if (!pending.some((q) => q > delivered)) gapSince = null;
    const ack = encode(delivered);
    if (delivered > 0 && ack !== ackText) {
      ackText = ack;
      transport.put(outPath('ack'), ack).catch(() => (ackText = null));
    }
  }

  function receive(m) {
    switch (m.type) {
      case 'hello':
        if (role !== 'host') return;
        present = true;
        s.partnerName = typeof m.name === 'string' ? m.name : '?';
        emit('joined', { name: s.partnerName });
        return;
      case 'ping':
        send({ type: 'pong', id: m.id, t: m.t });
        return;
      case 'pong': {
        const rtt = now() - m.t;
        if (Number.isFinite(rtt) && rtt >= 0) s.lagMs = s.lagMs === null ? rtt / 2 : s.lagMs * 0.7 + (rtt / 2) * 0.3;
        return;
      }
      case 'bye':
        partnerGone('left');
        return;
      default:
        emit('message', m);
    }
  }

  function partnerGone(reason) {
    if (!present) return;
    present = false;
    if (role === 'guest') {
      // Without the host there's no game: stop writing into a room that's gone.
      s.closed = true;
      unlisten();
    }
    emit('left', { reason });
    if (role === 'host') {
      // Free the seat and forget the guest's half, so a new guest starts from batch 1.
      s.partnerName = null;
      mirror = null;
      lastSeen.clear();
      delivered = 0;
      gapSince = null;
      ackText = null;
      queue = [];
      sentSeqs.length = 0;
      nextSeq = 1;
      transport.remove(outPath('ev')).catch(() => {});
      transport.remove(joinPath(base, theirs)).catch(() => {});
      transport.remove(joinPath(base, 'meta/guest')).catch(() => {});
    }
  }

  function setStatus(status) {
    if (status === s.status) return;
    s.status = status;
    emit('status', { status, lagMs: s.lagMs });
  }

  function tick(t = now()) {
    if (s.closed) return;
    if (present && t - lastPingAt >= o.pingMs) {
      lastPingAt = t;
      send({ type: 'ping', id: ++pingId, t });
    }
    flushChannels(t);
    flushQueue(t);
    prune(t);
    if (gapSince !== null) deliverBatches(t);
    if (present) {
      const quiet = t - lastHeard;
      if (quiet >= o.leftMs) {
        setStatus('ok');
        partnerGone('timeout');
      } else setStatus(quiet >= o.waitingMs ? 'waiting' : 'ok');
    } else lastHeard = t; // nobody to wait for yet
  }

  /** Say bye and stop. The host deletes the room. keepalive lets it finish while the page unloads. */
  async function close({ reason = 'left', keepalive = false } = {}) {
    if (s.closed) return;
    send({ type: 'bye', reason });
    flushQueue(now(), true);
    s.closed = true;
    unlisten();
    if (role === 'host') await transport.remove(base, { keepalive }).catch(() => {});
  }

  return s;
}
