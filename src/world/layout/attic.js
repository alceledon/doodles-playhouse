// ATTIC (y = 6). One long room under a pitched roof (ridge along Z at x = 12),
// with 1.4 m knee walls. Dead end: the only way out is the stairs you came up.
//
//  x: 8               14.5 16
//  z=1 ┌──────[gable]─────┐
//      │ [locked chest]║C ║   C = top of the attic stairs (arrive at z 5.5)
//      │               ║  ║
//      │ trunk          ··│
//      │         ghost    │
//      │  ░░ teddy hoard ░░│
//  z=13└──────[gable]─────┘  round window

import { R, wx, wz, rail, P, FACE } from './common.js';

const { S, E, W } = FACE;

export const ROOF = Object.freeze({ ridgeX: 12, kneeY: 1.4, ridgeY: 3.4 });

export const ATTIC = {
  id: 'attic',
  y: 6,
  height: ROOF.ridgeY,
  bounds: R(8, 16, 1, 13),
  roof: ROOF,

  rooms: [{ id: 'attic', name: 'Attic', bounds: R(8, 16, 1, 13), wall: 'atticWood', floor: 'attic', ceiling: 'roof' }],

  walls: [
    wz(8, 1, 13, { y1: ROOF.kneeY }), wz(16, 1, 13, { y1: ROOF.kneeY }),
    wx(1, 8, 16, { y1: ROOF.ridgeY, gable: true }), wx(13, 8, 16, { y1: ROOF.ridgeY, gable: true }),
  ],
  openings: [],
  doors: [],
  // around the attic stairwell, whose deep end is at z = 1.5
  railings: [rail('z', 14.5, 1.5, 5.5), rail('x', 1.45, 14.5, 15.9)],

  props: [
    P('hoardMound', 11.5, 11.5, 0, { w: 5, d: 2.5 }),
    P('rockingHorse', 13.2, 7.8, 0, { sheet: true }),
    P('dressForm', 9.0, 3.6),
    P('boxStack', 13.9, 2.6, 0, { seed: 21 }),
    P('boxStack', 15.2, 11.9, 0, { seed: 22, n: 2 }),
    P('rug', 11.8, 5.6, 0, { w: 1.6, d: 2.2, color: 0x8a5a7a }, { rugStyle: 'mat' }),
  ],
  wallProps: [],
  containers: [
    {
      id: 'atticChest', kind: 'chest', type: 'chestContainer', x: 10.5, z: 1.42, rot: S, locked: true,
      opts: { w: 1.0, d: 0.6, h: 0.55, color: 0x5a3a20, lid: 0x4a2a18, old: true },
    },
    { id: 'atticDresser', kind: 'drawer', type: 'drawerUnit', x: 15.63, z: 9.0, rot: W, opts: { color: 0x8a6a4a, front: 0x6e4528, knob: 0xc8a040 }, item: 'dart' },
  ],
  hides: [{ id: 'hideAtticTrunk', kind: 'chest', type: 'chestHide', x: 8.55, z: 7.0, rot: E, opts: { color: 0x6e4528, lid: 0x5a3a20, old: true } }],
  lamps: [{ id: 'lampAttic', x: 12, y: 2.4, z: 6.5, color: 0xffd090, intensity: 0.7, range: 6.5, flicker: true, fixture: 'bulb', cord: 0.9 }],
  windows: [
    { axis: 'x', at: 13, center: 12, bottom: 1.5, w: 0.8, h: 0.8, round: true },
    { axis: 'x', at: 1, center: 9.6, bottom: 1.25, w: 0.5, h: 0.5, round: true },
  ],
  traps: [
    { id: 'creakAttic', kind: 'creaky', x: 12.5, z: 6.0, radius: 0.4, level: 0 },
    { id: 'creakAtticHoard', kind: 'creaky', x: 10.8, z: 8.6, radius: 0.4, level: 1 },
    { id: 'squeakAttic', kind: 'squeaky', x: 11.4, z: 5.0, radius: 0.3 },
    { id: 'blocksAttic', kind: 'blocks', x: 9.7, z: 4.6, radius: 0.4 },
  ],
  spawns: [
    { item: 'padlockKey', id: 'sPadlockAttic', x: 14.2, y: 0, z: 9.9 },
    { item: 'hammer', id: 'sHammerAttic', x: 9.6, y: 0, z: 5.4 },
    { item: 'carBattery', id: 'sBatteryAttic', x: 14.9, y: 0, z: 7.4 },
  ],
  patrol: [
    { id: 'patrolAttic', x: 12, z: 7.25 },
    { id: 'patrolAtticFront', x: 11.25, z: 3.25 },
    { id: 'patrolAtticHoard', x: 12.75, z: 9.25 },
  ],
  drawings: [{ id: 'drawingAttic', x: 12, y: 1.3, z: 1.115, rotY: S }],
  decals: [
    { tex: 'drawingScratched2', x: 8.115, y: 0.8, z: 10.0, rotY: E, w: 0.45, h: 0.34 },
    { tex: 'drawing3', x: 15.885, y: 0.85, z: 10.6, rotY: W, w: 0.45, h: 0.34 },
  ],
  marks: [],
  holes: [],
};
