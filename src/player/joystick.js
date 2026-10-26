// Touch-control math. Pure (no DOM, no three) so node can test it:
//   readStick     the virtual stick's thumb offset → an analog move (+ sprint at the rim)
//   combineMove   keys and stick → what the controller walks with
//   lookGesture   one look finger: no look inside the tap slop, then tap or drag on release
// Everything writes into objects it's given, so pointer moves and frames don't allocate.

export const STICK = Object.freeze({
  radius: 56, // CSS px from where the thumb landed to the rim
  deadZone: 0.14, // fraction of the radius that does nothing (thumb jitter)
  minScale: 0.3, // walk speed fraction just past the dead zone
  fullAt: 0.75, // full walking speed from here out
  sprintAt: 0.95, // pushed to the rim: sprint (stamina rules unchanged)
});

export const TAP = Object.freeze({
  maxMs: 300, // a press held longer is a look, not a tap
  slop: 12, // CSS px a finger may wander and still tap; looking starts past this
});

/** A zeroed stick reading, for the controller and touch.js to share. */
export const idleStick = () => ({ fwd: 0, strafe: 0, scale: 0, sprint: false, knobX: 0, knobY: 0 });

/** Back to idle, in place. */
export function resetStick(out) {
  out.fwd = out.strafe = out.scale = out.knobX = out.knobY = 0;
  out.sprint = false;
  return out;
}

/**
 * The stick's thumb offset (CSS px from where it landed; +y is down the
 * screen) as a move: fwd/strafe a unit direction (up the screen = forward),
 * scale 0..1 of the stance's speed, sprint when pushed to the rim, and the
 * knob's drawn offset (clamped to the rim).
 */
export function readStick(dx, dy, out, cfg = STICK) {
  const len = Math.hypot(dx, dy);
  const k = len > cfg.radius ? cfg.radius / len : 1;
  out.knobX = dx * k;
  out.knobY = dy * k;
  const raw = len / cfg.radius;
  if (raw <= cfg.deadZone) {
    out.fwd = out.strafe = out.scale = 0;
    out.sprint = false;
    return out;
  }
  out.fwd = -dy / len;
  out.strafe = dx / len;
  out.sprint = raw >= cfg.sprintAt;
  const t = Math.min(1, (raw - cfg.deadZone) / (cfg.fullAt - cfg.deadZone));
  out.scale = out.sprint ? 1 : cfg.minScale + (1 - cfg.minScale) * t;
  return out;
}

/**
 * What the controller walks with. Pressed keys win and behave exactly as
 * before (full speed, Shift sprints); otherwise the stick, if it's pushed.
 * @param {number} keyFwd     -1..1 from W/S
 * @param {number} keyStrafe  -1..1 from D/A
 * @param {boolean} shift
 * @param {{fwd: number, strafe: number, scale: number, sprint: boolean}|null} stick
 * @param {{fwd: number, strafe: number, scale: number, sprint: boolean}} out
 */
export function combineMove(keyFwd, keyStrafe, shift, stick, out) {
  if (keyFwd || keyStrafe || !stick || !(stick.scale > 0)) {
    out.fwd = keyFwd;
    out.strafe = keyStrafe;
    out.scale = 1;
    out.sprint = !!shift;
  } else {
    out.fwd = stick.fwd;
    out.strafe = stick.strafe;
    out.scale = stick.scale;
    out.sprint = stick.sprint || !!shift;
  }
  return out;
}

/** Was a look-side press a tap? Short and barely moved. */
export function isTap(ms, maxDist, cfg = TAP) {
  return ms <= cfg.maxMs && maxDist <= cfg.slop;
}

/**
 * One look finger. move() leaves the look delta to apply in dx/dy: zero while
 * inside the tap slop (so a tap doesn't nudge the view off what it hit), then
 * everything since the last applied point, so no motion is lost.
 */
export function createLookGesture(cfg = TAP) {
  const g = {
    startX: 0,
    startY: 0,
    startT: 0,
    lastX: 0,
    lastY: 0,
    maxDist: 0,
    dragging: false,
    dx: 0,
    dy: 0,
    down(x, y, t) {
      g.startX = g.lastX = x;
      g.startY = g.lastY = y;
      g.startT = t;
      g.maxDist = 0;
      g.dragging = false;
      g.dx = g.dy = 0;
      return g;
    },
    move(x, y) {
      g.maxDist = Math.max(g.maxDist, Math.hypot(x - g.startX, y - g.startY));
      if (!g.dragging && g.maxDist > cfg.slop) g.dragging = true;
      if (g.dragging) {
        g.dx = x - g.lastX;
        g.dy = y - g.lastY;
        g.lastX = x;
        g.lastY = y;
      } else g.dx = g.dy = 0;
      return g;
    },
    /** @returns {'tap'|'drag'} */
    up(t) {
      return !g.dragging && isTap(t - g.startT, g.maxDist, cfg) ? 'tap' : 'drag';
    },
  };
  return g;
}
