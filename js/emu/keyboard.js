// Atari Portfolio keyboard.
//
// The ASIC scans a 63-key switch matrix and hands the BIOS a *physical* scan
// code - row * 8 + column - with bit 7 set to signal a key release. INT 09h
// then translates it into an IBM PC scan code. This is why software that pokes
// port 0x60 directly does not work on a Portfolio.
//
// The real controller emits one event per matrix scan at 600 Hz, so events are
// queued and released at that rate rather than all at once.

const SCAN_HZ = 600;

// Matrix layout taken from MAME's pofo_kbd.cpp (ports Y0..Y7, bits 0..7).
// Index = row * 8 + column = the physical scan code.
export const KEY_NAMES = [
  /* Y0 */ 'Atari', null, '1', '2', '3', 'D', '5', '6',
  /* Y1 */ 'Del', 'Alt', 'Q', 'U', 'O', '7', 'Backspace', '9',
  /* Y2 */ 'Tab', 'W', 'Ctrl', 'E', 'R', 'T', 'Enter', 'Y',
  /* Y3 */ '0', 'I', '-', 'LShift', '[', 'Up', "'", ']',
  /* Y4 */ 'S', 'P', '4', 'G', 'RShift', 'Down', ',', 'L',
  /* Y5 */ 'F', 'H', 'J', 'Left', 'Right', 'Lock', '8', 'K',
  /* Y6 */ '\\', 'Z', 'Space', ';', '.', '=', 'Fn', 'X',
  /* Y7 */ 'C', 'V', 'B', 'N', 'M', '/', 'A', 'Esc',
];

// Browser KeyboardEvent.code -> physical Portfolio scan code.
// The Portfolio has no numeric keypad and no F2-F12, so those are left free
// for emulator functions.
export const DEFAULT_KEYMAP = {
  Backquote: 0, Digit1: 2, Digit2: 3, Digit3: 4, KeyD: 5, Digit5: 6, Digit6: 7,
  Delete: 8, AltLeft: 9, KeyQ: 10, KeyU: 11, KeyO: 12, Digit7: 13,
  Backspace: 14, Digit9: 15,
  Tab: 16, KeyW: 17, ControlLeft: 18, KeyE: 19, KeyR: 20, KeyT: 21,
  Enter: 22, KeyY: 23,
  Digit0: 24, KeyI: 25, Minus: 26, ShiftLeft: 27, BracketLeft: 28,
  ArrowUp: 29, Quote: 30, BracketRight: 31,
  KeyS: 32, KeyP: 33, Digit4: 34, KeyG: 35, ShiftRight: 36, ArrowDown: 37,
  Comma: 38, KeyL: 39,
  KeyF: 40, KeyH: 41, KeyJ: 42, ArrowLeft: 43, ArrowRight: 44, CapsLock: 45,
  Digit8: 46, KeyK: 47,
  Backslash: 48, KeyZ: 49, Space: 50, Semicolon: 51, Period: 52, Equal: 53,
  F1: 54, KeyX: 55,
  KeyC: 56, KeyV: 57, KeyB: 58, KeyN: 59, KeyM: 60, Slash: 61, KeyA: 62,
  Escape: 63,

  // Convenient aliases for keys the Portfolio maps elsewhere.
  AltRight: 9, ControlRight: 18, NumpadEnter: 22, Insert: 8,
};

import { take, put } from './snapshot.js';

// Auto-repeat. Holding a key on a real Portfolio repeats it, and the repeat is
// NOT the BIOS doing typematic of its own: INT 09h emits one character for every
// make code it is handed and nothing when a key merely stays down. Fed bare make
// codes at 100 ms it produced exactly ten characters a second; fed one make code
// and silence, it produced one character however long the key was held. So the
// repeat comes from below the BIOS - the ASIC re-issues the make code of the key
// still held - and that is where it is modelled, rather than letting the host
// browser's own repeat through, which would tie the rate to the user's operating
// system settings instead of the machine's.
//
// NOT MEASURED YET: the two numbers below are the IBM PC defaults, put here so
// the behaviour exists at all. Nobody has timed a real Portfolio's delay or rate,
// so they are a placeholder and are marked as one - unlike everything in
// tools/tests/cpu-sprzet.mjs, which is measurement.
const REPEAT_DELAY_MS = 500;
const REPEAT_RATE_HZ = 10;

// Keys that produce no character of their own never repeat: the modifiers, the
// two locks and the Atari key that stands in for the numeric keypad.
const NO_REPEAT = new Set([0, 9, 18, 27, 36, 45, 54]);

const STATE = ['data', 'cyclesToScan', 'scanCycles', 'repeatKey', 'repeatCycles',
  'repeatDelay', 'repeatPeriod'];

export class PofoKeyboard {
  /** @param {() => void} onInterrupt raises the ASIC keyboard interrupt */
  constructor(onInterrupt) {
    this.onInterrupt = onInterrupt;
    this.queue = [];
    this.data = 0xFF;
    this.cyclesToScan = 0;
    this.scanCycles = 8192;   // set properly by setClock()
    this.held = new Set();
    // -1 when nothing is repeating; otherwise the scan code being re-issued and
    // the clocks left before the next one goes out.
    this.repeatKey = -1;
    this.repeatCycles = 0;
    this.repeatDelay = 0;
    this.repeatPeriod = 0;
  }

  setClock(cpuClock) {
    this.scanCycles = Math.round(cpuClock / SCAN_HZ);
    this.cyclesToScan = this.scanCycles;
    this.repeatDelay = Math.round((cpuClock * REPEAT_DELAY_MS) / 1000);
    this.repeatPeriod = Math.round(cpuClock / REPEAT_RATE_HZ);
  }

  reset() {
    this.data = 0xFF;
    this.queue.length = 0;
    this.held.clear();
    this.cyclesToScan = this.scanCycles;
    this.repeatKey = -1;
    this.repeatCycles = 0;
  }

  /**
   * The queue and the held-key set travel as plain arrays, because a snapshot
   * has to survive a trip through postMessage and a Set does not always.
   */
  snapshot() {
    return { ...take(this, STATE), queue: this.queue.slice(), held: [...this.held] };
  }

  restore(s) {
    put(this, s, STATE);
    this.queue = Array.from(s.queue || []);
    this.held = new Set(s.held || []);
  }

  read() { return this.data; }

  keyDown(scancode) {
    if (!Number.isInteger(scancode) || scancode < 0 || scancode > 63) return;
    // The host repeats keys too, and its make codes arrive with no break code in
    // between. They are dropped here: the matrix cannot report a key that is
    // already down, and the repeat this machine has is its own, below.
    if (this.held.has(scancode)) return;
    this.held.add(scancode);
    this.queue.push(scancode);

    // The last key pressed is the one that repeats - press a second key and the
    // first one stops, which is how a keyboard behaves.
    if (!NO_REPEAT.has(scancode)) {
      this.repeatKey = scancode;
      this.repeatCycles = this.repeatDelay;
    }
  }

  keyUp(scancode) {
    if (!Number.isInteger(scancode) || scancode < 0 || scancode > 63) return;
    if (!this.held.delete(scancode)) return;
    this.queue.push(0x80 | scancode);
    if (this.repeatKey === scancode) this.repeatKey = -1;
  }

  releaseAll() {
    for (const sc of [...this.held]) this.keyUp(sc);
  }

  // Called with the cycles executed since the last call.
  advance(cycles) {
    if (this.repeatKey >= 0 && this.repeatPeriod > 0) {
      this.repeatCycles -= cycles;
      while (this.repeatCycles <= 0) {
        this.repeatCycles += this.repeatPeriod;
        // A bare make code, with no break code before it: that is what the BIOS
        // turns into one more character.
        this.queue.push(this.repeatKey);
      }
    }

    if (this.queue.length === 0) return;

    this.cyclesToScan -= cycles;
    while (this.cyclesToScan <= 0) {
      this.cyclesToScan += this.scanCycles;
      if (this.queue.length === 0) break;
      this.data = this.queue.shift();
      this.onInterrupt();
    }
  }
}
