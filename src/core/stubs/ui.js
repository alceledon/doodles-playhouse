// STUB UI + cutscenes: plain DOM screens so the run flow is playable before
// the real src/ui/ lands. No styling beyond the basics.

import { EVENTS } from '../events.js';
import { DIFFICULTIES, SETTINGS_DEFAULTS } from '../contracts.js';

function el(tag, style = '', text = '') {
  const e = document.createElement(tag);
  e.style.cssText = style;
  if (text) e.textContent = text;
  return e;
}

const SCREEN = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(5,4,10,.92);color:#f3e9ff;font:20px system-ui,sans-serif;pointer-events:auto;z-index:10';
const BUTTON = 'font:inherit;padding:8px 22px;border-radius:8px;border:2px solid #f3e9ff;background:#2a1f3d;color:#f3e9ff;cursor:pointer';

/** createUI({ root, bus }) → UI */
export function createUI({ root, bus }) {
  const settings = { ...SETTINGS_DEFAULTS };

  const hud = el('div', 'position:fixed;inset:0;pointer-events:none;color:#fff;font:16px system-ui,sans-serif;display:none');
  const dot = el('div', 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#fff;opacity:.8');
  const prompt = el('div', 'position:absolute;left:0;right:0;top:56%;text-align:center;text-shadow:0 1px 3px #000');
  const held = el('div', 'position:absolute;right:24px;bottom:24px;text-shadow:0 1px 3px #000');
  const stamina = el('div', 'position:absolute;left:24px;bottom:24px;height:6px;width:160px;background:#7fd;border-radius:3px');
  hud.append(dot, prompt, held, stamina);
  root.append(hud);

  bus.on(EVENTS.PROMPT, ({ text }) => (prompt.textContent = text ?? ''));
  bus.on(EVENTS.HELD, ({ itemId }) => (held.textContent = itemId ? `Holding: ${itemId}` : ''));

  function screen(title, buttons, subtitle = '') {
    return new Promise((resolve) => {
      const s = el('div', SCREEN);
      s.append(el('div', 'font-size:42px;font-weight:700', title));
      if (subtitle) s.append(el('div', 'opacity:.75', subtitle));
      for (const [label, value] of buttons) {
        const b = el('button', BUTTON, label);
        b.onclick = () => {
          s.remove();
          resolve(value);
        };
        s.append(b);
      }
      root.append(s);
    });
  }

  return {
    settings,
    async showTitle() {
      const difficulty = await screen(
        "Doodle's Playhouse",
        DIFFICULTIES.map((d) => [d[0].toUpperCase() + d.slice(1), d]),
        '(stub UI) WASD move · mouse look · Shift sprint · C crouch · E interact · F flashlight · N noise',
      );
      return { difficulty };
    },
    showDayCard(day) {
      const s = el('div', SCREEN + ';background:#000;font-size:48px', `DAY ${day}`);
      root.append(s);
      return new Promise((r) => setTimeout(() => (s.remove(), r()), 1200));
    },
    showPause: () => screen('Paused', [['Resume', 'resume'], ['Quit to title', 'quit']]),
    showWin: (r) => screen('You escaped!', [['Title', null]], `${r.route} · day ${r.days} · ${r.seconds.toFixed(1)} s`),
    showGameOver: () => screen('Doodle has a new chew toy.', [['Title', null]]),
    setHudVisible: (v) => (hud.style.display = v ? 'block' : 'none'),
    update(dt, { player }) {
      if (player) stamina.style.width = `${160 * player.stamina}px`;
    },
    recordTime: () => false,
  };
}

/** createCutscenes({ camera, getScene, ui, bus }) → Cutscenes */
export function createCutscenes() {
  function fade(text, ms = 1000) {
    const s = el('div', SCREEN + ';background:#000;transition:opacity .3s;opacity:0', text);
    document.body.append(s);
    requestAnimationFrame(() => (s.style.opacity = '1'));
    return new Promise((r) => setTimeout(() => (s.remove(), r()), ms));
  }
  return {
    playCatch: () => fade('*CHOMP* (stub catch cutscene)'),
    playGameOver: () => fade('(stub game-over cutscene)', 1200),
    playEscape: ({ route }) => fade(`(stub escape via ${route})`),
    playWake: () => Promise.resolve(),
  };
}
