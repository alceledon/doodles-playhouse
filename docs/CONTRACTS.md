# Contracts: how the areas fit together

The game is built by **four parallel worker sessions** (World, Doodle, Gameplay, Presentation),
plus a **coordinator** that owns the shared core and integrates their work. Areas don't import
each other's internals. They meet in exactly three places:

1. **Shapes and constants** in [`src/core/contracts.js`](../src/core/contracts.js): the World,
   Player, Gameplay, Doodle, UI, Cutscenes and Audio objects, plus item, lock, state and
   floor ids.
2. **Events** on the bus in [`src/core/events.js`](../src/core/events.js): the `EVENTS` table
   lists every event and its payload.
3. **Grid semantics** in [`src/core/navgrid.js`](../src/core/navgrid.js): what a nav cell's
   flags mean, neighbors, reachability.

Read those three files first; they're the source of truth. This document explains them.

## File ownership

| Owner | Owns (creates and edits only these) |
|---|---|
| **Coordinator** | `index.html`, `style.css`, `package.json`, `README.md`, `CLAUDE.md`, `.nojekyll`, `.gitignore`, `.claude/`, `tools/`, `vendor/`, `src/main.js`, `src/areas.js`, `src/core/**`, `src/leaderboard/**`, `firestore.rules`, `src/net/**`, `database.rules.json`, `tests/core/**`, `tests/leaderboard/**`, `tests/net/**`, `docs/**`, `dev/template.html` |
| **World** | `src/world/**`, `dev/world.html`, `tests/world/**` |
| **Doodle** | `src/doodle/**`, `dev/doodle.html`, `tests/doodle/**` |
| **Gameplay** | `src/player/**`, `src/gameplay/**`, `dev/gameplay.html`, `tests/gameplay/**` |
| **Presentation** | `src/ui/**`, `src/audio/**`, `dev/presentation.html`, `tests/ui/**`, `tests/audio/**` |

Never edit a file you don't own, even to fix a one-character bug. Report it to the coordinator
instead, so two branches never touch the same file.

## Entry points (what main.js imports)

| Area | File | Exports |
|---|---|---|
| World | `src/world/index.js` | `createWorld({ scene, bus, rng, difficulty }) → World` |
| Gameplay | `src/gameplay/index.js` | `createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings }) → Gameplay` |
| Doodle | `src/doodle/index.js` | `createDoodle({ scene, world, bus, rng, difficulty }) → Doodle` |
| Presentation | `src/ui/index.js` | `createUI({ root, bus, leaderboard }) → UI` (`leaderboard` optional), `createCutscenes({ camera, getScene, ui, bus }) → Cutscenes` |
| Presentation | `src/audio/index.js` | `createAudio({ bus, camera }) → Audio` |
| Coordinator | `src/leaderboard/client.js` | `createLeaderboard({ config, fetch, allowSubmit, timeoutMs }) → Leaderboard` (`fake.js`: `createFakeLeaderboard(...)`, the same shape) |

- **Reference implementations:** each one has a working **stub** in `src/core/stubs/`, which shows
  the minimum behavior.
- **Which version runs:** `src/areas.js` decides whether main.js loads your real module or the
  stub. On your branch you can force yours with `?real=<area>`, e.g.
  `http://localhost:8080/?debug=1&real=doodle`.
- **Per-run objects:** World, Gameplay and Doodle are created fresh for every run, with a
  **scoped bus**. Its subscriptions are all removed when the run ends, so you don't need to
  unsubscribe yourself. You still must remove DOM and window listeners and scene objects in
  `dispose()`.
- **Long-lived objects:** UI, Cutscenes and Audio are created once and get the root bus.
- **Randomness:** use the `rng` you're given, not `Math.random()`, for anything that affects a
  run, so a seed reproduces it. `rng.fork('label')` makes independent sub-streams.
- **Leaderboard:** main.js builds one and hands it to `createUI` (see the `Leaderboard` typedef).
  - It's the online board (Cloud Firestore over REST, `src/leaderboard/client.js`), or the fake
    one with `?board=fake`.
  - Until `src/leaderboard/config.js` names a Firebase project it's off (`enabled: false`), and
    the UI shows nothing of it.
  - Dev runs (`debug`, `seed`, `real`, `stub` or `tick` in the URL) read it but get
    `canSubmit: false`.
  - Entry rules live in `src/leaderboard/entries.js` and match `firestore.rules`. Failures
    reject with an Error carrying a `kind`.

## Units and axes
- Meters and seconds. Y is up.
- **Yaw** 0 faces −Z (a Three.js camera's default), and positive yaw turns left.
  `math.js#yawTo(a, b)` gives the yaw from a to b.
- **Floors:** `basement` y=−3, `ground` y=0, `upstairs` y=3, `attic` y=6 (recommended; World
  reports the real values in `world.floors`).
- **Bodies:** `PLAYER_BODY` (radius 0.25, standing 1.25 m, crouched 0.7 m, eyes 1.1 m) and
  `DOODLE_BODY` (radius 0.45, catch range 0.9 m).
- **Collision rule:** a collider box blocks a body only when their Y ranges overlap.
  - A crawl tunnel is a box with `minY` 0.8 above the floor, so a crouched player (0.7 m) fits
    under it and a standing one (1.25 m) doesn't.
  - Rugs (`maxY` under 0.05 above the floor) never block.

## The World object (World builds, everyone reads)
- **`colliders(floorId)`:** static boxes plus any currently closed doors. Gameplay collides
  against these.
- **`heightAt(x, z, floorHint)`:** the floor height under a point, including stair ramps, and
  the floor id there. On a ramp it switches floor halfway up.
- **`lightLevelAt(pos, floorId)`:** 0..1, from lamps only. Doodle's sight and the player's
  `visibility()` use it.
- **`nav`:**
  - One grid per floor, with 0.5 m cells.
  - Built with `rasterizeFloor()` from navgrid.js: blockers are static colliders; `holes` are
    stairwells and ball-pit interiors; `marks` add `NAV.DOOR` to doorways and
    `NAV.PLAYER_ONLY | NAV.CRAWL` to crawl spaces.
  - **Links** join the grids (`stairs`, `slide`, `tunnel`). Each has `points` the mover
    follows. Slides are `oneWay`; slides and tunnels are `playerOnly`.
- **`doors`:**
  - `setOpen(open, by)` returns false if the door is locked. Otherwise it animates the door and
    emits `DOOR_OPENED` / `DOOR_CLOSED` plus a door `NOISE`.
  - The front door and the garage door start **locked**.
- **`containers`:** drawers, chests, cabinets, wardrobes. `setOpen` animates and emits.
  `itemSpot` is where an item inside rests. The attic chest starts locked.
- **`anchors`:** every place the other areas need. See the `Anchors` typedef. Highlights:
  - **`spawns[itemId]`:** candidate spots per item. Gameplay picks one per run with its rng.
  - **`hideSpots`:** World builds the prop and tags its mesh `hide`. Gameplay moves the camera
    to `eyePos` / `yaw` and back to `exitPos`.
  - **`traps`:**
    - World builds the fixed `creaky` planks (visibly lighter boards) and the `piano`.
    - The `squeaky` and `blocks` entries are candidate spots; Gameplay places those props per
      difficulty.
  - **`drawings`:** 4 crayon drawing frames, built by World. Gameplay overlays this run's code
    digits on them, one colored digit per drawing.
  - **`frontDoor`, `garage`, `fuseBox`, `atticChest`:**
    - World builds the door, the Jeep, the garage door opener button, the keypad housing and the
      fuse box, and tags them (`keypad`, `jeep`, `opener`, `fuseBox`).
    - Gameplay builds the **padlock** and **plank** hardware (tagged `lock`) and runs all the
      lock logic.
- **`interactables`:** the meshes World tagged with `userData.interact = { kind, id }`. Gameplay
  raycasts them, together with its own item and lock meshes.
- **`validateWorld(world)`** (contracts.js) and **`checkReachability(world)`** (navgrid.js) must
  both return `[]`. World's tests must run them, and so does the coordinator at integration.

## Event protocols

Emit with `EVENTS.X`. `bus.emit` throws on unknown names. If you need a new event, ask the
coordinator.

| Situation | Who emits | Who reacts |
|---|---|---|
| Any sound Doodle could hear | anyone: `NOISE {pos, floorId, loudness, kind}`. `loudness` is the hearing radius in meters | Doodle (investigate), Audio (one-shot sound by `kind`) |
| Player footsteps | Gameplay: `FOOTSTEP` (audio only); sprint steps also emit `NOISE` | Audio |
| Look target changes | Gameplay: `PROMPT {text}` (null hides it) | UI |
| Held item changes | Gameplay: `HELD {itemId, uses}` | UI |
| Pick up / drop | Gameplay: `PICKUP` / `DROP` (+ drop `NOISE`) | Audio; Doodle cancels a fetch if you pick up the ball it's after |
| A lock opens | Gameplay: `LOCK_OPENED {lockId}`; when a whole exit is open, `EXIT_UNLOCKED {route}` and it calls `door.setLocked(false)` | Audio, UI |
| Hide / unhide | Gameplay: `HIDE {spotId, pos, floorId}` / `UNHIDE` | Doodle: if it could see you when you hid, it goes and pulls you out (`CAUGHT {how:'pulledOut'}`) |
| Slide / tunnel | Gameplay: `LINK_ENTER` / `LINK_EXIT` (+ splash `NOISE` on slide landing) | Doodle loses track (it can't follow); Audio |
| Trap stepped on | Gameplay: `TRAP {kind}` + `NOISE` | Audio, Doodle (via the noise) |
| Ball | Gameplay: `BALL_THROWN`, then `BALL_LANDED {pos, floorId}` + `NOISE` | Doodle goes to fetch. When it reaches the ball, `BALL_FETCHED` (Gameplay removes its ball). Later Doodle drops it at `kennelBed`: `BALL_RETURNED {pos, floorId}`, and Gameplay respawns the ball there |
| Treat | Gameplay: `TREAT_DROPPED {treatId, pos, floorId}` | Doodle walks over and eats it: `TREAT_EATEN {treatId}`, and Gameplay removes the treat. Dropped treats can't be picked back up |
| Dart | Gameplay: `DART_FIRED {origin, dir, range}`; it draws the dart | Doodle does a ray-vs-`bounds()` test. On a hit: `DOODLE_HIT`, stuns itself, `DOODLE_STUNNED {seconds}`, then `DOODLE_RECOVERED` |
| Jeep starts | Gameplay: `JEEP_STARTED` + a very loud `NOISE` | Doodle, Audio |
| Escape | Gameplay: `ESCAPED {route}` | main.js (escape cutscene, win screen) |
| Esc / pointer-lock lost | Gameplay: `PAUSE_REQUEST` | main.js (pause screen) |
| Doodle state changes | Doodle: `DOODLE_STATE {state, prev}`, `SPOTTED`, `LOST_TRACK` | Audio (growl, stinger, music), UI |
| Caught | Doodle: `CAUGHT {how}`, once | main.js (freeze, cutscene, next day or game over) |
| Doors / containers | World: `DOOR_OPENED`, `DOOR_CLOSED`, `CONTAINER_OPENED`, `CONTAINER_CLOSED` (+ `NOISE`) | Audio |
| Run flow | main.js: `RUN_START`, `DAY_START`, `WON`, `GAME_OVER`, `PAUSED`, `RESUMED` | anyone |
| Settings | UI: `SETTINGS_CHANGED {settings}` | main.js (quality, volume), Gameplay (sensitivity, touch sensitivity, invert Y) |
| Input mode flips (touch / mouse+keyboard) | main.js's watcher (`src/core/device.js`): `INPUT_MODE {mode}` | Gameplay (touch controls, no pointer lock), UI (touch wording, layout, menus), main.js (rotate overlay) |

Doodle opens doors by calling `door.setOpen(true, 'doodle')` when its path crosses a closed,
unlocked door's cells.

## Run flow (main.js)
```
title → createWorld/createGameplay/createDoodle → for each day:
  freeze → gameplay.startDay(day) → doodle.reset(kennel, {wakeDelay: 8}) → ui.showDayCard → cutscenes.playWake
  → DAY_START → unfreeze (controls on, doodle active)
CAUGHT  → freeze → gameplay.onCaught() → playCatch → next day   (day 5: playGameOver → ui.showGameOver → title)
ESCAPED → freeze → playEscape → ui.recordTime → ui.showWin (offers to post the time) → title
PAUSE_REQUEST → freeze → ui.showPause → resume (unfreeze) | quit (title)
```
- **Phones and tablets:** `src/core/device.js` decides the input mode (touch when the primary
  pointer is coarse or a finger touches; desktop on a key press or real mouse movement), and
  `getInputMode()` reports it. On a narrow portrait touch screen main.js shows the "rotate your
  phone" overlay from index.html and pauses.
- **"Freeze"** means:
  - `gameplay.setControlsEnabled(false)` and `exitPointerLock()`.
  - `doodle.setActive(false)`.
  - The HUD is hidden.
- **Every frame**, main.js calls `gameplay.update`, `doodle.update` and `world.update` (all
  except while paused), plus `audio.update` and `ui.update`. Then it renders.
- **Cutscenes** move the camera and `doodle.model.object3d` while controls are frozen. main.js
  keeps rendering.

## Co-op (two players online)

One player hosts and sends an invite link (`?join=CODE`); the other joins, and both play one
run against one Doodle.

**Catch rules.** The host picks one in the co-op menu (`COOP_RULES`):
- **`shared`:** any catch ends the day for both players.
- **`knockout`:** the caught player drops their item and watches through the partner's eyes.
  - If the partner is caught too, the day ends for both.
  - If the partner escapes, the run is won for both.
  - Both wake up at the next day.

**Either player walking out of an open exit wins for both.**

### Transport and protocol (`src/net/`, coordinator)
- **Transport.** Firebase Realtime Database over REST: `fetch` for writes, `EventSource` to hear
  changes.
  - The database URL is in `src/net/config.js`. Empty means co-op is off.
  - With `?net=local`, two tabs of one browser play through `localStorage` and need no server.
  - The rules are in `database.rules.json`.
- **Room layout.** See `room.js`.
  - The host writes `rooms/CODE/h`, and the guest writes `rooms/CODE/g`.
  - Each side listens only to the other's half.
- **Traffic.** See `protocol.js`.
  - **Latest-wins channels:** `pose` (both sides, ~10 Hz), plus `doodle` (~10 Hz) and `state`
    (on change), both written by the host.
  - **An ordered message list:** `hello`, `start`, `bus`, `intent`, `flow`, `ping`/`pong`, `bye`.
- **`session.js`** wraps it all as `hostRoom()` / `joinRoom()` → a Session with `set`, `send`,
  `tick`, `on` and `close`.
- **Areas never touch the net layer.** main.js wires it to the hooks below.

### Who runs what
- **The host's game is the authority.**
  - It runs Doodle's brain, Gameplay's rules (items, hands, locks, keypad, traps, treats, ball,
    darts) and the doors and containers.
  - It decides every catch, using the guest's latest pose.
- **The guest's game mirrors the host's.**
  - It builds the same run from the same `{seed, difficulty}`. Layout, spawns, code and traps
    come from rng forks, so they match without being sent.
  - Its Doodle is a **puppet**.
  - Its Gameplay applies the host's snapshots and sends its actions as **intents**.
- **Each game moves its own player.** Movement stays instant, and the pose goes to the partner.

### What each area provides (all additive; solo play must behave exactly as before)
- **Gameplay** (`createGameplay({..., coop: {role, rule}})`):
  - **`player.id`** is the role. **`remote`** is the partner, as a Player built from
    `setRemotePose()` and drawn as an avatar with a flashlight. **`pose()`** is the local
    player's pose.
  - **Host:**
    - **`snapshot()`:** plain JSON of every shared thing, including each player's hand.
    - **`applyIntent('guest', intent)`:** runs the guest's action against a proxy of the remote
      player. It's the same rules code, with a per-player hand.
    - **Traps** arm and fire per player body.
    - **Ball and dart** simulation runs here.
  - **Guest:**
    - **`setIntentSink(fn)`:** `primary`, `secondary`, drop and taps become intents. Prompts
      still come from `describe()` against the mirrored state.
    - **`applySnapshot(snap)`:** idempotent and silent. Doors and containers use
      `setOpen(open, 'remote', {silent: true})`, and it emits `HELD` when the local hand
      changes.
    - **Events:** emits only its own body's events (`FOOTSTEP` and its `NOISE`, `HIDE`/`UNHIDE`,
      `LINK_*`).
  - **Wake spot:** the guest wakes at `anchors.startBed2`, or beside `startBed` if there isn't
    one.
  - **`setDown(id, down)`** is for knock-out.
  - **Replays:** ignore any event with `remote: true`. State never arrives that way.
- **Doodle:**
  - **`update(dt, players)`** takes a Player or an array.
    - It senses each player, hunts the best-sensed one, and skips `down` ones.
    - It keeps scent, hide and link state per `playerId`.
    - `CAUGHT` carries `playerId`.
  - **`snapshot()`** and **`releaseCatch(id)`** are for knock-out.
  - **`createDoodle({..., puppet: true})`** follows `applySnapshot()` with interpolation, emits
    nothing and runs no AI.
  - **Remote events:** reacts to the guest's `NOISE`/`HIDE`/`LINK_*`, which are replayed with
    `playerId: 'guest', remote: true`.
- **World:**
  - `door.setOpen(open, by, {silent})` and `container.setOpen(open, by, {silent})`.
  - An optional `anchors.startBed2` (the top bunk).
- **Presentation:**
  - **Title, lobby and messages:**
    - The title's "Play with a friend" resolves `showTitle()` with `{coop: CoopChoice}`.
    - `showLobby(info) → LobbyHandle` and `showMessage(text)`.
    - Notices come from `PLAYER_DOWN`, `PARTNER_JOINED`/`PARTNER_LEFT` and `NET_STATUS`.
    - The knock-out "Spectating NAME" banner.
  - **Win and leaderboard:** `showWin(results.coop)` and co-op leaderboard tabs.
  - **Partner sounds:** positional, for payloads with `remote: true` or a non-local `playerId`
    that carry a `pos`.
  - **HUD:** fed only by the local player.
  - **Cutscene:** `playCatch({knockout: true})` ends on the lick, without the fade.

### Events across the wire
- **`protocol.js#FORWARDED` lists what each side forwards.**
  - The host forwards everything the guest should hear.
  - The guest forwards only its body's events.
- **Replays arrive with `remote: true` and the sender's `playerId`.**
  - Game logic ignores them; the exception is the host's Doodle, which reacts to the guest's
    senses.
  - Audio and UI treat them as normal, positioned at `pos`.
- **Run flow never travels as bus events.** The host's main.js sends `flow` messages for day
  start, catches and escapes, and the guest's main.js follows them.
- **New events:** `PLAYER_DOWN`, `PLAYER_UP`, `PARTNER_JOINED`, `PARTNER_LEFT`, `NET_STATUS`
  (main.js emits these) and `KEYPAD_ROLLED` (Gameplay).

### Testing co-op without a server
1. Serve the game.
2. Open `/?debug=1&net=local` in one tab and host from the title.
3. Open the invite link in a second tab.

## Running things
- **All tests:** `npm test` (Node's built-in runner, no dependencies). Put yours in
  `tests/<area>/*.test.js`.
- **No dependencies, ever.** No `npm install`. Three.js is vendored at `vendor/three/`.
  - Import `three` in browser code only.
  - **Pure logic** (AI brain, senses, scent, A*, items, locks, layout data) takes plain
    `{x, y, z}` objects and must never import `three`, so Node can test it.
  - Keep three-dependent code (meshes, textures, lights) in separate files.
- **Serve:** `node tools/serve.mjs <port>`, or use the launch configs in `.claude/launch.json`
  (`game` 8080, `world-dev` 8081, `doodle-dev` 8082, `gameplay-dev` 8083,
  `presentation-dev` 8084). Use your own port so parallel sessions don't collide.
- **Dev page:** copy `dev/template.html` to `dev/<area>.html`. It boots the stub world (the
  mini-house fixture) and the stub player, so you can see your piece alone.
- **The mini-house fixture** (`src/core/fixtures/mini-house.js`) is a tiny but complete World:
  - Two floors and stairs.
  - A crawl tunnel and a slide.
  - Locked front and garage doors.
  - Containers, hide spots, traps, drawings and lamps.

  Doodle and Gameplay test against it.

## Changing the contract
Contracts are **frozen** while workers run.

1. If you need a change, message the coordinator with the exact addition you want and why.
2. The coordinator makes it on `main`, keeping it additive (new optional fields, new events, new
   constants, never renames), and tells every worker.
3. Bring it into your branch with the `sync_with_base_branch` tool (or `git merge main`).

Until then, work around it inside your own files, and list the workaround in your final report.

## Done means
1. `npm test` passes, including your new tests.
2. Your dev page loads with **no console errors** and shows your piece working.
3. The full game still boots with your area forced real: `/?debug=1&real=<area>`.
4. `src/<area>/README.md` explains:
   - How your area works.
   - Its tuning knobs (`tuning.js`).
   - Its debug hooks.
5. Everything is committed on your branch: not pushed, not merged.
6. A short final report:
   - What you built.
   - What you didn't.
   - Assumptions you made about other areas.
   - Any contract changes you wish for.
