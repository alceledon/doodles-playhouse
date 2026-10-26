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
});

/** 0:42, 12:05, 1:02:09. Negative or junk input shows 0:00. */
export function formatTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Under the day card: "5 days left" … "Last chance". */
export function daysLeftText(day, maxDays = MAX_DAYS) {
  const left = Math.max(1, maxDays - day + 1);
  return left === 1 ? 'Last chance' : `${left} days left`;
}

export function itemName(id) {
  return ITEM_NAMES[id] ?? (id ? String(id) : '');
}
