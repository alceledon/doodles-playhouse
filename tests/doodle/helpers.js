// Shared setup for the Doodle tests: the mini-house fixture on a real bus, a
// Doodle brain, a fake player and a fixed-step simulator.

import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { createBus, EVENTS } from '../../src/core/events.js';
import { createRng } from '../../src/core/rng.js';
import { createDoodleCore } from '../../src/doodle/brain.js';

export const DT = 1 / 30;

/** A Player in the contract shape, posable by the test. `vis` is what visibility() returns. */
export function makePlayer(x, y, z, floorId = 'ground', { vis = 1 } = {}) {
  const p = {
    pos: { x, y, z },
    floorId,
    yaw: 0,
    pitch: 0,
    crouched: false,
    sprinting: false,
    hidden: false,
    hideSpotId: null,
    flashlightOn: false,
    held: null,
    stamina: 1,
    moving: false,
    vis,
    eyePos: () => ({ x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z }),
    visibility: () => (p.hidden ? 0 : p.vis),
    moveTo(nx, ny, nz, nfloor = p.floorId) {
      p.pos = { x: nx, y: ny, z: nz };
      p.floorId = nfloor;
    },
  };
  return p;
}

/**
 * Fixture world + bus + awake Doodle at the kennel.
 * @param {{difficulty?: string, tuning?: Object, wakeDelay?: number, seed?: number, at?: {pos, floorId, rotY?}}} [opts]
 */
export function setup({ difficulty = 'normal', tuning = null, wakeDelay = 0, seed = 7, at = null } = {}) {
  const bus = createBus();
  const world = createMiniHouse({ bus });
  const doodle = createDoodleCore({ world, bus, rng: createRng(seed), difficulty, tuning });
  const events = [];
  for (const type of Object.values(EVENTS)) bus.on(type, (payload) => events.push({ type, payload, t: sim.time }));
  const sim = {
    bus,
    world,
    doodle,
    events,
    time: 0,
    /** Advance `seconds`, stopping early when until() returns true. Returns whether until() fired. */
    run(seconds, player = null, until = null) {
      const steps = Math.round(seconds / DT);
      for (let k = 0; k < steps; k++) {
        doodle.update(DT, player);
        sim.time += DT;
        if (until?.()) return true;
      }
      return false;
    },
    count: (type) => events.filter((e) => e.type === type).length,
    first: (type) => events.find((e) => e.type === type),
    of: (type) => events.filter((e) => e.type === type),
    door: (id) => world.doors.find((d) => d.id === id),
  };
  doodle.reset(at ?? world.anchors.kennel, { wakeDelay });
  doodle.setActive(true);
  if (wakeDelay === 0) doodle.update(DT, null); // wake now → PATROL
  return sim;
}

/** Put the Doodle somewhere specific, awake, facing a yaw (0 = -Z). */
export function place(sim, x, z, floorId = 'ground', yaw = 0) {
  const y = sim.world.nav.floors[floorId].y;
  sim.doodle.reset({ id: 'test', floorId, pos: { x, y, z }, rotY: yaw }, { wakeDelay: 0 });
  sim.doodle.update(DT, null); // wake → PATROL
  sim.doodle.yaw = yaw;
}

export { EVENTS };
