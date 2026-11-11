// Hitachi HD61830 LCD timing controller.
//
// Ported from MAME's src/devices/video/hd61830.cpp. The Portfolio wires this
// chip to a 240x64 dual-scan panel: the controller renders two independent
// half-screens stacked vertically, each `nx` multiplexed lines tall.
//
// Typical Portfolio programming:
//   text mode:     hp=6, vp=8, hn=40, nx=32  -> 40x8 characters, 320 VRAM bytes
//   graphics mode: hp=8,       hn=30, nx=32  -> 240x64 pixels, 1920 VRAM bytes

export const SCREEN_W = 240;
export const SCREEN_H = 64;

const VRAM_MASK = 0x7FF;        // 2K of external SRAM on the LCD board

/**
 * How long the controller needs between two accesses to the display SRAM,
 * in CPU cycles at 4.9152 MHz.
 *
 * The chip shares that SRAM with the scan that refreshes the panel, and it does
 * not hold a write that arrives while the scan has the bus - it simply loses it.
 * The datasheet's answer is to poll the busy flag. On the Portfolio that answer
 * is not available: reading either LCD port gives back the low byte of the port
 * address, 10h from 8010h and 11h from 8011h, because nothing drives the data
 * bus in return. Measured over 65536 reads on real hardware, every one of them
 * identical, bit 7 never once set. Read display data is equally dead - thirty
 * known bytes written and read back returned 10h thirty times. So no program on
 * this machine can find out whether a write landed. The BIOS, the demos and
 * everything else write blind, and that is not carelessness but the only option
 * the hardware offers.
 *
 * A dropped write does NOT move the address counter, so what a program sees is
 * not speckle but a row written from the left that stops short: the tail keeps
 * whatever was there before.
 *
 * Measured on a real Atari Portfolio, not taken from a datasheet. STEPTEST
 * painted the screen black and then wrote it white at eight fixed spacings, one
 * spacing per screenful, and the panel answered: the fifth left a band unwritten
 * down the right, the sixth came out clean, six runs each way.
 *
 * THAT PAIR HAS MOVED THREE TIMES, and the reason is the whole warning on this number.
 * The hardware observation has never changed - the fifth screenful fails and the
 * sixth does not - but the ruler has. Those two screenfuls were read off this
 * emulator as 43 and 49 cycles apart when the instruction tables were taken at
 * face value; as 51 and 59 once the eight-bit bus was charged for; as 46 and 54
 * when the prefetch queue began to be simulated instead of approximated; and as
 * 48 and 56 in the earlier rule-based model and in the clock-exact core that
 * replaced it (js/emu/cpu8088.js), derived again when it went in. Hence 50, and hence
 * the standing caveat: this constant is exactly as good as the cycle model
 * underneath it, and it has to be re-derived from STEPTEST every time that model
 * changes.
 *
 * How much of a row survives is then decided by the arithmetic of rejection
 * rather than by any average rate, because the timestamp only moves when a
 * write is taken: at a spacing of s the chip accepts one write in ceil(50/s).
 * At 48 cycles that is every second byte, so half a row - which matches the
 * width of the band on the photograph well enough, and is worth stating plainly
 * because the tempting continuous reading, 30 x s / 50, gives a different answer
 * and is not what this model does.
 *
 * THE RULE IS ONE-SIDED, and that took a while to see. Only what arrives AFTER
 * a display-data write counts. An access wedged in just BEFORE one is harmless:
 * GAPTEST puts its instruction write 39 cycles ahead of every byte - well under
 * the threshold - and comes back clean on all four screens, six runs. Which is
 * what the mechanism predicts, since the data write is the only access that
 * reaches the external SRAM, so it is the only one that needs recovering from.
 *
 * AND THE CONSEQUENCE DEPENDS ON WHAT ARRIVES. A data write that comes too soon
 * is simply lost. An INSTRUCTION write that comes too soon catches the byte
 * still in flight and pulls it into the MODE CONTROL register, clearing
 * whichever bits that byte holds low. Display memory is untouched underneath,
 * and it stays that way until the program programs the chip again - REGTEST
 * proved that part early, when the same stripe that looked like wreckage came
 * back whole and full width the moment the mode was set up afresh.
 *
 * WHICH REGISTER took ten transfers to the hardware to establish, and the first
 * nine of them were wrong about it. Everything here used to say the character
 * count collapsed, reconstructed from the width of the surviving strip. It does
 * not: rewriting the character count repairs nothing, rewriting mode control
 * repairs it outright, and sweeping the bytes that hold exactly one bit low
 * shows only two of the eight doing anything - graphic mode and display on, the
 * two visible bits of the 32h the Portfolio programs. See strayIntoMode below
 * for what each of them looks like on the panel.
 *
 * The byte-loss half of this fits the threshold cleanly and always has:
 * STEPTEST loses bytes through its fastest screenfuls and not through its
 * slowest, ABTEST, RATETEST and GAPTEST are clean at every spacing they offer,
 * and a real program is clean through its unhurried stretches and ragged
 * through the tight ones. The gaps those runs were quoted at were read off this
 * emulator before the bus was modelled, so each understates the real spacing by
 * about a third; the ordering survives the correction and the argument rests on
 * nothing else.
 *
 * The mode-control half does NOT fit a threshold cleanly, and it would be
 * dishonest to pretend otherwise. Varying the timing does not switch it on and
 * off: with the byte value held at 00h it happens at every spacing tried, from
 * 135 cycles apart to 3267, with the instruction write anywhere from 24 to 76
 * cycles behind, with and without a cursor-address write between violations.
 * Varying the byte value switches it on and off completely. And the same loop
 * run twice does not always agree with itself. Whatever the real gate is, this
 * model approximates it with the threshold plus STRAY_ODDS, and that is an
 * approximation and not a measurement.
 */
export const RAM_ACCESS_CYCLES = 50;

/**
 * How often a badly timed instruction write actually catches the byte in flight.
 *
 * MEASURED 2026-08-26 (STRAY2.COM), and the value did not have to move. It was
 * guessed from the look of one demo, which made it the softest number in this
 * file for months; the hardware puts it at 0.053 with a 95% interval of 0.024 to
 * 0.108, and 0.05 sits inside that. Left where it is rather than nudged to
 * 0.053, because an interval spanning a factor of four does not justify a third
 * significant figure.
 *
 * The measurement is a dose-response curve: three doses of violations, six runs
 * at each, counting how often the panel went blank.
 *
 *   8 naruszen    2/6 = 33%     model 35%
 *   32            5/6 = 83%     model 82%
 *   128           6/6 = 100%    model 100%
 *
 * The shape is what matters as much as the number. A rate that rises with the
 * dose is what an independent per-violation chance looks like, and it was not a
 * foregone conclusion: an earlier run with a single sample per dose came back
 * non-monotone - four violations blanked the panel, sixty-four did not - which
 * left it open whether this was a coin at all or something else entirely. Six
 * samples per dose settled it. tools/tests/lcd-timing.mjs holds the emulator's
 * own rates against those brackets.
 */
const STRAY_ODDS = 0.05;

/**
 * How often the same badly timed instruction write costs the byte instead.
 *
 * MEASURED 2026-08-26 (PRZEPLOT.COM), and it is a second outcome of the same
 * fault rather than a second fault. Three bands on one screen, identical spacing
 * between data writes, differing only in what sat between them:
 *
 *   the data stream alone                 0 of 4800 bytes
 *   a 52-cycle instruction per byte      82 of 4800  =  1.71% +/- 0.19
 *   a 112-cycle instruction per byte      0 of 4800   (upper bound 0.063%)
 *
 * So it is not the interleaving. The band that interleaves outside the recovery
 * window loses nothing at all; only the one inside it does. That also closes the
 * question LOSS.COM opened: the notches counted long ago and filed under "the
 * hardware drops bytes even at safe spacing" were violations all along, and the
 * spacing had nothing to do with them.
 *
 * The byte is not corrupted, it is simply never stored - the panel had been
 * cleared before the pass, and what shows through the hole is the clear value.
 * Hence restoring the previous content rather than writing anything.
 */
const STRAY_LOSS_ODDS = 0.017;


const MODE_EXTERNAL_CG = 0x01;
const MODE_GRAPHIC     = 0x02;
const MODE_CURSOR      = 0x04;
const MODE_BLINK       = 0x08;
const MODE_MASTER      = 0x10;
const MODE_DISPLAY_ON  = 0x20;

const I_MODE_CONTROL            = 0;
const I_CHARACTER_PITCH         = 1;
const I_NUMBER_OF_CHARACTERS    = 2;
const I_NUMBER_OF_TIME_DIVISIONS = 3;
const I_CURSOR_POSITION         = 4;
const I_DISPLAY_START_LOW       = 8;
const I_DISPLAY_START_HIGH      = 9;
const I_CURSOR_ADDRESS_LOW      = 10;
const I_CURSOR_ADDRESS_HIGH     = 11;
const I_DISPLAY_DATA_WRITE      = 12;
const I_DISPLAY_DATA_READ       = 13;
const I_CLEAR_BIT               = 14;
const I_SET_BIT                 = 15;

/**
 * Fills the panel's SRAM the way switching the machine on does: with whatever
 * happened to be in it, which is not zeros.
 *
 * The difference matters. A program that assumes the screen starts blank, or
 * that leaves the display start address somewhere it did not intend, sees its
 * own 1920 bytes plus a tail of 128 it never wrote. With a zeroed array that
 * tail is white and the mistake is invisible here while being plain to see on
 * a real Portfolio; with a pattern it shows up in both places.
 *
 * The sequence is generated rather than drawn from Math.random so that a
 * session stays reproducible: two runs of the same program give the same
 * picture, which is what makes a bug report or a test worth anything. Only the
 * fact that the bytes are not zero carries meaning, not their values.
 */
function scrambleVram(vram) {
  let x = 0x2B7E;                       // any non-zero seed; xorshift needs one
  for (let i = 0; i < vram.length; i++) {
    x ^= (x << 7) & 0xFFFF;
    x ^= x >> 9;
    x ^= (x << 8) & 0xFFFF;
    vram[i] = x & 0xFF;
  }
}

import { take, put, copyBytes, intoBytes } from './snapshot.js';

// Everything the controller holds apart from display memory. The timing model's
// own fields belong here too - the recovery window and the generator that decides
// how a badly timed write falls over are state, not settings, and a snapshot that
// dropped them would restore into a machine that could not reproduce the fault
// it was taken in the middle of.
const STATE = ['accessCycles', 'lastRamAccess', 'lastDataWrite', 'lastDataValue',
               'lastWriteAddr', 'lastWritePrev', 'rng',
               'bf', 'ir', 'mcr', 'dor', 'dsa', 'cac',
               'vp', 'hp', 'hn', 'nx', 'cp', 'blink', 'cursor', 'cacSeen', 'cacHeld'];

export class HD61830 {
  /**
   * @param {Uint8Array} cgRom  internal 7360-bit character generator (0x5C0)
   * @param {(offset:number)=>number} readExternalCG
   *        host callback for external character generator mode; the offset is
   *        encoded as (charLine << 12) | charCode
   */
  constructor(cgRom, readExternalCG) {
    this.cgRom = cgRom;
    this.readExternalCG = readExternalCG;
    this.vram = new Uint8Array(VRAM_MASK + 1);
    scrambleVram(this.vram);

    // Zero means take every access, however fast it arrives - what this
    // emulation did before the timing above was measured, and what a user who
    // would rather have a tidy screen than a faithful one can go back to.
    this.accessCycles = 0;
    this.lastRamAccess = -1e9;

    // When the last accepted write to display memory happened, and how badly
    // the chip has been knocked about since.
    this.lastDataWrite = -1e9;
    this.lastWriteAddr = -1;
    this.lastWritePrev = 0;
    this.rng = 0x2B7E;

    this.reset();
  }

  /**
   * Turns the measured timing model on or off.
   *
   * Off takes every access instantly, however fast it arrives, which is what
   * this emulation did before any of it was measured and what a user who would
   * rather have a tidy screen than a faithful one can go back to.
   *
   * `seed` decides which way the geometry falls over when it does. On hardware
   * that varies from run to run and nobody gets to choose; here it is an
   * argument, so a test can pin it down and get the same picture twice.
   *
   * @param {{threshold?: boolean, seed?: number}} opts
   */
  setTiming({ threshold = false, seed = 0x2B7E } = {}) {
    this.accessCycles = threshold ? RAM_ACCESS_CYCLES : 0;
    this.lastRamAccess = -1e9;
    this.lastDataWrite = -1e9;
    this.lastDataValue = 0xFF;
    this.lastWriteAddr = -1;
    this.lastWritePrev = 0;
    this.rng = (seed | 0) || 0x2B7E;
  }

  /** xorshift, so that a seeded run repeats exactly. */
  nextRandom() {
    let x = this.rng;
    x ^= (x << 7) & 0xFFFF;
    x ^= x >> 9;
    x ^= (x << 8) & 0xFFFF;
    this.rng = x & 0xFFFF;
    return this.rng;
  }

  /**
   * Whether an access arriving now falls inside the recovery window that the
   * last accepted display-data write opened.
   */
  tooSoon(now) {
    if (!this.accessCycles) return false;
    return now - this.lastDataWrite < this.accessCycles;
  }

  /**
   * What a badly timed instruction write does: the byte still in flight is
   * pulled into the MODE CONTROL register, clearing whichever of its bits the
   * byte holds low.
   *
   * THIS ONE IS MEASURED, and it took ten transfers to the hardware to get it.
   * Everything here used to say the character count collapsed, which was a
   * reconstruction from the width of the surviving strip and was simply wrong.
   * Rewriting the character count repairs nothing; rewriting mode control
   * repairs it outright. See tools/tests/lcd-timing.mjs for the shape of the
   * evidence, and note both failures it accounts for:
   *
   *   bit 1 low   graphic mode is lost, the chip reads display memory as
   *               character codes, and the panel goes white with a band down
   *               the right - which is the picture this model spent months
   *               attributing to a short line
   *   bit 5 low   the display is switched off and the panel goes blank
   *
   * Sweeping the eight bytes that hold exactly one bit low, only those two do
   * anything at all; character-generator select, cursor, blink and the two
   * unused bits are all invisible in graphic mode, and came back clean. FFh
   * holds nothing low and is harmless, which is why it can be written through
   * a violation all day without a mark on the screen - and why five earlier
   * hardware runs that happened to write FFh proved nothing whatever.
   *
   * WHAT THE BYTE DOES TO THE REGISTER is written here as a plain assignment,
   * and that is a choice rather than a finding. Clearing only the bits the byte
   * holds low fits the same evidence and was tried first, but it accumulates:
   * run it against a program that writes thousands of bytes and every bit is
   * gone inside a second, leaving a dead panel where the hardware shows
   * rubbish. Assignment does not accumulate, so a later stray can put bits
   * back, which is what the hardware looks like. Neither rule is measured.
   *
   * KNOWN DIVERGENCE: through the wrecked stretch of a long demo this model
   * alternates between rubbish and a blank panel, where the hardware shows
   * rubbish throughout. The stretch starts and ends in the right place, and
   * the clean stretches either side are clean, but what is on the panel in
   * between is only approximately right.
   *
   * WHAT BYTE LOSS ABOVE THE THRESHOLD TURNED OUT TO BE. This file used to
   * record, as a known divergence, that hardware drops about 0.6% of bytes even
   * at twice the safe spacing while this model drops none. It does not: LOSS.COM
   * streamed 34,560 bytes at nine spacings from 59 to 419 cycles and lost none,
   * which put the bound at 0.0087%. The notches were real, but they were never
   * about spacing - PRZEPLOT.COM found them at 1.71% in a band whose instruction
   * writes fell inside the recovery window, and at nought in a band whose
   * instruction writes fell just outside it, with the spacing between the data
   * writes held identical across both. They are this same fault landing on the
   * byte instead of on the register, and strayLosesByte models them.
   *
   * HOW OFTEN, settled 2026-08-26: about one violation in twenty. See
   * STRAY_ODDS above for the measurement and its brackets. That the same loop
   * wrecks the panel on one run and leaves it alone on the next is exactly what
   * a one-in-twenty chance looks like over a hundred-odd violations.
   *
   * WHAT IS SETTLED, 2026-08-26 (MODEBITS.COM): bit 4, master mode, does nothing
   * on this board. It was the loose thread from the sweep - the third bit the
   * Portfolio sets, and the only one of the three whose loss showed no mark -
   * and two explanations fitted equally well: either clearing it is harmless, or
   * the violation simply had not fired on that run. Writing the register
   * directly, with no violation anywhere near it, separates them. Mode 22h -
   * master cleared, everything else as the Portfolio sets it - draws exactly what
   * 32h draws. The bit is inert here, so the sweep's clean result was the truth
   * and not a miss.
   *
   * The same run confirmed the rest of the register bit by bit: 12h blanks the
   * panel, 30h drops it into character mode, and the external character
   * generator, cursor and blink bits are all invisible in graphic mode. The
   * character-mode picture matched this emulation exactly, down to the shape -
   * regular vertical stripes with an empty band where display memory holds
   * zeros - which is the first time that path has been checked against hardware
   * at all.
   */
  strayIntoMode() {
    if (this.nextRandom() >= STRAY_ODDS * 0x10000) return;
    this.mcr = this.lastDataValue;
  }

  /**
   * Whether display memory can be written yet.
   *
   * The timestamp only moves on an accepted write. A rejected one is gone
   * without trace, which is what makes a run stop short rather than come out
   * striped: the address counter does not advance either, so the bytes that
   * follow land where the lost one would have, and the tail of the row keeps
   * whatever was there before.
   */
  ramReady(now, data) {
    if (this.tooSoon(now)) return false;
    this.lastDataWrite = now;
    this.lastDataValue = data & 0xFF;
    // What was under the cell about to be written, so that a stray instruction
    // arriving before the chip has finished can put it back - see
    // strayLosesByte. The address is read here rather than at the write site
    // because all three writing instructions come through this gate.
    this.lastWriteAddr = this.cac & VRAM_MASK;
    this.lastWritePrev = this.vram[this.lastWriteAddr];
    return true;
  }

  /**
   * The other thing a late instruction write does: the byte never lands.
   *
   * One violation, two possible outcomes, and they are drawn separately because
   * the hardware gives them different rates - about one in twenty for the mode
   * control register, about one in sixty for the byte. Both are measured; see
   * STRAY_ODDS and STRAY_LOSS_ODDS.
   *
   * The cell keeps what it held rather than being cleared, which is also
   * measured. GRANICA.COM ran the same violating pass over a white bed and over
   * a black one on the same screen, with three rows of white cut through the
   * middle of the black. The notches showed up on the white bed at 33 of 1680
   * and inside the white stripe at 11 of 504 - the same rate - and nowhere at
   * all on the 1176 bytes of black. A chip that cleared the cell would have
   * marked the black bed just as plainly.
   */
  strayLosesByte() {
    if (this.nextRandom() >= STRAY_LOSS_ODDS * 0x10000) return;
    if (this.lastWriteAddr < 0) return;
    this.vram[this.lastWriteAddr] = this.lastWritePrev;
  }

  reset() {
    this.bf = false;      // busy flag
    this.ir = 0;          // instruction register
    this.mcr = 0;         // mode control register
    this.dor = 0;         // data output register
    this.dsa = 0;         // display start address
    this.cac = 0;         // cursor address counter
    this.vp = 1;          // vertical character pitch
    this.hp = 6;          // horizontal character pitch
    this.hn = 1;          // characters per line
    this.nx = 1;          // number of time divisions
    this.cp = 0;          // cursor position within the character cell
    this.blink = 0;
    this.cursor = 0;
    this.cacSeen = -1;    // cursor address as of the previous frame
    this.cacHeld = -1;    // ...and it, only if the two agree - see render()
  }

  snapshot() { return { ...take(this, STATE), vram: copyBytes(this.vram) }; }

  restore(s) {
    put(this, s, STATE);
    intoBytes(this.vram, s.vram);
  }

  readByte(a) { return this.vram[a & VRAM_MASK]; }
  writeByte(a, v) { this.vram[a & VRAM_MASK] = v & 0xFF; }

  // ---- host interface -----------------------------------------------------

  statusRead() { return this.bf ? 0x80 : 0x00; }

  /**
   * @param {number} data
   * @param {number} [now]  CPU cycle count, for the recovery window above
   */
  controlWrite(data, now = 0) {
    if (this.tooSoon(now)) { this.strayIntoMode(); this.strayLosesByte(); }
    this.ir = data & 0xFF;
  }

  dataRead() {
    // Reads are pipelined: the value returned is the one prefetched by the
    // previous access, and the counter advances afterwards.
    const data = this.dor;
    this.dor = this.readByte(this.cac);
    this.cac = (this.cac + 1) & 0xFFFF;
    return data;
  }

  /**
   * @param {number} data
   * @param {number} [now]  CPU cycle count, for the SRAM access timing above
   */
  dataWrite(data, now = 0) {
    data &= 0xFF;

    switch (this.ir) {
      case I_MODE_CONTROL:
        this.mcr = data;
        break;

      case I_CHARACTER_PITCH:
        this.hp = (data & 0x07) + 1;
        this.vp = (data >> 4) + 1;
        break;

      case I_NUMBER_OF_CHARACTERS: {
        let hn = (data & 0x7F) + 1;
        this.hn = (hn % 2 === 0) ? hn : hn + 1;
        break;
      }

      case I_NUMBER_OF_TIME_DIVISIONS:
        this.nx = (data & 0x7F) + 1;
        break;

      case I_CURSOR_POSITION:
        this.cp = (data & 0x0F) + 1;
        break;

      case I_DISPLAY_START_LOW:
        this.dsa = (this.dsa & 0xFF00) | data;
        break;

      case I_DISPLAY_START_HIGH:
        this.dsa = ((data << 8) | (this.dsa & 0xFF)) & 0xFFFF;
        break;

      case I_CURSOR_ADDRESS_LOW:
        // Writing a low byte that clears bit 7 while bit 7 was set carries
        // into the high byte - a documented quirk of the real part.
        if ((this.cac & 0x80) && !(data & 0x80)) {
          this.cac = ((((this.cac >> 8) + 1) << 8) | data) & 0xFFFF;
        } else {
          this.cac = (this.cac & 0xFF00) | data;
        }
        break;

      case I_CURSOR_ADDRESS_HIGH:
        this.cac = ((data << 8) | (this.cac & 0xFF)) & 0xFFFF;
        break;

      case I_DISPLAY_DATA_WRITE:
        if (!this.ramReady(now, data)) break;   // arrived too soon; the chip loses it
        this.writeByte(this.cac, data);
        this.cac = (this.cac + 1) & 0xFFFF;
        break;

      case I_DISPLAY_DATA_READ:
        break;

      case I_CLEAR_BIT:
        if (!this.ramReady(now, data)) break;
        this.writeByte(this.cac, this.readByte(this.cac) & ~(1 << (data & 0x07)));
        this.cac = (this.cac + 1) & 0xFFFF;
        break;

      case I_SET_BIT:
        if (!this.ramReady(now, data)) break;
        this.writeByte(this.cac, this.readByte(this.cac) | (1 << (data & 0x07)));
        this.cac = (this.cac + 1) & 0xFFFF;
        break;

      default:
        break;   // illegal instruction; the chip ignores it
    }
  }

  // ---- rendering ----------------------------------------------------------

  /**
   * Renders the current display state into `out`, a SCREEN_W * SCREEN_H array
   * of 0/1 pixel values.
   */
  render(out) {
    // The blinking cell is the one at the cursor address, and the cursor address
    // is also the write pointer - every byte of display data moves it on. So a
    // program that is filling the screen drags the blink along behind it, and on
    // the Portfolio it does so fast: measured through the text opening of
    // Nucleus, the address moves about 4,300 times a second, one step every ten
    // to twenty microseconds. The panel refreshes 72 times a second, so roughly
    // sixty different cells claim the blink during a single frame.
    //
    // The chip resolves that as it scans, cell by cell, and a cell that is
    // selected for a fraction of one frame gets a fraction of one frame's drive
    // out of a supertwist panel - which is nothing. A real Portfolio shows the
    // cursor when it is parked and shows nothing at all while text is going up.
    //
    // Rendering a whole frame from one snapshot of the address cannot reproduce
    // that: it puts a hard black block wherever the write pointer happened to be
    // at that instant, and the next frame puts it somewhere else. Over the
    // opening of Nucleus that came to a block on every one of the 1,748 text
    // frames, at 176 different places - a cursor flying around the screen that
    // the hardware never shows. Requiring the address to survive a whole frame
    // before it can blink leaves 13 places, which are the parked ones.
    this.cacHeld = this.cacSeen === this.cac ? this.cac : -1;
    this.cacSeen = this.cac;

    if (this.mcr & MODE_DISPLAY_ON) {
      if (this.mcr & MODE_GRAPHIC) this.updateGraphics(out);
      else this.updateText(out);
    } else {
      out.fill(0);
    }

    this.blink = (this.blink + 1) & 0xFF;
    if (this.blink === 0x20) {
      this.blink = 0;
      this.cursor = this.cursor ? 0 : 1;
    }
  }

  /**
   * One display line, `hn` characters of it.
   *
   * The offset is what a short line does on real hardware, and it is only ever
   * non-zero after something has gone wrong. The controller clocks pixel data
   * serially into the panel's column drivers; clock in fewer bits than the
   * panel is wide and they come to rest at the FAR end of the chain, leaving
   * the near end never loaded and blank. On the Portfolio the far end is the
   * right-hand edge, which is where a wrecked controller leaves its surviving
   * strip - measured, on the real machine, at four different widths across
   * several runs, always against the right edge.
   *
   * In ordinary use it changes nothing: graphics mode is 30 characters of 8
   * pixels and text mode 40 of 6, and both fill the 240 exactly.
   */
  drawScanline(out, y, ra) {
    const offset = Math.max(0, SCREEN_W - this.hn * this.hp);

    for (let sx = 0; sx < this.hn; sx += 2) {
      const d1 = this.readByte(ra++);
      const d2 = this.readByte(ra++);

      for (let x = 0; x < this.hp; x++) {
        if (y < 0 || y >= SCREEN_H) continue;
        const px1 = offset + sx * this.hp + x;
        const px2 = px1 + this.hp;
        if (px1 >= 0 && px1 < SCREEN_W) out[y * SCREEN_W + px1] = (d1 >> x) & 1;
        if (px2 >= 0 && px2 < SCREEN_W) out[y * SCREEN_W + px2] = (d2 >> x) & 1;
      }
    }
    return ra & 0xFFFF;
  }

  updateGraphics(out) {
    out.fill(0);
    let rac1 = this.dsa;
    let rac2 = (this.dsa + this.nx * this.hn) & 0xFFFF;
    for (let y = 0; y < this.nx; y++) {
      rac1 = this.drawScanline(out, y, rac1);
      rac2 = this.drawScanline(out, y + this.nx, rac2);
    }
  }

  charPixels(md, cl) {
    if (this.mcr & MODE_EXTERNAL_CG) {
      return this.readExternalCG(((cl << 12) | md) & 0xFFFF);
    }

    // Internal generator: 5x7 glyphs for 0x20-0x7F and 0xA0-0xDF, 5x11 for
    // 0xE0-0xFF. Anything else is blank.
    let addr = 0;
    if (md >= 0x20 && md < 0x80 && cl < 7) {
      addr = (md - 0x20) * 7 + cl;
    } else if (md >= 0xA0 && md < 0xE0 && cl < 7) {
      addr = 96 * 7 + (md - 0xA0) * 7 + cl;
    } else if (md >= 0xE0 && cl < 11) {
      addr = 160 * 7 + (md - 0xE0) * 11 + cl;
    } else {
      return 0;
    }
    return this.cgRom[addr] || 0;
  }

  drawChar(out, ma, x, y, md) {
    const cursorOn = this.mcr & MODE_CURSOR;
    const blinkOn = this.mcr & MODE_BLINK;

    for (let cl = 0; cl < this.vp; cl++) {
      const sy = y * this.vp + cl;
      if (sy >= SCREEN_H) break;

      const data = this.charPixels(md, cl);

      for (let cr = 0; cr < this.hp; cr++) {
        const sx = x * this.hp + cr;
        if (sx >= SCREEN_W) break;

        let pixel = (data >> cr) & 1;

        if (blinkOn && ma === this.cacHeld) {
          if (!cursorOn) pixel = this.cursor ? 1 : pixel;
          if (cursorOn && cl === this.cp) pixel = this.cursor ? 1 : 0;
        } else if (cursorOn && cl === this.cp) {
          pixel = this.cursor ? 1 : 0;
        }

        out[sy * SCREEN_W + sx] = pixel;
      }
    }
  }

  updateText(out) {
    out.fill(0);

    const rows = Math.floor(this.nx / this.vp);
    let ma = 0;
    let rac1 = this.dsa & 0xFFF;
    let rac2 = (rac1 + rows * this.hn) & 0xFFFF;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < this.hn; x += 2) {
        this.drawChar(out, ma, x, y, this.readByte(rac1));
        this.drawChar(out, ma + 1, x + 1, y, this.readByte(rac1 + 1));

        this.drawChar(out, ma + rows * this.hn, x, y + rows, this.readByte(rac2));
        this.drawChar(out, ma + 1 + rows * this.hn, x + 1, y + rows, this.readByte(rac2 + 1));

        ma += 2;
        rac1 = (rac1 + 2) & 0xFFFF;
        rac2 = (rac2 + 2) & 0xFFFF;
      }
    }
  }
}
