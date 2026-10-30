// UI entry point: createUI({ root, bus, leaderboard }) → UI and
// createCutscenes(opts) → Cutscenes (see contracts.js). All DOM stays inside
// `root`; styles come from ui.css next to this file, injected once. In touch
// mode (EVENTS.INPUT_MODE) the layer gets .dp-touch, prompts and menus switch
// to touch wording, and picking a difficulty asks for full screen. With an
// enabled leaderboard the title gets a Leaderboard panel and the win screen a
// box to post the time. With `coop` enabled the title also offers "Play with a
// friend", and co-op events show notices (notices.js).

import { EVENTS } from '../core/events.js';
import { INPUT_MODES, getInputMode, tryFullscreen } from '../core/device.js';
import { createHud } from './hud.js';
import { createNotices } from './notices.js';
import { createScreens } from './screens.js';
import { getStorage, loadBestTimes, loadName, loadSettings, recordBestTime, sanitizeSettings, saveName, saveSettings } from './settings.js';
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

/** True when the page URL has ?debug (the lag readout shows then). */
const debugParam = () => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').has('debug');
  } catch {
    return false;
  }
};

/**
 * createUI({ root, bus, leaderboard, coop }) → UI. `leaderboard` is optional (src/leaderboard/client.js).
 * coop: {enabled, code?} (contracts.js). debug (not in the contract) defaults to ?debug in the URL.
 */
export function createUI({ root, bus, leaderboard = null, coop = null, debug = debugParam() }) {
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

  // Missing or not set up (enabled: false) means no leaderboard anything.
  const board = leaderboard?.enabled ? leaderboard : null;
  // The board panel opens on the difficulty last played this session.
  let lastDifficulty = null;
  bus.on(EVENTS.RUN_START, ({ difficulty } = {}) => (lastDifficulty = difficulty ?? lastDifficulty));

  const hud = createHud(layer, bus, { inputMode: () => inputMode });
  const notices = createNotices(layer, bus, { debug });
  const screens = createScreens({
    layer,
    settings: () => settings,
    changeSettings,
    bestTimes: () => loadBestTimes(storage),
    inputMode: () => inputMode,
    // Runs inside the Play tap, the gesture full screen needs. Desktop stays windowed.
    onPlay: () => inputMode === INPUT_MODES.TOUCH && tryFullscreen(),
    leaderboard: board,
    lastDifficulty: () => lastDifficulty,
    playerName: () => loadName(storage),
    savePlayerName: (name) => saveName(storage, name),
    coop: coop?.enabled ? { enabled: true, code: coop.code ?? null } : null,
  });

  return {
    settings,
    async showTitle() {
      await ready;
      return screens.showTitle();
    },
    showDayCard: (day) => {
      notices.dayCard();
      return screens.showDayCard(day);
    },
    showPause: () => screens.showPause(),
    showWin: (results) => screens.showWin(results),
    showGameOver: (info) => screens.showGameOver(info),
    setHudVisible: (visible) => hud.setVisible(visible),
    update: (dt, ctx) => hud.update(dt, ctx),
    recordTime: (difficulty, seconds) => recordBestTime(storage, difficulty, seconds).isNew,
    showLobby(info) {
      if (info?.partnerName) notices.setPartner(info.partnerName);
      const lobby = screens.showLobby(info);
      return {
        result: lobby.result,
        close: lobby.close,
        update(patch = {}) {
          if (patch.partnerName) notices.setPartner(patch.partnerName);
          lobby.update(patch);
        },
      };
    },
    showMessage: (text) => screens.showMessage(text),

    // ---- extras (not in the contract): cutscenes draw here; the dev page pokes at these ----
    layer,
    hud,
    notices,
    openCoop: (code) => screens.openCoop(code),
    setInviteCode: (code) => screens.setInviteCode(code),
    openSettings: () => screens.openSettings(),
    openHowTo: () => screens.openHowTo(),
    openLeaderboard: (difficulty) => screens.openLeaderboard(difficulty),
    changeSettings,
    bestTimes: () => loadBestTimes(storage),
  };
}
