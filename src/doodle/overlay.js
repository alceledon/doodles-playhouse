// Debug overlay for the Doodle (browser only): its path, sight cone, hearing
// radius, recent noises, scent crumbs and pools, and a state label. Drawn on
// top of everything (no depth test) so you can follow it through walls.
// Reads doodle.debug, which the brain fills every frame.

import * as THREE from 'three';

const REF_LOUDNESS = 7; // a sprint step's NOISE.loudness: the ring shows how far it hears one
const MAX_PATH = 128;
const MAX_CRUMBS = 400;
const LIFT = 0.06;

const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, fog: false });

function circlePoints(n = 48) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return pts;
}

export function createDoodleOverlay(scene) {
  const root = new THREE.Group();
  root.name = 'doodleOverlay';
  root.renderOrder = 999;
  scene.add(root);
  const disposables = [];
  const track = (o) => (disposables.push(o), o);
  const ring = new THREE.BufferGeometry().setFromPoints(circlePoints());
  track(ring);

  const onTop = (o) => {
    o.renderOrder = 999;
    return o;
  };

  // Path
  const pathGeo = track(new THREE.BufferGeometry());
  pathGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PATH * 3), 3));
  const path = onTop(new THREE.Line(pathGeo, track(lineMat(0x40e0ff))));
  path.frustumCulled = false;
  const target = onTop(new THREE.Mesh(track(new THREE.OctahedronGeometry(0.12)), track(new THREE.MeshBasicMaterial({ color: 0x40e0ff, depthTest: false, fog: false }))));

  // Sight cone (a fan on the floor) + close-sense circle
  const fanMat = track(new THREE.MeshBasicMaterial({ color: 0xffe040, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false }));
  let fan = null;
  let fanFov = null;
  const closeRing = onTop(new THREE.LineLoop(ring, track(lineMat(0xffe040, 0.5))));
  const hearRing = onTop(new THREE.LineLoop(ring, track(lineMat(0x60ff80, 0.6))));

  // Noises, pools, crumbs
  const noiseRings = [];
  let lastNoiseT = null;
  const poolRings = [];
  const crumbGeo = track(new THREE.BufferGeometry());
  crumbGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CRUMBS * 3), 3));
  crumbGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_CRUMBS * 3), 3));
  const crumbs = onTop(new THREE.Points(crumbGeo, track(new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, fog: false }))));
  crumbs.frustumCulled = false;

  // State label
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 48;
  const labelTex = track(new THREE.CanvasTexture(labelCanvas));
  const label = onTop(new THREE.Sprite(track(new THREE.SpriteMaterial({ map: labelTex, depthTest: false, fog: false, transparent: true }))));
  label.scale.set(1.6, 0.3, 1);
  let labelText = '';

  root.add(path, target, closeRing, hearRing, crumbs, label);

  function setFan(fov) {
    if (fan && fanFov === fov) return;
    if (fan) {
      root.remove(fan);
      fan.geometry.dispose();
    }
    const n = 24;
    const pos = [0, 0, 0];
    for (let k = 0; k <= n; k++) {
      const a = -fov / 2 + (fov * k) / n;
      pos.push(-Math.sin(a), 0, -Math.cos(a));
    }
    const idx = [];
    for (let k = 1; k <= n; k++) idx.push(0, k, k + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    fan = onTop(new THREE.Mesh(geo, fanMat));
    fanFov = fov;
    root.add(fan);
  }

  function drawLabel(text, hunt) {
    if (text === labelText) return;
    labelText = text;
    const g = labelCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 48);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 4, 256, 40);
    g.fillStyle = hunt ? '#ff6050' : '#ffffff';
    g.font = 'bold 22px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 25);
    labelTex.needsUpdate = true;
  }

  function update(doodle, dt = 1 / 60) {
    const d = doodle.debug;
    const s = d.senses ?? {};
    const p = doodle.pos;

    // path
    const arr = pathGeo.attributes.position.array;
    const n = Math.min(MAX_PATH, d.path.length);
    for (let k = 0; k < n; k++) {
      arr[k * 3] = d.path[k].x;
      arr[k * 3 + 1] = d.path[k].y + LIFT;
      arr[k * 3 + 2] = d.path[k].z;
    }
    pathGeo.setDrawRange(0, n);
    pathGeo.attributes.position.needsUpdate = true;
    target.visible = !!d.target;
    if (d.target) target.position.set(d.target.x, d.target.y + 0.3, d.target.z);

    // sight + hearing around the Doodle
    setFan(s.fov ?? Math.PI * 0.6);
    const range = s.sightRange ?? 10;
    fan.position.set(p.x, p.y + LIFT, p.z);
    fan.rotation.y = doodle.yaw;
    fan.scale.set(range, 1, range);
    fanMat.color.setHex(s.sight?.visible ? 0xff4030 : 0xffe040);
    fanMat.opacity = doodle.state === 'sleep' || doodle.state === 'stunned' ? 0.05 : 0.18;
    const close = doodle.tuning?.closeSense ?? 1.2;
    closeRing.position.copy(fan.position);
    closeRing.scale.set(close, 1, close);
    const hear = REF_LOUDNESS * (s.hearing ?? 1);
    hearRing.position.copy(fan.position);
    hearRing.scale.set(hear, 1, hear);

    // noise rings: one per noise, fading over 2 s (green = heard, red = not)
    const noise = s.lastNoise;
    if (noise && noise.t !== lastNoiseT) {
      lastNoiseT = noise.t;
      const r = onTop(new THREE.LineLoop(ring, lineMat(noise.heard ? 0x60ff80 : 0xff5050)));
      r.position.set(noise.pos.x, noise.pos.y + LIFT, noise.pos.z);
      r.scale.set(Math.max(0.1, noise.radius), 1, Math.max(0.1, noise.radius));
      r.userData.life = 2;
      root.add(r);
      noiseRings.push(r);
    }
    for (let k = noiseRings.length - 1; k >= 0; k--) {
      const r = noiseRings[k];
      r.userData.life -= dt;
      r.material.opacity = Math.max(0, r.userData.life / 2);
      if (r.userData.life <= 0) {
        root.remove(r);
        r.material.dispose();
        noiseRings.splice(k, 1);
      }
    }

    // scent
    const list = s.crumbs ?? [];
    const now = s.clock ?? 0;
    const life = (doodle.tuning?.crumbLife ?? 45) * (doodle.tuning?.nose ?? 1);
    const cp = crumbGeo.attributes.position.array;
    const cc = crumbGeo.attributes.color.array;
    const m = Math.min(MAX_CRUMBS, list.length);
    for (let k = 0; k < m; k++) {
      const c = list[list.length - m + k];
      const fresh = Math.max(0, 1 - (now - c.t) / life);
      cp[k * 3] = c.pos.x;
      cp[k * 3 + 1] = c.pos.y + LIFT;
      cp[k * 3 + 2] = c.pos.z;
      cc[k * 3] = 0.3 + 0.7 * fresh;
      cc[k * 3 + 1] = 0.15 + 0.45 * fresh;
      cc[k * 3 + 2] = 0.1;
    }
    crumbGeo.setDrawRange(0, m);
    crumbGeo.attributes.position.needsUpdate = true;
    crumbGeo.attributes.color.needsUpdate = true;
    const pools = s.pools ?? [];
    while (poolRings.length < pools.length) {
      const r = onTop(new THREE.LineLoop(ring, track(lineMat(0xff9020, 0.7))));
      root.add(r);
      poolRings.push(r);
    }
    poolRings.forEach((r, k) => {
      const pool = pools[k];
      r.visible = !!pool && pool.radius > 0.05;
      if (!r.visible) return;
      r.position.set(pool.pos.x, pool.pos.y + LIFT, pool.pos.z);
      r.scale.set(pool.radius, 1, pool.radius);
      r.material.color.setHex(pool.hidden ? 0xff40ff : 0xff9020);
    });

    label.position.set(p.x, p.y + 2.1, p.z);
    drawLabel(`${doodle.state}${s.task ? ' · ' + s.task : ''}`, doodle.state === 'chase');
  }

  return {
    root,
    update,
    set visible(v) {
      root.visible = v;
    },
    get visible() {
      return root.visible;
    },
    dispose() {
      scene.remove(root);
      fan?.geometry.dispose();
      for (const r of noiseRings) r.material.dispose();
      for (const o of disposables) o.dispose();
    },
  };
}
