// Intel 82C55A programmable peripheral interface, mode 0 only.
//
// The Portfolio drives this chip in both directions depending on what it is
// doing, so the direction bits in the control word actually matter:
//
//   printing        A and B output, C input   - data out, strobe out, status in
//   file transfer   A and B input,  C output  - data in, handshake out (0x92)
//
// Control word with bit 7 set configures the ports:
//   bit 6-5  group A mode (only mode 0 is modelled)
//   bit 4    port A      1 = input
//   bit 3    port C high 1 = input
//   bit 2    group B mode
//   bit 1    port B      1 = input
//   bit 0    port C low  1 = input
//
// Control word with bit 7 clear is a bit set/reset on port C:
//   bits 3-1 select the bit, bit 0 is the value.

import { take, put } from './snapshot.js';

const STATE = ['control', 'outA', 'outB', 'outC', 'inA', 'inB', 'inC'];

export class I8255 {
  constructor() {
    this.reset();
  }

  reset() {
    // Power-on default is 0x9B: every port an input.
    this.control = 0x9B;
    this.outA = 0;
    this.outB = 0;
    this.outC = 0;
    // Values presented by whatever is wired to the chip.
    this.inA = 0xFF;
    this.inB = 0xFF;
    this.inC = 0xFF;
    this.onPortWrite = () => {};
  }

  snapshot() { return take(this, STATE); }
  restore(s) { put(this, s, STATE); }

  get aIsInput() { return (this.control & 0x10) !== 0; }
  get bIsInput() { return (this.control & 0x02) !== 0; }
  get cHighIsInput() { return (this.control & 0x08) !== 0; }
  get cLowIsInput() { return (this.control & 0x01) !== 0; }

  read(reg) {
    switch (reg & 3) {
      case 0: return this.aIsInput ? (this.inA & 0xFF) : this.outA;
      case 1: return this.bIsInput ? (this.inB & 0xFF) : this.outB;
      case 2: {
        const high = (this.cHighIsInput ? this.inC : this.outC) & 0xF0;
        const low = (this.cLowIsInput ? this.inC : this.outC) & 0x0F;
        return high | low;
      }
      default: return 0xFF;    // the control register is write-only
    }
  }

  write(reg, val) {
    val &= 0xFF;

    switch (reg & 3) {
      case 0: this.outA = val; this.onPortWrite('A', val); break;
      case 1: this.outB = val; this.onPortWrite('B', val); break;
      case 2: this.outC = val; this.onPortWrite('C', val); break;
      default:
        if (val & 0x80) {
          // Mode set also clears the output latches, per the datasheet.
          this.control = val;
          this.outA = this.outB = this.outC = 0;
          this.onPortWrite('MODE', val);
        } else {
          const bit = (val >> 1) & 0x07;
          if (val & 1) this.outC |= (1 << bit);
          else this.outC &= ~(1 << bit);
          this.onPortWrite('C', this.outC);
        }
        break;
    }
  }
}
