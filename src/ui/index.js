// UI entry point: createUI({ root, bus }) → UI and createCutscenes(opts) →
// Cutscenes (see contracts.js). All DOM stays inside `root`; styles come from
// ui.css next to this file, injected once. In touch mode (EVENTS.INPUT_MODE)
// the layer gets .dp-touch, prompts and menus switch to touch wording, and
// picking a difficulty asks for full screen.

import { EVENTS } from '../core/events.js';
import { INPUT_MODES, getInputMode, tryFullscreen } from '../core/device.js';
import { createHud } from './hud.js';
import { createScreens } from './screens.js';
import { getStorage, loadBestTimes, loadSettings, recordBestTime, sanitizeSettings, saveSettings } from './settings.js';
import { el } from './dom.js';

export { createCutscenes } from './cutscenes.js';

let cssReady = null;
/** Inject ui.css once; resolves when it has loaded (or failed), so screens never flash unstyled. */
function loadCss() {
  if (cssReady) return cssReady;
  const href = new URL('./ui.css', import.meta.url).href;
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === href);
  if (existing) return (cssReady = Promise.resolve());
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  cssReady = new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = () => {
      console.error('[ui] could not load ui.css');
      resolve();
    };
  });
  document.head.append(link);
  return cssReady;
}

/** createUI({ root, bus }) → UI */
export function createUI({ root, bus }) {
  const ready = loadCss();
  const storage = getStorage();
  const layer = el('div', 'dp-ui');
  root.append(layer);

  // Mutated in place so anyone holding ui.settings sees changes.
  const settings = loadSettings(storage);
  function changeSettings(patch) {
    Object.assign(settings, sanitizeSettings({ ...settings, ...patch }));
    saveSettings(storage, settings);
    bus.emit(EVENTS.SETTINGS_CHANGED, { settings: { ...settings } });
  }

  let inputMode = getInputMode();
  const setMode = (mode) => {
    inputMode = mode;
    layer.classList.toggle('dp-touch', mode === INPUT_MODES.TOUCH);
  };
  setMode(inputMode);
  bus.on(EVENTS.INPUT_MODE, ({ mode } = {}) => setMode(mode));

  const hud = createHud(layer, bus, { inputMode: () => inputMode });
  const screens = createScreens({
    layer,
    settings: () => settings,
    changeSettings,
    bestTimes: () => loadBestTimes(storage),
    inputMode: () => inputMode,
    // Runs inside the Play tap, the gesture full screen needs. Desktop stays windowed.
    onPlay: () => inputMode === INPUT_MODES.TOUCH && tryFullscreen(),
  });

  return {
    settings,
    async showTitle() {
      await ready;
      return screens.showTitle();
    },
    showDayCard: (day) => screens.showDayCard(day),
    showPause: () => screens.showPause(),
    showWin: (results) => screens.showWin(results),
    showGameOver: (info) => screens.showGameOver(info),
    setHudVisible: (visible) => hud.setVisible(visible),
    update: (dt, ctx) => hud.update(dt, ctx),
    recordTime: (difficulty, seconds) => recordBestTime(storage, difficulty, seconds).isNew,

    // ---- extras (not in the contract): cutscenes draw here; the dev page pokes at these ----
    layer,
    hud,
    openSettings: () => screens.openSettings(),
    openHowTo: () => screens.openHowTo(),
    changeSettings,
    bestTimes: () => loadBestTimes(storage),
  };
}
