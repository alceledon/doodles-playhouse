// Audio knobs. Gains are linear (1 = unity). Distances are meters, times seconds.
// Everything the mix depends on lives here so it can be tuned in one place.

export const AUDIO_TUNING = Object.freeze({
  // Mix buses, all feeding the master gain that setVolume() drives.
  buses: Object.freeze({ sfx: 1, music: 0.7, heart: 0.9, reverbReturn: 0.55 }),
  // Generated impulse response for the house reverb.
  reverb: Object.freeze({ seconds: 2.4, decay: 3.2 }),
  // Positional one-shots beyond this many at once are dropped (cheap protection
  // against a pile of block clatter + squeaks overloading slow machines).
  voiceCap: 48,

  // Positional one-shots. A NOISE's loudness is Doodle's hearing radius; the
  // player hears it out to loudness * rangePerLoudness, clamped.
  oneShot: Object.freeze({ ref: 1.2, rolloff: 1, minRange: 10, maxRange: 45, rangePerLoudness: 2.5 }),
  // Sounds from other floors: gain multiplier per floor and a lowpass cutoff.
  floors: Object.freeze({ gainPerFloor: 0.4, cutoffHz: 1400 }),
  // Reverb send rises with distance, so far sounds feel far.
  reverbSend: Object.freeze({ near: 0.12, far: 0.55, farDist: 16 }),

  doodle: Object.freeze({
    headHeight: 0.9, // where Doodle's sounds come from, above its feet
    // Distance curve for everything Doodle makes. A long range on purpose:
    // the collar jingle is the player's main warning.
    ref: 1.5,
    rolloff: 0.85,
    range: 30,
    jingle: Object.freeze({ minSpeed: 0.15, stepsPerMeter: 1.4, minInterval: 0.11, gain: 0.55, idleEvery: [4, 9] }),
    pant: Object.freeze({ calmInterval: 0.78, chaseInterval: 0.3, calmGain: 0.22, chaseGain: 0.75, chaseSpeed: 4.6 }),
    snore: Object.freeze({ interval: 2.9, gain: 0.4 }),
    sniff: Object.freeze({ every: [1.3, 2.6], gain: 0.55 }),
    bark: Object.freeze({ every: [12, 30], minDistance: 6, gain: 0.9 }),
    chew: Object.freeze({ every: [0.35, 0.8], gain: 0.6 }),
  }),

  // Heartbeat: rises as Doodle gets close, and never drops below chaseFloor in a chase.
  heartbeat: Object.freeze({ near: 3, far: 14, minBpm: 66, maxBpm: 150, chaseFloor: 0.75, otherFloor: 0.35, threshold: 0.06, gain: 0.9, smoothing: 1.2 }),

  // Tension (0..1) drives the lullaby detune and the drone.
  tension: Object.freeze({ near: 4, far: 18, alert: 0.4, otherFloor: 0.5, asleep: 0.3, smoothing: 1.5 }),

  music: Object.freeze({
    beatSeconds: 0.62, // music-box waltz, one beat
    titleGain: 0.55,
    gameGain: 0.3,
    chaseGain: 0.1, // the lullaby ducks under the chase
    wobbleCents: 9, // always slightly out of tune
    tensionCents: 55, // extra detune at full tension
    tempoDrop: 0.3, // the box winds down by this fraction at full tension
    skipChance: 0.2, // chance a note is missed at full tension
    bassGain: 0.45,
    droneGain: 0.06,
    droneTensionGain: 0.1,
    droneCutoff: 180,
    droneTensionCutoff: 520,
    roomTone: 0.012,
  }),

  footsteps: Object.freeze({ gain: 0.32, sprintGain: 0.6, crouchGain: 0.04 }),

  // Co-op: sounds the partner makes. range = how far away you hear them (their footsteps and
  // in-hand sounds; their world noises use the NOISE's own loudness).
  partner: Object.freeze({ range: 16, footstepRange: 14, chestHeight: 1 }),

  // Per-voice level trims, set by rendering each voice offline and comparing
  // its loudest 50 ms (the dev page's "measure all voices" button). Targets,
  // before distance: stingers/impacts ≈ -6..-9 dB, world noises ≈ -15..-20,
  // Doodle's breath and small player sounds ≈ -24..-30.
  trim: Object.freeze({
    jingle: 1.5,
    pant: 1.4,
    growl: 0.55,
    barkSting: 0.55,
    huff: 1.6,
    chew: 2.6,
    munch: 2,
    lick: 3.5,
    sniff: 1.8,
    yawn: 1.6,
    windup: 1.6,
    doorCreak: 0.7,
    plankCreak: 0.55,
    squeak: 1.6,
    blockClatter: 2,
    jeepEngine: 0.8,
    launch: 1.5,
    pickup: 2.5,
    unlock: 1.8,
    rustle: 2,
    crinkle: 4,
    gasp: 2.5,
    keypadClick: 1.6,
  }),

  // Pause muffles the whole mix.
  pause: Object.freeze({ gain: 0.45, cutoff: 650 }),
});
