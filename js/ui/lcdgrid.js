// The dot grid on the LCD panel, and the painter that draws through it.
//
// A Portfolio pixel is not a square of ink butted up against its neighbours: it
// is an electrode with an unpowered margin all round it, and on the glass that
// margin reads as a fine lattice laid over the picture. Drawing it costs the
// emulator the one convenience it had - that an emulated pixel was a whole
// number of screen pixels of a single colour. A dot now covers only part of its
// cell, and the cell need not be a whole number of device pixels wide either:
// a display at 125% puts two and a half of them under every dot.
//
// So the panel is resampled rather than blitted. This module works out, for
// every device pixel, how much of it the dot actually covers, and then shades
// it by that much - so a dot edge falling halfway across a device pixel comes
// out half dark, which is what the eye sees on the glass, and what stops the
// lattice from beating against the pixel grid at fractional zoom. The weights
// depend on geometry alone and never on what is being displayed, so they are
// built once per change of scale and then used frame after frame.
//
// The painter lives here rather than beside the canvas because the geometry is
// no use without it and neither is testable apart from the other: a weight
// table nobody has drawn through proves very little.

// An output pixel lying exactly on a cell boundary belongs to the cell it
// starts in, not the one it ends against; without this the last pixel of a row
// picks up a dot that is not there.
const EDGE = 1e-9;

/** How much of the span lo..hi the dot in cell `c` covers. */
function coverage(c, lo, hi, cell, half) {
  const dotLo = c * cell + half;
  const dotHi = (c + 1) * cell - half;
  return Math.max(0, Math.min(hi, dotHi) - Math.max(lo, dotLo));
}

/**
 * Coverage weights along one axis.
 *
 * `cell` is the pitch in device pixels - dot plus gap - and `gapFrac` the share
 * of it the gap takes; 0 leaves the dots touching, which is how the panel
 * looked before there was a grid at all. Returned are, for every output pixel,
 * two source dots and how much of the pixel each of them covers; what the two
 * do not cover is panel background showing through the gap.
 *
 * Two contributions are always enough, because a pixel one device pixel wide
 * can straddle two dots only while a cell is at least that wide. Below that -
 * a browser zoomed far out - a dot no longer fills even one device pixel and
 * there is nothing left to resample honestly, so the weights fall back to
 * picking the nearest dot and the grid quietly disappears.
 */
export function axisWeights(n, cell, gapFrac) {
  const out = Math.max(1, Math.round(n * cell));
  const a = new Int32Array(out);
  const wa = new Float32Array(out);
  const b = new Int32Array(out);
  const wb = new Float32Array(out);
  const last = n - 1;

  if (cell < 1) {
    for (let i = 0; i < out; i++) {
      const c = Math.max(0, Math.min(last, Math.floor((i + 0.5) / cell)));
      a[i] = c;
      b[i] = c;
      wa[i] = 1;
    }
    return { out, a, wa, b, wb };
  }

  const half = (cell * gapFrac) / 2;

  for (let i = 0; i < out; i++) {
    const lo = i, hi = i + 1;
    const c0 = Math.max(0, Math.min(last, Math.floor(lo / cell)));
    const c1 = Math.max(0, Math.min(last, Math.floor((hi - EDGE) / cell)));

    a[i] = c0;
    wa[i] = coverage(c0, lo, hi, cell, half);
    b[i] = c1;
    wb[i] = c1 === c0 ? 0 : coverage(c1, lo, hi, cell, half);
  }

  return { out, a, wa, b, wb };
}

/**
 * Which output rows are copies of the row above.
 *
 * Inside a dot the mixture of source rows does not change from one output row
 * to the next, so most rows of the finished panel are identical to the row
 * before them. Copying those instead of computing them is what keeps the
 * largest zoom affordable - at 4x on a doubled display it is five rows in
 * eight, and the frame takes half as long.
 */
export function rowDuplicates(w) {
  const dup = new Uint8Array(w.out);

  for (let i = 1; i < w.out; i++) {
    dup[i] = (w.a[i] === w.a[i - 1] && w.b[i] === w.b[i - 1]
      && w.wa[i] === w.wa[i - 1] && w.wb[i] === w.wb[i - 1]) ? 1 : 0;
  }

  return dup;
}

/**
 * Everything the painter needs for one panel geometry, in one object.
 *
 * `srcW` x `srcH` is the emulated panel, `cell` the pitch in device pixels and
 * `gapFrac` the share of it the gap takes. `width` and `height` come back as
 * the size the output buffer has to be.
 */
export function makeGrid(srcW, srcH, cell, gapFrac) {
  const hx = axisWeights(srcW, cell, gapFrac);
  const hy = axisWeights(srcH, cell, gapFrac);

  return {
    srcW,
    srcH,
    width: hx.out,
    height: hy.out,
    hx,
    hy,
    dup: rowDuplicates(hy),
    rowA: new Float32Array(hx.out),
    rowB: new Float32Array(hx.out),
  };
}

/** One row of levels spread across the output width. */
function resampleRow(grid, levels, row, out) {
  const { a, wa, b, wb } = grid.hx;
  const base = row * grid.srcW;

  for (let x = 0; x < out.length; x++) {
    out[x] = levels[base + a[x]] * wa[x] + levels[base + b[x]] * wb[x];
  }
}

/**
 * Levels to pixels, through the coverage weights.
 *
 * `levels` holds one value per emulated dot, 0 for clear and 1 for fully dark -
 * fractions in between are the panel inertia caught mid-move. `ramp` is the
 * palette those levels index, and `out` receives one packed pixel per device
 * pixel.
 *
 * Horizontally an output pixel takes at most two dots, and vertically the same,
 * so a row of levels is spread across once and then two such rows are mixed for
 * every output row. Two spread rows are kept because consecutive output rows
 * ask for overlapping pairs, and the pair usually shifts along by one - hence
 * the swap rather than a second pass over a row already done.
 */
export function paint(grid, levels, ramp, out) {
  const { hx, hy, dup } = grid;
  const ow = hx.out;
  const top = ramp.length - 1;
  let bufA = grid.rowA, bufB = grid.rowB;
  let haveA = -1, haveB = -1;

  for (let y = 0; y < hy.out; y++) {
    // Inside a dot nothing changes from one output row to the next, so most
    // rows are the row above and a copy settles them.
    if (dup[y]) {
      out.copyWithin(y * ow, (y - 1) * ow, y * ow);
      continue;
    }

    const ra = hy.a[y], rb = hy.b[y], va = hy.wa[y], vb = hy.wb[y];

    if (ra !== haveA) {
      if (ra === haveB) {
        const swap = bufA; bufA = bufB; bufB = swap;
        haveA = haveB;
        haveB = -1;
      } else {
        resampleRow(grid, levels, ra, bufA);
        haveA = ra;
      }
    }
    if (vb > 0 && rb !== haveB) {
      resampleRow(grid, levels, rb, bufB);
      haveB = rb;
    }

    // The two coverages come from disjoint stretches of one device pixel, so
    // they cannot add past 1 and the ramp cannot be indexed off its end.
    const o = y * ow;
    if (vb > 0) {
      for (let x = 0; x < ow; x++) {
        out[o + x] = ramp[((bufA[x] * va + bufB[x] * vb) * top) | 0];
      }
    } else {
      for (let x = 0; x < ow; x++) {
        out[o + x] = ramp[((bufA[x] * va) * top) | 0];
      }
    }
  }
}
