import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_ALPHABET, CODE_LENGTH, cleanCode, inviteLink, isCode, makeCode, netError, roomMeta } from '../../src/net/room.js';

/** Bytes from a list, then zeros. */
const bytesFrom = (list) => {
  const queue = [...list];
  return (n) => Uint8Array.from({ length: n }, () => queue.shift() ?? 0);
};

test('makeCode: 6 letters from the unambiguous alphabet', () => {
  for (let k = 0; k < 200; k++) {
    const code = makeCode();
    assert.equal(code.length, CODE_LENGTH);
    assert.ok(isCode(code), code);
  }
  for (const c of '01ILO') assert.ok(!CODE_ALPHABET.includes(c), `${c} is too easy to misread`);
});

test('makeCode rejects bytes ≥ 248 so every letter is equally likely', () => {
  // 248..255 are skipped; 0 → 'A', 30 → '9', 31 → 'A' again.
  const code = makeCode(bytesFrom([255, 248, 0, 30, 31, 1, 250, 2, 3]));
  assert.equal(code, 'A9ABCD');
});

test('cleanCode forgives case, spaces and dashes, and rejects the rest', () => {
  assert.equal(cleanCode(' ab3-xyz '), 'AB3XYZ');
  assert.equal(cleanCode('abc'), null);
  assert.equal(cleanCode('ABCDE0'), null, '0 is not in the alphabet');
  assert.equal(cleanCode(null), null);
});

test('inviteLink keeps the page and ?net, drops everything else', () => {
  const loc = { origin: 'https://alceledon.github.io', pathname: '/doodles-playhouse/', search: '?debug=1&net=local' };
  assert.equal(inviteLink(loc, 'ABCDEF'), 'https://alceledon.github.io/doodles-playhouse/?join=ABCDEF&net=local');
  assert.equal(inviteLink({ ...loc, search: '' }, 'ABCDEF'), 'https://alceledon.github.io/doodles-playhouse/?join=ABCDEF');
});

test('roomMeta checks difficulty and rule', () => {
  assert.deepEqual(roomMeta({ host: 'AL', difficulty: 'normal', rule: 'knockout', created: 5 }), {
    v: 1, host: 'AL', difficulty: 'normal', rule: 'knockout', status: 'lobby', created: 5,
  });
  assert.throws(() => roomMeta({ host: 'AL', difficulty: 'nightmare', rule: 'shared', created: 5 }));
  assert.throws(() => roomMeta({ host: 'AL', difficulty: 'easy', rule: 'everyone', created: 5 }));
});

test('netError carries a kind and a message for the player', () => {
  const err = netError('full');
  assert.equal(err.kind, 'full');
  assert.match(err.message, /two players/);
});
