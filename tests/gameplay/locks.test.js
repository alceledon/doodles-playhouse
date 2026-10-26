import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, LOCKS, LOCK_IDS } from '../../src/core/contracts.js';
import { EVENTS } from '../../src/core/events.js';
import { LOCK_NEEDS } from '../../src/gameplay/locks.js';
import { setup } from './helpers.js';

const frontDoor = (t) => t.world.doors.find((d) => d.id === t.world.anchors.frontDoor.doorId);
const garageDoor = (t) => t.world.doors.find((d) => d.id === t.world.anchors.garage.doorId);

test('every lock needs exactly its item', () => {
  for (const lockId of LOCK_IDS) {
    if (lockId === LOCKS.KEYPAD) continue;
    const t = setup();
    for (const wrong of Object.values(ITEMS)) {
      if (wrong === LOCK_NEEDS[lockId]) continue;
      assert.equal(t.rules.locks.tryItem(lockId, wrong), 'wrongItem', `${lockId} with ${wrong}`);
    }
    assert.equal(t.rules.locks.tryItem(lockId, null), 'wrongItem');
    assert.equal(t.rules.locks.isOpen(lockId), false);
    assert.equal(t.rules.locks.tryItem(lockId, LOCK_NEEDS[lockId]), 'opened');
    assert.equal(t.rules.locks.tryItem(lockId, LOCK_NEEDS[lockId]), 'alreadyOpen');
    assert.deepEqual(t.of(EVENTS.LOCK_OPENED), [{ lockId }]);
  }
});

test('padlock: a wrong item is refused and kept, the key opens it and is used up', () => {
  const t = setup();
  t.grab(ITEMS.HAMMER);
  const target = { kind: 'lock', id: LOCKS.PADLOCK };
  assert.equal(t.rules.describe(target, t.player), 'Locked: needs the Padlock Key');
  assert.deepEqual(t.rules.interact(target, t.player), { message: 'Locked: needs the Padlock Key' });
  assert.equal(t.rules.items.heldItemId(), ITEMS.HAMMER);
  assert.equal(t.rules.locks.isOpen(LOCKS.PADLOCK), false);

  const key = t.grab(ITEMS.PADLOCK_KEY);
  assert.equal(t.rules.describe(target, t.player), 'Click: unlock the padlock');
  assert.equal(t.rules.interact(target, t.player).action, 'lock');
  assert.equal(t.rules.locks.isOpen(LOCKS.PADLOCK), true);
  assert.equal(key.where, 'gone');
  assert.equal(t.rules.items.heldItemId(), null);
});

test('plank: needs the hammer; right click with it works too', () => {
  const t = setup();
  const target = { kind: 'lock', id: LOCKS.PLANK };
  assert.equal(t.rules.describe(target, t.player), 'Nailed shut: needs the Hammer');
  t.grab(ITEMS.FUSE);
  assert.equal(t.rules.useHeld(target, t.player), null); // the fuse has no use of its own here
  assert.equal(t.rules.locks.isOpen(LOCKS.PLANK), false);
  t.grab(ITEMS.HAMMER);
  assert.equal(t.rules.useHeld(target, t.player).action, 'lock');
  assert.equal(t.rules.locks.isOpen(LOCKS.PLANK), true);
});

test('keypad: the wrong code does nothing, the right code opens it', () => {
  const t = setup({ seed: 42 });
  const code = t.rules.code;
  const wrong = code.split('').map((d, i) => (i === 2 ? String((Number(d) + 5) % 10) : d)).join('');
  t.dial(wrong);
  assert.equal(t.rules.keypad.entered(), wrong);
  assert.equal(t.rules.locks.isOpen(LOCKS.KEYPAD), false);
  // Right click turns a dial back.
  t.rules.useHeld({ kind: 'lock', id: LOCKS.KEYPAD, dial: 0 }, t.player);
  assert.equal(t.rules.keypad.digits[0], (Number(code[0]) + 9) % 10);
  t.dial(code);
  assert.equal(t.rules.locks.isOpen(LOCKS.KEYPAD), true);
  assert.deepEqual(t.of(EVENTS.LOCK_OPENED), [{ lockId: LOCKS.KEYPAD }]);
  // Once open, the dials stop turning.
  t.rules.interact({ kind: 'lock', id: LOCKS.KEYPAD, dial: 1 }, t.player);
  assert.equal(t.rules.keypad.entered(), code);
  assert.equal(t.rules.describe({ kind: 'keypad', id: 'keypad' }, t.player), 'Keypad: unlocked');
});

test('front door: unlocks only when all three locks are open, in any order', () => {
  for (const order of [['padlock', 'plank', 'keypad'], ['keypad', 'plank', 'padlock'], ['plank', 'keypad', 'padlock']]) {
    const t = setup({ seed: 9 });
    const door = frontDoor(t);
    assert.equal(t.rules.describe({ kind: 'door', id: door.id }, t.player), 'Locked: padlock, plank and keypad');
    for (const [k, lock] of order.entries()) {
      assert.equal(door.locked, true);
      assert.equal(t.of(EVENTS.EXIT_UNLOCKED).length, 0);
      if (lock === 'padlock') {
        t.grab(ITEMS.PADLOCK_KEY);
        t.rules.interact({ kind: 'lock', id: 'padlock' }, t.player);
      } else if (lock === 'plank') {
        t.grab(ITEMS.HAMMER);
        t.rules.interact({ kind: 'lock', id: 'plank' }, t.player);
      } else t.dial(t.rules.code);
      assert.equal(t.of(EVENTS.LOCK_OPENED).length, k + 1);
    }
    assert.equal(door.locked, false);
    assert.deepEqual(t.of(EVENTS.EXIT_UNLOCKED), [{ route: 'frontDoor' }]);
  }
});

test('fuse box powers the opener, which unlocks and opens the garage door', () => {
  const t = setup();
  const door = garageDoor(t);
  const opener = { kind: 'opener', id: 'opener' };
  assert.match(t.rules.interact(opener, t.player).message, /No power/);
  assert.equal(door.locked, true);
  assert.equal(t.rules.describe({ kind: 'door', id: door.id }, t.player), 'Locked: the garage door opener has no power');

  t.grab(ITEMS.HAMMER);
  assert.match(t.rules.interact({ kind: 'fuseBox', id: 'fuseBox' }, t.player).message, /needs a Fuse/);
  t.grab(ITEMS.FUSE);
  assert.equal(t.rules.describe({ kind: 'fuseBox', id: 'fuseBox' }, t.player), 'Click: put in the Fuse');
  t.rules.interact({ kind: 'fuseBox', id: 'fuseBox' }, t.player);
  assert.equal(t.rules.locks.garagePowered(), true);
  assert.equal(door.locked, true); // power alone doesn't open it

  assert.equal(t.rules.interact(opener, t.player).result, 'opened');
  assert.equal(door.locked, false);
  assert.equal(door.isOpen, true);
  assert.ok(t.of(EVENTS.DOOR_OPENED).some((e) => e.doorId === door.id));
  assert.equal(t.rules.interact(opener, t.player).result, 'closed');
  assert.equal(door.isOpen, false);
});

test('jeep: needs the key and the battery, then EXIT_UNLOCKED garage', () => {
  const t = setup();
  const jeep = { kind: 'jeep', id: 'jeep' };
  assert.equal(t.rules.describe(jeep, t.player), 'Jeep: needs the Jeep Key and Car Battery');
  t.grab(ITEMS.HAMMER);
  assert.match(t.rules.interact(jeep, t.player).message, /needs the Jeep Key/);
  assert.equal(t.rules.items.heldItemId(), ITEMS.HAMMER);

  t.grab(ITEMS.CAR_BATTERY);
  assert.equal(t.rules.describe(jeep, t.player), 'Click: put in the Car Battery');
  t.rules.interact(jeep, t.player);
  assert.equal(t.rules.describe(jeep, t.player), 'Jeep: needs the Jeep Key');
  t.grab(ITEMS.JEEP_KEY);
  t.rules.interact(jeep, t.player);
  assert.equal(t.rules.locks.jeepReady(), true);
  // The fuse isn't in yet, so the garage route isn't fully open.
  assert.equal(t.of(EVENTS.EXIT_UNLOCKED).length, 0);
  t.grab(ITEMS.FUSE);
  t.rules.interact({ kind: 'fuseBox', id: 'fuseBox' }, t.player);
  assert.deepEqual(t.of(EVENTS.EXIT_UNLOCKED), [{ route: 'garage' }]);
});

test('attic chest: the Toy Chest Key unlocks and opens it', () => {
  const t = setup();
  const chest = { kind: 'container', id: 'atticChest' };
  assert.equal(t.rules.describe(chest, t.player), 'Locked: needs the Toy Chest Key');
  t.grab(ITEMS.PADLOCK_KEY);
  assert.match(t.rules.interact(chest, t.player).message, /needs the Toy Chest Key/);
  assert.equal(t.rules.items.heldItemId(), ITEMS.PADLOCK_KEY);
  t.grab(ITEMS.TOY_CHEST_KEY);
  t.rules.interact(chest, t.player);
  const c = t.world.containers.find((x) => x.id === 'atticChest');
  assert.equal(c.locked, false);
  assert.equal(c.isOpen, true);
  assert.deepEqual(t.of(EVENTS.LOCK_OPENED), [{ lockId: 'atticChest' }]);
  const launcher = t.instOf(ITEMS.LAUNCHER);
  assert.equal(t.rules.canPickUp(launcher), true);
});

test('openAll opens everything and sets the dials to the code', () => {
  const t = setup();
  t.rules.openAll();
  for (const id of LOCK_IDS) assert.equal(t.rules.locks.isOpen(id), true, id);
  assert.equal(frontDoor(t).locked, false);
  assert.equal(garageDoor(t).locked, false);
  assert.equal(t.rules.keypad.entered(), t.rules.code);
  assert.equal(t.of(EVENTS.EXIT_UNLOCKED).length, 2);
});
