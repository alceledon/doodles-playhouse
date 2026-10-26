// The front door's color keypad. Pure logic: the per-run code, which crayon
// drawing shows which digit, and the four dials. Each dial has a color, and
// the digit drawn in that color is the one it needs, so the colors tell you
// the order.

export const CODE_LENGTH = 4;

/** Dial colors, left to right. Digit k of the code is drawn in DIAL_COLORS[k]. */
export const DIAL_COLORS = Object.freeze([
  Object.freeze({ name: 'red', hex: 0xe8413c, css: '#e8413c' }),
  Object.freeze({ name: 'blue', hex: 0x3b7ddd, css: '#3b7ddd' }),
  Object.freeze({ name: 'green', hex: 0x3fae49, css: '#3fae49' }),
  Object.freeze({ name: 'purple', hex: 0x9b59d0, css: '#9b59d0' }),
]);

export const isValidCode = (code) => typeof code === 'string' && /^\d{4}$/.test(code);

/** A 4-digit code string. Never 0000, because the dials start there. */
export function generateCode(rng) {
  const digits = Array.from({ length: CODE_LENGTH }, () => rng.int(0, 9));
  if (digits.every((d) => d === 0)) digits[CODE_LENGTH - 1] = rng.int(1, 9);
  return digits.join('');
}

export const checkCode = (code, entered) => isValidCode(entered) && entered === code;

/**
 * Shuffle which drawing shows which digit.
 * @returns {{spot: Object, position: number, digit: number, color: {name: string, hex: number, css: string}}[]}
 */
export function assignDigits(drawings, code, rng) {
  return rng.shuffle(drawings.slice(0, CODE_LENGTH)).map((spot, position) => ({
    spot,
    position,
    digit: Number(code[position]),
    color: DIAL_COLORS[position],
  }));
}

/** Four dials you roll one step at a time. They start at 0000. */
export function createKeypad(code) {
  const digits = new Array(CODE_LENGTH).fill(0);
  return {
    digits,
    /** Roll dial i by dir (+1 / -1), wrapping 9 → 0. Returns the new digit. */
    roll(i, dir = 1) {
      digits[i] = (((digits[i] + dir) % 10) + 10) % 10;
      return digits[i];
    },
    /** Set every dial from a string (debug, openAllLocks). */
    set(str) {
      for (let i = 0; i < CODE_LENGTH; i++) digits[i] = Number(str[i]) || 0;
    },
    entered: () => digits.join(''),
    matches: () => checkCode(code, digits.join('')),
  };
}
