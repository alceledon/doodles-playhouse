// UI and cutscene knobs. Times are seconds, distances meters.

export const UI_TUNING = Object.freeze({
  crayon: Object.freeze({
    passes: 9, // thin passes per stroke: more = denser wax
    gapChance: 0.03, // chance per step that the wax skips
    grain: 0.035, // paper-grain specks per pixel
  }),

  dayCard: Object.freeze({ fadeIn: 0.5, hold: 1.8, fadeOut: 0.45 }),
  toastSeconds: 2.8,
  screenFade: 0.25, // menus fading in/out

  hud: Object.freeze({
    staminaHideAt: 0.995, // the bar shows only while stamina is below this
    staminaLow: 0.25, // turns red below this
    vignette: true, // darken the edges when Doodle is near
    vignetteNear: 2.5, // full strength inside this distance (same floor)
    vignetteFar: 10, // nothing beyond this
    vignetteMax: 0.75,
    vignetteChase: 0.45, // at least this much during a chase
  }),

  cutscenes: Object.freeze({
    catch: Object.freeze({ fall: 0.45, pounce: 0.6, lick: 1.35, licks: 3, fade: 0.7, floorEye: 0.22, roll: 0.55, fov: 58, lean: -0.45, faceDistance: 0.5 }),
    gameOver: Object.freeze({ fall: 0.4, pounce: 0.5, drag: 3.2, dragDistance: 2.6, cut: 0.6, kennel: 2.4, text: 1.4, hold: 1.2 }),
    escape: Object.freeze({ walk: 4.2, fade: 1, walkEye: 1.1, jeepEye: 0.85, beyond: 7 }),
    wake: Object.freeze({ seconds: 1.9, liftFrom: 0.28, pitchFrom: 0.55 }),
    shake: 0.06, // meters of camera shake at the bark
  }),
});
