// A tiny hook so cutscenes and screens (src/ui/) can play timed sounds without
// main.js handing them the Audio object. The real createAudio() registers
// itself here; with the stub audio loaded, cue() quietly does nothing.

let target = null;

export function setCueTarget(fn) {
  target = fn;
}

/** Play a voice by id (see synth.js VOICES). opts as for engine.play: {pos, floorId, gain, delay, ...}. */
export function cue(name, opts) {
  try {
    return target ? target(name, opts) : false;
  } catch (err) {
    console.error('[audio] cue failed', name, err);
    return false;
  }
}

/** Duck or restore the whole mix (cutscene fades). 1 = normal. */
let duckTarget = null;
export function setDuckTarget(fn) {
  duckTarget = fn;
}
export function duck(level, seconds = 0.5) {
  duckTarget?.(level, seconds);
}
