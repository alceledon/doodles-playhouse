// The whole playhouse as data: four floor specs plus what ties them together
// (stair ramps, the Big Slide, the crawl tunnels) and the anchors that aren't
// owned by a single prop. Pure data — build.js turns it into the World.

import { BASEMENT } from './basement.js';
import { GROUND } from './ground.js';
import { UPSTAIRS } from './upstairs.js';
import { ATTIC } from './attic.js';
import { R, FACE } from './common.js';

export { ROOF } from './attic.js';
export const FLOORS = [BASEMENT, GROUND, UPSTAIRS, ATTIC];

/**
 * Stair ramps. heightAt() is linear from lowAt (lowFloor's y) to highAt
 * (highFloor's y) along `axis`, and the floor id flips halfway. `inner` is the
 * walkable width between the enclosure walls (used for the step meshes);
 * `lane` is the X the stair link follows (a cell centre).
 */
export const RAMPS = [
  { id: 'stairsMain', footprint: R(8, 9.5, 1.5, 5.5), inner: R(8.1, 9.45, 1.5, 5.5), axis: 'z', lowAt: 1.5, highAt: 5.5, lowFloor: 'ground', highFloor: 'upstairs', lane: 8.75, style: 'rainbow' },
  { id: 'stairsBasement', footprint: R(14.5, 16, 1.5, 5.5), inner: R(14.55, 15.9, 1.5, 5.5), axis: 'z', lowAt: 5.5, highAt: 1.5, lowFloor: 'basement', highFloor: 'ground', lane: 15.25, style: 'old' },
  { id: 'stairsAttic', footprint: R(14.5, 16, 1.5, 5.5), inner: R(14.55, 15.9, 1.5, 5.5), axis: 'z', lowAt: 1.5, highAt: 5.5, lowFloor: 'upstairs', highFloor: 'attic', lane: 15.25, style: 'old' },
];

/**
 * Player-only links. `from`/`to` are world points snapped to their nav cells;
 * `points` are absolute [x, y, z] for the mover to follow (feet positions).
 */
export const LINKS = [
  {
    id: 'bigSlide', kind: 'slide', oneWay: true, playerOnly: true, crawl: false,
    from: { floorId: 'upstairs', x: 10.25, z: 16.0 },
    to: { floorId: 'ground', x: 11.75, z: 16.0 },
    points: [
      [10.25, 3, 16.0], [10.8, 3.1, 16.0], [11.6, 2.75, 16.0], [12.8, 1.75, 16.0], [13.8, 0.9, 16.0],
      [14.4, 0.55, 16.0], [13.6, 0.35, 16.0], [12.6, 0.7, 16.0], [11.75, 0, 16.0],
    ],
    // the chute's centreline, from the upstairs hatch down into the ball pit
    chute: [[10.6, 3.0, 16.0], [11.6, 2.6, 16.0], [12.8, 1.6, 16.0], [13.8, 0.75, 16.0], [14.45, 0.42, 16.0]],
  },
  {
    id: 'laundryTunnel', kind: 'tunnel', oneWay: false, playerOnly: true, crawl: true,
    from: { floorId: 'basement', x: 17.75, z: 17.0 },
    to: { floorId: 'ground', x: 22.75, z: 15.75 },
    points: [
      [17.75, -3, 17.0], [18.3, -3, 17.1], [19.5, -3, 17.2], [23.0, -0.5, 17.2], [23.45, -0.15, 17.2],
      [23.45, 0, 17.2], [22.9, 0, 17.1], [22.75, 0, 16.3], [22.75, 0, 15.75],
    ],
    // inside of the duct the camera crawls through: centreline, width, height
    interior: { points: [[18.0, -3, 17.2], [19.5, -3, 17.2], [23.2, -0.9, 17.2]], w: 1.3, h: 0.85 },
    mouths: [
      { floorId: 'basement', box: { minX: 17.98, maxX: 18.08, minY: -3, maxY: -2.2, minZ: 16.5, maxZ: 17.9 } },
      { floorId: 'ground', box: { minX: 21.9, maxX: 23.9, minY: 0, maxY: 0.8, minZ: 16.42, maxZ: 16.55 } },
    ],
  },
  {
    id: 'bedroomTube', kind: 'tunnel', oneWay: false, playerOnly: true, crawl: true,
    from: { floorId: 'upstairs', x: 6.25, z: 17.0 },
    to: { floorId: 'upstairs', x: 9.75, z: 17.0 },
    points: [[6.25, 3, 17.0], [6.6, 3, 17.0], [9.4, 3, 17.0], [9.75, 3, 17.0]],
    mouths: [
      { floorId: 'upstairs', box: { minX: 6.42, maxX: 6.55, minY: 3, maxY: 3.84, minZ: 16.55, maxZ: 17.45 } },
      { floorId: 'upstairs', box: { minX: 9.45, maxX: 9.58, minY: 3, maxY: 3.84, minZ: 16.55, maxZ: 17.45 } },
    ],
  },
];

/** Anchors that aren't produced by a prop (prop-owned ones — keypad, opener, fuse box, hide spots — come from their builders). */
export const ANCHORS = {
  startBed: { floorId: 'upstairs', x: 1.6, y: 0, z: 10.4, rotY: FACE.E }, // beside the bottom bunk, facing into the room
  kennel: { floorId: 'basement', x: 12.5, y: 0, z: 15.5, rotY: FACE.N }, // Doodle sleeps on its chewed bed
  kennelBed: { floorId: 'basement', x: 12.85, y: 0.12, z: 15.85 }, // where it drops the ball
  frontDoor: {
    doorId: 'frontDoor',
    padlock: { floorId: 'ground', x: 12.0, y: 1.0, z: 0.13, rotY: FACE.S },
    plank: { floorId: 'ground', x: 12.0, y: 1.45, z: 0.15, rotY: FACE.S },
    keypadId: 'keypad', // the wall prop
    exit: { floorId: 'ground', x: 12.0, y: 0, z: -3.5 },
  },
  garage: {
    doorId: 'garageDoor',
    jeep: { floorId: 'ground', x: 21.0, y: 0, z: 4.0, rotY: FACE.E },
    openerId: 'opener',
    exit: { floorId: 'ground', x: 27.5, y: 0, z: 4.0 },
  },
  fuseBoxId: 'fuseBox',
  atticChestId: 'atticChest',
};

/** Set pieces for the animated bits (meshes.js / animated.js). */
export const SET_PIECES = {
  train: { floorId: 'ground', cx: 4, cz: 13, rx: 2.6, rz: 3.3 },
  tv: { floorId: 'ground', x: 15.62, y: 0.62, z: 10.0, rotY: FACE.W },
  // stuffed animals (InstancedMesh). Seats are fixed; the attic hoard is
  // scattered over its mound with a fixed seed so it looks the same every run.
  teddySeats: [
    { floorId: 'ground', x: 4, y: 0.33, z: 12.0, rotY: FACE.S, watcher: true },
    { floorId: 'ground', x: 5.0, y: 0.33, z: 13, rotY: FACE.W },
    { floorId: 'ground', x: 4, y: 0.33, z: 14.0, rotY: FACE.N, watcher: true },
    { floorId: 'ground', x: 3.0, y: 0.33, z: 13, rotY: FACE.E },
    { floorId: 'ground', x: 11.1, y: 0.48, z: 10.55, rotY: FACE.E, watcher: true, scale: 1.2 },
    { floorId: 'ground', x: 7.2, y: 0.5, z: 16.95, rotY: FACE.N, scale: 1.3 },
    { floorId: 'upstairs', x: 0.65, y: 1.55, z: 14.0, rotY: FACE.E, scale: 0.9 },
    { floorId: 'upstairs', x: 9.3, y: 0.5, z: 10.6, rotY: FACE.E, watcher: true },
    { floorId: 'upstairs', x: 13.3, y: 0.62, z: 0.38, rotY: FACE.S, scale: 0.8 },
  ],
  hoard: { floorId: 'attic', cx: 11.5, cz: 11.5, w: 5, d: 2.5, top: 0.55, count: 34, watchers: 7, seed: 'teddy-hoard' },
};
