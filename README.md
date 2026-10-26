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

## How it's built
- Plain ES modules and Three.js with no build step. GitHub Pages serves the repo root as is.
- All models, textures and sounds are generated in code.
- Docs:
  - [docs/DESIGN.md](docs/DESIGN.md): the game design.
  - [docs/CONTRACTS.md](docs/CONTRACTS.md): how the code areas (World, Doodle, Gameplay,
    Presentation) fit together.
