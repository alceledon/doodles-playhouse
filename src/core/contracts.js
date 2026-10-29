// THE CONTRACT. Every area builds to the shapes in this file, and nothing else
// couples the areas together. See docs/CONTRACTS.md for the prose version.
//
// Rules:
//  - Only the coordinator edits files in src/core/. Need a change? Ask for it.
//  - Changes are additive: new optional fields or new constants, never renames.
//  - Pure-logic code takes plain {x, y, z} objects (Vec3), never THREE types,
//    so it runs under `node --test`.
//
// Units are meters and seconds. Axes follow Three.js: Y is up, a yaw of 0
// faces -Z, and positive yaw turns left (counter-clockwise seen from above).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FLOOR_IDS = Object.freeze(['basement', 'ground', 'upstairs', 'attic']);

/** Recommended floor heights (floor surface Y). World reports the real ones in world.floors. */
export const FLOOR_Y = Object.freeze({ basement: -3, ground: 0, upstairs: 3, attic: 6 });
export const STOREY_HEIGHT = 3;

export const DIFFICULTIES = Object.freeze(['practice', 'easy', 'normal', 'hard']);
export const MAX_DAYS = 5;

/** Player body, shared so World can size doorways and tunnels. */
export const PLAYER_BODY = Object.freeze({
  radius: 0.25,
  height: 1.25, // standing: colliders overlapping [feetY, feetY + height] block
  crouchHeight: 0.7, // crouched: so a collider with minY > feetY + 0.7 is a crawl-under ceiling
  eyeHeight: 1.1,
  crouchEyeHeight: 0.55,
});

/** Doodle body, shared so the catch range and model scale agree. */
export const DOODLE_BODY = Object.freeze({
  radius: 0.45,
  shoulderHeight: 1.15, // oversized on purpose
  catchRange: 0.9, // CAUGHT when this close (floor distance) and on the same floor
});

/** Minimum openings World must leave. */
export const CLEARANCE = Object.freeze({
  doorWidth: 1.0,
  doorHeight: 2.1,
  crawlHeight: 0.8,
});

export const ITEMS = Object.freeze({
  PADLOCK_KEY: 'padlockKey',
  HAMMER: 'hammer',
  JEEP_KEY: 'jeepKey',
  CAR_BATTERY: 'carBattery',
  FUSE: 'fuse',
  TOY_CHEST_KEY: 'toyChestKey',
  TENNIS_BALL: 'tennisBall',
  TREATS: 'treats',
  LAUNCHER: 'launcher',
  DART: 'dart',
});
export const ITEM_IDS = Object.freeze(Object.values(ITEMS));

/** Items World must give spawn candidates for (anchors.spawns[itemId]). The launcher lives in the attic chest instead. */
export const SPAWNED_ITEMS = Object.freeze(ITEM_IDS.filter((id) => id !== ITEMS.LAUNCHER));

export const LOCKS = Object.freeze({
  PADLOCK: 'padlock', // front door — padlockKey
  PLANK: 'plank', // front door — hammer
  KEYPAD: 'keypad', // front door — 4-digit crayon color code
  FUSE_BOX: 'fuseBox', // basement — fuse; powers the garage opener
  JEEP_KEY: 'jeepKey', // jeep — jeepKey
  JEEP_BATTERY: 'jeepBattery', // jeep — carBattery
  ATTIC_CHEST: 'atticChest', // attic chest — toyChestKey; holds the launcher
});
export const LOCK_IDS = Object.freeze(Object.values(LOCKS));

export const ROUTES = Object.freeze({ FRONT_DOOR: 'frontDoor', GARAGE: 'garage' });

export const DOODLE_STATES = Object.freeze({
  SLEEP: 'sleep', // start of each day, in the kennel
  PATROL: 'patrol',
  INVESTIGATE: 'investigate', // heard a noise
  SNIFF: 'sniff', // following the scent trail
  CHASE: 'chase', // can see the player
  SEARCH: 'search', // lost sight, looking around the last known spot
  DISTRACTED: 'distracted', // fetching the ball / eating a treat
  STUNNED: 'stunned', // chewing a squeaky dart
  CATCH: 'catch', // caught the player; cutscene owns it now
});

/** Poses the Doodle model must support (doodle.model.setPose). Cutscenes use these. */
export const DOODLE_POSES = Object.freeze(['idle', 'walk', 'run', 'sniff', 'eat', 'chew', 'sleep', 'pounce', 'lick', 'drag']);
export const DOODLE_MOODS = Object.freeze(['calm', 'hunt']); // hunt = ears back, red eyes, open mouth

export const HIDE_KINDS = Object.freeze(['ballpit', 'chest', 'fort', 'underbed', 'wardrobe', 'cabinet']);

/** creaky/piano are fixed spots World builds; squeaky/blocks are candidate spots Gameplay fills per difficulty. */
export const TRAP_KINDS = Object.freeze(['creaky', 'piano', 'squeaky', 'blocks']);

export const LINK_KINDS = Object.freeze(['stairs', 'slide', 'tunnel']);

export const CONTAINER_KINDS = Object.freeze(['drawer', 'chest', 'cabinet', 'wardrobe']);

/**
 * What a look-raycast can hit. World tags its interactive meshes with
 * object3d.userData.interact = { kind, id } and lists them in world.interactables.
 * Gameplay may add its own tagged meshes (items, lock hardware) to its own list.
 */
export const INTERACT_KINDS = Object.freeze([
  'door', // id = doorId
  'container', // id = containerId
  'hide', // id = hideSpotId
  'linkEntry', // id = linkId (slide top / tunnel mouth)
  'fuseBox', // id = 'fuseBox'
  'jeep', // id = 'jeep'
  'opener', // id = 'opener' (garage door button)
  'keypad', // id = 'keypad'
  'piano', // id = trap spot id
  'item', // Gameplay only: id = item instance id
  'lock', // Gameplay only: id = LockId (padlock/plank hardware it builds)
]);

/**
 * Co-op (two players online). A solo run's one player is 'host'. In co-op the host's game runs
 * Doodle and every shared thing (items, locks, doors, traps); the guest's game mirrors it.
 */
export const PLAYER_IDS = Object.freeze({ HOST: 'host', GUEST: 'guest' });
export const PLAYER_ID_LIST = Object.freeze(Object.values(PLAYER_IDS));

/**
 * What a catch does in co-op, picked by the host in the co-op menu:
 *  shared    any catch ends the day for both players
 *  knockout  the caught player watches through the partner's eyes; the day ends when both are
 *            caught, and if the partner escapes the run is won for both
 */
export const COOP_RULES = Object.freeze({ SHARED: 'shared', KNOCKOUT: 'knockout' });
export const COOP_RULE_IDS = Object.freeze(Object.values(COOP_RULES));

export const SETTINGS_DEFAULTS = Object.freeze({
  mouseSensitivity: 1, // multiplier, 0.2 .. 3
  invertY: false,
  volume: 0.8, // 0 .. 1
  quality: 'medium', // 'low' | 'medium' | 'high' — main.js maps it to render resolution
  touchSensitivity: 1, // touch look multiplier, 0.2 .. 3 (invertY applies to touch too)
});

// ---------------------------------------------------------------------------
// Shapes (JSDoc). Factories live at fixed entry points so main.js can find them.
// ---------------------------------------------------------------------------

/**
 * @typedef {{x: number, y: number, z: number}} Vec3
 * @typedef {{minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number}} Box  world-space AABB
 * @typedef {'basement'|'ground'|'upstairs'|'attic'} FloorId
 * @typedef {'practice'|'easy'|'normal'|'hard'} Difficulty
 *
 * @typedef {Object} Spot
 * @property {string} id         unique within the world
 * @property {FloorId} floorId
 * @property {Vec3} pos          where the thing sits (an item rests here; a wall object hangs here)
 * @property {number} [rotY]     yaw the object faces
 * @property {string} [roomId]
 * @property {string} [containerId]  set when the spot is inside a drawer/chest (only reachable once it's open)
 *
 * @typedef {Spot & { kind: 'ballpit'|'chest'|'fort'|'underbed'|'wardrobe'|'cabinet', eyePos: Vec3, yaw: number, exitPos: Vec3 }} HideSpot
 *   pos = interaction point; eyePos = camera position while hidden; yaw = camera yaw while hidden;
 *   exitPos = where the player's feet go on leaving.
 * @typedef {Spot & { kind: 'creaky'|'piano'|'squeaky'|'blocks', radius: number }} TrapSpot
 * @typedef {{id: string, floorId: FloorId, pos: Vec3, color: number, intensity: number, range: number, flicker?: boolean}} Lamp
 * @typedef {{id: string, name: string, floorId: FloorId, bounds: {minX: number, maxX: number, minZ: number, maxZ: number}}} Room
 *
 * @typedef {{floorId: FloorId, i: number, j: number}} CellRef   i = column along +X, j = row along +Z
 * @typedef {Object} NavFloor
 * @property {FloorId} floorId
 * @property {number} y          floor surface height
 * @property {number} originX    world X of the grid's min corner
 * @property {number} originZ
 * @property {number} w          columns
 * @property {number} h          rows
 * @property {Uint8Array} cells  w*h flags (see NAV in navgrid.js), index = j * w + i
 * @typedef {Object} NavLink
 * @property {string} id
 * @property {'stairs'|'slide'|'tunnel'} kind
 * @property {CellRef} from
 * @property {CellRef} to
 * @property {boolean} oneWay      true = only from → to (slides)
 * @property {boolean} playerOnly  true = Doodle never uses it (slides, tunnels)
 * @property {boolean} crawl       true = player must crouch (tunnels)
 * @property {Vec3[]} points       path from `from` to `to`, at least 2 points; the mover follows it
 * @typedef {{cellSize: number, floors: Object<string, NavFloor>, links: NavLink[]}} Nav
 *
 * @typedef {Object} Door
 * @property {string} id
 * @property {FloorId} floorId
 * @property {Vec3} pos           center of the doorway at floor level
 * @property {boolean} isOpen
 * @property {boolean} locked     locked doors can't be opened by anyone (front door, garage door until unlocked)
 * @property {(open: boolean, by?: 'player'|'doodle'|'remote', opts?: {silent?: boolean}) => boolean} setOpen
 *   false if locked; emits DOOR_OPENED/CLOSED + NOISE. by 'remote' = applied from the co-op host's
 *   state. silent: true changes the door (animation, colliders) but emits nothing (co-op state sync;
 *   the sound arrives separately as a replayed event)
 * @property {(locked: boolean) => void} setLocked
 * @property {Box} collider       blocks while closed (included in world.colliders() when closed)
 * @property {CellRef[]} cells    nav cells in the doorway (flagged NAV.DOOR)
 *
 * @typedef {Object} Container
 * @property {string} id
 * @property {'drawer'|'chest'|'cabinet'|'wardrobe'} kind
 * @property {FloorId} floorId
 * @property {Vec3} pos           interaction point
 * @property {boolean} isOpen
 * @property {boolean} locked     only the attic chest starts locked
 * @property {(open: boolean, by?: 'player'|'remote', opts?: {silent?: boolean}) => boolean} setOpen
 *   false if locked; emits CONTAINER_OPENED/CLOSED (+ NOISE). by and silent work as on Door
 * @property {(locked: boolean) => void} setLocked
 * @property {Spot} itemSpot      where an item inside it rests
 *
 * @typedef {Object} Anchors
 * @property {Spot} startBed        player wakes here (pos = feet, rotY = facing)
 * @property {Spot} [startBed2]     co-op: the guest wakes here (the top bunk). Gameplay falls back to beside startBed
 * @property {Spot} kennel          Doodle sleeps here
 * @property {Spot} kennelBed       Doodle drops the fetched ball here
 * @property {Spot[]} patrol        Doodle patrol waypoints, spread over every floor
 * @property {Object<string, Spot[]>} spawns   SPAWNED_ITEMS id → candidate spots (Gameplay picks)
 * @property {HideSpot[]} hideSpots
 * @property {TrapSpot[]} traps
 * @property {Spot[]} drawings      exactly 4 crayon drawings; Gameplay writes one code digit on each
 * @property {Lamp[]} lamps
 * @property {{doorId: string, padlock: Spot, plank: Spot, keypad: Spot, exit: Spot}} frontDoor   exit = a point outside, for the escape cutscene
 * @property {{doorId: string, jeep: Spot, opener: Spot, exit: Spot}} garage
 * @property {Spot} fuseBox
 * @property {{containerId: string}} atticChest   the launcher goes in this container's itemSpot
 *
 * @typedef {Object} World  — src/world/index.js: createWorld(opts) → World
 * @property {{id: FloorId, y: number}[]} floors
 * @property {Room[]} rooms
 * @property {(floorId: FloorId) => Box[]} colliders   static boxes + currently closed doors. A box blocks a body only if their Y ranges overlap
 * @property {(x: number, z: number, floorHint: FloorId) => {y: number, floorId: FloorId}} heightAt   floor height incl. stair ramps
 * @property {(pos: Vec3, floorId: FloorId) => number} lightLevelAt   0 (pitch dark) .. 1 (well lit), ignoring the flashlight
 * @property {(pos: Vec3, floorId: FloorId) => Room|null} roomAt
 * @property {Nav} nav
 * @property {Door[]} doors
 * @property {Container[]} containers
 * @property {Anchors} anchors
 * @property {Object[]} interactables   THREE.Object3D[] tagged with userData.interact
 * @property {(dt: number, playerPos: Vec3) => void} update   lights pool, flicker, toy train, TV, teddy heads
 * @property {() => void} [dispose]
 *
 * createWorld({ scene, bus, rng, difficulty }) → World
 *
 * @typedef {Object} Player   (owned by Gameplay, exposed as gameplay.player)
 * @property {Vec3} pos               feet position
 * @property {FloorId} floorId
 * @property {number} yaw
 * @property {number} pitch
 * @property {boolean} crouched
 * @property {boolean} sprinting
 * @property {boolean} hidden
 * @property {string|null} hideSpotId
 * @property {boolean} flashlightOn
 * @property {string|null} held       ItemId in hand
 * @property {number} stamina         0 .. 1
 * @property {boolean} moving
 * @property {() => Vec3} eyePos
 * @property {() => number} visibility   0 .. 1 — how easy to see right now (light level, flashlight, crouch). 0 while hidden
 * @property {'host'|'guest'} [id]    PLAYER_IDS; 'host' in a solo run
 * @property {boolean} [onLink]       riding a slide or crawling a tunnel right now
 * @property {boolean} [down]         co-op knock-out: caught and spectating. Doodle ignores a down player
 *
 * @typedef {Object} PlayerPose   one player's state as sent to the partner, plain JSON
 * @property {'host'|'guest'} id
 * @property {Vec3} pos
 * @property {FloorId} floorId
 * @property {number} yaw
 * @property {number} pitch
 * @property {boolean} crouched
 * @property {boolean} sprinting
 * @property {boolean} moving
 * @property {boolean} hidden
 * @property {string|null} hideSpotId
 * @property {boolean} flashlightOn
 * @property {string|null} held
 * @property {boolean} onLink
 * @property {boolean} down
 *
 * @typedef {Object} Gameplay — src/gameplay/index.js: createGameplay(opts) → Gameplay
 * @property {Player} player          the local player (player.id says which one)
 * @property {Player|null} [remote]   co-op: the partner as a Player built from their poses (Doodle
 *   senses it like the local one); drawn as an avatar. null in a solo run
 * @property {(dt: number) => void} update
 * @property {(day: number) => void} startDay   put the player in startBed, re-arm traps; items/locks persist across days
 * @property {() => void} onCaught              drop the held item where the player is
 * @property {(enabled: boolean) => void} setControlsEnabled   false during cutscenes/menus (camera is then free for cutscenes)
 * @property {() => void} requestPointerLock    call from a user gesture; a no-op in touch mode (device.js)
 * @property {() => void} exitPointerLock
 * @property {() => void} [dispose]
 * @property {{giveItem: (id: string) => void, setNoclip: (on: boolean) => void, teleport: (pos: Vec3, floorId: FloorId) => void, openAllLocks: () => void, keypadCode: () => string}} [debug]
 *
 * Co-op hooks (present when createGameplay got `coop`; see docs/CONTRACTS.md, "Co-op"):
 * @property {() => PlayerPose} [pose]                       the local player's pose, sent ~10 Hz
 * @property {(pose: PlayerPose|null) => void} [setRemotePose]   the partner's latest pose (null: partner left)
 * @property {() => Object} [snapshot]                       host: every shared thing, plain JSON (Gameplay's own format)
 * @property {(snap: Object) => void} [applySnapshot]        guest: mirror the host's snapshot, idempotently and silently
 * @property {(fn: (intent: Object) => void) => void} [setIntentSink]   guest: where its actions go instead of running here
 * @property {(playerId: 'host'|'guest', intent: Object) => void} [applyIntent]   host: run the guest's action on its behalf
 * @property {(playerId: 'host'|'guest', down: boolean) => void} [setDown]   knock-out: a down player can't act; its held
 *   item drops where it was caught (host). The local player's controls stay main.js's business
 *
 * createGameplay({ scene, camera, canvas, world, bus, rng, difficulty, settings, coop? }) → Gameplay
 *   coop: {role: 'host'|'guest', rule: 'shared'|'knockout'} for an online run; absent when solo.
 *   With the same seed and difficulty, both peers' Gameplay must build identical initial state
 *   (spawns, code, traps), so only changes travel. Intents and snapshots are Gameplay's own JSON;
 *   the net layer carries them as is.
 *   - main.js calls update(dt) every frame except while paused.
 *   - While controls are disabled, update() must not move the player or touch the camera
 *     (cutscenes own the camera then) and must ignore input.
 *   - Gameplay owns pointer lock: it locks on a canvas click while controls are enabled, and emits
 *     PAUSE_REQUEST when the lock is lost (Esc) while controls are enabled.
 *   - In touch mode (EVENTS.INPUT_MODE) it shows on-screen controls instead of locking the pointer, and
 *     emits PAUSE_REQUEST when the page is hidden (app switch) while controls are enabled.
 *   - It positions the camera at player.eyePos() with yaw/pitch each frame while controls are on.
 *   - Listen to SETTINGS_CHANGED for mouseSensitivity / touchSensitivity / invertY.
 *
 * @typedef {Object} DoodleModel
 * @property {Object} object3d                     THREE.Object3D root (feet at y=0, facing -Z)
 * @property {(pose: string, opts?: {loop?: boolean}) => void} setPose   one of DOODLE_POSES
 * @property {(mood: 'calm'|'hunt') => void} setMood
 * @property {(dt: number) => void} update        advance the animation
 *
 * @typedef {Object} Doodle — src/doodle/index.js: createDoodle(opts) → Doodle
 * @property {Vec3} pos
 * @property {FloorId} floorId
 * @property {number} yaw
 * @property {string} state        one of DOODLE_STATES
 * @property {number} speed        current m/s (audio uses it for the collar jingle and panting)
 * @property {DoodleModel} model
 * @property {() => {center: Vec3, radius: number}} bounds   for dart hits and cutscene framing
 * @property {(dt: number, players: Player|Player[]) => void} update  emits CAUGHT {how, playerId} when it gets
 *   a player. Co-op passes both players; it hunts whichever it senses best and skips any that is `down`
 * @property {(spot: Spot, opts?: {wakeDelay?: number}) => void} reset   start of day: back to the kennel, SLEEP for wakeDelay s
 * @property {(active: boolean) => void} setActive   false freezes AI (cutscenes, pause)
 * @property {(seconds: number) => void} stun
 * @property {() => void} [dispose]
 * @property {{path: Vec3[], target: Vec3|null, senses: Object}} [debug]
 * @property {() => Object} [snapshot]          co-op host: {pos, yaw, pitch, pose, mood, carrying, speed, state, floorId, ...}, plain JSON
 * @property {(snap: Object) => void} [applySnapshot]   co-op guest (puppet): move toward it, interpolating
 * @property {(playerId: 'host'|'guest') => void} [releaseCatch]   knock-out: let go of a caught player
 *   (who is now down) and, after a short pause, hunt the other one
 *
 * createDoodle({ scene, world, bus, rng, difficulty, puppet? }) → Doodle   (not created in practice mode)
 *   puppet: true on the co-op guest. It runs no AI and emits nothing; it just draws the host's
 *   Doodle from applySnapshot(). update(dt) still animates; setActive(false) stops it following
 *   snapshots (a cutscene owns the model then).
 *   - main.js calls update(dt, player) every frame except while paused.
 *   - While inactive (setActive(false)) it runs no AI and emits nothing, but keeps animating its
 *     model, so cutscenes can move model.object3d and call setPose().
 *   - After reset() it must put model.object3d back at its own pos.
 *   - Emit CAUGHT once per catch; main.js ignores repeats.
 *
 * @typedef {Object} Settings  — see SETTINGS_DEFAULTS
 *
 * @typedef {Object} UI — src/ui/index.js: createUI(opts) → UI
 * @property {Settings} settings                   current settings (persisted by UI in localStorage)
 * @property {() => Promise<{difficulty: Difficulty} | {coop: CoopChoice}>} showTitle
 *   co-op only when createUI got `coop` with enabled true: then the title also offers "Play with a friend"
 * @property {(info: LobbyInfo) => LobbyHandle} [showLobby]   co-op waiting room (see LobbyInfo)
 * @property {(text: string) => Promise<void>} [showMessage]  a full-screen message with an OK button
 *   ("Room not found", "Your friend left"); resolves on OK
 * @property {(day: number) => Promise<void>} showDayCard
 * @property {() => Promise<'resume'|'quit'>} showPause
 * @property {(results: {route: string, days: number, seconds: number, difficulty: Difficulty, best: boolean, coop?: {rule: 'shared'|'knockout', names: string[], canPost: boolean}}) => Promise<void>} showWin
 *   coop: a co-op win; names = [host, guest]. Only the host may post it (canPost), to that rule's co-op board
 * @property {(info: {difficulty: Difficulty, seconds: number}) => Promise<void>} showGameOver
 * @property {(visible: boolean) => void} setHudVisible
 * @property {(dt: number, ctx: {player: Player|null, doodle: Doodle|null}) => void} update   continuous HUD (stamina)
 * @property {(difficulty: Difficulty, seconds: number) => boolean} recordTime   true if it's a new best
 *
 * @typedef {{role: 'host', name: string, difficulty: Difficulty, rule: 'shared'|'knockout'} | {role: 'join', name: string, code: string}} CoopChoice
 *   name is already cleaned (leaderboard entries.js#cleanName) and passes nameProblem(); code is upper-case
 * @typedef {Object} LobbyInfo
 * @property {'host'|'guest'} role
 * @property {string} code        room code, shown big
 * @property {string} link        invite link (host: offer Copy, and Share where navigator.share exists)
 * @property {string} name        this player's name
 * @property {string|null} partnerName   null until the friend is in
 * @property {Difficulty} difficulty
 * @property {'shared'|'knockout'} rule
 * @typedef {Object} LobbyHandle
 * @property {(patch: Partial<LobbyInfo> & {status?: string}) => void} update   e.g. partner joined/left; status is a line of text
 * @property {Promise<'start'|'cancel'>} result   host: Start (enabled once partnerName is set) or Cancel;
 *   guest: only Cancel (main.js closes the lobby itself when the host starts)
 * @property {() => void} close
 *
 * createUI({ root /* HTMLElement *\/, bus, leaderboard?, coop? }) → UI
 *   coop: {enabled: boolean, code?: string}. code = a ?join= link was opened: go straight to joining it.
 *   leaderboard is optional: when it's null/undefined or `enabled` is false, the UI shows nothing
 *   of it. Otherwise the title offers a Leaderboard panel, and showWin offers to post the run
 *   (or says test runs don't count, when `canSubmit` is false). The stub UI ignores it.
 *
 * @typedef {Object} LeaderboardEntry
 * @property {string} id         Firestore document id
 * @property {string} name       1–6 of A–Z 0–9
 * @property {string} [name2]    co-op boards: the guest's name
 * @property {number} seconds    run time (state.seconds), 2 decimals
 * @property {number} days       days used, 1..MAX_DAYS
 * @property {'frontDoor'|'garage'} route
 * @property {string|null} at    when it was posted (ISO time)
 *
 * @typedef {Object} Leaderboard — src/leaderboard/client.js: createLeaderboard(opts) → Leaderboard
 *   (src/leaderboard/fake.js: createFakeLeaderboard(opts) has the same shape, for ?board=fake and tests)
 * @property {boolean} enabled     false when no Firebase project is configured
 * @property {boolean} canSubmit   enabled, and not a dev run (debug/seed/real/stub/tick params)
 * @property {(difficulty: Difficulty, limit?: number, opts?: {coop?: 'shared'|'knockout'}) => Promise<LeaderboardEntry[]>} top   fastest first, default 10
 * @property {(run: {name: string, name2?: string, seconds: number, days: number, route: string, difficulty: Difficulty, coop?: 'shared'|'knockout'}) => Promise<{id: string, rank: number|null, entry: LeaderboardEntry}>} submit
 *   validates (src/leaderboard/entries.js), posts, then looks up the place; rank is null if that lookup failed.
 *   coop + name2: a co-op run, posted to that rule's co-op board
 * @property {(difficulty: Difficulty, seconds: number, opts?: {coop?: 'shared'|'knockout'}) => Promise<number>} rankOf   1 + runs strictly faster
 *   Every failure rejects with an Error whose `kind` is 'offline' | 'rejected' | 'server' | 'disabled' | 'invalid'
 *   and whose message can be shown to the player.
 *
 * @typedef {Object} Cutscenes — src/ui/index.js: createCutscenes(opts) → Cutscenes
 * @property {(ctx: {player: Player, doodle: Doodle, world: World, knockout?: boolean}) => Promise<void>} playCatch
 *   knockout: the run goes on with the partner, so end on the lick without fading to black
 * @property {(ctx: {player: Player, doodle: Doodle, world: World}) => Promise<void>} playGameOver
 * @property {(ctx: {route: string, player: Player, world: World}) => Promise<void>} playEscape
 * @property {(ctx: {day: number}) => Promise<void>} playWake
 *
 * createCutscenes({ camera, getScene, ui, bus }) → Cutscenes
 *   getScene() returns the current run's THREE.Scene (it's rebuilt every run). main.js keeps
 *   rendering every frame, so a cutscene only moves the camera / Doodle model / overlays and
 *   resolves its promise when done. Cutscenes may add temporary objects to the scene but must
 *   remove them before resolving.
 *
 * @typedef {Object} Audio — src/audio/index.js: createAudio(opts) → Audio
 * @property {() => void} unlock     call from a user gesture (browser autoplay rules)
 * @property {(v: number) => void} setVolume
 * @property {(dt: number, ctx: {camera: Object, player: Player|null, doodle: Doodle|null, world: World|null, remote?: Player|null}) => void} update
 *   remote: the co-op partner (their flashlight, their footsteps' position)
 * @property {() => void} [dispose]
 *
 * createAudio({ bus, camera }) → Audio
 */

// ---------------------------------------------------------------------------
// Validation — used by tests/core/contracts.test.js on the fixture now, and on
// the real World at integration. World's own tests should run it too.
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => v && isNum(v.x) && isNum(v.y) && isNum(v.z);
const isBox = (b) =>
  b && ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every((k) => isNum(b[k])) && b.minX <= b.maxX && b.minY <= b.maxY && b.minZ <= b.maxZ;

/**
 * Check a World against the contract.
 * @param {World} world
 * @param {{requireMeshes?: boolean}} [opts]  requireMeshes: also check world.interactables are tagged Object3Ds
 * @returns {string[]} errors (empty = valid)
 */
export function validateWorld(world, { requireMeshes = false } = {}) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!world || typeof world !== 'object') return ['world is not an object'];

  // floors
  const floorIds = new Set();
  if (!Array.isArray(world.floors) || world.floors.length === 0) err('floors must be a non-empty array');
  else
    for (const f of world.floors) {
      if (!FLOOR_IDS.includes(f.id)) err(`floors: unknown floor id "${f.id}"`);
      if (floorIds.has(f.id)) err(`floors: duplicate "${f.id}"`);
      if (!isNum(f.y)) err(`floors: "${f.id}" has no numeric y`);
      floorIds.add(f.id);
    }
  const validFloor = (id) => floorIds.has(id);

  // functions
  for (const fn of ['colliders', 'heightAt', 'lightLevelAt', 'roomAt', 'update']) {
    if (typeof world[fn] !== 'function') err(`${fn} must be a function`);
  }
  if (typeof world.colliders === 'function')
    for (const id of floorIds) {
      const boxes = world.colliders(id);
      if (!Array.isArray(boxes)) err(`colliders("${id}") must return an array`);
      else boxes.forEach((b, k) => isBox(b) || err(`colliders("${id}")[${k}] is not a valid Box`));
    }

  // rooms
  if (!Array.isArray(world.rooms) || world.rooms.length === 0) err('rooms must be a non-empty array');
  else
    for (const r of world.rooms) {
      if (typeof r.id !== 'string' || typeof r.name !== 'string') err(`room needs string id and name: ${JSON.stringify(r.id)}`);
      if (!validFloor(r.floorId)) err(`room "${r.id}" has unknown floorId "${r.floorId}"`);
      const b = r.bounds;
      if (!b || ![b.minX, b.maxX, b.minZ, b.maxZ].every(isNum)) err(`room "${r.id}" needs numeric bounds`);
    }

  // nav
  const nav = world.nav;
  const validRef = (ref) => {
    const g = nav?.floors?.[ref?.floorId];
    return g && Number.isInteger(ref.i) && Number.isInteger(ref.j) && ref.i >= 0 && ref.j >= 0 && ref.i < g.w && ref.j < g.h;
  };
  if (!nav || !isNum(nav.cellSize) || nav.cellSize <= 0) err('nav.cellSize must be a positive number');
  if (!nav?.floors) err('nav.floors missing');
  else
    for (const id of floorIds) {
      const g = nav.floors[id];
      if (!g) {
        err(`nav.floors["${id}"] missing`);
        continue;
      }
      if (g.floorId !== id) err(`nav.floors["${id}"].floorId mismatch`);
      if (![g.y, g.originX, g.originZ].every(isNum)) err(`nav.floors["${id}"] needs numeric y, originX, originZ`);
      if (!Number.isInteger(g.w) || !Number.isInteger(g.h) || g.w <= 0 || g.h <= 0) err(`nav.floors["${id}"] needs positive integer w, h`);
      if (!(g.cells instanceof Uint8Array) || g.cells.length !== g.w * g.h) err(`nav.floors["${id}"].cells must be a Uint8Array of length w*h`);
    }
  if (!Array.isArray(nav?.links)) err('nav.links must be an array');
  else {
    const linkIds = new Set();
    for (const l of nav.links) {
      if (linkIds.has(l.id)) err(`nav link duplicate id "${l.id}"`);
      linkIds.add(l.id);
      if (!LINK_KINDS.includes(l.kind)) err(`nav link "${l.id}" has unknown kind "${l.kind}"`);
      if (!validRef(l.from) || !validRef(l.to)) err(`nav link "${l.id}" has an out-of-range from/to cell`);
      for (const k of ['oneWay', 'playerOnly', 'crawl']) if (typeof l[k] !== 'boolean') err(`nav link "${l.id}".${k} must be boolean`);
      if (!Array.isArray(l.points) || l.points.length < 2 || !l.points.every(isVec3)) err(`nav link "${l.id}".points needs ≥2 Vec3`);
    }
  }

  const checkSpot = (s, where) => {
    if (!s || typeof s.id !== 'string') return err(`${where}: spot needs a string id`);
    if (!validFloor(s.floorId)) err(`${where} "${s.id}": unknown floorId "${s.floorId}"`);
    if (!isVec3(s.pos)) err(`${where} "${s.id}": pos must be a Vec3`);
    if (s.containerId !== undefined && !world.containers?.some((c) => c.id === s.containerId))
      err(`${where} "${s.id}": containerId "${s.containerId}" doesn't exist`);
  };

  // doors
  const doorIds = new Set();
  if (!Array.isArray(world.doors)) err('doors must be an array');
  else
    for (const d of world.doors) {
      if (doorIds.has(d.id)) err(`door duplicate id "${d.id}"`);
      doorIds.add(d.id);
      if (!validFloor(d.floorId)) err(`door "${d.id}" unknown floorId`);
      if (!isVec3(d.pos)) err(`door "${d.id}".pos must be a Vec3`);
      if (typeof d.isOpen !== 'boolean' || typeof d.locked !== 'boolean') err(`door "${d.id}" needs boolean isOpen and locked`);
      if (typeof d.setOpen !== 'function' || typeof d.setLocked !== 'function') err(`door "${d.id}" needs setOpen and setLocked`);
      if (!isBox(d.collider)) err(`door "${d.id}".collider must be a Box`);
      if (!Array.isArray(d.cells) || !d.cells.every(validRef)) err(`door "${d.id}".cells must be valid CellRefs`);
    }

  // containers
  const containerIds = new Set();
  if (!Array.isArray(world.containers)) err('containers must be an array');
  else
    for (const c of world.containers) {
      if (containerIds.has(c.id)) err(`container duplicate id "${c.id}"`);
      containerIds.add(c.id);
      if (!CONTAINER_KINDS.includes(c.kind)) err(`container "${c.id}" unknown kind "${c.kind}"`);
      if (!validFloor(c.floorId)) err(`container "${c.id}" unknown floorId`);
      if (!isVec3(c.pos)) err(`container "${c.id}".pos must be a Vec3`);
      if (typeof c.isOpen !== 'boolean' || typeof c.locked !== 'boolean') err(`container "${c.id}" needs boolean isOpen and locked`);
      if (typeof c.setOpen !== 'function' || typeof c.setLocked !== 'function') err(`container "${c.id}" needs setOpen and setLocked`);
      checkSpot(c.itemSpot, `container "${c.id}".itemSpot`);
    }

  // anchors
  const a = world.anchors;
  if (!a) err('anchors missing');
  else {
    for (const k of ['startBed', 'kennel', 'kennelBed', 'fuseBox']) checkSpot(a[k], `anchors.${k}`);
    if (!Array.isArray(a.patrol) || a.patrol.length < 3) err('anchors.patrol needs at least 3 spots');
    else a.patrol.forEach((s) => checkSpot(s, 'anchors.patrol'));
    if (!a.spawns) err('anchors.spawns missing');
    else
      for (const item of SPAWNED_ITEMS) {
        const list = a.spawns[item];
        if (!Array.isArray(list) || list.length === 0) err(`anchors.spawns.${item} needs at least one candidate spot`);
        else list.forEach((s) => checkSpot(s, `anchors.spawns.${item}`));
      }
    if (!Array.isArray(a.hideSpots) || a.hideSpots.length === 0) err('anchors.hideSpots needs at least one spot');
    else
      for (const h of a.hideSpots) {
        checkSpot(h, 'anchors.hideSpots');
        if (!HIDE_KINDS.includes(h.kind)) err(`hide spot "${h.id}" unknown kind "${h.kind}"`);
        if (!isVec3(h.eyePos) || !isVec3(h.exitPos) || !isNum(h.yaw)) err(`hide spot "${h.id}" needs eyePos, exitPos, yaw`);
      }
    if (!Array.isArray(a.traps)) err('anchors.traps must be an array');
    else
      for (const t of a.traps) {
        checkSpot(t, 'anchors.traps');
        if (!TRAP_KINDS.includes(t.kind)) err(`trap "${t.id}" unknown kind "${t.kind}"`);
        if (!isNum(t.radius)) err(`trap "${t.id}" needs a numeric radius`);
      }
    if (!Array.isArray(a.drawings) || a.drawings.length !== 4) err('anchors.drawings must have exactly 4 spots');
    else a.drawings.forEach((s) => checkSpot(s, 'anchors.drawings'));
    if (!Array.isArray(a.lamps)) err('anchors.lamps must be an array');
    else
      for (const l of a.lamps) {
        if (typeof l.id !== 'string' || !validFloor(l.floorId) || !isVec3(l.pos) || !isNum(l.intensity) || !isNum(l.range))
          err(`lamp "${l.id}" needs id, floorId, pos, intensity, range`);
      }
    const fd = a.frontDoor;
    if (!fd) err('anchors.frontDoor missing');
    else {
      if (!doorIds.has(fd.doorId)) err(`anchors.frontDoor.doorId "${fd.doorId}" isn't a door`);
      for (const k of ['padlock', 'plank', 'keypad', 'exit']) checkSpot(fd[k], `anchors.frontDoor.${k}`);
    }
    const g = a.garage;
    if (!g) err('anchors.garage missing');
    else {
      if (!doorIds.has(g.doorId)) err(`anchors.garage.doorId "${g.doorId}" isn't a door`);
      for (const k of ['jeep', 'opener', 'exit']) checkSpot(g[k], `anchors.garage.${k}`);
    }
    if (!a.atticChest || !containerIds.has(a.atticChest.containerId)) err('anchors.atticChest.containerId must name a container');
  }

  // interactables
  if (!Array.isArray(world.interactables)) err('interactables must be an array');
  else if (requireMeshes)
    world.interactables.forEach((o, k) => {
      const tag = o?.userData?.interact;
      if (!tag || !INTERACT_KINDS.includes(tag.kind) || typeof tag.id !== 'string')
        err(`interactables[${k}] needs userData.interact = {kind, id}`);
    });

  // functional spot checks
  if (typeof world.heightAt === 'function' && world.anchors?.startBed) {
    const s = world.anchors.startBed;
    const h = world.heightAt(s.pos.x, s.pos.z, s.floorId);
    if (!h || !isNum(h.y) || !validFloor(h.floorId)) err('heightAt must return {y, floorId}');
  }
  if (typeof world.lightLevelAt === 'function' && world.anchors?.startBed) {
    const l = world.lightLevelAt(world.anchors.startBed.pos, world.anchors.startBed.floorId);
    if (!isNum(l) || l < 0 || l > 1) err('lightLevelAt must return a number in [0, 1]');
  }

  return errors;
}
