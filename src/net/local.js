// ?net=local: co-op between two tabs of one browser, with no server at all.
// The database lives in localStorage and changes are announced on a
// BroadcastChannel, so a developer (or a test in the browser pane) can host in
// one tab and join from another. Same transport shape as rtdb.js.
//
// Each room's three parts (meta, h, g) are separate localStorage keys, because
// each has one writer: two tabs never rewrite the same key at the same moment.

import { createHub, getAt, normalize, patchAt, setAt, splitPath } from './tree.js';

const PREFIX = 'doodle-net:';
const SHARD_DEPTH = 3; // rooms/CODE/part

/**
 * @param {Object} [opts]
 * @param {Storage} [opts.storage]
 * @param {BroadcastChannel} [opts.channel]
 */
export function createTabTransport({ storage = globalThis.localStorage, channel = new BroadcastChannel('doodle-net') } = {}) {
  const readShard = (key) => {
    try {
      return JSON.parse(storage.getItem(PREFIX + key) ?? 'null');
    } catch {
      return null;
    }
  };
  const shardKeys = () => {
    const keys = [];
    for (let k = 0; k < storage.length; k++) {
      const key = storage.key(k);
      if (key?.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length));
    }
    return keys;
  };

  /** The value at any path, rebuilt from the shards under it when it's above shard level. */
  function read(path) {
    const parts = splitPath(path);
    if (parts.length >= SHARD_DEPTH) return getAt(readShard(parts.slice(0, SHARD_DEPTH).join('/')), parts.slice(SHARD_DEPTH).join('/'));
    let tree = null;
    for (const key of shardKeys()) {
      if (key.split('/').slice(0, parts.length).join('/') === parts.join('/')) tree = setAt(tree, key, readShard(key));
    }
    return getAt(tree, path);
  }

  const hub = createHub(read);

  function write(path, kind, data) {
    const parts = splitPath(path);
    if (parts.length < SHARD_DEPTH) {
      // Above shard level: only whole-room deletes happen there.
      if (kind !== 'put' || normalize(data) !== null) throw new Error(`local net: can only delete at "${path}"`);
      for (const key of shardKeys()) if (key.startsWith(parts.join('/') + '/') || key === parts.join('/')) storage.removeItem(PREFIX + key);
    } else {
      const key = parts.slice(0, SHARD_DEPTH).join('/');
      const rest = parts.slice(SHARD_DEPTH).join('/');
      const shard = kind === 'patch' ? patchAt(readShard(key), rest, data) : setAt(readShard(key), rest, data);
      if (shard === null) storage.removeItem(PREFIX + key);
      else storage.setItem(PREFIX + key, JSON.stringify(shard));
    }
    hub.notify(path, kind, data);
    channel.postMessage({ path, kind, data });
  }

  channel.onmessage = ({ data: msg }) => {
    if (msg && typeof msg.path === 'string') hub.notify(msg.path, msg.kind, msg.data);
  };

  const later = (fn) => Promise.resolve().then(fn);
  return {
    get: (path) => later(() => read(path)),
    put: (path, value) => later(() => write(path, 'put', value)),
    patch: (path, children) => later(() => write(path, 'patch', children)),
    create: (path, value) =>
      later(() => {
        if (read(path) !== null) return false;
        write(path, 'put', value);
        return true;
      }),
    remove: (path) => later(() => write(path, 'put', null)),
    listen: (path, onOp) => hub.listen(path, onOp),
    close: () => channel.close(),
  };
}
