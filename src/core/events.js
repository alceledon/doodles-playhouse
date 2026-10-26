// Event bus shared by every area. Areas talk to each other only through these
// events and the contract objects in contracts.js — never by importing each
// other's internals.
//
// main.js gives per-run modules a *scoped* bus (bus.scope()). Everything a
// scope subscribed is removed at once with scope.dispose() when the run ends,
// so modules don't have to track their own unsubscribes.

/**
 * Every event name in the game, with its payload. Emit with EVENTS.X, never a
 * raw string, so a typo fails loudly (emit() rejects unknown names).
 * Positions are plain {x, y, z} in meters (Three.js axes: Y up).
 */
export const EVENTS = Object.freeze({
  // ---- sound the Doodle can hear (any area may emit) ----
  NOISE: 'noise',                 // {pos, floorId, loudness /* hearing radius m */, kind /* 'step'|'drop'|'door'|'container'|'squeak'|'creak'|'piano'|'blocks'|'splash'|'jeep'|'ball'|'dart'|'other' */}

  // ---- player / gameplay (emitted by Gameplay) ----
  FOOTSTEP: 'footstep',           // {pos, floorId, surface, sprint, crouch} — audio only; loud steps also emit NOISE
  PROMPT: 'prompt',               // {text: string|null} — interaction hint under the crosshair; null hides it
  HELD: 'held',                   // {itemId: ItemId|null, uses: number|null}
  PICKUP: 'pickup',               // {itemId}
  DROP: 'drop',                   // {itemId, pos, floorId}
  LOCK_OPENED: 'lockOpened',      // {lockId: LockId}
  EXIT_UNLOCKED: 'exitUnlocked',  // {route: 'frontDoor'|'garage'}
  HIDE: 'hide',                   // {spotId, pos, floorId}
  UNHIDE: 'unhide',               // {spotId}
  LINK_ENTER: 'linkEnter',        // {linkId, kind: 'slide'|'tunnel'} — player starts a slide/crawl
  LINK_EXIT: 'linkExit',          // {linkId, kind, pos, floorId}
  TRAP: 'trap',                   // {kind: TrapKind, pos, floorId}
  BALL_THROWN: 'ballThrown',      // {pos, floorId}
  BALL_LANDED: 'ballLanded',      // {pos, floorId} — Doodle goes to fetch
  TREAT_DROPPED: 'treatDropped',  // {treatId, pos, floorId}
  DART_FIRED: 'dartFired',        // {origin, dir /* unit vector */, range} — Doodle does its own hit test
  JEEP_STARTED: 'jeepStarted',    // {pos, floorId}
  ESCAPED: 'escaped',             // {route: 'frontDoor'|'garage'}
  PAUSE_REQUEST: 'pauseRequest',  // {} — Esc pressed or pointer lock lost

  // ---- Doodle (emitted by Doodle) ----
  DOODLE_STATE: 'doodleState',    // {state: DoodleState, prev: DoodleState}
  SPOTTED: 'spotted',             // {pos} — Doodle sees the player (chase starts)
  LOST_TRACK: 'lostTrack',        // {} — Doodle lost the player
  BALL_FETCHED: 'ballFetched',    // {} — Doodle picked the ball up (Gameplay hides its ball)
  BALL_RETURNED: 'ballReturned',  // {pos, floorId} — Doodle dropped it (Gameplay respawns it here)
  TREAT_EATEN: 'treatEaten',      // {treatId}
  DOODLE_HIT: 'doodleHit',        // {} — a dart hit
  DOODLE_STUNNED: 'doodleStunned',// {seconds}
  DOODLE_RECOVERED: 'doodleRecovered', // {}
  CAUGHT: 'caught',               // {how: 'tackle'|'pulledOut'}

  // ---- world (emitted by World) ----
  DOOR_OPENED: 'doorOpened',      // {doorId, by: 'player'|'doodle'}
  DOOR_CLOSED: 'doorClosed',      // {doorId, by}
  CONTAINER_OPENED: 'containerOpened', // {containerId}
  CONTAINER_CLOSED: 'containerClosed', // {containerId}

  // ---- run flow (emitted by main.js / core) ----
  RUN_START: 'runStart',          // {difficulty, seed}
  DAY_START: 'dayStart',          // {day}
  WON: 'won',                     // {route, days, seconds, difficulty}
  GAME_OVER: 'gameOver',          // {difficulty, seconds}
  PAUSED: 'paused',               // {}
  RESUMED: 'resumed',             // {}

  // ---- settings (emitted by UI) ----
  SETTINGS_CHANGED: 'settingsChanged', // {settings: Settings}
});

const KNOWN = new Set(Object.values(EVENTS));

/**
 * @returns {Bus}
 * @typedef {Object} Bus
 * @property {(type: string, fn: (payload: any) => void) => () => void} on   returns an unsubscribe fn
 * @property {(type: string, fn: (payload: any) => void) => () => void} once
 * @property {(type: string, payload?: any) => void} emit
 * @property {() => ScopedBus} scope  a child whose subscriptions can be removed together
 * @property {() => void} clear       remove every subscription
 *
 * @typedef {Bus & { dispose: () => void }} ScopedBus
 */
export function createBus() {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();

  function on(type, fn) {
    if (!KNOWN.has(type)) throw new Error(`Unknown event "${type}" — add it to EVENTS in src/core/events.js`);
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  }

  function once(type, fn) {
    const off = on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  function emit(type, payload = {}) {
    if (!KNOWN.has(type)) throw new Error(`Unknown event "${type}" — add it to EVENTS in src/core/events.js`);
    const set = handlers.get(type);
    if (!set) return;
    // Copy so handlers may unsubscribe (or subscribe) while we iterate.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Error in "${type}" handler:`, err);
      }
    }
  }

  function scope() {
    const offs = new Set();
    const child = {
      on(type, fn) {
        const off = on(type, fn);
        offs.add(off);
        return () => {
          offs.delete(off);
          off();
        };
      },
      once(type, fn) {
        const off = once(type, fn);
        offs.add(off);
        return () => {
          offs.delete(off);
          off();
        };
      },
      emit,
      scope: () => scope(),
      clear: () => child.dispose(),
      dispose() {
        for (const off of offs) off();
        offs.clear();
      },
    };
    return child;
  }

  return {
    on,
    once,
    emit,
    scope,
    clear: () => handlers.clear(),
  };
}
