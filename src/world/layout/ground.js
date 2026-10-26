// GROUND FLOOR (y = 0). Front door on the north wall (z = 0), garage roll-up on
// the east wall (x = 24).
//
//  x: 0           8     9.5      14.5  16          24
//  z=0 ┌───────────┬─────[FRONT DOOR]─────┬───────────┐
//      │ MUSIC     │ ║up║           ║dn║ │ GARAGE    │
//      │ ROOM      │ ║A ║  FRONT    ║B ║ │   jeep ▶  ═ roll-up door
//      │ piano     │ ║  ║  HALL     ║  ║ │           │
//  z=8 ├──d────────┴───d═══arch═══d──────┴─────d─────┤
//      │ TEA PARTY │ LIVING ROOM           │ PLAY      │
//      │ train ◯   d  TV  couch  [ball pit]d KITCHEN   │
//      │ fort      │       (slide lands)   │ cubby ▣   │  ▣ crawl tunnel from the laundry
//  z=18└───────────┴───────────────────────┴───────────┘
//  A = stairs up (enclosed, rising south), B = stairs down to the basement behind a door.

import { R, flat, wx, wz, door, arch, P, FACE } from './common.js';

const { N, S, E, W } = FACE;

export const GROUND = {
  id: 'ground',
  y: 0,
  height: 3,
  bounds: R(0, 24, 0, 18),

  rooms: [
    { id: 'musicRoom', name: 'Music Room', bounds: R(0, 8, 0, 8), wall: 'stripesBlue', floor: 'wood' },
    { id: 'frontHall', name: 'Front Hall', bounds: R(8, 16, 0, 8), wall: 'polkaYellow', floor: 'woodDark' },
    { id: 'garage', name: 'Garage', bounds: R(16, 24, 0, 8), wall: 'pegboard', floor: 'concrete', ceiling: 'concrete' },
    { id: 'teaParty', name: 'Tea Party Room', bounds: R(0, 8, 8, 18), wall: 'polkaPink', floor: 'wood' },
    { id: 'livingRoom', name: 'Living Room', bounds: R(8, 16, 8, 18), wall: 'starsNavy', floor: 'carpetTeal' },
    { id: 'playKitchen', name: 'Play Kitchen', bounds: R(16, 24, 8, 18), wall: 'tileMint', floor: 'checker' },
  ],

  walls: [
    wx(0, 0, 24), wx(18, 0, 24), wz(0, 0, 18), wz(24, 0, 18),
    wz(8, 0, 18), wz(16, 0, 18), wx(8, 0, 24),
    // stairs up (A): side wall and the closet wall under its top end
    wz(9.5, 1.5, 5.5, { t: 0.1 }), wx(5.55, 8, 9.5, { t: 0.1 }),
    // stairs down (B): side wall, far end, and the wall that holds the basement door
    wz(14.5, 1.5, 5.5, { t: 0.1 }), wx(5.55, 14.5, 16, { t: 0.1 }), wx(1.45, 14.5, 16, { t: 0.1 }),
  ],
  openings: [arch('x', 8, 10.5, 13.5)],
  doors: [
    door('frontDoor', 'x', 0, 11, 13, { kind: 'double', locked: true, swing: -1, style: 'front' }),
    door('garageDoor', 'z', 24, 2.5, 5.5, { kind: 'rollup', locked: true, style: 'garage' }),
    door('hallMusic', 'z', 8, 6, 7.5, { hinge: 'to', swing: -1 }),
    door('hallGarage', 'z', 16, 6, 7.5, { hinge: 'to', swing: 1 }),
    door('basementDoor', 'x', 1.45, 14.5, 16, { swing: 1, style: 'old', cellBox: flat(14.5, 15.5, 1, 1.5) }),
    door('musicTea', 'x', 8, 3, 4.5, { swing: 1 }),
    door('teaLiving', 'z', 8, 12, 13.5, { swing: 1 }),
    door('livingKitchen', 'z', 16, 12, 13.5, { swing: 1 }),
    door('kitchenGarage', 'x', 8, 19.5, 21, { hinge: 'to', swing: -1 }),
  ],
  railings: [],

  props: [
    // music room
    P('toyPiano', 0.4, 3.5, E, {}, { tag: { kind: 'piano', id: 'trapPiano' } }),
    P('drumKit', 2.5, 1.0, S),
    P('xylophone', 4.6, 1.0, S),
    P('rockingHorse', 6.6, 3.6, W),
    P('floorLamp', 0.6, 0.6, 0, { shade: 0xf0b060 }),
    P('rug', 4, 4.2, 0, { w: 2.8, round: true, color: 0xe85a8a }, { rugStyle: 'round' }),
    P('beanbag', 5.2, 5.6, 0, { color: 0x45b85a }),
    // front hall
    P('bench', 10.2, 0.32, S),
    P('umbrellaStand', 14.15, 0.36),
    P('coatRack', 14.0, 6.15),
    P('rug', 12, 4.6, 0, { w: 1.5, d: 5.6 }, { rugStyle: 'rainbow' }),
    // garage
    P('jeep', 21.0, 4.0, E, {}, { tag: { kind: 'jeep', id: 'jeep' } }),
    P('workbench', 18.5, 0.47, S),
    P('shelfUnit', 16.35, 1.2, E, { seed: 4 }),
    P('boxStack', 23.45, 0.55, 0, { seed: 2 }),
    P('boxStack', 23.4, 7.35, 0, { seed: 5, n: 2 }),
    P('tire', 17.3, 4.8),
    P('tire', 17.3, 4.8, 0, {}, { y: 0.25 }),
    P('cone', 22.6, 7.2),
    // tea party: the table, its guests and the toy train (meshes.js) circling them
    P('roundTable', 4, 13),
    P('kidChair', 4, 12.0, S, { color: 0xf07ab8 }),
    P('kidChair', 5.0, 13, W, { color: 0x3a7be0 }),
    P('kidChair', 4, 14.0, N, { color: 0xf5d03a }),
    P('kidChair', 3.0, 13, E, { color: 0x45b85a }),
    P('teaSet', 4, 13, 0, {}, { y: 0.5 }),
    P('bookshelf', 5.6, 17.68, N, { w: 1.2, h: 1.3, color: 0xf0b8d0, seed: 3 }),
    P('rockingChair', 7.2, 16.9, N),
    // living room
    P('couch', 11.2, 10.0, E, { w: 2.0 }),
    P('table', 13.0, 10.0, E, { w: 1.0, d: 0.6, h: 0.4, top: 0xd9b07a }),
    P('bookshelf', 8.3, 9.6, E, { w: 1.0, h: 1.5, seed: 5 }),
    P('floorLamp', 8.6, 17.4, 0, { shade: 0xf0a070 }),
    P('rug', 11.6, 13.4, 0, { w: 3.0, round: true }, { rugStyle: 'round' }),
    P('beanbag', 9.2, 14.2, 0, { color: 0xf08a24 }),
    P('blockTower', 9.4, 11.6, 0, { n: 5, seed: 7 }),
    // play kitchen
    P('counterRun', 23.58, 11.5, W, { len: 4.0, stove: true, sinkAt: 1.0 }),
    P('fridge', 23.55, 8.5, W),
    P('table', 20.0, 12.8, 0, { w: 1.2, d: 0.8, h: 0.55, top: 0xf5d03a, leg: 0xec8ab8 }),
    P('kidChair', 20.0, 11.9, S, { color: 0x2fb8a8 }),
    P('kidChair', 20.0, 13.7, N, { color: 0x8a52d0 }),
    P('cubby', 22.9, 17.2, N),
  ],
  wallProps: [
    { type: 'keypad', id: 'keypad', x: 13.6, y: 1.2, z: 0.145, rot: S },
    { type: 'openerButton', id: 'opener', x: 23.855, y: 1.2, z: 6.75, rot: W },
  ],
  containers: [
    { id: 'musicShelfDrawer', kind: 'drawer', type: 'drawerUnit', x: 0.37, z: 6.2, rot: E, opts: { front: 0x3a7be0 }, item: 'fuse' },
    { id: 'hallConsoleDrawer', kind: 'drawer', type: 'drawerUnit', x: 9.82, z: 3.5, rot: E, opts: { color: 0x6e4528, front: 0xb07a48, knob: 0xc8a040 }, item: 'dart' },
    { id: 'garageWorkbenchDrawer', kind: 'drawer', type: 'drawerUnit', x: 20.3, z: 0.37, rot: S, opts: { color: 0x8a8a90, front: 0xd8343c }, item: 'padlockKey' },
    { id: 'garageToolCabinet', kind: 'cabinet', type: 'cabinet', x: 16.37, z: 3.0, rot: E, opts: { color: 0xd8343c, door: 0xb02a30, h: 1.1 }, item: 'hammer' },
    { id: 'teaHutch', kind: 'cabinet', type: 'cabinet', x: 0.37, z: 10.0, rot: E, opts: { color: 0xf0b8d0, door: 0xf07ab8, h: 1.2 }, item: 'treats' },
    { id: 'tvStandDrawer', kind: 'drawer', type: 'tvStandDrawer', x: 15.63, z: 10.0, rot: W, item: 'toyChestKey' },
    { id: 'kitchenDrawer', kind: 'drawer', type: 'drawerUnit', x: 23.63, z: 14.1, rot: W, opts: { front: 0x2fb8a8 }, item: 'padlockKey' },
    { id: 'kitchenCupboard', kind: 'cabinet', type: 'cabinet', x: 17.5, z: 8.37, rot: S, opts: { door: 0xf07ab8 }, item: 'treats' },
  ],
  hides: [
    { id: 'hideMusicChest', kind: 'chest', type: 'chestHide', x: 6.6, z: 0.55, rot: S },
    { id: 'hideTeaFort', kind: 'fort', type: 'fortHide', x: 1.15, z: 16.9, rot: N },
    { id: 'hideBallPit', kind: 'ballpit', type: 'ballPit', x: 14.0, z: 16.0, rot: W },
    { id: 'hideKitchenCabinet', kind: 'cabinet', type: 'cabinetHide', x: 18.5, z: 17.53, rot: N },
  ],
  lamps: [
    { id: 'lampMusic', x: 0.6, y: 1.51, z: 0.6, color: 0xffc070, intensity: 0.85, range: 6.5, fixture: 'none' },
    { id: 'lampHall', x: 12, y: 2.55, z: 4, color: 0xffd38a, intensity: 0.85, range: 6.5, fixture: 'lantern' },
    { id: 'lampGarage', x: 20, y: 2.7, z: 4, color: 0xc8e0ff, intensity: 0.7, range: 6.5, flicker: true, fixture: 'bulb' },
    { id: 'lampTea', x: 4, y: 2.45, z: 13, color: 0xffa0d0, intensity: 0.85, range: 6.5, fixture: 'chandelier' },
    { id: 'lampLiving', x: 8.6, y: 1.51, z: 17.4, color: 0xffb070, intensity: 0.8, range: 6.5, fixture: 'none' },
    { id: 'lampKitchen', x: 20, y: 2.6, z: 13, color: 0xb8ffe0, intensity: 0.8, range: 6.5, fixture: 'ceiling' },
    { id: 'nightHall', x: 9.85, y: 0.3, z: 7.88, color: 0x9ad0ff, intensity: 0.35, range: 2.8, flicker: true, fixture: 'night', rotY: N },
  ],
  windows: [
    { axis: 'x', at: 0, center: 4, bottom: 1.2, w: 1.1, h: 1.0 },
    { axis: 'z', at: 0, center: 3.5, bottom: 1.35, w: 1.0, h: 0.9 },
    { axis: 'x', at: 0, center: 10.25, bottom: 1.2, w: 0.8, h: 1.0 },
    { axis: 'x', at: 0, center: 13.75, bottom: 1.6, w: 0.5, h: 0.6 },
    { axis: 'x', at: 0, center: 22.0, bottom: 1.6, w: 1.2, h: 0.6 },
    { axis: 'z', at: 0, center: 13, bottom: 1.0, w: 1.2, h: 1.1 },
    { axis: 'x', at: 18, center: 4, bottom: 1.0, w: 1.1, h: 1.1 },
    { axis: 'x', at: 18, center: 11, bottom: 1.0, w: 1.4, h: 1.1 },
    { axis: 'x', at: 18, center: 20.5, bottom: 1.1, w: 1.0, h: 1.0 },
    { axis: 'z', at: 24, center: 11.5, bottom: 1.25, w: 1.2, h: 0.9 },
  ],
  traps: [
    { id: 'creakHall', kind: 'creaky', x: 12, z: 1.2, radius: 0.4, level: 0 },
    { id: 'creakLivingArch', kind: 'creaky', x: 12, z: 9.25, radius: 0.4, level: 1 },
    { id: 'creakMusic', kind: 'creaky', x: 6.0, z: 6.8, radius: 0.4, level: 2 },
    { id: 'creakTea', kind: 'creaky', x: 6.5, z: 10.0, radius: 0.4, level: 2 },
    { id: 'trapPiano', kind: 'piano', x: 1.0, z: 3.5, radius: 0.6 },
    { id: 'squeakHallArch', kind: 'squeaky', x: 12.2, z: 7.1, radius: 0.3 },
    { id: 'squeakLiving', kind: 'squeaky', x: 10.2, z: 13.4, radius: 0.3 },
    { id: 'squeakLivingTv', kind: 'squeaky', x: 14.2, z: 12.2, radius: 0.3 },
    { id: 'squeakKitchen', kind: 'squeaky', x: 17.8, z: 12.8, radius: 0.3 },
    { id: 'squeakTea', kind: 'squeaky', x: 6.9, z: 12.75, radius: 0.3 },
    { id: 'squeakMusic', kind: 'squeaky', x: 3.75, z: 7.0, radius: 0.3 },
    { id: 'squeakGarage', kind: 'squeaky', x: 18.6, z: 6.6, radius: 0.3 },
    { id: 'blocksHall', kind: 'blocks', x: 10.6, z: 5.0, radius: 0.4 },
    { id: 'blocksTea', kind: 'blocks', x: 2.0, z: 9.6, radius: 0.4 },
    { id: 'blocksLiving', kind: 'blocks', x: 9.6, z: 16.4, radius: 0.4 },
    { id: 'blocksKitchen', kind: 'blocks', x: 21.0, z: 15.8, radius: 0.4 },
  ],
  spawns: [
    { item: 'padlockKey', id: 'sPadlockLiving', x: 13.0, y: 0.4, z: 9.75 },
    { item: 'jeepKey', id: 'sJeepKeyTea', x: 4.35, y: 0.5, z: 12.7 },
    { item: 'carBattery', id: 'sBatteryMusic', x: 2.4, y: 0, z: 6.4 },
    { item: 'fuse', id: 'sFuseKitchen', x: 23.5, y: 0.9, z: 10.3 },
    { item: 'toyChestKey', id: 'sChestKeyGarage', x: 19.0, y: 0.92, z: 0.5 },
    { item: 'tennisBall', id: 'sBallLiving', x: 10.0, y: 0, z: 12.3 },
    { item: 'tennisBall', id: 'sBallGarage', x: 18.4, y: 0, z: 3.6 },
    { item: 'dart', id: 'sDartMusic', x: 3.2, y: 0, z: 4.6 },
  ],
  patrol: [
    { id: 'patrolHallFront', x: 12, z: 2.5 },
    { id: 'patrolHallBack', x: 12, z: 6.75 },
    { id: 'patrolMusic', x: 4.0, z: 4.75 },
    { id: 'patrolTea', x: 5.75, z: 9.75 },
    { id: 'patrolLiving', x: 12.25, z: 12.25 },
    { id: 'patrolKitchen', x: 18.75, z: 14.75 },
    { id: 'patrolGarage', x: 18.75, z: 5.75 },
  ],
  drawings: [{ id: 'drawingLiving', x: 9.4, y: 1.3, z: 8.115, rotY: S }],
  decals: [
    { tex: 'drawing1', x: 7.885, y: 1.25, z: 3.0, rotY: W, w: 0.5, h: 0.38 },
    { tex: 'drawing3', x: 9.565, y: 1.2, z: 2.3, rotY: E, w: 0.45, h: 0.34 },
    { tex: 'drawing2', x: 0.115, y: 1.3, z: 15.0, rotY: E, w: 0.5, h: 0.38 },
    { tex: 'poster', x: 15.885, y: 1.4, z: 15.0, rotY: W, w: 0.6, h: 0.8 },
    { tex: 'drawing4', x: 18.5, y: 1.3, z: 8.115, rotY: S, w: 0.45, h: 0.34 },
    { tex: 'oilStain', x: 21.3, y: 0.004, z: 4.0, rotY: 0, w: 1.4, h: 1.0, floor: true },
  ],
  marks: [{ box: flat(22, 23.5, 16.5, 17.5), crawl: true }], // inside the kitchen cubby
  holes: [],
  /** The hatch at the back of the cubby where the laundry duct comes up. */
  slabHoles: [R(23.2, 23.9, 16.7, 17.7)],
};
