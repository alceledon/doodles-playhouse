// Which areas main.js loads for real (true) vs. as a stub from src/core/stubs/
// (false). The coordinator flips an entry when that area is merged into main.
// Workers: don't edit this file. Load your area for real in the full game with
// ?real=<area> (e.g. http://localhost:8080/?debug=1&real=world).
export const REAL_AREAS = {
  world: false, // src/world/index.js     → createWorld
  gameplay: false, // src/gameplay/index.js → createGameplay
  doodle: false, // src/doodle/index.js    → createDoodle
  ui: false, // src/ui/index.js        → createUI, createCutscenes
  audio: false, // src/audio/index.js     → createAudio
};
