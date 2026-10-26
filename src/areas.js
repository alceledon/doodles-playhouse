// Which areas main.js loads for real (true) vs. as a stub from src/core/stubs/
// (false). All four worker areas were merged on 2026-10-26.
// Force a stub for debugging with ?stub=<area> (e.g. ?debug=1&stub=doodle).
export const REAL_AREAS = {
  world: true, // src/world/index.js     → createWorld
  gameplay: true, // src/gameplay/index.js → createGameplay
  doodle: true, // src/doodle/index.js    → createDoodle
  ui: true, // src/ui/index.js        → createUI, createCutscenes
  audio: true, // src/audio/index.js     → createAudio
};
