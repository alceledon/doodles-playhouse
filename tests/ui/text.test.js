import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES, ITEM_IDS, LOCK_IDS, MAX_DAYS, ROUTES } from '../../src/core/contracts.js';
import { DIFFICULTY_INFO, EXIT_MESSAGES, HOW_TO_PLAY, ITEM_NAMES, LOCK_MESSAGES, ROUTE_TEXT, daysLeftText, formatTime, itemName, pauseHint, promptFor } from '../../src/ui/text.js';
import { GLYPHS, missingGlyphs, textWidth } from '../../src/ui/glyphs.js';

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9.99), '0:09');
  assert.equal(formatTime(65.4), '1:05');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(3599), '59:59');
  assert.equal(formatTime(3600), '1:00:00');
  assert.equal(formatTime(3725), '1:02:05');
  for (const junk of [-5, NaN, undefined, null, Infinity, '30']) assert.equal(formatTime(junk), '0:00');
});

test('days left on the day card', () => {
  assert.equal(daysLeftText(1), `${MAX_DAYS} days left`);
  assert.equal(daysLeftText(MAX_DAYS - 1), '2 days left');
  assert.equal(daysLeftText(MAX_DAYS), 'Last chance');
  assert.equal(daysLeftText(MAX_DAYS + 3), 'Last chance');
});

test('every difficulty, item, lock and route has its text', () => {
  for (const d of DIFFICULTIES) assert.ok(DIFFICULTY_INFO[d]?.name && DIFFICULTY_INFO[d]?.line, d);
  for (const id of ITEM_IDS) assert.ok(ITEM_NAMES[id], id);
  for (const id of LOCK_IDS) assert.ok(LOCK_MESSAGES[id], id);
  for (const r of Object.values(ROUTES)) assert.ok(EXIT_MESSAGES[r] && ROUTE_TEXT[r], r);
  assert.equal(itemName('mystery'), 'mystery');
  assert.equal(itemName(null), '');
});

test('every crayon string can be drawn with the stroke font', () => {
  const strings = ["DOODLE'S\nPLAYHOUSE", 'SETTINGS', 'HOW TO PLAY', 'PAUSED', 'YOU ESCAPED!', 'DOODLE HAS A\nNEW CHEW TOY.'];
  for (let d = 1; d <= MAX_DAYS; d++) strings.push(`DAY ${d}`);
  for (const s of strings) assert.deepEqual(missingGlyphs(s.replace(/\n/g, '')), [], s);
});

test('glyph strokes stay on the grid', () => {
  for (const [ch, g] of Object.entries(GLYPHS)) {
    assert.ok(g.w > 0, `${ch} has a width`);
    for (const stroke of g.s) {
      assert.ok(stroke.length >= 2, `${ch} strokes have 2+ points`);
      for (const [x, y] of stroke) assert.ok(x >= -0.5 && x <= g.w + 0.5 && y >= -0.5 && y <= 7, `${ch} point (${x}, ${y})`);
    }
  }
  assert.ok(textWidth('DAY 5') > textWidth('DAY'));
});

test('prompts in touch mode say Tap and Use instead of Click and keys', () => {
  const cases = [
    ['Click: pick up Hammer', 'Tap: pick up Hammer'],
    ['Click: turn the red dial · Right click: back', 'Tap: turn the red dial · Use: back'],
    ['Crouch (C) to crawl into the tunnel', 'Crouch to crawl into the tunnel'],
    ['Click: stop hiding', 'Tap: stop hiding'],
    ['E: open door', 'Tap: open door'],
    ['Locked: needs the Padlock Key', 'Locked: needs the Padlock Key'],
  ];
  for (const [desktop, touch] of cases) {
    assert.equal(promptFor(desktop, 'touch'), touch);
    assert.equal(promptFor(desktop, 'desktop'), desktop, 'desktop wording is untouched');
  }
  assert.equal(promptFor(null, 'touch'), null);
  assert.equal(promptFor('', 'touch'), '');
});

test('How to Play has touch controls, and the pause hint follows the mode', () => {
  assert.ok(HOW_TO_PLAY.touchControls.length >= 6);
  for (const [k, what] of HOW_TO_PLAY.touchControls) assert.ok(k && what);
  assert.ok(!HOW_TO_PLAY.touchControls.some(([k]) => /click|mouse|esc/i.test(k)));
  assert.match(pauseHint('touch'), /^Tap/);
  assert.match(pauseHint('desktop'), /^Click/);
});
