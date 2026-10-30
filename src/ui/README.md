# UI and cutscenes (Presentation)

Entry points in [index.js](index.js):

- `createUI({ root, bus, leaderboard, coop })`: menus, cards and the HUD. All its DOM goes inside
  `root`. `leaderboard` is optional (`src/leaderboard/`); without an enabled one there's no
  leaderboard UI. `coop` is `{enabled, code?}`; without `enabled` nothing co-op shows and solo
  play looks exactly as before. An extra `debug` option (default: `?debug` in the URL) turns on
  the co-op lag readout.
- `createCutscenes({ camera, getScene, ui, bus })`: camera moves and overlays between days.

Styles live in [ui.css](ui.css), injected once with a `<link>`. `showTitle()` waits for the
stylesheet to load, so nothing ever flashes unstyled. No web fonts, images or network requests:
the crayon lettering, icons and doodles are all drawn on canvas.

## Files

| File | What it does |
|---|---|
| [index.js](index.js) | `createUI` (settings, HUD, screens) and a re-export of `createCutscenes`. |
| [screens.js](screens.js) | Title, How to Play, Settings, the DAY N card, pause, win and game over. |
| [coopscreens.js](coopscreens.js) | Co-op: the "Play with a friend" menu, the lobby and the OK message box. |
| [coop.js](coop.js) | Pure: co-op words, name and code checks, the lobby's status line, and the notice state machine. |
| [notices.js](notices.js) | Co-op notices over the game: toasts, the "Spectating" and "Waiting" banners, the debug lag readout. |
| [hud.js](hud.js) | The center dot and hand, the prompt line, the held item, the stamina bar, lock toasts and the vignette. |
| [cutscenes.js](cutscenes.js) | `playCatch`, `playGameOver`, `playEscape` and `playWake`. |
| [crayon.js](crayon.js) | Procedural crayon strokes, lettering and the taped-up drawing of Doodle. |
| [glyphs.js](glyphs.js) | Pure data: the hand-made stroke font (A–Z, 0–9, `' ! . , ? - :`). |
| [icons.js](icons.js) | Pixel-art icons for every `ItemId` (32×32, crisp alpha) and the interact hand. |
| [settings.js](settings.js) | Pure: settings sanitizing, `localStorage` persistence, best times and the leaderboard name. Storage is passed in. |
| [text.js](text.js) | Pure: every player-facing string, `formatTime`, `formatTimeTenths` and `daysLeftText`. |
| [motion.js](motion.js) | Pure: easing, paths, the wake blink curve, free-space checks against colliders, and the HUD's vignette and stamina values. |
| [dom.js](dom.js) | Small DOM helpers and `tween()`, a requestAnimationFrame timeline. |

## Screens

- **Title:**
  - "DOODLE'S PLAYHOUSE" in crayon, with a slow wobble.
  - The two O's in DOODLE are googly eyes that follow the cursor.
  - Eyeshine blinks in the dark corners, and a crayon drawing of Doodle is taped to the corner,
    scribbled on.
  - Four difficulty cards, each with a one-line description and the best time if there is one.
    Clicking a card resolves `{ difficulty }`.
  - "How to Play" and "Settings" open over it, and so does "Leaderboard" when `createUI` got
    an enabled leaderboard.
- **Leaderboard** (only with an enabled `leaderboard`):
  - Tabs for the four difficulties. It opens on the one last played this session, else Normal.
  - The top 10 for the selected tab: rank, name, time in tenths (`formatTimeTenths`, e.g.
    "5:12.4"), days used and the way out (Door or Jeep). Tied times share a rank.
  - Loading, error ("Couldn’t reach the leaderboard." and Retry) and empty states. A slow
    answer for a tab you've left is dropped.
  - Esc or Back closes it. On a short screen the rows tighten and the screen scrolls.
- **Settings:**
  - Mouse sensitivity (0.2–3), invert Y, volume (plays a jingle at the new level), and quality
    low/medium/high.
  - Every change is sanitized, saved to `localStorage` (`doodles-playhouse.settings.v1`) and
    emitted as `SETTINGS_CHANGED`.
  - `ui.settings` is changed in place, so anyone holding it sees the update.
  - Esc closes it.
- **Day card:**
  - A black screen with a crayon "DAY N" and "N days left". Day 5 shows "Last chance" in red.
  - A bell tolls.
  - The screen stays black until it resolves, so the wake blink takes over without a flash.
- **Pause:** Resume, Settings, How to Play and Quit to title. Resolves `'resume'` or `'quit'`.
- **Win:** "YOU ESCAPED!", the route, days used, time, best time and a "New best time!" badge.
  With an enabled leaderboard, a box under the stats (beside them on a phone on its side):
  - **Test runs** (`canSubmit` false) only get a note: "Test runs don’t go on the leaderboard."
  - **Runs under a minute** get no box.
  - **Otherwise** there's a name field and "Post my time" (Enter or the keyboard's Send works
    too).
    - The name field is prefilled with the last name used (`doodles-playhouse.name.v1`) and
      cleaned as you type (A–Z and 0–9, at most 6). A blocked name says why inline.
    - On a desktop the field takes focus; on touch it doesn't, so the keyboard stays down.
    - While sending, the button reads "Sending…". On success it shows "You’re #N on Normal!"
      and the top 10 with your row highlighted, or the top 10, a "…" row and your own row.
    - A failure shows the reason and Retry. A run is posted at most once.
  - "Back to title" never waits on the network.
  - The field opts back into text selection and touch (`user-select: text`,
    `touch-action: manipulation`), which the page shell turns off. Gameplay's keys and the
    input-mode watcher ignore keys typed into it.
- **Game over:** "DOODLE HAS A NEW CHEW TOY." with difficulty and time.
- **End screens appear opaque at once and fade in only their content.** They follow a cutscene
  that ends on black, so the house never flashes between the two.
- **`recordTime(difficulty, seconds)`:** keeps the best time per difficulty in
  `doodles-playhouse.best.v1`. It returns true for a new record; a tie doesn't count.

## Co-op (only with `coop.enabled`)

- **Title:** a "Play with a friend" card under the difficulty cards opens a menu over the title:
  - **Host a game:** your name → a difficulty card → a catch rule (Shared or Knock-out, one line
    each). The last tap resolves `showTitle()` with `{coop: {role: 'host', name, difficulty, rule}}`.
  - **Join a game:** your name and the 6-letter room code → `{coop: {role: 'join', name, code}}`.
    The code field keeps only code letters as you type (no 0/O or 1/I/L), and pasting a whole
    invite link fills in its code.
  - Names are cleaned like the leaderboard's (`entries.js#cleanName`, checked with `nameProblem`),
    and codes with `room.js#cleanCode`. The name is remembered in `doodles-playhouse.name.v1`,
    the same key the win screen uses.
  - Back or Esc steps back; from the first step it closes the menu and the title stays up.
  - **`coop.code`** (an opened `?join=` link): the first title opens straight on Join with the
    code filled in, focused on whatever still needs typing.
- **`showLobby(info)` → `{update, result, close}`:**
  - The room code in big crayon letters.
  - The host gets the invite link with **Copy** (clipboard, else it selects the link), plus
    **Share** where `navigator.share` exists.
  - Both names, the difficulty and the rule, and a status line: "Waiting for your friend…",
    "BO is here. Press Start…", "Waiting for AL to start…", or `update({status})`.
  - The host's **Start** is enabled once `partnerName` is set. The guest only has **Cancel**.
    Esc cancels.
  - Choosing Start or Cancel resolves `result` and closes the lobby. **`close()` from main.js
    leaves `result` unsettled**, so race it against your own "host started" signal.
  - On a phone on its side the code and link sit beside the names, so nothing scrolls.
- **`showMessage(text)`:** the text and OK. OK, Enter or Esc resolves it.
- **Notices** (notices.js, drawn over the game, so they show while the HUD is hidden):

  | Event | Shows |
  |---|---|
  | `PARTNER_JOINED {name}` | "BO joined" (and remembers the name) |
  | `PARTNER_LEFT {name, reason}` | "BO left" ("BO lost connection" for `timeout`); clears both banners |
  | `PLAYER_DOWN {local: false}` | "Doodle caught BO!" |
  | `PLAYER_DOWN {local: true}` | the "Spectating BO" banner (BO = the partner), until `PLAYER_UP {local: true}` or the next day card |
  | `NET_STATUS {status: 'waiting'}` | the "Waiting for BO…" banner, until `status: 'ok'` |
  | `NET_STATUS {lagMs}` | in debug, "lag 120 ms" in the bottom-left corner |

  The partner's name also comes from the lobby's `partnerName`.
- **Win:** with `results.coop` the stats show both names and the rule instead of the solo best.
  The host (`coop.canPost`) gets **Post our time**, which calls
  `leaderboard.submit({name, name2, seconds, days, route, difficulty, coop: rule})` and then shows
  the place and that co-op board's top 10. The guest gets a note that the host can post it.
  Test runs and runs under a minute behave as in solo.
- **Leaderboard panel:** a Solo / Shared / Knock-out row above the difficulty tabs. The co-op
  ones call `top(difficulty, 10, {coop: rule})`, and co-op rows read "AL & BO".
- **HUD:** shows only the local player. A `PROMPT` or `HELD` whose `playerId` isn't the local
  player's is ignored (the local id comes from `update()`'s `player.id`).

## HUD

| Element | Behaviour |
|---|---|
| Center dot | Becomes an open hand while `PROMPT` text is non-null. The prompt line shows under it. |
| Held item | Follows `HELD {itemId, uses}`: the pixel icon, the item name, and a `×N` badge when `uses` isn't null. |
| Stamina bar | Shown only while `player.stamina < 0.995`. Turns red below 0.25. |
| Toasts | Show for `LOCK_OPENED` and `EXIT_UNLOCKED`, e.g. "The padlock clicks open." |
| Vignette | Darkens the edges as Doodle comes within 10 m on your floor, with a red tint in a chase. |

`RUN_START` clears the HUD, and `setHudVisible` shows or hides all of it.

## Cutscenes

Each cutscene runs on its own requestAnimationFrame timeline while main.js keeps rendering.
Cutscenes never overlap: a second call waits for the first.

When a cutscene finishes, it:
- puts the camera back (position, rotation and field of view);
- puts Doodle's model back (transform, `setPose('idle')`, `setMood('calm')`);
- removes and disposes anything it added to the scene.

- **`playCatch`** (about 3.1 s):
  1. You're knocked to the floor, landing with a thud and a white flash. The camera rolls and
     swings round to Doodle.
  2. Doodle pounces into frame with `setPose('pounce')` and `setMood('hunt')`. Its head tips
     down at you and a loud bark shakes the screen as its face fills it.
  3. Three licks (`'lick'` pose), each leaving slobber on the "lens" that drips down.
  4. Fade to black. With `knockout: true` (co-op knock-out) it skips the fade and ends right
     after the licks (about 2.5 s), because the run goes on through the partner's eyes.
- **`playGameOver`** (about 10 s):
  1. The same knockdown and pounce.
  2. In `'drag'` pose, Doodle tugs you backward, tug by tug, toward `anchors.kennel`, along a
     direction checked clear against `world.colliders()`.
  3. Cut to black, then a last look at Doodle in its kennel (`'chew'` pose, a temporary warm
     light).
  4. Fade to the crayon line "Doodle has a new chew toy."
- **`playEscape`** (about 5.2 s):
  - The camera walks out through the door to `exit` and on into the night: stars, a moon, a dark
    lawn and moonlight, with crickets.
  - The garage route rides at Jeep height with headlights and the engine.
  - At the end the view tips up to the sky, then fades to black.
- **`playWake`** (about 1.9 s):
  - Eyelids open heavily, blink, then open fully, while the blur clears.
  - The camera starts lying back looking up at the top bunk, then sits up to exactly where
    Gameplay put it.
  - After a catch (day 2 and later) you gasp.

**Framing:** cutscenes measure Doodle's face from its model's bounding box (the front-top of the
dog), so they frame any model size without knowing its parts.

## Tuning knobs ([tuning.js](tuning.js))

- **`crayon`:** wax passes per stroke, gap chance and paper grain.
- **`dayCard`:** fade-in, hold and fade-out times.
- **`toastSeconds`**, **`noticeSeconds`** (co-op notices) and **`screenFade`**.
- **`hud`:** when the stamina bar hides and turns red, plus the vignette settings:
  - `vignette` turns it on or off.
  - `vignetteNear` / `vignetteFar` set its distances.
  - `vignetteMax` and `vignetteChase` set its strength.
- **`cutscenes`:**
  - Every phase length.
  - Catch: lean, face distance, field of view and roll.
  - Game over: drag distance.
  - Escape: walk and Jeep eye heights, and how far beyond the exit it goes.
  - Wake: how far you lie back.
  - Camera shake.

## Debugging

- **Dev page:** `/dev/presentation.html` (`presentation-dev`, port 8084). It runs the stub world,
  player and Doodle with the real UI, audio and cutscenes, and has buttons for:
  - every menu and every day card;
  - every cutscene: catch → day 2 → wake, game over, both escapes, and wake;
  - a HUD simulator: fake `PROMPT` and `HELD` events, "cycle all items", a stamina override
    slider, and every toast;
  - a **Co-op** section: the co-op menu, the title as an invite link opens it, the host and guest
    lobbies (a friend "joins" after 2.5 s), a message, every notice event, the co-op win (host and
    guest), the leaderboard with co-op tabs (a fake co-op board), the knock-out catch, and partner
    sounds from a fake partner 3 m to your left.
  - Co-op is on there; `?coop=0` turns it off to compare with solo.
- **Extras on the UI object** (not in the contract):
  - `layer` (cutscenes draw into it)
  - `hud`
  - `openSettings()`
  - `openHowTo()`
  - `openLeaderboard(difficulty?)`
  - `notices` (its `state`: partner name, banners, lag)
  - `openCoop(code?)`: the co-op menu alone
  - `setInviteCode(code)`: the next title opens on Join with this code
  - `changeSettings(patch)`
  - `bestTimes()`
