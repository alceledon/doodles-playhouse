# UI and cutscenes (Presentation)

Entry points in [index.js](index.js):

- `createUI({ root, bus })`: menus, cards and the HUD. All its DOM goes inside `root`.
- `createCutscenes({ camera, getScene, ui, bus })`: camera moves and overlays between days.

Styles live in [ui.css](ui.css), injected once with a `<link>`. `showTitle()` waits for the
stylesheet to load, so nothing ever flashes unstyled. No web fonts, images or network requests:
the crayon lettering, icons and doodles are all drawn on canvas.

## Files

| File | What it does |
|---|---|
| [index.js](index.js) | `createUI` (settings, HUD, screens) and a re-export of `createCutscenes`. |
| [screens.js](screens.js) | Title, How to Play, Settings, the DAY N card, pause, win and game over. |
| [hud.js](hud.js) | The center dot and hand, the prompt line, the held item, the stamina bar, lock toasts and the vignette. |
| [cutscenes.js](cutscenes.js) | `playCatch`, `playGameOver`, `playEscape` and `playWake`. |
| [crayon.js](crayon.js) | Procedural crayon strokes, lettering and the taped-up drawing of Doodle. |
| [glyphs.js](glyphs.js) | Pure data: the hand-made stroke font (A–Z, 0–9, `' ! . , ? - :`). |
| [icons.js](icons.js) | Pixel-art icons for every `ItemId` (32×32, crisp alpha) and the interact hand. |
| [settings.js](settings.js) | Pure: settings sanitizing, `localStorage` persistence and best times. Storage is passed in. |
| [text.js](text.js) | Pure: every player-facing string, `formatTime` and `daysLeftText`. |
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
  - "How to Play" and "Settings" open over it.
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
- **Game over:** "DOODLE HAS A NEW CHEW TOY." with difficulty and time.
- **End screens appear opaque at once and fade in only their content.** They follow a cutscene
  that ends on black, so the house never flashes between the two.
- **`recordTime(difficulty, seconds)`:** keeps the best time per difficulty in
  `doodles-playhouse.best.v1`. It returns true for a new record; a tie doesn't count.

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
  4. Fade to black.
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
- **`toastSeconds`** and **`screenFade`**.
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
    slider, and every toast.
- **Extras on the UI object** (not in the contract):
  - `layer` (cutscenes draw into it)
  - `hud`
  - `openSettings()`
  - `openHowTo()`
  - `changeSettings(patch)`
  - `bestTimes()`
