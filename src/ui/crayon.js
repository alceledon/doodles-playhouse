// Crayon lettering and doodles, drawn procedurally on canvas: each stroke is a
// handful of thin, jittery, semi-transparent passes with little gaps, then the
// whole layer is pitted with paper grain. No fonts, no images.

import { createRng } from '../core/rng.js';
import { GLYPH_GAP, GLYPH_HEIGHT, glyphFor } from './glyphs.js';
import { UI_TUNING } from './tuning.js';

export const CRAYONS = Object.freeze(['#ff5d73', '#ffb84d', '#ffe45c', '#7ee081', '#5cc8ff', '#b98cff', '#ff8fd1']);

/** Points every `step` px along a polyline, each with its unit normal. */
function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, nx, ny });
  }
  const [lx, ly] = pts[pts.length - 1];
  const prev = out[out.length - 1];
  out.push({ x: lx, y: ly, nx: prev?.nx ?? 0, ny: prev?.ny ?? 1 });
  return out;
}

/** One waxy crayon stroke along a polyline of [x, y] pixel points. */
export function crayonStroke(ctx, pts, width, color, rnd) {
  if (pts.length < 2) return;
  const path = resample(pts, Math.max(1.5, width * 0.35));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let p = 0; p < UI_TUNING.crayon.passes; p++) {
    const off = (rnd() - 0.5) * width * 0.8;
    const wob = rnd() * 10;
    ctx.globalAlpha = 0.28 + rnd() * 0.32;
    ctx.lineWidth = width * (0.2 + rnd() * 0.26);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < path.length; i++) {
      if (rnd() < UI_TUNING.crayon.gapChance) {
        pen = false; // the wax skips
        continue;
      }
      const { x, y, nx, ny } = path[i];
      const j = off + Math.sin(i * 0.35 + wob) * width * 0.12 + (rnd() - 0.5) * width * 0.16;
      if (pen) ctx.lineTo(x + nx * j, y + ny * j);
      else ctx.moveTo(x + nx * j, y + ny * j);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A crayon circle outline (slightly overshooting, like a kid's). */
export function crayonCircle(ctx, cx, cy, r, width, color, rnd) {
  const pts = [];
  const start = rnd() * Math.PI * 2;
  const n = Math.max(12, Math.round(r / 2));
  for (let k = 0; k <= n * 1.08; k++) {
    const a = start + (k / n) * Math.PI * 2;
    const rr = r * (1 + (rnd() - 0.5) * 0.06);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  crayonStroke(ctx, pts, width, color, rnd);
}

/** Scribble-fill a circle with back-and-forth hatching. */
export function crayonDot(ctx, cx, cy, r, width, color, rnd) {
  const pts = [];
  const a = -0.6 + rnd() * 0.3;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rows = Math.max(2, Math.ceil((2 * r) / (width * 0.55)));
  for (let k = 0; k <= rows; k++) {
    const u = -r + (2 * r * k) / rows;
    const half = Math.sqrt(Math.max(0, r * r - u * u));
    const v0 = k % 2 ? half : -half;
    pts.push([cx + ca * v0 - sa * u, cy + sa * v0 + ca * u]);
    pts.push([cx - ca * v0 - sa * u, cy - sa * v0 + ca * u]);
  }
  crayonStroke(ctx, pts, width, color, rnd);
  crayonCircle(ctx, cx, cy, r, width * 0.8, color, rnd);
}

/** Knock tiny holes in everything drawn so far: the paper showing through the wax. */
export function paperGrain(ctx, rnd, density = UI_TUNING.crayon.grain) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // work in device pixels
  ctx.globalCompositeOperation = 'destination-out';
  const n = Math.floor(w * h * density);
  for (let k = 0; k < n; k++) {
    ctx.globalAlpha = 0.3 + rnd() * 0.6;
    const s = 1 + Math.floor(rnd() * 2);
    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), s, s);
  }
  ctx.restore();
}

/**
 * Draw crayon text on a new canvas.
 * @param {string} text   '\n' splits lines; lowercase is drawn as uppercase
 * @param {Object} [o]
 *   size     letter height in px (default 64)
 *   colors   crayon colors, cycled per letter (or one color string)
 *   seed     same seed = same wobble
 *   rotate   max per-letter tilt in radians
 *   align    'center' | 'left'
 *   scale    canvas pixels per CSS pixel (sharper on hi-dpi)
 * @returns {{canvas: HTMLCanvasElement, letters: {ch: string, x: number, y: number, w: number, h: number, color: string}[], cssWidth: number, cssHeight: number}}
 *   letter boxes are in CSS pixels, relative to the canvas
 */
export function crayonText(text, o = {}) {
  const size = o.size ?? 64;
  const scale = o.scale ?? Math.min(2, globalThis.devicePixelRatio || 1);
  const colors = typeof o.colors === 'string' ? [o.colors] : o.colors ?? CRAYONS;
  const rotate = o.rotate ?? 0.1;
  const rnd = (() => {
    const g = createRng(o.seed ?? text);
    return () => g.next();
  })();
  const unit = size / GLYPH_HEIGHT;
  const width = Math.max(2, unit * (o.weight ?? 0.95));
  const lineGap = size * (o.lineGap ?? 0.45);
  const pad = size * 0.3;

  const lines = String(text).split('\n');
  const lineWidths = lines.map((l) => {
    let w = 0;
    [...l].forEach((ch, k, arr) => (w += glyphFor(ch).w + (k < arr.length - 1 ? GLYPH_GAP : 0)));
    return w * unit;
  });
  const cssWidth = Math.ceil(Math.max(...lineWidths) + pad * 2);
  const cssHeight = Math.ceil(lines.length * size + (lines.length - 1) * lineGap + pad * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(cssWidth * scale);
  canvas.height = Math.ceil(cssHeight * scale);
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const lctx = layer.getContext('2d');
  lctx.scale(scale, scale);

  const letters = [];
  let colorIndex = Math.floor(rnd() * colors.length);
  lines.forEach((line, li) => {
    let x = o.align === 'left' ? pad : (cssWidth - lineWidths[li]) / 2;
    const y = pad + li * (size + lineGap);
    for (const ch of line) {
      const g = glyphFor(ch);
      if (g.s.length) {
        const color = colors[colorIndex++ % colors.length];
        const cx = x + (g.w * unit) / 2;
        const cy = y + size / 2;
        const rot = (rnd() - 0.5) * 2 * rotate;
        const dy = (rnd() - 0.5) * size * 0.08;
        const sc = 0.94 + rnd() * 0.12;
        lctx.save();
        lctx.translate(cx, cy + dy);
        lctx.rotate(rot);
        lctx.scale(sc, sc);
        for (const stroke of g.s) {
          const pts = stroke.map(([gx, gy]) => [(gx - g.w / 2) * unit + (rnd() - 0.5) * unit * 0.15, (gy - GLYPH_HEIGHT / 2) * unit + (rnd() - 0.5) * unit * 0.15]);
          crayonStroke(lctx, pts, width, color, rnd);
        }
        lctx.restore();
        letters.push({ ch, x, y: y + dy, w: g.w * unit, h: size, color, rot });
      }
      x += (g.w + GLYPH_GAP) * unit;
    }
  });
  paperGrain(lctx, rnd);

  // A soft dark halo keeps bright wax readable on any background.
  const ctx = canvas.getContext('2d');
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = size * 0.12 * scale;
  ctx.drawImage(layer, 0, 0);
  ctx.shadowBlur = 0;
  ctx.drawImage(layer, 0, 0);

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.className = 'crayon';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', String(text).replace(/\n/g, ' '));
  return { canvas, letters, cssWidth, cssHeight };
}

/**
 * A kid's crayon drawing of Doodle on paper, for the title screen. A few angry
 * scribbles across it make it less cute.
 */
export function doodleSketch({ size = 220, seed = 'sketch' } = {}) {
  const scale = Math.min(2, globalThis.devicePixelRatio || 1);
  const g = createRng(seed);
  const rnd = () => g.next();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(size * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const s = size / 100; // drawn on a 100×100 grid
  const P = (pts) => pts.map(([x, y]) => [x * s, y * s]);
  const W = 3.2 * s;

  ctx.fillStyle = '#efe4c8'; // paper
  ctx.fillRect(0, 0, size, size);
  const gold = '#d99a2b';
  const brown = '#7a4a1e';
  crayonCircle(ctx, 50 * s, 52 * s, 27 * s, W, gold, rnd); // head
  for (const k of [0, 1, 2]) crayonCircle(ctx, (34 + k * 16) * s, 27 * s, 8 * s, W * 0.8, gold, rnd); // curly top
  crayonStroke(ctx, P([[27, 38], [16, 48], [14, 66], [22, 74], [28, 62]]), W, brown, rnd); // floppy ears
  crayonStroke(ctx, P([[73, 38], [84, 48], [86, 66], [78, 74], [72, 62]]), W, brown, rnd);
  crayonDot(ctx, 40 * s, 48 * s, 4.2 * s, W * 0.7, '#222', rnd); // eyes
  crayonDot(ctx, 60 * s, 48 * s, 4.2 * s, W * 0.7, '#222', rnd);
  crayonDot(ctx, 50 * s, 60 * s, 4 * s, W * 0.7, '#3a2210', rnd); // nose
  crayonStroke(ctx, P([[38, 66], [44, 71], [50, 67], [56, 71], [62, 66]]), W * 0.8, '#3a2210', rnd); // smile
  crayonStroke(ctx, P([[47, 70], [47, 79], [50, 82], [53, 79], [53, 70]]), W * 0.8, '#ff6f91', rnd); // tongue
  crayonStroke(ctx, P([[30, 84], [70, 86]]), W * 0.9, '#c0392b', rnd); // red collar
  crayonDot(ctx, 50 * s, 89 * s, 3.2 * s, W * 0.6, '#ffd84d', rnd); // tag
  // Somebody scratched at the corner of it.
  for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push([62 + i * 6 + rnd() * 3, 8 + k * 7 + (i % 2 ? 7 : -3) + rnd() * 3]);
    crayonStroke(ctx, P(pts), W * 0.45, 'rgba(120, 12, 24, 0.8)', rnd);
  }
  paperGrain(ctx, rnd, 0.02);
  canvas.style.width = canvas.style.height = `${size}px`;
  canvas.className = 'sketch';
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}
