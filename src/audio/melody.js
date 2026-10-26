// The music-box lullaby: an original little waltz in A minor (3/4), 8 bars,
// looping. The raised 7th (G#) in bar 6 is what makes it sound uneasy.
// m = midi note, beats = length. Each bar starts with a soft bass note.

export const BEATS_PER_BAR = 3;

export const LULLABY = Object.freeze([
  // bar 1
  { m: 76, beats: 1 }, { m: 81, beats: 1 }, { m: 83, beats: 1 },
  // bar 2
  { m: 84, beats: 2 }, { m: 83, beats: 1 },
  // bar 3
  { m: 81, beats: 1 }, { m: 76, beats: 1 }, { m: 77, beats: 1 },
  // bar 4
  { m: 76, beats: 3 },
  // bar 5
  { m: 74, beats: 1 }, { m: 77, beats: 1 }, { m: 81, beats: 1 },
  // bar 6
  { m: 80, beats: 2 }, { m: 77, beats: 1 },
  // bar 7
  { m: 76, beats: 1 }, { m: 74, beats: 1 }, { m: 71, beats: 1 },
  // bar 8
  { m: 69, beats: 3 },
].map(Object.freeze));

/** One bass note per bar (A3, F3, A3, E3, D3, E3, E3, A3). */
export const LULLABY_BASS = Object.freeze([57, 53, 57, 52, 50, 52, 52, 57]);

/** Which bar each note starts, and whether it starts the bar. */
export function noteBars(notes = LULLABY, beatsPerBar = BEATS_PER_BAR) {
  let beat = 0;
  return notes.map((n) => {
    const bar = Math.floor(beat / beatsPerBar);
    const downbeat = beat % beatsPerBar === 0;
    beat += n.beats;
    return { bar, downbeat };
  });
}
