// Boot, game loop and run flow. Owned by the coordinator.
//
// Each area is loaded for real or as its stub from src/core/stubs/, per
// src/areas.js — so the game always runs end to end, and each area slots in
// when it's merged.
//
// URL params:
//   ?debug=1             FPS / state overlay + window.__game handle
//   ?difficulty=normal   skip the title screen
//   ?seed=123            fixed run seed
//   ?real=world,doodle   load these areas for real even if areas.js says stub
//   ?stub=world,doodle   force stubs for these areas (world, gameplay, doodle, ui, audio)
//   ?tick=timer          drive requestAnimationFrame from setTimeout (automated tests in a
//                        browser pane that isn't painting, where rAF never fires)
//   ?input=touch         start in touch (or desktop) input mode instead of detecting it
//   ?board=fake          a pretend leaderboard kept in this browser (src/leaderboard/fake.js);
//                        posting works with it even in a dev run
//   ?join=CODE           an invite link: open the co-op menu on "Join" with this code
//   ?net=local           co-op between two tabs of this browser, no server (src/net/local.js)

import * as THREE from 'three';
import { createBus, EVENTS } from './core/events.js';
import { createGameState, PHASES } from './core/game.js';
import { createRng, randomSeed } from './core/rng.js';
import { COOP_RULES, DIFFICULTIES, PLAYER_IDS, SETTINGS_DEFAULTS } from './core/contracts.js';
import { INPUT_MODES, getInputMode, needsRotate, startInputModeWatcher } from './core/device.js';
import { REAL_AREAS } from './areas.js';
import { createLeaderboard } from './leaderboard/client.js';
import { createFakeLeaderboard } from './leaderboard/fake.js';
import { FORWARDED, NET_MESSAGES, cleanCode, hostRoom, inviteLink, joinRoom, pickTransport, replayPayload, shouldForward } from './net/index.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const listParam = (name) => new Set((params.get(name) ?? '').split(',').filter(Boolean));
const forcedReal = listParam('real');
const forcedStubs = listParam('stub');
// Dev and test runs read the online leaderboard but never post to it.
const DEV_RUN = ['debug', 'seed', 'real', 'stub', 'tick'].some((p) => params.has(p));

if (params.get('tick') === 'timer') {
  // Patched before boot, so every rAF user (this loop, cutscenes, UI) gets it.
  const timers = new Map();
  let next = 0;
  window.requestAnimationFrame = (cb) => {
    const handle = ++next;
    timers.set(handle, setTimeout(() => {
      timers.delete(handle);
      cb(performance.now());
    }, 16));
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    clearTimeout(timers.get(handle));
    timers.delete(handle);
  };
}

const AREAS = {
  world: { real: './world/index.js', stub: './core/stubs/world.js' },
  gameplay: { real: './gameplay/index.js', stub: './core/stubs/gameplay.js' },
  doodle: { real: './doodle/index.js', stub: './core/stubs/doodle.js' },
  ui: { real: './ui/index.js', stub: './core/stubs/ui.js' },
  audio: { real: './audio/index.js', stub: './core/stubs/audio.js' },
};

async function loadArea(name) {
  const useReal = !forcedStubs.has(name) && (forcedReal.has(name) || REAL_AREAS[name]);
  const path = useReal ? AREAS[name].real : AREAS[name].stub;
  // A real module that fails to load is a bug: let it throw so it's seen.
  return { mod: await import(new URL(path, import.meta.url).href), real: useReal };
}

// ---------------------------------------------------------------------------

const bus = createBus();
const state = createGameState();
// Before anything reads the mode: UI and Gameplay take the current one and follow EVENTS.INPUT_MODE.
startInputModeWatcher({ bus, forced: params.get('input') });
const container = document.getElementById('game');
const uiRoot = document.getElementById('ui');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const canvas = renderer.domElement;
container.appendChild(canvas);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
const emptyScene = new THREE.Scene();
emptyScene.background = new THREE.Color(0x05040a);
let scene = emptyScene;

const QUALITY_SCALE = { low: 0.5, medium: 0.75, high: Math.min(devicePixelRatio, 2) };
function applySettings(s) {
  renderer.setPixelRatio(QUALITY_SCALE[s.quality] ?? QUALITY_SCALE.medium);
  renderer.setSize(innerWidth, innerHeight);
  audio?.setVolume(s.volume);
}
function fitToWindow() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  checkRotate();
}
addEventListener('resize', fitToWindow);
// iOS can report the old size during a rotation; measure again once it settles.
addEventListener('orientationchange', () => setTimeout(fitToWindow, 300));

// ---------------------------------------------------------------------------
// Phones and tablets (page-shell side; the controls are src/player/touch.js)
// ---------------------------------------------------------------------------

// Phones play sideways. The overlay in index.html covers everything, and the game pauses under it.
const rotateBox = document.getElementById('rotate');
function checkRotate() {
  if (!rotateBox) return;
  const show = needsRotate({ width: innerWidth, height: innerHeight, touch: getInputMode() === INPUT_MODES.TOUCH });
  rotateBox.hidden = !show;
  if (show && run && !run.busy && state.phase === PHASES.PLAYING) run.bus.emit(EVENTS.PAUSE_REQUEST, {});
}
bus.on(EVENTS.INPUT_MODE, () => checkRotate());

// iOS starts (and, after an app switch, resumes) audio only inside a touch/click handler.
for (const type of ['touchend', 'pointerup', 'click']) addEventListener(type, () => audio?.unlock(), true);
// Safari's own pinch gesture, which ignores user-scalable=no.
document.addEventListener('gesturestart', (e) => e.preventDefault());

let mods = {};
let ui = null;
let leaderboard = null;
let audio = null;
let cutscenes = null;
/** Co-op transport for this page ({enabled, kind, transport}), from src/net/index.js. */
let net = { enabled: false, kind: 'off', transport: null };
/** Per-run objects, null between runs. */
let run = null;

// ---------------------------------------------------------------------------
// Run flow
// ---------------------------------------------------------------------------

function newScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x07060c);
  s.fog = new THREE.Fog(0x07060c, 4, 22);
  s.add(camera); // the flashlight hangs off the camera, so it must be in the scene
  return s;
}

/**
 * One run, solo or co-op. `coop` (from playCoop) is {session, role, rule, names, attach}:
 * the host's game runs Doodle and the shared state; the guest's mirrors it and follows the
 * host's `flow` messages for days, catches and the escape.
 */
function playRun(difficulty, seed, coop = null) {
  return new Promise((resolve) => {
    state.startRun(difficulty, seed);
    const runBus = bus.scope();
    const rng = createRng(seed);
    scene = newScene();
    const world = mods.world.createWorld({ scene, bus: runBus, rng: rng.fork('world'), difficulty });
    const gameplay = mods.gameplay.createGameplay({
      scene, camera, canvas, world, bus: runBus, rng: rng.fork('gameplay'), difficulty, settings: ui.settings,
      ...(coop && { coop: { role: coop.role, rule: coop.rule } }),
    });
    const doodle = difficulty === 'practice'
      ? null
      : mods.doodle.createDoodle({ scene, world, bus: runBus, rng: rng.fork('doodle'), difficulty, ...(coop?.role === 'guest' && { puppet: true }) });
    run = { bus: runBus, world, gameplay, doodle, resolve, busy: false, coop: null };

    if (coop) startCoopRun(coop);
    // The guest's Doodle is a puppet and never catches; its days, catches and escape come from the host.
    if (coop?.role !== 'guest') {
      runBus.on(EVENTS.CAUGHT, (p) => onCaught(p?.playerId ?? PLAYER_IDS.HOST, p?.how));
      runBus.on(EVENTS.ESCAPED, ({ route, playerId }) => onEscaped(route, playerId));
    }
    runBus.on(EVENTS.PAUSE_REQUEST, () => onPause());
    runBus.emit(EVENTS.RUN_START, { difficulty, seed });
    startDay();
  });
}

function freeze() {
  run.gameplay.setControlsEnabled(false);
  run.gameplay.exitPointerLock();
  // Online, the host's Doodle keeps hunting while one player watches a cutscene or a menu;
  // only the run-wide pauses (day card, end of day) stop it, via freezeAll.
  if (!run.coop) run.doodle?.setActive(false);
  ui.setHudVisible(false);
}

/** Stop everything, Doodle included: a day is ending or starting for both players. */
function freezeAll() {
  freeze();
  run.doodle?.setActive(false);
}

function unfreeze() {
  ui.setHudVisible(true);
  run.gameplay.setControlsEnabled(true);
  run.doodle?.setActive(true);
  run.gameplay.requestPointerLock(); // may be refused without a fresh click; Gameplay re-locks on canvas click
  checkRotate(); // a phone held upright pauses right away
}

async function startDay() {
  const { world, gameplay, doodle, coop } = run;
  freezeAll();
  if (coop) {
    // Everyone is back up for the new day.
    for (const id of Object.values(PLAYER_IDS)) {
      if (coop.down.has(id)) {
        coop.down.delete(id);
        gameplay.setDown?.(id, false);
        bus.emit(EVENTS.PLAYER_UP, { playerId: id, local: id === coop.role });
      }
    }
  }
  gameplay.startDay(state.day);
  doodle?.reset(world.anchors.kennel, { wakeDelay: 8 });
  await ui.showDayCard(state.day);
  await cutscenes.playWake({ day: state.day });
  if (!run || run.gameplay !== gameplay) return;
  state.beginDay();
  bus.emit(EVENTS.DAY_START, { day: state.day });
  unfreeze();
}

/**
 * Doodle caught `playerId` (the host decides; the guest gets the same call from a flow message).
 * Solo, and co-op's shared rule: the day ends for everyone. Knock-out: the caught player watches
 * the other, and the day only ends once both are down.
 */
async function onCaught(playerId = PLAYER_IDS.HOST, how = 'tackle', told = null) {
  if (!run || run.busy || state.phase === PHASES.LOST || state.phase === PHASES.WON) return;
  const { coop } = run;
  // The host only counts catches during play; the guest follows whatever the host decided.
  if (!told && state.phase !== PHASES.PLAYING) return;
  if (coop?.down.has(playerId)) return;

  const knockout = coop?.rule === COOP_RULES.KNOCKOUT;
  const partnerUp = coop && coop.partnerHere && !coop.down.has(otherId(playerId));
  const dayEnds = told ? told.outcome !== 'down' : !(knockout && partnerUp);
  if (coop?.role === 'host') coop.session.send({ type: 'flow', step: 'caught', playerId, how, outcome: dayEnds ? 'day' : 'down' });

  if (!dayEnds) return knockOut(playerId);

  run.busy = true;
  const { world, gameplay, doodle } = run;
  // A guest whose wake cutscene is still running when the host's catch arrives.
  if (state.phase === PHASES.CUTSCENE) state.beginDay();
  if (state.phase === PHASES.PAUSED) state.resume();
  const outcome = state.caught();
  freezeAll();
  gameplay.onCaught(playerId);
  const local = !coop || playerId === coop.role;
  const ctx = { player: gameplay.player, doodle, world };
  if (coop && !local) {
    coop.down.add(playerId);
    bus.emit(EVENTS.PLAYER_DOWN, { playerId, local: false, name: coop.names[playerId] });
  }
  if (outcome === 'nextDay') {
    if (local) await cutscenes.playCatch(ctx);
    else await wait(2.5);
    if (!run) return;
    run.busy = false;
    await startDay();
  } else {
    if (local) await cutscenes.playGameOver(ctx);
    else await wait(2.5);
    if (!run) return;
    state.lose();
    bus.emit(EVENTS.GAME_OVER, { difficulty: state.difficulty, seconds: state.seconds });
    await ui.showGameOver({ difficulty: state.difficulty, seconds: state.seconds });
    endRun();
  }
}

/** Knock-out with the partner still up: the caught player drops their item and watches the partner. */
async function knockOut(playerId) {
  const { coop, gameplay, doodle, world } = run;
  coop.down.add(playerId);
  gameplay.setDown?.(playerId, true); // drops what they held
  const local = playerId === coop.role;
  bus.emit(EVENTS.PLAYER_DOWN, { playerId, local, name: coop.names[local ? otherId(playerId) : playerId] });
  if (coop.role === 'host') doodle?.releaseCatch?.(playerId);
  if (!local) return;
  coop.spectating = true;
  freeze();
  // The cutscene moves the Doodle model itself, so it stops following the AI (or the host's snapshots) meanwhile.
  doodle?.setActive(false);
  await cutscenes.playCatch({ player: gameplay.player, doodle, world, knockout: true });
  if (run?.gameplay === gameplay && !run.busy) doodle?.setActive(true);
}

/** Someone walked out (or drove off). In co-op that's a win for both. */
async function onEscaped(route, playerId = PLAYER_IDS.HOST, told = null) {
  if (!run || run.busy) return;
  const { coop } = run;
  if (state.phase === PHASES.CUTSCENE) state.beginDay();
  if (state.phase === PHASES.PAUSED) state.resume();
  if (state.phase !== PHASES.PLAYING) return;
  run.busy = true;
  const results = state.escaped(route);
  // The guest shows the host's clock, so both screens agree.
  if (told) Object.assign(results, { seconds: told.seconds, days: told.days });
  if (coop?.role === 'host') coop.session.send({ type: 'flow', step: 'escaped', route, playerId, seconds: results.seconds, days: results.days });
  freezeAll();
  await cutscenes.playEscape({ route, player: run.gameplay.player, world: run.world });
  if (!run) return;
  if (coop) {
    // A knocked-out player walks out with the partner: drop the "Spectating" banner.
    for (const id of coop.down) bus.emit(EVENTS.PLAYER_UP, { playerId: id, local: id === coop.role });
    coop.down.clear();
    bus.emit(EVENTS.WON, results);
    const names = [coop.names.host, coop.names.guest];
    // Co-op times go on the co-op boards, not this browser's solo bests.
    await ui.showWin({ ...results, best: false, coop: { rule: coop.rule, names, canPost: coop.role === 'host' } });
  } else {
    const best = ui.recordTime(results.difficulty, results.seconds);
    bus.emit(EVENTS.WON, results);
    await ui.showWin({ ...results, best });
  }
  endRun();
}

async function onPause() {
  if (!run || run.busy) return;
  if (run.coop) return onCoopPause();
  if (!state.pause()) return;
  freeze();
  bus.emit(EVENTS.PAUSED, {});
  const choice = await ui.showPause();
  if (!run) return;
  if (choice === 'quit') return endRun();
  state.resume();
  bus.emit(EVENTS.RESUMED, {});
  unfreeze();
}

/** Online there's no stopping the world: the menu only takes your own controls away. */
async function onCoopPause() {
  const { coop, gameplay } = run;
  if (coop.pausing || state.phase !== PHASES.PLAYING) return;
  coop.pausing = true;
  freeze();
  const choice = await ui.showPause();
  coop.pausing = false;
  if (!run || run.gameplay !== gameplay) return;
  if (choice === 'quit') return endRun();
  // Something may have happened meanwhile (caught, a new day): only take back what's still ours.
  if (!run.busy && !coop.spectating && state.phase === PHASES.PLAYING) unfreeze();
}

function endRun() {
  if (!run) return;
  const { bus: runBus, world, gameplay, doodle, resolve, coop } = run;
  run = null;
  coop?.stop();
  runBus.dispose();
  gameplay.exitPointerLock();
  gameplay.dispose?.();
  doodle?.dispose?.();
  world.dispose?.();
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) m.dispose?.();
  });
  scene = emptyScene;
  state.toTitle();
  resolve();
}

const wait = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));
const otherId = (id) => (id === PLAYER_IDS.HOST ? PLAYER_IDS.GUEST : PLAYER_IDS.HOST);

// ---------------------------------------------------------------------------
// Co-op: lobby, then wiring the session into a run
// ---------------------------------------------------------------------------

/** The co-op menu's choice → a room → the lobby → a run. Returns when it's all over. */
async function playCoop(choice) {
  let session;
  try {
    session = choice.role === 'host'
      ? await hostRoom({ transport: net.transport, name: choice.name, difficulty: choice.difficulty, rule: choice.rule })
      : await joinRoom({ transport: net.transport, code: choice.code, name: choice.name });
  } catch (err) {
    await ui.showMessage(err?.kind ? err.message : NET_MESSAGES.offline);
    return;
  }
  const role = session.role;
  const meta = session.meta;

  // Everything the session says before a run is listening waits here, in order.
  const inbox = [];
  let handlers = null;
  const deliver = (kind, payload) => (handlers ? handlers[kind]?.(payload) : inbox.push([kind, payload]));
  const offs = [
    session.on('set', (p) => deliver('set', p)),
    session.on('message', (m) => deliver('message', m)),
    session.on('left', (p) => deliver('left', p)),
    session.on('status', (p) => deliver('status', p)),
    session.on('error', (err) => console.warn('[co-op]', err)),
  ];
  const attach = (h) => {
    handlers = h;
    for (const [kind, payload] of inbox.splice(0)) h[kind]?.(payload);
  };
  const leaveOnUnload = () => session.close({ keepalive: true });
  addEventListener('pagehide', leaveOnUnload);
  const stopAll = () => {
    for (const off of offs) off();
    removeEventListener('pagehide', leaveOnUnload);
    session.close();
  };

  const lobby = ui.showLobby({
    role, code: session.code, link: inviteLink(location, session.code), name: choice.name,
    partnerName: session.partnerName, difficulty: meta.difficulty, rule: meta.rule,
  });
  const lobbyTimer = setInterval(() => session.tick(), 50);

  // ---- the lobby: the host waits for a friend and Start; the guest waits for the host's start ----
  const start = await new Promise((resolve) => {
    let lastPartner = session.partnerName;
    lobby.result.then((r) => resolve(r === 'start' && role === 'host' ? { go: true } : { cancel: true }));
    attach({
      message(m) {
        if (role === 'guest' && m.type === 'start') {
          // From here on everything is the run's: queue it until the run attaches (the host's
          // first pose can arrive before this promise's continuation runs).
          handlers = null;
          resolve({ go: true, start: m });
        } else if (m.type !== 'start') inbox.push(['message', m]);
      },
      set(p) {
        inbox.push(['set', p]);
      },
      left({ reason }) {
        if (role === 'guest') resolve({ gone: true });
        else {
          lobby.update({ partnerName: null, status: reason === 'timeout' ? 'Your friend lost connection.' : 'Your friend left.' });
          bus.emit(EVENTS.PARTNER_LEFT, { name: lastPartner, reason });
        }
      },
      status() {},
    });
    session.on('joined', ({ name }) => {
      lastPartner = name;
      lobby.update({ partnerName: name, status: '' });
      bus.emit(EVENTS.PARTNER_JOINED, { name });
    });
  });
  clearInterval(lobbyTimer);
  handlers = null; // the run attaches its own; anything in between queues up
  lobby.close();
  if (!start.go) inbox.length = 0;

  if (!start.go) {
    stopAll();
    if (start.gone) await ui.showMessage(NET_MESSAGES.hostLeft);
    return;
  }

  let difficulty = meta.difficulty;
  let rule = meta.rule;
  let seed;
  const names = { host: role === 'host' ? choice.name : session.partnerName, guest: role === 'guest' ? choice.name : session.partnerName };
  if (role === 'host') {
    seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : randomSeed();
    session.send({ type: 'start', seed, difficulty, rule, names });
    session.setStatus('playing');
  } else {
    ({ seed, difficulty, rule } = start.start);
    Object.assign(names, start.start.names ?? {});
  }
  audio.unlock();
  await playRun(difficulty, seed, { session, role, rule, names, attach, stop: stopAll });
}

/** Wire a co-op session into the run that playRun just built. */
function startCoopRun({ session, role, rule, names, attach, stop }) {
  const { bus: runBus, gameplay, doodle } = run;
  const partner = otherId(role);
  const coop = {
    session, role, rule, names,
    down: new Set(),
    partnerHere: true,
    spectating: false,
    pausing: false,
    stop() {
      stop();
    },
  };
  run.coop = coop;

  // Our events the partner should hear or that drive the host's Doodle.
  for (const type of FORWARDED[role]) {
    runBus.on(type, (payload) => {
      if (shouldForward(role, type, payload)) session.send({ type: 'bus', event: type, payload: toJson(payload) });
    });
  }
  if (role === 'guest') gameplay.setIntentSink?.((intent) => session.send({ type: 'intent', intent }));

  attach({
    set({ channel, value }) {
      if (channel === 'pose') gameplay.setRemotePose?.(value);
      else if (role === 'guest' && channel === 'state') gameplay.applySnapshot?.(value);
      else if (role === 'guest' && channel === 'doodle') doodle?.applySnapshot?.(value);
    },
    message(m) {
      if (m.type === 'bus') {
        // Only what the partner's side may send, replayed for sound, notices and (host) Doodle's senses.
        if (FORWARDED[partner].has(m.event)) runBus.emit(m.event, replayPayload(partner, m.payload ?? {}));
      } else if (m.type === 'intent' && role === 'host') {
        gameplay.applyIntent?.(PLAYER_IDS.GUEST, m.intent);
      } else if (m.type === 'flow' && role === 'guest') {
        if (m.step === 'caught') onCaught(m.playerId, m.how, m);
        else if (m.step === 'escaped') onEscaped(m.route, m.playerId, m);
      }
    },
    left({ reason }) {
      coop.partnerHere = false;
      gameplay.setRemotePose?.(null);
      bus.emit(EVENTS.PARTNER_LEFT, { name: names[partner], reason });
      if (role === 'guest') {
        // No host, no game.
        if (!run?.busy) leaveRun(NET_MESSAGES.hostLeft);
      } else if (coop.down.has(role) && !run.busy) {
        // Watching a partner who's gone: that's the end of the day.
        coop.down.delete(role);
        onCaught(role, 'tackle');
      }
    },
    status({ status, lagMs }) {
      bus.emit(EVENTS.NET_STATUS, { status, lagMs, name: names[partner] });
    },
  });
}

/** Show why the run ended, then back to the title. */
async function leaveRun(message) {
  if (!run) return;
  run.busy = true;
  freezeAll();
  await ui.showMessage(message);
  endRun();
}

/** Per frame: our pose (and, hosting, Doodle and the shared state) go out; watching, the camera rides along. */
function tickCoop() {
  const { coop, gameplay, doodle } = run;
  const { session } = coop;
  if (gameplay.pose) session.set('pose', gameplay.pose());
  if (coop.role === 'host') {
    if (doodle?.snapshot) session.set('doodle', doodle.snapshot());
    if (gameplay.snapshot) session.set('state', gameplay.snapshot());
  }
  session.tick();
  const remote = gameplay.remote;
  if (coop.spectating && !run.busy && remote) {
    const eye = remote.eyePos();
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(remote.pitch, remote.yaw, 0, 'YXZ');
  }
  if (!coop.down.has(coop.role)) coop.spectating = false;
}

/** Event payloads are plain data already; this drops anything that isn't (functions, cycles). */
function toJson(payload) {
  try {
    return JSON.parse(JSON.stringify(payload ?? {}));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let last = performance.now();
let fps = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (run && (run.coop || state.phase !== PHASES.PAUSED)) {
    const { gameplay } = run;
    state.tick(dt);
    gameplay.update(dt);
    // Co-op: Doodle senses both players (the guest's puppet ignores the list).
    const remote = run.coop && gameplay.remote;
    run.doodle?.update(dt, remote ? [gameplay.player, remote] : gameplay.player);
    run.world.update(dt, gameplay.player.pos);
    if (run.coop) tickCoop();
  }
  const remote = run?.coop ? run.gameplay.remote : null;
  audio?.update(dt, { camera, player: run?.gameplay.player ?? null, doodle: run?.doodle ?? null, world: run?.world ?? null, remote });
  ui?.update(dt, { player: run?.gameplay.player ?? null, doodle: run?.doodle ?? null });
  renderer.render(scene, camera);
  if (DEBUG) drawDebug();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Debug overlay + errors
// ---------------------------------------------------------------------------

const debugBox = DEBUG ? document.createElement('pre') : null;
let moduleInfo = '';
if (debugBox) {
  debugBox.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#9f9;font:12px monospace;z-index:100;pointer-events:none';
  document.body.append(debugBox);
}
function drawDebug() {
  const p = run?.gameplay.player;
  const d = run?.doodle;
  const c = run?.coop;
  debugBox.textContent = [
    `fps ${fps.toFixed(0)}  phase ${state.phase}  day ${state.day}  ${state.difficulty ?? ''}  seed ${state.seed ?? ''}`,
    p ? `player ${p.floorId} (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}) held=${p.held} hidden=${p.hidden} vis=${p.visibility().toFixed(2)}` : '',
    d ? `doodle ${d.state} ${d.floorId} (${d.pos.x.toFixed(1)}, ${d.pos.z.toFixed(1)}) speed ${d.speed.toFixed(1)}` : '',
    c ? `co-op ${c.role} ${c.rule} room ${c.session.code}  lag ${c.session.lagMs === null ? '?' : c.session.lagMs.toFixed(0) + ' ms'}  ${c.session.status}  down [${[...c.down]}]` : '',
    moduleInfo,
  ].filter(Boolean).join('\n');
}

function showFatal(message) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);max-width:90vw;white-space:pre-wrap;padding:10px 14px;background:#400;color:#fdd;font:13px monospace;border:1px solid #f66;z-index:1000';
  box.textContent = `Something broke: ${message}\n(see the browser console for details)`;
  document.body.append(box);
}
addEventListener('error', (e) => showFatal(e.message));
addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message ?? String(e.reason)));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** The online board (off until src/leaderboard/config.js names a project), or ?board=fake's. */
function makeLeaderboard() {
  if (params.get('board') === 'fake') {
    let storage = null;
    try {
      storage = localStorage;
    } catch {} // blocked storage (private mode, sandboxed frame): memory only
    return createFakeLeaderboard({ storage });
  }
  return createLeaderboard({ allowSubmit: !DEV_RUN });
}

async function boot() {
  const names = Object.keys(AREAS);
  const loaded = await Promise.all(names.map(loadArea));
  mods = Object.fromEntries(names.map((n, k) => [n, loaded[k].mod]));
  leaderboard = makeLeaderboard();
  net = pickTransport(params);
  const boardInfo = params.get('board') === 'fake' ? 'fake' : !leaderboard.enabled ? 'off' : leaderboard.canSubmit ? 'online' : 'online, read-only';
  moduleInfo = 'modules: ' + names.map((n, k) => `${n}=${loaded[k].real ? 'real' : 'stub'}`).join(' ') + `  board: ${boardInfo}  co-op: ${net.kind}`;
  console.info(`[doodle] ${moduleInfo}`);

  const joinCode = net.enabled ? cleanCode(params.get('join')) : null;
  ui = mods.ui.createUI({ root: uiRoot, bus, leaderboard, coop: { enabled: net.enabled, ...(joinCode && { code: joinCode }) } });
  audio = mods.audio.createAudio({ bus, camera });
  cutscenes = mods.ui.createCutscenes({ camera, getScene: () => scene, ui, bus });
  applySettings({ ...SETTINGS_DEFAULTS, ...ui.settings });
  bus.on(EVENTS.SETTINGS_CHANGED, ({ settings }) => applySettings(settings));
  checkRotate();

  if (DEBUG) {
    window.__game = {
      THREE, bus, state, camera, renderer, mods, leaderboard, net,
      get scene() { return scene; },
      get world() { return run?.world ?? null; },
      get gameplay() { return run?.gameplay ?? null; },
      get player() { return run?.gameplay.player ?? null; },
      get doodle() { return run?.doodle ?? null; },
      get coop() { return run?.coop ?? null; },
      endRun,
    };
  }

  requestAnimationFrame(frame);

  const quick = params.get('difficulty');
  let first = DIFFICULTIES.includes(quick) && !joinCode ? quick : null;
  for (;;) {
    let difficulty = first;
    first = null;
    let coop = null;
    if (!difficulty) ({ difficulty, coop } = await ui.showTitle());
    audio.unlock();
    if (coop) {
      await playCoop(coop);
      continue;
    }
    const seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : randomSeed();
    await playRun(difficulty, seed);
  }
}

boot().catch((err) => {
  console.error(err);
  showFatal(err.message);
});
