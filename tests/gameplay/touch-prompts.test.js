// Every look prompt Gameplay can show, reworded for touch, says Tap/Use and
// never Click, Right click or a key letter. Guards new prompt strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptFor } from '../../src/ui/text.js';
import { setup } from './helpers.js';

function allPrompts(t, player) {
  const { world, rules } = t;
  const targets = [
    ...world.doors.map((d) => ({ kind: 'door', id: d.id })),
    ...world.containers.map((c) => ({ kind: 'container', id: c.id })),
    ...world.anchors.hideSpots.map((h) => ({ kind: 'hide', id: h.id })),
    ...world.nav.links.map((l) => ({ kind: 'linkEntry', id: l.id })),
    ...world.anchors.traps.filter((s) => s.kind === 'piano').map((s) => ({ kind: 'piano', id: s.id })),
    ...rules.items.list().map((i) => ({ kind: 'item', id: i.id })),
    ...['padlock', 'plank', 'fuseBox', 'jeepKey', 'jeepBattery', 'atticChest'].map((id) => ({ kind: 'lock', id })),
    ...[0, 1, 2, 3].map((dial) => ({ kind: 'lock', id: 'keypad', dial })),
    { kind: 'keypad', id: 'keypad' },
    { kind: 'fuseBox', id: 'fuseBox' },
    { kind: 'opener', id: 'opener' },
    { kind: 'jeep', id: 'jeep' },
  ];
  return targets.map((target) => rules.describe(target, player)).filter(Boolean);
}

test('touch prompts never mention clicks or keys', () => {
  const t = setup();
  const prompts = new Set([...allPrompts(t, t.player), ...allPrompts(t, { ...t.player, crouched: true }), 'Click: stop hiding']);
  // Holding things changes the wording ("Click: unlock the padlock"): try each item in hand.
  for (const item of t.rules.items.list().filter((i) => i.where === 'world')) {
    t.rules.giveItem(item.itemId, t.player.pos, t.player.floorId);
    for (const p of allPrompts(t, t.player)) prompts.add(p);
  }
  assert.ok([...prompts].some((p) => p.startsWith('Click:')), 'the fixture produced click prompts to check');
  for (const p of prompts) {
    const touch = promptFor(p, 'touch');
    assert.doesNotMatch(touch, /click|\([A-Z]\)|^[A-Z]: /i, `"${p}" → "${touch}"`);
  }
});
