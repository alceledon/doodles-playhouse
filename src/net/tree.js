// A JSON tree with Firebase Realtime Database semantics, so the in-browser and
// in-memory transports behave like the real one. Pure (node tests it).
//
//  - Paths are 'a/b/c'; '' or '/' is the root.
//  - Writing null deletes, and a node left with no children disappears too.
//  - A listener at path L hears {op: 'put'|'patch', path, data} with `path`
//    relative to L: first a put at '/' with everything under L, then each change.

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/** 'rooms/ABC/h' → ['rooms', 'ABC', 'h']. Throws on a segment RTDB wouldn't take, so nothing odd reaches a URL. */
export function splitPath(path) {
  const parts = String(path ?? '').split('/').filter(Boolean);
  for (const p of parts) if (!SEGMENT_RE.test(p)) throw new Error(`bad path segment "${p}" in "${path}"`);
  return parts;
}

export const joinPath = (...parts) => parts.flatMap((p) => splitPath(p)).join('/');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A copy as it would come back from the database: no undefined or null leaves, no empty objects. null if nothing is left. */
export function normalize(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length ? value.map((v) => normalize(v)) : null;
  if (!isObj(value)) return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const n = normalize(v);
    if (n !== null) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function getAt(tree, path) {
  let node = tree ?? null;
  for (const p of splitPath(path)) {
    if (!isObj(node) || !(p in node)) return null;
    node = node[p];
  }
  return node;
}

/** Set (or with null, delete) the value at path. Mutates and returns the new root, which is null when empty. */
export function setAt(tree, path, value) {
  const parts = splitPath(path);
  const v = normalize(value);
  if (parts.length === 0) return v;
  const root = isObj(tree) ? tree : {};
  const stack = [];
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(node[p])) {
      if (v === null) return Object.keys(root).length ? root : null;
      node[p] = {};
    }
    stack.push([node, p]);
    node = node[p];
  }
  const last = parts.at(-1);
  if (v === null) delete node[last];
  else node[last] = v;
  // A parent with nothing left under it is gone too.
  for (let k = stack.length - 1; k >= 0; k--) {
    const [parent, key] = stack[k];
    if (Object.keys(parent[key]).length) break;
    delete parent[key];
  }
  return Object.keys(root).length ? root : null;
}

/** RTDB PATCH: set each child of path named in `children` (null deletes it). */
export function patchAt(tree, path, children) {
  let root = tree;
  for (const [k, v] of Object.entries(children ?? {})) root = setAt(root, joinPath(path, k), v);
  return root;
}

/** Fold one listener op into a local mirror of the listened subtree. Returns the new mirror root. */
export function applyOp(mirror, { op, path, data }) {
  return op === 'patch' ? patchAt(mirror, path, data) : setAt(mirror, path, data);
}

/**
 * What a listener at `listenPath` hears about a change at `changedPath`, or null if it isn't
 * under the listener. `readListened()` returns the listener's whole subtree as it now stands,
 * for changes made above it.
 */
export function opFor(listenPath, changedPath, kind, data, readListened) {
  const l = splitPath(listenPath);
  const c = splitPath(changedPath);
  const prefix = (a, b) => a.length <= b.length && a.every((p, k) => p === b[k]);
  if (prefix(l, c)) return { op: kind, path: '/' + c.slice(l.length).join('/'), data: normalize(data) };
  if (prefix(c, l)) {
    if (kind === 'patch' && !Object.hasOwn(data ?? {}, l[c.length])) return null;
    return { op: 'put', path: '/', data: readListened() };
  }
  return null;
}

/**
 * Subscriber bookkeeping shared by the memory and browser-tab transports: notify(path, kind, data)
 * after each write, and each listener under it gets its op.
 * @param {(path: string) => any} read  current value at a path
 */
export function createHub(read) {
  const subs = new Set();
  return {
    listen(path, onOp) {
      splitPath(path);
      const sub = { path, onOp };
      subs.add(sub);
      // Like RTDB: the current value first, asynchronously.
      queueMicrotask(() => subs.has(sub) && onOp({ op: 'put', path: '/', data: normalize(read(path)) }));
      return () => subs.delete(sub);
    },
    notify(path, kind, data) {
      for (const sub of [...subs]) {
        const op = opFor(sub.path, path, kind, data, () => normalize(read(sub.path)));
        if (op) sub.onOp(op);
      }
    },
  };
}
