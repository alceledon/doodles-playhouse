// Both escape routes, played through the rules on the mini-house fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../../src/core/contracts.js';
import { EVENTS } from '../../src/core/events.js';
import { setup } from './helpers.js';

for (const seed of [1, 2, 3, 77]) {
  test(`front door escape (seed ${seed})`, () => {
    const t = setup({ seed });
    const door = { kind: 'door', id: t.world.anchors.frontDoor.doorId };
    // Locked: clicking does nothing but tell you why.
    assert.match(t.rules.interact(door, t.player).message, /Locked/);
    assert.equal(t.of(EVENTS.ESCAPED).length, 0);

    t.grab(ITEMS.PADLOCK_KEY);
    t.rules.interact({ kind: 'lock', id: 'padlock' }, t.player);
    t.grab(ITEMS.HAMMER);
    t.rules.interact({ kind: 'lock', id: 'plank' }, t.player);
    assert.match(t.rules.interact(door, t.player).message, /Locked: keypad/);
    t.dial(t.rules.code);
    assert.equal(t.rules.describe(door, t.player), 'Click: open the front door and escape!');
    assert.equal(t.of(EVENTS.ESCAPED).length, 0);

    assert.deepEqual(t.rules.interact(door, t.player), { action: 'escaped', route: 'frontDoor' });
    assert.deepEqual(t.of(EVENTS.ESCAPED), [{ route: 'frontDoor' }]);
    assert.equal(t.world.doors.find((d) => d.id === door.id).isOpen, true);
    // Only once.
    t.rules.interact(door, t.player);
    assert.equal(t.of(EVENTS.ESCAPED).length, 1);
  });

  test(`garage escape (seed ${seed})`, () => {
    const t = setup({ seed });
    const jeep = { kind: 'jeep', id: 'jeep' };
    t.grab(ITEMS.FUSE);
    t.rules.interact({ kind: 'fuseBox', id: 'fuseBox' }, t.player);
    t.grab(ITEMS.JEEP_KEY);
    t.rules.interact(jeep, t.player);
    t.grab(ITEMS.CAR_BATTERY);
    t.rules.interact(jeep, t.player);

    // Door still closed: the Jeep starts (loudly) but you're not out.
    const r = t.rules.interact(jeep, t.player);
    assert.match(r.message, /garage door is closed/);
    assert.equal(t.of(EVENTS.JEEP_STARTED).length, 1);
    const roar = t.of(EVENTS.NOISE).filter((n) => n.kind === 'jeep');
    assert.equal(roar.length, 1);
    assert.ok(roar[0].loudness >= 30, 'very loud');
    assert.equal(t.of(EVENTS.ESCAPED).length, 0);

    t.rules.interact({ kind: 'opener', id: 'opener' }, t.player);
    assert.deepEqual(t.rules.interact(jeep, t.player), { action: 'escaped', route: 'garage' });
    assert.deepEqual(t.of(EVENTS.ESCAPED), [{ route: 'garage' }]);
    assert.equal(t.of(EVENTS.JEEP_STARTED).length, 2);
  });
}

test('the jeep does not go without both parts, even with the door open', () => {
  const t = setup();
  t.grab(ITEMS.FUSE);
  t.rules.interact({ kind: 'fuseBox', id: 'fuseBox' }, t.player);
  t.rules.interact({ kind: 'opener', id: 'opener' }, t.player);
  t.grab(ITEMS.JEEP_KEY);
  t.rules.interact({ kind: 'jeep', id: 'jeep' }, t.player);
  assert.match(t.rules.interact({ kind: 'jeep', id: 'jeep' }, t.player).message, /needs the Car Battery/);
  assert.equal(t.of(EVENTS.JEEP_STARTED).length, 0);
  assert.equal(t.of(EVENTS.ESCAPED).length, 0);
});

test('an unlocked ordinary door toggles, but not on top of you', () => {
  const t = setup();
  const target = { kind: 'door', id: 'hallKitchen' };
  const door = t.world.doors.find((d) => d.id === 'hallKitchen');
  t.player.pos = { x: 5, y: 0, z: 4 };
  t.player.floorId = 'ground';
  assert.equal(t.rules.interact(target, t.player).open, true);
  t.player.pos = { x: 6, y: 0, z: 4 }; // standing in the doorway
  assert.match(t.rules.interact(target, t.player).message, /doorway/);
  assert.equal(door.isOpen, true);
  t.player.pos = { x: 5, y: 0, z: 4 };
  assert.equal(t.rules.interact(target, t.player).open, false);
});

test('slides are one-way and tunnels need a crouch', () => {
  const t = setup();
  const slide = t.world.nav.links.find((l) => l.kind === 'slide');
  const tunnel = t.world.nav.links.find((l) => l.kind === 'tunnel');
  t.player.pos = { ...slide.points[0] };
  t.player.floorId = slide.from.floorId;
  assert.deepEqual(t.rules.interact({ kind: 'linkEntry', id: slide.id }, t.player), { action: 'link', link: slide, reverse: false });
  t.player.pos = { ...slide.points.at(-1) };
  assert.match(t.rules.interact({ kind: 'linkEntry', id: slide.id }, t.player).message, /can't climb/);

  t.player.pos = { ...tunnel.points.at(-1) };
  t.player.floorId = tunnel.to.floorId;
  assert.match(t.rules.interact({ kind: 'linkEntry', id: tunnel.id }, t.player).message, /Crouch/);
  t.player.crouched = true;
  assert.deepEqual(t.rules.interact({ kind: 'linkEntry', id: tunnel.id }, t.player), { action: 'link', link: tunnel, reverse: true });
});

test('hide spots hand back the spot to the 3D layer', () => {
  const t = setup();
  const spot = t.world.anchors.hideSpots[0];
  assert.match(t.rules.describe({ kind: 'hide', id: spot.id }, t.player), /^Click: hide/);
  assert.deepEqual(t.rules.interact({ kind: 'hide', id: spot.id }, t.player), { action: 'hide', spot });
});
