// Lighting: a dim hemisphere fill, fog, and a fixed pool of PointLights that
// hop to the lamps nearest the player every half second. The number of lights
// never changes, so no shader ever recompiles; lamps without a pool light
// still glow (their bulb meshes are unlit), they just don't light the room.

import * as THREE from 'three';

const POOL_SIZE = 6;
const REASSIGN_EVERY = 0.5; // s
const FADE_SPEED = 5; // per s: how fast a pool light dims before hopping to a new lamp
const CANDELA = 5; // lamp.intensity 1 → this many candela
const FOG_COLOR = 0x07060c;

/** Cheap deterministic hash → [0, 1). */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createLighting({ root, scene, world, tuning }) {
  const lamps = world.anchors.lamps;
  const floorsByY = world.floors.slice().sort((a, b) => a.y - b.y);
  const prevFog = scene.fog;
  const prevBg = scene.background;
  scene.fog = new THREE.Fog(FOG_COLOR, tuning.fogNear, tuning.fogFar);
  scene.background = new THREE.Color(FOG_COLOR);

  const hemi = new THREE.HemisphereLight(0x7a6aa8, 0x2a1e30, tuning.ambient * 1.6);
  root.add(hemi);

  // ---- bulbs: unlit meshes so every lamp reads as a light source ----
  const bulbGeo = new THREE.SphereGeometry(1, 8, 6);
  const glows = lamps.map((l, k) => {
    const mat = new THREE.MeshBasicMaterial({ color: l.color });
    const mesh = new THREE.Mesh(bulbGeo, mat);
    const r = { night: 0.035, clip: 0.04, bulb: 0.055, ceiling: 0.07, lantern: 0.08, chandelier: 0.06, none: 0.08 }[l.fixture] ?? 0.06;
    mesh.scale.setScalar(r);
    mesh.position.set(l.pos.x, l.pos.y, l.pos.z);
    if (l.fixture === 'night') mesh.scale.set(0.045, 0.045, 0.02);
    if (l.fixture === 'none' && l.id === 'lampBoiler') mesh.visible = false; // the boiler's fire window is its glow
    mesh.name = `bulb:${l.id}`;
    root.add(mesh);
    return { lamp: l, mesh, mat, seed: k * 13.7 + 1 };
  });
  // chandelier gets a little bulb under each of its shades
  for (const g of glows)
    if (g.lamp.fixture === 'chandelier')
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const m = new THREE.Mesh(bulbGeo, g.mat);
        m.scale.setScalar(0.035);
        m.position.set(g.lamp.pos.x + Math.cos(a) * 0.38, g.lamp.pos.y + 0.02, g.lamp.pos.z + Math.sin(a) * 0.38);
        root.add(m);
      }

  // ---- the pool ----
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 8, 1.1);
    light.name = `lampPool${i}`;
    root.add(light);
    pool.push({ light, lamp: null, next: null, fade: 0, leaving: false });
  }

  const floorAt = (y) => {
    let id = floorsByY[0].id;
    for (const f of floorsByY) if (f.y <= y + 0.9) id = f.id;
    return id;
  };

  function pick(playerPos) {
    const pf = floorAt(playerPos.y);
    const room = world.roomAt(playerPos, pf)?.id;
    const scored = [];
    for (const l of lamps) {
      let d = Math.hypot(l.pos.x - playerPos.x, l.pos.y - (playerPos.y + 1.1), l.pos.z - playerPos.z);
      // lights shine through floors, so only this floor's lamps get one
      if (l.floorId !== pf) continue;
      if (room && l.roomId !== room) d = d * 1.3 + 1;
      if (d < l.range * 2.5 + 6) scored.push({ l, d });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, POOL_SIZE).map((s) => s.l);
  }

  /** Keep lights already on wanted lamps; move the rest (fading out first) to uncovered ones. */
  function reassign(playerPos) {
    const wanted = new Set(pick(playerPos));
    for (const p of pool)
      if (p.lamp && wanted.has(p.lamp)) {
        wanted.delete(p.lamp);
        p.leaving = false;
        p.next = null;
      } else if (p.lamp) p.leaving = true;
    const uncovered = [...wanted];
    for (const p of pool) {
      if (!uncovered.length) break;
      if (!p.lamp) {
        p.lamp = uncovered.shift();
        p.fade = 0;
      } else if (p.leaving && !p.next) p.next = uncovered.shift();
    }
  }

  /** Flicker multiplier for a lamp at time t (1 = steady). */
  function flicker(seed, t) {
    const tick = Math.floor(t * 12 + seed * 7);
    const r = hash01(tick + seed);
    if (r < 0.05 * tuning.flickerRate) return 0.1 + hash01(tick * 3.1) * 0.25; // a stutter
    if (r < 0.09 * tuning.flickerRate) return 0.55;
    return 0.92 + Math.sin(t * 9 + seed) * 0.05 + Math.sin(t * 23 + seed * 2) * 0.03;
  }

  let timer = 0;
  let time = 0;
  const glowByLamp = new Map(glows.map((g) => [g.lamp, g]));
  const base = new THREE.Color();

  return {
    pool,
    update(dt, playerPos) {
      time += dt;
      timer -= dt;
      if (timer <= 0 && playerPos) {
        timer = REASSIGN_EVERY;
        reassign(playerPos);
      }
      // bulbs (flicker modulates their brightness too)
      for (const g of glows) {
        const f = g.lamp.flicker ? flicker(g.seed, time) : 1;
        g.flick = f;
        base.set(g.lamp.color).multiplyScalar(0.35 + 0.65 * f);
        g.mat.color.copy(base);
      }
      for (const p of pool) {
        if (p.leaving) {
          p.fade = Math.max(0, p.fade - FADE_SPEED * dt);
          if (p.fade === 0) {
            p.lamp = p.next;
            p.next = null;
            p.leaving = false;
          }
        } else if (p.lamp) p.fade = Math.min(1, p.fade + FADE_SPEED * dt);
        if (!p.lamp) {
          p.light.intensity = 0;
          continue;
        }
        const l = p.lamp;
        p.light.position.set(l.pos.x, l.pos.y - 0.12, l.pos.z);
        p.light.color.set(l.color);
        p.light.distance = l.range * 1.35;
        const f = glowByLamp.get(l)?.flick ?? 1;
        p.light.intensity = l.intensity * CANDELA * tuning.lampBoost * f * p.fade;
      }
    },
    debugInfo: () => pool.map((p) => (p.lamp ? `${p.lamp.id}${p.next ? '→' + p.next.id : ''} ${p.fade.toFixed(2)}` : '-')),
    dispose() {
      scene.fog = prevFog;
      scene.background = prevBg;
      bulbGeo.dispose();
      for (const g of glows) g.mat.dispose();
    },
  };
}
