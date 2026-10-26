// Run / day state machine. Pure logic; main.js drives it and plays the
// cutscenes in between.
//
//   title ──startRun──▶ cutscene (day card) ──beginDay──▶ playing
//   playing ──pause──▶ paused ──resume──▶ playing
//   playing ──caught──▶ cutscene ──beginDay (next day)──▶ playing
//                                 └──lose (day 5)──────▶ lost
//   playing ──escaped──▶ won
//   any ──toTitle──▶ title

import { DIFFICULTIES, MAX_DAYS } from './contracts.js';

export const PHASES = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  CUTSCENE: 'cutscene',
  PAUSED: 'paused',
  WON: 'won',
  LOST: 'lost',
});

export function createGameState() {
  const s = {
    phase: PHASES.TITLE,
    day: 0,
    difficulty: null,
    seed: null,
    seconds: 0, // time spent playing this run (not paused, not in cutscenes)
    catches: 0,
    route: null,

    startRun(difficulty, seed) {
      if (!DIFFICULTIES.includes(difficulty)) throw new Error(`unknown difficulty "${difficulty}"`);
      Object.assign(s, { difficulty, seed, day: 1, seconds: 0, catches: 0, route: null, phase: PHASES.CUTSCENE });
    },

    beginDay() {
      expect(PHASES.CUTSCENE, 'beginDay');
      s.phase = PHASES.PLAYING;
    },

    tick(dt) {
      if (s.phase === PHASES.PLAYING) s.seconds += dt;
    },

    pause() {
      if (s.phase !== PHASES.PLAYING) return false;
      s.phase = PHASES.PAUSED;
      return true;
    },

    resume() {
      if (s.phase !== PHASES.PAUSED) return false;
      s.phase = PHASES.PLAYING;
      return true;
    },

    /** @returns {'nextDay'|'gameOver'} — on nextDay, `day` has already advanced */
    caught() {
      expect(PHASES.PLAYING, 'caught');
      s.catches += 1;
      s.phase = PHASES.CUTSCENE;
      if (s.day >= MAX_DAYS) return 'gameOver';
      s.day += 1;
      return 'nextDay';
    },

    lose() {
      expect(PHASES.CUTSCENE, 'lose');
      s.phase = PHASES.LOST;
    },

    /** @returns {{route: string, days: number, seconds: number, difficulty: string}} */
    escaped(route) {
      expect(PHASES.PLAYING, 'escaped');
      s.phase = PHASES.WON;
      s.route = route;
      return { route, days: s.day, seconds: s.seconds, difficulty: s.difficulty };
    },

    toTitle() {
      Object.assign(s, { phase: PHASES.TITLE, day: 0, difficulty: null, seed: null, seconds: 0, catches: 0, route: null });
    },
  };

  function expect(phase, action) {
    if (s.phase !== phase) throw new Error(`${action}() needs phase "${phase}", but phase is "${s.phase}"`);
  }

  return s;
}
