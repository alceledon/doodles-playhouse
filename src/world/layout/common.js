// Shorthand for the floor files. Every coordinate in a floor spec is world X/Z
// in meters, and every Y is RELATIVE to that floor's surface (build.js adds the
// floor height), so the same numbers read the same on every storey.
//
// Walls sit on grid lines (multiples of 0.5 m, the nav cell size) and doorways
// span whole cells, so a 1.5 m door is exactly three nav cells wide and the
// oversized Doodle walks through the middle one with room to spare.

export const T = 0.2; // default wall thickness
export const STOREY = 3;
export const DOOR_H = 2.4; // tall enough for the Doodle's head
export const HALF_PI = Math.PI / 2;

/** Facing yaws for props: the direction the prop's front looks. */
export const FACE = Object.freeze({ N: 0, S: Math.PI, E: -HALF_PI, W: HALF_PI });

export const R = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });
/** A flat box on the floor plane (y ignored by cellsInBox), for door cells and nav marks. */
export const flat = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minY: 0, maxY: 0, minZ, maxZ });

/** Wall running along X at z = `z`, from x1 to x2. */
export const wx = (z, x1, x2, extra = {}) => ({ axis: 'x', at: z, from: x1, to: x2, ...extra });
/** Wall running along Z at x = `x`, from z1 to z2. */
export const wz = (x, z1, z2, extra = {}) => ({ axis: 'z', at: x, from: z1, to: z2, ...extra });

/**
 * Hinged door in a wall line. swing +1 opens toward the + side of the axis
 * perpendicular to the wall (+Z for an 'x' wall, +X for a 'z' wall); hinge says
 * which end of the opening the leaf turns on.
 */
export const door = (id, axis, at, from, to, extra = {}) => ({
  id, axis, at, from, to, height: DOOR_H, locked: false, kind: 'hinged', hinge: 'from', swing: 1, ...extra,
});

/** Open archway (no door). */
export const arch = (axis, at, from, to, top = 2.6) => ({ axis, at, from, to, bottom: 0, top });

/** Prop placement: type is a builder name in props.js. */
export const P = (type, x, z, rot = 0, opts = {}, extra = {}) => ({ type, x, z, rot, opts, ...extra });

export const rail = (axis, at, from, to, h = 1.0) => ({ axis, at, from, to, h });
