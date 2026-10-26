// Procedural pixel textures, drawn on 32–64 px canvases and sampled with
// NearestFilter so they stay crunchy up close. Tiling textures (wallpaper,
// floors, wood grain) are separate CanvasTextures; one-off pictures (crayon
// drawings, signs, windows, star sprites) are packed into one atlas so every
// decal in the house is a single draw call.
//
// Each tiling texture records `size`: how many meters one repeat covers.

import * as THREE from 'three';
import { createRng } from '../core/rng.js';

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function pixelTexture(canvas, { repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Sprinkle per-pixel brightness noise so flat colours read as a material. */
function grain(ctx, w, h, rng, amount = 18, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
    img.data[i + 3] = Math.round(img.data[i + 3] * alpha);
  }
  ctx.putImageData(img, 0, 0);
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) ctx.fillRect(x + i, y + j, 1, 1);
}

function star5(ctx, x, y, color, big = false) {
  ctx.fillStyle = color;
  const pts = big
    ? [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3], [3, 3], [1, 4], [3, 4]]
    : [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
  for (const [i, j] of pts) ctx.fillRect(x + i, y + j, 1, 1);
}

/** A wobbly crayon stroke through points. */
function crayon(ctx, pts, color, rng, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = x + (rng.next() - 0.5) * 1.6;
    const jy = y + (rng.next() - 0.5) * 1.6;
    if (i === 0) ctx.moveTo(jx, jy);
    else ctx.lineTo(jx, jy);
  });
  ctx.stroke();
}

/** A kid's crayon drawing of the golden doodle. */
function crayonDog(ctx, x, y, s, rng, { color = '#e0a83a', mad = false } = {}) {
  const blob = (cx, cy, rx, ry) => {
    const pts = [];
    for (let a = 0; a <= 12; a++) pts.push([cx + Math.cos((a / 12) * Math.PI * 2) * rx, cy + Math.sin((a / 12) * Math.PI * 2) * ry]);
    crayon(ctx, pts, color, rng, 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  blob(x, y, 9 * s, 6 * s); // body
  blob(x + 9 * s, y - 6 * s, 5 * s, 5 * s); // head
  for (const lx of [-6, -2, 3, 7]) crayon(ctx, [[x + lx * s, y + 5 * s], [x + lx * s, y + 11 * s]], color, rng, 2);
  crayon(ctx, [[x - 9 * s, y - 1 * s], [x - 14 * s, y - 7 * s]], color, rng, 2); // tail
  crayon(ctx, [[x + 5 * s, y - 9 * s], [x + 4 * s, y - 2 * s]], '#a0702a', rng, 2); // ear
  ctx.fillStyle = mad ? '#d02020' : '#202020';
  ctx.fillRect(Math.round(x + 10 * s), Math.round(y - 7 * s), 2, 2);
  if (mad) crayon(ctx, [[x + 8 * s, y - 3 * s], [x + 12 * s, y - 3 * s]], '#d02020', rng, 1);
  else crayon(ctx, [[x + 8 * s, y - 3 * s], [x + 10 * s, y - 2 * s], [x + 12 * s, y - 3.5 * s]], '#202020', rng, 1);
}

function stickKid(ctx, x, y, rng, color = '#3a7be0') {
  crayon(ctx, [[x, y], [x, y + 8]], color, rng, 1.5);
  crayon(ctx, [[x - 4, y + 3], [x + 4, y + 3]], color, rng, 1.5);
  crayon(ctx, [[x, y + 8], [x - 3, y + 13]], color, rng, 1.5);
  crayon(ctx, [[x, y + 8], [x + 3, y + 13]], color, rng, 1.5);
  dot(ctx, x, y - 3, 2, color);
}

function pixelText(ctx, text, x, y, color, size = 9) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Tiling textures
// ---------------------------------------------------------------------------

const TILING = {
  // wallpapers
  polkaYellow: [0.6, (ctx, r) => polka(ctx, r, 0xf2d870, 0xf07ab8, 0x3a9ad0)],
  polkaPink: [0.6, (ctx, r) => polka(ctx, r, 0xf2b8d0, 0xffffff, 0xd8509a)],
  polkaMint: [0.6, (ctx, r) => polka(ctx, r, 0xb8ecd4, 0xffffff, 0xf0a0c8)],
  starsNavy: [0.7, (ctx, r) => stars(ctx, r, 0x23305e, 0xf5d03a, 0x9ab8ff)],
  stripesBlue: [0.5, (ctx, r) => stripes(ctx, r, 0x8ab8e8, 0xe8f0fa, 0x5a88c8)],
  stripesLilac: [0.5, (ctx, r) => stripes(ctx, r, 0xc8b0ec, 0xf4ecfc, 0x9a7ad0)],
  crayon: [1.4, crayonWall, 64],
  tileMint: [0.45, (ctx, r) => tiles(ctx, r, 0xa8e8cc, 0x6ab89a, 2)],
  tileWhite: [0.4, (ctx, r) => tiles(ctx, r, 0xe8eef2, 0x9ab0bc, 2)],
  tileBlue: [0.4, (ctx, r) => tiles(ctx, r, 0x7ab0e0, 0x3a6a9a, 2)],
  pegboard: [0.5, pegboard],
  concrete: [1.2, (ctx, r) => concrete(ctx, r, 0x8a8a88)],
  brick: [0.8, brick],
  kennel: [1.6, kennelWall, 64],
  rainbow: [1.2, rainbowWall],
  atticWood: [1.0, (ctx, r) => planks(ctx, r, 0x8a6440, true)],
  exterior: [1.0, siding],
  // floors
  wood: [1.0, (ctx, r) => planks(ctx, r, 0xb07a48)],
  woodDark: [1.0, (ctx, r) => planks(ctx, r, 0x7a5030)],
  attic: [1.0, (ctx, r) => planks(ctx, r, 0x9a7048)],
  carpetTeal: [0.5, (ctx, r) => carpet(ctx, r, 0x2a8a8a)],
  carpetPink: [0.5, (ctx, r) => carpet(ctx, r, 0xd88aaa)],
  carpetBlue: [0.5, (ctx, r) => carpet(ctx, r, 0x3a5aa0)],
  checker: [0.8, (ctx) => checker(ctx, 0xf0ece0, 0xe05a7a)],
  // ceilings
  plain: [1.0, (ctx, r) => concrete(ctx, r, 0xd8cfc0, 8)],
  stars: [0.9, (ctx, r) => stars(ctx, r, 0x1a2244, 0x6a7ab0, 0x3a4a80, true)],
  roof: [1.0, (ctx, r) => planks(ctx, r, 0x6a4a30, true)],
  // materials for furniture: near-white so vertex colours tint them
  woodGrain: [0.6, woodGrain],
  fabric: [0.3, fabric],
  fur: [0.25, fur],
  // outside
  grass: [2.0, (ctx, r) => carpet(ctx, r, 0x1e3a22)],
  shingles: [1.0, shingles],
};

function polka(ctx, r, bg, a, b) {
  ctx.fillStyle = css(bg);
  ctx.fillRect(0, 0, 32, 32);
  grain(ctx, 32, 32, r, 8);
  dot(ctx, 8, 8, 3, css(a));
  dot(ctx, 24, 24, 3, css(b));
  dot(ctx, 24, 8, 1, css(a));
  dot(ctx, 8, 24, 1, css(b));
}

function stars(ctx, r, bg, a, b, sparse = false) {
  ctx.fillStyle = css(bg);
  ctx.fillRect(0, 0, 32, 32);
  grain(ctx, 32, 32, r, 6);
  star5(ctx, 5, 5, css(a), true);
  star5(ctx, 21, 19, css(a), true);
  if (!sparse) {
    star5(ctx, 22, 4, css(b));
    star5(ctx, 6, 22, css(b));
  }
  ctx.fillStyle = css(b);
  for (let i = 0; i < 6; i++) ctx.fillRect(r.int(0, 31), r.int(0, 31), 1, 1);
}

function stripes(ctx, r, a, b, line) {
  for (let x = 0; x < 32; x += 8) {
    ctx.fillStyle = css(a);
    ctx.fillRect(x, 0, 5, 32);
    ctx.fillStyle = css(b);
    ctx.fillRect(x + 5, 0, 3, 32);
  }
  ctx.fillStyle = css(line);
  for (let y = 2; y < 32; y += 8) ctx.fillRect(6, y, 1, 3);
  grain(ctx, 32, 32, r, 8);
}

function crayonWall(ctx, r) {
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, 64, 64);
  grain(ctx, 64, 64, r, 8);
  const colors = ['#e83a3a', '#3a7be0', '#45b85a', '#f5a020', '#8a52d0', '#f07ab8'];
  for (let i = 0; i < 9; i++) {
    const pts = [];
    let x = r.range(4, 60);
    let y = r.range(4, 60);
    for (let k = 0; k < 6; k++) {
      x = Math.max(2, Math.min(62, x + r.range(-10, 10)));
      y = Math.max(2, Math.min(62, y + r.range(-8, 8)));
      pts.push([x, y]);
    }
    crayon(ctx, pts, r.pick(colors), r, 1.5);
  }
  crayonDog(ctx, 22, 40, 0.8, r);
  dot(ctx, 52, 12, 4, '#f5d03a');
}

function tiles(ctx, r, c, grout, g) {
  ctx.fillStyle = css(grout);
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = css(c);
  for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]]) ctx.fillRect(x + g / 2, y + g / 2, 16 - g, 16 - g);
  grain(ctx, 32, 32, r, 10);
}

function checker(ctx, a, b) {
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = css((i + j) % 2 ? b : a);
      ctx.fillRect(i * 16, j * 16, 16, 16);
    }
}

function pegboard(ctx, r) {
  ctx.fillStyle = '#a07a50';
  ctx.fillRect(0, 0, 32, 32);
  grain(ctx, 32, 32, r, 14);
  ctx.fillStyle = '#4a3420';
  for (let y = 2; y < 32; y += 4) for (let x = 2; x < 32; x += 4) ctx.fillRect(x, y, 1, 1);
}

function concrete(ctx, r, c, amount = 22) {
  ctx.fillStyle = css(c);
  ctx.fillRect(0, 0, 32, 32);
  grain(ctx, 32, 32, r, amount);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 4; i++) ctx.fillRect(r.int(0, 31), r.int(0, 31), r.int(1, 3), 1);
}

function brick(ctx, r) {
  ctx.fillStyle = '#5a4a44';
  ctx.fillRect(0, 0, 32, 32);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 8 : 0;
    for (let x = -8; x < 32; x += 16) {
      ctx.fillStyle = css(r.pick([0x8a4a3a, 0x9a5442, 0x7a4234]));
      ctx.fillRect(x + off + 1, row * 8 + 1, 14, 6);
    }
  }
  grain(ctx, 32, 32, r, 14);
}

function kennelWall(ctx, r) {
  ctx.fillStyle = '#7a7470';
  ctx.fillRect(0, 0, 64, 64);
  grain(ctx, 64, 64, r, 24);
  // claw marks, low down where a big dog would scratch
  ctx.strokeStyle = 'rgba(30,20,20,0.55)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const x = r.range(6, 54);
    const y = r.range(36, 54);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 3, y);
      ctx.lineTo(x + i * 3 + 5, y + 9);
      ctx.stroke();
    }
  }
}

function rainbowWall(ctx, r) {
  const cols = [0xf8b0b0, 0xf8d0a0, 0xf8f0a8, 0xb8ecb8, 0xb0d0f8, 0xd8c0f8];
  cols.forEach((c, i) => {
    ctx.fillStyle = css(c);
    ctx.fillRect(0, i * 5.33, 32, 6);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 0; x < 32; x += 8) ctx.fillRect(x, 0, 1, 32);
  grain(ctx, 32, 32, r, 6);
}

function planks(ctx, r, c, vertical = false) {
  const base = new THREE.Color(c);
  for (let i = 0; i < 4; i++) {
    const k = 0.85 + r.next() * 0.3;
    ctx.fillStyle = `rgb(${(base.r * 255 * k) | 0},${(base.g * 255 * k) | 0},${(base.b * 255 * k) | 0})`;
    if (vertical) ctx.fillRect(i * 8, 0, 8, 32);
    else ctx.fillRect(0, i * 8, 32, 8);
  }
  grain(ctx, 32, 32, r, 16);
  ctx.fillStyle = 'rgba(30,15,5,0.55)';
  for (let i = 0; i < 4; i++) {
    if (vertical) ctx.fillRect(i * 8, 0, 1, 32);
    else {
      ctx.fillRect(0, i * 8, 32, 1);
      ctx.fillRect(((i * 13) % 24) + 4, i * 8, 1, 8); // staggered butt joints
    }
  }
  ctx.fillStyle = 'rgba(30,15,5,0.35)';
  ctx.fillRect(r.int(2, 28), r.int(2, 28), 2, 2); // a knot
}

function siding(ctx, r) {
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#4a5a72' : '#52627a';
    ctx.fillRect(0, i * 8, 32, 8);
    ctx.fillStyle = '#2a3242';
    ctx.fillRect(0, i * 8 + 7, 32, 1);
  }
  grain(ctx, 32, 32, r, 10);
}

function carpet(ctx, r, c) {
  ctx.fillStyle = css(c);
  ctx.fillRect(0, 0, 32, 32);
  grain(ctx, 32, 32, r, 34);
}

function woodGrain(ctx, r) {
  ctx.fillStyle = '#f0e6d8';
  ctx.fillRect(0, 0, 32, 32);
  grain(ctx, 32, 32, r, 10);
  ctx.fillStyle = 'rgba(120,80,40,0.18)';
  for (let y = 1; y < 32; y += r.int(3, 5)) ctx.fillRect(0, y, 32, 1);
  ctx.fillStyle = 'rgba(120,80,40,0.25)';
  ctx.fillRect(r.int(4, 26), r.int(4, 26), 3, 2);
}

function fabric(ctx, r) {
  ctx.fillStyle = '#f2f0ec';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < 32; i += 2) {
    ctx.fillRect(i, 0, 1, 32);
    ctx.fillRect(0, i, 32, 1);
  }
  grain(ctx, 32, 32, r, 14);
}

function fur(ctx, r) {
  ctx.fillStyle = '#eee8e0';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = 'rgba(80,50,20,0.22)';
  for (let i = 0; i < 40; i++) {
    const x = r.int(0, 30);
    const y = r.int(0, 30);
    ctx.fillRect(x, y, 2, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }
  grain(ctx, 32, 32, r, 16);
}

function shingles(ctx, r) {
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 4 : 0;
    for (let x = -4; x < 32; x += 8) {
      ctx.fillStyle = css(r.pick([0x3a2a30, 0x44323a, 0x302228]));
      ctx.fillRect(x + off, row * 8, 7, 7);
    }
  }
  grain(ctx, 32, 32, r, 10);
}

// ---------------------------------------------------------------------------
// Atlas pictures (UV 0..1 inside their cell). Each returns its canvas size.
// ---------------------------------------------------------------------------

const PICS = {
  drawing1: [64, 48, (ctx, r) => drawing(ctx, r, { sun: true })],
  drawing2: [64, 48, (ctx, r) => drawing(ctx, r, { kid: true, color: '#e8b040' })],
  drawing3: [64, 48, (ctx, r) => drawing(ctx, r, { house: true })],
  drawing4: [64, 48, (ctx, r) => drawing(ctx, r, { hearts: true, color: '#d89a30' })],
  drawingScratched1: [64, 48, (ctx, r) => drawing(ctx, r, { kid: true, scratched: true, mad: true })],
  drawingScratched2: [64, 48, (ctx, r) => drawing(ctx, r, { scratched: true, mad: true, torn: true })],
  drawingCode: [64, 48, drawingCode],
  goodDog: [64, 24, (ctx, r) => woodSign(ctx, r, 'GOOD DOG', '#f5e0a0', '#5a3418')],
  doodleName: [64, 16, (ctx, r) => woodSign(ctx, r, 'DOODLE', '#f0f0f0', '#4a2a10', 10)],
  tunnelSign: [48, 24, (ctx, r) => kidSign(ctx, r, 'TUNNEL', '#45b85a')],
  slideSign: [48, 24, (ctx, r) => kidSign(ctx, r, 'SLIDE!', '#d8343c')],
  danger: [48, 28, danger],
  poster: [32, 48, poster],
  abc: [96, 20, abc],
  oilStain: [32, 24, (ctx, r) => blobs(ctx, r, 'rgba(20,20,24,0.7)', 6, 32, 24)],
  pawPrints: [24, 72, pawPrints],
  scratches: [64, 40, scratches],
  window: [32, 32, (ctx, r) => windowPane(ctx, r, true)],
  windowPlain: [32, 32, (ctx, r) => windowPane(ctx, r, false)],
  windowRound: [32, 32, windowRound],
  windowLit: [32, 32, windowLit],
  moonPatch: [32, 32, moonPatch],
  creaky: [32, 8, creakyPlank],
  star: [16, 16, starSprite],
  slats: [32, 32, slats],
  tvOff: [32, 24, (ctx) => {
    ctx.fillStyle = '#20262a';
    ctx.fillRect(0, 0, 32, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(3, 2, 10, 3);
  }],
  rugRound: [32, 32, rugRound],
  rugRainbow: [32, 32, rugRainbow],
  rugRunner: [16, 48, rugRunner],
  rugMat: [32, 24, rugMat],
  moon: [32, 32, (ctx) => {
    dot(ctx, 16, 16, 13, '#f0ecd0');
    dot(ctx, 11, 12, 3, '#d8d0b0');
    dot(ctx, 20, 20, 2, '#d8d0b0');
    dot(ctx, 21, 10, 1, '#d8d0b0');
  }],
};

function rugRound(ctx, r) {
  // light rings tinted by the rug's vertex colour, with one rainbow ring
  for (let k = 16; k > 0; k -= 2) dot(ctx, 16, 16, k, k % 4 ? '#f0ece4' : '#d8d0c4');
  const rainbow = ['#e83a3a', '#f5a020', '#f5d03a', '#45b85a', '#3a7be0', '#8a52d0'];
  rainbow.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(16, 16, 11 - i * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  });
  grain(ctx, 32, 32, r, 16);
}

function rugRainbow(ctx, r) {
  const rainbow = ['#e83a3a', '#f5a020', '#f5d03a', '#45b85a', '#3a7be0', '#8a52d0'];
  ctx.fillStyle = '#f4f0e8';
  ctx.fillRect(0, 0, 32, 32);
  rainbow.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(2, 2 + i * 4.7, 28, 4);
  });
  ctx.fillStyle = '#f4f0e8';
  for (let x = 0; x < 32; x += 2) {
    ctx.fillRect(x, 0, 1, 1);
    ctx.fillRect(x, 31, 1, 1);
  }
  grain(ctx, 32, 32, r, 18);
}

function rugRunner(ctx, r) {
  ctx.fillStyle = '#7a4aa0';
  ctx.fillRect(0, 0, 16, 48);
  ctx.fillStyle = '#f5d03a';
  ctx.fillRect(1, 0, 1, 48);
  ctx.fillRect(14, 0, 1, 48);
  ctx.fillStyle = '#f07ab8';
  for (let y = 4; y < 48; y += 8) {
    ctx.fillRect(7, y, 2, 2);
    ctx.fillRect(6, y + 1, 4, 1);
  }
  grain(ctx, 16, 48, r, 16);
}

function rugMat(ctx, r) {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 32, 24);
  ctx.fillStyle = '#c8c8c8';
  for (let y = 0; y < 24; y += 4) ctx.fillRect(0, y, 32, 2);
  grain(ctx, 32, 24, r, 14);
}

function paper(ctx, r, w, h, torn = false) {
  ctx.fillStyle = '#fbf7ee';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, r, 6);
  if (torn) {
    ctx.clearRect(w - 10, 0, 10, 6);
    ctx.clearRect(w - 5, 6, 5, 4);
    ctx.clearRect(0, h - 4, 7, 4);
  }
  ctx.fillStyle = 'rgba(200,180,120,0.5)'; // tape
  ctx.fillRect(w / 2 - 6, 0, 12, 3);
}

function drawing(ctx, r, { sun, kid, house, hearts, scratched, mad, torn, color } = {}) {
  paper(ctx, r, 64, 48, torn);
  crayon(ctx, [[2, 40], [20, 39], [40, 41], [62, 40]], '#45b85a', r, 2);
  if (sun) {
    dot(ctx, 54, 9, 5, '#f5d03a');
    for (let a = 0; a < 8; a++) crayon(ctx, [[54 + Math.cos(a) * 7, 9 + Math.sin(a) * 7], [54 + Math.cos(a) * 10, 9 + Math.sin(a) * 10]], '#f5a020', r, 1);
  }
  if (house) {
    crayon(ctx, [[40, 38], [40, 22], [58, 22], [58, 38]], '#d8343c', r, 2);
    crayon(ctx, [[38, 23], [49, 12], [60, 23]], '#8a52d0', r, 2);
  }
  if (hearts) for (const [x, y] of [[50, 10], [58, 18], [44, 20]]) dot(ctx, x, y, 2, '#e8407a');
  crayonDog(ctx, 22, 28, 1, r, { color: color ?? '#e0a83a', mad });
  if (kid) stickKid(ctx, 50, 22, r);
  if (scratched) {
    ctx.strokeStyle = 'rgba(40,30,30,0.85)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(14 + i * 5, 6);
      ctx.lineTo(28 + i * 5, 40);
      ctx.stroke();
    }
  }
}

/** The 4 code drawings: framed, with a clear middle where Gameplay writes this run's digit. */
function drawingCode(ctx, r) {
  ctx.fillStyle = '#c0306a';
  ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = '#fbf7ee';
  ctx.fillRect(3, 3, 58, 42);
  grain(ctx, 64, 48, r, 5);
  const rainbow = ['#e83a3a', '#f5a020', '#f5d03a', '#45b85a', '#3a7be0', '#8a52d0'];
  rainbow.forEach((c, i) => crayon(ctx, [[6, 42 - i], [58, 42 - i]], c, r, 1));
  crayonDog(ctx, 15, 32, 0.6, r);
  dot(ctx, 54, 9, 3, '#f5d03a');
}

function woodSign(ctx, r, text, fg, bg, size = 11) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, r, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, h / 2, w, 1);
  pixelText(ctx, text, w / 2, h / 2 + 1, fg, size);
  ctx.fillStyle = '#c8c0b0';
  ctx.fillRect(2, 2, 2, 2);
  ctx.fillRect(w - 4, 2, 2, 2);
}

function kidSign(ctx, r, text, color) {
  paper(ctx, r, 48, 24);
  ctx.fillStyle = color;
  ctx.font = 'bold 10px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  [...text].forEach((ch, i) => ctx.fillText(ch, 6 + i * 7, 12 + (i % 2 ? 1 : -1)));
}

function danger(ctx, r) {
  ctx.fillStyle = '#f5d03a';
  ctx.fillRect(0, 0, 48, 28);
  ctx.fillStyle = '#202020';
  for (let x = -28; x < 48; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 28);
    ctx.lineTo(x + 4, 28);
    ctx.lineTo(x + 8, 22);
    ctx.lineTo(x + 4, 22);
    ctx.fill();
  }
  pixelText(ctx, 'DANGER', 24, 10, '#202020', 9);
  grain(ctx, 48, 28, r, 10);
}

function poster(ctx, r) {
  ctx.fillStyle = '#2a3a70';
  ctx.fillRect(0, 0, 32, 48);
  const rainbow = ['#e83a3a', '#f5a020', '#f5d03a', '#45b85a', '#3a7be0', '#8a52d0'];
  rainbow.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(16, 30, 13 - i * 2, Math.PI, 0);
    ctx.stroke();
  });
  pixelText(ctx, 'BE', 16, 38, '#ffffff', 8);
  pixelText(ctx, 'GOOD', 16, 44, '#ffffff', 7);
  grain(ctx, 32, 48, r, 8);
}

function abc(ctx, r) {
  const letters = 'ABCDEFG';
  const cols = ['#e83a3a', '#f5a020', '#f5d03a', '#45b85a', '#3a7be0', '#8a52d0', '#f07ab8'];
  [...letters].forEach((ch, i) => {
    ctx.fillStyle = cols[i];
    ctx.fillRect(i * 13 + 2, 2, 12, 16);
    pixelText(ctx, ch, i * 13 + 8, 11, '#ffffff', 10);
  });
  grain(ctx, 96, 20, r, 6);
}

function blobs(ctx, r, color, n, w, h) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.ellipse(w / 2 + r.range(-w / 4, w / 4), h / 2 + r.range(-h / 4, h / 4), r.range(3, w / 3), r.range(2, h / 3), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pawPrints(ctx, r) {
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 16 : 8;
    const y = 8 + i * 17;
    dot(ctx, x, y + 3, 3, 'rgba(50,35,25,0.75)');
    for (const [dx, dy] of [[-3, -2], [-1, -4], [1, -4], [3, -2]]) dot(ctx, x + dx, y + dy, 1, 'rgba(50,35,25,0.75)');
  }
}

function scratches(ctx, r) {
  ctx.strokeStyle = 'rgba(25,18,15,0.7)';
  for (let k = 0; k < 3; k++) {
    const x = r.range(4, 44);
    const y = r.range(2, 18);
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + i * 3, y);
      ctx.lineTo(x + i * 3 + r.range(4, 8), y + r.range(12, 20));
      ctx.stroke();
    }
  }
}

function windowPane(ctx, r, moon) {
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#1a2a5a');
  g.addColorStop(1, '#3a5a8a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#e8f0ff';
  for (let i = 0; i < 7; i++) ctx.fillRect(r.int(1, 30), r.int(1, 20), 1, 1);
  if (moon) {
    dot(ctx, 22, 9, 4, '#f4f0d8');
    dot(ctx, 24, 8, 3, '#1e3060');
  }
  ctx.fillStyle = '#15182a'; // tree silhouette at the bottom
  for (let x = 0; x < 32; x++) ctx.fillRect(x, 26 + Math.round(Math.sin(x * 0.7) * 2 + Math.sin(x * 1.9)), 1, 8);
  ctx.fillStyle = '#e8e0d0';
  ctx.fillRect(15, 0, 2, 32);
  ctx.fillRect(0, 15, 32, 2);
}

/** A window seen from outside: warm lamplight behind a curtain, the frame's cross in front. */
function windowLit(ctx, r) {
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#6a3a20');
  g.addColorStop(1, '#d89a50');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = 'rgba(120,40,60,0.75)'; // curtains
  ctx.fillRect(0, 0, 7, 32);
  ctx.fillRect(25, 0, 7, 32);
  grain(ctx, 32, 32, r, 10);
  ctx.fillStyle = '#e8e0d0';
  ctx.fillRect(15, 0, 2, 32);
  ctx.fillRect(0, 15, 32, 2);
}

function windowRound(ctx, r) {
  windowPane(ctx, r, true);
  const img = ctx.getImageData(0, 0, 32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) if ((x - 15.5) ** 2 + (y - 15.5) ** 2 > 15.5 ** 2) img.data[(y * 32 + x) * 4 + 3] = 0;
  ctx.putImageData(img, 0, 0);
}

function moonPatch(ctx) {
  // soft window-shaped light with the cross shadow of the frame
  const img = ctx.getImageData(0, 0, 32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const ex = Math.min(x, 31 - x) / 6;
      const ey = Math.min(y, 31 - y) / 6;
      let a = Math.min(1, ex) * Math.min(1, ey);
      if (Math.abs(x - 15.5) < 1.6 || Math.abs(y - 15.5) < 1.6) a *= 0.25;
      const i = (y * 32 + x) * 4;
      img.data[i] = 150;
      img.data[i + 1] = 180;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
}

function creakyPlank(ctx, r) {
  ctx.fillStyle = '#e0bf8a';
  ctx.fillRect(0, 0, 32, 8);
  grain(ctx, 32, 8, r, 14);
  ctx.fillStyle = 'rgba(90,60,30,0.6)';
  ctx.fillRect(0, 0, 32, 1);
  ctx.fillRect(0, 7, 32, 1);
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(2, 3, 1, 1);
  ctx.fillRect(29, 4, 1, 1);
}

function starSprite(ctx) {
  ctx.fillStyle = '#d8ff9a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? 3 : 7.5;
    ctx.lineTo(8 + Math.cos(a) * rr, 8 + Math.sin(a) * rr);
  }
  ctx.fill();
}

function slats(ctx) {
  ctx.clearRect(0, 0, 32, 32);
  for (let y = 0; y < 32; y += 5) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, 32, 3);
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, y + 2, 32, 1);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 3, 32);
  ctx.fillRect(29, 0, 3, 32);
}

// ---------------------------------------------------------------------------

/**
 * Build every texture once per World. Returns
 *   tiling(name) → THREE.Texture with .userData.size (m per repeat)
 *   atlas        → THREE.Texture holding every picture
 *   uv(name)     → {u0, v0, u1, v1} of a picture inside the atlas
 *   slats        → its own alpha-tested texture (hide-spot doors)
 *   staticFrames → canvas texture for the TV, 4 frames stacked vertically
 */
export function createTextures() {
  const made = [];
  const cache = new Map();
  function tiling(name) {
    if (cache.has(name)) return cache.get(name);
    const def = TILING[name] ?? TILING.plain;
    const [size, draw, px = 32] = def;
    const [c, ctx] = makeCanvas(px, px);
    draw(ctx, createRng(`tex:${name}`));
    const t = pixelTexture(c);
    t.userData.size = size;
    t.name = name;
    cache.set(name, t);
    made.push(t);
    return t;
  }

  // atlas: a simple shelf pack of 64x64 cells with 2 px gutters
  const cell = 68;
  const names = Object.keys(PICS);
  const cols = 8;
  const rows = Math.ceil(names.length / cols);
  const [ac, actx] = makeCanvas(cols * cell, rows * cell);
  const uvs = {};
  names.forEach((name, k) => {
    const [w, h, draw] = PICS[name];
    const [c, ctx] = makeCanvas(w, h);
    draw(ctx, createRng(`pic:${name}`));
    const x = (k % cols) * cell + 2;
    const y = Math.floor(k / cols) * cell + 2;
    const sw = Math.min(64, w);
    const sh = Math.min(64, h);
    actx.drawImage(c, 0, 0, w, h, x, y, sw, sh);
    // UV origin is bottom-left in three (flipY), so v counts up from the bottom
    uvs[name] = { u0: x / ac.width, u1: (x + sw) / ac.width, v0: 1 - (y + sh) / ac.height, v1: 1 - y / ac.height };
  });
  const atlas = pixelTexture(ac, { repeat: false });
  made.push(atlas);

  const [sc, sctx] = makeCanvas(32, 32);
  slats(sctx);
  const slatTex = pixelTexture(sc);
  made.push(slatTex);

  // TV static: 4 frames of noise and scanlines, cycled by offset (no re-uploads)
  const [tc, tctx] = makeCanvas(32, 96);
  const tr = createRng('tv');
  const img = tctx.createImageData(32, 96);
  for (let i = 0; i < 32 * 96; i++) {
    const y = Math.floor(i / 32);
    const v = tr.next() * (y % 2 ? 200 : 255);
    img.data[i * 4] = v * 0.85;
    img.data[i * 4 + 1] = v * 0.95;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const staticFrames = pixelTexture(tc);
  staticFrames.repeat.set(1, 0.25);
  made.push(staticFrames);

  return {
    tiling,
    atlas,
    uv: (name) => uvs[name] ?? uvs.drawing1,
    slats: slatTex,
    staticFrames,
    dispose() {
      for (const t of made) t.dispose();
    },
  };
}
