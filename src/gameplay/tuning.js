// Gameplay numbers, per difficulty. Everything a designer might tweak lives
// here; the code reads it through tuningFor(difficulty). Pure data, no three.

const BASE = {
  move: {
    walk: 3, // m/s
    sprint: 5,
    crouch: 1.5,
    battery: 2.2, // speed cap while carrying the Car Battery (no sprinting)
    accel: 16, // how fast you reach the target speed (m/s²)
    maxStep: 0.45, // tallest floor-height jump you walk onto in one frame (stairs are ramps)
    gravity: 12,
  },
  stamina: {
    drain: 1 / 4, // per second of sprinting: 4 s from full to empty
    regen: 1 / 6, // per second, after the delay
    regenDelay: 0.8,
    recoverAt: 0.3, // after running dry you can't sprint again until this much is back
  },
  look: {
    sensitivity: 0.0022, // radians per mouse pixel at settings.mouseSensitivity = 1
    pitchLimit: 1.45,
    hideYaw: 0.75, // look range while hidden: ± around the hide spot's yaw
    hidePitch: 0.4,
  },
  reach: 2.2, // interaction raycast length (m)
  steps: { walk: 0.5, sprint: 0.32, crouch: 0.72 }, // seconds between footsteps
  bob: { walk: 0.028, sprint: 0.05, crouch: 0.014, freq: 2.1 }, // head bob amplitude (m), cycles per meter
  noise: {
    // NOISE loudness = Doodle's hearing radius in meters
    sprintStep: 7,
    walkStep: 0, // 0 = walking is silent to Doodle (FOOTSTEP still plays)
    drop: 6,
    swap: 2.5, // putting the held item down when you pick another up
    squeak: 6,
    creak: 5,
    piano: 10,
    blocks: 8,
    splash: 10, // landing in the ball pit off the Big Slide
    ball: 8, // first bounce of a thrown tennis ball
    dart: 3, // the launcher's "pfft"
    jeep: 40, // starting the Jeep: Doodle hears it everywhere
    crouchTrapFactor: 0.5, // squeaky toys and creaky planks are quieter when you creep
  },
  traps: {
    // fraction of World's candidate spots that get a prop (at least 1 if any exist)
    squeaky: 0.5,
    blocks: 0.5,
  },
  items: {
    treatUses: 3,
    launcherShots: 2,
    spareDarts: 1, // squeaky darts spawned around the house
  },
  ball: {
    throwSpeed: 9,
    lift: 2.2, // extra upward m/s so throws arc
    restitution: 0.55,
    wallRestitution: 0.5,
    rollFriction: 1.6, // per second while rolling
    maxFlight: 5, // seconds before a ball is forced to rest
  },
  dart: { range: 14, speed: 24 },
  link: {
    crawlSpeed: 1.3,
    slideStart: 2.5,
    slideMax: 7,
    slideAccel: 7,
    slideEye: 0.62, // eye height while sitting on the slide
    crawlEye: 0.45,
  },
  flashlight: { visibility: 0.6, intensity: 10, distance: 15, angle: 0.42, penumbra: 0.55, decay: 1.4 },
  crouchVisibility: 0.6,
  messageSeconds: 1.8, // how long a one-off prompt ("Locked: needs ...") stays up
};

const OVERRIDES = {
  practice: {
    traps: { squeaky: 0.25, blocks: 0.25 },
    items: { treatUses: 3, spareDarts: 1 },
  },
  easy: {
    traps: { squeaky: 0.3, blocks: 0.3 },
    items: { treatUses: 4, spareDarts: 2 },
    stamina: { drain: 1 / 5 },
  },
  normal: {},
  hard: {
    traps: { squeaky: 0.85, blocks: 0.85 },
    items: { treatUses: 2, spareDarts: 0 },
    noise: { sprintStep: 8, drop: 7 },
    stamina: { drain: 1 / 3.5, regen: 1 / 7 },
  },
};

function merge(base, over) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(v, over?.[k] ?? {}) : over?.[k] ?? v;
  }
  return out;
}

/** A fresh tuning object for a difficulty (unknown difficulties get Normal). */
export function tuningFor(difficulty = 'normal') {
  return merge(BASE, OVERRIDES[difficulty] ?? {});
}
