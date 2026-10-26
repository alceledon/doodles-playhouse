// Doodle's continuous sounds, following it around the house: the collar jingle
// (paced by its speed: the player's main warning), panting, snoring while it
// sleeps, sniffing while it tracks, chewing while stunned, and random distant
// barks while it patrols. One-shots from events (growl, yawn, yelp) also play
// through this emitter so they come from the dog.

import { DOODLE_STATES as S } from '../core/contracts.js';
import { clamp } from '../core/math.js';
import { jingleInterval, pantParams } from './curves.js';
import { AUDIO_TUNING as T } from './tuning.js';

const LOOKAHEAD = 0.12;

export function createDoodleVoice(engine) {
  const r = engine.rand;
  const between = ([a, b]) => a + (b - a) * r();
  const D = T.doodle;
  let em = null;
  let last = null; // {dist, floors} from the latest place()
  const next = { jingle: 0, idle: 0, pant: 0, snore: 0, sniff: 0, bark: 0, chew: 0 };

  const playAt = (id, time, opts = {}) => engine.play(id, { dest: em.input, time, ...opts });

  function update(dt, doodle) {
    if (!engine.ready()) return null;
    if (!em) em = engine.emitter(D);
    if (!doodle) {
      em.silence();
      last = null;
      return null;
    }
    const head = { x: doodle.pos.x, y: doodle.pos.y + D.headHeight, z: doodle.pos.z };
    last = em.place(head, doodle.floorId);
    const now = engine.now();
    const until = now + LOOKAHEAD;
    const st = doodle.state;
    const speed = doodle.speed ?? 0;
    const awake = st !== S.SLEEP && st !== S.CATCH;
    const catchUp = (key) => {
      if (next[key] < now) next[key] = now + 0.02;
    };

    // Collar jingle: one per stride; louder when it runs.
    const iv = jingleInterval(speed);
    if (iv < Infinity) {
      catchUp('jingle');
      const gain = D.jingle.gain * (0.6 + 0.4 * clamp(speed / D.pant.chaseSpeed, 0, 1));
      while (next.jingle < until) {
        playAt('jingle', next.jingle, { gain });
        next.jingle += iv * (0.85 + r() * 0.3);
      }
    } else if (awake && st !== S.STUNNED) {
      // Standing still, it still shakes its head now and then.
      if (next.idle === 0 || next.idle < now - 1) next.idle = now + between(D.jingle.idleEvery);
      if (next.idle < until) {
        playAt('jingle', next.idle, { gain: D.jingle.gain * 0.5 });
        next.idle = now + between(D.jingle.idleEvery);
      }
    }

    // Panting whenever it's up and not busy chewing.
    if (awake && st !== S.STUNNED) {
      const p = pantParams(speed, st === S.CHASE);
      catchUp('pant');
      while (next.pant < until) {
        playAt('pant', next.pant, { gain: p.gain });
        next.pant += p.interval * (0.9 + r() * 0.2);
      }
    }

    if (st === S.SLEEP) {
      catchUp('snore');
      while (next.snore < until) {
        playAt('snore', next.snore, { gain: D.snore.gain });
        next.snore += D.snore.interval * (0.9 + r() * 0.2);
      }
    }

    if (st === S.SNIFF || st === S.INVESTIGATE || st === S.SEARCH) {
      catchUp('sniff');
      while (next.sniff < until) {
        playAt('sniff', next.sniff, { gain: D.sniff.gain });
        next.sniff += between(D.sniff.every);
      }
    }

    if (st === S.STUNNED) {
      catchUp('chew');
      while (next.chew < until) {
        playAt('chew', next.chew, { gain: D.chew.gain });
        next.chew += between(D.chew.every);
      }
    }

    // Distant barks while it roams: never close, or they'd read as "it saw you".
    if (next.bark === 0) next.bark = now + between(D.bark.every);
    if (next.bark < now) {
      if ((st === S.PATROL || st === S.SEARCH) && last.dist > D.bark.minDistance) {
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) playAt('bark', now + 0.05 + k * (0.32 + r() * 0.15), { gain: D.bark.gain });
      }
      next.bark = now + between(D.bark.every);
    }
    return last;
  }

  return {
    update,
    /** Play a one-shot from Doodle's position (event sounds like the growl). */
    play(id, opts = {}) {
      if (!em || !last) return false;
      return engine.play(id, { ...opts, dest: em.input });
    },
    get last() {
      return last;
    },
    dispose() {
      em?.dispose();
      em = null;
    },
  };
}
