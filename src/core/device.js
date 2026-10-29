// Input mode (touch vs desktop) plus a few device helpers shared by main.js,
// Gameplay and the UI.
//
// The switching rules are pure so node can test them. startInputModeWatcher()
// is the browser side: it touches window only when called, and keeps the
// module-level mode that getInputMode() reports.
//
//   touch    the primary pointer is coarse at boot, or a finger/pen touched
//   desktop  a key was pressed or a real mouse moved
//
// An iPad with a keyboard or trackpad flips to desktop when you use them and
// back to touch on the next tap.

import { EVENTS } from './events.js';

export const INPUT_MODES = Object.freeze({ TOUCH: 'touch', DESKTOP: 'desktop' });

/** After a touch, browsers replay the tap as mouse events: ignore mouse moves this long (ms). */
export const TOUCH_MOUSE_GRACE_MS = 1000;

/** Phones narrower than this in portrait get the "rotate your phone" overlay (CSS px). */
export const PHONE_MAX_WIDTH = 600;

const isMode = (m) => m === INPUT_MODES.TOUCH || m === INPUT_MODES.DESKTOP;

/** The mode at boot: a forced one (?input=touch) wins, else a coarse primary pointer means touch. */
export function initialInputMode({ forced = null, coarse = false } = {}) {
  if (isMode(forced)) return forced;
  return coarse ? INPUT_MODES.TOUCH : INPUT_MODES.DESKTOP;
}

/**
 * The switching rules. Each note*() returns true when the mode changed.
 * @param {'touch'|'desktop'} [initial]
 */
export function createInputModeState(initial = INPUT_MODES.DESKTOP) {
  let mode = isMode(initial) ? initial : INPUT_MODES.DESKTOP;
  let lastTouch = -Infinity;
  const set = (m) => {
    if (m === mode) return false;
    mode = m;
    return true;
  };
  return {
    get mode() {
      return mode;
    },
    /** A finger or pen went down or moved. */
    noteTouch(now) {
      lastTouch = now;
      return set(INPUT_MODES.TOUCH);
    },
    noteKey() {
      return set(INPUT_MODES.DESKTOP);
    },
    /** A mouse-type pointer moved by (dx, dy). Replays of a recent tap and zero moves don't count. */
    noteMouseMove(now, dx, dy) {
      if (now - lastTouch < TOUCH_MOUSE_GRACE_MS) return false;
      if (!dx && !dy) return false;
      return set(INPUT_MODES.DESKTOP);
    },
  };
}

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * True for a key event's target that takes typing (the leaderboard's name field):
 * those keys are words, not game keys, and not a sign of a real keyboard either.
 */
export function isTextEntry(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && !NOT_TEXT.has(String(target.type || 'text').toLowerCase());
}

/** Phones play sideways: a narrow portrait screen in touch mode gets the rotate overlay. */
export function needsRotate({ width, height, touch }) {
  return !!touch && height > width && width < PHONE_MAX_WIDTH;
}

// ---- browser side ---------------------------------------------------------------

let current = INPUT_MODES.DESKTOP;

/** The current input mode ('desktop' until a watcher starts, e.g. on dev pages and in node). */
export const getInputMode = () => current;
export const isTouchMode = () => current === INPUT_MODES.TOUCH;

/**
 * Watch the real input and emit EVENTS.INPUT_MODE {mode} on `bus` when it flips.
 * @param {{bus: Object, forced?: string|null}} opts
 */
export function startInputModeWatcher({ bus, forced = null }) {
  const coarse = !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  const state = createInputModeState(initialInputMode({ forced, coarse }));
  current = state.mode;
  const changed = (did) => {
    if (!did) return;
    current = state.mode;
    bus.emit(EVENTS.INPUT_MODE, { mode: current });
  };

  let mouseX = null;
  let mouseY = null;
  const onPointer = (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') return changed(state.noteTouch(performance.now()));
    if (e.pointerType !== 'mouse' || e.type !== 'pointermove') return;
    // movementX covers a locked pointer; the client position covers browsers without it.
    const moved = !!(e.movementX || e.movementY) || (mouseX !== null && (e.clientX !== mouseX || e.clientY !== mouseY));
    mouseX = e.clientX;
    mouseY = e.clientY;
    changed(state.noteMouseMove(performance.now(), moved ? 1 : 0, 0));
  };
  const onTouch = () => changed(state.noteTouch(performance.now()));
  // iOS's on-screen keyboard sends key events too: typing a name doesn't mean a keyboard is attached.
  const onKey = (e) => {
    if (!isTextEntry(e?.target)) changed(state.noteKey());
  };
  addEventListener('pointerdown', onPointer, true);
  addEventListener('pointermove', onPointer, true);
  addEventListener('touchstart', onTouch, { capture: true, passive: true });
  addEventListener('keydown', onKey, true);

  return {
    get mode() {
      return state.mode;
    },
    dispose() {
      removeEventListener('pointerdown', onPointer, true);
      removeEventListener('pointermove', onPointer, true);
      removeEventListener('touchstart', onTouch, { capture: true });
      removeEventListener('keydown', onKey, true);
    },
  };
}

/** Ask for full screen (iPad, Android). iPhone Safari can't; any failure is ignored. Call from a gesture. */
export function tryFullscreen(el = globalThis.document?.documentElement) {
  try {
    const doc = globalThis.document;
    if (!el || doc.fullscreenElement || doc.webkitFullscreenElement) return;
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' })?.catch?.(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {}
}
