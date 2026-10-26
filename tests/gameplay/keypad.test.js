import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { createMiniHouse } from '../../src/core/fixtures/mini-house.js';
import { assignDigits, checkCode, createKeypad, DIAL_COLORS, generateCode, isValidCode } from '../../src/gameplay/keypad.js';

test('codes are 4 digits, deterministic per seed, never 0000', () => {
  const codes = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const code = generateCode(createRng(seed));
    assert.ok(isValidCode(code), code);
    assert.notEqual(code, '0000');
    assert.equal(code, generateCode(createRng(seed)));
    codes.add(code);
  }
  assert.ok(codes.size > 200, 'codes vary between runs');
});

test('a rng that only rolls zeros still avoids 0000', () => {
  const zeros = { int: (min) => min, next: () => 0 };
  const code = generateCode({ ...zeros, int: (min, max) => (max === 9 && min === 1 ? 4 : min) });
  assert.equal(code, '0004');
});

test('each drawing shows one digit in its dial color', () => {
  const world = createMiniHouse();
  const code = '4719';
  const assigned = assignDigits(world.anchors.drawings, code, createRng(7));
  assert.equal(assigned.length, 4);
  assert.equal(new Set(assigned.map((a) => a.spot.id)).size, 4);
  for (const a of assigned) {
    assert.equal(a.digit, Number(code[a.position]));
    assert.equal(a.color, DIAL_COLORS[a.position]);
  }
  // Reading the drawings back by color recovers the code.
  const byPos = assigned.slice().sort((a, b) => a.position - b.position);
  assert.equal(byPos.map((a) => a.digit).join(''), code);
});

test('dials roll and wrap both ways, and only the exact code matches', () => {
  const pad = createKeypad('0391');
  assert.equal(pad.entered(), '0000');
  assert.equal(pad.matches(), false);
  assert.equal(pad.roll(1, -1), 9);
  assert.equal(pad.roll(1, 1), 0);
  for (let k = 0; k < 3; k++) pad.roll(1);
  for (let k = 0; k < 9; k++) pad.roll(2);
  assert.equal(pad.entered(), '0390');
  assert.equal(pad.matches(), false);
  pad.roll(3);
  assert.equal(pad.matches(), true);
  assert.equal(checkCode('0391', '0391'), true);
  assert.equal(checkCode('0391', '391'), false);
  assert.equal(checkCode('0391', '1930'), false);
});

test('the four dial colors are distinct', () => {
  assert.equal(new Set(DIAL_COLORS.map((c) => c.hex)).size, 4);
  assert.equal(new Set(DIAL_COLORS.map((c) => c.name)).size, 4);
});
