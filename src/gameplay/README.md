# Gameplay: the player and every game rule

`createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings })` in
[`index.js`](index.js) returns the Gameplay object from `src/core/contracts.js`. It replaces
`src/core/stubs/gameplay.js`.

## How it fits together

| File | What it does | three? |
|---|---|---|
| [`rules.js`](rules.js) | The brain. It decides what a look target says (`describe`) and what a click does (`interact`, `useHeld`), and handles the ball, treats, darts, traps and the day flow. | no |
| [`items.js`](items.js) | Item names, per-run spawn picks (`pickSpawns`) and the one-hand rule (`createItems`). | no |
| [`locks.js`](locks.js) | The padlock, plank, keypad, fuse box, Jeep and attic chest locks. It runs both escapes and emits `LOCK_OPENED`, `EXIT_UNLOCKED`, `JEEP_STARTED` and `ESCAPED`. | no |
| [`keypad.js`](keypad.js) | The per-run code, which drawing shows which digit, and the dials. | no |
| [`traps.js`](traps.js) | Which squeaky/blocks candidates get a prop, plus proximity triggers for all traps. | no |
| [`ball.js`](ball.js) | Tennis-ball physics against World's colliders and floors. | no |
| [`raycast.js`](raycast.js) | Ray-vs-box tests: look rays don't go through walls, and darts stop at the first wall. | no |
| [`tuning.js`](tuning.js) | Every number, via `tuningFor(difficulty)`. | no |
| [`../player/movement.js`](../player/movement.js) | Circle-vs-box sliding, the crouch/stand height rule, speeds and stamina. | no |
| [`../player/path.js`](../player/path.js) | Following a nav link's polyline (slides, tunnels). | no |
| [`../player/controller.js`](../player/controller.js) | The Player object: input, pointer lock, look, walking, stairs, crouch, sprint, head bob, footsteps, flashlight, hiding, riding links. | yes |
| [`view.js`](view.js) | Meshes for items, the padlock, plank and dials, the crayon code digits, trap props, treats, the flying ball and darts, and the fuse box/opener lights. | yes |
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
  - The dart flies visibly. A miss lands on the floor as a dart you can pick up again.
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
- The full game with this area loaded: `/?debug=1&real=gameplay`.
