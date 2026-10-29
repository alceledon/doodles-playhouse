// An in-memory database with the same transport shape as rtdb.js, for node tests.
// Several transports made from one server see each other's writes, like two
// players on one Realtime Database.
//
// Transport shape (rtdb.js, local.js and this one):
//   get(path)               → Promise<value|null>
//   put(path, value, opts)  → Promise<void>      null deletes; opts.keepalive for page unload
//   patch(path, children)   → Promise<void>      set several children at once (null deletes)
//   create(path, value)     → Promise<boolean>   write only if nothing is there yet
//   remove(path, opts)      → Promise<void>
//   listen(path, onOp, onError) → unsubscribe    onOp({op, path, data}) — see tree.js

import { createHub, getAt, patchAt, setAt } from './tree.js';

/**
 * @param {{rules?: (path: string, value: any, tree: any) => boolean}} [opts]
 *   rules: return false to refuse a write (tests use it to stand in for database.rules.json)
 */
export function createMemoryServer({ rules = () => true } = {}) {
  let tree = null;
  const hub = createHub((path) => clone(getAt(tree, path)));
  const writes = [];

  function write(path, kind, data) {
    if (!rules(path, data, tree)) return false;
    tree = kind === 'patch' ? patchAt(tree, path, clone(data)) : setAt(tree, path, clone(data));
    writes.push({ path, kind });
    hub.notify(path, kind, clone(data));
    return true;
  }

  /** A transport onto this server. Every call settles on a later microtask, like a network. */
  function transport() {
    const later = (fn) => Promise.resolve().then(fn);
    const refuse = (ok) => {
      if (!ok) throw Object.assign(new Error('Permission denied'), { kind: 'rejected' });
    };
    return {
      get: (path) => later(() => clone(getAt(tree, path))),
      put: (path, value) => later(() => refuse(write(path, 'put', value))),
      patch: (path, children) => later(() => refuse(write(path, 'patch', children))),
      create: (path, value) => later(() => getAt(tree, path) === null && write(path, 'put', value)),
      remove: (path) => later(() => refuse(write(path, 'put', null))),
      listen: (path, onOp) => hub.listen(path, onOp),
    };
  }

  return {
    transport,
    read: (path = '') => clone(getAt(tree, path)),
    /** Every accepted write so far, {path, kind}: tests count requests with it. */
    writes,
  };
}

const clone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));
