# Doodle's Playhouse: project rules

A Granny-style first-person horror game in the browser (Three.js, no build step, no
dependencies). The game design is in [docs/DESIGN.md](docs/DESIGN.md). How the code areas fit
together is in [docs/CONTRACTS.md](docs/CONTRACTS.md). **Read both before writing code.**

## How work is split (this overrides the global "commit and push to main" rule)
- **Coordinator:** this project uses one coordinator session plus four worker sessions (World,
  Doodle, Gameplay, Presentation).
  - It owns `src/core/`, `src/main.js`, `src/areas.js` and the repo plumbing (see the ownership
    table in CONTRACTS.md).
  - It is the only session that merges into `main` or pushes.
- **Worker sessions** each run in their own git worktree and branch:
  - Only create and edit the files your area owns.
  - Commit to your own branch. **Do not push, do not merge into `main`, do not open PRs.**
  - Need a change in `src/core/` or another area? Message the coordinator instead of editing
    it.
- **The contract is frozen.** Shapes, events and grid rules live in `src/core/contracts.js`,
  `src/core/events.js` and `src/core/navgrid.js`. Only the coordinator changes them, and only
  additively.

## Code rules
- **No dependencies and no `npm install`.** Three.js is vendored at `vendor/three/`. It's
  imported as `three` through the import map in the browser only.
- **Pure logic never imports `three`.** That covers AI, nav, scent, items, locks and layout
  data. It uses plain `{x, y, z}` objects so `node --test` can run it.
- **Randomness that affects a run** comes from the `rng` passed in, never `Math.random()`.
- **Emit events only via `EVENTS.X`.**
- **Match the surrounding style:** ES modules, 2-space indent, single quotes, short comments
  that explain why.

## Commands
- **All tests:** `npm test`. Run before every commit.
- **Serve:** `node tools/serve.mjs <port>`, or a `.claude/launch.json` config: `game` 8080,
  `world-dev` 8081, `doodle-dev` 8082, `gameplay-dev` 8083, `presentation-dev` 8084.
- **Full game with debug overlay:** `http://localhost:8080/?debug=1`
  - Add `&real=<area>` to load your area instead of its stub.
  - Add `&difficulty=normal` to skip the title screen.
  - Add `&seed=N` for a fixed run.
