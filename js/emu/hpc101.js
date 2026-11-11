// Atari Portfolio HPC-101 parallel interface.
//
// An 82C55A PPI bridged to a Centronics port, sitting on the expansion bus:
//
//   0x8078  port A
//   0x8079  port B
//   0x807A  port C
//   0x807B  PPI control register
//   0x807F  peripheral ID, reads 0x02 = parallel port
//
// The board serves two very different jobs and the ROM reconfigures the PPI
// for each:
//
//   printing        A and B output, C input  - data, control, printer status
//   file transfer   A and B input,  C output - the ROM reads a byte from the
//                                              other end and handshakes on C
//
// Printing is emulated as a virtual printer whose bytes accumulate in a buffer.
// The transfer direction exposes the raw port state so a host-side link can
// drive it.

import { I8255 } from './i8255.js';

const BUSY_CYCLES = 200;
const ACK_CYCLES = 60;

import { take, put } from './snapshot.js';

const STATE = ['strobe', 'busy', 'ack', 'timer', 'phase'];

export class HPC101 {
  constructor() {
    this.ppi = new I8255();
    this.buffer = [];
    this.link = null;          // optional host-side transfer partner
    this.reset();
  }

  reset() {
    this.ppi.reset();
    this.strobe = 1;
    this.busy = 0;
    this.ack = 1;              // ~ACK idle high
    this.timer = 0;
    this.phase = 0;            // 0 idle, 1 busy, 2 ack pulse
    this.refreshInputs();

    this.ppi.onPortWrite = (port, val) => this.onPortWrite(port, val);
  }

  /** The print buffer travels with the board; the host-side link does not. */
  snapshot() {
    return { ...take(this, STATE), ppi: this.ppi.snapshot(), buffer: this.buffer.slice() };
  }

  restore(s) {
    put(this, s, STATE);
    if (s.ppi) this.ppi.restore(s.ppi);
    this.buffer = Array.from(s.buffer || []);
  }

  // ---- expansion bus interface -------------------------------------------

  pdet() { return true; }
  nmd1() { return 1; }
  eack() { return 0; }

  memRead() { return 0xFF; }
  memWrite() { }

  ioRead(port, data, bcom) {
    if (!bcom) {
      if ((port & 0x0F) === 0x0F) data = 0x02;          // peripheral ID
      if ((port & 0x0C) === 0x08) {
        this.refreshInputs();
        data = this.ppi.read(port & 0x03);
      }
    }
    return data;
  }

  ioWrite(port, val, bcom) {
    if (!bcom && (port & 0x0C) === 0x08) this.ppi.write(port & 0x03, val);
  }

  // ---- what the chip sees on its input pins -------------------------------

  refreshInputs() {
    // Port C as an input carries the Centronics status lines: PERROR low
    // (paper present), SELECT high (online), ~FAULT high, plus BUSY and ~ACK.
    let c = 0x02 | 0x08;
    if (this.busy) c |= 0x10;
    if (this.ack) c |= 0x20;
    this.ppi.inC = c;

    // Ports A and B as inputs are driven by whatever is on the other end of
    // the cable. With nothing attached they float high.
    this.ppi.inA = this.link ? this.link.dataOut() : 0xFF;
    this.ppi.inB = this.link ? this.link.statusOut() : 0xFF;
  }

  onPortWrite(port, val) {
    // Printing: port B drives the Centronics control lines.
    if (port === 'B' && !this.ppi.bIsInput) this.setControlLines(val);

    // Transfer: port C is the Portfolio's handshake towards the host.
    if ((port === 'C' || port === 'MODE') && !this.ppi.cLowIsInput && this.link) {
      this.link.handshake(this.ppi.outC, this.ppi.outA, this.ppi);
    }
  }

  setControlLines(val) {
    const prev = this.strobe;
    this.strobe = val & 0x01;

    // Data is accepted on the falling edge of ~STROBE.
    if (prev === 1 && this.strobe === 0 && !this.busy) {
      this.buffer.push(this.ppi.outA);
      this.busy = 1;
      this.ack = 1;
      this.phase = 1;
      this.timer = BUSY_CYCLES;
    }
  }

  advance(cycles) {
    if (this.link && this.link.advance) this.link.advance(cycles);
    if (this.phase === 0) return;

    this.timer -= cycles;
    if (this.timer > 0) return;

    if (this.phase === 1) {
      this.busy = 0;
      this.ack = 0;             // ~ACK pulses low
      this.phase = 2;
      this.timer = ACK_CYCLES;
    } else {
      this.ack = 1;
      this.phase = 0;
    }
  }

  // ---- host side ----------------------------------------------------------

  attachLink(link) { this.link = link; }

  takeBuffer() {
    const out = Uint8Array.from(this.buffer);
    this.buffer.length = 0;
    return out;
  }

  peekLength() { return this.buffer.length; }
}
