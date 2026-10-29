# Doodle: the hunter

`createDoodle({ scene, world, bus, rng, difficulty, puppet })` in [index.js](index.js) returns
the contract's `Doodle` (see `src/core/contracts.js`). Everything that thinks is pure logic and
runs under `node --test`. Only the model, textures and debug overlay import `three`.

| File | What it does | three? |
|---|---|---|
| [tuning.js](tuning.js) | `tuningFor(difficulty)`: every number the Doodle uses | no |
| [path.js](path.js) | A\* over the nav grid via navgrid.js `neighbors()`, string-pulled routes, door/lock helpers | no |
| [mover.js](mover.js) | Walks a route: follows stair link points, switches floor halfway up, finds doors ahead | no |
| [senses.js](senses.js) | Hearing, sight (cone + collider line of sight), catch reach, dart ray test | no |
| [scent.js](scent.js) | The player's scent: crumbs every ~1 m, and pools where they stand still or hide | no |
| [brain.js](brain.js) | `createDoodleCore()`: the state machine and event protocols. It's the whole Doodle except `model` | no |
| [puppet.js](puppet.js) | `createDoodlePuppet()`: the co-op guest's Doodle, drawn from the host's snapshots. No AI, no bus | no |
| [model.js](model.js) | The low-poly golden doodle mesh and all its poses | yes |
| [textures.js](textures.js) | Pixel textures: curly fur, collar, "DOODLE" tag, tennis ball, eyeshine glow | yes |
| [overlay.js](overlay.js) | Debug overlay: path, sight cone, hearing ring, noises, scent | yes |
| [index.js](index.js) | Glues the brain (or the puppet) to the model and the overlay | yes |

## How it moves
- **Paths:** A\* runs on the shared grid with `AGENTS.DOODLE`, so it never enters
  `PLAYER_ONLY` cells and never takes `playerOnly` links (tunnels, slides). The doorway cells of
  locked doors are treated as solid.
- **Smoothing:** the cell path is string-pulled. A line is only skipped if it and two parallel
  lines 0.2 m to each side stay on Doodle-passable cells, so routes don't shave corners.
- **Stairs:** a route crosses floors along the link's `points`. y comes from those points, and
  `floorId` flips halfway up, like `world.heightAt`.
- **Doors:** the mover looks 1.4 m ahead. A closed, unlocked door on the route gets
  `door.setOpen(true, 'doodle')` before Doodle reaches it. A locked one makes it re-plan.
  Doodle ignores its own door creaks: any `NOISE` raised inside `setOpen`, plus `kind: 'door'`
  noises near a door it opened in the last 2 s.
- **Re-planning:** it never re-plans mid-stairs. It finishes the link first.
- **Collisions:** Doodle doesn't collide with colliders. It trusts the grid, whose cells keep
  0.25 m clearance from walls.

## States
`DOODLE_STATE {state, prev}` is emitted on every change. `SPOTTED {pos}` (Doodle's position,
like the stub) fires on entering CHASE. `LOST_TRACK` fires on every exit from CHASE except to
CATCH.

| State | What it does | Leaves when |
|---|---|---|
| SLEEP | Lies in the kennel (pose `sleep`, eyes shut) for `reset`'s `wakeDelay` | Time's up. It then returns a ball still in its mouth, investigates a noise heard in the last 6 s, or patrols |
| PATROL | Walks between `anchors.patrol` on any floor and pauses 1–3 s at each. Picks are weighted toward nearer anchors and toward the last noise it heard (drift) | It hears, smells, notices a treat or ball, or sees you |
| INVESTIGATE | Trots to a heard noise and looks around for 3 s | Linger ends (→ PATROL), or fresh scent there (→ SNIFF) |
| SNIFF | Follows the freshest crumb in smell range, then the next fresher one. At a hiding spot's pool it sniffs for up to 3 s | Trail ends (→ SEARCH); pulls you out if you've hidden ≥ `hideSniffTime` |
| CHASE | Hunt mood. Re-plans every 0.3 s and lunges when within 2 m. For `trackTime` after losing sight it still knows where you went | It gets to your last spot and you're gone, after `chaseGiveUp` s unseen (→ SEARCH), or when it's stuck where it can't reach you (→ PATROL, 4 s blind) |
| SEARCH | Looks around the last known spot, then checks random reachable points within 5 m | `searchTime` ends (→ PATROL) |
| DISTRACTED | Fetching the ball, carrying it home, walking to a treat, or eating (5 s) | Done (→ PATROL, or the next treat in range) |
| STUNNED | Lies chewing the squeaky dart (pose `chew`) for the stun time | → `DOODLE_RECOVERED`, then INVESTIGATE where the dart came from |
| CATCH | Pounces (pose `pounce`, hunt mood). Frozen until `reset()` | `reset()` |

**Spotting:** while you're in view, `awareness` rises at
`1 / (spotTime + spotTimePerMeter × distance)` per second. It chases at 1.

**Catch rule:** `CAUGHT {how: 'tackle'}` is emitted once per catch. It fires when Doodle is on
your floor, within `DOODLE_BODY.catchRange`, and you're not hidden. Extra guards on top of the
contract:
- Nothing may block the line between you at 1 m height, so no catching through walls or closed
  doors. It can still lean over a ball-pit rim.
- No catch while you're inside a `PLAYER_ONLY` cell.
- No catch while it's asleep or stunned.

## Co-op (two players)
See CONTRACTS.md, "Co-op". The host's game runs this brain for both players; the guest's game
runs a puppet.

- **`update(dt, players)`** takes one Player or an array. Players with `down: true` are skipped
  entirely: not seen, not caught, no scent.
- **Per-player memory**, keyed by `player.id` (a Player with no id is `'host'`): sight,
  awareness, last sighting, hide spot, link (slide/tunnel) blindness and its own scent.
- **Who it hunts** (`pickTarget`, every think):
  - The visible player it's most aware of; otherwise the nearest, by 2D distance plus 6 m per
    floor apart.
  - **Hysteresis:** the current target gets a margin (`targetStick` awareness, or
    `targetStickDist` m), and while it's in view it's kept at least `targetHold` s.
  - **Mid-chase** it only switches to a player it has fully spotted (awareness 1), never to one
    it merely knows is closer. A pull-out locks the target to the player in the hiding spot.
  - `debug.senses.targetId` names the target, and `debug.senses.players` lists each record.
- **Smell** follows the freshest trail across both players' scents. A sniffed hiding pool is
  checked against its owner's hide.
- **Events** key their state by `payload.playerId ?? 'host'`: `HIDE`, `UNHIDE`, `LINK_ENTER`,
  `LINK_EXIT`. The guest's arrive replayed with `remote: true`; they count like local ones, and
  so does the guest's `NOISE`.
  - A seen `HIDE` starts a pull-out of that player, unless it's chasing the other player and can
    still see them.
  - `LINK_ENTER` only ends a chase when it's the chased player going in.
- **Catching:** every player in reach is checked, the target first. `CAUGHT` carries
  `{how, playerId}`. A Player with no `id` (the solo tests' fake player) gets `{how}` only, as
  before co-op; a missing playerId means the host.
- **`releaseCatch(playerId)`** (knock-out): leaves CATCH, forgets that player until `reset()`
  (even if its Player is still passed and not yet `down`), and clears its scent and hide. Then
  it stands in SEARCH for `releasePause` s: no moving, no catching, deaf to noises, treats and
  balls, though it keeps noticing whoever is in view. After that it INVESTIGATEs a random point
  within `releaseHuntFuzz` m of the nearest remaining player (or their hiding spot), and its
  senses take it from there. The pause clock only runs while it's active, so a cutscene doesn't
  eat it. If nobody is left it searches where it stands.
- **`snapshot()`:** `{pos, yaw, pitch, pose, mood, carrying, speed, state, floorId, target}` as
  plain JSON, rounded to millimeters. `target` is the hunted player's id (or null).
- **The puppet** (`createDoodle({..., puppet: true})`, puppet.js):
  - No brain, no bus emits, no bus reactions. `stun()` and `releaseCatch()` are no-ops: the host
    decides those.
  - `applySnapshot(snap)` stores the target. `state`, `speed` and `floorId` mirror the latest
    snapshot at once, for Audio and UI.
  - `update(dt)` glides the drawn position and yaw toward the snapshot: it extrapolates the
    snapshot along its velocity (from the last two, at most 0.15 s ahead) and closes the gap at
    14/s. A velocity over 9 m/s is a teleport and isn't extrapolated.
  - It jumps instead of gliding on the first snapshot, after `reset()` or `setActive(true)`, on a
    gap over 3 m, and on a floor change more than 1 m away. Stairs flip `floorId` halfway up the
    ramp, so a near floor change glides rather than hitching.
  - Pose, mood and carrying follow the snapshot. `setActive(false)` stops following (a cutscene
    owns the model); back on, it jumps to the latest snapshot.
  - `reset(spot)` puts it asleep at the spot and drops any older snapshot, so a stale one can't
    drag it back to the catch.
  - `bounds()` works as on the brain.

## Senses
- **Hearing:** a `NOISE` is heard when its 2D distance is ≤ `loudness × hearing ×
  floorDamping^floorsApart`. It's ignored while asleep (only remembered), stunned, chasing
  you in sight, or distracted.
- **Sight:**
  - The 110° cone uses the body yaw. Sweeping its head to "look around" turns the body, so the
    cone sweeps too.
  - Range is `sightMin + (sightMax − sightMin) × √visibility`, and at least `closeSense`.
    Within `closeSense` it sees all around.
  - Only on your floor.
  - The line of sight from its eyes (1.3 m) to your chest (0.9 m, or 0.45 m crouched) is
    tested against `world.colliders()`, not the nav grid. Nav cells mark low furniture and
    stairwell holes as solid, and treat doorways as open whether the door is shut or not.
  - Blind while eating, and from `LINK_ENTER` until 0.5 s after `LINK_EXIT`.
- **Smell:**
  - **Crumbs:** you leave one every `crumbSpacing` m, and each lasts `crumbLife × nose` s.
    Patrol, investigate and search start a SNIFF on crumbs younger than `sniffFresh × nose`,
    within `smellRange × nose`.
  - **Pools:** standing still for `poolDelay` s, or hiding, grows a pool. Its radius is
    `poolRadius0 + poolGrowth × seconds`, up to `poolMaxRadius`. It fades over `poolDecay`
    after you leave.
  - **Through floors:** smell is damped by `smellFloorDamping` per floor apart.
  - **Rechecks:** a pool it has already checked is ignored until you add to it, and for at
    least `poolRecheck` s.

## Event protocols (CONTRACTS.md table)
| Event in | Reaction |
|---|---|
| `NOISE` | Investigate, if heard (see above). Mid-chase with you out of sight, it updates where it thinks you are |
| `BALL_LANDED` | Fetches it if it hears it land (within `ballHearRadius`, floor-damped) and is calm, or chasing without sight of you. Otherwise the ball is remembered, and it fetches it if it later passes within `ballSpotRange` with line of sight |
| Reaches the ball | `BALL_FETCHED`, carries it to `anchors.kennelBed`, then `BALL_RETURNED {pos, floorId}` |
| `PICKUP {itemId: 'tennisBall'}` | Cancels a fetch and investigates where the ball was |
| `TREAT_DROPPED` | Goes and eats it (`eatTime`), then `TREAT_EATEN {treatId}`. This breaks a chase. Hard rolls `treatIgnoreChance` once per treat. Treats beyond smell range are eaten later when it passes by. Unreachable ones are given up on |
| `DART_FIRED` | Ray vs `bounds()`, stopped by colliders on the shooter's and Doodle's floors. On a hit: `DOODLE_HIT`, STUNNED, `DOODLE_STUNNED {seconds}`, and later `DOODLE_RECOVERED` |
| `HIDE` | If it saw you within `hideSeenGrace` s (sight is computed each frame, and you're already hidden when HIDE arrives), it chases to the spot and emits `CAUGHT {how: 'pulledOut'}` within `pullOutReach` |
| `UNHIDE` | Stops the pull-out. Sight takes over |
| `LINK_ENTER` | Mid-chase: loses track (→ SEARCH at your last sighting) |

**Dropping the ball early:** if it spots you, or gets stunned, while carrying the ball, it drops
it where it stands. It emits `BALL_RETURNED` with that position.

**Caught while carrying:** if a catch happens while it carries the ball, it keeps the ball
through `reset()`. It returns the ball to the kennel bed after waking.

**`setActive(false)`:** no AI and no events (all emits go through one gate), but the model keeps
animating. While inactive, the cutscene owns `model.object3d`, its pose and its mood. On the
frame CAUGHT freezes it, index.js still syncs once, so the cutscene starts from the pounce.
`reset()` puts the model back at Doodle's position, asleep.

## Tuning knobs (`tuning.js`)
Normal is the baseline. Easy is slower and duller; Hard is faster and keener.

| Knob | Easy | Normal | Hard |
|---|---|---|---|
| `patrolSpeed` / `chaseSpeed` (m/s) | 2.1 / 4.0 | 2.5 / 4.6 | 2.9 / 4.9 (just under the 5 m/s sprint) |
| `hearing` (× loudness) | 0.7 | 1 | 1.3 |
| `sightMax` (m at visibility 1) | 11 | 14 | 16 |
| `nose` (× smell radii and crumb life) | 0.75 | 1 | 1.4 |
| `hideSniffTime` (s) | 35 | 25 | 15 |
| `stunTime` (s) | 30 | 20 | 12 |
| `treatIgnoreChance` | 0 | 0 | 0.5 |
| `trackTime` (s) | 0.8 | 1.2 | 1.6 |

Co-op knobs, the same on every difficulty: `targetHold` 1 s, `targetStick` 0.3,
`targetStickDist` 3 m, `releasePause` 5 s, `releaseHuntFuzz` 4 m.

Other shared knobs are documented inline in `tuning.js`. `createDoodle` and `createDoodleCore`
also accept a `tuning` object of overrides, which the tests use.

## Model
- **Shape:** a fluffy golden doodle built from lumpy icosphere blobs with flat shading and a
  32 px curly-fur texture. Shoulder ≈ 1.18 m, feet at y = 0, facing −Z.
- **Details:** floppy ears, a curled wagging tail, a tongue, and a red studded collar with a
  gold "DOODLE" tag. A tennis ball shows in its mouth while carrying.
- **Eyeshine:** `MeshBasicMaterial` plus an additive glow sprite, both with `fog: false`. In a
  dark hallway you see the eyes first.
- **Mood:** `setMood('hunt')` pins the ears back, turns the eyes red, opens the jaw to show fangs
  and a red mouth, and stiffens the tail.
- **Poses:** all of `DOODLE_POSES` are animated in code:
  - `idle`, `walk`, `run`: the run is a gallop.
  - `sniff`: nose down, head sweeping.
  - `eat`: head down, chomping.
  - `chew`: lying down with the toy, head shaking.
  - `sleep`: sphinx pose, eyes shut.
  - `pounce`: crouch, then rear up. One-shot unless `{loop: true}`.
  - `lick`: tongue flapping.
  - `drag`: head low, walking backward.
- **Extras:** two methods beyond the contract, which index.js drives:
  - `setGait(speed)`: leg cadence from real speed. `null` uses each pose's own cadence, which is
    what cutscenes get.
  - `setCarrying('ball'|null)`.

## Debug hooks
- **Full game:** `/?debug=1&real=doodle`.
  - `__game.doodle.debug.overlay(true)` toggles the overlay. `&doodleOverlay=1` turns it on at
    start.
  - `__game.doodle.debug` holds `path`, `target` and `senses`: awareness, sight result, range,
    last noise, crumbs, pools, ball, treats.
- **Dev page:** `/dev/doodle.html` (the `doodle-dev` launch config, port 8082) runs the stub
  world, the stub player and the real Doodle with the overlay on.
  - **Params:** `?difficulty=easy|normal|hard`, `?seed=N`, `?view=player|chase|map`,
    `?wake=seconds`.
  - **Stub player keys:** WASD, mouse, Shift, C crouch, F flashlight, E doors and hiding, N
    loud noise.
  - **Doodle keys:**
    - T drops a treat.
    - B throws the ball ahead; P picks it back up.
    - X fires a dart.
    - O toggles the overlay.
    - R resets the day.
    - V cycles the view: first person, a camera on Doodle's face, top-down map.
    - M cycles every pose with the AI frozen; H toggles the mood.
    - 1/2/3 switch difficulty.
    - G drops a fake second player (the `guest`, a blue box) where you stand; J removes it.
    - K toggles the knock-out rule: a catch downs that player, and 1.5 s later the page calls
      `releaseCatch()` so Doodle hunts the other one. Off, any catch ends the day.
    - The info panel's TARGET line shows who it's hunting and each player's awareness.
  - **`__dev.tick(seconds)`** steps the page by hand in 1/30 s frames, for a hidden tab that gets
    no animation frames. `__dev.guest()` is the fake guest Player, or null.
  - **Overlay:**
    - Cyan: the path and target.
    - Yellow fan: sight, red while it sees you.
    - Green ring: how far it hears a sprint step.
    - Fading rings: each noise's heard radius (green = heard, red = not).
    - Orange dots: scent crumbs. Orange rings: pools; magenta: a hiding pool.

## Tests
`tests/doodle/` runs on the mini-house fixture over a real bus:
- **path.test.js:** A\* across the stairs, never through the tunnel or slide, locked doors,
  opening hallKitchen.
- **senses.test.js:** tuning, hearing, sight cone/range/walls/doors, reach, darts, scent.
- **brain.test.js:**
  - The state transitions, catching `CAUGHT` once, no catch through walls or in tunnels.
  - `setActive(false)`.
  - Hide seen and unseen, and a long hide sniffed out.
  - Scent following, and no dithering at unreachable scent.
- **protocol.test.js:** ball fetch, cancel and carry through `reset()`, treats (incl. Hard's
  ignore rate), darts per difficulty, `LINK_ENTER`, `{state, prev}` chaining.
- **coop.test.js:** two players. It chases the visible one, ignores a `down` one, switches to
  the other after `releaseCatch` (pause included), doesn't flip-flop, keeps hides and links per
  player, hears replayed `NOISE`, follows the fresher trail, and `CAUGHT` names the player.
  Also `snapshot()` JSON, and the puppet: it emits nothing, mirrors state, converges on a host
  Doodle fed at 10 Hz, jumps big gaps, and holds still while inactive.
