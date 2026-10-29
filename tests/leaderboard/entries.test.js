import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../../src/core/contracts.js';
import {
  BOARDS,
  MIN_SECONDS,
  boardOf,
  cleanName,
  entryProblem,
  isBlockedName,
  nameProblem,
  ranksOf,
  roundSeconds,
  timeProblem,
} from '../../src/leaderboard/entries.js';

test('cleanName: uppercase A–Z and 0–9 only, at most 6', () => {
  assert.equal(cleanName('al'), 'AL');
  assert.equal(cleanName(' a-l 9!'), 'AL9');
  assert.equal(cleanName('abcdefgh'), 'ABCDEF');
  assert.equal(cleanName('émile'), 'EMILE', 'accents dropped, not the letter');
  assert.equal(cleanName('😀zoe😀'), 'ZOE');
  assert.equal(cleanName(123), '123');
  for (const junk of [null, undefined, '', '!!!', '   ']) assert.equal(cleanName(junk), '');
});

test('nameProblem: empty, wrong shape, blocked, fine', () => {
  for (const ok of ['AL', 'DOODLE', 'X', 'R2D2', '000000']) assert.equal(nameProblem(ok), null, ok);
  for (const empty of ['', null, undefined, 42]) assert.equal(typeof nameProblem(empty), 'string');
  for (const shape of ['al', 'TOOLONG', 'A L', 'É']) assert.equal(typeof nameProblem(shape), 'string', shape);
});

test('nameProblem: blocked words, including leetspeak and as part of a name', () => {
  for (const bad of ['SHIT', 'SH1T', '5H1T', 'XSHITX', 'FUCKER', 'N4Z1', 'B1TCH', 'F4G', 'P3D0', 'KKK']) {
    assert.ok(isBlockedName(bad), bad);
    assert.equal(nameProblem(bad), 'Pick a different name.', bad);
  }
  // Ordinary names that merely contain short letter runs stay allowed.
  for (const ok of ['BASS', 'CLASSY', 'GRAPE', 'SPICE', 'SCOTT', 'ASHLEY', 'MATT', 'PENNY']) assert.equal(nameProblem(ok), null, ok);
});

test('timeProblem and entryProblem mirror firestore.rules', () => {
  const ok = { name: 'AL', seconds: 312.45, days: 2, route: 'garage' };
  assert.equal(entryProblem(ok), null);
  assert.equal(entryProblem({ ...ok, route: 'frontDoor' }), null);
  assert.equal(entryProblem({ ...ok, seconds: MIN_SECONDS }), null, 'exactly a minute counts');
  assert.equal(entryProblem({ ...ok, seconds: 86399.99 }), null);
  for (const days of [1, 5]) assert.equal(entryProblem({ ...ok, days }), null);

  for (const seconds of [59.99, 0, -1, 86400, NaN, Infinity, '300', null]) assert.equal(typeof entryProblem({ ...ok, seconds }), 'string', String(seconds));
  for (const days of [0, 6, 2.5, '2', null]) assert.equal(typeof entryProblem({ ...ok, days }), 'string', String(days));
  for (const route of ['window', '', null]) assert.equal(typeof entryProblem({ ...ok, route }), 'string', String(route));
  assert.equal(entryProblem({ ...ok, name: 'SH1T' }), 'Pick a different name.');
  assert.equal(typeof entryProblem({}), 'string');
  assert.equal(typeof entryProblem(), 'string');

  assert.equal(timeProblem(60), null);
  assert.match(timeProblem(59), /minute/);
});

test('roundSeconds keeps 2 decimals and leaves non-numbers alone', () => {
  assert.equal(roundSeconds(312.456), 312.46);
  assert.equal(roundSeconds(59.996), 60);
  assert.equal(roundSeconds(300), 300);
  assert.equal(roundSeconds('300'), '300');
});

test('boardOf: one collection per difficulty', () => {
  for (const d of DIFFICULTIES) assert.equal(boardOf(d), `runs_${d}`);
  assert.deepEqual(Object.values(BOARDS), ['runs_practice', 'runs_easy', 'runs_normal', 'runs_hard']);
  for (const junk of ['insane', '', null, undefined, 'toString', '__proto__']) assert.equal(boardOf(junk), null, String(junk));
});

test('ranksOf: ties share a place, the next one skips', () => {
  const rows = [300, 310, 310, 320, 330, 330, 330, 400].map((seconds) => ({ seconds }));
  assert.deepEqual(ranksOf(rows), [1, 2, 2, 4, 5, 5, 5, 8]);
  assert.deepEqual(ranksOf([]), []);
});
