// Philips PCD3311T DTMF / modem / musical tone generator.
//
// The Portfolio drives it in parallel mode from port 0x8020:
//
//   bits 0-5  D0-D5  tone selection
//   bit  6    STROBE - the falling edge latches D0-D5
//   bit  7    drives VDD, MODE and A0 together
//
// D5:D4 pick a bank and D3:D0 an entry within it. The chip emits one or two
// tones; two are used for real DTMF digits, one for everything else.
// Frequencies are taken from MAME's pcd3311.cpp - they are measured
// approximations, since the exact dividers live in an undumped internal ROM.
//
// Only the frequencies are modelled here; the waveform belongs to the output
// stage in js/ui/audio.js. MAME synthesises a square wave, but the data sheet
// specifies low output distortion with on-chip filtering to meet CEPT, so the
// real pin carries something much closer to a sine.

const DTMF_TONES = [
  697.90, 770.46, 850.45, 943.23, 1206.45, 1341.66,
  1482.21, 1638.24, 1875.1, 1970.0, 2358.1, 2470.4,
];

const MODEM_TONES = [
  1296.94, 2103.14, 1197.17, 2192.01, 978.82, 1179.03,
  1073.33, 1265.30, 1655.66, 1852.77, 2021.20, 2223.32,
];

const MUSIC_TONES = [
  622.5, 659.5, 697.9, 741.1, 782.1, 832.3, 879.3, 931.9,
  985.0, 1044.5, 1111.7, 1245.1, 1318.9, 1402.1, 1572.0, 1768.5,
];

// Bank 0x00: single DTMF tones, only entries 4-15 are defined.
const SINGLE_MAP = [
  -1, -1, -1, -1, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7,
];

// Bank 0x10: the sixteen dual-tone DTMF combinations, as [low, high].
const DUAL_MAP = [
  [3, 5], [0, 4], [0, 5], [0, 6], [1, 4], [1, 5], [1, 6], [2, 4],
  [2, 5], [2, 6], [0, 7], [1, 7], [2, 7], [3, 7], [3, 4], [3, 6],
];

import { take, put } from './snapshot.js';

const STATE = ['data', 'strobe', 'mode', 'freq0', 'freq1'];

export class PCD3311 {
  /**
   * @param {(f0:number, f1:number) => void} onToneChange
   * @param {() => void} onClick fired when the VDD/MODE/A0 line moves
   */
  constructor(onToneChange, onClick) {
    this.onToneChange = onToneChange;
    this.onClick = onClick || (() => {});
    this.reset();
  }

  reset() {
    this.data = 0;
    this.strobe = 0;
    this.mode = 0;
    this.freq0 = 0;
    this.freq1 = 0;
  }

  snapshot() { return take(this, STATE); }
  restore(s) { put(this, s, STATE); }

  write(data) { this.data = data & 0x3F; }

  // The BIOS does not use tones for the key click: it leaves D0-D5 at zero,
  // never pulses STROBE, and instead flips bit 7 of port 0x8020 - the line that
  // drives VDD, MODE and A0 together - low for about 102 us. Powering the chip
  // across that pulse kicks the piezo, which is the click you hear.
  //
  // MAME models this line as a plain register and so produces no key click at
  // all; treating each edge as an impulse is an extension over its model.
  modeW(state) {
    const m = state ? 1 : 0;
    if (m !== this.mode) {
      this.mode = m;
      this.onClick();
    }
  }

  a0W() { /* selects the I2C slave address; unused in parallel mode */ }

  strobeW(state) {
    const s = state ? 1 : 0;
    if (this.strobe && !s) this.loadData(this.data);
    this.strobe = s;
  }

  loadData(data) {
    let f0 = 0;
    let f1 = 0;

    switch (data & 0x30) {
      case 0x00: {
        const i = SINGLE_MAP[data & 0x0F];
        if (i >= 0) f0 = DTMF_TONES[i];
        break;
      }
      case 0x10: {
        const [lo, hi] = DUAL_MAP[data & 0x0F];
        f0 = DTMF_TONES[lo];
        f1 = DTMF_TONES[hi];
        break;
      }
      case 0x20: {
        const i = data & 0x0F;
        if (i >= 4) f0 = MODEM_TONES[i - 4];
        break;
      }
      default:
        f0 = MUSIC_TONES[data & 0x0F];
        break;
    }

    if (f0 !== this.freq0 || f1 !== this.freq1) {
      this.freq0 = f0;
      this.freq1 = f1;
      this.onToneChange(f0, f1);
    }
  }
}
