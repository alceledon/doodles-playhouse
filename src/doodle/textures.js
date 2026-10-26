// Doodle's pixel textures, drawn on small canvases (browser only).
// Cosmetic, so a fixed-seed LCG rather than the run rng.

import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function pixelTexture(c, repeat = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  return tex;
}

/** Curly golden fur: small light and dark "C" curls on a honey base. */
export function furTexture({ base = '#dcaa55', light = '#f7d488', dark = '#b38038', seed = 7, repeat = 2 } = {}) {
  const [c, g] = canvas(32, 32);
  const rnd = lcg(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 32, 32);
  const px = (x, y, color) => {
    g.fillStyle = color;
    g.fillRect(((x % 32) + 32) % 32, ((y % 32) + 32) % 32, 1, 1);
  };
  // A curl is a 3x3 ring with one gap, lit on top and shaded underneath.
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  for (let k = 0; k < 46; k++) {
    const x = Math.floor(rnd() * 32);
    const y = Math.floor(rnd() * 32);
    const gap = Math.floor(rnd() * 8);
    ring.forEach(([dx, dy], i) => {
      if (i === gap) return;
      px(x + dx, y + dy, dy < 0 ? light : dark);
    });
  }
  for (let k = 0; k < 24; k++) px(Math.floor(rnd() * 32), Math.floor(rnd() * 32), rnd() < 0.5 ? light : dark);
  return pixelTexture(c, repeat);
}

/** The collar tag: a gold bone-ish plate with "DOODLE" stamped on it. */
export function tagTexture() {
  const [c, g] = canvas(48, 20);
  g.fillStyle = '#7a4e12';
  g.fillRect(0, 0, 48, 20);
  g.fillStyle = '#f2c53d';
  g.fillRect(1, 1, 46, 18);
  g.fillStyle = '#ffe58a';
  g.fillRect(2, 2, 44, 3);
  g.fillStyle = '#5a1f12';
  g.font = 'bold 10px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DOODLE', 24, 11);
  return pixelTexture(c);
}

/** Collar: red leather with little studs. */
export function collarTexture() {
  const [c, g] = canvas(32, 4);
  g.fillStyle = '#b3202e';
  g.fillRect(0, 0, 32, 4);
  g.fillStyle = '#7d1420';
  g.fillRect(0, 3, 32, 1);
  g.fillStyle = '#e8d070';
  for (let x = 1; x < 32; x += 4) g.fillRect(x, 1, 1, 1);
  return pixelTexture(c);
}

/** Tennis ball fuzz with its white seam. */
export function ballTexture() {
  const [c, g] = canvas(16, 16);
  g.fillStyle = '#c9e046';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#eef8c0';
  for (let x = 0; x < 16; x++) g.fillRect(x, Math.round(8 + Math.sin((x / 16) * Math.PI * 2) * 4), 1, 1);
  return pixelTexture(c);
}

/** Soft round glow for the eyeshine sprites (deliberately not pixelated). */
export function glowTexture() {
  const [c, g] = canvas(32, 32);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
