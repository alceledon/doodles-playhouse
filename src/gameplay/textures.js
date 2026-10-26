// Low-res pixel textures drawn on canvases (32–64 px, NearestFilter), in the
// game's chunky look. Cosmetic noise uses its own seeded rng so textures are
// the same every load and never touch the run's random stream.

import * as THREE from 'three';
import { createRng } from '../core/rng.js';

export function pixelTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, w, h, rng, colors, count) {
  for (let k = 0; k < count; k++) {
    ctx.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    ctx.fillRect(Math.floor(rng.next() * w), Math.floor(rng.next() * h), 1, 1);
  }
}

const cache = new Map();
/** One texture per key for the whole page (they're tiny and never change). */
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export const woodTexture = (light = false) =>
  cached(`wood${light}`, () =>
    pixelTexture(32, 32, (ctx, w, h) => {
      const rng = createRng(light ? 'plank' : 'wood');
      ctx.fillStyle = light ? '#b98a55' : '#8a5a32';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 3 + Math.floor(rng.next() * 3)) {
        ctx.fillStyle = light ? '#9c6f40' : '#6e4524';
        ctx.fillRect(0, y, w, 1);
        ctx.fillRect(Math.floor(rng.next() * w), y + 1, 4 + Math.floor(rng.next() * 6), 1);
      }
      speckle(ctx, w, h, rng, light ? ['#c99b66', '#a77a4a'] : ['#9a6a40', '#5e3a1e'], 60);
    }),
  );

export const metalTexture = () =>
  cached('metal', () =>
    pixelTexture(16, 16, (ctx, w, h) => {
      ctx.fillStyle = '#8f949c';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, createRng('metal'), ['#a9adb4', '#757a82', '#9a9fa6'], 70);
    }),
  );

export const brassTexture = () =>
  cached('brass', () =>
    pixelTexture(16, 16, (ctx, w, h) => {
      ctx.fillStyle = '#d4a93a';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, createRng('brass'), ['#f0cd62', '#a8801f', '#e2bb4a'], 70);
    }),
  );

export const tennisTexture = () =>
  cached('tennis', () =>
    pixelTexture(32, 16, (ctx, w, h) => {
      ctx.fillStyle = '#c9e83a';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, createRng('tennis'), ['#dcf35a', '#b0cf2a', '#e6f77a'], 120);
      ctx.fillStyle = '#f4f4ea';
      for (let x = 0; x < w; x++) ctx.fillRect(x, Math.round(h / 2 + Math.sin((x / w) * Math.PI * 4) * 4), 1, 1);
    }),
  );

export const batteryTexture = () =>
  cached('battery', () =>
    pixelTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#26272b';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, createRng('battery'), ['#303136', '#1d1e21'], 80);
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(0, 11, w, 9);
      ctx.fillStyle = '#26272b';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('12V', 9, 19);
      ctx.fillStyle = '#e03c31';
      ctx.fillRect(3, 3, 5, 1);
      ctx.fillRect(5, 1, 1, 5);
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(24, 3, 5, 1);
    }),
  );

export const treatBagTexture = () =>
  cached('treatBag', () =>
    pixelTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#c49a62';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, createRng('bag'), ['#b0844e', '#d4ad78'], 90);
      ctx.fillStyle = '#d6453a';
      ctx.fillRect(3, 9, 26, 14);
      ctx.fillStyle = '#fff6e6';
      // a bone
      ctx.fillRect(10, 15, 12, 3);
      ctx.fillRect(8, 13, 3, 3);
      ctx.fillRect(8, 17, 3, 3);
      ctx.fillRect(21, 13, 3, 3);
      ctx.fillRect(21, 17, 3, 3);
    }),
  );

export const fuzzTexture = (base, dots, key) =>
  cached(`fuzz${key}`, () =>
    pixelTexture(16, 16, (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, createRng(key), dots, 60);
    }),
  );

const BLOCK_COLORS = ['#e8413c', '#3b7ddd', '#f2c230', '#3fae49', '#f28c28', '#9b59d0'];
export const blockTexture = (k) =>
  cached(`block${k % 12}`, () =>
    pixelTexture(32, 32, (ctx, w, h) => {
      const color = BLOCK_COLORS[k % BLOCK_COLORS.length];
      ctx.fillStyle = '#f6efe0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = '#f6efe0';
      ctx.fillRect(5, 5, w - 10, h - 10);
      ctx.fillStyle = color;
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ABCDEFGHIJKL'[k % 12], w / 2, h / 2 + 1);
    }),
  );

/** A keypad dial window: the digit in black on white, framed in the dial's color. */
export function dialTexture(digit, css) {
  return cached(`dial${digit}${css}`, () =>
    pixelTexture(16, 24, (ctx, w, h) => {
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fbf7ec';
      ctx.fillRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = '#1b1b1f';
      ctx.font = 'bold 17px Arial, Helvetica, sans-serif'; // monospace zeros are slashed and read as Ø
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(digit), w / 2, h / 2 + 1);
    }),
  );
}

/**
 * A big wobbly crayon digit on a transparent background, for the drawings.
 * 6 and 9 get an underline so they read the same at any squint.
 */
export function crayonDigitTexture(digit, css, seed = 0) {
  return pixelTexture(48, 48, (ctx, w, h) => {
    const rng = createRng(`crayon${digit}${seed}`);
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 34px "Comic Sans MS", "Chalkboard SE", cursive, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css;
    ctx.strokeStyle = css;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.6;
    // Several jittered passes look like a crayon going over and over.
    for (let k = 0; k < 6; k++) {
      const x = w / 2 + rng.range(-1.6, 1.6);
      const y = h / 2 + 2 + rng.range(-1.6, 1.6);
      ctx.strokeText(String(digit), x, y);
      ctx.fillText(String(digit), x, y);
    }
    ctx.globalAlpha = 1;
    if (digit === 6 || digit === 9) ctx.fillRect(14, 42, 20, 3);
    // A scribbled circle around it.
    ctx.strokeStyle = css;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2.15; a += 0.25) {
      const r = 21 + rng.range(-1.5, 1.5);
      const x = w / 2 + Math.cos(a) * r;
      const y = h / 2 + Math.sin(a) * r * 0.95;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Waxy gaps: knock out random pixels.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    for (let k = 0; k < 260; k++) ctx.fillRect(Math.floor(rng.next() * w), Math.floor(rng.next() * h), 1, 1);
    ctx.globalCompositeOperation = 'source-over';
  });
}
