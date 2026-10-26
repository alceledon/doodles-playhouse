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

import * as THREE from 'three';
import { createBus, EVENTS } from './core/events.js';
import { createGameState, PHASES } from './core/game.js';
import { createRng, randomSeed } from './core/rng.js';
import { DIFFICULTIES, SETTINGS_DEFAULTS } from './core/contracts.js';
import { INPUT_MODES, getInputMode, needsRotate, startInputModeWatcher } from './core/device.js';
import { REAL_AREAS } from './areas.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const listParam = (name) => new Set((params.get(name) ?? '').split(',').filter(Boolean));
const forcedReal = listParam('real');
const forcedStubs = listParam('stub');

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
let audio = null;
let cutscenes = null;
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

function playRun(difficulty, seed) {
  return new Promise((resolve) => {
    state.startRun(difficulty, seed);
    const runBus = bus.scope();
    const rng = createRng(seed);
    scene = newScene();
    const world = mods.world.createWorld({ scene, bus: runBus, rng: rng.fork('world'), difficulty });
    const gameplay = mods.gameplay.createGameplay({
      scene, camera, canvas, world, bus: runBus, rng: rng.fork('gameplay'), difficulty, settings: ui.settings,
    });
    const doodle = difficulty === 'practice' ? null : mods.doodle.createDoodle({ scene, world, bus: runBus, rng: rng.fork('doodle'), difficulty });
    run = { bus: runBus, world, gameplay, doodle, resolve, busy: false };

    runBus.on(EVENTS.CAUGHT, () => onCaught());
    runBus.on(EVENTS.ESCAPED, ({ route }) => onEscaped(route));
    runBus.on(EVENTS.PAUSE_REQUEST, () => onPause());
    runBus.emit(EVENTS.RUN_START, { difficulty, seed });
    startDay();
  });
}

function freeze() {
  run.gameplay.setControlsEnabled(false);
  run.gameplay.exitPointerLock();
  run.doodle?.setActive(false);
  ui.setHudVisible(false);
}

function unfreeze() {
  ui.setHudVisible(true);
  run.gameplay.setControlsEnabled(true);
  run.doodle?.setActive(true);
  run.gameplay.requestPointerLock(); // may be refused without a fresh click; Gameplay re-locks on canvas click
  checkRotate(); // a phone held upright pauses right away
}

async function startDay() {
  const { world, gameplay, doodle } = run;
  freeze();
  gameplay.startDay(state.day);
  doodle?.reset(world.anchors.kennel, { wakeDelay: 8 });
  await ui.showDayCard(state.day);
  await cutscenes.playWake({ day: state.day });
  if (!run) return;
  state.beginDay();
  bus.emit(EVENTS.DAY_START, { day: state.day });
  unfreeze();
}

async function onCaught() {
  if (state.phase !== PHASES.PLAYING || run.busy) return;
  run.busy = true;
  const { world, gameplay, doodle } = run;
  const outcome = state.caught();
  freeze();
  gameplay.onCaught();
  const ctx = { player: gameplay.player, doodle, world };
  if (outcome === 'nextDay') {
    await cutscenes.playCatch(ctx);
    run.busy = false;
    await startDay();
  } else {
    await cutscenes.playGameOver(ctx);
    state.lose();
    bus.emit(EVENTS.GAME_OVER, { difficulty: state.difficulty, seconds: state.seconds });
    await ui.showGameOver({ difficulty: state.difficulty, seconds: state.seconds });
    endRun();
  }
}

async function onEscaped(route) {
  if (state.phase !== PHASES.PLAYING || run.busy) return;
  run.busy = true;
  const results = state.escaped(route);
  freeze();
  await cutscenes.playEscape({ route, player: run.gameplay.player, world: run.world });
  const best = ui.recordTime(results.difficulty, results.seconds);
  bus.emit(EVENTS.WON, results);
  await ui.showWin({ ...results, best });
  endRun();
}

async function onPause() {
  if (run.busy || !state.pause()) return;
  freeze();
  bus.emit(EVENTS.PAUSED, {});
  const choice = await ui.showPause();
  if (!run) return;
  if (choice === 'quit') return endRun();
  state.resume();
  bus.emit(EVENTS.RESUMED, {});
  unfreeze();
}

function endRun() {
  if (!run) return;
  const { bus: runBus, world, gameplay, doodle, resolve } = run;
  run = null;
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

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let last = performance.now();
let fps = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (run && state.phase !== PHASES.PAUSED) {
    state.tick(dt);
    run.gameplay.update(dt);
    run.doodle?.update(dt, run.gameplay.player);
    run.world.update(dt, run.gameplay.player.pos);
  }
  audio?.update(dt, { camera, player: run?.gameplay.player ?? null, doodle: run?.doodle ?? null, world: run?.world ?? null });
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
  debugBox.textContent = [
    `fps ${fps.toFixed(0)}  phase ${state.phase}  day ${state.day}  ${state.difficulty ?? ''}  seed ${state.seed ?? ''}`,
    p ? `player ${p.floorId} (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}) held=${p.held} hidden=${p.hidden} vis=${p.visibility().toFixed(2)}` : '',
    d ? `doodle ${d.state} ${d.floorId} (${d.pos.x.toFixed(1)}, ${d.pos.z.toFixed(1)}) speed ${d.speed.toFixed(1)}` : '',
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

async function boot() {
  const names = Object.keys(AREAS);
  const loaded = await Promise.all(names.map(loadArea));
  mods = Object.fromEntries(names.map((n, k) => [n, loaded[k].mod]));
  moduleInfo = 'modules: ' + names.map((n, k) => `${n}=${loaded[k].real ? 'real' : 'stub'}`).join(' ');
  console.info(`[doodle] ${moduleInfo}`);

  ui = mods.ui.createUI({ root: uiRoot, bus });
  audio = mods.audio.createAudio({ bus, camera });
  cutscenes = mods.ui.createCutscenes({ camera, getScene: () => scene, ui, bus });
  applySettings({ ...SETTINGS_DEFAULTS, ...ui.settings });
  bus.on(EVENTS.SETTINGS_CHANGED, ({ settings }) => applySettings(settings));
  checkRotate();

  if (DEBUG) {
    window.__game = {
      THREE, bus, state, camera, renderer, mods,
      get scene() { return scene; },
      get world() { return run?.world ?? null; },
      get gameplay() { return run?.gameplay ?? null; },
      get player() { return run?.gameplay.player ?? null; },
      get doodle() { return run?.doodle ?? null; },
      endRun,
    };
  }

  requestAnimationFrame(frame);

  const quick = params.get('difficulty');
  let first = DIFFICULTIES.includes(quick) ? quick : null;
  for (;;) {
    let difficulty = first;
    first = null;
    if (!difficulty) ({ difficulty } = await ui.showTitle());
    audio.unlock();
    const seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : randomSeed();
    await playRun(difficulty, seed);
  }
}

boot().catch((err) => {
  console.error(err);
  showFatal(err.message);
});
