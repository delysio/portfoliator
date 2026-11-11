// Atari Portfolio HPC-102 serial interface.
//
// An 82C50A UART on the expansion bus, wired the same way as the HPC-101's PPI:
//
//   0x8070-0x8077  UART registers (offset & 7)
//   0x807F         read:  peripheral ID, 0x01 = serial port
//                  write: interrupt vector register - the byte the ASIC hands
//                         the CPU when this peripheral raises EINT
//
// The vector register is the mechanism the Technical Reference Guide calls the
// "Serial Interrupt Vector Register": the peripheral does not have a fixed
// vector, the driver tells it which one to supply.

import { INS8250 } from './ins8250.js';

import { take, put } from './snapshot.js';

const STATE = ['vector', 'eint'];

export class HPC102 {
  /**
   * @param {number} cpuClock
   * @param {(byte:number)=>void} onTransmit bytes leaving the Portfolio
   */
  constructor(cpuClock, onTransmit) {
    this.vector = 0;
    this.eint = false;
    this.onTransmit = onTransmit || (() => {});
    this.onEint = () => {};          // wired by Machine.attachExpansion

    this.uart = new INS8250(
      cpuClock,
      (byte) => this.onTransmit(byte),
      (state) => this.setEint(state));
  }

  reset() {
    this.vector = 0;
    this.eint = false;
    this.uart.reset();
  }

  snapshot() { return { ...take(this, STATE), uart: this.uart.snapshot() }; }

  restore(s) {
    put(this, s, STATE);
    if (s.uart) this.uart.restore(s.uart);
  }

  setEint(state) {
    this.eint = state;
    // The ASIC latches the external interrupt on a rising edge.
    if (state) this.onEint();
  }

  // ---- expansion bus interface -------------------------------------------

  pdet() { return true; }
  nmd1() { return 1; }
  eack() { return this.vector; }

  memRead() { return 0xFF; }
  memWrite() { }

  ioRead(port, data, bcom) {
    if (!bcom) {
      if ((port & 0x0F) === 0x0F) data = 0x01;             // peripheral ID
      if (!(port & 0x08)) data = this.uart.read(port & 0x07);
    }
    return data;
  }

  ioWrite(port, val, bcom) {
    if (!bcom) {
      if ((port & 0x0F) === 0x0F) this.vector = val;
      if (!(port & 0x08)) this.uart.write(port & 0x07, val);
    }
  }

  advance(cycles) { this.uart.advance(cycles); }

  // ---- host side ----------------------------------------------------------

  /** Bytes to hand to the Portfolio, as if sent down the cable. */
  receive(bytes) { this.uart.receiveAll(bytes); }

  peekLength() { return 0; }   // nothing buffered on the print side
}
