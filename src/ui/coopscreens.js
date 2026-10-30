// Co-op screens: the "Play with a friend" menu (host: name → difficulty → rule;
// join: name and code), the lobby, and the OK message box. The words and the
// input checks are in coop.js; screens.js lends its screen helpers.

import { DIFFICULTIES } from '../core/contracts.js';
import { NAME_MAX } from '../leaderboard/entries.js';
import { CODE_LENGTH } from '../net/room.js';
import { COOP_TEXT, RULE_INFO, checkCode, checkName, hostChoice, joinChoice, lobbyView, typedCode } from './coop.js';
import { crayonText } from './crayon.js';
import { button, el } from './dom.js';
import { DIFFICULTY_INFO } from './text.js';

/**
 * @param {{screen: (cls?: string) => HTMLElement, leave: (s: HTMLElement) => Promise<void>, onEsc: (fn: Function) => Function,
 *   touch: () => boolean, onPlay: () => void, playerName: () => string, savePlayerName: (name: string) => void}} kit
 */
export function createCoopScreens({ screen, leave, onEsc, touch, onPlay, playerName, savePlayerName }) {
  const focus = (e) => e?.focus({ preventScroll: true });
  /** Inputs take the keyboard on a desktop; on touch that would pop the keyboard over the menu. */
  const focusField = (input, fallback) => focus(touch() ? fallback : input);

  /** A text field styled like the leaderboard's name box. `clean` runs as you type. */
  function field({ value, placeholder, label, maxLength, clean, onEnter, className = '' }) {
    const input = el('input', `dp-name-input ${className}`.trim());
    Object.assign(input, { type: 'text', maxLength, value: clean(value ?? ''), placeholder });
    input.spellcheck = false;
    const attrs = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', enterkeyhint: 'go', 'aria-label': label };
    for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    const tidy = () => {
      const c = clean(input.value);
      if (c !== input.value) input.value = c;
    };
    input.addEventListener('input', (e) => !e.isComposing && tidy());
    input.addEventListener('compositionend', tidy);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      onEnter();
    });
    return input;
  }

  const labelled = (text, input) => el('label', 'dp-coop-field', [el('span', 'dp-post-label', text), input]);

  /** A big choice button: a name and a line under it (like the difficulty cards). */
  function choiceCard(name, line, onClick, data = {}) {
    const card = button('', onClick, 'dp-card dp-coop-card');
    Object.assign(card.dataset, data);
    card.append(el('span', 'dp-card-name', name), el('span', 'dp-card-line', line));
    return card;
  }

  // ---- the menu -------------------------------------------------------------------------

  /**
   * "Play with a friend". Resolves a CoopChoice, or null on Back/Esc from the first step.
   * With `code` it opens straight on Join with the code filled in.
   */
  function openCoop(code = null) {
    return new Promise((resolve) => {
      const s = screen('dp-solid dp-coop');
      const heading = crayonText(COOP_TEXT.title, { size: 52, seed: 'coop', rotate: 0.1 }).canvas;
      const body = el('div', 'dp-panel dp-coop-panel');
      const backBtn = button(COOP_TEXT.back, () => back(), 'dp-quiet');
      s.append(heading, body, backBtn);

      const draft = { name: playerName(), code: code ?? '', difficulty: 'normal', rule: 'shared' };
      let step = code ? 'join' : 'mode';
      const opened = step; // Back from here closes the menu
      let done = false;

      const finish = async (choice) => {
        if (done) return;
        done = true;
        offEsc();
        if (choice) {
          onPlay(); // still inside the tap: full screen on touch
          savePlayerName(choice.name);
        }
        resolve(choice);
        await leave(s);
      };

      const PREV = { mode: null, hostName: 'mode', hostDifficulty: 'hostName', hostRule: 'hostDifficulty', join: 'mode' };
      function back() {
        const prev = step === opened ? null : PREV[step];
        if (prev) go(prev);
        else finish(null);
      }
      const offEsc = onEsc(back);

      function go(next) {
        step = next;
        body.replaceChildren();
        RENDER[step]();
      }

      const msgLine = () => {
        const m = el('p', 'dp-post-msg');
        m.setAttribute('aria-live', 'polite');
        return m;
      };

      const nameInput = (onEnter) =>
        field({ value: draft.name, placeholder: COOP_TEXT.namePlaceholder, label: COOP_TEXT.nameLabel, maxLength: NAME_MAX * 4, clean: (v) => checkName(v).name, onEnter });

      const RENDER = {
        mode() {
          const host = choiceCard(COOP_TEXT.host, COOP_TEXT.hostLine, () => go('hostName'), { coop: 'host' });
          const join = choiceCard(COOP_TEXT.join, COOP_TEXT.joinLine, () => go('join'), { coop: 'join' });
          body.append(el('div', 'dp-coop-choices', [host, join]));
          focus(host);
        },
        hostName() {
          const msg = msgLine();
          const next = () => {
            const n = checkName(input.value);
            draft.name = input.value = n.name;
            if (n.problem) {
              msg.textContent = n.problem;
              focusField(input, nextBtn);
              return;
            }
            go('hostDifficulty');
          };
          const input = nameInput(next);
          input.addEventListener('input', () => (draft.name = input.value));
          const nextBtn = button(COOP_TEXT.next, next, 'dp-primary');
          body.append(el('div', 'dp-coop-form', [labelled(COOP_TEXT.nameLabel, input), msg, nextBtn]));
          focusField(input, nextBtn);
        },
        hostDifficulty() {
          const cards = DIFFICULTIES.map((d) =>
            choiceCard(DIFFICULTY_INFO[d].name, DIFFICULTY_INFO[d].line, () => {
              draft.difficulty = d;
              go('hostRule');
            }, { d }),
          );
          body.append(el('p', 'dp-post-label', COOP_TEXT.pickDifficulty), el('div', 'dp-difficulties dp-coop-difficulties', cards));
          focus(cards[Math.max(0, DIFFICULTIES.indexOf(draft.difficulty))]);
        },
        hostRule() {
          const cards = Object.entries(RULE_INFO).map(([rule, info]) =>
            choiceCard(info.name, info.line, () => {
              draft.rule = rule;
              const { choice } = hostChoice(draft);
              if (choice) finish(choice);
              else go('hostName'); // can't happen: the name was checked two steps ago
            }, { rule }),
          );
          body.append(el('p', 'dp-post-label', COOP_TEXT.pickRule), el('div', 'dp-coop-choices', cards));
          focus(cards[draft.rule === 'knockout' ? 1 : 0]);
        },
        join() {
          const msg = msgLine();
          const submit = () => {
            draft.name = name.value = checkName(name.value).name;
            draft.code = codeIn.value = typedCode(codeIn.value);
            const { choice, problem } = joinChoice(draft);
            if (choice) return finish(choice);
            msg.textContent = problem;
            focusField(checkName(draft.name).problem ? name : codeIn, joinBtn);
          };
          // The first field that still needs typing; with both fine, the Join button.
          const firstNeeded = () => (checkName(name.value).problem ? name : checkCode(codeIn.value).problem ? codeIn : joinBtn);
          const name = nameInput(() => (checkCode(codeIn.value).code ? submit() : focus(codeIn)));
          const codeIn = field({ value: draft.code, placeholder: COOP_TEXT.codePlaceholder, label: COOP_TEXT.codeLabel, maxLength: 200, clean: typedCode, onEnter: submit, className: 'dp-code-input' });
          codeIn.size = CODE_LENGTH + 1;
          name.addEventListener('input', () => (draft.name = name.value));
          codeIn.addEventListener('input', () => (draft.code = codeIn.value));
          const joinBtn = button(COOP_TEXT.joinGo, submit, 'dp-primary');
          body.append(el('div', 'dp-coop-form', [el('div', 'dp-coop-row', [labelled(COOP_TEXT.nameLabel, name), labelled(COOP_TEXT.codeLabel, codeIn)]), msg, joinBtn]));
          // An invite link already filled the code, so usually only the name is left (or nothing).
          focusField(firstNeeded(), joinBtn);
        },
      };
      go(step);
    });
  }

  // ---- the lobby --------------------------------------------------------------------------

  /** showLobby(info) → {update, result, close} (contracts.js LobbyInfo / LobbyHandle). */
  function showLobby(info) {
    let cur = { partnerName: null, status: undefined, ...info };
    const s = screen('dp-solid dp-lobby');
    let resolveResult;
    const result = new Promise((r) => (resolveResult = r));
    let closed = false;

    const codeBox = el('div', 'dp-lobby-code');
    const linkBox = el('div', 'dp-lobby-link');
    const players = el('dl', 'dp-stats dp-lobby-players');
    const rules = el('p', 'dp-sub dp-lobby-rules');
    const status = el('p', 'dp-lobby-status');
    status.setAttribute('aria-live', 'polite');
    const startBtn = button(COOP_TEXT.start, () => choose('start'), 'dp-primary');
    const cancelBtn = button(COOP_TEXT.cancel, () => choose('cancel'), 'dp-quiet');
    const buttons = el('div', 'dp-row', [startBtn, cancelBtn]);
    s.append(
      el('div', 'dp-lobby-body', [el('div', 'dp-lobby-left', [codeBox, linkBox]), el('div', 'dp-lobby-right', [players, rules, status])]),
      buttons,
    );
    const offEsc = onEsc(() => choose('cancel'));

    let shownCode = null;
    let shownLink = null;
    function render() {
      if (cur.code !== shownCode) {
        shownCode = cur.code;
        codeBox.replaceChildren(
          el('p', 'dp-post-label', COOP_TEXT.codeLabel),
          crayonText(String(cur.code ?? '').toUpperCase() || '------', { size: 84, seed: `code-${cur.code}`, rotate: 0.05 }).canvas,
        );
      }
      const showLink = cur.role === 'host' && !!cur.link;
      if ((showLink ? cur.link : null) !== shownLink) {
        shownLink = showLink ? cur.link : null;
        linkBox.replaceChildren(...(showLink ? linkRow(cur.link) : []));
      }
      const friend = cur.partnerName || null;
      players.replaceChildren(
        el('dt', '', COOP_TEXT.you),
        el('dd', '', cur.name ?? ''),
        el('dt', '', cur.role === 'host' ? COOP_TEXT.friend : COOP_TEXT.host_),
        el('dd', friend ? '' : 'dp-dim', friend ?? COOP_TEXT.noFriendYet),
      );
      const d = DIFFICULTY_INFO[cur.difficulty]?.name ?? cur.difficulty ?? '';
      const r = RULE_INFO[cur.rule];
      rules.replaceChildren(el('strong', '', `${d} · ${r?.name ?? cur.rule ?? ''}`), document.createTextNode(r ? ` — ${r.line}` : ''));
      const view = lobbyView(cur);
      status.textContent = view.status;
      startBtn.hidden = !view.showStart;
      const wasDisabled = startBtn.disabled;
      startBtn.disabled = !view.canStart || closed;
      if (wasDisabled && !startBtn.disabled && !touch()) focus(startBtn);
    }

    function linkRow(link) {
      const input = el('input', 'dp-link-input');
      Object.assign(input, { type: 'text', value: link, readOnly: true });
      input.setAttribute('aria-label', COOP_TEXT.inviteLabel);
      input.addEventListener('focus', () => input.select());
      let resetTimer = 0;
      const copy = button(COOP_TEXT.copy, async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(link);
          ok = true;
        } catch {
          try {
            input.focus({ preventScroll: true });
            input.select();
            ok = document.execCommand('copy');
          } catch {}
        }
        copy.textContent = ok ? COOP_TEXT.copied : COOP_TEXT.copyFailed;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => (copy.textContent = COOP_TEXT.copy), 1800);
      });
      const parts = [el('p', 'dp-post-label', COOP_TEXT.inviteLabel), el('div', 'dp-post-row', [input, copy])];
      if (typeof navigator.share === 'function') {
        const share = button(COOP_TEXT.share, () => {
          navigator.share({ title: 'Doodle’s Playhouse', text: COOP_TEXT.shareText, url: link }).catch(() => {}); // cancelling rejects
        });
        parts[1].append(share);
      }
      return parts;
    }

    function choose(choice) {
      if (closed) return;
      if (choice === 'start' && startBtn.disabled) return;
      resolveResult(choice);
      close();
    }

    function close() {
      if (closed) return;
      closed = true;
      offEsc();
      startBtn.disabled = cancelBtn.disabled = true;
      leave(s);
    }

    render();
    focus(cur.role === 'host' ? linkBox.querySelector('button') ?? cancelBtn : cancelBtn);
    return {
      update(patch = {}) {
        if (closed) return;
        cur = { ...cur, ...patch };
        render();
      },
      result,
      close,
    };
  }

  // ---- message --------------------------------------------------------------------------------

  /** A message with an OK button; resolves on OK, Enter or Esc. */
  function showMessage(text) {
    return new Promise((resolve) => {
      const s = screen('dp-solid dp-message');
      let busy = false;
      const done = async () => {
        if (busy) return;
        busy = true;
        offEsc();
        removeEventListener('keydown', onEnter);
        await leave(s);
        resolve();
      };
      const onEnter = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done();
        }
      };
      const offEsc = onEsc(done);
      // keydown fires on the key that opened us too, so listen from the next tick.
      setTimeout(() => !busy && addEventListener('keydown', onEnter), 0);
      const ok = button(COOP_TEXT.ok, done, 'dp-primary');
      s.append(el('p', 'dp-message-text', String(text ?? '')), ok);
      focus(ok);
    });
  }

  return { openCoop, showLobby, showMessage };
}
