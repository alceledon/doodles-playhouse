import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS } from '../../src/core/events.js';
import { FORWARDED, decode, encode, isMessage, parseSeq, replayPayload, seqKey, shouldForward } from '../../src/net/protocol.js';

test('seq keys sort like their numbers and round-trip', () => {
  const keys = [10, 2, 1, 300].map(seqKey).sort();
  assert.deepEqual(keys.map(parseSeq), [1, 2, 10, 300]);
  assert.ok(Number.isNaN(parseSeq('e12')));
  assert.ok(Number.isNaN(parseSeq('x000000001')));
});

test('decode tolerates junk', () => {
  assert.deepEqual(decode(encode({ a: [1, null] })), { a: [1, null] }, 'nulls survive inside the string');
  assert.equal(decode('{nope'), undefined);
  assert.equal(decode(42), undefined);
});

test('isMessage accepts only known types', () => {
  assert.ok(isMessage({ type: 'bus', event: 'noise', payload: {} }));
  assert.ok(!isMessage({ type: 'eval' }));
  assert.ok(!isMessage(null));
});

test('every forwarded name is a real event, and run flow never travels as a bus event', () => {
  const known = new Set(Object.values(EVENTS));
  for (const role of ['host', 'guest']) for (const e of FORWARDED[role]) assert.ok(known.has(e), `${role}: ${e}`);
  for (const flow of [EVENTS.CAUGHT, EVENTS.ESCAPED, EVENTS.DAY_START, EVENTS.RUN_START, EVENTS.WON, EVENTS.GAME_OVER, EVENTS.PAUSE_REQUEST]) {
    assert.ok(!FORWARDED.host.has(flow) && !FORWARDED.guest.has(flow), flow);
  }
  for (const local of [EVENTS.PROMPT, EVENTS.HELD]) assert.ok(!FORWARDED.host.has(local) && !FORWARDED.guest.has(local), `${local} is the local HUD's`);
});

test('the guest forwards only its own body; replays never echo back', () => {
  assert.ok(shouldForward('guest', EVENTS.FOOTSTEP, { pos: { x: 0, y: 0, z: 0 } }));
  assert.ok(!shouldForward('guest', EVENTS.DOOR_OPENED, { doorId: 'd1' }), 'doors are the host\'s to open');
  assert.ok(shouldForward('host', EVENTS.DOOR_OPENED, { doorId: 'd1' }));
  assert.ok(!shouldForward('host', EVENTS.NOISE, { remote: true, playerId: 'guest' }), 'a replay of the guest\'s noise');
});

test('replayPayload stamps the sender and remote, keeping an explicit playerId', () => {
  assert.deepEqual(replayPayload('guest', { kind: 'step' }), { kind: 'step', playerId: 'guest', remote: true });
  assert.deepEqual(replayPayload('host', { treatId: 't1', playerId: 'guest' }), { treatId: 't1', playerId: 'guest', remote: true });
});
