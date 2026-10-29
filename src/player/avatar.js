// The co-op partner, drawn: a low-poly kid in the game's chunky pixel style,
// kid-sized (PLAYER_BODY), with walk and crouch poses, the held item in its
// right hand, and a working flashlight (a SpotLight plus a faint visible cone)
// that lights the house for the other player too.
//
// It only reads a Player (src/player/remote.js); the caller syncs it each frame.
// Hidden, down, or gone partners aren't drawn.

import * as THREE from 'three';
import { PLAYER_BODY } from '../core/contracts.js';
import { lerp } from '../core/math.js';
import { pixelTexture } from '../gameplay/textures.js';

const HIP = 0.55; // leg length; the torso sits on top
const CROUCH_DROP = PLAYER_BODY.height - PLAYER_BODY.crouchHeight;
const CONE_LENGTH = 3.2;

/** Shirt colors per role, so the two kids read apart. */
const SHIRTS = { host: ['#e8413c', '#f6d04d'], guest: ['#3b7ddd', '#9fe0ff'] };

function shirtTexture([base, stripe]) {
  return pixelTexture(16, 16, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = stripe;
    for (let y = 2; y < h; y += 5) ctx.fillRect(0, y, w, 2);
  });
}

function faceTexture() {
  return pixelTexture(16, 16, (ctx, w, h) => {
    ctx.fillStyle = '#f1c39b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(0, 0, w, 4); // fringe
    ctx.fillStyle = '#20141c';
    ctx.fillRect(4, 7, 2, 2); // eyes
    ctx.fillRect(10, 7, 2, 2);
    ctx.fillStyle = '#c4625a';
    ctx.fillRect(6, 12, 4, 1); // mouth
    ctx.fillStyle = '#eaa58a';
    ctx.fillRect(3, 10, 2, 1); // cheeks
    ctx.fillRect(11, 10, 2, 1);
  });
}

/**
 * @param {{scene: THREE.Scene, kit: Object, tuning: Object, role: 'host'|'guest'}} opts
 *   kit: Gameplay's model kit (models.js), for the held item; role: whose avatar this is (shirt color)
 */
export function createAvatar({ scene, kit, tuning, role = 'guest' }) {
  const owned = []; // geometries, materials and textures made here
  const own = (x) => (owned.push(x), x);
  const lambert = (opts) => own(new THREE.MeshLambertMaterial(opts));
  const boxGeo = (w, h, d) => own(new THREE.BoxGeometry(w, h, d));
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  const skin = lambert({ color: 0xf1c39b });
  const shirt = lambert({ map: own(shirtTexture(SHIRTS[role] ?? SHIRTS.guest)) });
  const jeans = lambert({ color: 0x34426b });
  const shoes = lambert({ color: 0xf2f2f2 });
  const hair = lambert({ color: 0x5a3a22 });
  const face = lambert({ map: own(faceTexture()) });

  const root = new THREE.Group();
  root.name = `avatar:${role}`;

  // Legs swing from the hips.
  const legs = [-0.08, 0.08].map((x) => {
    const leg = new THREE.Group();
    leg.position.set(x, HIP, 0);
    leg.add(mesh(boxGeo(0.12, HIP - 0.06, 0.13), jeans, 0, -(HIP - 0.06) / 2, 0));
    leg.add(mesh(boxGeo(0.13, 0.07, 0.19), shoes, 0, -HIP + 0.035, -0.03));
    root.add(leg);
    return leg;
  });

  // Everything above the hips moves together when crouching.
  const upper = new THREE.Group();
  upper.position.y = HIP;
  root.add(upper);
  upper.add(mesh(boxGeo(0.34, 0.4, 0.2), shirt, 0, 0.2, 0));

  const head = new THREE.Group();
  head.position.y = 0.43;
  upper.add(head);
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z. The face looks along -Z, like the camera.
  head.add(new THREE.Mesh(boxGeo(0.26, 0.26, 0.24), [skin, skin, hair, skin, hair, face]).translateY(0.13));
  head.add(mesh(boxGeo(0.28, 0.06, 0.26), hair, 0, 0.27, 0.01));

  const arms = [-0.22, 0.22].map((x) => {
    const arm = new THREE.Group();
    arm.position.set(x, 0.37, 0);
    arm.add(mesh(boxGeo(0.09, 0.34, 0.1), shirt, 0, -0.16, 0));
    arm.add(mesh(boxGeo(0.08, 0.07, 0.08), skin, 0, -0.36, 0));
    upper.add(arm);
    return arm;
  });
  const hand = new THREE.Group();
  hand.position.set(0, -0.38, -0.05);
  arms[1].add(hand);

  // The flashlight: always in the scene (adding or removing a light recompiles every shader),
  // switched by intensity like the local one.
  const fl = tuning.flashlight;
  const light = new THREE.SpotLight(0xfff2d0, 0, fl.distance, fl.angle, fl.penumbra, fl.decay);
  light.position.set(0.1, 0.12, -0.1);
  light.target.position.set(0.1, 0.12, -1.1);
  head.add(light, light.target);
  const coneGeo = own(new THREE.ConeGeometry(Math.tan(fl.angle) * CONE_LENGTH, CONE_LENGTH, 14, 1, true));
  coneGeo.translate(0, -CONE_LENGTH / 2, 0); // apex at the lamp
  coneGeo.rotateX(Math.PI / 2); // opening along -Z
  const coneMat = own(new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.copy(light.position);
  cone.raycast = () => {}; // never a look target
  head.add(cone);

  root.visible = false;
  scene.add(root);

  let shownItem = null;
  let walk = 0;
  let crouch = 0;

  function showItem(itemId) {
    if (itemId === shownItem) return;
    shownItem = itemId;
    hand.clear(); // the kit owns the item models' geometry and materials
    if (itemId) {
      const m = kit.item(itemId);
      m.rotation.x = -Math.PI / 2; // carried pointing forward
      hand.add(m);
    }
  }

  /** Follow a Player: call once per frame. `present` false hides it (no partner yet, or they left). */
  function update(dt, p, present = true) {
    const show = present && !p.hidden && !p.down;
    root.visible = show;
    light.intensity = show && p.flashlightOn ? fl.intensity : 0;
    cone.visible = show && p.flashlightOn;
    if (!show) return;
    root.position.set(p.pos.x, p.pos.y, p.pos.z);
    root.rotation.y = p.yaw;
    head.rotation.x = p.pitch * 0.7;
    crouch = lerp(crouch, p.crouched ? 1 : 0, Math.min(1, dt * 10));
    upper.position.y = HIP - CROUCH_DROP * crouch;
    upper.rotation.x = -0.35 * crouch;
    head.rotation.x += 0.35 * crouch; // keep looking where they look
    for (const leg of legs) leg.scale.y = 1 - 0.8 * crouch;
    // Walk cycle: legs and arms swing opposite while moving, settle when still.
    const speed = p.moving ? (p.sprinting ? 2.4 : p.crouched ? 1 : 1.6) : 0;
    walk += dt * speed * Math.PI * 2;
    const swing = p.moving && !p.onLink ? Math.sin(walk) * (p.sprinting ? 0.7 : 0.45) : 0;
    legs[0].rotation.x = lerp(legs[0].rotation.x, swing, Math.min(1, dt * 12));
    legs[1].rotation.x = lerp(legs[1].rotation.x, -swing, Math.min(1, dt * 12));
    arms[0].rotation.x = lerp(arms[0].rotation.x, -swing * 0.8, Math.min(1, dt * 12));
    // The right arm holds the item up in front when there is one.
    const hold = p.held ? -1.1 : swing * 0.8;
    arms[1].rotation.x = lerp(arms[1].rotation.x, hold, Math.min(1, dt * 12));
    showItem(p.held ?? null);
  }

  function dispose() {
    hand.clear();
    head.remove(light, light.target);
    light.dispose();
    scene.remove(root);
    for (const x of owned) x.dispose();
  }

  return { root, light, update, dispose };
}
