// Tiny DOM helpers shared by the screens, HUD and cutscenes.

/** el('div', 'a b', 'text') or el('div', 'a', [child, child]) */
export function el(tag, className = '', content = null) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (typeof content === 'string') e.textContent = content;
  else if (Array.isArray(content)) e.append(...content.filter(Boolean));
  return e;
}

export function button(label, onClick, className = '') {
  const b = el('button', `dp-btn ${className}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export const wait = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));

/** Resolves on the next animation frame. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Run fn(t, dt, elapsed) every animation frame for `seconds`, t going 0 → 1.
 * Resolves after the frame where t reaches 1.
 */
export function tween(seconds, fn) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const step = (now) => {
      const elapsed = Math.max(0, (now - t0) / 1000);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = seconds > 0 ? Math.min(1, elapsed / seconds) : 1;
      try {
        fn(t, dt, elapsed);
      } catch (err) {
        console.error('[ui] tween step failed', err);
        resolve();
        return;
      }
      if (t >= 1) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
