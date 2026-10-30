// Menus and cards: title (with difficulty select, How to Play, Settings, the
// Leaderboard and, with co-op on, "Play with a friend"), the DAY N card, pause,
// win (with posting to the leaderboard) and game over. Each show*() returns a
// promise that resolves with the player's choice. The co-op menu, lobby and
// message box are in coopscreens.js.

import { DIFFICULTIES, MAX_DAYS } from '../core/contracts.js';
import { createRng } from '../core/rng.js';
import { cue } from '../audio/cues.js';
import { NAME_MAX, cleanName, nameProblem, ranksOf, roundSeconds, timeProblem } from '../leaderboard/entries.js';
import { BOARD_MODES, BOARD_MODE_NAMES, COOP_TEXT, RULE_INFO, boardOpts, teamName } from './coop.js';
import { createCoopScreens } from './coopscreens.js';
import { CRAYONS, crayonDot, crayonText, doodleSketch } from './crayon.js';
import { button, el, tween, wait } from './dom.js';
import { QUALITIES, SENSITIVITY_RANGE } from './settings.js';
import {
  BOARD_TEXT,
  DIFFICULTY_INFO,
  HOW_TO_PLAY,
  ROUTE_SHORT,
  ROUTE_TEXT,
  daysLeftText,
  formatTime,
  formatTimeTenths,
  pauseHint,
  placeText,
} from './text.js';
import { UI_TUNING } from './tuning.js';

/**
 * @param {{layer: HTMLElement, settings: () => Object, changeSettings: (patch: Object) => void, bestTimes: () => Object,
 *   inputMode?: () => 'touch'|'desktop', onPlay?: () => void, leaderboard?: Object|null,
 *   lastDifficulty?: () => string|null, playerName?: () => string, savePlayerName?: (name: string) => void,
 *   coop?: {enabled: boolean, code?: string|null}|null}} deps
 *   inputMode: menus show touch wording and controls in touch mode; onPlay runs inside the Play tap.
 *   leaderboard: an enabled Leaderboard (contracts.js), or null for none; lastDifficulty picks its first tab;
 *   playerName / savePlayerName remember the name last posted (and typed in the co-op menu).
 *   coop: with enabled true the title offers "Play with a friend" and the board gets co-op tabs; code opens Join.
 */
export function createScreens({
  layer, settings, changeSettings, bestTimes, inputMode = () => 'desktop', onPlay = () => {},
  leaderboard = null, lastDifficulty = () => null, playerName = () => '', savePlayerName = () => {}, coop = null,
}) {
  const touch = () => inputMode() === 'touch';
  const coopOn = !!coop?.enabled;
  let inviteCode = coopOn && coop.code ? String(coop.code) : null; // used by the first title only

  function screen(className = '') {
    const s = el('div', `dp-screen ${className}`.trim());
    s.setAttribute('role', 'dialog');
    layer.append(s);
    return s;
  }

  async function leave(s) {
    s.classList.add('dp-leaving');
    await wait(UI_TUNING.screenFade);
    s.remove();
  }

  /** Esc closes a sub-panel. Returns the remover. */
  function onEsc(fn) {
    const h = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        fn();
      }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }

  const coopScreens = createCoopScreens({ screen, leave, onEsc, touch, onPlay, playerName, savePlayerName });

  // ---- sub-panels ------------------------------------------------------------

  function openSettings() {
    return new Promise((resolve) => {
      const s = screen('dp-solid');
      s.append(crayonText('SETTINGS', { size: 46, seed: 'settings' }).canvas);
      const panel = el('div', 'dp-panel');
      const cur = settings();

      const slider = (label, key, { min, max, step }, show) => {
        const input = el('input');
        Object.assign(input, { type: 'range', min, max, step, value: cur[key] });
        const out = el('output', '', show(cur[key]));
        input.addEventListener('input', () => {
          const v = Number(input.value);
          out.textContent = show(v);
          changeSettings({ [key]: v });
        });
        const row = el('label', 'dp-setting', [el('span', '', label), input, out]);
        return { row, input };
      };
      // Touch gets its own look speed: a finger drag isn't a mouse count.
      const sens = touch()
        ? slider('Look sensitivity', 'touchSensitivity', SENSITIVITY_RANGE, (v) => `${v.toFixed(2)}×`)
        : slider('Mouse sensitivity', 'mouseSensitivity', SENSITIVITY_RANGE, (v) => `${v.toFixed(2)}×`);
      const vol = slider('Volume', 'volume', { min: 0, max: 1, step: 0.05 }, (v) => `${Math.round(v * 100)}%`);
      vol.input.addEventListener('change', () => cue('jingle', { gain: 1.2 })); // a preview at the new level

      const invert = el('input');
      invert.type = 'checkbox';
      invert.checked = cur.invertY;
      invert.addEventListener('change', () => changeSettings({ invertY: invert.checked }));
      const invertRow = el('label', 'dp-setting', [el('span', '', touch() ? 'Invert look Y' : 'Invert mouse Y'), invert, el('span')]);

      const seg = el('div', 'dp-seg');
      const qButtons = QUALITIES.map((q) => {
        const b = button(q[0].toUpperCase() + q.slice(1), () => {
          changeSettings({ quality: q });
          for (const other of qButtons) other.setAttribute('aria-pressed', String(other === b));
        });
        b.setAttribute('aria-pressed', String(cur.quality === q));
        return b;
      });
      seg.append(...qButtons);
      const qualityRow = el('div', 'dp-setting', [el('span', '', 'Render quality'), seg, el('span')]);

      panel.append(sens.row, invertRow, vol.row, qualityRow);
      const close = async () => {
        offEsc();
        await leave(s);
        resolve();
      };
      const back = button('Back', close, 'dp-primary');
      const offEsc = onEsc(close);
      s.append(panel, back);
      back.focus({ preventScroll: true }); // a short screen opens at its top, not scrolled to Back
    });
  }

  function openHowTo() {
    return new Promise((resolve) => {
      const s = screen('dp-solid');
      s.append(crayonText('HOW TO PLAY', { size: 46, seed: 'howto' }).canvas);
      const panel = el('div', 'dp-panel');
      for (const p of HOW_TO_PLAY.intro) panel.append(el('p', '', p));
      const keys = el('div', 'dp-keys');
      for (const [k, what] of touch() ? HOW_TO_PLAY.touchControls : HOW_TO_PLAY.controls) keys.append(el('kbd', '', k), el('span', '', what));
      panel.append(keys);
      const close = async () => {
        offEsc();
        await leave(s);
        resolve();
      };
      const back = button('Back', close, 'dp-primary');
      const offEsc = onEsc(close);
      s.append(panel, back);
      back.focus({ preventScroll: true }); // a short screen opens at its top, not scrolled to Back
    });
  }

  // ---- leaderboard -------------------------------------------------------------

  /**
   * A board as a table: rank, name, time (tenths), days used, way out. `me` (the
   * player's own post) is highlighted, or added under a "…" row if it's below these.
   */
  function boardTable(rows, me = null) {
    const ranks = ranksOf(rows);
    const body = el('tbody', '', rows.map((r, k) => boardRow(r, ranks[k], !!me && r.id === me.id)));
    if (me && !rows.some((r) => r.id === me.id)) {
      const gap = el('td', '', '…');
      gap.colSpan = BOARD_TEXT.columns.length;
      body.append(el('tr', 'dp-gap', [gap]), boardRow(me, me.rank ?? '?', true));
    }
    const head = el('thead', '', [el('tr', '', BOARD_TEXT.columns.map((c) => el('th', '', c)))]);
    return el('table', 'dp-board', [head, body]);
  }

  function boardRow(r, rank, mine) {
    const tr = el('tr', mine ? 'dp-me' : '', [
      el('td', 'dp-rank', String(rank)),
      el('td', 'dp-name', teamName(r.name, r.name2)),
      el('td', 'dp-time', formatTimeTenths(r.seconds)),
      el('td', 'dp-days', String(r.days ?? '')),
      el('td', 'dp-route', ROUTE_SHORT[r.route] ?? ''),
    ]);
    const when = r.at ? new Date(r.at) : null;
    if (when && !Number.isNaN(when.getTime())) tr.title = when.toLocaleDateString();
    return tr;
  }

  /** Title → Leaderboard: a tab per difficulty with its top 10. Esc or Back closes it. */
  function openLeaderboard(initial = lastDifficulty()) {
    if (!leaderboard) return Promise.resolve();
    return new Promise((resolve) => {
      const s = screen('dp-solid dp-board-screen');
      s.append(crayonText('LEADERBOARD', { size: 46, seed: 'board' }).canvas);
      const panel = el('div', 'dp-panel dp-board-panel');
      const tabs = el('div', 'dp-tabs');
      tabs.setAttribute('role', 'tablist');
      const body = el('div', 'dp-board-body');
      body.setAttribute('aria-live', 'polite');
      let current = DIFFICULTIES.includes(initial) ? initial : 'normal';
      let mode = 'solo'; // co-op on: 'shared' / 'knockout' show that rule's co-op boards
      let ticket = 0;
      let closed = false;

      const modeButtons = coopOn
        ? BOARD_MODES.map((m) => {
          const b = button(BOARD_MODE_NAMES[m], () => selectMode(m), 'dp-tab dp-mode');
          b.dataset.mode = m;
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', String(m === mode));
          return b;
        })
        : null;
      const modes = modeButtons ? el('div', 'dp-tabs dp-modes', modeButtons) : null;
      if (modes) modes.setAttribute('role', 'tablist');

      const tabButtons = DIFFICULTIES.map((d) => {
        const b = button(DIFFICULTY_INFO[d].name, () => select(d), 'dp-tab');
        b.dataset.d = d;
        b.setAttribute('role', 'tab');
        return b;
      });
      tabs.append(...tabButtons);

      const message = (text, extra = null) => el('div', 'dp-board-msg', [el('p', '', text), extra]);
      async function load() {
        const mine = ++ticket; // a later tab (or Retry) wins over a slow answer
        body.replaceChildren(message(BOARD_TEXT.loading));
        let rows;
        try {
          const opts = boardOpts(mode);
          rows = await (opts ? leaderboard.top(current, 10, opts) : leaderboard.top(current, 10));
        } catch {
          if (mine === ticket && !closed) body.replaceChildren(message(BOARD_TEXT.offline, button(BOARD_TEXT.retry, load)));
          return;
        }
        if (mine !== ticket || closed) return;
        body.replaceChildren(rows.length ? boardTable(rows) : message(BOARD_TEXT.empty));
      }
      function select(d) {
        current = d;
        for (const b of tabButtons) b.setAttribute('aria-selected', String(b.dataset.d === d));
        load();
      }
      function selectMode(m) {
        mode = m;
        for (const b of modeButtons) b.setAttribute('aria-selected', String(b.dataset.mode === m));
        load();
      }

      const close = async () => {
        if (closed) return;
        closed = true;
        offEsc();
        await leave(s);
        resolve();
      };
      const back = button('Back', close, 'dp-primary');
      const offEsc = onEsc(close);
      panel.append(...[modes, tabs, body].filter(Boolean));
      s.append(panel, back);
      select(current);
      back.focus({ preventScroll: true });
    });
  }

  /**
   * The win screen's leaderboard box: a name field and "Post my time", then the
   * player's place and the top 10. Returns {root, input} (input is null when
   * there's nothing to type), or null when there's nothing to show. A run is
   * posted at most once, and "Back to title" never waits on any of it.
   */
  function postBox({ route, days, seconds, difficulty }) {
    if (!leaderboard) return null;
    if (!leaderboard.canSubmit) return { root: el('p', 'dp-sub dp-post-note', BOARD_TEXT.testRun), input: null };
    if (timeProblem(roundSeconds(seconds))) return null; // under a minute: the board won't take it
    const boardName = DIFFICULTY_INFO[difficulty]?.name ?? difficulty;

    const input = el('input', 'dp-name-input');
    // Room for more than NAME_MAX: a paste like "al-x!z9" is cut by cleanName after the symbols go, not before.
    Object.assign(input, { type: 'text', maxLength: NAME_MAX * 4, value: cleanName(playerName()), placeholder: BOARD_TEXT.namePlaceholder });
    input.spellcheck = false;
    // Capitals on phone keyboards, no autofill or autocorrect fighting cleanName, and a Send key.
    const attrs = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', enterkeyhint: 'send', 'aria-label': BOARD_TEXT.nameLabel };
    for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    const send = button(BOARD_TEXT.post, () => post(), 'dp-primary');
    const msg = el('p', 'dp-post-msg');
    msg.setAttribute('aria-live', 'polite');
    const box = el('section', 'dp-post', [el('p', 'dp-post-label', BOARD_TEXT.nameLabel), el('div', 'dp-post-row', [input, send]), msg]);
    box.setAttribute('aria-label', BOARD_TEXT.title);

    let state = 'idle'; // idle → sending → posted; a failed send goes back to idle for Retry
    const tidy = () => {
      const clean = cleanName(input.value);
      if (clean !== input.value) input.value = clean;
      msg.textContent = clean ? nameProblem(clean) ?? '' : ''; // "type a name" waits for a send
    };
    input.addEventListener('input', (e) => {
      if (!e.isComposing) tidy(); // leave an IME composition alone until it ends
    });
    input.addEventListener('compositionend', tidy);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      post();
    });

    async function post() {
      if (state !== 'idle') return;
      const name = cleanName(input.value);
      input.value = name;
      const problem = nameProblem(name);
      if (problem) {
        msg.textContent = problem;
        if (!touch()) input.focus({ preventScroll: true });
        return;
      }
      savePlayerName(name);
      state = 'sending';
      input.blur(); // on a phone this drops the keyboard, so the answer shows
      input.disabled = send.disabled = true;
      send.textContent = BOARD_TEXT.sending;
      msg.textContent = '';
      let result;
      try {
        result = await leaderboard.submit({ name, seconds, days, route, difficulty });
      } catch (err) {
        state = 'idle';
        input.disabled = send.disabled = false;
        send.textContent = err?.kind === 'invalid' ? BOARD_TEXT.post : BOARD_TEXT.retry;
        msg.textContent = err?.message || BOARD_TEXT.offline;
        if (!touch()) send.focus({ preventScroll: true });
        return;
      }
      state = 'posted';
      showPlace(box, result, difficulty, boardName);
    }

    return { root: box, input };
  }

  /** After posting: the place, then that board's top 10 with our row marked. opts: top()'s co-op option. */
  function showPlace(box, { id, rank = null, entry = {} }, difficulty, boardName, opts) {
    const me = { ...entry, id, rank };
    const list = el('div', 'dp-post-board');
    box.replaceChildren(el('p', 'dp-post-head', placeText(rank, boardName)), list);
    const load = async () => {
      list.replaceChildren(el('p', 'dp-post-msg dp-dim', BOARD_TEXT.loading));
      try {
        list.replaceChildren(boardTable(await (opts ? leaderboard.top(difficulty, 10, opts) : leaderboard.top(difficulty, 10)), me));
      } catch {
        list.replaceChildren(el('p', 'dp-post-msg', BOARD_TEXT.topFailed), button(BOARD_TEXT.retry, load, 'dp-quiet'));
      }
    };
    load();
  }

  /**
   * The co-op win's box: names are known already, so just "Post our time". Only the host
   * posts (canPost); the guest gets a note. Same shape as postBox's result (input is null).
   */
  function coopPostBox({ route, days, seconds, difficulty, coop }) {
    if (!leaderboard) return null;
    if (!leaderboard.canSubmit) return { root: el('p', 'dp-sub dp-post-note', BOARD_TEXT.testRun), input: null };
    if (timeProblem(roundSeconds(seconds))) return null;
    if (!coop.canPost) return { root: el('p', 'dp-sub dp-post-note', COOP_TEXT.coopBoardsNote), input: null };
    const [name, name2] = (coop.names ?? []).map(cleanName);
    if (nameProblem(name) || nameProblem(name2)) return null; // the menu cleaned them, so this is a bug elsewhere
    const rule = coop.rule;
    const boardName = `${RULE_INFO[rule]?.name ?? rule} ${DIFFICULTY_INFO[difficulty]?.name ?? difficulty}`;
    const send = button(COOP_TEXT.postCoop, () => post(), 'dp-primary');
    const msg = el('p', 'dp-post-msg');
    msg.setAttribute('aria-live', 'polite');
    const box = el('section', 'dp-post', [el('p', 'dp-post-label', `${teamName(name, name2)} on the ${boardName} co-op board`), send, msg]);
    box.setAttribute('aria-label', BOARD_TEXT.title);
    let state = 'idle';
    async function post() {
      if (state !== 'idle') return;
      state = 'sending';
      send.disabled = true;
      send.textContent = BOARD_TEXT.sending;
      msg.textContent = '';
      let result;
      try {
        result = await leaderboard.submit({ name, name2, seconds, days, route, difficulty, coop: rule });
      } catch (err) {
        state = 'idle';
        send.disabled = false;
        send.textContent = err?.kind === 'invalid' ? COOP_TEXT.postCoop : BOARD_TEXT.retry;
        msg.textContent = err?.message || BOARD_TEXT.offline;
        return;
      }
      state = 'posted';
      showPlace(box, result, difficulty, boardName, { coop: rule });
    }
    return { root: box, input: null };
  }

  // ---- title -----------------------------------------------------------------

  function titleArt() {
    const art = el('div', 'dp-title-art');
    const { canvas, letters, cssWidth, cssHeight } = crayonText("DOODLE'S\nPLAYHOUSE", { size: 104, seed: 'title-v1', rotate: 0.13 });
    // The two O's in DOODLE are eyes, and they watch the cursor.
    const pupils = el('canvas', 'dp-pupils');
    pupils.width = canvas.width;
    pupils.height = canvas.height;
    const pctx = pupils.getContext('2d');
    const k = canvas.width / cssWidth;
    const eyes = letters.filter((l) => l.ch === 'O').slice(0, 2);
    const mid = { x: cssWidth / 2, y: cssHeight / 2 };
    if (eyes.length) {
      mid.x = eyes.reduce((a, e) => a + e.x + e.w / 2, 0) / eyes.length;
      mid.y = eyes.reduce((a, e) => a + e.y + e.h / 2, 0) / eyes.length;
    }
    let look = { x: 0, y: 0 };
    let raf = 0;
    const draw = () => {
      raf = 0;
      pctx.setTransform(k, 0, 0, k, 0, 0);
      pctx.clearRect(0, 0, cssWidth, cssHeight);
      const g = createRng('pupils');
      const rnd = () => g.next();
      for (const e of eyes) {
        const cx = e.x + e.w / 2;
        const cy = e.y + e.h / 2;
        crayonDot(pctx, cx, cy, e.w * 0.36, e.w * 0.14, '#f4ecd8', rnd); // eye white
        const r = e.w * 0.17;
        const px = cx + look.x * e.w * 0.16;
        const py = cy + look.y * e.w * 0.16;
        crayonDot(pctx, px, py, r, r * 0.6, '#120c18', rnd);
        pctx.fillStyle = 'rgba(255, 240, 160, 0.9)';
        pctx.beginPath();
        pctx.arc(px - r * 0.35, py - r * 0.35, r * 0.2, 0, Math.PI * 2);
        pctx.fill();
      }
    };
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dx = e.clientX - (rect.left + (rect.width * mid.x) / cssWidth);
      const dy = e.clientY - (rect.top + (rect.height * mid.y) / cssHeight);
      const len = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, len / 300);
      look = { x: (dx / len) * reach, y: (dy / len) * reach };
      if (!raf) raf = requestAnimationFrame(draw);
    };
    addEventListener('pointermove', onMove);
    draw();
    art.append(canvas, pupils);
    return { art, dispose: () => removeEventListener('pointermove', onMove) };
  }

  function showTitle() {
    return new Promise((resolve) => {
      const s = screen('dp-title');
      const { art, dispose } = titleArt();
      const tagline = el('p', 'dp-tagline', 'Everyone else went home. Doodle didn’t.');

      const best = bestTimes();
      const grid = el('div', 'dp-difficulties');
      let chosen = false;
      const cards = DIFFICULTIES.map((d) => {
        const info = DIFFICULTY_INFO[d];
        const card = button('', async () => {
          if (chosen) return;
          chosen = true;
          onPlay(); // before any await: full screen only works inside the tap
          dispose();
          await leave(s);
          resolve({ difficulty: d });
        }, 'dp-card');
        card.dataset.d = d;
        card.append(
          el('span', 'dp-card-name', info.name),
          el('span', 'dp-card-line', info.line),
          el('span', 'dp-card-best', best[d] ? `Best ${formatTime(best[d])}` : ''),
        );
        return card;
      });
      grid.append(...cards);

      // Co-op: one more choice under the cards. It opens its own menu over the title.
      const startCoop = async (code = null) => {
        if (chosen) return;
        const choice = await coopScreens.openCoop(code);
        if (!choice || chosen) return;
        chosen = true;
        dispose();
        await leave(s);
        resolve({ coop: choice });
      };
      const coopBtn = coopOn ? button('', () => startCoop(), 'dp-card dp-coop-play') : null;
      coopBtn?.append(el('span', 'dp-card-name', COOP_TEXT.play), el('span', 'dp-card-line', COOP_TEXT.playLine));

      const footer = el('div', 'dp-row', [
        button('How to Play', () => openHowTo(), 'dp-quiet'),
        button('Settings', () => openSettings(), 'dp-quiet'),
        leaderboard ? button(BOARD_TEXT.title, () => openLeaderboard(), 'dp-quiet') : null,
      ]);

      const sketch = el('div', 'dp-sketch-wrap', [doodleSketch({ size: 190 })]);
      s.append(...[art, tagline, grid, coopBtn, footer, sketch].filter(Boolean));

      // Eyeshine blinking in the dark corners.
      const g = createRng('eyes');
      for (let k = 0; k < 4; k++) {
        const eyes = el('div', 'dp-eyes');
        const left = k % 2 ? 70 + g.next() * 25 : 3 + g.next() * 22;
        eyes.style.left = `${left}%`;
        eyes.style.top = `${18 + g.next() * 70}%`;
        eyes.style.animationDelay = `${k * 2.3 + g.next() * 2}s`;
        eyes.style.transform = `scale(${0.6 + g.next() * 0.6})`;
        s.append(eyes);
      }
      cards[2].focus({ preventScroll: true });
      if (inviteCode) {
        const code = inviteCode;
        inviteCode = null;
        startCoop(code);
      }
    });
  }

  // ---- day card -------------------------------------------------------------

  /** Black screen, crayon DAY N, days left. Stays black until it resolves (the wake blink takes over). */
  async function showDayCard(day) {
    const D = UI_TUNING.dayCard;
    const s = screen('dp-daycard');
    const last = day >= MAX_DAYS;
    const title = crayonText(`DAY ${day}`, { size: 130, seed: `day-${day}`, colors: last ? ['#ff5d73', '#ff8a6a'] : CRAYONS, rotate: 0.09 }).canvas;
    const sub = el('div', `dp-days-left${last ? ' dp-last' : ''}`, daysLeftText(day));
    for (const e of [title, sub]) {
      e.style.opacity = '0';
      e.style.transform = 'translateY(10px)';
    }
    s.append(title, sub);
    cue('toll', { gain: last ? 1.2 : 0.9 });
    await tween(D.fadeIn, (t) => {
      title.style.opacity = sub.style.opacity = String(t);
      title.style.transform = sub.style.transform = `translateY(${(1 - t) * 10}px)`;
    });
    await wait(D.hold);
    await tween(D.fadeOut, (t) => (title.style.opacity = sub.style.opacity = String(1 - t)));
    s.remove();
  }

  // ---- pause ----------------------------------------------------------------

  function showPause() {
    return new Promise((resolve) => {
      const s = screen();
      s.append(crayonText('PAUSED', { size: 72, seed: 'paused' }).canvas);
      let busy = false;
      const done = async (choice) => {
        if (busy) return;
        busy = true;
        await leave(s);
        resolve(choice);
      };
      const resume = button('Resume', () => done('resume'), 'dp-primary');
      const col = el('div', 'dp-row', [
        resume,
        button('Settings', () => openSettings(), ''),
        button('How to Play', () => openHowTo(), ''),
        button('Quit to title', () => done('quit'), 'dp-quiet'),
      ]);
      s.append(col, el('p', 'dp-sub', pauseHint(inputMode())));
      resume.focus({ preventScroll: true });
    });
  }

  // ---- end screens ------------------------------------------------------------

  function stats(rows) {
    const dl = el('dl', 'dp-stats');
    for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
    return dl;
  }

  /** `focus`: what takes the keyboard first (default: the button). */
  function endScreen(className, parts, label, focus = null) {
    return new Promise((resolve) => {
      const s = screen(`dp-solid dp-instant ${className}`.trim());
      let busy = false;
      const b = button(label, async () => {
        if (busy) return;
        busy = true;
        await leave(s);
        resolve();
      }, 'dp-primary');
      s.append(...parts, b);
      (focus ?? b).focus({ preventScroll: true });
    });
  }

  function showWin({ route, days, seconds, difficulty, best, coop = null }) {
    const record = bestTimes()[difficulty];
    const post = coop ? coopPostBox({ route, days, seconds, difficulty, coop }) : postBox({ route, days, seconds, difficulty });
    // Co-op: both names and the rule instead of the solo best time.
    const rows = coop
      ? [
        ['Players', teamName(...(coop.names ?? []))],
        ['Rule', RULE_INFO[coop.rule]?.name ?? coop.rule],
        ['Difficulty', DIFFICULTY_INFO[difficulty]?.name ?? difficulty],
        ['Days used', `${days} of ${MAX_DAYS}`],
        ['Time', formatTime(seconds)],
      ]
      : [
        ['Difficulty', DIFFICULTY_INFO[difficulty]?.name ?? difficulty],
        ['Days used', `${days} of ${MAX_DAYS}`],
        ['Time', formatTime(seconds)],
        ['Best', record ? formatTime(record) : '—'],
      ];
    const parts = [
      crayonText('YOU ESCAPED!', { size: 92, seed: 'win', rotate: 0.12 }).canvas,
      el('p', 'dp-sub', ROUTE_TEXT[route] ?? 'You got out.'),
      // A column; on a phone on its side the post box sits beside the stats (ui.css).
      el('div', 'dp-win-body', [
        el('div', 'dp-win-stats', [
          stats(rows),
          best ? el('div', 'dp-badge', 'New best time!') : null,
        ]),
        post?.root,
      ]),
    ];
    // On a desktop the name field takes the keyboard. On touch, focusing it would pop the keyboard over the screen.
    return endScreen('dp-win', parts, 'Back to title', post?.input && !touch() ? post.input : null);
  }

  function showGameOver({ difficulty, seconds }) {
    const parts = [
      crayonText('DOODLE HAS A\nNEW CHEW TOY.', { size: 70, seed: 'chew-toy', colors: ['#ff5d73', '#ffb84d', '#d99a2b'], rotate: 0.1 }).canvas,
      el('p', 'dp-sub', `Caught on day ${MAX_DAYS}. So close.`),
      stats([
        ['Difficulty', DIFFICULTY_INFO[difficulty]?.name ?? difficulty],
        ['Time', formatTime(seconds)],
      ]),
    ];
    return endScreen('dp-gameover', parts, 'Back to title');
  }

  return {
    showTitle, showDayCard, showPause, showWin, showGameOver, openSettings, openHowTo, openLeaderboard,
    showLobby: coopScreens.showLobby,
    showMessage: coopScreens.showMessage,
    openCoop: coopScreens.openCoop,
    /** The next title opens straight on Join with this code (what a ?join= link does). */
    setInviteCode: (code) => (inviteCode = code ? String(code) : null),
  };
}
