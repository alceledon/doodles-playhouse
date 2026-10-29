// The real playhouse against the contract, the reachability rules, and the
// layout promises in docs/DESIGN.md. Pure data only: no THREE here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateWorld, SPAWNED_ITEMS, HIDE_KINDS, FLOOR_Y, PLAYER_BODY, DIFFICULTIES } from '../../src/core/contracts.js';
import {
  checkReachability, reachableSet, nearestPassable, neighbors, flagsAt, parseKey, refKey, worldToCell, isPassable, cellCenter, NAV, AGENTS,
} from '../../src/core/navgrid.js';
import { createBus, EVENTS } from '../../src/core/events.js';
import { circleHitsBox2D } from '../../src/core/math.js';
import { buildWorldData, cutWall, subtractRects } from '../../src/world/build.js';
import { aabb } from '../../src/world/props.js';
import { tuningFor } from '../../src/world/tuning.js';

const make = (opts) => buildWorldData(opts);
const P = AGENTS.PLAYER;
const D = AGENTS.DOODLE;
const snap = (w, spot, agent) => nearestPassable(w.nav, spot.floorId, spot.pos.x, spot.pos.z, agent, 1.5);
/** Does a standing player at (x, z) on this floor overlap any of these boxes? */
const bodyHits = (boxes, x, z, y, r = PLAYER_BODY.radius, h = PLAYER_BODY.height) =>
  boxes.some((b) => b.minY < y + h && b.maxY > y + 0.05 && circleHitsBox2D(x, z, r, b));

for (const difficulty of DIFFICULTIES) {
  test(`${difficulty}: the real World matches the contract`, () => {
    assert.deepEqual(validateWorld(make({ difficulty })), []);
  });
  test(`${difficulty}: the real World passes the reachability rules`, () => {
    assert.deepEqual(checkReachability(make({ difficulty })), []);
  });
}

test('pure world modules never import three', () => {
  const dir = new URL('../../src/world/', import.meta.url);
  const pure = ['build.js', 'props.js', 'tuning.js', ...readdirSync(new URL('layout/', dir)).map((f) => `layout/${f}`)];
  for (const f of pure) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /from ['"]three/, f);
});

test('four floors at the recommended heights, with every room from the design', () => {
  const w = make();
  assert.deepEqual(w.floors.map((f) => [f.id, f.y]), Object.entries(FLOOR_Y));
  const ids = new Set(w.rooms.map((r) => r.id));
  for (const id of ['attic', 'kidsBedroom', 'nursery', 'craftRoom', 'bathroom', 'slideRoom', 'frontHall', 'livingRoom', 'playKitchen', 'teaParty', 'musicRoom', 'garage', 'kennelRoom', 'laundry', 'boilerRoom', 'storage'])
    assert.ok(ids.has(id), id);
});

test('stairs: ramps climb linearly and switch floor halfway', () => {
  const w = make();
  // main stairs: x 8..9.5, ground y=0 at z=1.5 up to upstairs y=3 at z=5.5
  assert.deepEqual(w.heightAt(8.75, 1.5, 'ground'), { y: 0, floorId: 'ground' });
  assert.deepEqual(w.heightAt(8.75, 3.0, 'ground'), { y: 1.125, floorId: 'ground' });
  assert.deepEqual(w.heightAt(8.75, 3.5, 'ground'), { y: 1.5, floorId: 'upstairs' });
  assert.deepEqual(w.heightAt(8.75, 5.5, 'upstairs'), { y: 3, floorId: 'upstairs' });
  // basement stairs go DOWN from the hall: ground at z=1.5, basement at z=5.5
  assert.deepEqual(w.heightAt(15.25, 1.5, 'ground'), { y: 0, floorId: 'ground' });
  assert.deepEqual(w.heightAt(15.25, 5.5, 'basement'), { y: -3, floorId: 'basement' });
  assert.equal(w.heightAt(15.25, 4.0, 'ground').floorId, 'basement');
  // attic stairs share that footprint one storey up; the hint keeps them apart
  assert.deepEqual(w.heightAt(15.25, 5.5, 'upstairs'), { y: 6, floorId: 'attic' });
  assert.deepEqual(w.heightAt(15.25, 2.5, 'attic'), { y: 3.75, floorId: 'upstairs' });
  // off the ramps you stay on your floor
  assert.deepEqual(w.heightAt(12, 12, 'upstairs'), { y: 3, floorId: 'upstairs' });
  assert.deepEqual(w.heightAt(12, 3, 'basement'), { y: -3, floorId: 'basement' });
  assert.deepEqual(w.heightAt(12, -3.5, 'ground'), { y: 0, floorId: 'ground' }); // outside the front door
});

test('stairs links start and end level with their floors and agree with heightAt', () => {
  const w = make();
  const stairs = w.nav.links.filter((l) => l.kind === 'stairs');
  assert.equal(stairs.length, 3);
  for (const l of stairs) {
    const a = l.points[0];
    const b = l.points.at(-1);
    assert.equal(a.y, FLOOR_Y[l.from.floorId], l.id);
    assert.equal(b.y, FLOOR_Y[l.to.floorId], l.id);
    for (const p of l.points) {
      const h = w.heightAt(p.x, p.z, p.y >= (FLOOR_Y[l.from.floorId] + FLOOR_Y[l.to.floorId]) / 2 ? l.to.floorId : l.from.floorId);
      assert.ok(Math.abs(h.y - p.y) < 1e-9, `${l.id} point ${JSON.stringify(p)} vs heightAt ${h.y}`);
    }
    assert.equal(l.playerOnly, false);
    assert.equal(l.oneWay, false);
  }
});

test('doors: closed doors collide, open ones do not, and the doorway itself is clear', () => {
  const w = make();
  for (const d of w.doors) {
    const y = FLOOR_Y[d.floorId];
    const statics = w.staticBoxes[d.floorId];
    assert.ok(!bodyHits(statics, d.pos.x, d.pos.z, y), `door "${d.id}": a wall or prop blocks its doorway`);
    assert.ok(w.colliders(d.floorId).includes(d.collider), `door "${d.id}" collider missing while closed`);
    assert.ok(bodyHits([d.collider], d.pos.x, d.pos.z, y), `door "${d.id}" collider does not fill the doorway`);
    assert.ok(d.collider.maxY - d.collider.minY >= 2.1, `door "${d.id}" is too low for the Doodle`);
    assert.ok(Math.max(d.collider.maxX - d.collider.minX, d.collider.maxZ - d.collider.minZ) >= 1.4, `door "${d.id}" is narrower than 1.4 m`);
    for (const ref of d.cells) assert.ok(flagsAt(w.nav, ref) & NAV.DOOR, `door "${d.id}" cell not flagged DOOR`);
    if (d.locked) continue;
    assert.equal(d.setOpen(true), true);
    assert.ok(!w.colliders(d.floorId).includes(d.collider), `door "${d.id}" still collides when open`);
    d.setOpen(false);
    assert.ok(w.colliders(d.floorId).includes(d.collider));
  }
});

test('doors: the front door and garage door start locked; setOpen emits like the fixture', () => {
  const bus = createBus();
  const seen = [];
  for (const t of [EVENTS.DOOR_OPENED, EVENTS.DOOR_CLOSED, EVENTS.NOISE]) bus.on(t, (p) => seen.push([t, p]));
  const w = make({ bus });
  const byId = Object.fromEntries(w.doors.map((d) => [d.id, d]));
  assert.equal(byId.frontDoor.locked, true);
  assert.equal(byId.garageDoor.locked, true);
  assert.equal(w.doors.filter((d) => d.locked).length, 2);
  assert.equal(byId.frontDoor.setOpen(true), false);
  assert.equal(seen.length, 0);
  byId.frontDoor.setLocked(false);
  assert.equal(byId.frontDoor.setOpen(true, 'player'), true);
  assert.deepEqual(seen[0], [EVENTS.DOOR_OPENED, { doorId: 'frontDoor', by: 'player' }]);
  assert.equal(seen[1][0], EVENTS.NOISE);
  assert.equal(seen[1][1].kind, 'door');
  assert.equal(seen[1][1].floorId, 'ground');
  byId.hallMusic.setOpen(true, 'doodle');
  assert.deepEqual(seen[2], [EVENTS.DOOR_OPENED, { doorId: 'hallMusic', by: 'doodle' }]);
  assert.equal(byId.hallMusic.setOpen(true), true); // already open: no new events
  assert.equal(seen.length, 4);
});

test('containers: open/close emits, the attic chest starts locked, items rest inside', () => {
  const bus = createBus();
  const seen = [];
  for (const t of [EVENTS.CONTAINER_OPENED, EVENTS.CONTAINER_CLOSED, EVENTS.NOISE]) bus.on(t, (p) => seen.push([t, p]));
  const w = make({ bus });
  const chest = w.containers.find((c) => c.id === w.anchors.atticChest.containerId);
  assert.equal(chest.kind, 'chest');
  assert.equal(chest.floorId, 'attic');
  assert.equal(chest.locked, true);
  assert.equal(chest.setOpen(true), false);
  assert.deepEqual(w.containers.filter((c) => c.locked).map((c) => c.id), [chest.id]);
  const kinds = new Set(w.containers.map((c) => c.kind));
  for (const k of ['drawer', 'chest', 'cabinet', 'wardrobe']) assert.ok(kinds.has(k), k);
  const drawer = w.containers.find((c) => c.kind === 'drawer');
  assert.equal(drawer.setOpen(true), true);
  assert.deepEqual(seen[0], [EVENTS.CONTAINER_OPENED, { containerId: drawer.id, by: 'player' }]);
  assert.equal(seen[1][1].kind, 'container');
  drawer.setOpen(false);
  assert.deepEqual(seen[2], [EVENTS.CONTAINER_CLOSED, { containerId: drawer.id, by: 'player' }]);
  for (const c of w.containers) {
    const s = c.itemSpot;
    assert.equal(s.containerId, c.id);
    // the item sits inside the container's own collision box, near where you use it
    const inside = w.staticBoxes[c.floorId].some((b) => s.pos.x > b.minX && s.pos.x < b.maxX && s.pos.z > b.minZ && s.pos.z < b.maxZ && s.pos.y >= b.minY && s.pos.y < b.maxY);
    assert.ok(inside, `container "${c.id}" item spot is not inside it`);
    assert.ok(Math.hypot(s.pos.x - c.pos.x, s.pos.z - c.pos.z) < 0.8, `container "${c.id}" item spot is far from its front`);
  }
});

test('spawns: at least 3 candidates per item, on at least 2 floors, several inside containers', () => {
  const w = make();
  const ids = new Set();
  let inContainers = 0;
  for (const item of SPAWNED_ITEMS) {
    const list = w.anchors.spawns[item];
    assert.ok(list.length >= 3, `${item} has ${list.length} candidates`);
    assert.ok(new Set(list.map((s) => s.floorId)).size >= 2, `${item} candidates are all on one floor`);
    assert.ok(list.some((s) => !s.containerId), `${item} has no loose candidate`);
    for (const s of list) {
      assert.ok(!ids.has(s.id), `duplicate spawn id ${s.id}`);
      ids.add(s.id);
      if (s.containerId) inContainers++;
    }
  }
  assert.ok(inContainers >= 12, `only ${inContainers} spawns are inside containers`);
  // the launcher's chest is never a candidate for anything else
  for (const item of SPAWNED_ITEMS) assert.ok(!w.anchors.spawns[item].some((s) => s.containerId === 'atticChest'), item);
  // loose floor spawns lie on open floor
  for (const item of SPAWNED_ITEMS)
    for (const s of w.anchors.spawns[item]) {
      if (s.containerId || s.pos.y > FLOOR_Y[s.floorId] + 1e-9) continue;
      assert.ok(!bodyHits(w.staticBoxes[s.floorId], s.pos.x, s.pos.z, FLOOR_Y[s.floorId], 0.12, 0.3), `spawn ${s.id} is inside furniture`);
    }
});

/** Does the segment a→b pass through box b? (slab test; touching a face doesn't count) */
function segmentHitsBox(a, b, box) {
  let t0 = 0;
  let t1 = 1;
  for (const [o, d, lo, hi] of [[a.x, b.x - a.x, box.minX, box.maxX], [a.y, b.y - a.y, box.minY, box.maxY], [a.z, b.z - a.z, box.minZ, box.maxZ]]) {
    if (Math.abs(d) < 1e-12) {
      if (o <= lo || o >= hi) return false;
      continue;
    }
    const u0 = Math.min((lo - o) / d, (hi - o) / d);
    const u1 = Math.max((lo - o) / d, (hi - o) / d);
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 >= t1) return false;
  }
  return true;
}

test('spawns: every item spot is clear of furniture and can be seen from where the player stands', () => {
  // Line of sight from standing and crouched eyes on walkable cells within 3.5 m, against every
  // visual part (as its bounding box) and wall. Containers count as open: their moving parts are
  // ignored. A Jeep Key once spawned among the books on a shelf, and another at the bottom of a
  // deep trunk, where nobody found them.
  const w = make();
  const MIN_VIEWS = 10;
  const inside = (p, b) => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && p.z > b.minZ && p.z < b.maxZ;
  for (const f of w.floors) {
    const occluders = [
      ...w.geo.parts[f.id].filter((pt) => pt.m !== 'slats').map((pt) => aabb([pt])),
      ...w.geo.wallBoxes.filter((wb) => wb.floorId === f.id).map((wb) => wb.box),
    ];
    const grid = w.nav.floors[f.id];
    const eyes = [];
    for (let j = 0; j < grid.h; j++)
      for (let i = 0; i < grid.w; i++) {
        const ref = { floorId: f.id, i, j };
        if (!isPassable(w.nav, ref, P)) continue;
        const c = cellCenter(w.nav, ref);
        for (const h of [PLAYER_BODY.eyeHeight, PLAYER_BODY.crouchEyeHeight]) eyes.push({ x: c.x, y: f.y + h, z: c.z });
      }
    for (const item of SPAWNED_ITEMS)
      for (const s of w.anchors.spawns[item]) {
        if (s.floorId !== f.id) continue;
        const target = { x: s.pos.x, y: s.pos.y + 0.04, z: s.pos.z }; // just above where it rests
        const buried = occluders.filter((b) => inside(target, b));
        assert.deepEqual(buried, [], `${item} spot ${s.id} is inside furniture`);
        const near = eyes.filter((e) => Math.hypot(e.x - target.x, e.z - target.z) <= 3.5);
        const views = near.filter((e) => !occluders.some((b) => segmentHitsBox(e, target, b))).length;
        assert.ok(views >= MIN_VIEWS, `${item} spot ${s.id} is visible from only ${views} of ${near.length} nearby views`);
      }
  }
});

test('hide spots: at least 8, covering all six kinds, with a free exit', () => {
  const w = make();
  const hs = w.anchors.hideSpots;
  assert.ok(hs.length >= 8, `${hs.length} hide spots`);
  assert.deepEqual(new Set(hs.map((h) => h.kind)), new Set(HIDE_KINDS));
  for (const h of hs) {
    const y = FLOOR_Y[h.floorId];
    assert.ok(Number.isFinite(h.yaw));
    assert.equal(h.exitPos.y, y, `${h.id} exit is not on the floor`);
    assert.ok(!bodyHits(w.staticBoxes[h.floorId], h.exitPos.x, h.exitPos.z, y), `${h.id} exit is blocked`);
    const ref = worldToCell(w.nav, h.floorId, h.exitPos.x, h.exitPos.z);
    assert.ok(isPassable(w.nav, ref, P), `${h.id} exit cell is not passable`);
    assert.ok(h.eyePos.y > y && h.eyePos.y < y + 1.3, `${h.id} eye height ${h.eyePos.y - y}`);
    assert.ok(Math.hypot(h.eyePos.x - h.exitPos.x, h.eyePos.z - h.exitPos.z) < 2.5, `${h.id} eye is far from its exit`);
  }
  assert.ok(new Set(hs.map((h) => h.floorId)).size === 4, 'every floor has somewhere to hide');
});

test('traps: fixed creaky planks and the piano, plus about a dozen squeaky/block spots on open floor', () => {
  const w = make();
  const t = w.anchors.traps;
  const piano = t.filter((x) => x.kind === 'piano');
  assert.equal(piano.length, 1);
  assert.ok(t.filter((x) => x.kind === 'creaky').length >= 3);
  assert.ok(t.filter((x) => x.kind === 'squeaky').length >= 12);
  assert.ok(t.filter((x) => x.kind === 'blocks').length >= 6);
  for (const x of t) {
    if (x.kind === 'piano') continue;
    assert.ok(!bodyHits(w.staticBoxes[x.floorId], x.pos.x, x.pos.z, x.pos.y, 0.2, 0.5), `trap ${x.id} is not on open floor`);
    assert.ok(isPassable(w.nav, worldToCell(w.nav, x.floorId, x.pos.x, x.pos.z), D), `trap ${x.id} is not on a walkable cell`);
  }
  // the piano trap is tied to a tagged piano proxy
  assert.ok(w.geo.proxies.some((p) => p.tag.kind === 'piano' && p.tag.id === piano[0].id));
});

test('creaky planks scale with difficulty', () => {
  const creaks = (difficulty) => make({ difficulty }).anchors.traps.filter((t) => t.kind === 'creaky').length;
  assert.ok(creaks('practice') <= creaks('normal'));
  assert.ok(creaks('normal') < creaks('hard'));
});

test('drawings: exactly 4, one per floor, hung on walls at kid height', () => {
  const w = make();
  const d = w.anchors.drawings;
  assert.equal(d.length, 4);
  assert.equal(new Set(d.map((s) => s.floorId)).size, 4);
  for (const s of d) {
    const h = s.pos.y - FLOOR_Y[s.floorId];
    assert.ok(h > 0.8 && h < 1.6, `${s.id} hangs at ${h} m`);
    assert.ok(Number.isFinite(s.rotY));
  }
});

test('patrol points on every floor; key anchors in the right rooms', () => {
  const w = make();
  const a = w.anchors;
  for (const f of w.floors) assert.ok(a.patrol.filter((s) => s.floorId === f.id).length >= 2, `${f.id} patrol`);
  assert.equal(w.roomAt(a.startBed.pos, a.startBed.floorId).id, 'kidsBedroom');
  assert.equal(a.kennel.floorId, 'basement');
  assert.equal(a.kennelBed.floorId, 'basement');
  assert.equal(w.roomAt(a.kennel.pos, 'basement').id, 'kennelRoom');
  assert.equal(a.fuseBox.floorId, 'basement');
  assert.equal(a.frontDoor.keypad.floorId, 'ground');
  assert.equal(a.garage.opener.floorId, 'ground');
  assert.equal(w.roomAt(a.garage.jeep.pos, 'ground').id, 'garage');
  assert.ok(!bodyHits(w.staticBoxes.upstairs, a.startBed.pos.x, a.startBed.pos.z, 3), 'startBed is inside furniture');
  // exits are outside the house, beyond their doors
  assert.ok(a.frontDoor.exit.pos.z < 0);
  assert.ok(a.garage.exit.pos.x > 24);
});

test('every room has a lamp, and lights read brighter near lamps than in dark corners', () => {
  const w = make();
  for (const r of w.rooms) assert.ok(w.anchors.lamps.some((l) => l.roomId === r.id), `room "${r.id}" has no lamp`);
  for (const l of w.anchors.lamps) {
    const near = w.lightLevelAt({ x: l.pos.x, y: l.pos.y - 0.5, z: l.pos.z }, l.floorId);
    assert.ok(near > 0.25, `lamp ${l.id} barely lights its spot (${near})`);
  }
  // a lamp in another room only spills a little through the wall
  const hallLamp = w.anchors.lamps.find((l) => l.id === 'lampHall');
  const inHall = w.lightLevelAt({ x: 12, y: 1.1, z: 6.5 }, 'ground');
  const throughWall = w.lightLevelAt({ x: 12, y: 1.1, z: 8.6 }, 'ground'); // living room, about the same distance
  assert.ok(Math.hypot(hallLamp.pos.x - 12, hallLamp.pos.z - 8.6) < hallLamp.range);
  assert.ok(inHall > throughWall);
  // every walkable cell reads a light level in [0, 1]
  for (const g of Object.values(w.nav.floors))
    for (let j = 0; j < g.h; j += 3)
      for (let i = 0; i < g.w; i += 3) {
        const l = w.lightLevelAt({ x: g.originX + i * 0.5, y: g.y + 1.1, z: g.originZ + j * 0.5 }, g.floorId);
        assert.ok(l >= 0 && l <= 1);
      }
});

test('the Doodle never reaches player-only cells, slides or tunnels', () => {
  const w = make();
  const kennel = snap(w, w.anchors.kennel, D);
  const seen = reachableSet(w.nav, kennel, D);
  assert.ok(seen.size > 1000);
  for (const key of seen) assert.ok(!(flagsAt(w.nav, parseKey(key)) & NAV.PLAYER_ONLY), key);
  const special = w.nav.links.filter((l) => l.kind !== 'stairs');
  assert.deepEqual(special.map((l) => l.kind).sort(), ['slide', 'tunnel', 'tunnel']);
  for (const l of special) {
    assert.equal(l.playerOnly, true, l.id);
    assert.equal(l.oneWay, l.kind === 'slide', l.id);
    assert.equal(l.crawl, l.kind === 'tunnel', l.id);
  }
  // neighbors() never offers the Doodle a player-only link, even standing on its mouth
  for (const l of special) {
    for (const end of [l.from, l.to])
      if (isPassable(w.nav, end, D)) assert.ok(!neighbors(w.nav, end, D).some((n) => n.link?.playerOnly), l.id);
  }
  // ...but the player uses them: the crawl tunnel joins the basement laundry to the play kitchen
  const tunnel = w.nav.links.find((l) => l.id === 'laundryTunnel');
  assert.equal(tunnel.from.floorId, 'basement');
  assert.equal(tunnel.to.floorId, 'ground');
  assert.ok(neighbors(w.nav, tunnel.from, P).some((n) => n.link === tunnel));
  // and the Big Slide drops from upstairs into the living room
  const slide = w.nav.links.find((l) => l.kind === 'slide');
  assert.equal(slide.from.floorId, 'upstairs');
  assert.equal(w.roomAt(slide.points.at(-1), 'ground').id, 'livingRoom');
});

test('the Doodle can hunt every room, and every crawl ceiling is marked player-only', () => {
  const w = make();
  const seen = reachableSet(w.nav, snap(w, w.anchors.kennel, D), D);
  for (const r of w.rooms) {
    const hit = [...seen].some((k) => {
      const ref = parseKey(k);
      if (ref.floorId !== r.floorId) return false;
      const g = w.nav.floors[ref.floorId];
      const x = g.originX + (ref.i + 0.5) * 0.5;
      const z = g.originZ + (ref.j + 0.5) * 0.5;
      return x > r.bounds.minX && x < r.bounds.maxX && z > r.bounds.minZ && z < r.bounds.maxZ;
    });
    assert.ok(hit, `the Doodle cannot reach room "${r.id}"`);
  }
  // a box whose underside is between knee and Doodle height is a crawl space
  for (const g of Object.values(w.nav.floors)) {
    const ceilings = w.staticBoxes[g.floorId].filter((b) => b.minY > g.y + 0.6 && b.minY < g.y + 1.3);
    for (let j = 0; j < g.h; j++)
      for (let i = 0; i < g.w; i++) {
        const f = g.cells[j * g.w + i];
        if (!(f & NAV.WALK) || f & NAV.PLAYER_ONLY) continue;
        const x = g.originX + (i + 0.5) * 0.5;
        const z = g.originZ + (j + 0.5) * 0.5;
        const under = ceilings.find((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
        assert.ok(!under, `${g.floorId} cell (${x}, ${z}) is under a low ceiling but open to the Doodle`);
      }
  }
});

test('nav: no orphaned walkable cells (every one is reachable by the player)', () => {
  const w = make();
  const seen = reachableSet(w.nav, snap(w, w.anchors.startBed, P), P);
  for (const g of Object.values(w.nav.floors))
    for (let j = 0; j < g.h; j++)
      for (let i = 0; i < g.w; i++) {
        if (!(g.cells[j * g.w + i] & (NAV.WALK | NAV.DOOR))) continue;
        assert.ok(seen.has(refKey({ floorId: g.floorId, i, j })), `${g.floorId} cell ${i},${j} is walkable but unreachable`);
      }
});

test('furniture stays out of the walls and the stair footprints', () => {
  const w = make();
  for (const f of w.floors) {
    const walls = w.geo.wallBoxes.filter((b) => b.floorId === f.id).map((b) => b.box);
    const others = w.staticBoxes[f.id].filter((b) => !walls.includes(b));
    for (const b of others)
      for (const wb of walls) {
        const ox = Math.min(b.maxX, wb.maxX) - Math.max(b.minX, wb.minX);
        const oz = Math.min(b.maxZ, wb.maxZ) - Math.max(b.minZ, wb.minZ);
        const oy = Math.min(b.maxY, wb.maxY) - Math.max(b.minY, wb.minY);
        if (ox > 0.02 && oz > 0.02 && oy > 0.02) {
          // crawl-space boxes deliberately pass through their wall holes
          const crawl = b.maxY - b.minY < 1 && (b.minY > f.y + 0.5 || wb.minY > f.y + 0.5);
          assert.ok(crawl, `${f.id}: ${JSON.stringify(b)} overlaps wall ${JSON.stringify(wb)}`);
        }
      }
  }
  for (const r of w.geo.ramps)
    for (const fid of [r.lowFloor, r.highFloor])
      for (const b of w.staticBoxes[fid]) {
        const ox = Math.min(b.maxX, r.inner.maxX) - Math.max(b.minX, r.inner.minX);
        const oz = Math.min(b.maxZ, r.inner.maxZ) - Math.max(b.minZ, r.inner.minZ);
        assert.ok(ox <= 0.02 || oz <= 0.02, `${fid}: ${JSON.stringify(b)} intrudes on ${r.id}`);
      }
});

test('colliders(): valid boxes, cached until a door changes', () => {
  const w = make();
  const a = w.colliders('ground');
  assert.equal(w.colliders('ground'), a);
  w.doors.find((d) => d.id === 'hallMusic').setOpen(true);
  const b = w.colliders('ground');
  assert.notEqual(b, a);
  assert.equal(b.length, a.length - 1);
  assert.deepEqual(w.colliders('roof'), []);
});

test('interactables: every World interact kind has a proxy or a moving part to raycast', () => {
  const w = make();
  const kinds = new Set(w.geo.proxies.map((p) => p.tag.kind));
  for (const k of ['hide', 'linkEntry', 'fuseBox', 'jeep', 'opener', 'keypad', 'piano']) assert.ok(kinds.has(k), k);
  for (const h of w.anchors.hideSpots) assert.ok(w.geo.proxies.some((p) => p.tag.kind === 'hide' && p.tag.id === h.id), h.id);
  for (const c of w.containers) assert.ok(w.geo.moving.some((m) => m.containerId === c.id), c.id);
  // proxies never swallow an item resting inside a container (Gameplay raycasts items too)
  for (const c of w.containers)
    for (const p of w.geo.proxies) {
      const s = c.itemSpot.pos;
      const b = p.box;
      assert.ok(!(s.x > b.minX && s.x < b.maxX && s.y > b.minY && s.y < b.maxY && s.z > b.minZ && s.z < b.maxZ), `${p.tag.id} proxy covers ${c.id}'s item`);
    }
  // slide entry + both ends of each tunnel
  const entries = w.geo.proxies.filter((p) => p.tag.kind === 'linkEntry').map((p) => p.tag.id);
  assert.deepEqual(entries.sort(), ['bedroomTube', 'bedroomTube', 'bigSlide', 'laundryTunnel', 'laundryTunnel']);
});

test('the same layout every time (decor uses fixed seeds)', () => {
  const a = make();
  const b = make();
  assert.deepEqual(JSON.parse(JSON.stringify(a.anchors)), JSON.parse(JSON.stringify(b.anchors)));
  assert.deepEqual(a.geo.teddies, b.geo.teddies);
  assert.ok(a.geo.teddies.filter((t) => t.watcher).length >= 6);
});

test('tuningFor covers every difficulty and falls back to normal', () => {
  for (const d of DIFFICULTIES) assert.ok(tuningFor(d).fogFar > tuningFor(d).fogNear, d);
  assert.deepEqual(tuningFor('nightmare'), tuningFor('normal'));
  assert.ok(tuningFor('hard').fogFar < tuningFor('practice').fogFar);
});

test('cutWall and subtractRects', () => {
  const pieces = cutWall({ axis: 'x', at: 0, from: 0, to: 10 }, [{ axis: 'x', at: 0, from: 2, to: 4, bottom: 0, top: 2.4 }, { axis: 'x', at: 0, from: 6, to: 7, bottom: 1, top: 2 }], 3);
  assert.deepEqual(pieces.map((p) => [p.kind, p.from, p.to, p.y0, p.y1]), [
    ['wall', 0, 2, 0, 3], ['lintel', 2, 4, 2.4, 3], ['wall', 4, 6, 0, 3], ['lintel', 6, 7, 2, 3], ['sill', 6, 7, 0, 1], ['wall', 7, 10, 0, 3],
  ]);
  const rects = subtractRects({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 }, [{ minX: 1, maxX: 2, minZ: 1, maxZ: 2 }]);
  const area = rects.reduce((s, r) => s + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
  assert.equal(area, 15);
});
