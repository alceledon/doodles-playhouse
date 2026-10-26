// Menus and cards: title (with difficulty select, How to Play and Settings),
// the DAY N card, pause, win and game over. Each show*() returns a promise
// that resolves with the player's choice.

import { DIFFICULTIES, MAX_DAYS } from '../core/contracts.js';
import { createRng } from '../core/rng.js';
import { cue } from '../audio/cues.js';
import { CRAYONS, crayonDot, crayonText, doodleSketch } from './crayon.js';
import { button, el, tween, wait } from './dom.js';
import { QUALITIES, SENSITIVITY_RANGE } from './settings.js';
import { DIFFICULTY_INFO, HOW_TO_PLAY, ROUTE_TEXT, daysLeftText, formatTime, pauseHint } from './text.js';
import { UI_TUNING } from './tuning.js';

/**
 * @param {{layer: HTMLElement, settings: () => Object, changeSettings: (patch: Object) => void, bestTimes: () => Object,
 *   inputMode?: () => 'touch'|'desktop', onPlay?: () => void}} deps
 *   inputMode: menus show touch wording and controls in touch mode; onPlay runs inside the Play tap.
 */
export function createScreens({ layer, settings, changeSettings, bestTimes, inputMode = () => 'desktop', onPlay = () => {} }) {
  const touch = () => inputMode() === 'touch';

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

      const footer = el('div', 'dp-row', [
        button('How to Play', () => openHowTo(), 'dp-quiet'),
        button('Settings', () => openSettings(), 'dp-quiet'),
      ]);

      const sketch = el('div', 'dp-sketch-wrap', [doodleSketch({ size: 190 })]);
      s.append(art, tagline, grid, footer, sketch);

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

  function endScreen(className, parts, label) {
    return new Promise((resolve) => {
      const s = screen(`dp-solid dp-instant ${className}`);
      let busy = false;
      const b = button(label, async () => {
        if (busy) return;
        busy = true;
        await leave(s);
        resolve();
      }, 'dp-primary');
      s.append(...parts, b);
      b.focus({ preventScroll: true });
    });
  }

  function showWin({ route, days, seconds, difficulty, best }) {
    const record = bestTimes()[difficulty];
    const parts = [
      crayonText('YOU ESCAPED!', { size: 92, seed: 'win', rotate: 0.12 }).canvas,
      el('p', 'dp-sub', ROUTE_TEXT[route] ?? 'You got out.'),
      stats([
        ['Difficulty', DIFFICULTY_INFO[difficulty]?.name ?? difficulty],
        ['Days used', `${days} of ${MAX_DAYS}`],
        ['Time', formatTime(seconds)],
        ['Best', record ? formatTime(record) : '—'],
      ]),
      best ? el('div', 'dp-badge', 'New best time!') : null,
    ].filter(Boolean);
    return endScreen('', parts, 'Back to title');
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

  return { showTitle, showDayCard, showPause, showWin, showGameOver, openSettings, openHowTo };
}
