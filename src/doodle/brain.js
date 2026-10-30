// Doodle's brain: everything about the Doodle except its mesh. Pure logic (no
// three), so node --test drives it on the mini-house fixture. index.js wraps
// it with the model to make the contract's Doodle object.
//
// States (DOODLE_STATES):
//   SLEEP ─wakeDelay─▶ PATROL ◀───────────────────────────────┐
//   PATROL/SEARCH/SNIFF ─NOISE heard─▶ INVESTIGATE ─linger─▶ PATROL
//   PATROL/SEARCH/INVESTIGATE ─fresh scent─▶ SNIFF ─trail ends─▶ SEARCH
//   any awake ─sees you long enough─▶ CHASE ─lost you─▶ SEARCH ─time─▶ PATROL
//   ─treat / ball─▶ DISTRACTED ─eaten / returned─▶ PATROL
//   ─dart hit─▶ STUNNED ─stunTime─▶ INVESTIGATE (where the dart came from)
//   ─within catchRange─▶ CATCH (until reset)
//   CATCH ─releaseCatch (co-op knock-out)─▶ SEARCH, paused ─releasePause─▶ INVESTIGATE near the other player
//
// Co-op: update() takes one Player or several. What it knows about "the player"
// is kept per player id (see person()), and it hunts one target at a time.

import { EVENTS } from '../core/events.js';
import { DOODLE_BODY, DOODLE_STATES as S, ITEMS } from '../core/contracts.js';
import { copy, dist2D, yawTo } from '../core/math.js';
import { NAV, cellCenter, flagsAt, worldToCell } from '../core/navgrid.js';
import { tuningFor } from './tuning.js';
import { lineWalkable, lockedCells, planRoute, snapCell, doodlePassable } from './path.js';
import { createMover, turnToward } from './mover.js';
import { canReach, dartHits, floorAt, floorRanks, floorsApart, hear, look, segmentBlocked, sightRange } from './senses.js';
import { createScent } from './scent.js';

const AWAKE_SMELL_EVERY = 0.25; // s between scent checks
const DOOR_NOISE_MEMORY = 2; // s: door noises near a door it just opened are its own
const FLOOR_COST = 6; // m a floor apart counts as, when ranking who's nearest

const NO_SIGHT = (reason) => ({ visible: false, dist: Infinity, range: 0, reason });
/** Contract: a missing playerId (solo, or the local player) means the host. */
const idOf = (p) => p?.id ?? 'host';
const round = (n, k = 1000) => Math.round(n * k) / k;

/**
 * @param {{world: Object, bus: Object, rng: Object, difficulty?: string, tuning?: Object}} opts
 *   tuning: overrides on top of tuningFor(difficulty) (tests use this)
 * @returns {Object} the contract's Doodle, minus `model`
 */
export function createDoodleCore({ world, bus, rng, difficulty = 'normal', tuning = null }) {
  const T = { ...tuningFor(difficulty), ...(tuning ?? {}) };
  const nav = world.nav;
  const ranks = floorRanks(world);
  const mover = createMover(world);
  const anchors = world.anchors;

  const doodle = {
    pos: copy(anchors.kennel.pos),
    floorId: anchors.kennel.floorId,
    yaw: anchors.kennel.rotY ?? 0,
    pitch: 0, // body slope on stairs (radians, + = nose up)
    state: S.SLEEP,
    speed: 0,
    pose: 'sleep', // what the model should show (index.js applies it)
    mood: 'calm',
    carrying: null, // 'ball' while it has the tennis ball in its mouth
    tuning: T,
    bounds,
    update,
    reset,
    setActive,
    stun: (seconds) => stun(seconds, null),
    releaseCatch,
    snapshot,
    dispose,
    get active() {
      return active;
    },
    debug: { path: [], target: null, senses: {} },
  };

  // ---- memory ---------------------------------------------------------------
  let active = false;
  let clock = 0; // advances only while active
  let stateTime = 0;
  let task = {}; // per-state working data, replaced on every state change
  let sleepLeft = 8;
  let stunLeft = 0;
  let caught = false;

  // What it knows about each player, keyed by player.id ('host' for a solo player with no id).
  // Co-op passes two players; everything about "the player" below lives in one of these.
  const people = new Map();
  let target = null; // the record it's hunting (or would hunt), see pickTarget()
  let targetSince = -Infinity;
  let sight = NO_SIGHT('asleep'); // target's sight this frame

  let lastHeard = null; // {pos, floorId, t, loudness, kind}
  let lastNoise = null; // for the debug overlay, heard or not

  let ball = null; // {pos, floorId, phase: 'loose'|'fetch'|'carry', ignoreUntil}
  const treats = new Map(); // treatId → {id, pos, floorId, ignored}

  let goal = null; // current travel target {pos, floorId, complete, failed, replanAt}
  let lungeLeft = 0;
  let lungeReadyAt = 0;
  let movedThisFrame = 0;
  let lookingAround = false;
  let smellAt = 0;
  let sniffedUpTo = -Infinity; // scent at least this fresh has already been followed to its spot
  let currentAnchor = null;
  let openingDoor = false;
  const recentDoors = []; // {pos, t}

  // ---- events ---------------------------------------------------------------
  // Contract: while inactive the Doodle emits nothing.
  const say = (type, payload = {}) => {
    if (active) bus.emit(type, payload);
  };
  const offs = [];
  const on = (type, fn) => offs.push(bus.on(type, fn));

  function setState(next, data = {}) {
    const prev = doodle.state;
    doodle.state = next;
    task = data;
    stateTime = 0;
    goal = null; // the mover keeps any stairs it's halfway up; travel() re-plans after
    lungeLeft = 0;
    doodle.mood = next === S.CHASE || next === S.CATCH ? 'hunt' : 'calm';
    if (next === prev) return;
    say(EVENTS.DOODLE_STATE, { state: next, prev });
    if (next === S.CHASE) say(EVENTS.SPOTTED, { pos: copy(doodle.pos) });
    if (prev === S.CHASE && next !== S.CATCH) say(EVENTS.LOST_TRACK, {});
  }

  // ---- movement ---------------------------------------------------------------

  /**
   * Walk toward a target along an A* route, re-planning when the target moves.
   * @returns {{arrived: boolean, failed?: boolean, complete?: boolean}}
   */
  function travel(dt, pos, floorId, speed, { replanEvery = 0, snapDist = 2 } = {}) {
    const needPlan = !goal || goal.floorId !== floorId || dist2D(goal.pos, pos) > 0.5 || clock >= goal.replanAt;
    if (needPlan && mover.onLink) {
      // Halfway up the stairs: finish them before re-planning from solid ground.
      movedThisFrame += mover.step(doodle, dt, speed, T.turnRate).moved;
      return { arrived: false };
    }
    if (needPlan) plan(pos, floorId, snapDist, replanEvery);
    if (goal.failed) return { arrived: true, failed: true };
    for (const door of mover.doorsAhead(doodle)) {
      if (door.locked) {
        plan(pos, floorId, snapDist, replanEvery); // A* now routes around it
        break;
      }
      openDoor(door);
    }
    const r = mover.step(doodle, dt, speed, T.turnRate);
    movedThisFrame += r.moved;
    return { arrived: r.arrived, complete: goal.complete };
  }

  function plan(pos, floorId, snapDist, replanEvery) {
    const p = planRoute(world, doodle.pos, doodle.floorId, pos, floorId, { snapDist });
    goal = {
      pos: copy(pos),
      floorId,
      complete: p.complete,
      failed: !p.goal,
      replanAt: replanEvery > 0 ? clock + replanEvery : Infinity,
    };
    mover.setRoute(p.route);
  }

  function openDoor(door) {
    openingDoor = true;
    try {
      door.setOpen(true, 'doodle');
    } finally {
      openingDoor = false;
    }
    recentDoors.push({ pos: copy(door.pos), t: clock });
    if (recentDoors.length > 8) recentDoors.shift();
  }

  /** Sweep the body left and right while standing: "looking around". */
  function lookAround(dt) {
    lookingAround = true;
    doodle.yaw += Math.sin(stateTime * 1.7) * 1.4 * dt;
  }

  function face(pos, dt) {
    turnToward(doodle, yawTo(doodle.pos, pos), T.turnRate, dt);
  }

  // ---- perception helpers -------------------------------------------------------

  const ownNoise = (n) =>
    openingDoor || (n.kind === 'door' && recentDoors.some((d) => clock - d.t < DOOR_NOISE_MEMORY && dist2D(d.pos, n.pos) < 2.5));

  const smellReach = (r, floorId) => r * T.nose * T.smellFloorDamping ** floorsApart(ranks, floorId, doodle.floorId);
  const smellsTreat = (t) => !t.ignored && dist2D(t.pos, doodle.pos) <= smellReach(T.treatSmellRange, t.floorId);
  const hearsBall = (b) => hear({ pos: b.pos, floorId: b.floorId, loudness: T.ballHearRadius }, doodle, ranks, T).heard;

  function seesBall(b) {
    if (b.floorId !== doodle.floorId || dist2D(b.pos, doodle.pos) > T.ballSpotRange) return false;
    const eye = { x: doodle.pos.x, y: doodle.pos.y + 1.3, z: doodle.pos.z };
    return !segmentBlocked(world, [doodle.floorId], eye, { x: b.pos.x, y: b.pos.y + 0.1, z: b.pos.z });
  }

  /** Close enough to grab something on the floor (or on low furniture). */
  const reached = (pos, floorId) => floorId === doodle.floorId && dist2D(doodle.pos, pos) <= T.itemReach + 0.5;

  // ---- players ---------------------------------------------------------------------

  function person(id) {
    let rec = people.get(id);
    if (!rec) {
      rec = {
        id,
        player: null, // the Player passed this frame, null when it wasn't
        hasId: false, // the Player carries its own id (CAUGHT then names it)
        down: false,
        released: false, // let go after a knock-out catch: ignored until reset()
        sight: NO_SIGHT('no player'),
        awareness: 0, // 0..1, spotted at 1
        seenAt: -Infinity,
        lastSeen: null, // {pos, floorId, t}
        inLink: false, // in a slide/tunnel
        blindUntil: -Infinity,
        hide: null, // {spotId, pos, floorId, since, playerId}
        scent: createScent(T, ranks),
      };
      people.set(id, rec);
    }
    return rec;
  }

  /** In play: not down and not let go of. Its Player may still be missing this frame. */
  const live = (rec) => !!rec && !rec.down && !rec.released;
  const here = (rec) => live(rec) && !!rec.player;
  const floorDist = (p) => dist2D(p.pos, doodle.pos) + floorsApart(ranks, p.floorId, doodle.floorId) * FLOOR_COST;

  /** Take this frame's players: a Player, an array of them, or nothing. */
  function takePlayers(players) {
    for (const rec of people.values()) rec.player = null;
    for (const p of [].concat(players ?? [])) {
      if (!p) continue;
      const rec = person(idOf(p));
      rec.player = p;
      rec.hasId = p.id !== undefined;
      rec.down = !!p.down;
    }
  }

  /**
   * Who to hunt: the visible player it's most aware of, otherwise the nearest. The current
   * target keeps a margin and, while it's in view, at least targetHold s, so two players at
   * similar ranges don't make it flip-flop. Mid-chase it only switches to someone it has
   * properly spotted, never to someone it merely knows is closer.
   */
  function pickTarget() {
    const cur = here(target) ? target : null;
    if (target && !live(target)) target = null;
    const chasing = doodle.state === S.CHASE;
    if (chasing && task.pullOut && here(people.get(task.pullOut.playerId))) return setTarget(people.get(task.pullOut.playerId));
    const score = (rec) => {
      const mine = rec === cur;
      if (rec.sight.visible) {
        if (chasing && !mine && rec.awareness < 1) return -Infinity;
        return 100 + 10 * (rec.awareness + (mine ? T.targetStick : 0));
      }
      if (chasing && !mine) return -Infinity;
      return -floorDist(rec.player) + (mine ? T.targetStickDist : 0);
    };
    let best = cur;
    let bestScore = cur ? score(cur) : -Infinity;
    for (const rec of people.values()) {
      if (rec === cur || !here(rec)) continue;
      const s = score(rec);
      if (s > bestScore) [best, bestScore] = [rec, s];
    }
    if (!best) return; // nobody here this frame: keep remembering whoever it was after
    if (cur && best !== cur && cur.sight.visible && clock - targetSince < T.targetHold) return;
    setTarget(best);
  }

  function setTarget(rec) {
    if (rec === target) return;
    const had = target;
    target = rec;
    targetSince = clock;
    if (had && doodle.state === S.CHASE) {
      // Switching quarry mid-chase: start the chase bookkeeping over on the new one.
      task.lostFor = 0;
      task.stuckFor = 0;
      goal = null;
    }
  }

  // ---- per-frame ---------------------------------------------------------------

  function update(dt, players) {
    if (!active || !(dt > 0)) {
      doodle.speed = 0;
      return;
    }
    clock += dt;
    stateTime += dt;
    movedThisFrame = 0;
    lookingAround = false;
    takePlayers(players);
    for (const rec of people.values()) {
      const p = here(rec) ? rec.player : null;
      rec.scent.update(clock, dt, p, p?.hidden ? rec.hide : null);
    }
    think(dt);
    const instant = movedThisFrame / dt;
    doodle.speed += (instant - doodle.speed) * Math.min(1, dt * 12);
    if (doodle.speed < 0.02) doodle.speed = 0;
    doodle.pose = poseFor();
    writeDebug();
  }

  function think(dt) {
    const st = doodle.state;
    if (st === S.CATCH) return;
    if (st === S.SLEEP) {
      sleepLeft -= dt;
      if (sleepLeft <= 0) wake();
      return;
    }
    if (st === S.STUNNED) {
      stunLeft -= dt;
      if (stunLeft <= 0) recover();
      return;
    }

    const eating = st === S.DISTRACTED && task.mode === 'eat';
    for (const rec of people.values()) {
      const p = here(rec) ? rec.player : null;
      rec.sight = p ? look(doodle, p, world, T, { blind: eating || rec.inLink || clock < rec.blindUntil }) : NO_SIGHT('no player');
      if (rec.sight.visible) {
        rec.seenAt = clock;
        rec.lastSeen = { pos: copy(p.pos), floorId: p.floorId, t: clock };
        rec.awareness = Math.min(1, rec.awareness + dt / (T.spotTime + T.spotTimePerMeter * rec.sight.dist));
      } else rec.awareness = Math.max(0, rec.awareness - dt * 0.5);
    }
    pickTarget();
    sight = target?.sight ?? NO_SIGHT('no player');

    if (resting()) return search(dt); // the pause after a knock-out catch: no catching either
    if (tryCatchAny()) return;

    // Heading for a treat or the ball it only has eyes for that; carrying the
    // ball home it still notices you (and drops the ball to chase).
    const focused = st === S.DISTRACTED && task.mode !== 'carry';
    if (st !== S.CHASE && !focused && sight.visible && target.awareness >= 1) {
      if (ball?.phase === 'carry') dropBall();
      setState(S.CHASE, { lostFor: 0, stuckFor: 0, pullOut: null });
    }

    switch (doodle.state) {
      case S.PATROL:
        return patrol(dt);
      case S.INVESTIGATE:
        return investigate(dt);
      case S.SNIFF:
        return sniff(dt);
      case S.SEARCH:
        return search(dt);
      case S.CHASE:
        return chase(dt);
      case S.DISTRACTED:
        return distracted(dt);
    }
  }

  /** Every player in reach gets checked, the target first. */
  function tryCatchAny() {
    if (caught) return false;
    if (here(target) && tryCatch(target)) return true;
    for (const rec of people.values()) if (rec !== target && here(rec) && tryCatch(rec)) return true;
    return false;
  }

  function tryCatch(rec) {
    const player = rec.player;
    if (caught || player.hidden || player.floorId !== doodle.floorId) return false;
    if (dist2D(doodle.pos, player.pos) > DOODLE_BODY.catchRange) return false;
    const cell = worldToCell(nav, player.floorId, player.pos.x, player.pos.z);
    if (cell && flagsAt(nav, cell) & NAV.PLAYER_ONLY) return false; // safe inside a crawl tunnel
    if (!canReach(doodle, player, world)) return false; // not through walls or closed doors
    doodle.yaw = yawTo(doodle.pos, player.pos);
    catchPlayer('tackle', rec);
    return true;
  }

  function catchPlayer(how, rec) {
    if (caught) return;
    caught = true;
    setState(S.CATCH, { how, playerId: rec.id });
    // A Player without an id is the solo player: CAUGHT stays {how}, as before co-op.
    say(EVENTS.CAUGHT, rec.hasId ? { how, playerId: rec.id } : { how });
  }

  // ---- states ---------------------------------------------------------------------

  function wake() {
    if (ball?.phase === 'carry') return setState(S.DISTRACTED, { mode: 'carry' });
    if (lastHeard && clock - lastHeard.t < 6) return setState(S.INVESTIGATE, { pos: lastHeard.pos, floorId: lastHeard.floorId });
    setState(S.PATROL);
  }

  /** Treats in range or a loose ball it notices pull it off whatever calm thing it's doing. */
  function checkDistractions() {
    for (const t of treats.values())
      if (smellsTreat(t)) {
        setState(S.DISTRACTED, { mode: 'treat', treat: t });
        return true;
      }
    if (ball?.phase === 'loose' && clock >= ball.ignoreUntil && seesBall(ball)) {
      ball.phase = 'fetch';
      setState(S.DISTRACTED, { mode: 'ball' });
      return true;
    }
    return false;
  }

  /** The freshest scent within reach across every player still in play, tagged with whose it is. */
  function smell(opts) {
    let best = null;
    for (const rec of people.values()) {
      if (!live(rec)) continue;
      const s = rec.scent.smell(clock, doodle.pos, doodle.floorId, opts);
      if (s && (!best || s.t > best.t)) best = { ...s, playerId: rec.id };
    }
    return best;
  }

  /** Fresh scent nearby starts a SNIFF. */
  function checkScent() {
    if (clock < smellAt) return false;
    smellAt = clock + AWAKE_SMELL_EVERY;
    const trail = smell({ after: sniffedUpTo, maxAge: T.sniffFresh * T.nose });
    if (!trail) return false;
    setState(S.SNIFF, { target: trail, after: sniffedUpTo, refreshAt: clock + 0.5 });
    return true;
  }

  function patrol(dt) {
    if (checkDistractions() || checkScent()) return;
    if (task.lingerLeft > 0) {
      task.lingerLeft -= dt;
      lookAround(dt);
      if (task.lingerLeft <= 0) task.anchor = null;
      return;
    }
    if (!task.anchor) task.anchor = pickAnchor();
    if (!task.anchor) return;
    const r = travel(dt, task.anchor.pos, task.anchor.floorId, T.patrolSpeed);
    if (r.arrived) {
      currentAnchor = task.anchor;
      task.lingerLeft = r.failed ? 0.5 : rng.range(T.patrolLinger[0], T.patrolLinger[1]);
    }
  }

  /** Weighted pick of the next patrol anchor: nearer ones and ones near the last heard noise win more often. */
  function pickAnchor() {
    const list = anchors.patrol;
    if (!list.length) return null;
    const heardAge = lastHeard ? clock - lastHeard.t : Infinity;
    const weights = list.map((a) => {
      if (a === currentAnchor && list.length > 1) return 0;
      const away = dist2D(a.pos, doodle.pos) + floorsApart(ranks, a.floorId, doodle.floorId) * 6;
      let w = 1 / (1 + away / 20);
      if (heardAge < T.driftMemory) {
        const fromNoise = dist2D(a.pos, lastHeard.pos) + floorsApart(ranks, a.floorId, lastHeard.floorId) * 6;
        w += T.driftWeight * Math.exp(-fromNoise / 6) * (1 - heardAge / T.driftMemory);
      }
      return w;
    });
    let roll = rng.next() * weights.reduce((s, w) => s + w, 0);
    for (let k = 0; k < list.length; k++) {
      roll -= weights[k];
      if (roll <= 0 && weights[k] > 0) return list[k];
    }
    return list[weights.findLastIndex((w) => w > 0)] ?? list[0];
  }

  function investigate(dt) {
    if (checkDistractions()) return;
    if (!task.arrived) {
      if (travel(dt, task.pos, task.floorId, T.investigateSpeed).arrived) {
        task.arrived = true;
        task.lingerLeft = T.investigateLinger;
      }
      return;
    }
    lookAround(dt);
    if (checkScent()) return;
    task.lingerLeft -= dt;
    if (task.lingerLeft <= 0) setState(S.PATROL);
  }

  function sniff(dt) {
    if (checkDistractions()) return;
    const trail = task.target;
    if (task.checking) return checkHideSpot(dt, people.get(trail.playerId), trail.pool);
    if (clock >= task.refreshAt) {
      task.refreshAt = clock + 0.5;
      const fresher = smell({ after: Math.max(task.after, trail.t) });
      if (fresher && fresher.t > trail.t) task.target = fresher;
    }
    if (!travel(dt, task.target.pos, task.target.floorId, T.sniffSpeed, { snapDist: 2.5 }).arrived) return;
    const got = task.target;
    const owner = people.get(got.playerId);
    sniffedUpTo = Math.max(sniffedUpTo, got.t);
    if (got.kind === 'pool') {
      if (got.pool.hideSpotId && owner?.hide?.spotId === got.pool.hideSpotId) {
        task.checking = true;
        task.checkFor = 0;
        return;
      }
      owner?.scent.markChecked(got.pool, clock, T.poolRecheck);
    }
    task.after = got.t;
    const next = smell({ after: task.after });
    if (next) task.target = next;
    else setState(S.SEARCH, { center: copy(doodle.pos), floorId: doodle.floorId, left: T.searchTime * 0.5 });
  }

  /** Nose at a hiding spot: a hide that's gone on long enough gets pulled out. */
  function checkHideSpot(dt, rec, pool) {
    task.checkFor += dt;
    lookingAround = true;
    face(pool.pos, dt);
    const hide = rec?.hide;
    const stillThere = live(rec) && hide && hide.spotId === pool.hideSpotId && rec.player?.hidden;
    if (stillThere && task.checkFor >= 1 && clock - hide.since >= T.hideSniffTime) return catchPlayer('pulledOut', rec);
    if (!stillThere || task.checkFor >= T.sniffCheckTime) {
      rec?.scent.markChecked(pool, clock, T.poolRecheck);
      setState(S.SEARCH, { center: copy(doodle.pos), floorId: doodle.floorId, left: T.searchTime * 0.5 });
    }
  }

  /** Standing over a knocked-out player for a moment (releaseCatch) before it hunts the other. */
  const resting = () => doodle.state === S.SEARCH && task.pauseLeft > 0;

  function search(dt) {
    if (task.pauseLeft > 0) {
      task.pauseLeft -= dt;
      if (task.pauseLeft <= 0) huntSurvivor();
      return;
    }
    if (task.left === undefined) task.left = T.searchTime;
    if (!task.center) {
      task.center = copy(doodle.pos);
      task.floorId = doodle.floorId;
    }
    if (checkDistractions() || checkScent()) return;
    task.left -= dt;
    if (task.left <= 0) return setState(S.PATROL);
    if (task.lingerLeft === undefined) task.lingerLeft = 1.5; // look around where it lost you first
    if (task.lingerLeft > 0) {
      task.lingerLeft -= dt;
      lookAround(dt);
      return;
    }
    if (!task.point) task.point = randomPointNear(task.center, task.floorId, T.searchRadius);
    if (travel(dt, task.point.pos, task.point.floorId, T.searchSpeed).arrived) {
      task.point = null;
      task.lingerLeft = rng.range(0.8, 1.8);
    }
  }

  function randomPointNear(center, floorId, radius) {
    const blocked = lockedCells(world.doors);
    for (let k = 0; k < 8; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1, radius);
      const cell = snapCell(nav, floorId, { x: center.x + Math.cos(a) * r, y: center.y, z: center.z + Math.sin(a) * r }, blocked, 1);
      if (cell) return { pos: cellCenter(nav, cell), floorId };
    }
    return { pos: copy(center), floorId };
  }

  function chase(dt) {
    const rec = live(target) ? target : null;
    const player = rec?.player ?? null;
    if (task.pullOut) {
      const owner = people.get(task.pullOut.playerId);
      const hide = owner?.hide;
      if (live(owner) && hide && hide.spotId === task.pullOut.spotId && owner.player?.hidden) return pullOut(dt, task.pullOut);
      task.pullOut = null; // they came out: back to a normal chase
    }
    task.lostFor = sight.visible ? 0 : task.lostFor + dt;
    // Just out of sight it still "knows" where you went (it hears you), briefly.
    if (!sight.visible && task.lostFor < T.trackTime && player && !player.hidden && !rec.inLink)
      rec.lastSeen = { pos: copy(player.pos), floorId: player.floorId, t: clock };
    const lastSeen = rec?.lastSeen;
    if (task.lostFor > T.chaseGiveUp || !lastSeen) return lose(S.SEARCH);

    if (lungeLeft > 0 || (sight.visible && canLunge(player))) return lunge(dt, player, lastSeen);

    const r = travel(dt, lastSeen.pos, lastSeen.floorId, T.chaseSpeed, { replanEvery: T.repathInterval });
    if (sight.visible && sight.dist < 3) face(player.pos, dt);
    if (!r.arrived) {
      task.stuckFor = 0;
      return;
    }
    if (!sight.visible) return lose(S.SEARCH); // got to where you were: nobody here
    // At the closest point it can reach, staring at you (e.g. you're in a crawl tunnel).
    face(player.pos, dt);
    task.stuckFor += dt;
    if (task.stuckFor > T.unreachableGiveUp) {
      rec.blindUntil = clock + 4;
      lose(S.PATROL);
    }
  }

  function canLunge(player) {
    if (mover.onLink || clock < lungeReadyAt || sight.dist > T.lungeRange) return false;
    return lineWalkable(nav, doodle.floorId, doodle.pos, player.pos, lockedCells(world.doors));
  }

  function lunge(dt, player, lastSeen) {
    if (lungeLeft <= 0) {
      lungeLeft = T.lungeTime;
      lungeReadyAt = clock + T.lungeCooldown;
    }
    lungeLeft -= dt;
    goal = null;
    mover.clear();
    const target = player && !player.hidden ? player.pos : lastSeen.pos;
    face(target, dt);
    const d = dist2D(doodle.pos, target);
    const step = Math.min(T.lungeSpeed * dt, Math.max(0, d - 0.3));
    if (step <= 0) return;
    const nx = doodle.pos.x + ((target.x - doodle.pos.x) / d) * step;
    const nz = doodle.pos.z + ((target.z - doodle.pos.z) / d) * step;
    const cell = worldToCell(nav, doodle.floorId, nx, nz);
    if (!cell || !doodlePassable(nav, cell, lockedCells(world.doors))) {
      lungeLeft = 0;
      return;
    }
    doodle.pos.x = nx;
    doodle.pos.z = nz;
    movedThisFrame += step;
  }

  function pullOut(dt, spot) {
    const r = travel(dt, spot.pos, spot.floorId, T.chaseSpeed, { replanEvery: 1 });
    const close = spot.floorId === doodle.floorId && dist2D(doodle.pos, spot.pos) <= T.pullOutReach;
    if (close || (r.arrived && reached(spot.pos, spot.floorId))) {
      face(spot.pos, dt);
      catchPlayer('pulledOut', people.get(spot.playerId));
    } else if (r.arrived) {
      task.pullOut = null; // can't get to that hiding spot
      lose(S.SEARCH);
    }
  }

  function lose(next) {
    const at = target?.lastSeen ?? { pos: copy(doodle.pos), floorId: doodle.floorId };
    if (next === S.SEARCH) setState(S.SEARCH, { center: copy(at.pos), floorId: at.floorId });
    else setState(next);
  }

  function distracted(dt) {
    switch (task.mode) {
      case 'treat': {
        const t = task.treat;
        if (!treats.has(t.id)) return afterDistraction();
        const r = travel(dt, t.pos, t.floorId, T.treatSpeed);
        if (!r.arrived) return;
        if (!reached(t.pos, t.floorId)) {
          t.ignored = true; // can't get to it (in a tunnel, on a shelf)
          return afterDistraction();
        }
        task.mode = 'eat';
        task.left = T.eatTime;
        return;
      }
      case 'eat': {
        face(task.treat.pos, dt);
        task.left -= dt;
        if (task.left > 0) return;
        treats.delete(task.treat.id);
        say(EVENTS.TREAT_EATEN, { treatId: task.treat.id });
        return afterDistraction();
      }
      case 'ball': {
        if (ball?.phase !== 'fetch') return afterDistraction();
        const r = travel(dt, ball.pos, ball.floorId, T.fetchSpeed);
        if (!r.arrived) return;
        if (!reached(ball.pos, ball.floorId)) {
          ball.phase = 'loose';
          ball.ignoreUntil = clock + 30;
          return afterDistraction();
        }
        ball.phase = 'carry';
        doodle.carrying = 'ball';
        say(EVENTS.BALL_FETCHED, {});
        task.mode = 'carry';
        goal = null;
        return;
      }
      case 'carry': {
        const bed = anchors.kennelBed;
        const r = travel(dt, bed.pos, bed.floorId, T.carrySpeed);
        if (!r.arrived) return;
        dropBall(bed.pos, bed.floorId);
        return afterDistraction();
      }
      default:
        return afterDistraction();
    }
  }

  function afterDistraction() {
    for (const t of treats.values()) if (smellsTreat(t)) return setState(S.DISTRACTED, { mode: 'treat', treat: t });
    setState(S.PATROL);
  }

  function dropBall(pos = doodle.pos, floorId = doodle.floorId) {
    const at = { x: pos.x, y: nav.floors[floorId]?.y ?? pos.y, z: pos.z };
    ball = null;
    doodle.carrying = null;
    say(EVENTS.BALL_RETURNED, { pos: at, floorId });
  }

  function recover() {
    const from = task.from;
    say(EVENTS.DOODLE_RECOVERED, {});
    if (from) setState(S.INVESTIGATE, { pos: from.pos, floorId: from.floorId });
    else setState(S.PATROL);
  }

  function stun(seconds, from) {
    if (doodle.state === S.CATCH) return;
    if (ball?.phase === 'carry') dropBall();
    else if (ball?.phase === 'fetch') ball.phase = 'loose';
    stunLeft = seconds;
    setState(S.STUNNED, { from });
    say(EVENTS.DOODLE_STUNNED, { seconds });
  }

  // ---- reacting to the world ---------------------------------------------------------

  const calm = (st) => !resting() && (st === S.PATROL || st === S.INVESTIGATE || st === S.SNIFF || st === S.SEARCH);

  on(EVENTS.NOISE, (n) => {
    if (!active || !n?.pos || ownNoise(n)) return;
    const h = hear(n, doodle, ranks, T);
    lastNoise = { pos: copy(n.pos), floorId: n.floorId, radius: h.radius, heard: h.heard, kind: n.kind, t: clock };
    if (!h.heard) return;
    lastHeard = { pos: copy(n.pos), floorId: n.floorId, t: clock, loudness: n.loudness, kind: n.kind };
    const st = doodle.state;
    if (calm(st)) setState(S.INVESTIGATE, { pos: lastHeard.pos, floorId: lastHeard.floorId });
    else if (st === S.CHASE && task.lostFor > 0 && !task.pullOut && target)
      target.lastSeen = { pos: lastHeard.pos, floorId: lastHeard.floorId, t: clock };
  });

  on(EVENTS.BALL_LANDED, (b) => {
    if (!b?.pos || ball?.phase === 'carry') return;
    ball = { pos: copy(b.pos), floorId: b.floorId, phase: 'loose', ignoreUntil: -Infinity };
    if (!active) return;
    // A ball pulls it away from anything calm, and from a chase once it's lost sight of you.
    const st = doodle.state;
    if (!(calm(st) || (st === S.CHASE && !sight.visible && !task.pullOut))) return;
    if (!hearsBall(ball)) return;
    ball.phase = 'fetch';
    setState(S.DISTRACTED, { mode: 'ball' });
  });

  on(EVENTS.PICKUP, (p) => {
    if (p?.itemId !== ITEMS.TENNIS_BALL || !ball || ball.phase === 'carry') return;
    const was = ball;
    ball = null;
    // It ran for the ball and someone snatched it: whoever did is right there.
    if (active && doodle.state === S.DISTRACTED && task.mode === 'ball') setState(S.INVESTIGATE, { pos: was.pos, floorId: was.floorId });
  });

  on(EVENTS.TREAT_DROPPED, (t) => {
    if (!t?.pos) return;
    const treat = { id: t.treatId, pos: copy(t.pos), floorId: t.floorId, ignored: rng.chance(T.treatIgnoreChance) };
    treats.set(treat.id, treat);
    if (!active || treat.ignored) return;
    const st = doodle.state;
    if (!(calm(st) || st === S.CHASE) || !smellsTreat(treat)) return; // busy: afterDistraction() finds it later
    if (st === S.CHASE && task.pullOut) return;
    setState(S.DISTRACTED, { mode: 'treat', treat });
  });

  on(EVENTS.DART_FIRED, (shot) => {
    if (!active || !shot?.origin || !shot?.dir || doodle.state === S.CATCH) return;
    if (dartHits(shot, bounds(), doodle.floorId, world) === null) return;
    say(EVENTS.DOODLE_HIT, {});
    const floorId = floorAt(world, shot.origin.y);
    stun(T.stunTime, { pos: { x: shot.origin.x, y: nav.floors[floorId]?.y ?? 0, z: shot.origin.z }, floorId });
  });

  // Hide and link events key their state by player. The guest's arrive replayed with
  // playerId 'guest' and remote: true; for the host's Doodle those are senses like any other.
  on(EVENTS.HIDE, (h) => {
    if (!h) return;
    const rec = person(h.playerId ?? 'host');
    const hide = { spotId: h.spotId, pos: copy(h.pos), floorId: h.floorId, since: clock, playerId: rec.id };
    rec.hide = hide;
    if (!active || !live(rec)) return;
    const st = doodle.state;
    // "Could it see you at that moment?" — sight is computed each frame, and the
    // player is already hidden by the time HIDE arrives, so use the last sighting.
    if (!(calm(st) || st === S.CHASE || (st === S.DISTRACTED && task.mode === 'carry'))) return;
    if (clock - rec.seenAt > T.hideSeenGrace) return;
    // Hot on someone else's heels and still seeing them: it keeps after them.
    if (st === S.CHASE && target && target !== rec && target.sight.visible) return;
    if (ball?.phase === 'carry') dropBall();
    setTarget(rec);
    if (st === S.CHASE) task.pullOut = hide;
    else setState(S.CHASE, { lostFor: 0, stuckFor: 0, pullOut: hide });
  });

  on(EVENTS.UNHIDE, (u) => {
    person(u?.playerId ?? 'host').hide = null;
  });

  on(EVENTS.LINK_ENTER, (l) => {
    const rec = person(l?.playerId ?? 'host');
    rec.inLink = true;
    // It can't follow you in there.
    if (active && doodle.state === S.CHASE && !task.pullOut && (!target || target === rec)) lose(S.SEARCH);
  });

  on(EVENTS.LINK_EXIT, (l) => {
    const rec = person(l?.playerId ?? 'host');
    rec.inLink = false;
    rec.blindUntil = clock + 0.5;
  });

  // ---- contract methods ------------------------------------------------------------

  function bounds() {
    const lying = doodle.state === S.SLEEP || doodle.state === S.STUNNED;
    return { center: { x: doodle.pos.x, y: doodle.pos.y + (lying ? 0.45 : 0.8), z: doodle.pos.z }, radius: lying ? 0.7 : 0.8 };
  }

  function reset(spot, { wakeDelay = 8 } = {}) {
    doodle.pos = copy(spot.pos);
    doodle.floorId = spot.floorId;
    if (spot.rotY !== undefined) doodle.yaw = spot.rotY;
    doodle.pitch = 0;
    doodle.speed = 0;
    sleepLeft = wakeDelay;
    stunLeft = 0;
    caught = false;
    lastHeard = null;
    for (const rec of people.values()) rec.scent.clear();
    people.clear(); // a new day forgets everyone, knocked-out players included
    target = null;
    targetSince = -Infinity;
    lungeLeft = 0;
    mover.clear();
    sniffedUpTo = -Infinity;
    // The ball stays where it was; if it was in Doodle's mouth it wakes up still holding it.
    if (ball?.phase === 'fetch') ball.phase = 'loose';
    setState(S.SLEEP);
    goal = null;
    sight = NO_SIGHT('asleep');
    doodle.pose = 'sleep';
  }

  function setActive(on) {
    active = !!on;
  }

  /**
   * Knock-out: let go of a caught player, who is now spectating. It forgets them until reset(),
   * stands still for releasePause s, then goes looking for whoever is left.
   */
  function releaseCatch(playerId = 'host') {
    const rec = person(playerId);
    rec.released = true;
    rec.hide = null;
    rec.awareness = 0;
    rec.scent.clear();
    if (target === rec) target = null;
    if (doodle.state !== S.CATCH) return;
    caught = false;
    setState(S.SEARCH, { center: copy(doodle.pos), floorId: doodle.floorId, pauseLeft: T.releasePause });
  }

  /** After the pause: head for (roughly) where the other player is; its senses do the rest. */
  function huntSurvivor() {
    let best = null;
    for (const rec of people.values())
      if (here(rec) && (!best || floorDist(rec.player) < floorDist(best.player))) best = rec;
    if (!best) return; // nobody left in play: an ordinary search where it stands
    const p = best.player;
    const at = p.hidden && best.hide ? best.hide : { pos: p.pos, floorId: p.floorId };
    const spot = randomPointNear(at.pos, at.floorId, T.releaseHuntFuzz);
    setTarget(best);
    setState(S.INVESTIGATE, { pos: spot.pos, floorId: spot.floorId });
  }

  /** Co-op host: everything the guest's puppet needs to draw this Doodle, as plain JSON. */
  function snapshot() {
    const p = doodle.pos;
    return {
      pos: { x: round(p.x), y: round(p.y), z: round(p.z) },
      yaw: round(doodle.yaw),
      pitch: round(doodle.pitch ?? 0),
      pose: doodle.pose,
      mood: doodle.mood,
      carrying: doodle.carrying,
      speed: round(doodle.speed, 100),
      state: doodle.state,
      floorId: doodle.floorId,
      target: target?.id ?? null,
    };
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
  }

  // ---- presentation ---------------------------------------------------------------

  function poseFor() {
    switch (doodle.state) {
      case S.SLEEP:
        return 'sleep';
      case S.STUNNED:
        return 'chew';
      case S.CATCH:
        return 'pounce';
      case S.DISTRACTED:
        if (task.mode === 'eat') return 'eat';
    }
    if (doodle.speed > 3.3) return 'run';
    if (doodle.state === S.SNIFF || (lookingAround && doodle.state !== S.PATROL)) return 'sniff';
    return doodle.speed > 0.15 ? 'walk' : 'idle';
  }

  function writeDebug() {
    const d = doodle.debug;
    const route = mover.route.slice(mover.index);
    d.path = route.length ? [copy(doodle.pos), ...route.map((w) => ({ x: w.x, y: w.y, z: w.z, floorId: w.floorId }))] : [];
    d.target = goal ? { ...copy(goal.pos), floorId: goal.floorId } : null;
    const player = here(target) ? target.player : null;
    const recs = [...people.values()];
    d.senses = {
      awareness: target?.awareness ?? 0,
      sight,
      sightRange: player ? Math.max(sightRange(player.hidden ? 0 : player.visibility(), T), T.closeSense) : T.sightMax,
      fov: T.fov,
      hearing: T.hearing,
      lastNoise,
      lastHeard,
      lastSeen: target?.lastSeen ?? null,
      targetId: target?.id ?? null,
      players: recs.map((r) => ({
        id: r.id,
        down: r.down,
        released: r.released,
        awareness: r.awareness,
        visible: r.sight.visible,
        hidden: !!r.hide,
        inLink: r.inLink,
      })),
      crumbs: recs.length === 1 ? recs[0].scent.crumbs : recs.flatMap((r) => r.scent.crumbs),
      pools: recs.flatMap((r) =>
        r.scent.pools.map((p) => ({ pos: p.pos, floorId: p.floorId, radius: r.scent.poolRadius(p, clock), hidden: !!p.hideSpotId })),
      ),
      task: task.mode ?? (task.checking ? 'checking' : task.pauseLeft > 0 ? 'pause' : ''),
      ball: ball ? { pos: ball.pos, floorId: ball.floorId, phase: ball.phase } : null,
      treats: [...treats.values()],
      clock,
    };
  }

  return doodle;
}
