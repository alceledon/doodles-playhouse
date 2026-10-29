import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOP_RULE_IDS, DIFFICULTIES } from '../../src/core/contracts.js';
import { EVENTS } from '../../src/core/events.js';
import { NET_MESSAGES } from '../../src/net/room.js';
import {
  BOARD_MODES,
  BOARD_MODE_NAMES,
  RULE_INFO,
  boardOpts,
  caughtText,
  checkCode,
  checkName,
  hostChoice,
  initialNotices,
  isPartnerPayload,
  joinChoice,
  joinedText,
  lagText,
  leftText,
  lobbyView,
  reduceNotices,
  spectatingText,
  teamName,
  typedCode,
  waitingText,
} from '../../src/ui/coop.js';

test('every co-op rule has a name and one line', () => {
  for (const r of COOP_RULE_IDS) {
    assert.ok(RULE_INFO[r]?.name, r);
    assert.ok(RULE_INFO[r].line.length > 10 && !RULE_INFO[r].line.includes('\n'), `${r}: one line`);
  }
  assert.deepEqual(Object.keys(RULE_INFO).sort(), [...COOP_RULE_IDS].sort());
});

test('names: cleaned like the leaderboard, problems explained', () => {
  assert.deepEqual(checkName('  al-x!z9 '), { name: 'ALXZ9', problem: null });
  assert.deepEqual(checkName('Zoë'), { name: 'ZOE', problem: null });
  assert.equal(checkName('abcdefgh').name, 'ABCDEF');
  assert.ok(checkName('').problem);
  assert.ok(checkName('!!!').problem, 'nothing left after cleaning');
  assert.ok(checkName('5h1t').problem, 'blocked words stay blocked');
});

test('codes: typing keeps only code letters, a pasted link gives its code', () => {
  assert.equal(typedCode('abc def'), 'ABCDEF');
  assert.equal(typedCode('ab-cd-ef-gh'), 'ABCDEF', 'at most 6');
  assert.equal(typedCode('O0I1L'), '', 'look-alikes are not in the alphabet');
  assert.equal(typedCode('https://x.github.io/game/?join=k7mq2p&net=local'), 'K7MQ2P');
  assert.equal(typedCode(null), '');
  assert.deepEqual(checkCode('k7mq2p'), { code: 'K7MQ2P', problem: null });
  assert.deepEqual(checkCode('K7MQ'), { code: null, problem: NET_MESSAGES.badCode });
});

test('hostChoice: a full, cleaned CoopChoice or the first problem', () => {
  assert.deepEqual(hostChoice({ name: 'al', difficulty: 'hard', rule: 'knockout' }).choice, { role: 'host', name: 'AL', difficulty: 'hard', rule: 'knockout' });
  assert.ok(hostChoice({ name: '', difficulty: 'hard', rule: 'shared' }).problem);
  assert.ok(hostChoice({ name: 'AL', difficulty: 'nightmare', rule: 'shared' }).problem);
  assert.ok(hostChoice({ name: 'AL', difficulty: 'easy', rule: 'tag' }).problem);
  for (const d of DIFFICULTIES) for (const r of COOP_RULE_IDS) assert.equal(hostChoice({ name: 'A', difficulty: d, rule: r }).problem, null);
});

test('joinChoice: name first, then the code', () => {
  assert.deepEqual(joinChoice({ name: 'bo', code: 'k7m-q2p' }).choice, { role: 'join', name: 'BO', code: 'K7MQ2P' });
  const noName = joinChoice({ name: '', code: 'nope' });
  assert.equal(noName.choice, null);
  assert.equal(noName.problem, checkName('').problem);
  assert.equal(joinChoice({ name: 'BO', code: 'nope' }).problem, NET_MESSAGES.badCode);
});

test('lobby: Start only for the host once the friend is in; a custom status wins', () => {
  assert.deepEqual(lobbyView({ role: 'host', partnerName: null }), { status: 'Waiting for your friend…', canStart: false, showStart: true });
  const ready = lobbyView({ role: 'host', partnerName: 'BO' });
  assert.equal(ready.canStart, true);
  assert.match(ready.status, /BO/);
  const guest = lobbyView({ role: 'guest', partnerName: 'AL' });
  assert.equal(guest.canStart, false);
  assert.equal(guest.showStart, false);
  assert.match(guest.status, /AL/);
  assert.equal(lobbyView({ role: 'host', partnerName: 'BO', status: 'Connecting…' }).status, 'Connecting…');
});

test('notice texts', () => {
  assert.equal(joinedText('BO'), 'BO joined');
  assert.equal(leftText('BO'), 'BO left');
  assert.equal(leftText('BO', 'left'), 'BO left');
  assert.match(leftText('BO', 'timeout'), /BO/);
  assert.equal(caughtText('BO'), 'Doodle caught BO!');
  assert.equal(spectatingText('BO'), 'Spectating BO');
  assert.equal(waitingText('BO'), 'Waiting for BO…');
  assert.equal(joinedText(null), 'Your friend joined', 'no name yet still reads well');
  assert.equal(lagText(123.6), 'lag 124 ms');
  assert.equal(lagText(null), 'lag –');
});

test('notices: the partner name is remembered from PARTNER_JOINED and used later', () => {
  let s = initialNotices();
  let out = reduceNotices(s, EVENTS.PARTNER_JOINED, { name: 'BO' });
  assert.deepEqual(out.toasts, ['BO joined']);
  s = out.state;
  out = reduceNotices(s, EVENTS.NET_STATUS, { status: 'waiting', lagMs: 340 });
  assert.equal(out.state.waiting, 'Waiting for BO…');
  assert.equal(out.state.lagMs, 340);
  s = reduceNotices(out.state, EVENTS.NET_STATUS, { status: 'ok', lagMs: 90 }).state;
  assert.equal(s.waiting, null);
  assert.equal(s.lagMs, 90);
});

test('notices: knock-out — partner caught is a toast, local caught is a banner until PLAYER_UP or a day card', () => {
  let s = reduceNotices(initialNotices(), 'partnerName', { name: 'AL' }).state;
  const other = reduceNotices(s, EVENTS.PLAYER_DOWN, { playerId: 'host', local: false, name: 'AL' });
  assert.deepEqual(other.toasts, ['Doodle caught AL!']);
  assert.equal(other.state.spectating, null);

  const me = reduceNotices(s, EVENTS.PLAYER_DOWN, { playerId: 'guest', local: true, name: 'BO' });
  assert.deepEqual(me.toasts, []);
  assert.equal(me.state.spectating, 'Spectating AL', 'you watch your partner, not yourself');
  assert.equal(reduceNotices(me.state, EVENTS.PLAYER_UP, { playerId: 'host', local: false }).state.spectating, 'Spectating AL', 'the partner getting up changes nothing');
  assert.equal(reduceNotices(me.state, EVENTS.PLAYER_UP, { playerId: 'guest', local: true }).state.spectating, null);
  assert.equal(reduceNotices(me.state, 'dayCard').state.spectating, null);
});

test('notices: the partner leaving clears the banners; reset keeps the name', () => {
  let s = reduceNotices(initialNotices(), EVENTS.PARTNER_JOINED, { name: 'BO' }).state;
  s = reduceNotices(s, EVENTS.PLAYER_DOWN, { local: true }).state;
  s = reduceNotices(s, EVENTS.NET_STATUS, { status: 'waiting', lagMs: null }).state;
  const left = reduceNotices(s, EVENTS.PARTNER_LEFT, { name: 'BO', reason: 'timeout' });
  assert.equal(left.toasts.length, 1);
  assert.equal(left.state.spectating, null);
  assert.equal(left.state.waiting, null);
  const reset = reduceNotices(s, 'reset').state;
  assert.deepEqual(reset, { ...initialNotices(), partner: 'BO' });
  assert.deepEqual(reduceNotices(s, 'notAnEvent').toasts, []);
});

test('leaderboard modes: solo calls top() plainly, co-op passes its rule', () => {
  assert.deepEqual(BOARD_MODES, ['solo', ...COOP_RULE_IDS]);
  for (const m of BOARD_MODES) assert.ok(BOARD_MODE_NAMES[m], m);
  assert.equal(boardOpts('solo'), undefined);
  for (const r of COOP_RULE_IDS) assert.deepEqual(boardOpts(r), { coop: r });
  assert.equal(teamName('AL', 'BO'), 'AL & BO');
  assert.equal(teamName('AL'), 'AL');
  assert.equal(teamName('AL', ''), 'AL');
});

test('isPartnerPayload: playerId decides, else a replay is the partner', () => {
  assert.equal(isPartnerPayload({}), false, 'solo events are local');
  assert.equal(isPartnerPayload(undefined), false);
  assert.equal(isPartnerPayload({ playerId: 'guest' }, 'host'), true);
  assert.equal(isPartnerPayload({ playerId: 'host' }, 'host'), false);
  assert.equal(isPartnerPayload({ playerId: 'guest', remote: true }, 'guest'), false, 'your own action, replayed back by the host');
  assert.equal(isPartnerPayload({ remote: true }, 'guest'), true);
});
