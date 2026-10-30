// The Granny-minimal HUD: a center dot that becomes a hand over usable things,
// the prompt line, the held item, a stamina bar that only shows while not full,
// lock toasts, and a vignette that closes in when Doodle is near. Prompts are
// reworded for touch ("Tap: ...") while the input mode is touch. In co-op it
// shows only the local player: a prompt or hand about the partner is ignored.

import { EVENTS } from '../core/events.js';
import { approach } from '../audio/curves.js';
import { el } from './dom.js';
import { drawHand, drawItemIcon } from './icons.js';
import { staminaView, vignetteLevel } from './motion.js';
import { isPartnerPayload } from './coop.js';
import { EXIT_MESSAGES, LOCK_MESSAGES, itemName, promptFor } from './text.js';
import { UI_TUNING } from './tuning.js';

export function createHud(layer, bus, { inputMode = () => 'desktop' } = {}) {
  const hud = el('div', 'dp-hud');
  const vignette = el('div', 'dp-vignette');
  const dot = el('div', 'dp-dot');
  const hand = drawHand(el('canvas', 'dp-hand'));
  const reticle = el('div', 'dp-reticle', [dot, hand]);
  const prompt = el('div', 'dp-prompt');
  prompt.setAttribute('role', 'status');
  const icon = el('canvas');
  const uses = el('div', 'dp-held-uses');
  const heldName = el('div', 'dp-held-name');
  const held = el('div', 'dp-held', [el('div', 'dp-held-icon', [icon, uses]), heldName]);
  const fill = el('div', 'dp-stamina-fill');
  const stamina = el('div', 'dp-stamina', [fill]);
  const toast = el('div', 'dp-toast');
  hud.append(vignette, reticle, prompt, held, stamina, toast);
  layer.append(hud);

  let vig = 0;
  let toastTimer = 0;
  let lastStamina = null;
  let localId = 'host'; // from update()'s player; a solo run is 'host'
  const mine = (p) => !isPartnerPayload(p, localId);

  let rawPrompt = null; // as Gameplay sent it; reworded when the input mode flips
  function setPrompt(text) {
    rawPrompt = text;
    hud.classList.toggle('dp-has-prompt', !!text);
    if (text) prompt.textContent = promptFor(text, inputMode());
  }

  function setHeld(itemId, n) {
    held.classList.toggle('dp-on', !!itemId);
    if (!itemId) return;
    drawItemIcon(icon, itemId);
    heldName.textContent = itemName(itemId);
    uses.textContent = n === null || n === undefined ? '' : `×${n}`;
    uses.style.display = uses.textContent ? '' : 'none';
  }

  function showToast(text) {
    if (!text) return;
    toast.textContent = text;
    toast.classList.add('dp-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('dp-on'), UI_TUNING.toastSeconds * 1000);
  }

  function reset() {
    setPrompt(null);
    setHeld(null);
    toast.classList.remove('dp-on');
    vig = 0;
    vignette.style.opacity = '0';
  }

  bus.on(EVENTS.PROMPT, (p = {}) => mine(p) && setPrompt(p.text ?? null));
  bus.on(EVENTS.HELD, (p = {}) => mine(p) && setHeld(p.itemId ?? null, p.uses));
  bus.on(EVENTS.LOCK_OPENED, ({ lockId } = {}) => showToast(LOCK_MESSAGES[lockId]));
  bus.on(EVENTS.EXIT_UNLOCKED, ({ route } = {}) => showToast(EXIT_MESSAGES[route]));
  bus.on(EVENTS.RUN_START, reset);
  bus.on(EVENTS.INPUT_MODE, () => setPrompt(rawPrompt));

  return {
    element: hud,
    setVisible(v) {
      hud.classList.toggle('dp-on', !!v);
    },
    update(dt, { player = null, doodle = null } = {}) {
      if (player?.id) localId = player.id;
      const s = staminaView(player ? player.stamina : 1);
      stamina.classList.toggle('dp-on', s.visible);
      stamina.classList.toggle('dp-low', s.low);
      if (s.fraction !== lastStamina) {
        fill.style.width = `${(s.fraction * 100).toFixed(1)}%`;
        lastStamina = s.fraction;
      }
      vig = approach(vig, vignetteLevel(player, doodle), dt, 0.35);
      vignette.style.opacity = vig.toFixed(3);
      vignette.classList.toggle('dp-chase', doodle?.state === 'chase');
    },
    setPrompt,
    setHeld,
    showToast,
    reset,
  };
}
