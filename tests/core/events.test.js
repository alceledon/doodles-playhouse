import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../../src/core/events.js';

test('on/emit delivers payloads and unsubscribe stops them', () => {
  const bus = createBus();
  const got = [];
  const off = bus.on(EVENTS.NOISE, (p) => got.push(p.loudness));
  bus.emit(EVENTS.NOISE, { loudness: 3 });
  off();
  bus.emit(EVENTS.NOISE, { loudness: 4 });
  assert.deepEqual(got, [3]);
});

test('unknown event names throw on both on() and emit()', () => {
  const bus = createBus();
  assert.throws(() => bus.on('nosie', () => {}), /Unknown event/);
  assert.throws(() => bus.emit('nosie'), /Unknown event/);
});

test('once fires a single time', () => {
  const bus = createBus();
  let n = 0;
  bus.once(EVENTS.CAUGHT, () => n++);
  bus.emit(EVENTS.CAUGHT);
  bus.emit(EVENTS.CAUGHT);
  assert.equal(n, 1);
});

test('scope.dispose removes only that scope\'s handlers', () => {
  const bus = createBus();
  const run = bus.scope();
  const got = [];
  bus.on(EVENTS.DAY_START, () => got.push('root'));
  run.on(EVENTS.DAY_START, () => got.push('run'));
  run.emit(EVENTS.DAY_START, { day: 1 });
  run.dispose();
  bus.emit(EVENTS.DAY_START, { day: 2 });
  assert.deepEqual(got, ['root', 'run', 'root']);
});

test('a throwing handler does not stop the others', () => {
  const bus = createBus();
  const errors = console.error;
  console.error = () => {};
  try {
    let reached = false;
    bus.on(EVENTS.SPOTTED, () => {
      throw new Error('boom');
    });
    bus.on(EVENTS.SPOTTED, () => (reached = true));
    bus.emit(EVENTS.SPOTTED);
    assert.equal(reached, true);
  } finally {
    console.error = errors;
  }
});

test('handlers may unsubscribe while the event is being delivered', () => {
  const bus = createBus();
  const got = [];
  const offA = bus.on(EVENTS.HELD, () => {
    got.push('a');
    offA();
  });
  bus.on(EVENTS.HELD, () => got.push('b'));
  bus.emit(EVENTS.HELD);
  bus.emit(EVENTS.HELD);
  assert.deepEqual(got, ['a', 'b', 'b']);
});
