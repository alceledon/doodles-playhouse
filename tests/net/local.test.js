import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabTransport } from '../../src/net/local.js';
import { hostRoom, joinRoom } from '../../src/net/session.js';

/** A Storage stand-in shared by two "tabs". */
function memoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (k) => [...map.keys()][k] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const settle = async () => {
  for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r, 1));
};

test('two tabs: host and guest find each other through storage + BroadcastChannel', async () => {
  const storage = memoryStorage();
  const a = createTabTransport({ storage, channel: new BroadcastChannel('doodle-net-test') });
  const b = createTabTransport({ storage, channel: new BroadcastChannel('doodle-net-test') });
  try {
    let t = 0;
    const now = () => t;
    const host = await hostRoom({ transport: a, name: 'AL', difficulty: 'easy', rule: 'shared', now });
    const joined = [];
    host.on('joined', (j) => joined.push(j.name));
    const guest = await joinRoom({ transport: b, code: host.code, name: 'BO', now });
    const got = [];
    guest.on('message', (m) => got.push(m.step));
    host.send({ type: 'flow', step: 'go' });
    for (let k = 0; k < 10; k++) {
      t += 60;
      host.tick(t);
      guest.tick(t);
      await settle();
    }
    assert.deepEqual(joined, ['BO']);
    assert.deepEqual(got, ['go']);
    assert.ok([...storage.map.keys()].every((k) => k.startsWith(`doodle-net:rooms/${host.code}/`)), 'one key per room part');
    await host.close();
    await settle();
    assert.equal(storage.map.size, 0, 'closing the room clears it from storage');
  } finally {
    a.close();
    b.close();
  }
});
