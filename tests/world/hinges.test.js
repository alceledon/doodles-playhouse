// Every hinged furniture part must open away from the furniture: side-hinged
// doors swing out the front (local -Z), lids lift up. Cabinet and wardrobe
// doors used to swing inward, through their own shelves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as props from '../../src/world/props.js';

/** Center of a moving part's first box, relative to its pivot, after rotating by angle about the hinge axis (Three.js rotation convention). */
function swungCenter(mv, angle) {
  const box = mv.parts.find((p) => p.s === 'box');
  const [x, y, z] = box.p;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return mv.motion.axis === 'x' ? { x, y: y * c - z * s, z: y * s + z * c } : { x: x * c + z * s, y, z: -x * s + z * c };
}

const factories = Object.entries(props).filter(([name, fn]) => typeof fn === 'function' && !['aabb', 'xform', 'placeProp'].includes(name));

test('furniture doors swing out the front and lids lift up', () => {
  let hinges = 0;
  for (const [name, make] of factories) {
    let prop;
    try {
      prop = make();
    } catch {
      continue; // helpers that need arguments
    }
    for (const mv of prop?.moving ?? []) {
      if (mv.motion?.type !== 'hinge') continue;
      hinges++;
      const open = swungCenter(mv, mv.motion.angle);
      if (mv.motion.axis === 'y') assert.ok(open.z < -0.05, `${name}: door swings inward (open center z=${open.z.toFixed(2)})`);
      else assert.ok(open.y > swungCenter(mv, 0).y, `${name}: lid swings down`);
    }
  }
  assert.ok(hinges >= 4, `expected the cabinet, wardrobe and chest hinges, found ${hinges}`);
});
