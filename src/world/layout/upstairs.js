// UPSTAIRS (y = 3). You wake in the Kids' Bedroom every day.
//
//  x: 0           8     9.5      14.5  16          24
//  z=0 ┌───────────┬────────────────────┬───────────┐
//      │ NURSERY   │ ░A░   LANDING  ║C ║│ CRAFT     │
//      │ crib +    │ ░░░            ║  ║│ ROOM      │   ░A░ stairwell down (railed)
//      │ mobile    │ ░░░            ║  ║│           │   C   attic stairs behind a door
//  z=8 ├──d────────d────────────────────d───────────┤
//      │ KIDS'     ├─────arch─────┤     │ BATHROOM  │ z=9 / 8..13
//      │ BEDROOM   d  BIG SLIDE    d    ├──────────┤ z=13
//      │ bunks     │  PLAYROOM  ▼slide  d TOY      │
//      │      ═tube═            tent  │ CLOSET    │
//  z=18└───────────┴────────────────────┴───────────┘

import { R, flat, wx, wz, door, arch, rail, P, FACE } from './common.js';

const { N, S, E, W } = FACE;

export const UPSTAIRS = {
  id: 'upstairs',
  y: 3,
  height: 3,
  bounds: R(0, 24, 0, 18),

  rooms: [
    { id: 'nursery', name: 'Nursery', bounds: R(0, 8, 0, 8), wall: 'polkaMint', floor: 'carpetPink' },
    { id: 'landing', name: 'Upstairs Landing', bounds: R(8, 16, 0, 9), wall: 'stripesLilac', floor: 'wood' },
    { id: 'craftRoom', name: 'Craft Room', bounds: R(16, 24, 0, 8), wall: 'crayon', floor: 'wood' },
    { id: 'kidsBedroom', name: "Kids' Bedroom", bounds: R(0, 8, 8, 18), wall: 'starsNavy', floor: 'carpetBlue', ceiling: 'stars' },
    { id: 'slideRoom', name: 'Big Slide Playroom', bounds: R(8, 16, 9, 18), wall: 'rainbow', floor: 'wood' },
    { id: 'bathroom', name: 'Bathroom', bounds: R(16, 24, 8, 13), wall: 'tileWhite', floor: 'tileBlue' },
    { id: 'toyCloset', name: 'Toy Closet', bounds: R(16, 24, 13, 18), wall: 'polkaYellow', floor: 'woodDark' },
  ],

  walls: [
    wx(0, 0, 24), wx(18, 0, 24), wz(0, 0, 18), wz(24, 0, 18),
    wz(8, 0, 18), wz(16, 0, 18), wx(8, 0, 8), wx(9, 8, 16), wx(8, 16, 24), wx(13, 16, 24),
    // attic stairs (C): side wall, far end, and the wall that holds the attic door
    wz(14.5, 1.5, 5.5, { t: 0.1 }), wx(5.55, 14.5, 16, { t: 0.1 }), wx(1.45, 14.5, 16, { t: 0.1 }),
  ],
  openings: [
    arch('x', 9, 10.5, 13.5),
    { axis: 'z', at: 8, from: 16.5, to: 17.5, bottom: 0, top: 0.85 }, // the play tube's hole
  ],
  doors: [
    door('landingNursery', 'z', 8, 6, 7.5, { hinge: 'to', swing: -1 }),
    door('landingCraft', 'z', 16, 6, 7.5, { hinge: 'to', swing: 1 }),
    door('atticDoor', 'x', 1.45, 14.5, 16, { swing: -1, style: 'old', cellBox: flat(14.5, 15.5, 1, 1.5) }),
    door('nurseryBedroom', 'x', 8, 3, 4.5, { swing: 1 }),
    door('slideBedroom', 'z', 8, 12, 13.5, { swing: -1 }),
    door('slideBathroom', 'z', 16, 10, 11.5, { swing: 1 }),
    door('slideCloset', 'z', 16, 15, 16.5, { swing: 1 }),
  ],
  // around the stairwell down (A), whose deep end is at z = 1.5
  railings: [rail('z', 9.5, 1.5, 5.5), rail('x', 1.45, 8.1, 9.5)],

  props: [
    // nursery
    P('rockingChair', 6.2, 2.2, W),
    P('toyBox', 1.5, 7.56, N),
    P('rug', 4, 4, 0, { w: 2.6, round: true, color: 0xf0a0c8 }, { rugStyle: 'round' }),
    P('blockTower', 5.0, 6.4, 0, { n: 7, seed: 11 }),
    // landing
    P('bookshelf', 12.0, 0.295, S, { w: 1.2, h: 1.2, color: 0xc0a0f0, seed: 8, gap: { shelf: 1, x0: 0.06, x1: 0.34 } }), // gap: sJeepKeyLanding
    P('toyBox', 13.3, 0.38, S, { color: 0xf07ab8, lid: 0x3a7be0 }),
    P('rug', 12, 5.0, 0, { w: 1.5, d: 7.0 }, { rugStyle: 'runner' }),
    P('beanbag', 10.4, 8.0, 0, { color: 0x8a52d0 }),
    // craft room
    P('table', 19.0, 3.0, 0, { w: 1.2, d: 0.7, h: 0.55, top: 0xf3e2c0, leg: 0x3a7be0 }),
    P('kidChair', 19.0, 3.75, N, { color: 0xd8343c }),
    P('kidChair', 19.0, 2.25, S, { color: 0xf5d03a }),
    P('table', 21.6, 5.4, 0, { w: 1.2, d: 0.7, h: 0.55, top: 0xf3e2c0, leg: 0xf07ab8 }),
    P('kidChair', 21.6, 6.15, N, { color: 0x45b85a }),
    P('easel', 21.5, 1.0, S),
    P('paintShelf', 23.63, 3.0, W),
    P('floorLamp', 16.5, 0.55, 0, { shade: 0xfff0b0 }),
    P('blockTower', 17.6, 5.0, 0, { n: 4, seed: 13 }),
    // kids' bedroom
    P('bunkBed', 0.62, 10.4, E, { color: 0x3a7be0, sheet: 0xf5d03a, sheet2: 0xf07ab8 }),
    P('sleepingBag', 3.6, 11.0, 0, { color: 0x8a52d0 }),
    P('sleepingBag', 4.6, 15.0, 0.3, { color: 0x2fb8a8 }),
    P('rug', 4.2, 13.2, 0, { w: 3.0, round: true, color: 0x3a5ad0 }, { rugStyle: 'round' }),
    P('playTube', 8.0, 17.0, 0),
    // big slide playroom
    P('slideEntry', 11.0, 16.0, 0, {}, { tag: { kind: 'linkEntry', id: 'bigSlide' } }),
    P('beanbag', 9.3, 10.6, 0, { color: 0xf5d03a }),
    P('beanbag', 13.4, 10.4, 0, { color: 0xd8343c }),
    P('rockingHorse', 14.6, 17.3, N),
    P('blockTower', 9.6, 15.0, 0, { n: 6, seed: 5 }),
    P('rug', 12, 13, 0, { w: 3.2, d: 2.4 }, { rugStyle: 'rainbow' }),
    // bathroom
    P('bathtub', 23.5, 9.0, W),
    P('sink', 19.0, 12.65, N),
    P('toilet', 20.6, 12.57, N),
    P('hamper', 22.6, 12.5),
    P('rug', 21.5, 10.6, 0, { w: 1.2, d: 0.8, color: 0x9ad0f0 }, { rugStyle: 'mat' }),
    // toy closet
    P('shelfUnit', 18.5, 17.655, N, { seed: 6, color: 0xc8b8a0 }),
    P('shelfUnit', 21.0, 17.655, N, { seed: 8, color: 0xc8b8a0 }),
    P('boxStack', 22.8, 13.6, 0, { seed: 7 }),
    P('boxStack', 17.0, 17.3, 0, { seed: 9, n: 2 }),
  ],
  wallProps: [],
  containers: [
    { id: 'changingTableDrawer', kind: 'drawer', type: 'changingTable', x: 3.0, z: 0.395, rot: S, item: 'jeepKey' },
    { id: 'bedroomToyChest', kind: 'chest', type: 'chestContainer', x: 0.4, z: 12.5, rot: E, opts: { color: 0x45b85a, lid: 0xf5d03a }, item: 'toyChestKey' },
    { id: 'bedroomDresser', kind: 'drawer', type: 'drawerUnit', x: 7.63, z: 10.0, rot: W, opts: { color: 0xf3e2c0, front: 0x3a7be0 }, item: 'padlockKey' },
    { id: 'craftDrawers', kind: 'drawer', type: 'drawerUnit', x: 16.37, z: 2.0, rot: E, opts: { color: 0xece6dc, front: 0xf08a24 }, item: 'fuse' },
    { id: 'bathroomVanity', kind: 'cabinet', type: 'cabinet', x: 17.6, z: 12.63, rot: N, opts: { door: 0x9ad0f0 }, item: 'dart' },
    { id: 'closetWardrobe', kind: 'wardrobe', type: 'wardrobeContainer', x: 19.0, z: 13.42, rot: S, item: 'carBattery' },
    { id: 'playroomShelfBin', kind: 'drawer', type: 'drawerUnit', x: 12.8, z: 17.63, rot: N, opts: { color: 0xf5d03a, front: 0xd8343c }, item: 'tennisBall' },
  ],
  hides: [
    { id: 'hideNurseryCrib', kind: 'underbed', type: 'crib', x: 0.52, z: 3.0, rot: E },
    { id: 'hideBunkUnder', kind: 'underbed', type: 'bunkBed', x: 0.62, z: 14.6, rot: E, opts: { underbed: true, color: 0xd8343c, sheet: 0x45b85a, sheet2: 0xf08a24 } },
    { id: 'hideBedroomWardrobe', kind: 'wardrobe', type: 'wardrobeHide', x: 6.6, z: 8.47, rot: S },
    { id: 'hidePlayroomTent', kind: 'fort', type: 'tentHide', x: 14.7, z: 13.1, rot: W },
    { id: 'hideClosetWardrobe', kind: 'wardrobe', type: 'wardrobeHide', x: 23.53, z: 15.5, rot: W, opts: { color: 0x8a52d0, door: 0xc0a0f0 } },
  ],
  lamps: [
    { id: 'lampNursery', x: 7.85, y: 0.35, z: 2.5, color: 0xff9de2, intensity: 0.6, range: 4.5, flicker: true, fixture: 'night', rotY: W },
    { id: 'lampLanding', x: 12, y: 2.55, z: 4, color: 0xffe0a0, intensity: 0.8, range: 6.5, fixture: 'ceiling' },
    { id: 'lampCraft', x: 16.5, y: 1.51, z: 0.55, color: 0xfff0c0, intensity: 0.85, range: 6, fixture: 'none' },
    { id: 'lampBedroom', x: 1.2, y: 1.75, z: 11.6, color: 0xffc890, intensity: 0.65, range: 5, fixture: 'clip' },
    { id: 'nightBedroom', x: 3.5, y: 0.35, z: 17.85, color: 0x9ab0ff, intensity: 0.4, range: 3.5, flicker: true, fixture: 'night', rotY: N },
    { id: 'lampSlide', x: 12, y: 2.55, z: 13.5, color: 0xfff0a0, intensity: 0.8, range: 6.5, fixture: 'ceiling' },
    { id: 'lampBathroom', x: 20, y: 2.6, z: 10.5, color: 0xd0f0ff, intensity: 0.7, range: 5, fixture: 'ceiling' },
    { id: 'lampCloset', x: 20, y: 2.7, z: 15.5, color: 0xffe0b0, intensity: 0.5, range: 4.5, flicker: true, fixture: 'bulb' },
    { id: 'nightLanding', x: 15.885, y: 0.3, z: 8.25, color: 0xffd0a0, intensity: 0.35, range: 2.8, flicker: true, fixture: 'night', rotY: W },
  ],
  windows: [
    { axis: 'x', at: 0, center: 4.5, bottom: 1.0, w: 1.1, h: 1.1 },
    { axis: 'z', at: 0, center: 6, bottom: 1.1, w: 1.0, h: 1.0 },
    { axis: 'x', at: 0, center: 10.25, bottom: 1.1, w: 0.8, h: 1.0 },
    { axis: 'x', at: 0, center: 14.0, bottom: 1.3, w: 0.6, h: 0.7 },
    { axis: 'x', at: 0, center: 18.5, bottom: 1.1, w: 1.1, h: 1.0 },
    { axis: 'z', at: 24, center: 6, bottom: 1.1, w: 1.0, h: 1.0 },
    { axis: 'z', at: 0, center: 12.5, bottom: 1.0, w: 1.0, h: 1.1 },
    { axis: 'x', at: 18, center: 3.0, bottom: 1.0, w: 1.0, h: 1.1 },
    { axis: 'x', at: 18, center: 11, bottom: 1.0, w: 1.2, h: 1.1 },
    { axis: 'z', at: 24, center: 11.5, bottom: 1.3, w: 0.8, h: 0.8 },
  ],
  traps: [
    { id: 'creakLanding', kind: 'creaky', x: 12, z: 6.5, radius: 0.4, level: 0 },
    { id: 'creakLandingFront', kind: 'creaky', x: 11.0, z: 2.8, radius: 0.4, level: 2 },
    { id: 'creakSlideRoom', kind: 'creaky', x: 12.5, z: 11.0, radius: 0.4, level: 1 },
    { id: 'squeakLanding', kind: 'squeaky', x: 11.4, z: 7.3, radius: 0.3 },
    { id: 'squeakSlideRoom', kind: 'squeaky', x: 11.9, z: 12.4, radius: 0.3 },
    { id: 'squeakBedroom', kind: 'squeaky', x: 5.6, z: 12.75, radius: 0.3 },
    { id: 'squeakNursery', kind: 'squeaky', x: 5.0, z: 6.6, radius: 0.3 },
    { id: 'squeakCraft', kind: 'squeaky', x: 17.2, z: 6.75, radius: 0.3 },
    { id: 'squeakBathroom', kind: 'squeaky', x: 17.3, z: 10.75, radius: 0.3 },
    { id: 'blocksLanding', kind: 'blocks', x: 13.6, z: 7.6, radius: 0.4 },
    { id: 'blocksSlideRoom', kind: 'blocks', x: 13.2, z: 15.2, radius: 0.4 },
    { id: 'blocksBedroom', kind: 'blocks', x: 2.6, z: 16.5, radius: 0.4 },
    { id: 'blocksCraft', kind: 'blocks', x: 20.6, z: 7.0, radius: 0.4 },
  ],
  spawns: [
    { item: 'jeepKey', id: 'sJeepKeyLanding', x: 11.8, y: 0.44, z: 0.3 },
    { item: 'hammer', id: 'sHammerCraft', x: 19.25, y: 0.55, z: 3.05 },
    { item: 'fuse', id: 'sFuseBathroom', x: 19.15, y: 0.92, z: 12.55 },
    { item: 'toyChestKey', id: 'sChestKeyNursery', x: 6.06, y: 0.52, z: 2.2, rotY: Math.PI / 2 }, // rocking-chair seat, in front of the teddy
    { item: 'tennisBall', id: 'sBallSlide', x: 12.6, y: 0, z: 14.4 },
    { item: 'treats', id: 'sTreatsLanding', x: 10.1, y: 0, z: 6.9 },
    { item: 'dart', id: 'sDartBedroom', x: 3.9, y: 0, z: 12.1 },
  ],
  patrol: [
    { id: 'patrolLanding', x: 12, z: 3.25 },
    { id: 'patrolSlideRoom', x: 12, z: 13.25 },
    { id: 'patrolBedroom', x: 4.25, z: 12.75 },
    { id: 'patrolNursery', x: 4.25, z: 5.25 },
    { id: 'patrolCraft', x: 19.75, z: 4.75 },
    { id: 'patrolBathroom', x: 19.25, z: 10.75 },
    { id: 'patrolCloset', x: 19.75, z: 15.75 },
  ],
  drawings: [{ id: 'drawingCraft', x: 23.885, y: 1.3, z: 5.0, rotY: W }],
  decals: [
    { tex: 'drawingScratched1', x: 0.115, y: 1.3, z: 16.4, rotY: E, w: 0.5, h: 0.38 },
    { tex: 'drawing2', x: 7.885, y: 1.25, z: 14.8, rotY: W, w: 0.45, h: 0.34 },
    { tex: 'drawing1', x: 16.115, y: 1.3, z: 4.0, rotY: E, w: 0.5, h: 0.38 },
    { tex: 'drawing4', x: 19.4, y: 1.25, z: 0.115, rotY: S, w: 0.45, h: 0.34 },
    { tex: 'drawing3', x: 8.115, y: 1.2, z: 11.0, rotY: E, w: 0.45, h: 0.34 },
    { tex: 'abc', x: 6.6, y: 1.6, z: 0.115, rotY: S, w: 1.4, h: 0.3 },
  ],
  marks: [{ box: flat(6.5, 9.5, 16.5, 17.5), crawl: true }], // inside the play tube
  holes: [],
  /** Hatch in this floor where the Big Slide's chute drops through to the living room. */
  slabHoles: [R(10.5, 11.5, 15.5, 16.5)],
};
