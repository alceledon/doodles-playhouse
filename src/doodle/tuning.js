// Doodle's numbers per difficulty. Pure data: the brain, senses and scent
// modules read everything from here, so balancing never touches logic.
// Speeds are m/s, times are seconds, distances are meters.

const DEG = Math.PI / 180;

const NORMAL = Object.freeze({
  // ---- movement ----
  patrolSpeed: 2.5,
  investigateSpeed: 3.4, // trotting toward a noise
  sniffSpeed: 2.0, // nose down, following the trail
  searchSpeed: 2.6,
  chaseSpeed: 4.6, // the player sprints at 5, so sprinting outruns it until stamina runs out
  fetchSpeed: 4.2, // running for the ball
  carrySpeed: 2.4, // trotting home with it
  treatSpeed: 3.6,
  turnRate: 7, // rad/s the body turns toward where it's going
  lungeRange: 2.0, // start a lunge when this close and in view
  lungeSpeed: 7,
  lungeTime: 0.35,
  lungeCooldown: 2.5,

  // ---- hearing ----
  hearing: 1, // multiplies NOISE.loudness (the hearing radius)
  floorDamping: 0.35, // radius multiplier per floor between the noise and the Doodle

  // ---- sight ----
  fov: 110 * DEG, // full cone angle
  sightMin: 1.5, // range when player.visibility() is ~0 (crouched in the dark)
  sightMax: 14, // range at visibility 1 (flashlight on in a lit room)
  closeSense: 1.2, // notices you this close even outside the cone
  spotTime: 0.2, // seconds of continuous sight before it commits, plus...
  spotTimePerMeter: 0.05, // ...this much per meter of distance
  trackTime: 1.2, // after losing sight it still "knows" where you are this long
  chaseGiveUp: 8, // lost sight this long → stop chasing and search
  unreachableGiveUp: 4, // standing at the closest reachable point this long → give up
  hideSeenGrace: 0.5, // HIDE counts as "seen" if it saw you this recently

  // ---- smell ----
  nose: 1, // multiplies every smell radius and how long crumbs stay smellable
  crumbSpacing: 1, // the player leaves a crumb about every meter
  crumbLife: 45, // crumbs vanish after this long
  smellRange: 4, // crumbs are noticed within this radius
  sniffFresh: 20, // only crumbs younger than this start a SNIFF from patrol
  smellFloorDamping: 0.5, // smell radius multiplier per floor apart
  poolDelay: 2, // standing still this long starts a scent pool
  poolRadius0: 2, // a fresh pool's smell radius
  poolGrowth: 0.45, // m of radius per second spent in the pool
  poolMaxRadius: 18,
  poolDecay: 30, // an abandoned pool fades out over this long
  hideSniffTime: 25, // a hide this long gets sniffed out
  sniffCheckTime: 3, // seconds it sniffs at a hiding spot before deciding
  poolRecheck: 12, // after a check that found nothing, ignore the pool this long

  // ---- distractions ----
  eatTime: 5,
  treatSmellRange: 12, // treats farther than this are found later, when it passes by
  treatIgnoreChance: 0, // Hard: 0.5
  ballHearRadius: 18, // hears a landing ball this far (floor-damped)
  ballSpotRange: 5, // notices a loose ball it passes this close
  itemReach: 1.0, // snout reach for balls, treats and hide spots
  pullOutReach: 1.4,
  stunTime: 20,

  // ---- patrol / search ----
  patrolLinger: [1, 3], // pause at each patrol anchor
  driftWeight: 4, // how strongly patrol picks drift toward the last heard noise
  driftMemory: 90, // ...for this long after hearing it
  investigateLinger: 3, // looks around at a noise this long
  searchTime: 10,
  searchRadius: 5,
  repathInterval: 0.3, // chase re-plans this often
});

const EASY = Object.freeze({
  ...NORMAL,
  patrolSpeed: 2.1,
  investigateSpeed: 2.9,
  sniffSpeed: 1.7,
  searchSpeed: 2.2,
  chaseSpeed: 4.0,
  fetchSpeed: 3.6,
  carrySpeed: 2.1,
  treatSpeed: 3.1,
  lungeSpeed: 6,
  hearing: 0.7,
  sightMax: 11,
  spotTime: 0.3,
  spotTimePerMeter: 0.07,
  trackTime: 0.8,
  chaseGiveUp: 6,
  nose: 0.75,
  hideSniffTime: 35,
  stunTime: 30,
  driftWeight: 2,
});

const HARD = Object.freeze({
  ...NORMAL,
  patrolSpeed: 2.9,
  investigateSpeed: 3.8,
  sniffSpeed: 2.4,
  searchSpeed: 3.0,
  chaseSpeed: 4.9, // still just under the player's sprint
  fetchSpeed: 4.6,
  carrySpeed: 2.7,
  treatSpeed: 4.0,
  lungeSpeed: 7.5,
  lungeCooldown: 2,
  hearing: 1.3,
  sightMax: 16,
  closeSense: 1.6,
  spotTime: 0.15,
  spotTimePerMeter: 0.035,
  trackTime: 1.6,
  chaseGiveUp: 10,
  nose: 1.4,
  sniffFresh: 30,
  hideSniffTime: 15,
  treatIgnoreChance: 0.5,
  stunTime: 12,
  driftWeight: 6,
  searchTime: 14,
});

const TABLE = { practice: EASY, easy: EASY, normal: NORMAL, hard: HARD };

/** Doodle tuning for a difficulty. Practice has no Doodle, but gets Easy's numbers so dev pages still work. */
export function tuningFor(difficulty = 'normal') {
  return TABLE[difficulty] ?? NORMAL;
}
