/**
 * The contrast register, turned into the panel's palette.
 *
 * The register lives at 8060h and the ROM steps it with Atari and the up and
 * down arrows: read, add or subtract four, write back, stopping at FCh and at
 * zero. Sixty-four steps, 80h in the middle, which is where a cold start puts
 * it.
 *
 * WHAT THE STEPS LOOK LIKE is not measured and cannot be taken from the
 * documentation either - the technical reference gives the register one
 * sentence and no curve. The two ends, though, are not a matter of taste, and
 * they are what a real Portfolio settles: wound all the way down the panel goes
 * blank, with no trace of the characters left, and wound all the way up it
 * closes into one dark field with the dots no longer standing out of it. So the
 * lit end and the background end are made to meet at both extremes, and the
 * travel between them is spread evenly, one visible step per keypress, because
 * there is nothing to say it should bunch up anywhere in particular.
 */

// LCD colours taken from MAME's portfolio_palette. The case artwork in gfx/
// paints its glass in LCD_OFF, because the glass shows round the canvas -
// change one and repaint the other.
export const LCD_OFF = [142, 193, 172];
export const LCD_ON = [67, 71, 151];

// Steps between the two palette entries, for the panel-inertia model.
export const LCD_LEVELS = 256;

export const CONTRAST_DEFAULT = 0x80;
export const CONTRAST_MAX = 0xFC;

/**
 * Where the two ends of the ramp sit for a given register value, as a share of
 * the way from the background colour to the ink colour.
 *
 * Below the middle the lit end retreats towards the background until, at zero,
 * it is the background and nothing on the panel can be told apart. Above it the
 * background creeps towards the lit end until, at FCh, it has caught up and the
 * whole panel is one field of ink.
 */
export function contrastEnds(contrast) {
  const v = Math.max(0, Math.min(CONTRAST_MAX, contrast));
  if (v <= CONTRAST_DEFAULT) return { fog: 0, lit: v / CONTRAST_DEFAULT };
  return { fog: (v - CONTRAST_DEFAULT) / (CONTRAST_MAX - CONTRAST_DEFAULT), lit: 1 };
}

/**
 * Packs the whole off-to-on ramp into `out` as little-endian ABGR, which is
 * what ImageData wants. Called when the register moves and not per frame.
 */
export function buildRamp(contrast, out) {
  const { lit, fog } = contrastEnds(contrast);
  const top = out.length - 1;
  for (let i = 0; i < out.length; i++) {
    const t = fog + (lit - fog) * (i / top);
    const c = [0, 1, 2].map((ch) => Math.round(LCD_OFF[ch] + (LCD_ON[ch] - LCD_OFF[ch]) * t));
    out[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  return out;
}
