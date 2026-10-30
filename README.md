# Doodle's Playhouse

A first-person horror game in the browser, inspired by *Granny*. You're stuck in a colorful
playhouse at night, and **Doodle**, a giant golden doodle, is hunting you. Find the keys and
tools, unlock an exit, and escape within 5 days. Every time Doodle catches you, you lose a day.

**Play:** https://alceledon.github.io/doodles-playhouse/ (mouse and keyboard; Chrome, Edge or
Firefox)

## Controls
| Input | Action |
|---|---|
| Mouse | Look |
| WASD | Move |
| Shift | Sprint |
| C | Crouch |
| Left click / E | Interact |
| Right click | Use held item |
| G | Drop |
| F | Flashlight |
| Esc | Pause |

## Run it locally
ES modules don't load from `file://`, so serve the folder:

```bash
node tools/serve.mjs 8080
```

Then open http://localhost:8080/ (add `?debug=1` for the debug overlay).

## Tests
```bash
npm test
```

There are no dependencies to install. Three.js 0.186.1 is vendored in `vendor/three/` (MIT
license).

## Leaderboard
An online board shared by everyone, one per difficulty, ranked by fastest time. The title
screen's **Leaderboard** button shows each board's top 10, and after an escape the win screen
offers to post your time under a name of up to 6 letters or numbers.

- **How it works:** the game talks to Google Cloud Firestore through its REST API with plain
  `fetch` (no Firebase SDK). The code is in `src/leaderboard/`. The rules in
  [firestore.rules](firestore.rules) let anyone read and add runs, check every field, and
  forbid changing or deleting one.
- **Config:** `src/leaderboard/config.js`, which points at the `doodles-playhouse` Firebase
  project. With an empty `projectId`, the game shows no leaderboard at all.
- **Dev runs can't post:** URLs with `debug`, `seed`, `real`, `stub` or `tick` read the board
  but never post to it.
- **Set it up:**
  1. Create a project in the [Firebase console](https://console.firebase.google.com/).
  2. Add a Firestore database (Build → Firestore Database → Create database) in
     **production mode**.
  3. On its **Rules** tab, paste in `firestore.rules` and publish.
  4. Register a web app (Project settings → General → Your apps → Web). Copy `projectId` and
     `apiKey` from the config it shows into `src/leaderboard/config.js`. The web API key is
     public by design; the rules are what protect the data.
- **Remove a bad entry:** in the console, open Firestore Database → Data, find the run in
  `runs_practice`, `runs_easy`, `runs_normal` or `runs_hard`, and delete the document.
- **Testing:** `?board=fake` swaps in a pretend board kept in your browser's `localStorage`.
  It comes pre-filled with a few runs and accepts posts even in a dev run, e.g.
  `http://localhost:8080/?debug=1&board=fake`.

## Co-op (two players online)
One player picks **Play with a friend → Host a game**, chooses a difficulty and a catch rule, and
sends the invite link (or the 6-letter code). The friend opens the link, types a name, and the
host presses Start. Both play the same run against one Doodle.

**Catch rules:**
- **Shared:** any catch ends the day for both players.
- **Knock-out:** the caught player watches through the other's eyes. The day ends only when both
  are caught. If the other one escapes, you both win.

**How it works:**
- **Authority.** The host's game runs Doodle and everything shared (items, locks, doors, traps).
  The guest's game builds the same house from the same seed, mirrors the host's state, and sends
  its clicks to the host. Each game moves its own player.
- **Relay.** They talk through a Firebase **Realtime Database** in the same Firebase project as
  the leaderboard, using plain `fetch` and `EventSource` (no SDK). The code is in `src/net/`, and
  the rules are in [database.rules.json](database.rules.json).
- **Off by default.** Co-op is off until `src/net/config.js` has a `databaseURL`.
- **Free tier.** On the Spark (free) plan the database allows 100 simultaneous connections, which
  is 50 games at once, and 10 GB of downloads a month. A game uses roughly 25–35 MB an hour.
- **Background tabs.** If the host's tab goes to the background, the game stalls for both players.
  After 20 s of silence it counts as the host leaving.

**Set it up:**
1. In the Firebase console for the `doodles-playhouse` project, create the database:
   Build → Realtime Database → Create database, location `us-central1`, start in **locked mode**.
2. On its **Rules** tab, paste in `database.rules.json` and publish.
3. Copy the database URL shown at the top of the Data tab (like
   `https://doodles-playhouse-default-rtdb.firebaseio.com`) into `src/net/config.js`.
4. Re-publish [firestore.rules](firestore.rules) on the Firestore Rules tab, so the co-op
   leaderboards (`coop_shared_*`, `coop_knockout_*`) accept posts.

**Testing without a server:** `?net=local` plays co-op between two tabs of one browser. Open
`http://localhost:8080/?debug=1&net=local`, host from the title, and open the invite link in a
second tab. The debug overlay shows the room, the lag and who is down. Add `&board=fake` to try
posting a co-op time.

## How it's built
- Plain ES modules and Three.js with no build step. GitHub Pages serves the repo root as is.
- All models, textures and sounds are generated in code.
- Docs:
  - [docs/DESIGN.md](docs/DESIGN.md): the game design.
  - [docs/CONTRACTS.md](docs/CONTRACTS.md): how the code areas (World, Doodle, Gameplay,
    Presentation) fit together.
