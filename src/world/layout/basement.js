// BASEMENT (y = -3). Doodle's lair. It sits under the east two thirds of the
// house only; the music and tea rooms stand on solid ground.
//
//  x: 8           14.5  16          24
//  z=0 ┌───────────────┬───────────┐
//      │ STORAGE   ║B ║│ BOILER    │   B = stairs from the front hall, arriving at z 5.5
//      │ fuse box  ║  ║│ ROOM      │
//      │ (west wall)  d│ boiler    │
//  z=8 ├───arch────────┴─────d─────┤
//      │ DOODLE'S      │ LAUNDRY   │
//      │ KENNEL        d washer    │
//      │ dog house,bed │   ══duct══│  crawl duct up to the play kitchen cubby
//  z=18└───────────────┴───────────┘

import { R, flat, wx, wz, door, arch, P, FACE } from './common.js';

const { N, S, E, W } = FACE;

export const BASEMENT = {
  id: 'basement',
  y: -3,
  height: 3,
  bounds: R(8, 24, 0, 18),

  rooms: [
    { id: 'storage', name: 'Storage Room', bounds: R(8, 16, 0, 8), wall: 'concrete', floor: 'concrete', ceiling: 'concrete' },
    { id: 'boilerRoom', name: 'Boiler Room', bounds: R(16, 24, 0, 8), wall: 'brick', floor: 'concrete', ceiling: 'concrete' },
    { id: 'kennelRoom', name: "Doodle's Kennel", bounds: R(8, 16, 8, 18), wall: 'kennel', floor: 'concrete', ceiling: 'concrete' },
    { id: 'laundry', name: 'Laundry', bounds: R(16, 24, 8, 18), wall: 'tileWhite', floor: 'concrete', ceiling: 'concrete' },
  ],

  walls: [
    wx(0, 8, 24), wx(18, 8, 24), wz(8, 0, 18), wz(24, 0, 18),
    wz(16, 0, 18), wx(8, 8, 24),
    // stairs B arrive here: side wall and the wall under their top end
    wz(14.5, 1.5, 5.5, { t: 0.1 }), wx(1.45, 14.5, 16, { t: 0.1 }),
  ],
  openings: [arch('x', 8, 10.5, 13, 2.4)],
  doors: [
    door('storageBoiler', 'z', 16, 6, 7.5, { hinge: 'to', swing: 1, style: 'old' }),
    door('boilerLaundry', 'x', 8, 19.5, 21, { swing: 1, style: 'old' }),
    door('kennelLaundry', 'z', 16, 12, 13.5, { swing: 1, style: 'old' }),
  ],
  railings: [],

  props: [
    // storage
    P('shelfUnit', 10.0, 0.345, S, { seed: 11 }),
    P('shelfUnit', 12.5, 0.345, S, { seed: 12 }),
    P('boxStack', 14.9, 0.7, 0, { seed: 4 }),
    P('boxStack', 8.5, 0.6, 0, { seed: 8, n: 2 }),
    P('rockingHorse', 11.6, 3.8, 0.4, { sheet: true }),
    P('dressForm', 13.6, 6.6),
    // boiler room
    P('boiler', 21.5, 3.0, S),
    P('waterHeater', 23.4, 1.0),
    P('boxStack', 18.0, 0.55, 0, { seed: 13, n: 2 }),
    P('pipeRun', 20, 0.4, 0, { len: 8, axis: 'x' }, { y: 2.75 }),
    P('pipeRun', 23.6, 4, 0, { len: 8, axis: 'z', r: 0.05, color: 0x9a6a3a }, { y: 2.6 }),
    // Doodle's kennel
    P('dogHouse', 9.22, 16.78, N),
    P('dogBed', 12.5, 15.5),
    P('bowl', 14.5, 17.45, 0, { color: 0xd8343c }),
    P('bowl', 15.05, 17.45, 0, { color: 0x3a7be0, food: 0x5a9ad0 }),
    P('bone', 11.0, 13.0, 0.4),
    P('bone', 13.8, 14.2, 2.1),
    P('bone', 10.8, 15.0, 1.2, { len: 0.4 }),
    P('bone', 14.6, 11.0, 0.9),
    P('chewedToy', 13.7, 16.9, 0, { color: 0xf5d03a }),
    P('chewedToy', 10.7, 11.9, 1, { color: 0xf07ab8 }),
    P('rug', 12.4, 12.4, 0.2, { w: 2.0, d: 1.4, color: 0x7a3a3a }, { rugStyle: 'mat' }),
    // laundry
    P('washer', 21.81, 8.43, S),
    P('washer', 22.5, 8.43, S, { dryer: true }),
    P('sink', 23.4, 8.35, S),
    P('laundryBasket', 20.4, 10.0, 0.3),
    P('ironingBoard', 18.0, 10.5),
    P('crawlDuct', 20.95, 17.15, W),
    P('pipeRun', 20, 8.4, 0, { len: 8, axis: 'x', r: 0.05 }, { y: 2.7 }),
  ],
  wallProps: [{ type: 'fuseBox', id: 'fuseBox', x: 8.18, y: 1.3, z: 3.5, rot: E }],
  containers: [
    { id: 'storageTrunk', kind: 'chest', type: 'chestContainer', x: 8.4, z: 5.4, rot: E, opts: { color: 0x6e4528, lid: 0x5a3a20, old: true }, item: 'jeepKey' },
    { id: 'boilerCabinet', kind: 'cabinet', type: 'cabinet', x: 16.37, z: 2.5, rot: E, opts: { color: 0x7a8088, door: 0x5a6068, h: 1.2 }, item: 'fuse' },
    { id: 'laundryDrawer', kind: 'drawer', type: 'drawerUnit', x: 23.63, z: 12.0, rot: W, opts: { color: 0xece6dc, front: 0x9ad0f0 }, item: 'treats' },
  ],
  hides: [
    { id: 'hideStorageWardrobe', kind: 'wardrobe', type: 'wardrobeHide', x: 8.47, z: 7.0, rot: E, opts: { color: 0x6e4528, door: 0x8a6040 } },
    { id: 'hideLaundryCabinet', kind: 'cabinet', type: 'cabinetHide', x: 16.47, z: 15.2, rot: E, opts: { door: 0xb0c8d8 } },
  ],
  lamps: [
    { id: 'lampStorage', x: 11.5, y: 2.65, z: 3.5, color: 0xffe0a0, intensity: 0.65, range: 6, flicker: true, fixture: 'bulb' },
    { id: 'lampBoiler', x: 21.5, y: 0.6, z: 3.85, color: 0xff7030, intensity: 0.75, range: 5.5, flicker: true, fixture: 'none' },
    { id: 'lampKennel', x: 12.0, y: 2.65, z: 13.0, color: 0xff9070, intensity: 0.55, range: 6, flicker: true, fixture: 'bulb' },
    { id: 'lampLaundry', x: 20, y: 2.65, z: 12.5, color: 0xe0f0ff, intensity: 0.65, range: 6, fixture: 'bulb' },
  ],
  windows: [
    { axis: 'x', at: 0, center: 11, bottom: 2.1, w: 0.9, h: 0.5 },
    { axis: 'x', at: 0, center: 19.0, bottom: 2.1, w: 0.9, h: 0.5 },
    { axis: 'x', at: 18, center: 13, bottom: 2.1, w: 0.9, h: 0.5 },
    { axis: 'z', at: 24, center: 14.6, bottom: 2.1, w: 0.9, h: 0.5 },
  ],
  traps: [
    { id: 'squeakStorage', kind: 'squeaky', x: 12.2, z: 6.6, radius: 0.3 },
    { id: 'squeakKennel', kind: 'squeaky', x: 11.75, z: 9.1, radius: 0.3 },
    { id: 'squeakLaundry', kind: 'squeaky', x: 17.1, z: 12.75, radius: 0.3 },
    { id: 'blocksStorage', kind: 'blocks', x: 9.9, z: 2.9, radius: 0.4 },
  ],
  spawns: [
    { item: 'hammer', id: 'sHammerStorage', x: 10.0, y: 0.62, z: 0.35 },
    { item: 'jeepKey', id: 'sJeepKeyKennel', x: 14.2, y: 0, z: 16.9 },
    { item: 'carBattery', id: 'sBatteryBoiler', x: 18.6, y: 0, z: 4.6 },
    { item: 'carBattery', id: 'sBatteryLaundry', x: 21.4, y: 0, z: 14.4 },
    { item: 'toyChestKey', id: 'sChestKeyKennel', x: 11.4, y: 0, z: 16.6 },
    { item: 'tennisBall', id: 'sBallKennel', x: 13.6, y: 0, z: 12.1 },
    { item: 'treats', id: 'sTreatsLaundry', x: 22.5, y: 0.9, z: 8.4 },
  ],
  patrol: [
    { id: 'patrolStorage', x: 11.25, z: 4.75 },
    { id: 'patrolBoiler', x: 19.25, z: 5.25 },
    { id: 'patrolKennel', x: 12.25, z: 11.25 },
    { id: 'patrolLaundry', x: 19.75, z: 13.25 },
  ],
  drawings: [{ id: 'drawingKennel', x: 15.885, y: 1.25, z: 10.0, rotY: W }],
  decals: [
    { tex: 'goodDog', x: 9.22, y: 2.45, z: 17.885, rotY: N, w: 1.1, h: 0.4 },
    { tex: 'drawingScratched2', x: 8.115, y: 1.35, z: 11.0, rotY: E, w: 0.5, h: 0.38 },
    { tex: 'drawingScratched1', x: 8.115, y: 1.15, z: 13.4, rotY: E, w: 0.45, h: 0.34 },
    { tex: 'scratches', x: 8.115, y: 0.6, z: 12.3, rotY: E, w: 1.4, h: 0.9 },
    { tex: 'scratches', x: 15.885, y: 0.55, z: 15.6, rotY: W, w: 1.2, h: 0.8 },
    { tex: 'pawPrints', x: 12.6, y: 0.004, z: 10.2, rotY: 0.3, w: 1.0, h: 3.0, floor: true },
    { tex: 'danger', x: 23.885, y: 1.5, z: 3.0, rotY: W, w: 0.5, h: 0.3 },
  ],
  marks: [{ box: flat(18, 19.5, 16.5, 17.5), crawl: true }], // the duct's crawl-in mouth
  holes: [],
};
