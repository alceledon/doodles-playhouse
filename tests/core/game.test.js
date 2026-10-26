import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, PHASES } from '../../src/core/game.js';
import { MAX_DAYS } from '../../src/core/contracts.js';

test('a run starts on day 1 in the day-card cutscene', () => {
  const g = createGameState();
  g.startRun('normal', 123);
  assert.equal(g.day, 1);
  assert.equal(g.phase, PHASES.CUTSCENE);
  g.beginDay();
  assert.equal(g.phase, PHASES.PLAYING);
});

test('getting caught advances the day until the last one, then it is game over', () => {
  const g = createGameState();
  g.startRun('hard', 1);
  g.beginDay();
  for (let day = 1; day < MAX_DAYS; day++) {
    assert.equal(g.caught(), 'nextDay');
    assert.equal(g.day, day + 1);
    g.beginDay();
  }
  assert.equal(g.caught(), 'gameOver');
  assert.equal(g.day, MAX_DAYS);
  g.lose();
  assert.equal(g.phase, PHASES.LOST);
  assert.equal(g.catches, MAX_DAYS);
});

test('time only counts while playing', () => {
  const g = createGameState();
  g.startRun('easy', 1);
  g.tick(5); // day card
  g.beginDay();
  g.tick(2);
  g.pause();
  g.tick(10);
  g.resume();
  g.tick(1);
  assert.equal(g.seconds, 3);
});

test('escaping reports the route, days and time', () => {
  const g = createGameState();
  g.startRun('normal', 1);
  g.beginDay();
  g.tick(4);
  g.caught();
  g.beginDay();
  g.tick(6);
  const r = g.escaped('garage');
  assert.deepEqual(r, { route: 'garage', days: 2, seconds: 10, difficulty: 'normal' });
  assert.equal(g.phase, PHASES.WON);
});

test('illegal transitions throw instead of corrupting the state', () => {
  const g = createGameState();
  assert.throws(() => g.caught(), /needs phase "playing"/);
  assert.throws(() => g.startRun('nightmare', 1), /unknown difficulty/);
  g.startRun('practice', 1);
  assert.throws(() => g.escaped('frontDoor'), /needs phase "playing"/);
  assert.equal(g.pause(), false);
});

test('toTitle resets everything', () => {
  const g = createGameState();
  g.startRun('normal', 5);
  g.beginDay();
  g.toTitle();
  assert.equal(g.phase, PHASES.TITLE);
  assert.equal(g.day, 0);
  assert.equal(g.difficulty, null);
});
