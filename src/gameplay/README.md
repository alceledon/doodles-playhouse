# Gameplay: the player and every game rule

`createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings, coop })` in
[`index.js`](index.js) returns the Gameplay object from `src/core/contracts.js`. It replaces
`src/core/stubs/gameplay.js`. Without `coop` it's the solo game; with `coop: {role, rule}` it's
one side of an online two-player run (see [Co-op](#co-op)).

## How it fits together

| File | What it does | three? |
|---|---|---|
| [`rules.js`](rules.js) | The brain. It decides what a look target says (`describe`) and what a click does (`interact`, `useHeld`), for whichever player acts. It handles the ball and darts in flight, treats, traps, walking out, the day flow, and co-op snapshots and intents. | no |
| [`items.js`](items.js) | Item names, per-run spawn picks (`pickSpawns`), and the hands (`createItems`): one per player, one item each. | no |
| [`locks.js`](locks.js) | The padlock, plank, keypad, fuse box, Jeep and attic chest locks. It runs both escapes and emits `LOCK_OPENED`, `EXIT_UNLOCKED`, `JEEP_STARTED` and `ESCAPED`. | no |
| [`keypad.js`](keypad.js) | The per-run code, which drawing shows which digit, and the dials. | no |
| [`traps.js`](traps.js) | Which squeaky/blocks candidates get a prop, plus proximity triggers for all traps. | no |
| [`ball.js`](ball.js) | Tennis-ball physics against World's colliders and floors. | no |
| [`raycast.js`](raycast.js) | Ray-vs-box tests: look rays don't go through walls, and darts stop at the first wall. | no |
| [`tuning.js`](tuning.js) | Every number, via `tuningFor(difficulty)`. | no |
| [`../player/movement.js`](../player/movement.js) | Circle-vs-box sliding, the crouch/stand height rule, speeds and stamina. | no |
| [`../player/path.js`](../player/path.js) | Following a nav link's polyline (slides, tunnels). | no |
| [`../player/controller.js`](../player/controller.js) | The Player object: input, pointer lock, look, walking, stairs, crouch, sprint, head bob, footsteps, flashlight, hiding, riding links. | yes |
| [`../player/remote.js`](../player/remote.js) | Co-op: the partner as a Player, eased toward their poses; `makePose`, and the visibility formula both players share. | no |
| [`../player/avatar.js`](../player/avatar.js) | Co-op: the partner's low-poly kid, with walk and crouch poses, the held item, and a flashlight that lights the house. | yes |
| [`view.js`](view.js) | Meshes for items, the padlock, plank and dials, the crayon code digits, trap props, treats, the flying ball and darts (drawn from the rules' state), and the fuse box/opener lights. | yes |
| [`viewmodel.js`](viewmodel.js) | The held item in the bottom-right of the view. | yes |
| [`models.js`](models.js), [`textures.js`](textures.js) | Procedural low-poly models and 16–48 px canvas textures. | yes |

The pure files are tested in `tests/gameplay/` on the mini-house fixture. Those tests include
playing both escapes all the way through. The 3D layer only finds look targets and moves meshes.
Every rule lives in `rules.js`.

## Controls

| Input | Action |
|---|---|
| Mouse | Look. Click the canvas to lock the pointer; that click doesn't count as an action. |
| WASD (or arrows) | Move: walk 3 m/s. |
| Shift | Sprint at 5 m/s. Uses stamina; once it runs dry you can't sprint until it's back to 30%. |
| C | Crouch toggle (1.5 m/s). You can't stand up under a low ceiling, and you stand automatically once there's room. |
| Left click / E | Interact: pick up, open or close, use the held item on a lock, turn a keypad dial, hide or stop hiding, enter a slide or tunnel, press the opener, start the Jeep, play the piano. |
| Right click | Use the held item on what you're looking at if it fits. Otherwise: throw the ball, drop a treat, or fire the launcher. On a keypad dial it turns the dial back. |
| G | Drop the held item. It makes a noise. |
| F | Flashlight: a SpotLight on the camera. |
| Esc | Pause. Losing pointer lock emits `PAUSE_REQUEST`. |

Carrying the Car Battery caps your speed at 2.2 m/s and stops sprinting.

### Touch (phones and tablets)

`src/player/touch.js` draws on-screen controls while the input mode is `touch`
(`src/core/device.js`, `EVENTS.INPUT_MODE`) and controls are enabled. It only feeds the
controller (`stick`, `touchLook`, `toggleCrouch`, `toggleFlashlight`) and Gameplay's own
actions; the math is pure in `src/player/joystick.js`.

| Touch | Action |
|---|---|
| Left half | A stick appears where the thumb lands: analog walk, pushed to the rim = sprint. |
| Right half | Drag to look (`settings.touchSensitivity`, `invertY`; `tuning.look.touch` rad/px). |
| Quick tap | Interact with what's under the finger, if it's in reach and not behind a wall (`tapAt`, the same raycast as the look target). A quick tap on the left half that never moved the stick counts too. While hidden, a tap gets you out. |
| Hand button | Interact with what's in the middle (lit while there's a prompt). |
| Use / Drop / Crouch / Light | Right click, G, C and F. Use reads Throw, Treat or Fire for the held item. |
| Pause (top right) | `PAUSE_REQUEST`. Hiding the page (app switch) also pauses, on desktop too. |

There's no pointer lock in touch mode: `requestPointerLock()` is a no-op. `debug.tap(x, y)`
taps at client coordinates and `debug.touch` is the controls object.

## Items

- **One hand each.** Every rule takes the acting player; `player.id` picks the hand (`'host'` in a
  solo run). In co-op each player has their own hand, and everything below applies per hand.
- **One hand.** If you pick something up while holding another item, the old one goes down
  where the new one was, inside the same drawer if the new one came from a drawer. That swap
  makes a small noise.
  - Holding the launcher and picking up a dart loads the dart (+1 shot), and the reverse
    works too.
- **Spawns.** `pickSpawns` chooses one candidate from `anchors.spawns[itemId]` per item, using
  the run's rng (`rng.fork('spawns')`).
  - No two items share a spot or a container.
  - The launcher always goes in the attic chest's `itemSpot`, and nothing else spawns there.
  - Darts spawn `tuning.items.spareDarts` times.
- **Containers.** Items inside a container are hidden and can't be grabbed until it's open.
- **Treats.** You get 3 uses (4 on Easy, 2 on Hard). Each right click drops one in front of you
  (`TREAT_DROPPED`). `TREAT_EATEN` removes it. Dropped treats can't be picked back up.
- **Launcher.** It starts with 2 shots. Firing emits `DART_FIRED {origin, dir, range}`, where
  `range` is cut short at the first wall, floor or ceiling. It also emits a small `NOISE`.
  - The dart flies visibly (`rules.darts`, stepped in `rules.update`). A miss lands on the floor
    as a dart you can pick up again.
  - After a `DOODLE_HIT` the dart is gone.
- **Ball.** Right click throws it with bouncy physics (`BALL_THROWN`).
  - The first hard bounce makes the loud `NOISE`; later bounces are quieter.
  - Once it comes to rest: `BALL_LANDED {pos, floorId}`.
  - `BALL_FETCHED` hides it.
  - `BALL_RETURNED` puts it at the given spot.
  - If Doodle still has it when a day ends, it turns up on `kennelBed`.
- **Persistence.** Items and locks persist across days. `onCaught()` drops the held item where
  you were caught, without extra noise.

## Locks and escapes

| Lock | Where | Needs |
|---|---|---|
| `padlock` | front door: Gameplay's padlock on `anchors.frontDoor.padlock` | Padlock Key |
| `plank` | front door: Gameplay's plank on `anchors.frontDoor.plank` | Hammer |
| `keypad` | four colored dials on World's keypad housing | the run's 4-digit code |
| `fuseBox` | World's fuse box | Fuse |
| `jeepKey`, `jeepBattery` | World's Jeep | Jeep Key, Car Battery |
| `atticChest` | the attic chest container | Toy Chest Key |

- **Keys are used up** when they open their lock.
- **A wrong item** shows "Locked: needs the …" and stays in your hand.
- **Front door:**
  - Once all three locks are open, the door is unlocked and `EXIT_UNLOCKED {route: 'frontDoor'}`
    goes out.
  - Clicking the door then opens it and emits `ESCAPED {route: 'frontDoor'}`.
  - Walking out through it after someone else opened it also counts.
- **Keypad code:**
  - `generateCode(rng.fork('keypad'))` gives 4 digits, never 0000, since the dials start there.
  - Digit *k* is drawn in `DIAL_COLORS[k]` (red, blue, green, purple, left to right) as a
    crayon decal on one of the four `anchors.drawings`. The order is shuffled.
  - The decals are Lambert, so you need light (or the flashlight) to read them.
  - The keypad opens the moment the dials match the code.
- **Garage:**
  - The fuse in the fuse box powers the opener. The fuse box and opener LEDs turn green.
  - Pressing the opener unlocks and opens the garage door, and pressing it again closes the door.
  - Key + battery + fuse together emit `EXIT_UNLOCKED {route: 'garage'}`.
  - Starting the Jeep always emits `JEEP_STARTED` and a 40 m `NOISE`.
  - If the garage door is open you drive out (`ESCAPED {route: 'garage'}`). If not, you get
    "Vroom! But the garage door is closed!"
  - On foot, the open garage doorway stays solid. You only leave in the Jeep.
- **Attic chest:** the Toy Chest Key unlocks and opens it.

## Hiding, slides, tunnels and traps

- **Hiding:**
  - Clicking a `hide` mesh eases the camera to the spot's `eyePos` and `yaw`.
  - Look is limited to ±0.75 rad of yaw and ±0.4 rad of pitch.
  - Click again to come out at `exitPos`. Emits `HIDE {spotId, pos, floorId}` / `UNHIDE`.
  - While hidden, `player.pos` is the hide spot's `pos`, and `visibility()` is 0.
- **Slides and tunnels:**
  - Clicking a `linkEntry` mesh moves you along `link.points`, with `LINK_ENTER` at the start and
    `LINK_EXIT` at the end.
  - The slide accelerates and lands with a splash `NOISE`. You can't climb up a one-way slide.
  - Tunnels (`crawl`) need you crouched, and you come out crouched.
- **Traps:**
  - Squeaky toys and block towers are placed on a fraction of World's candidate spots:
    `tuning.traps` (Normal ½, Hard 85%).
  - Every trap fires on proximity with `TRAP {kind, pos, floorId}` + `NOISE`:
    - Squeaky toys and creaky planks fire each time you step on them. They're half as loud
      crouched.
    - The piano fires when you bump it, but not crouched. Clicking it plays it.
    - Block towers topple once per day. `startDay` rebuilds them.
- **Footsteps:**
  - `FOOTSTEP` fires every step, for audio.
  - Sprint steps also make a 7 m `NOISE`. Walking is silent to Doodle by default
    (`noise.walkStep`), and crouch-walking always is.

## Co-op

`createGameplay({..., coop: {role: 'host'|'guest', rule: 'shared'|'knockout'}})`. Without `coop`
nothing below happens, and no event carries a `playerId`.

**Who does what.**
- **Host:** runs every rule for both bodies: items and hands, locks, keypad, traps, treats, the
  ball and darts, walking out. Events about a player carry `playerId` (and `PICKUP` a `pos`).
- **Guest:**
  - It builds the same run from the same seed: spawns, code, drawings and traps come from rng
    forks, so both initial snapshots are equal.
  - It never changes shared state. Clicks that would (`rules.needsHost`) become intents. Clicks on
    its own body run locally: hiding, slides and tunnels, the keypad housing's hint.
  - Its prompt shows `…` until a snapshot answers the intent, for up to 3 s. The answer's
    message ("Locked: needs the Hammer") then shows like a local one.
  - It emits only its own body's events: `FOOTSTEP`, step and splash `NOISE`, `HIDE`/`UNHIDE`,
    `LINK_*`, plus `HELD` when its hand changes in a snapshot. It runs no traps, no ball physics,
    and no reactions to `BALL_FETCHED`, `BALL_RETURNED`, `TREAT_EATEN` or `DOODLE_HIT`.
  - Trap props animate from the host's replayed `TRAP` events.
- **Both:**
  - Any event with `remote: true` is ignored by the rules.
  - Treat ids (`treat1`...), flying-dart ids (`dart1`...) and missed-dart items are only ever made
    on the host.
  - Two players can't share a hide spot: "Someone's already hiding here". You can't close a door
    on your partner either.

**Hooks** (on the Gameplay object only in co-op):

| Hook | Side | What it does |
|---|---|---|
| `player.id` | both | The role. `'host'` in a solo run. |
| `remote` | both | A getter: the partner as a Player (`src/player/remote.js`), or `null` before their first pose and after they leave. Doodle senses it like the local player. `remote.held` is their hand in the shared state. |
| `pose()` | both | The local PlayerPose, rounded to cm and centiradians. Send it ~10 Hz. |
| `setRemotePose(pose)` | both | The partner's newest pose. Walking eases in; jumps over 2.5 m and hiding snap. `null` means they left: hidden from Doodle and not drawn. |
| `snapshot()` | host | Shared state as plain JSON (see below). |
| `applyIntent('guest', intent)` | host | Run a guest's click on its behalf, with the same rules. A repeated `n` is ignored, and a down guest's intents are answered but do nothing. |
| `applySnapshot(snap)` | guest | Mirror the host. Idempotent and silent. Doors and containers get `setLocked`, then `setOpen(open, 'remote', {silent: true})`. Returns whether anything changed. |
| `setIntentSink(fn)` | guest | Where intents go. Without one, shared-state clicks do nothing. |
| `setDown(id, down)` | both | Knock-out. A down player can't act, sets off no traps, and can't walk out. On the host, their held item drops where they are. The avatar hides while the partner is down. |
| `onCaught(playerId?)` | both | As before for the local player. On the host, `onCaught('guest')` drops the guest's item where the guest was; on the guest the host does the dropping. |

`startDay` wakes the guest at `anchors.startBed2`, or 0.7 m to the right of `startBed` if there's
no `startBed2` (`rules.wakeSpot`). The host also keeps the traps under the guest's bed quiet.
Either player walking out of the open front door, or starting the Jeep with the garage open, sends
`ESCAPED {route, playerId}` (host only).

**Intent** (guest → host, plain JSON):
```js
{
  n: 7,                                   // per guest, increasing; the snapshot's acks answer it
  kind: 'primary' | 'secondary' | 'drop', // click / E or a tap, right click, G
  target: {kind, id, dial?} | null,       // the look target's interact tag
  body: {
    pos, floorId, crouched,               // the guest's feet (the host acts from here)
    eye, dir,                             // eye point and unit look direction (throws, darts)
    drop:  {pos, floorId},                // the floor spot 0.45 m ahead (G)
    treat: {pos, floorId},                // the floor spot 0.6 m ahead (a treat)
    range,                                // a dart's reach before the first wall, floor or ceiling
  },
}
```

**Snapshot** (host → guest, plain JSON, about 1.5 KB on the mini-house):
```js
{
  v: 1,
  items: [{id, i: itemId, w: where, p: [x, y, z], f: floorId, c: containerId, r: rotY, u: uses}],
  hands: {host: instId | null, guest: instId | null},
  locks: {open: [lockId], routes: [route], escaped: route | null},
  keypad: '0420',                          // the dials as they stand
  treats: [{id, p, f}],
  ball: instId | null,                     // the ball Doodle fetches
  darts: [{id, o: origin, d: dir, e: end distance, h: 1 if it hit, f}],  // in flight; the guest animates them
  toppled: [trapSpotId],
  doors: [[doorId, open 0|1, locked 0|1]],
  boxes: [[containerId, open 0|1, locked 0|1]],
  acks: {guest: [n, message | null]},      // the last intent run, and its one-off message
}
```
Numbers are rounded to mm, so the snapshot only changes when something does. The exception is a
flying ball, which changes every frame until it lands; the guest's view eases toward it. A dart's
progress isn't sent: the guest flies its copy from the moment it first sees it.

**Wiring for main.js** (the coordinator's side):
- Host: send `snapshot()` when its JSON changes, `pose()` ~10 Hz, and pass `applyIntent('guest', m.intent)`.
- Guest: `setIntentSink(i => session.send('intent', {intent: i}))`, and call `applySnapshot` on each
  `state` value.
- Both: call `setRemotePose` on each partner `pose`, and pass `[player, remote]` to Doodle while
  `remote` isn't null.
- Audio gets `remote` for the partner's flashlight and steps.

## Tuning knobs (`tuning.js`)

| Group | Knobs |
|---|---|
| `move` | `walk`, `sprint`, `crouch`, `battery` (speed cap), `accel`, `maxStep`, `gravity` |
| `stamina` | `drain`, `regen`, `regenDelay`, `recoverAt` |
| `look` | `sensitivity` (× `settings.mouseSensitivity`), `pitchLimit`, `hideYaw`, `hidePitch` |
| other | `reach` (2.2 m), `steps` (footstep intervals), `bob` (head bob), `crouchVisibility` (0.6), `messageSeconds` |
| `noise` | NOISE radius for every sound Gameplay makes, plus `crouchTrapFactor` |
| `traps` | fraction of `squeaky` / `blocks` candidates to fill |
| `items` | `treatUses`, `launcherShots`, `spareDarts` |
| `ball` | `throwSpeed`, `lift`, `restitution`, `wallRestitution`, `rollFriction`, `maxFlight` |
| `dart` | `range`, `speed` |
| `link` | `crawlSpeed`, `slideStart`, `slideMax`, `slideAccel`, `slideEye`, `crawlEye` |
| `flashlight` | `visibility` bonus, plus the SpotLight's `intensity`, `distance`, `angle`, `penumbra`, `decay` |

Easy, Normal and Hard differ in trap density, treat/dart counts, stamina, and a couple of noise
radii. Practice uses few traps.

## Debug hooks

- **`gameplay.debug` (contract):**
  - `giveItem(id)`: reuses the item if it's lying somewhere, otherwise makes one. Whatever you
    held goes down at your feet.
  - `setNoclip(on)`: Space/Q fly up/down.
  - `teleport(pos, floorId)`
  - `openAllLocks()`: also sets the dials to the code.
  - `keypadCode()`
- **Extras for dev pages and automation:**
  - `rules`, `controller`, `view`
  - Co-op: `partner` (the remote player's controller: `setPose`, `setDown`, `isPresent`) and
    `avatar`.
  - `lookAt(pos)`, `target()`
  - `interact()`, `use()`, `drop()`. These run the real look-raycast path, so a script can play
    the game without pointer lock.
- **With `?debug=1` in the URL:**
  - Keys 1–9 and 0 give `ITEM_IDS[0..9]`.
  - N makes a 12 m noise.
  - V toggles noclip.
  - L opens all locks.

## Dev page

`dev/gameplay.html`, served by the `gameplay-dev` launch config on port 8083:
`http://localhost:8083/dev/gameplay.html`.

- It runs the stub world (mini-house fixture) with the real Gameplay, plus a minimal HUD.
- There's an optional stub Doodle: use the button, or add `?doodle=1`. It walks straight at you
  through walls.
- The side panel can open all locks, give items, teleport, start the next day, and toggle noclip.
- Add `?seed=N` for a fixed layout and `?difficulty=hard` for more traps.
- **Co-op in one tab** (no network):
  - `?coop=host`: you host. A scripted guest walks a loop in front of your bed with its
    flashlight on. The panel makes it grab the nearest item (an intent run on your rules) or
    knocks it out.
  - `?coop=guest`: you're the guest. Your clicks become intents for a host rules instance inside
    the page (its own world, not drawn), with 120 ms of fake lag, and you mirror its snapshot
    every frame. A scripted host walks the loop.
- The full game with this area loaded: `/?debug=1&real=gameplay`.
