// Held-item icons and the interact hand, drawn on canvas. Items are drawn small
// (32×32) with crisp alpha, then shown scaled up with pixelated rendering, to
// match the game's chunky low-res look.

import { ITEMS } from '../core/contracts.js';

const SIZE = 32;
const OUTLINE = '#1a1222';

function shape(ctx, fill, draw, line = 2) {
  ctx.beginPath();
  draw(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function key(ctx, metal, bow) {
  shape(ctx, metal, (c) => {
    c.rect(13, 14, 15, 4);
    c.rect(22, 18, 3, 4);
    c.rect(26, 18, 2, 3);
  });
  bow(ctx);
}

const DRAW = {
  [ITEMS.PADLOCK_KEY](ctx) {
    key(ctx, '#e8b84a', (c) => {
      shape(c, '#e8b84a', (k) => k.arc(9, 16, 6, 0, Math.PI * 2));
      shape(c, '#2a1d12', (k) => k.arc(9, 16, 2.2, 0, Math.PI * 2), 1);
    });
  },
  [ITEMS.TOY_CHEST_KEY](ctx) {
    key(ctx, '#c38cff', (c) => {
      // a heart-shaped bow
      shape(c, '#ff6fa8', (k) => {
        k.moveTo(9, 23);
        k.bezierCurveTo(1, 17, 3, 8, 9, 12);
        k.bezierCurveTo(15, 8, 17, 17, 9, 23);
      });
    });
  },
  [ITEMS.JEEP_KEY](ctx) {
    shape(ctx, '#cfd6dd', (c) => {
      c.moveTo(15, 14);
      c.lineTo(28, 14);
      c.lineTo(28, 16);
      c.lineTo(26, 17);
      c.lineTo(28, 18);
      c.lineTo(24, 19);
      c.lineTo(15, 19);
      c.closePath();
    });
    shape(ctx, '#2b2b33', (c) => rrect(c, 3, 9, 13, 15, 5));
    shape(ctx, '#e8463c', (c) => c.arc(9.5, 16.5, 2.5, 0, Math.PI * 2), 1);
  },
  [ITEMS.HAMMER](ctx) {
    ctx.save();
    ctx.translate(16, 16);
    ctx.rotate(-0.7);
    shape(ctx, '#b8793a', (c) => rrect(c, -2.5, -4, 5, 18, 2));
    shape(ctx, '#8d99a6', (c) => {
      c.moveTo(-9, -11);
      c.lineTo(8, -11);
      c.lineTo(10, -8);
      c.lineTo(8, -5);
      c.lineTo(-9, -5);
      c.lineTo(-11, -8);
      c.closePath();
    });
    ctx.restore();
  },
  [ITEMS.CAR_BATTERY](ctx) {
    shape(ctx, '#e8463c', (c) => c.rect(8, 6, 5, 4));
    shape(ctx, '#2b2b33', (c) => c.rect(20, 6, 5, 4));
    shape(ctx, '#3c4450', (c) => rrect(c, 3, 9, 26, 18, 2));
    shape(ctx, '#f2c94c', (c) => c.rect(6, 15, 20, 5), 1);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(9, 17, 3, 1);
    ctx.fillRect(10, 16, 1, 3);
    ctx.fillRect(21, 17, 3, 1);
  },
  [ITEMS.FUSE](ctx) {
    shape(ctx, 'rgba(190, 230, 255, 0.85)', (c) => rrect(c, 9, 11, 14, 10, 3));
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 16);
    for (let x = 10; x <= 22; x += 2) ctx.lineTo(x, x % 4 ? 14 : 18);
    ctx.stroke();
    shape(ctx, '#cfd6dd', (c) => rrect(c, 4, 10, 6, 12, 1.5));
    shape(ctx, '#cfd6dd', (c) => rrect(c, 22, 10, 6, 12, 1.5));
  },
  [ITEMS.TENNIS_BALL](ctx) {
    shape(ctx, '#d4f040', (c) => c.arc(16, 16, 11, 0, Math.PI * 2));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(5, 16, 8, -1.1, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(27, 16, 8, Math.PI - 1.1, Math.PI + 1.1);
    ctx.stroke();
  },
  [ITEMS.TREATS](ctx) {
    shape(ctx, '#c08a52', (c) => {
      c.moveTo(7, 9);
      c.lineTo(25, 9);
      c.lineTo(27, 28);
      c.lineTo(5, 28);
      c.closePath();
    });
    shape(ctx, '#a06f3c', (c) => {
      c.moveTo(7, 9);
      c.lineTo(10, 5);
      c.lineTo(22, 5);
      c.lineTo(25, 9);
      c.closePath();
    });
    // a bone on the label
    shape(ctx, '#fff4dc', (c) => {
      c.rect(11, 17, 10, 3);
      for (const [x, y] of [[11, 17], [11, 20], [21, 17], [21, 20]]) {
        c.moveTo(x + 2, y);
        c.arc(x, y, 2, 0, Math.PI * 2);
      }
    }, 1);
  },
  [ITEMS.LAUNCHER](ctx) {
    shape(ctx, '#f2c94c', (c) => c.rect(20, 10, 9, 5)); // barrel
    shape(ctx, '#ff8a3d', (c) => rrect(c, 4, 8, 18, 9, 3)); // body
    shape(ctx, '#4a7dff', (c) => {
      c.moveTo(8, 16);
      c.lineTo(14, 16);
      c.lineTo(12, 27);
      c.lineTo(6, 27);
      c.closePath();
    }); // grip
    shape(ctx, '#4a7dff', (c) => c.arc(9, 12, 2, 0, Math.PI * 2), 1);
  },
  [ITEMS.DART](ctx) {
    ctx.save();
    ctx.translate(16, 16);
    ctx.rotate(-0.6);
    shape(ctx, '#4a7dff', (c) => rrect(c, -12, -3.5, 18, 7, 2));
    shape(ctx, '#ff8a3d', (c) => {
      c.moveTo(6, -3.5);
      c.lineTo(10, -5);
      c.lineTo(12, 0);
      c.lineTo(10, 5);
      c.lineTo(6, 3.5);
      c.closePath();
    });
    ctx.restore();
  },
};

function unknown(ctx) {
  shape(ctx, '#6b5a7a', (c) => rrect(c, 6, 6, 20, 20, 4));
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('?', 16, 22);
}

/** Snap alpha to on/off so the scaled-up icon reads as pixel art, not blur. */
function crisp(ctx) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 96 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

/** Draw the icon for an ItemId into a canvas (made 32×32; style it bigger). */
export function drawItemIcon(canvas, itemId) {
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (!itemId) return canvas;
  (DRAW[itemId] ?? unknown)(ctx);
  crisp(ctx);
  return canvas;
}

export const ICON_ITEMS = Object.freeze(Object.keys(DRAW));

/** The open hand the center dot turns into over something usable. */
export function drawHand(canvas, size = 44) {
  const scale = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.ceil(size * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale((size * scale) / 32, (size * scale) / 32);
  ctx.lineJoin = 'round';
  const fill = '#fff8ee';
  const finger = (x, y, h, rot = 0) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    shape(ctx, fill, (c) => rrect(c, -2.4, -h, 4.8, h + 4, 2.4), 1.6);
    ctx.restore();
  };
  finger(10, 15, 9, -0.12);
  finger(14.5, 14, 11);
  finger(19, 14.5, 10.5, 0.05);
  finger(23.2, 16.5, 8, 0.18);
  ctx.save();
  ctx.translate(8, 21);
  ctx.rotate(-1.0);
  shape(ctx, fill, (c) => rrect(c, -2.6, -8, 5.2, 10, 2.6), 1.6);
  ctx.restore();
  shape(ctx, fill, (c) => rrect(c, 7.5, 13, 18, 15, 6), 1.6);
  // cover the seams where fingers meet the palm
  ctx.fillStyle = fill;
  ctx.fillRect(8.5, 13.5, 16.5, 4);
  canvas.style.width = canvas.style.height = `${size}px`;
  return canvas;
}
