// Touch controls (Granny's mobile scheme), shown over the canvas while the
// input mode is 'touch' and controls are on:
//   left half    a stick appears where the thumb lands; push it to the rim to sprint
//   right half   drag to look; a quick tap interacts with what's under the finger
//                (so does a quick tap on the left half that never moved the stick,
//                so things just left of center, like the keypad's last dial, work)
//   buttons      interact (lit when there's a prompt), use, drop, crouch,
//                flashlight, pause
// It only feeds the controller (stick, touchLook, the toggles) and Gameplay's
// actions, so movement and rules stay in one place. Pointer Events, tracked by
// pointerId, so a thumb on the stick and a finger looking or pressing buttons
// work at the same time. Styles live in style.css (.tc).

import { ITEMS } from '../core/contracts.js';
import { EVENTS } from '../core/events.js';
import { INPUT_MODES, getInputMode } from '../core/device.js';
import { createLookGesture, isTap, readStick, resetStick } from './joystick.js';

/** What the Use button says for the held item. */
export const USE_LABELS = Object.freeze({
  [ITEMS.TENNIS_BALL]: 'Throw',
  [ITEMS.TREATS]: 'Treat',
  [ITEMS.LAUNCHER]: 'Fire',
});

const svg = (body) => `<svg viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
const line = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  // The HUD's hand (ui/icons.js drawHand), as SVG.
  hand: svg(`<g fill="#fff8ee" stroke="#2a1f3d" stroke-width="1.6" stroke-linejoin="round">
    <rect x="7.6" y="6" width="4.8" height="13" rx="2.4" transform="rotate(-7 10 15)"/>
    <rect x="12.1" y="3" width="4.8" height="15" rx="2.4"/>
    <rect x="16.6" y="4" width="4.8" height="14.5" rx="2.4" transform="rotate(3 19 14.5)"/>
    <rect x="20.8" y="8.5" width="4.8" height="12" rx="2.4" transform="rotate(10 23.2 16.5)"/>
    <rect x="5.4" y="13" width="5.2" height="10" rx="2.6" transform="rotate(-57 8 21)"/>
    <rect x="7.5" y="13" width="18" height="15" rx="6"/></g>
    <rect x="8.5" y="13.5" width="16.5" height="4" fill="#fff8ee"/>`),
  drop: svg(`<path d="M16 5v14M10 13.5l6 6 6-6M7 26h18" ${line}/>`),
  crouch: svg(`<path d="M8 8l8 7 8-7M8 17l8 7 8-7" ${line}/>`),
  light: svg(`<path d="M16 3.5a8.5 8.5 0 0 0-5 15.4c.9.7 1.4 1.6 1.4 2.6v.5h7.2v-.5c0-1 .5-1.9 1.4-2.6A8.5 8.5 0 0 0 16 3.5z" fill="currentColor"/><path d="M12.5 25.5h7M14 29h4" ${line} stroke-width="2.5"/>`),
  pause: svg('<rect x="9" y="7" width="5" height="18" rx="1.5" fill="currentColor"/><rect x="18" y="7" width="5" height="18" rx="1.5" fill="currentColor"/>'),
};

function el(tag, className) {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.mount     where the layer goes (the canvas's parent, under the UI)
 * @param {Object} opts.controller     createPlayerController(): stick, touchLook, toggles, player
 * @param {Object} opts.bus
 * @param {() => string|null} [opts.heldItemId]
 * @param {{interact: Function, use: Function, drop: Function, tap: (x: number, y: number) => void, pause: Function}} opts.actions
 */
export function createTouchControls({ mount, controller, bus, heldItemId = () => null, actions }) {
  const player = controller.player;
  const stick = controller.stick; // readStick writes straight into the controller's input

  const layer = el('div', 'tc');
  layer.hidden = true;
  const ghost = el('div', 'tc-ghost'); // where your thumb goes, until it lands
  const base = el('div', 'tc-stick');
  const knob = el('div', 'tc-knob');
  base.append(knob);
  base.hidden = true;

  function button(className, label, icon, press) {
    const b = el('button', `tc-btn ${className}`);
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    const text = el('span', 'tc-label');
    text.textContent = label;
    b.append(text);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // no focus ring, no emulated mouse click
      e.stopPropagation(); // not a stick or look touch
      if (!active()) return;
      b.classList.add('tc-down');
      press();
    });
    const up = () => b.classList.remove('tc-down');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    return { b, text };
  }
  const interact = button('tc-interact', 'Interact', ICONS.hand, () => actions.interact());
  const use = button('tc-use', 'Use', '', () => actions.use());
  const drop = button('tc-drop', 'Drop', ICONS.drop, () => actions.drop());
  const crouch = button('tc-crouch', 'Crouch', ICONS.crouch, () => controller.toggleCrouch());
  const light = button('tc-light', 'Light', ICONS.light, () => controller.toggleFlashlight());
  const pause = button('tc-pause', 'Pause', ICONS.pause, () => actions.pause());
  layer.append(ghost, base, ...[interact, use, drop, crouch, light, pause].map((x) => x.b));
  mount.append(layer);

  // ---- state ------------------------------------------------------------------------
  let enabled = false;
  let mode = getInputMode();
  const active = () => enabled && mode === INPUT_MODES.TOUCH;

  let hot = false; // there's a prompt: light up the hand
  let held = heldItemId();
  const shown = { hot: null, crouched: null, light: null, held: undefined, sprint: null };

  function sync() {
    const on = active();
    layer.hidden = !on;
    if (!on) release();
  }

  // ---- stick and look ---------------------------------------------------------------
  let stickId = null;
  let stickX = 0;
  let stickY = 0;
  let stickT = 0;
  let stickMax = 0; // farthest the thumb got from where it landed
  let knobDirty = false;
  let lookId = null;
  const gesture = createLookGesture();

  function releaseStick() {
    stickId = null;
    resetStick(stick);
    base.hidden = true;
    ghost.hidden = false;
    knobDirty = true;
  }
  function release() {
    releaseStick();
    lookId = null;
  }

  const onDown = (e) => {
    if (!active() || e.pointerType === 'mouse') return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    if (x < innerWidth / 2) {
      if (stickId !== null) return;
      stickId = e.pointerId;
      stickX = x;
      stickY = y;
      stickT = performance.now();
      stickMax = 0;
      resetStick(stick);
      base.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      base.hidden = false;
      ghost.hidden = true;
      knobDirty = true;
    } else if (lookId === null) {
      lookId = e.pointerId;
      gesture.down(x, y, performance.now());
    }
  };
  const onMove = (e) => {
    if (e.pointerId === stickId) {
      const dx = e.clientX - stickX;
      const dy = e.clientY - stickY;
      stickMax = Math.max(stickMax, Math.hypot(dx, dy));
      readStick(dx, dy, stick);
      knobDirty = true;
    } else if (e.pointerId === lookId) {
      gesture.move(e.clientX, e.clientY);
      if (gesture.dx || gesture.dy) controller.touchLook(gesture.dx, gesture.dy);
    }
  };
  const onUp = (e) => {
    if (e.pointerId === stickId) {
      releaseStick();
      if (e.type === 'pointerup' && active() && isTap(performance.now() - stickT, stickMax)) actions.tap(stickX, stickY);
    } else if (e.pointerId === lookId) {
      lookId = null;
      // Aim with where the finger went down: the view didn't move inside the slop.
      if (e.type === 'pointerup' && active() && gesture.up(performance.now()) === 'tap') actions.tap(gesture.startX, gesture.startY);
    }
  };
  const onContextMenu = (e) => e.preventDefault(); // long-press menus
  layer.addEventListener('pointerdown', onDown);
  layer.addEventListener('contextmenu', onContextMenu);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('blur', release);

  bus.on(EVENTS.PROMPT, ({ text } = {}) => (hot = !!text));
  bus.on(EVENTS.HELD, ({ itemId } = {}) => (held = itemId ?? null));
  bus.on(EVENTS.INPUT_MODE, ({ mode: m } = {}) => {
    mode = m;
    sync();
  });

  /** Per frame: redraw only what changed (no allocations on the hot path). */
  function update() {
    if (layer.hidden) return;
    if (knobDirty) {
      knobDirty = false;
      knob.style.transform = `translate3d(${stick.knobX}px, ${stick.knobY}px, 0)`;
      if (stick.sprint !== shown.sprint) base.classList.toggle('tc-sprint', (shown.sprint = stick.sprint));
    }
    if (hot !== shown.hot) interact.b.classList.toggle('tc-hot', (shown.hot = hot));
    if (player.crouched !== shown.crouched) crouch.b.classList.toggle('tc-on', (shown.crouched = player.crouched));
    if (player.flashlightOn !== shown.light) light.b.classList.toggle('tc-on', (shown.light = player.flashlightOn));
    if (held !== shown.held) {
      shown.held = held;
      use.text.textContent = USE_LABELS[held] ?? 'Use';
      use.b.classList.toggle('tc-dim', !held);
      drop.b.classList.toggle('tc-dim', !held);
    }
  }

  return {
    element: layer,
    update,
    setEnabled(on) {
      enabled = !!on;
      sync();
    },
    isActive: active,
    dispose() {
      layer.removeEventListener('pointerdown', onDown);
      layer.removeEventListener('contextmenu', onContextMenu);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('blur', release);
      release();
      layer.remove();
    },
  };
}
