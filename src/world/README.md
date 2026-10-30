# World: the playhouse

`createWorld({ scene, bus, rng, difficulty })` in [index.js](index.js) returns the contract
World (see `src/core/contracts.js`) for the real four-storey playhouse. It replaces
`src/core/stubs/world.js`.

## How it works

Data first, meshes second:

| File | Pure? | What it does |
|---|---|---|
| [layout/](layout/) | yes | The house as data: one spec per floor plus stairs, links and anchors ([layout/index.js](layout/index.js)). |
| [props.js](props.js) | yes | Furniture and toys as `parts` (boxes, cylinders, spheres) plus `colliders`, in local space. |
| [build.js](build.js) | yes | `buildWorldData()`: layout → World data (colliders, nav, `heightAt`, `lightLevelAt`, doors, containers, anchors) plus `world.geo`, a description of what to draw. |
| [tuning.js](tuning.js) | yes | `tuningFor(difficulty)`. |
| [textures.js](textures.js) | no | Procedural 32–64 px canvas textures with `NearestFilter`. One-off pictures (drawings, signs, windows, stars) share one atlas. |
| [geom.js](geom.js) | no | Per-material triangle buckets, box writing with metre-scaled UVs, part transforms. |
| [meshes.js](meshes.js) | no | Static geometry merged by material per floor: walls, floors, ceilings, roof, stairs, every prop part, rugs, decals, windows, moonlight, ball pits (`InstancedMesh`). |
| [dynamic.js](dynamic.js) | no | Door leaves, the garage roll-up and container lids/drawers/doors. They are tagged for raycasts and eased toward the state build.js holds. |
| [lights.js](lights.js) | no | Hemisphere fill, fog, unlit bulb meshes, and a pool of 6 PointLights reassigned to the nearest lamps every 0.5 s. |
| [animated.js](animated.js) | no | The toy train, TV static, the nursery mobile, and the stuffed animals (`InstancedMesh`), whose watcher heads turn toward you. |
| [debug.js](debug.js) | no | Nav-grid and anchor overlays. |

Because `node --test` runs build.js directly, the tests check exactly the colliders, nav and
anchors the game plays with. Meshes are generated from the same prop data, so what you see
matches what blocks you.

## The map

Four floors at the recommended heights. Walls sit on 0.5 m grid lines and doorways are 1.5 m
wide (exactly three nav cells), so the Doodle passes through the middle cell with room to
spare. Ceilings are 3 m.

- **Attic (y=6):** one long room under a pitched roof.
  - Teddy hoard (34 instanced bears, 7 of them watchers), glow-in-the-dark stars, a round moon
    window.
  - The **locked attic chest** (the launcher's container) and an old trunk to hide in.
  - A dead end: the only way out is the stairs.
- **Upstairs (y=3):**
  - Kids' Bedroom: the start room, with two bunk beds, a wardrobe, a toy chest and a play tube
    through the wall.
  - Nursery: crib and spinning mobile.
  - Upstairs Landing: the main stairwell, plus the attic stairs behind a door.
  - Craft Room, Bathroom and Toy Closet.
  - Big Slide Playroom: the slide top, plus a play tent.
- **Ground (y=0):**
  - Front Hall: double front door, keypad, stairs up, and the basement door.
  - Music Room: toy piano.
  - Tea Party Room: table of teddies, with the toy train circling them.
  - Living Room: ball pit (the slide lands in it), old TV, couch.
  - Play Kitchen: cabinet hide, and the cubby where the crawl tunnel surfaces.
  - Garage: ride-on Jeep, opener button, roll-up door.
- **Basement (y=-3):**
  - Storage Room: fuse box on the west wall.
  - Boiler Room.
  - Doodle's Kennel: dog house, chewed bed, bones, the GOOD DOG sign.
  - Laundry: the crawl duct up to the kitchen.

**Links:**
- Three stair ramps: hall ↔ landing, hall ↔ basement, landing ↔ attic.
- The **Big Slide** (one-way, player-only): from the playroom down to the living-room ball pit.
- Two **crawl tunnels** (player-only, crouch):
  - The laundry duct up to the kitchen cubby.
  - The bedroom ↔ playroom play tube.

## Layout format

Each floor file exports a spec. All X/Z values are world metres. Every **Y is relative to that
floor's surface**; build.js adds the floor height.

```js
{
  id: 'ground', y: 0, height: 3, bounds: R(minX, maxX, minZ, maxZ),   // bounds = nav grid extent
  rooms:  [{ id, name, bounds, wall: 'polkaPink', floor: 'wood', ceiling?: 'plain' }],
  walls:  [wx(z, x1, x2), wz(x, z1, z2, { t?, y1?, gable? })],          // segments on grid lines
  openings: [arch(axis, at, from, to, top), { axis, at, from, to, bottom, top }],
  doors:  [door(id, axis, at, from, to, { swing: ±1, hinge: 'from'|'to', locked, kind: 'hinged'|'double'|'rollup', style, cellBox? })],
  railings: [rail(axis, at, from, to, h)],
  props:  [P(type, x, z, rot, opts, { y?, tag?, rugStyle? })],         // type = a builder in props.js
  wallProps:  [{ type: 'keypad'|'openerButton'|'fuseBox', id, x, y, z, rot }],
  containers: [{ id, kind, type, x, z, rot, opts, item?, locked? }],    // item = which SPAWNED_ITEM may spawn inside
  hides:  [{ id, kind, type, x, z, rot, opts }],
  lamps:  [{ id, x, y, z, color, intensity, range, flicker?, fixture }],
  windows:[{ axis, at, center, bottom, w, h, round? }],                 // exterior walls only
  traps:  [{ id, kind, x, z, radius, level? }],                         // creaky level vs tuning.creakyLevel
  spawns: [{ item, id, x, y, z }],                                      // loose spots; container spots come from `item`
  patrol: [{ id, x, z }],  drawings: [{ id, x, y, z, rotY }],  decals: [{ tex, x, y, z, rotY, w, h, floor? }],
  marks:  [{ box: flat(...), crawl: true }],                            // → PLAYER_ONLY|CRAWL|WALK
  holes: [], slabHoles?: [R(...)],                                      // extra nav holes / holes cut in this floor's slab
}
```

- **`axis`:** `'x'` means a wall running along X at `z = at`; `'z'` runs along Z at `x = at`.
- **Door openings:** cut the walls automatically.
- **Door `swing`:** +1 opens toward +Z (an `'x'` wall) or +X (a `'z'` wall).
- **Facing:** `FACE.N/S/E/W` are prop yaws; a prop's front faces −Z locally, like a camera.

**Shared pieces** in [layout/index.js](layout/index.js):
- `RAMPS`: stair footprints. `heightAt` is linear between `lowAt` and `highAt`, and the floor id
  flips halfway up. Stairs links are generated from these.
- `LINKS`: the slide and the tunnels, with their `points`, the chute and tunnel-interior paths,
  and the tunnel-mouth interaction boxes.
- `ANCHORS`: start bed, kennel, kennel bed, front-door hardware spots and exits.
- `SET_PIECES`: the train oval, the TV, teddy seats, and the hoard scatter, which uses a fixed
  seed so it's the same every run.

**Prop builders** return `{ parts, colliders, points, boxes, yaws, moving }`, all in local space.
`placeProp()` rotates and moves them into the world:
- **Containers** add `moving` (a slide or a hinge) and `points.use` / `points.item`.
- **Hide props** add `points.eye` / `points.exit`, `yaws.eye`, and `boxes.use`, the raycast
  proxy.

## Contract notes for other areas

- **`heightAt(x, z, floorHint)`:** only considers ramps that touch the hinted floor. That's how
  the basement stairs and the attic stairs can share a footprint one storey apart.
- **`lightLevelAt(pos, floorId)`:**
  - Starts from 0.06.
  - Adds each lamp's `intensity · (1 − d/range)²`. Lamps in your own room count in full; lamps
    in other rooms count 25%, as spill through doorways.
  - Adds up to +0.12 in the moonlight pooled under windows.
  - Is the same on every difficulty (see Tuning).
- **`colliders(floorId)`:** cached, and rebuilt only when a door on that floor changes. Don't
  mutate the array.
- **Doors:** `setOpen(open, by = 'player', { silent } = {})`.
  - It follows the fixture: it returns false if locked, and is a no-op if already in that
    state.
  - It emits `DOOR_OPENED` / `DOOR_CLOSED` (`{doorId, by}`, with `by` one of `'player'`,
    `'doodle'`, `'remote'`) plus `NOISE` (`kind: 'door'`). Loudness is 5, or 8 for the garage
    roll-up.
  - **`silent: true`** (co-op guest applying the host's snapshot): `isOpen`, the colliders and
    the leaf animation all change, but neither event nor `NOISE` is emitted. The lock and the
    no-op still apply.
  - The front door and garage door start locked.
  - Doors close even if someone stands in the doorway, so Gameplay should push the player out.
- **Containers:** `setOpen(open, by = 'player', { silent } = {})`, with the same lock, no-op
  and `silent` rules as doors.
  - `CONTAINER_OPENED` / `CONTAINER_CLOSED` carry `{containerId, by}`, plus a `NOISE`
    (`kind: 'container'`, loudness 2.5).
  - The item spot lies inside the container's collider in **both** states: just behind a
    drawer's front panel, on a cabinet's floor, in a chest. Items stay put while the moving
    part animates around them.
  - Only `atticChest` starts locked.
- **Wake spots:**
  - `anchors.startBed` is the floor beside the bottom bunk, facing east into the Kids' Bedroom.
  - `anchors.startBed2` (co-op guest) is the floor at the foot of the top bunk's ladder,
    0.9 m south of `startBed`, facing the same way.
  - **It's a floor spot, not the top mattress.** The player controller stands only on what
    `heightAt` reports (floors and stair ramps), and the bunk is one solid 1.7 m collider. Feet
    on the mattress would drop straight into it and stick. Making the top bunk walkable would
    change `heightAt` for items, the ball and the Doodle too, so solo play wouldn't stay the same.
- **Spot heights:**
  - `Spot.pos.y` for items is the surface they rest on: the floor, a table top or a shelf.
  - Wall spots (drawings, keypad, padlock, plank, fuse box, opener) sit on the wall surface,
    facing `rotY`.
  - The 4 code drawings have a clear middle where Gameplay can draw the digit. Keep overlays
    ≥ 0.01 m in front of `pos`.
- **Hide spots:** `pos` is the prop's front. The raycast proxy tagged `hide` covers the prop.
  `exitPos` is free floor in front.
- **Interactables:** invisible proxy boxes (`material.visible = false`, object visible), plus the
  real door leaves and container moving parts.
  - Proxy tags: `hide`, `linkEntry` (the slide top, and both mouths of each tunnel), `keypad`,
    `opener`, `fuseBox`, `jeep`, `piano` (id `trapPiano`, the piano trap's id).
  - Proxies never enclose an item spot.
- **Traps:**
  - Creaky planks are built as paler boards, and the set grows with difficulty.
  - The piano trap spot is the floor in front of the piano.
  - `squeaky` / `blocks` are candidate spots on open floor.
- **The Big Slide's points:** they run down the chute, through the ball pit and out over its
  rim. Emit the splash noise at the end.

## Tuning knobs ([tuning.js](tuning.js))

| Knob | practice / easy / normal / hard | What it does |
|---|---|---|
| `fogNear`, `fogFar` | 4–26 / 3.5–22 / 3–19 / 2.5–16 m | How far you can see down a dark hall |
| `ambient` | 0.75 / 0.6 / 0.5 / 0.4 | Hemisphere fill |
| `lampBoost` | 1.3 / 1.15 / 1 / 0.9 | Rendered lamp brightness (visual only) |
| `flickerRate` | 0.4 / 0.7 / 1 / 1.3 | How often flickering lamps stutter |
| `tvIdle` | s off between TV static bursts | |
| `teddyTurnRate` | 0.25 … 0.6 rad/s | How fast the watching teddies turn their heads |
| `creakyLevel` | 0 / 0 / 1 / 2 | Fixed creaky planks with `level` ≤ this are built (3 / 3 / 6 / 9) |

The knobs only change atmosphere. `lightLevelAt` never depends on difficulty, so the Doodle's
sight is tuned in one place (Doodle's own tuning), never by how dark World renders a room.

## Debug hooks

- **Dev page:** [dev/world.html](../../dev/world.html). Serve with the `world-dev` launch
  config (port 8081), then open `/dev/world.html`. It loads the real world with the stub
  player.

  | Key | Action |
  |---|---|
  | Click | Look |
  | WASD / Shift / C / F / E | Move, sprint, crouch, flashlight, use |
  | V | Noclip (Space up, Q down while moving) |
  | 1 / 2 / 3 / 4 | Jump to the basement / ground / upstairs / attic |
  | 0 | Back to the start bed |
  | O | Nav-grid overlay: green walk, yellow door, magenta player-only |
  | M | Anchor markers (see the legend in [debug.js](debug.js)) |
  | R | Toggle render scale between 0.75 and 1 |

  The HUD shows FPS, draw calls, triangles, room, light level and the lamp-pool assignment.
  `?difficulty=hard` and `?seed=N` work here too.
- **Full game with `?debug=1&real=world`:**
  - `__game.world.debug.showNav(true)` and `.showAnchors(true)` toggle the overlays.
  - `.lights()` lists the pool assignment, and `.tvOn()` reports whether the TV is on.

## Performance

Measured with a GPU timer query on this machine's AMD Radeon integrated graphics (2 CU):

| Render size | GPU time per frame | 60 fps budget |
|---|---|---|
| 960×540 (0.75 × 720p) | 2.3–3.6 ms | 16.7 ms |
| 1920×1080 | 5–10 ms | 16.7 ms |

- **Draw calls:** 60–140, depending on the view.
- **Triangles:** about 25–70k.
- **Build time:** about 80 ms after the first load.
- **Lights:** 7 point lights (the 6-light pool plus the TV), fixed for the whole run, so shaders
  never recompile.
- **No shadows.**

## Tests

`tests/world/world.test.js` checks:
- `validateWorld` and `checkReachability` on every difficulty.
- Stair heights, and that the stair links agree with `heightAt`.
- Door colliders and events, and the locked doors.
- Container events, and that item spots lie inside their containers.
- Anchor counts and spreads: spawns, hide kinds, traps, 4 drawings, patrol on every floor.
- The Doodle never reaches player-only cells or uses slides and tunnels, and every crawl
  ceiling is marked player-only.
- No orphaned walkable cells, and no furniture inside walls or stair footprints.
- Determinism, and that the pure modules never import `three`.
