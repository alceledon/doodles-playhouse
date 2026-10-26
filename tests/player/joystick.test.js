import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STICK, TAP, combineMove, createLookGesture, idleStick, isTap, readStick, resetStick } from '../../src/player/joystick.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('stick: inside the dead zone does nothing', () => {
  const s = readStick(STICK.radius * STICK.deadZone * 0.9, 0, idleStick());
  assert.equal(s.scale, 0);
  assert.equal(s.fwd, 0);
  assert.equal(s.strafe, 0);
  assert.equal(s.sprint, false);
});

test('stick: up the screen walks forward, right strafes right', () => {
  const up = readStick(0, -STICK.radius * 0.5, idleStick());
  assert.ok(near(up.fwd, 1) && near(up.strafe, 0));
  const right = readStick(STICK.radius * 0.5, 0, idleStick());
  assert.ok(near(right.strafe, 1) && near(right.fwd, 0));
  const diag = readStick(30, -30, idleStick());
  assert.ok(near(Math.hypot(diag.fwd, diag.strafe), 1), 'a unit direction');
});

test('stick: analog speed ramps from minScale to full walk, then sprints at the rim', () => {
  const r = STICK.radius;
  const justOut = readStick(0, -r * (STICK.deadZone + 0.01), idleStick());
  assert.ok(justOut.scale >= STICK.minScale && justOut.scale < STICK.minScale + 0.05);
  const half = readStick(0, -r * 0.45, idleStick());
  assert.ok(half.scale > justOut.scale && half.scale < 1);
  const full = readStick(0, -r * STICK.fullAt, idleStick());
  assert.ok(near(full.scale, 1));
  assert.equal(full.sprint, false, 'full walking speed is not a sprint');
  const rim = readStick(0, -r * STICK.sprintAt, idleStick());
  assert.equal(rim.sprint, true);
  assert.equal(rim.scale, 1);
  const past = readStick(0, -r * 3, idleStick());
  assert.equal(past.sprint, true, 'dragging past the rim still sprints');
});

test('stick: the knob stops at the rim', () => {
  const s = readStick(STICK.radius * 2, 0, idleStick());
  assert.ok(near(s.knobX, STICK.radius) && near(s.knobY, 0));
  const inside = readStick(10, 5, idleStick());
  assert.equal(inside.knobX, 10);
  assert.equal(inside.knobY, 5);
});

test('stick: readings write into the object given (no allocation per move)', () => {
  const out = idleStick();
  assert.equal(readStick(0, -40, out), out);
  assert.equal(resetStick(out), out);
  assert.deepEqual(out, idleStick());
});

test('combineMove: keys behave exactly as before and win over the stick', () => {
  const out = {};
  assert.deepEqual(combineMove(1, 0, false, null, out), { fwd: 1, strafe: 0, scale: 1, sprint: false });
  assert.deepEqual(combineMove(1, -1, true, idleStick(), out), { fwd: 1, strafe: -1, scale: 1, sprint: true });
  const pushed = readStick(0, -STICK.radius, idleStick());
  assert.deepEqual(combineMove(0, 1, false, pushed, out), { fwd: 0, strafe: 1, scale: 1, sprint: false }, 'a key wins');
  assert.deepEqual(combineMove(0, 0, false, idleStick(), out), { fwd: 0, strafe: 0, scale: 1, sprint: false }, 'idle: no move');
});

test('combineMove: with no keys the stick drives, analog, and its rim sprints', () => {
  const out = {};
  const half = readStick(-20, -20, idleStick());
  combineMove(0, 0, false, half, out);
  assert.equal(out.fwd, half.fwd);
  assert.equal(out.strafe, half.strafe);
  assert.equal(out.scale, half.scale);
  assert.equal(out.sprint, false);
  combineMove(0, 0, false, readStick(0, -STICK.radius, idleStick()), out);
  assert.equal(out.sprint, true);
  combineMove(0, 0, true, half, out);
  assert.equal(out.sprint, true, 'a keyboard Shift still sprints with the stick');
});

test('isTap: short and barely moved', () => {
  assert.equal(isTap(100, 3), true);
  assert.equal(isTap(TAP.maxMs, TAP.slop), true);
  assert.equal(isTap(TAP.maxMs + 1, 0), false, 'held too long');
  assert.equal(isTap(50, TAP.slop + 1), false, 'moved too far');
});

test('look gesture: a tap never turns the view', () => {
  const g = createLookGesture();
  g.down(500, 300, 0);
  g.move(504, 303);
  assert.equal(g.dx, 0);
  assert.equal(g.dy, 0);
  g.move(498, 299);
  assert.equal(g.up(120), 'tap');
  assert.equal(g.startX, 500, 'the tap aims where the finger went down');
  assert.equal(g.startY, 300);
});

test('look gesture: past the slop it looks, without losing the motion inside the slop', () => {
  const g = createLookGesture();
  g.down(500, 300, 0);
  g.move(508, 300);
  assert.equal(g.dx, 0);
  g.move(520, 310); // past the slop: everything since the down
  assert.equal(g.dx, 20);
  assert.equal(g.dy, 10);
  g.move(530, 305);
  assert.equal(g.dx, 10);
  assert.equal(g.dy, -5);
  g.move(530, 305);
  assert.equal(g.dx, 0, 'no move, no look');
  assert.equal(g.up(80), 'drag', 'a quick swipe is a look, not a tap');
});

test('look gesture: a long press in place is not a tap; down() resets', () => {
  const g = createLookGesture();
  g.down(100, 100, 0);
  assert.equal(g.up(TAP.maxMs + 50), 'drag');
  g.down(200, 200, 1000);
  g.move(260, 200);
  g.down(300, 300, 2000);
  assert.equal(g.dragging, false);
  assert.equal(g.maxDist, 0);
  assert.equal(g.up(2100), 'tap');
});
