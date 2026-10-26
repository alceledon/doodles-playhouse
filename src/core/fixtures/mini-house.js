// MINI-HOUSE FIXTURE — a tiny World in the real contract shape, with no
// Three.js. Doodle and Gameplay build and test against it so they never wait
// for the real map. src/core/stubs/world.js renders it as gray boxes.
//
// Layout (meters, Y up). Ground floor y=0, upstairs y=3.
//
//   GROUND  z=8 ┌──────────── north wall ─────────────┐
//               │ ░░stairs (x1-5, z7-8)░░ │ counter  │
//               │ rail ─────────────      │ kennel   │  jeep ┃ garage door (locked,
//               │       ┌tunnel┐ (crawl)  │          │       ┃  x=12, z5-7)
//               │       └──────┘          ═ door      │
//               │   creaky        hall    │ kitchen  │
//               │ fuse                    ╪ crawl    │ ball pit
//          z=0  └────── front door (locked, x2.5-3.5) ┴──────────┘
//              x=0                       x=6                 x=12
//
//   UPSTAIRS (one bedroom, x0-7, z0-8): stair top at x5-7 z7-8, dresser,
//   bunk bed, toy piano, locked attic chest, slide top near (6.25, 1.25).
//
// Links: stairs (hall ↔ bedroom), tunnel (hall ↔ kitchen, player-only,
// crawl), slide (bedroom → ball pit, player-only, one-way).

import { EVENTS } from '../events.js';
import { NAV, rasterizeFloor, cellsInBox, worldToCell } from '../navgrid.js';

const T = 0.2; // wall thickness
const box = (minX, maxX, minY, maxY, minZ, maxZ) => ({ minX, maxX, minY, maxY, minZ, maxZ });
/** wall along X at constant z */
const wallX = (z, x1, x2, y0, y1 = y0 + 3) => box(x1, x2, y0, y1, z - T / 2, z + T / 2);
/** wall along Z at constant x */
const wallZ = (x, z1, z2, y0, y1 = y0 + 3) => box(x - T / 2, x + T / 2, y0, y1, z1, z2);
const p = (x, y, z) => ({ x, y, z });
const G = 'ground';
const U = 'upstairs';

/**
 * @param {{bus?: import('../events.js').Bus, onDoorChange?: (door) => void, onContainerChange?: (c) => void}} [opts]
 * @returns {import('../contracts.js').World & {fixture: true, staticBoxes: Object<string, Box[]>}}
 */
export function createMiniHouse({ bus = null, onDoorChange = null, onContainerChange = null } = {}) {
  const emit = (type, payload) => bus?.emit(type, payload);

  // ---- static geometry -----------------------------------------------------
  const staticBoxes = {
    [G]: [
      wallX(0, 0, 2.5, 0), wallX(0, 3.5, 12, 0), box(2.5, 3.5, 2.1, 3, -0.1, 0.1), // south wall + front door gap
      wallX(8, 0, 12, 0), // north
      wallZ(0, 0, 8, 0), // west
      wallZ(12, 0, 5, 0), wallZ(12, 7, 8, 0), box(11.9, 12.1, 2.4, 3, 5, 7), // east + garage door gap
      wallZ(6, 0, 3.5, 0), wallZ(6, 4.5, 8, 0), box(5.9, 6.1, 2.1, 3, 3.5, 4.5), // hall | kitchen + door gap
      box(1.3, 5, 0, 3, 6.9, 7.0), // wall under the stairs' open side
      box(3, 4.5, 0, 1.2, 3.9, 4.0), box(3, 4.5, 0, 1.2, 5.0, 5.1), box(3, 4.5, 0.8, 1.2, 3.9, 5.1), // play tunnel (crawl)
      box(7, 10, 0, 0.9, 7.3, 7.9), // kitchen counter
      box(9, 11, 0, 0.6, 1, 3), // ball pit rim
      box(9.5, 10.9, 0, 0.8, 5.4, 6.6), // ride-on jeep (leaves an aisle to the garage door)
    ],
    [U]: [
      wallX(0, 0, 7, 3), wallX(8, 0, 7, 3), wallZ(0, 0, 8, 3), wallZ(7, 0, 8, 3),
      box(1, 5, 3, 4, 6.9, 7.0), box(0.9, 1.0, 3, 4, 7.0, 7.9), // stairwell railings
      box(0.1, 0.8, 3, 4, 3, 4.5), // dresser
      box(4, 6.6, 3, 4.6, 2, 3.2), // bunk bed
      box(3, 4, 3, 3.6, 0.3, 0.9), // attic chest (stand-in)
      box(1.5, 2.5, 3, 3.7, 0.2, 0.8), // toy piano
    ],
  };

  const floors = [
    { id: G, y: 0 },
    { id: U, y: 3 },
  ];

  const rooms = [
    { id: 'hall', name: 'Hall', floorId: G, bounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 8 } },
    { id: 'kitchen', name: 'Kitchen', floorId: G, bounds: { minX: 6, maxX: 12, minZ: 0, maxZ: 8 } },
    { id: 'bedroom', name: 'Bedroom', floorId: U, bounds: { minX: 0, maxX: 7, minZ: 0, maxZ: 8 } },
  ];

  // ---- nav -------------------------------------------------------------------
  const doorSpecs = [
    { id: 'hallKitchen', floorId: G, pos: p(6, 0, 4), locked: false, collider: box(5.95, 6.05, 0, 2.1, 3.5, 4.5), cellBox: box(5.5, 6.5, 0, 0, 3.5, 4.5) },
    { id: 'front', floorId: G, pos: p(3, 0, 0), locked: true, collider: box(2.5, 3.5, 0, 2.1, -0.05, 0.05), cellBox: box(2.5, 3.5, 0, 0, 0, 0.5) },
    { id: 'garage', floorId: G, pos: p(12, 0, 6), locked: true, collider: box(11.95, 12.05, 0, 2.4, 5, 7), cellBox: box(11.5, 12, 0, 0, 5, 7) },
  ];
  const doorFlags = NAV.DOOR | NAV.WALK;
  const crawlFlags = NAV.PLAYER_ONLY | NAV.CRAWL | NAV.WALK;

  const nav = {
    cellSize: 0.5,
    floors: {
      [G]: rasterizeFloor({
        floorId: G, y: 0, minX: 0, maxX: 12, minZ: 0, maxZ: 8,
        blockers: staticBoxes[G],
        holes: [box(1, 5, 0, 3, 7, 8)], // under the stair ramp
        marks: [
          ...doorSpecs.filter((d) => d.floorId === G).map((d) => ({ box: d.cellBox, flags: doorFlags })),
          { box: box(3, 4.5, 0, 0, 4.0, 5.0), flags: crawlFlags }, // inside the play tunnel
        ],
      }),
      [U]: rasterizeFloor({
        floorId: U, y: 3, minX: 0, maxX: 7, minZ: 0, maxZ: 8,
        blockers: staticBoxes[U],
        holes: [box(1, 5, 3, 6, 7, 8)], // stairwell opening
      }),
    },
    links: [],
  };
  const cell = (floorId, x, z) => worldToCell(nav, floorId, x, z);
  nav.links.push(
    {
      id: 'stairs', kind: 'stairs', from: cell(G, 0.75, 7.25), to: cell(U, 5.75, 7.25),
      oneWay: false, playerOnly: false, crawl: false,
      points: [p(0.75, 0, 7.45), p(1.0, 0, 7.45), p(5.0, 3, 7.45), p(5.75, 3, 7.25)],
    },
    {
      id: 'hallKitchenTunnel', kind: 'tunnel', from: cell(G, 5.25, 1.25), to: cell(G, 6.75, 1.25),
      oneWay: false, playerOnly: true, crawl: true,
      points: [p(5.25, 0, 1.25), p(5.7, 0, 1.25), p(6.3, 0, 1.25), p(6.75, 0, 1.25)],
    },
    {
      id: 'bigSlide', kind: 'slide', from: cell(U, 6.25, 1.25), to: cell(G, 8.25, 2.25),
      oneWay: true, playerOnly: true, crawl: false,
      points: [p(6.25, 3, 1.25), p(6.7, 3, 1.25), p(9.2, 0.9, 1.6), p(10, 0.35, 2.0), p(8.25, 0, 2.25)],
    },
  );

  // ---- doors & containers ----------------------------------------------------
  const doors = doorSpecs.map((spec) => {
    const door = {
      id: spec.id,
      floorId: spec.floorId,
      pos: spec.pos,
      isOpen: false,
      locked: spec.locked,
      collider: spec.collider,
      cells: cellsInBox(nav, spec.floorId, spec.cellBox),
      setOpen(open, by = 'player') {
        if (open === door.isOpen) return true;
        if (door.locked && open) return false;
        door.isOpen = open;
        emit(open ? EVENTS.DOOR_OPENED : EVENTS.DOOR_CLOSED, { doorId: door.id, by });
        emit(EVENTS.NOISE, { pos: door.pos, floorId: door.floorId, loudness: 5, kind: 'door' });
        onDoorChange?.(door);
        return true;
      },
      setLocked(locked) {
        door.locked = locked;
        onDoorChange?.(door);
      },
    };
    return door;
  });

  const makeContainer = (id, kind, floorId, pos, itemPos, locked = false) => {
    const c = {
      id, kind, floorId, pos, isOpen: false, locked,
      itemSpot: { id: `${id}.item`, floorId, pos: itemPos, containerId: id },
      setOpen(open) {
        if (open === c.isOpen) return true;
        if (c.locked && open) return false;
        c.isOpen = open;
        emit(open ? EVENTS.CONTAINER_OPENED : EVENTS.CONTAINER_CLOSED, { containerId: c.id });
        emit(EVENTS.NOISE, { pos: c.pos, floorId: c.floorId, loudness: 2.5, kind: 'container' });
        onContainerChange?.(c);
        return true;
      },
      setLocked(l) {
        c.locked = l;
        onContainerChange?.(c);
      },
    };
    return c;
  };
  const kitchenDrawer = makeContainer('kitchenDrawer', 'drawer', G, p(8, 0.6, 7.2), p(8, 0.6, 7.6));
  const bedroomDrawer = makeContainer('bedroomDrawer', 'drawer', U, p(0.9, 3.6, 3.75), p(0.45, 3.6, 3.75));
  const atticChest = makeContainer('atticChest', 'chest', U, p(3.5, 3.5, 1.05), p(3.5, 3.4, 0.6), true);
  const containers = [kitchenDrawer, bedroomDrawer, atticChest];

  // ---- anchors ---------------------------------------------------------------
  const spot = (id, floorId, pos, extra = {}) => ({ id, floorId, pos, ...extra });
  const HALF_PI = Math.PI / 2;

  const anchors = {
    startBed: spot('startBed', U, p(5.3, 3, 3.7), { rotY: Math.PI, roomId: 'bedroom' }),
    kennel: spot('kennel', G, p(6.9, 0, 6.4), { roomId: 'kitchen' }),
    kennelBed: spot('kennelBed', G, p(7.2, 0, 6.6), { roomId: 'kitchen' }),
    patrol: [
      spot('patrolHallA', G, p(3, 0, 2.5)),
      spot('patrolHallB', G, p(2, 0, 6)),
      spot('patrolKitchenA', G, p(8.5, 0, 4.5)),
      spot('patrolKitchenB', G, p(11, 0, 4)),
      spot('patrolBedroomA', U, p(3, 3, 4)),
      spot('patrolBedroomB', U, p(6, 3, 5.5)),
    ],
    spawns: {
      padlockKey: [kitchenDrawer.itemSpot, spot('sPadlockKeyBed', U, p(2, 3, 3))],
      hammer: [spot('sHammerHall', G, p(4.5, 0, 1.5)), spot('sHammerBed', U, p(6.3, 3, 6.3))],
      jeepKey: [bedroomDrawer.itemSpot, spot('sJeepKeyHall', G, p(1.5, 0, 5))],
      carBattery: [spot('sBatteryKitchen', G, p(7.5, 0, 1.2)), spot('sBatteryBed', U, p(2, 3, 6))],
      fuse: [spot('sFuseHall', G, p(5, 0, 6.3)), spot('sFuseBed', U, p(6.4, 3, 4.5))],
      toyChestKey: [spot('sChestKeyKitchen', G, p(11, 0, 4.6)), spot('sChestKeyBed', U, p(1, 3, 6.5))],
      tennisBall: [spot('sBallHall', G, p(4, 0, 3)), spot('sBallBed', U, p(5, 3, 5))],
      treats: [spot('sTreatsKitchen', G, p(7, 0, 3.5)), spot('sTreatsBed', U, p(2.5, 3, 2.2))],
      dart: [spot('sDartKitchen', G, p(9, 0, 4.5)), spot('sDartBed', U, p(4, 3, 6))],
    },
    hideSpots: [
      spot('hideUnderBed', U, p(5.3, 3, 3.45), { kind: 'underbed', eyePos: p(5.3, 3.2, 2.6), yaw: Math.PI, exitPos: p(5.3, 3, 3.6), roomId: 'bedroom' }),
      spot('hideKitchenCabinet', G, p(9.2, 0, 7.0), { kind: 'cabinet', eyePos: p(9.2, 0.45, 7.55), yaw: 0, exitPos: p(9.2, 0, 6.8), roomId: 'kitchen' }),
      spot('hideBallPit', G, p(8.6, 0, 2), { kind: 'ballpit', eyePos: p(10, 0.35, 2), yaw: HALF_PI, exitPos: p(8.5, 0, 2), roomId: 'kitchen' }),
    ],
    traps: [
      spot('trapHallCreak', G, p(2, 0, 3), { kind: 'creaky', radius: 0.4 }),
      spot('trapBedroomPiano', U, p(2, 3, 1.0), { kind: 'piano', radius: 0.6 }),
      spot('trapSqueakHall', G, p(4.8, 0, 6.2), { kind: 'squeaky', radius: 0.3 }),
      spot('trapSqueakKitchen', G, p(8, 0, 5), { kind: 'squeaky', radius: 0.3 }),
      spot('trapSqueakKitchen2', G, p(7.5, 0, 3), { kind: 'squeaky', radius: 0.3 }),
      spot('trapSqueakBed', U, p(3, 3, 5), { kind: 'squeaky', radius: 0.3 }),
      spot('trapBlocksHall', G, p(1.5, 0, 1.2), { kind: 'blocks', radius: 0.4 }),
      spot('trapBlocksBed', U, p(5.5, 3, 5.5), { kind: 'blocks', radius: 0.4 }),
    ],
    drawings: [
      spot('drawingHallWest', G, p(0.12, 1.3, 5.5), { rotY: -HALF_PI }),
      spot('drawingHallSouth', G, p(1.2, 1.3, 0.12), { rotY: Math.PI }),
      spot('drawingKitchen', G, p(7.5, 1.3, 0.12), { rotY: Math.PI }),
      spot('drawingBedroom', U, p(0.12, 4.3, 6), { rotY: -HALF_PI }),
    ],
    lamps: [
      { id: 'lampHall', floorId: G, pos: p(3, 2.6, 4), color: 0xffd38a, intensity: 1, range: 6 },
      { id: 'lampKitchen', floorId: G, pos: p(9, 2.6, 4), color: 0xa0c4ff, intensity: 0.8, range: 6 },
      { id: 'nightlightBedroom', floorId: U, pos: p(0.5, 3.4, 1), color: 0xff9de2, intensity: 0.6, range: 4, flicker: true },
    ],
    frontDoor: {
      doorId: 'front',
      padlock: spot('frontPadlock', G, p(3.0, 1.0, 0.12), { rotY: Math.PI }),
      plank: spot('frontPlank', G, p(3.0, 1.5, 0.12), { rotY: Math.PI }),
      keypad: spot('frontKeypad', G, p(3.8, 1.2, 0.12), { rotY: Math.PI }),
      exit: spot('frontExit', G, p(3, 0, -2)),
    },
    garage: {
      doorId: 'garage',
      jeep: spot('jeep', G, p(10.2, 0, 6), { rotY: -HALF_PI }),
      opener: spot('garageOpener', G, p(11.88, 1.2, 4.2), { rotY: HALF_PI }),
      exit: spot('garageExit', G, p(14, 0, 6)),
    },
    fuseBox: spot('fuseBox', G, p(0.12, 1.2, 2.0), { rotY: -HALF_PI }),
    atticChest: { containerId: 'atticChest' },
  };

  // ---- queries ---------------------------------------------------------------
  const floorY = Object.fromEntries(floors.map((f) => [f.id, f.y]));

  function colliders(floorId) {
    const list = staticBoxes[floorId] ?? [];
    const closed = doors.filter((d) => d.floorId === floorId && !d.isOpen).map((d) => d.collider);
    return closed.length ? list.concat(closed) : list;
  }

  function heightAt(x, z, floorHint = G) {
    if (x >= 1 && x <= 5 && z >= 7 && z <= 8) {
      const y = 0.75 * (x - 1); // ramp: y=0 at x=1 up to y=3 at x=5
      return { y, floorId: y >= 1.5 ? U : G };
    }
    const floorId = floorY[floorHint] !== undefined ? floorHint : G;
    return { y: floorY[floorId], floorId };
  }

  function lightLevelAt(pos, floorId) {
    let level = 0.08; // moonlight through the windows
    for (const l of anchors.lamps) {
      if (l.floorId !== floorId) continue;
      const d = Math.hypot(pos.x - l.pos.x, pos.y - l.pos.y, pos.z - l.pos.z);
      const k = Math.max(0, 1 - d / l.range);
      level += l.intensity * k * k;
    }
    return Math.min(1, level);
  }

  function roomAt(pos, floorId) {
    return rooms.find((r) => r.floorId === floorId && pos.x >= r.bounds.minX && pos.x <= r.bounds.maxX && pos.z >= r.bounds.minZ && pos.z <= r.bounds.maxZ) ?? null;
  }

  return {
    fixture: true,
    staticBoxes,
    floors,
    rooms,
    colliders,
    heightAt,
    lightLevelAt,
    roomAt,
    nav,
    doors,
    containers,
    anchors,
    interactables: [],
    update() {},
    dispose() {},
  };
}
