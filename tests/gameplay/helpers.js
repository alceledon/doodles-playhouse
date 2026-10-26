// Shared setup for the gameplay tests: the mini-house fixture, a bus that
// records every event, and the rules on top.
import { createBus, EVENTS } from '../../src/core/events.js';
import { createRng } from '../../src/core/rng.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { createRules } from '../../src/gameplay/rules.js';

export function setup({ seed = 1, difficulty = 'normal' } = {}) {
  const bus = createBus();
  const events = [];
  for (const type of Object.values(EVENTS)) bus.on(type, (payload) => events.push({ type, payload }));
  const world = createMiniHouse({ bus });
  const rules = createRules({ world, bus, rng: createRng(seed), difficulty });
  const start = world.anchors.startBed;
  const player = { pos: { ...start.pos }, floorId: start.floorId, crouched: false, hidden: false };

  const of = (type) => events.filter((e) => e.type === type).map((e) => e.payload);
  const instOf = (itemId) => rules.items.list().find((i) => i.itemId === itemId && i.where === 'world');

  /** Walk over to an item (open its container if needed) and pick it up. */
  function grab(itemId) {
    const inst = instOf(itemId);
    if (!inst) throw new Error(`no ${itemId} in the world`);
    if (inst.containerId) {
      const c = world.containers.find((x) => x.id === inst.containerId);
      if (!c.isOpen) rules.interact({ kind: 'container', id: c.id }, player);
    }
    player.pos = { ...inst.pos };
    player.floorId = inst.floorId;
    const result = rules.interact({ kind: 'item', id: inst.id }, player);
    if (rules.items.heldItemId() !== itemId) throw new Error(`could not pick up ${itemId}: ${JSON.stringify(result)}`);
    return inst;
  }

  /** Roll the keypad dials to a code string. */
  function dial(code) {
    for (let i = 0; i < 4; i++) {
      let guard = 0;
      while (rules.keypad.digits[i] !== Number(code[i]) && guard++ < 10) rules.interact({ kind: 'lock', id: 'keypad', dial: i }, player);
    }
  }

  return { bus, events, world, rules, player, of, instOf, grab, dial };
}
