// Cutscenes: main.js keeps rendering while these move the camera, Doodle's
// model and DOM overlays on their own requestAnimationFrame loop, then resolve.
// Anything added to the scene is removed (and disposed) before resolving, and
// the camera and Doodle model are put back how they were found.
//
//   playCatch     knocked to the floor → Doodle pounces into frame and barks → licks → fade
//   playGameOver  knocked down → dragged off toward the kennel → "Doodle has a new chew toy."
//   playEscape    walk (or drive) out through the exit into the night
//   playWake      eyes opening from the bottom bunk

import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { clamp, lerp, yawTo } from '../core/math.js';
import { cue } from '../audio/cues.js';
import { crayonText } from './crayon.js';
import { el, tween } from './dom.js';
import { clearDirection, easeInOut, easeInQuad, easeOutBack, easeOutQuad, forward, freeDistance, lidOpenness, pathPoint, smoothstep } from './motion.js';
import { UI_TUNING } from './tuning.js';

const CS = UI_TUNING.cutscenes;

/** createCutscenes({ camera, getScene, ui, bus }) → Cutscenes */
export function createCutscenes({ camera, getScene, ui }) {
  const layer = ui?.layer ?? document.body;
  const g = createRng('cutscenes'); // cosmetic only (shake, slobber)
  const rnd = () => g.next();
  let queue = Promise.resolve();

  /** Cutscenes never overlap: each waits for the previous one. */
  const serial = (fn) => (ctx) => {
    const run = queue.then(() => fn(ctx ?? {}));
    queue = run.catch((err) => console.error('[ui] cutscene failed', err));
    return queue;
  };

  function overlay(cls) {
    const o = el('div', `dp-overlay ${cls}`);
    layer.append(o);
    return o;
  }

  // ---- camera and model bookkeeping ------------------------------------------

  function saveCamera() {
    return { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, order: camera.rotation.order };
  }
  function restoreCamera(s) {
    camera.position.copy(s.pos);
    camera.quaternion.copy(s.quat);
    camera.rotation.reorder(s.order);
    setFov(s.fov);
  }
  function setFov(fov) {
    if (camera.isPerspectiveCamera && Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
  function saveObject(o) {
    return { pos: o.position.clone(), quat: o.quaternion.clone(), order: o.rotation.order, scale: o.scale.clone(), visible: o.visible };
  }
  function restoreObject(o, s) {
    o.position.copy(s.pos);
    o.quaternion.copy(s.quat);
    o.rotation.reorder(s.order);
    o.scale.copy(s.scale);
    o.visible = s.visible;
  }

  /** Look from eye at target, then roll (radians) around the view axis. */
  function aim(eye, target, roll = 0) {
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(target.x, target.y, target.z);
    if (roll) camera.rotateZ(roll);
  }

  /**
   * Where Doodle's face is relative to its feet, in the model's own frame
   * (facing -Z): the front-top of its bounding box. Falls back to bounds().
   * The model's real shape is Doodle's business, so we measure rather than assume.
   */
  function faceOffset(doodle) {
    const o = doodle?.model?.object3d;
    if (o) {
      const s = saveObject(o);
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(o);
      restoreObject(o, s);
      o.updateMatrixWorld(true);
      if (!box.isEmpty() && box.min.z < -0.1 && box.max.y > 0.3)
        return { fwd: clamp(-box.min.z * 0.9, 0.3, 2), up: clamp(box.max.y - (box.max.y - box.min.y) * 0.18, 0.4, 2.5) };
    }
    const b = doodle?.bounds?.();
    const r = clamp(b?.radius ?? 0.8, 0.4, 1.4);
    const up = b ? b.center.y - doodle.pos.y + r * 0.45 : 1.15;
    return { up: clamp(up, 0.5, 2), fwd: r };
  }

  /** How far in front of its feet the face is when tipped forward by `lean` (negative = head down). */
  const faceReach = (face, lean) => face.fwd * Math.cos(lean) - face.up * Math.sin(lean);

  /** The face of a dog standing at `root` facing along `toCam`, tipped by `lean`. */
  const facePoint = (root, toCam, face, lean) => {
    const f = faceReach(face, lean);
    return { x: root.x + toCam.x * f, y: root.y + face.up * Math.cos(lean) + face.fwd * Math.sin(lean), z: root.z + toCam.z * f };
  };

  function placeModel(model, root, yaw, lean = 0) {
    const o = model.object3d;
    o.position.set(root.x, root.y, root.z);
    o.rotation.set(lean, yaw, 0, 'YXZ'); // negative lean tips the head down, toward the camera
  }

  const shakeOffset = (amp) => ({ x: (rnd() - 0.5) * 2 * amp, y: (rnd() - 0.5) * 2 * amp, z: (rnd() - 0.5) * 2 * amp });
  const offset = (p, d) => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
  const along = (p, dir, d) => ({ x: p.x + dir.x * d, y: p.y, z: p.z + dir.z * d });

  /** Translucent slobber on the "lens", with drips that slide down. */
  function createSlobber() {
    const c = el('canvas', 'dp-overlay');
    c.width = Math.ceil(innerWidth * 0.5);
    c.height = Math.ceil(innerHeight * 0.5);
    c.style.width = '100%';
    c.style.height = '100%';
    layer.append(c);
    const ctx = c.getContext('2d');
    const blobs = [];
    let last = performance.now();
    let raf = requestAnimationFrame(loop);
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    }
    function draw(dt) {
      const H = c.height;
      ctx.clearRect(0, 0, c.width, H);
      for (const b of blobs) {
        // Drips: a thin tapering trail with a fat drop on the end.
        ctx.fillStyle = `rgba(222, 236, 246, ${b.a * 0.32})`;
        for (const d of b.drips) {
          d.len += d.speed * dt * Math.max(0.05, 1 - d.len / (H * 0.6)); // drips slow as they stretch
          const x = b.x + d.dx * b.r * 0.6;
          const y0 = b.y + b.r * 0.35;
          const y1 = y0 + d.len;
          const w = b.r * d.w;
          ctx.beginPath();
          ctx.moveTo(x - w, y0);
          ctx.quadraticCurveTo(x - w * 0.25, (y0 + y1) / 2, x - w * 0.35, y1);
          ctx.lineTo(x + w * 0.35, y1);
          ctx.quadraticCurveTo(x + w * 0.25, (y0 + y1) / 2, x + w, y0);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(x, y1 + w * 0.4, w * 0.7, w * 0.9, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // The smear: a few overlapping soft lumps.
        for (const p of b.parts) {
          const x = b.x + p.dx * b.r;
          const y = b.y + p.dy * b.r;
          const r = p.r * b.r;
          const gr = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
          gr.addColorStop(0, `rgba(236, 246, 255, ${b.a * 0.2})`);
          gr.addColorStop(0.75, `rgba(205, 225, 240, ${b.a * 0.13})`);
          gr.addColorStop(1, 'rgba(200, 220, 235, 0)');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        // Wet glints.
        ctx.fillStyle = `rgba(255, 255, 255, ${b.a * 0.55})`;
        for (const p of b.parts) {
          ctx.beginPath();
          ctx.ellipse(b.x + (p.dx - p.r * 0.35) * b.r, b.y + (p.dy - p.r * 0.4) * b.r, p.r * b.r * 0.16, p.r * b.r * 0.07, -0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    return {
      splat(n = 3 + Math.floor(rnd() * 3)) {
        const W = c.width;
        const H = c.height;
        for (let k = 0; k < n; k++) {
          blobs.push({
            x: W * (0.15 + rnd() * 0.7),
            y: H * (0.1 + rnd() * 0.6),
            r: Math.min(W, H) * (0.05 + rnd() * 0.12),
            a: 0.6 + rnd() * 0.4,
            parts: Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => ({ dx: (rnd() - 0.5) * 1.1, dy: (rnd() - 0.5) * 0.7, r: 0.45 + rnd() * 0.5 })),
            drips: Array.from({ length: Math.floor(rnd() * 3) }, () => ({ dx: (rnd() - 0.5) * 1.2, len: 0, speed: H * (0.03 + rnd() * 0.08), w: 0.06 + rnd() * 0.08 })),
          });
        }
      },
      remove() {
        cancelAnimationFrame(raf);
        c.remove();
      },
    };
  }

  async function fadeTo(o, seconds, from = 0, to = 1) {
    await tween(seconds, (t) => (o.style.opacity = String(lerp(from, to, t))));
  }

  // ---- shared opening: knocked down, then Doodle pounces into frame --------------

  /**
   * Knock the camera to the floor facing Doodle, then pounce Doodle in so its
   * face fills the screen. Returns the framing the later phases continue from.
   */
  async function knockdownAndPounce({ player, doodle, world }, T, saved, flash, { bark = true } = {}) {
    const model = doodle?.model ?? null;
    const floorY = player?.pos?.y ?? saved.pos.y - 1.1;
    const floorId = player?.floorId ?? doodle?.floorId;
    const eye0 = { x: saved.pos.x, y: saved.pos.y, z: saved.pos.z };
    const camYaw = new THREE.Euler().setFromQuaternion(saved.quat, 'YXZ').y;
    const dogFeet = doodle ? { ...doodle.pos } : along(eye0, forward(camYaw), 1);
    const toDog = Math.hypot(dogFeet.x - eye0.x, dogFeet.z - eye0.z) > 0.05 ? yawTo(eye0, dogFeet) : camYaw;
    const ahead = forward(toDog);
    const back = forward(toDog + Math.PI);
    const body = { radius: 0.2, yMin: floorY + 0.05, yMax: floorY + 0.4 };
    const knock = freeDistance(world, floorId, { x: eye0.x, y: floorY, z: eye0.z }, back, 0.4, body);
    const land = { x: eye0.x + back.x * knock, y: floorY + CS.catch.floorEye, z: eye0.z + back.z * knock };
    const face = faceOffset(doodle);
    const lean = CS.catch.lean;
    const room = freeDistance(world, floorId, { x: land.x, y: floorY, z: land.z }, ahead, 2.6, { radius: 0.35, yMin: floorY + 0.1, yMax: floorY + 1 });
    const nearFace = CS.catch.faceDistance;
    const farFace = Math.max(nearFace + 0.4, Math.min(1.6, room - faceReach(face, 0)));
    /** The dog's feet when its face is `faceDist` from the lens, tipped by `l`. */
    const rootFor = (faceDist, l) => along({ x: land.x, y: floorY, z: land.z }, ahead, faceDist + faceReach(face, l));
    const faceAt = (root, l) => facePoint(root, back, face, l);
    const dogYaw = toDog + Math.PI; // facing the camera

    if (model) {
      model.setMood?.('hunt');
      model.setPose?.('run');
      placeModel(model, rootFor(farFace, 0), dogYaw);
    }

    // 1. Knocked to the floor, the view swinging round to the dog.
    const qFrom = saved.quat.clone();
    aim(land, faceAt(rootFor(farFace, 0), 0), T.roll ?? CS.catch.roll);
    const qTo = camera.quaternion.clone();
    await tween(T.fall, (t) => {
      const k = easeInQuad(t);
      const s = easeOutQuad(t);
      camera.position.set(lerp(eye0.x, land.x, s), lerp(eye0.y, land.y, k), lerp(eye0.z, land.z, s));
      camera.quaternion.slerpQuaternions(qFrom, qTo, easeInOut(t));
    });
    cue('thud');
    flash.style.opacity = '0.35';

    // 2. The pounce: in fast, overshooting, head tipping down at you.
    model?.setPose?.('pounce');
    let barked = !bark;
    let shake = CS.shake * 0.6;
    const fov0 = saved.fov;
    await tween(T.pounce, (t, dt) => {
      flash.style.opacity = String(Math.max(0, 0.35 * (1 - t * 3)));
      const l = lean * Math.min(1, t * 1.6);
      const root = rootFor(lerp(farFace, nearFace, easeOutBack(t, 1.3)), l);
      if (model) placeModel(model, root, dogYaw, l);
      if (!barked && t > 0.5) {
        barked = true;
        cue('bark', { gain: 1.3, pitch: 0.66, drive: 5, long: 1.6 });
        shake = CS.shake;
      }
      shake = Math.max(0, shake - dt * CS.shake * 1.5);
      setFov(lerp(fov0, CS.catch.fov, easeOutQuad(t)));
      aim(offset(land, shakeOffset(shake)), faceAt(root, l), (T.roll ?? CS.catch.roll) + (rnd() - 0.5) * shake);
    });
    return { model, floorY, floorId, land, nearFace, lean, rootFor, faceAt, dogYaw, toDog, face };
  }

  // ---- playCatch -------------------------------------------------------------------

  async function playCatch(ctx) {
    const T = CS.catch;
    const saved = saveCamera();
    const model = ctx.doodle?.model ?? null;
    const savedModel = model ? saveObject(model.object3d) : null;
    const flash = overlay('dp-flash');
    const black = overlay('dp-black');
    const slobber = createSlobber();
    try {
      const f = await knockdownAndPounce(ctx, T, saved, flash);

      // 3. Licks: each one pushes in, jolts the view and leaves slobber.
      model?.setPose?.('lick');
      let licked = 0;
      let jolt = 0;
      await tween(T.lick, (t, dt) => {
        const phase = t * T.licks;
        if (Math.floor(phase) >= licked && licked < T.licks) {
          licked++;
          cue('lick', { gain: 1 - licked * 0.1 });
          slobber.splat();
          jolt = 1;
        }
        jolt = Math.max(0, jolt - dt * 4);
        const push = Math.sin((phase % 1) * Math.PI) * 0.14;
        const root = f.rootFor(f.nearFace - push, f.lean);
        if (model) placeModel(model, root, f.dogYaw, f.lean);
        aim(offset(f.land, { x: 0, y: jolt * 0.03, z: 0 }), f.faceAt(root, f.lean), T.roll + jolt * 0.12);
      });

      // 4. Fade to black (the day card takes over, already black).
      await fadeTo(black, T.fade);
    } finally {
      slobber.remove();
      flash.remove();
      black.remove();
      if (model) {
        restoreObject(model.object3d, savedModel);
        model.setPose?.('idle');
        model.setMood?.('calm');
      }
      restoreCamera(saved);
    }
  }

  // ---- playGameOver ----------------------------------------------------------------

  async function playGameOver(ctx) {
    const T = CS.gameOver;
    const { world, doodle } = ctx;
    const saved = saveCamera();
    const model = doodle?.model ?? null;
    const savedModel = model ? saveObject(model.object3d) : null;
    const flash = overlay('dp-flash');
    const black = overlay('dp-black');
    const scene = getScene?.();
    const temp = [];
    try {
      const f = await knockdownAndPounce(ctx, { ...T, roll: 0.45 }, saved, flash, { bark: true });

      // 3. Dragged off toward the kennel, tug by tug. Doodle walks backward, facing you.
      model?.setPose?.('drag');
      cue('growl', { duration: T.drag + 0.6, gain: 0.8 });
      const kennel = world?.anchors?.kennel;
      const prefer = kennel && kennel.floorId === f.floorId ? yawTo(f.land, kennel.pos) : f.toDog;
      const dragLean = f.lean * 0.6;
      const reach = f.nearFace + faceReach(f.face, dragLean);
      const dir = clearDirection(world, f.floorId, { x: f.land.x, y: f.floorY, z: f.land.z }, prefer, T.dragDistance + reach + 0.6, {
        radius: 0.35,
        yMin: f.floorY + 0.1,
        yMax: f.floorY + 1,
      });
      const dist = clamp(dir.free - reach - 0.6, 0.6, T.dragDistance);
      const tugs = Math.max(3, Math.round(T.drag * 1.5));
      let lastTug = -1;
      await tween(T.drag, (t) => {
        const swing = smoothstep(0, 0.15, t); // turn from where it pounced to the drag direction
        const yaw = f.toDog + Math.atan2(Math.sin(dir.yaw - f.toDog), Math.cos(dir.yaw - f.toDog)) * swing;
        const s = t * tugs;
        const tug = Math.floor(s);
        if (tug !== lastTug && tug < tugs) {
          lastTug = tug;
          cue('rustle', { gain: 1.2 });
        }
        const pulled = ((tug + smoothstep(0, 0.4, s - tug)) / tugs) * dist;
        const jerk = Math.sin(Math.min(1, (s - tug) / 0.4) * Math.PI);
        const eye = along({ ...f.land }, forward(dir.yaw), pulled * swing);
        eye.y = f.land.y + jerk * 0.04;
        const l = dragLean - jerk * 0.1;
        const root = along({ x: eye.x, y: f.floorY, z: eye.z }, forward(yaw), reach + 0.1);
        if (model) placeModel(model, root, yaw + Math.PI, l);
        aim(eye, facePoint(root, forward(yaw + Math.PI), f.face, l), 0.45 + Math.sin(s * Math.PI) * 0.12);
      });

      // 4. Cut to black, then a last look: Doodle in its kennel with its new toy.
      await fadeTo(black, T.cut);
      if (kennel && model && scene) {
        const k = kennel.pos;
        const reach = faceReach(f.face, 0);
        const want = reach + 1.3; // the face about 1.3 m from the lens
        const side = clearDirection(world, kennel.floorId, k, f.toDog, want + 0.3, { radius: 0.25, yMin: k.y + 0.1, yMax: k.y + 0.8 });
        const dist = clamp(side.free - 0.3, reach + 0.6, want);
        const toCam = forward(side.yaw);
        const camAt = (d) => along({ x: k.x, y: k.y + 0.5, z: k.z }, toCam, d);
        const faceP = { ...facePoint(k, toCam, f.face, 0), y: k.y + f.face.up * 0.75 }; // lying down, chewing
        placeModel(model, k, side.yaw, 0);
        model.setPose?.('chew');
        model.setMood?.('calm');
        const lamp = new THREE.PointLight(0xffb070, 6, 5, 2);
        const lampAt = camAt(dist * 0.5);
        lamp.position.set(lampAt.x, k.y + 1.6, lampAt.z);
        scene.add(lamp);
        temp.push(lamp);
        setFov(saved.fov);
        let chews = 0;
        const fadeIn = tween(0.5, (t) => (black.style.opacity = String(1 - t)));
        await tween(T.kennel, (t) => {
          if (t * 4 > chews) {
            chews++;
            cue('chew', { gain: 0.9 });
          }
          aim(camAt(lerp(dist, dist * 0.85, easeInOut(t))), faceP, 0.08);
        });
        await fadeIn;
        await fadeTo(black, 0.6);
      }

      // 5. The line, in crayon.
      const line = overlay('dp-endline');
      line.style.opacity = '1';
      const text = crayonText('DOODLE HAS A\nNEW CHEW TOY.', { size: 70, seed: 'chew-toy', colors: ['#ff5d73', '#ffb84d', '#d99a2b'], rotate: 0.1 }).canvas;
      text.style.opacity = '0';
      line.append(text);
      await tween(T.text, (t) => (text.style.opacity = String(t)));
      await tween(T.hold, () => {});
      line.remove();
    } finally {
      for (const o of temp) {
        o.parent?.remove(o);
        o.dispose?.();
      }
      flash.remove();
      black.remove();
      if (model) {
        restoreObject(model.object3d, savedModel);
        model.setPose?.('idle');
        model.setMood?.('calm');
      }
      restoreCamera(saved);
    }
  }

  // ---- playEscape ------------------------------------------------------------------

  /** Stars, a moon, a dark lawn and moonlight, around the exit. Returns the group. */
  function buildNight(center, dirOut, floorY) {
    const group = new THREE.Group();
    group.name = 'escapeNight';
    const starPos = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      const a = rnd() * Math.PI * 2;
      const h = 0.08 + rnd() * 0.9; // above the horizon
      const r = 70;
      starPos[i * 3] = center.x + Math.cos(a) * Math.cos(h) * r;
      starPos[i * 3 + 1] = floorY + Math.sin(h) * r;
      starPos[i * 3 + 2] = center.z + Math.sin(a) * Math.cos(h) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff6e0, size: 2, sizeAttenuation: false, fog: false })));
    const moonAt = { x: center.x + dirOut.x * 55, y: floorY + 24, z: center.z + dirOut.z * 55 };
    const moon = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c8, fog: false }));
    moon.position.set(moonAt.x, moonAt.y, moonAt.z);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff1c8, fog: false, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    halo.position.copy(moon.position);
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshLambertMaterial({ color: 0x1b2f22 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(center.x + dirOut.x * 30, floorY - 0.02, center.z + dirOut.z * 30);
    const moonlight = new THREE.HemisphereLight(0x5d74b8, 0x0b0d10, 0);
    group.add(moon, halo, lawn, moonlight);
    return { group, moonlight, moonAt };
  }

  async function playEscape({ route, world } = {}) {
    const T = CS.escape;
    const scene = getScene?.();
    const spec = route === 'garage' ? world?.anchors?.garage : world?.anchors?.frontDoor;
    const exit = spec?.exit?.pos;
    const door = world?.doors?.find((d) => d.id === spec?.doorId);
    const saved = saveCamera();
    const black = overlay('dp-black');
    let night = null;
    let lights = null;
    try {
      if (!exit || !scene) {
        await fadeTo(black, T.fade);
        return;
      }
      const driving = route === 'garage';
      const eyeH = driving ? T.jeepEye : T.walkEye;
      const start = { x: saved.pos.x, y: saved.pos.y, z: saved.pos.z };
      const out = { x: exit.x, y: exit.y + eyeH, z: exit.z };
      const pts = [start];
      if (door) {
        const dp = { x: door.pos.x, y: door.pos.y + eyeH, z: door.pos.z };
        const ahead = (dp.x - start.x) * (out.x - start.x) + (dp.z - start.z) * (out.z - start.z) > 0;
        if (ahead && Math.hypot(dp.x - start.x, dp.z - start.z) > 0.4) pts.push(dp);
      }
      pts.push(out);
      const from = pts[pts.length - 2];
      const len = Math.hypot(out.x - from.x, out.z - from.z) || 1;
      const dirOut = { x: (out.x - from.x) / len, y: 0, z: (out.z - from.z) / len };
      pts.push({ x: out.x + dirOut.x * T.beyond, y: out.y, z: out.z + dirOut.z * T.beyond });

      night = buildNight(out, dirOut, exit.y);
      scene.add(night.group);
      if (driving) {
        lights = new THREE.SpotLight(0xfff0c0, 40, 20, 0.5, 0.6, 1); // three r186 lights are in physical units
        lights.position.set(0, -0.3, 0);
        lights.target.position.set(0, -0.6, -4);
        camera.add(lights, lights.target);
        cue('jeepEngine', { drive: true, duration: T.walk + T.fade + 0.3 });
      }
      cue('crickets', { duration: T.walk + T.fade + 2, delay: T.walk * 0.3 });

      const total = T.walk + T.fade;
      await tween(total, (t, dt, elapsed) => {
        const k = easeInOut(Math.min(1, t * 1.05));
        const p = pathPoint(pts, k);
        const look = pathPoint(pts, Math.min(1, k + 0.1));
        const bob = driving ? Math.sin(elapsed * 13) * 0.01 + Math.sin(elapsed * 3.1) * 0.015 : Math.abs(Math.sin(elapsed * 4.5)) * 0.035;
        const sky = smoothstep(0.55, 1, t) * 3; // tip the head up at the open sky
        camera.position.set(p.x, p.y + bob, p.z);
        camera.lookAt(look.x + dirOut.x * 2, look.y + sky, look.z + dirOut.z * 2);
        night.moonlight.intensity = 1.1 * smoothstep(0.2, 0.6, t);
        black.style.opacity = String(smoothstep(T.walk / total, 1, t));
      });
    } finally {
      if (lights) camera.remove(lights, lights.target);
      if (night) {
        scene?.remove(night.group);
        night.group.traverse((o) => {
          o.geometry?.dispose?.();
          o.material?.dispose?.();
        });
      }
      black.remove();
      restoreCamera(saved);
    }
  }

  // ---- playWake --------------------------------------------------------------------

  async function playWake({ day = 1 } = {}) {
    const T = CS.wake;
    const saved = saveCamera();
    const base = new THREE.Euler().setFromQuaternion(saved.quat, 'YXZ');
    const top = el('div', 'dp-lid dp-top');
    const bottom = el('div', 'dp-lid dp-bottom');
    layer.append(top, bottom);
    const blur = overlay('dp-blur');
    if (day > 1) cue('gasp', { delay: 0.3 });
    try {
      await tween(T.seconds, (t) => {
        const o = lidOpenness(t);
        top.style.transform = `translateY(${(-o * 102).toFixed(2)}%)`;
        bottom.style.transform = `translateY(${(o * 102).toFixed(2)}%)`;
        const b = 8 * (1 - smoothstep(0.35, 0.95, t));
        blur.style.backdropFilter = blur.style.webkitBackdropFilter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : 'none';
        // Lying back on the pillow, looking up at the top bunk, then sitting up.
        const k = 1 - easeInOut(smoothstep(0.3, 1, t));
        camera.position.set(saved.pos.x, saved.pos.y - T.liftFrom * k, saved.pos.z);
        camera.rotation.set(base.x + T.pitchFrom * k, base.y, base.z + 0.1 * k, 'YXZ');
      });
    } finally {
      top.remove();
      bottom.remove();
      blur.remove();
      restoreCamera(saved);
    }
  }

  return {
    playCatch: serial(playCatch),
    playGameOver: serial(playGameOver),
    playEscape: serial(playEscape),
    playWake: serial(playWake),
  };
}
