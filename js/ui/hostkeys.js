// The browser's keyboard as the Portfolio's matrix sees it.
//
// The emulator sends physical scan codes and lets the Portfolio ROM do the
// shifting, exactly as the hardware does. That is what makes Fn combinations
// and the DIP-DOS key handling come out right, but it rests on an assumption:
// that the browser reports every key, modifiers included, as a key of its own.
//
// Not every browser does. LibreWolf (Firefox 154 with resistFingerprinting
// turned on by default) delivers no keydown and no keyup for Shift at all, yet
// still sets `shiftKey` on every other event and resolves `key` to ":". Since
// the ROM only ever sees scan codes, Shift+";" arrives as a bare semicolon and
// the drive cannot be changed - the panel looks broken for a reason that has
// nothing to do with the emulation.
//
// So the flag, not the key, is taken as the truth: whenever a modifier flag
// disagrees with what the matrix is holding, the difference is made up with a
// synthetic press. Browsers that do report the key never reach that path, and
// the stand-in costs them nothing.

import { DEFAULT_KEYMAP } from '../emu/keyboard.js';

// Modifiers the Portfolio has as real keys, next to the event flag mirroring
// each one. Fn has no browser equivalent and needs none - nothing outside the
// Portfolio has that key.
export const MODIFIERS = [
  { flag: 'shiftKey', codes: ['ShiftLeft', 'ShiftRight'], scancode: 27 },
  { flag: 'ctrlKey', codes: ['ControlLeft', 'ControlRight'], scancode: 18 },
  { flag: 'altKey', codes: ['AltLeft', 'AltRight'], scancode: 9 },
];

export class HostKeyboard {
  /**
   * @param {(type: 'keydown'|'keyup', scancode: number) => void} send
   *        handed each scan code in the order the matrix should see it
   * @param {Record<string, number>} [keymap] browser code -> Portfolio scan code
   */
  constructor(send, keymap = DEFAULT_KEYMAP) {
    this.send = send;
    this.keymap = keymap;
    // What the matrix holds on our account. The two are kept apart because only
    // the synthetic ones are ours to release: a key the browser announced will
    // be taken back by the browser.
    this.real = new Set();
    this.synthetic = new Set();
  }

  /** Scan code for an event, or undefined when the Portfolio has no such key. */
  scancode(e) {
    return this.keymap[e.code];
  }

  down(e) {
    const sc = this.scancode(e);
    if (sc === undefined) return false;
    this.sync(e);
    this.real.add(sc);
    this.send('keydown', sc);
    return true;
  }

  up(e) {
    const sc = this.scancode(e);
    if (sc === undefined) return false;
    this.sync(e);
    this.real.delete(sc);
    this.send('keyup', sc);
    return true;
  }

  /**
   * Brings the matrix in line with the modifier flags an event carries.
   *
   * Called before the key itself goes out, because the ROM reads scan codes in
   * order: Shift has to be down by the time the semicolon arrives, or the pair
   * comes out as ";" instead of ":".
   */
  sync(e) {
    for (const m of MODIFIERS) {
      // This very event is the modifier, or the browser already reported it as
      // a key - either way the real path has it covered.
      if (m.codes.includes(e.code)) continue;
      if (m.codes.some((c) => this.real.has(this.keymap[c]))) continue;

      const down = this.synthetic.has(m.scancode);
      if (e[m.flag] && !down) {
        this.synthetic.add(m.scancode);
        this.send('keydown', m.scancode);
      } else if (!e[m.flag] && down) {
        this.synthetic.delete(m.scancode);
        this.send('keyup', m.scancode);
      }
    }
  }

  /**
   * Forget everything without sending anything.
   *
   * Goes with the `blur` message, which empties the matrix on the emulator's
   * side. A key let go of while the page was away produces no event, so
   * whatever we still think is held would otherwise never be sent up.
   */
  forget() {
    this.real.clear();
    this.synthetic.clear();
  }
}
