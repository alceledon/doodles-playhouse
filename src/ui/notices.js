// Co-op notices over the game: short toasts ("BO joined", "Doodle caught BO!"),
// two banners that stay up ("Spectating BO" while knocked out, "Waiting for
// BO…" while the partner is silent) and, in debug, a lag readout. They sit
// outside the HUD so they still show while it's hidden. The state machine is
// coop.js#reduceNotices; this only draws it.

import { EVENTS } from '../core/events.js';
import { initialNotices, lagText, reduceNotices } from './coop.js';
import { el } from './dom.js';
import { UI_TUNING } from './tuning.js';

const EVENT_TYPES = [EVENTS.PARTNER_JOINED, EVENTS.PARTNER_LEFT, EVENTS.PLAYER_DOWN, EVENTS.PLAYER_UP, EVENTS.NET_STATUS];

export function createNotices(layer, bus, { debug = false } = {}) {
  const spectating = el('div', 'dp-banner dp-spectating');
  const waiting = el('div', 'dp-banner dp-waiting');
  const toasts = el('div', 'dp-notices');
  toasts.setAttribute('role', 'status');
  const lag = el('div', 'dp-lag');
  const root = el('div', 'dp-coop-notices', [spectating, waiting, toasts, lag]);
  layer.append(root);

  let state = initialNotices();

  function toast(text) {
    const t = el('div', 'dp-notice', text);
    toasts.append(t);
    // Newest at the bottom; never more than three at once.
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('dp-leaving');
      setTimeout(() => t.remove(), 400);
    }, UI_TUNING.noticeSeconds * 1000);
  }

  function draw() {
    spectating.textContent = state.spectating ?? '';
    spectating.classList.toggle('dp-on', !!state.spectating);
    waiting.textContent = state.waiting ?? '';
    waiting.classList.toggle('dp-on', !!state.waiting);
    lag.textContent = debug && state.lagMs !== null ? lagText(state.lagMs) : '';
    lag.classList.toggle('dp-on', debug && state.lagMs !== null);
  }

  function apply(type, payload) {
    const out = reduceNotices(state, type, payload ?? {});
    state = out.state;
    for (const t of out.toasts) toast(t);
    draw();
  }

  for (const type of EVENT_TYPES) bus.on(type, (p) => apply(type, p));
  bus.on(EVENTS.RUN_START, () => apply('reset'));
  draw();

  return {
    element: root,
    /** The lobby learned the partner's name. */
    setPartner: (name) => apply('partnerName', { name }),
    /** A day card is up: the knocked-out player is back next day. */
    dayCard: () => apply('dayCard'),
    reset: () => {
      apply('reset');
      toasts.replaceChildren();
    },
    get state() {
      return { ...state };
    },
  };
}
