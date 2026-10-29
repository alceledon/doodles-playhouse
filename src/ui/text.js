// Every player-facing string, plus formatting helpers. Pure (tests import it).

import { MAX_DAYS } from '../core/contracts.js';

export const DIFFICULTY_INFO = Object.freeze({
  practice: { name: 'Practice', line: 'No Doodle. Explore the house and learn the locks.' },
  easy: { name: 'Easy', line: 'A sleepy Doodle with dull ears, and extra treats.' },
  normal: { name: 'Normal', line: 'Doodle as it should be. Five days to get out.' },
  hard: { name: 'Hard', line: 'Quick paws, a keen nose, and it might ignore your treats.' },
});

export const ITEM_NAMES = Object.freeze({
  padlockKey: 'Padlock Key',
  hammer: 'Hammer',
  jeepKey: 'Jeep Key',
  carBattery: 'Car Battery',
  fuse: 'Fuse',
  toyChestKey: 'Toy Chest Key',
  tennisBall: 'Tennis Ball',
  treats: 'Bag of Treats',
  launcher: 'Squeaky Launcher',
  dart: 'Squeaky Dart',
});

/** Toasts when a lock opens (LOCK_OPENED) and when a whole exit is open (EXIT_UNLOCKED). */
export const LOCK_MESSAGES = Object.freeze({
  padlock: 'The padlock clicks open.',
  plank: 'You pry the plank off the door.',
  keypad: 'The keypad blinks green.',
  fuseBox: 'Something hums in the garage.',
  jeepKey: 'The key turns in the Jeep.',
  jeepBattery: 'The battery is in the Jeep.',
  atticChest: 'The toy chest creaks open.',
});
export const EXIT_MESSAGES = Object.freeze({
  frontDoor: 'The front door is open. RUN!',
  garage: 'The garage door is working. Drive!',
});

export const ROUTE_TEXT = Object.freeze({
  frontDoor: 'You slipped out the front door.',
  garage: 'You drove the Jeep out of the garage.',
});

export const HOW_TO_PLAY = Object.freeze({
  intro: [
    'You came to a sleepover at the playhouse. Everyone else went home. Doodle didn’t.',
    `Escape within ${MAX_DAYS} days. Each time Doodle catches you, a day passes and you wake up in the bunk bed. Get caught on day ${MAX_DAYS} and it’s over.`,
    'Two ways out: the front door (padlock, plank and a color keypad) or the garage (the Jeep needs its key and battery, and the door needs power).',
    'Listen for the collar jingle. You can only hold one thing at a time, and dropping things makes noise.',
  ],
  controls: [
    ['Mouse', 'Look'],
    ['W A S D', 'Move'],
    ['Shift', 'Sprint (uses stamina)'],
    ['C', 'Crouch / crawl (silent)'],
    ['Click / E', 'Pick up, open, hide, use'],
    ['Right click', 'Use the held item'],
    ['G', 'Drop the held item'],
    ['F', 'Flashlight'],
    ['Esc', 'Pause'],
  ],
  // Shown instead of `controls` in touch mode (core/device.js).
  touchControls: [
    ['Left thumb', 'Move (push to the edge to sprint)'],
    ['Right thumb', 'Drag to look around'],
    ['Tap', 'Pick up, open, hide, use: tap the thing'],
    ['Hand', 'The same for what’s in the middle (it lights up)'],
    ['Use', 'Use the held item: throw, drop a treat, fire'],
    ['Drop', 'Drop the held item'],
    ['Crouch', 'Crouch / crawl (silent)'],
    ['Light', 'Flashlight'],
    ['Pause', 'Pause (top corner)'],
  ],
});

/**
 * A Gameplay prompt in the current input mode's words. Gameplay writes them
 * for the mouse ("Click: open the door · Right click: back", "Crouch (C)");
 * touch says Tap, Use and Crouch instead.
 * @param {string|null} text
 * @param {'touch'|'desktop'} mode
 */
export function promptFor(text, mode) {
  if (!text || mode !== 'touch') return text;
  return text
    .replace(/Right click/g, 'Use')
    .replace(/\bClick\b/g, 'Tap')
    .replace(/^E: /, 'Tap: ')
    .replace(/ \([A-Z]\)/g, '');
}

/** The pause screen's hint line. */
export const pauseHint = (mode) => (mode === 'touch' ? 'Tap Resume to keep playing.' : 'Click Resume to grab the mouse again.');

/** 0:42, 12:05, 1:02:09. Negative or junk input shows 0:00. */
export function formatTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Leaderboard times: 5:12.4, 1:02:05.3. Floors to tenths, the way formatTime floors to seconds. */
export function formatTimeTenths(seconds) {
  // Round to milliseconds first, so 312.4 (stored as 312.39999…) still reads .4.
  const tenths = Number.isFinite(seconds) && seconds > 0 ? Math.floor(Math.round(seconds * 1000) / 100) : 0;
  return `${formatTime(Math.floor(tenths / 10))}.${tenths % 10}`;
}

/** The leaderboard's words: the title-screen panel and the win screen's post box. */
export const BOARD_TEXT = Object.freeze({
  title: 'Leaderboard',
  columns: Object.freeze(['#', 'Name', 'Time', 'Days', 'Exit']),
  loading: 'Loading…',
  offline: 'Couldn’t reach the leaderboard.',
  empty: 'No escapes yet. Be the first!',
  retry: 'Retry',
  testRun: 'Test runs don’t go on the leaderboard.',
  nameLabel: 'Your name for the leaderboard',
  namePlaceholder: 'NAME',
  post: 'Post my time',
  sending: 'Sending…',
  topFailed: 'Couldn’t load the top 10.',
});

/** The board's Exit column. */
export const ROUTE_SHORT = Object.freeze({ frontDoor: 'Door', garage: 'Jeep' });

/** After posting: "You’re #3 on Normal!", or just that it's posted when the place couldn't be fetched. */
export function placeText(rank, boardName) {
  return Number.isInteger(rank) && rank > 0 ? `You’re #${rank} on ${boardName}!` : `Posted to the ${boardName} board!`;
}

/** Under the day card: "5 days left" … "Last chance". */
export function daysLeftText(day, maxDays = MAX_DAYS) {
  const left = Math.max(1, maxDays - day + 1);
  return left === 1 ? 'Last chance' : `${left} days left`;
}

export function itemName(id) {
  return ITEM_NAMES[id] ?? (id ? String(id) : '');
}
