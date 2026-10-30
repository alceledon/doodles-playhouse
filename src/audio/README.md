# Audio (Presentation)

Every sound in the game is synthesized with Web Audio. There are no audio files and no network
requests. Entry point: `createAudio({ bus, camera })` in [index.js](index.js).

## How it works

| File | What it does |
|---|---|
| [index.js](index.js) | Wires bus events to sounds, keeps the HRTF listener on the camera, and runs Doodle's sounds and the score every frame. |
| [engine.js](engine.js) | The Web Audio graph: context, mix buses, a generated house reverb, the listener, and `play()` for one-shots. |
| [synth.js](synth.js) | `VOICES`: every sound as a small synth recipe, built from oscillators, noise, filters and envelopes. |
| [doodle.js](doodle.js) | Doodle's continuous sounds, scheduled ahead of time from its `state` and `speed`. |
| [music.js](music.js) | The music-box lullaby, the drone and the heartbeat. |
| [soundmap.js](soundmap.js) | Pure data: which event or `NOISE` kind plays which voice. |
| [curves.js](curves.js) | Pure math: distance and floor attenuation, rhythm rates, heartbeat, tension. |
| [melody.js](melody.js) | The lullaby: an original 8-bar waltz in A minor. |
| [cues.js](cues.js) | A hook that lets `src/ui/` cutscenes play timed sounds without main.js passing the Audio object. |

- **The mix graph:**
  - Voices go through a distance gain, a lowpass for sounds from other floors, and an HRTF
    panner into the `sfx` bus.
  - A reverb send rises with distance.
  - The `sfx`, `music` and `heart` buses go into the master gain (the volume setting), then a
    duck gain, then a pause lowpass, then a limiter.
- **Distance is done in our code, not by the panner.** The panner only pans
  (`rolloffFactor = 0`). `curves.distanceGain` sets the level, so distances and floor muffling
  behave the same everywhere and can be tested.
- **Unlocking:** the context is created on the first user gesture: any `pointerdown`, `keydown`
  or `touchend`, or `unlock()`.
  - Before that, `update()` and `play()` do nothing.
  - `unlock()` won't create a context before the page has had a gesture, so the browser never
    logs an autoplay warning.
- **Randomness:** pitch and timing jitter use a seeded cosmetic RNG (`createRng('doodle-audio')`),
  never `Math.random`. Audio never touches the run's RNG.

## Sound list

**Doodle.** These sounds follow Doodle and play through one positional emitter at its head.

- **`jingle`:** collar tag and bell clinks.
  - One per stride. The rate comes from `doodle.speed` (`curves.jingleInterval`), and it gets
    louder at a run.
  - It's audible to 30 m and through floors, muffled. **It's the player's main warning.**
  - A head-shake jingle now and then while Doodle stands still.
- **`pant`:** whenever Doodle is awake. Faster and louder with speed, fastest in a chase.
- **`snore`:** while Doodle is in `sleep`.
- **`sniff`:** while Doodle is in `sniff`, `investigate` or `search`.
- **`bark`:** random distant barks every 12–30 s while Doodle is in `patrol` or `search`. They
  only play when Doodle is more than 6 m away, so a bark never sounds like "it saw you".
- **`growl`:** on `SPOTTED`, plus `chaseStinger` in your head.
- **`barkSting`:** on `CAUGHT`. A huge close bark over a sub hit and a dissonant stab.
- **`yawn`** then a `jingle`: when Doodle leaves `sleep`, meaning "it's awake".
- **`huff`:** on `LOST_TRACK`.
- **`yelp`:** on `DOODLE_HIT`.
- **`chew`:** while stunned (it gnaws the squeaky dart).
- **`munch`:** on `TREAT_EATEN`.
- **`jingle`:** on `BALL_FETCHED` and `DOODLE_RECOVERED`.
- **`lick`:** only played by the catch cutscene.

**Score**

- **Music-box lullaby (`musicNote`):** plays on the title screen and in game.
  - It's always slightly out of tune.
  - As **tension** rises (Doodle near or alert, and fully in a chase), it detunes harder,
    slows down like it's running out of wind, and drops notes.
  - It ducks under a chase.
- **Drone:** two beating saws plus a flat fifth through a slowly breathing lowpass, plus a dark
  room tone. In game only. It gets louder and brighter with tension.
- **`heartbeat`:** rises from about 66 to 150 bpm as Doodle closes within 14 m.
  - A chase pins it high.
  - Another floor damps it.
  - A sleeping Doodle doesn't count.
- **`windup`:** on `DAY_START`. The lullaby then restarts.
- **`toll`:** from the day card.
- **`musicBoxDie`:** on `GAME_OVER`.
- **`escapeChime`:** on `WON`.
- **`exitUnlocked`:** on `EXIT_UNLOCKED`.
- **`crickets`:** from the escape cutscene.

**World `NOISE` kinds** (positional, audible out to `loudness × 2.5` m, clamped to 10–45 m)

| kind | voice | kind | voice |
|---|---|---|---|
| `door` | `doorCreak` (and `doorLatch` on `DOOR_CLOSED`) | `blocks` | `blockClatter` |
| `container` | `drawer`, or `lidCreak` for chests, cabinets and wardrobes | `splash` | `ballPitSplash` |
| `squeak` | `squeak` | `jeep` | `jeepEngine` |
| `creak` | `plankCreak` | `ball` | `ballBounce` |
| `piano` | `toyPiano` (a few clashing keys) | `dart` | `dartPop` |
| `drop` | `dropThud` | `tv` | `tvStatic` (see the contract wish below) |
| `step` | nothing: `FOOTSTEP` plays steps | anything else | `thump` |

**The player**

| Event | Sound |
|---|---|
| `FOOTSTEP` | `footstep`: sprint is louder and heavier, crouch is nearly silent, `carpet`/`rug` surfaces are duller |
| `PICKUP` | `pickup` |
| `LOCK_OPENED` | `unlock` |
| `KEYPAD_ROLLED` | `keypadClick`: three ratchet ticks and a plastic pip pitched by `digit` |
| `HIDE` / `UNHIDE` | `rustle` |
| `LINK_ENTER` | `whoosh` (slide) or `crawl` (tunnel) |
| `BALL_THROWN` | `whoosh` |
| `DART_FIRED` | `launch` |
| `TREAT_DROPPED` | `crinkle` |
| `PAUSED` | muffles and ducks the whole mix (`RESUMED` restores it) |

**Co-op: the partner's sounds**

- **Whose event is it?** `soundmap.isPartnerPayload(payload, localId)`:
  - A `playerId` decides: it's the partner's when it isn't the local player's id (`player.id`
    from `update()`, `'host'` until then).
  - Without a `playerId`, a replay (`remote: true`) is the partner's.
  - A solo run never has either, so nothing changes there.
  - Your own action replayed back by the host (`playerId` = yours) still plays as yours.
- **The partner's events never play in your head** (`partnerCues`):
  - An in-head cue moves to `at: 'partner'`. It plays at `payload.pos` (or a dart's `origin`),
    else at the partner's chest (`ctx.remote`, `partner.chestHeight` up). It's audible to
    `partner.range` (16 m) and muffled through floors like anything else.
  - With neither a position nor `ctx.remote`, it stays silent.
  - This covers `PICKUP`, `HIDE`/`UNHIDE`, `LINK_ENTER`, `KEYPAD_ROLLED`, `LOCK_OPENED`,
    `BALL_THROWN` and `DART_FIRED`.
  - Their `FOOTSTEP`s play at the step's `pos` to `partner.footstepRange` (14 m).
  - Their `NOISE`s are already positional and play as usual.
- **Kept in your head on purpose** (`partnerAt: null`): the chase stinger, `exitUnlocked`,
  `windup`, `escapeChime` and `musicBoxDie`. They're music, or a warning that's about both of
  you.
- **The partner's `CAUGHT`** barks from Doodle (`partnerAt: 'doodle'`), and it doesn't mute
  the lullaby, since your run goes on.
- **Doodle's, doors' and world sounds** replayed from the host keep their own positions.
- **One listener, the camera.** The heartbeat, the tension and the collar jingle are all
  measured from it, so they're about what you see and hear. While you're knocked out and
  watching through the partner's eyes, the listener's floor is theirs (`listenerFloor`), so
  floor muffling matches the view.

**Cutscenes** (via [cues.js](cues.js)): `thud`, `bark`, `lick`, `growl`, `rustle`, `chew`,
`jeepEngine` (driving), `crickets`, `gasp`.

## Tuning knobs ([tuning.js](tuning.js))

- **`buses`:** levels for sfx, music, heartbeat and the reverb return.
- **`oneShot`:** the distance curve for world noises, and how a `NOISE`'s `loudness` maps to the
  distance you can hear it.
- **`floors`:** gain and lowpass cutoff per floor between you and a sound.
- **`doodle`:** where its sounds come from (`headHeight`), its distance curve (`range` 30 m), and
  the rate and level of jingle, pant, snore, sniff, bark and chew.
- **`heartbeat`:** near and far distances, bpm range, the chase floor, and the other-floor damping.
- **`tension`:** the distances and alert floor that drive the lullaby detune and the drone.
- **`music`:**
  - Tempo and gains (title, game, chase).
  - Detune depth, wind-down and missed-note chance.
  - Drone level and cutoff.
- **`footsteps`:** walk, sprint and crouch levels.
- **`partner`:** how far away the co-op partner's sounds carry (`range`, `footstepRange`), and
  how high on their body a sound without a position comes from (`chestHeight`).
- **`pause`:** how much the mix is muffled while paused.
- **`trim`:** per-voice level trims. To set them:
  1. Render every voice offline: use the dev page's **measure all voices** button, or call
     `audio.measure(id)`.
  2. Compare the loudest 50 ms.
  3. Aim for stingers and impacts around −6..−9 dBFS, world noises around −15..−20, and breaths
     and small player sounds around −24..−30.

## Debugging

- **Dev page:** `/dev/presentation.html`, served by the `presentation-dev` launch config on
  port 8084.
  - **Sound board:** a button for every voice. Play it "in head", at a position, at Doodle, or
    on another floor.
  - Emit every `NOISE` kind and every mapped event.
  - **measure all voices:** renders each voice offline and lists its level, flagging clipping or
    near-silence.
  - **fake orbiting Doodle:** set its distance, speed, state and floor to hear the jingle,
    panting, heartbeat and tension respond.
  - **Co-op → partner sounds:** a fake partner 3 m to your left (`ctx.remote`) walks, picks up,
    hides, rolls the keypad and so on, replayed with `remote: true`. Compare them with your own
    `KEYPAD_ROLLED` and `PICKUP`, which still play in your head.
- **Extras on the returned object** (not in the contract):
  - `play(id, opts)`
  - `voices`
  - `measure(id)`
  - `state`: context state, tension, heartbeat, Doodle's distance and floors
  - `engine`
