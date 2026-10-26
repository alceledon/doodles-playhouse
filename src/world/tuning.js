// World difficulty knobs. These are atmosphere only: lightLevelAt() is the
// same on every difficulty so the Doodle's sight is tuned in one place (its
// own tuning.js), never by how dark World happens to render a room.

const TABLE = {
  practice: {
    fogNear: 4, fogFar: 26, // m — how far you can see down a dark hall
    ambient: 0.75, // hemisphere fill intensity (the "you can always see a bit" floor)
    lampBoost: 1.3, // multiplier on rendered lamp brightness (visual only)
    flickerRate: 0.4, // how often flickering lamps stutter (1 = normal)
    tvIdle: [16, 32], // s off between TV static bursts
    teddyTurnRate: 0.25, // rad/s the watching teddies turn their heads toward you
    creakyLevel: 0, // fixed creaky planks with level <= this are built (0..2)
  },
  easy: {
    fogNear: 3.5, fogFar: 22,
    ambient: 0.6,
    lampBoost: 1.15,
    flickerRate: 0.7,
    tvIdle: [12, 26],
    teddyTurnRate: 0.35,
    creakyLevel: 0,
  },
  normal: {
    fogNear: 3, fogFar: 19,
    ambient: 0.5,
    lampBoost: 1,
    flickerRate: 1,
    tvIdle: [9, 22],
    teddyTurnRate: 0.45,
    creakyLevel: 1,
  },
  hard: {
    fogNear: 2.5, fogFar: 16,
    ambient: 0.4,
    lampBoost: 0.9,
    flickerRate: 1.3,
    tvIdle: [6, 18],
    teddyTurnRate: 0.6,
    creakyLevel: 2,
  },
};

/** @param {string} difficulty  unknown values fall back to 'normal' */
export function tuningFor(difficulty) {
  return { ...(TABLE[difficulty] ?? TABLE.normal) };
}
