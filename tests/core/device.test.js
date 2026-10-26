import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INPUT_MODES,
  PHONE_MAX_WIDTH,
  TOUCH_MOUSE_GRACE_MS,
  createInputModeState,
  getInputMode,
  initialInputMode,
  needsRotate,
} from '../../src/core/device.js';
import { createBus, EVENTS } from '../../src/core/events.js';

const { TOUCH, DESKTOP } = INPUT_MODES;

test('boot mode: a forced mode wins, else a coarse primary pointer means touch', () => {
  assert.equal(initialInputMode(), DESKTOP);
  assert.equal(initialInputMode({ coarse: true }), TOUCH);
  assert.equal(initialInputMode({ coarse: false }), DESKTOP);
  assert.equal(initialInputMode({ forced: 'touch', coarse: false }), TOUCH);
  assert.equal(initialInputMode({ forced: 'desktop', coarse: true }), DESKTOP);
  assert.equal(initialInputMode({ forced: 'gamepad', coarse: true }), TOUCH, 'an unknown forced mode is ignored');
});

test('a touch switches to touch; a key switches back to desktop', () => {
  const s = createInputModeState(DESKTOP);
  assert.equal(s.noteTouch(0), true);
  assert.equal(s.mode, TOUCH);
  assert.equal(s.noteTouch(10), false, 'already touch: no change reported');
  assert.equal(s.noteKey(), true);
  assert.equal(s.mode, DESKTOP);
  assert.equal(s.noteKey(), false);
});

test('mouse movement switches to desktop, but not the mouse events a tap replays', () => {
  const s = createInputModeState(TOUCH);
  s.noteTouch(1000);
  assert.equal(s.noteMouseMove(1000 + TOUCH_MOUSE_GRACE_MS - 1, 5, 0), false, 'emulated mouse right after a tap');
  assert.equal(s.mode, TOUCH);
  assert.equal(s.noteMouseMove(5000, 0, 0), false, 'a zero-length move is not a mouse');
  assert.equal(s.noteMouseMove(5000, 3, -2), true);
  assert.equal(s.mode, DESKTOP);
});

test('an iPad with a keyboard and trackpad flips both ways', () => {
  const s = createInputModeState(TOUCH); // coarse primary pointer at boot
  assert.equal(s.noteKey(), true); // typed on the keyboard
  assert.equal(s.mode, DESKTOP);
  assert.equal(s.noteTouch(100), true); // tapped the screen
  assert.equal(s.mode, TOUCH);
  assert.equal(s.noteMouseMove(100 + TOUCH_MOUSE_GRACE_MS + 1, 1, 0), true); // moved the trackpad
  assert.equal(s.mode, DESKTOP);
});

test('an unknown initial mode falls back to desktop', () => {
  assert.equal(createInputModeState('nope').mode, DESKTOP);
});

test('the mode is desktop until a watcher starts (dev pages, node)', () => {
  assert.equal(getInputMode(), DESKTOP);
});

test('rotate overlay: only a narrow portrait screen in touch mode', () => {
  assert.equal(needsRotate({ width: 375, height: 812, touch: true }), true, 'iPhone upright');
  assert.equal(needsRotate({ width: 812, height: 375, touch: true }), false, 'iPhone sideways');
  assert.equal(needsRotate({ width: 768, height: 1024, touch: true }), false, 'iPad portrait is playable');
  assert.equal(needsRotate({ width: 375, height: 812, touch: false }), false, 'a narrow desktop window');
  assert.equal(needsRotate({ width: PHONE_MAX_WIDTH, height: 1000, touch: true }), false);
});

test('INPUT_MODE is a known event', () => {
  const bus = createBus();
  const got = [];
  bus.on(EVENTS.INPUT_MODE, ({ mode }) => got.push(mode));
  bus.emit(EVENTS.INPUT_MODE, { mode: TOUCH });
  assert.deepEqual(got, [TOUCH]);
});
