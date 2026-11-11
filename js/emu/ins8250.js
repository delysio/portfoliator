// National Semiconductor 8250 UART (the HPC-102 fits an 82C50A).
//
// Ported from MAME's src/devices/machine/ins8250.cpp - register layout,
// interrupt priorities and the IIR/LSR/MSR semantics all follow it. MAME
// simulates the shift registers bit by bit; this models whole characters
// instead, but paces them from the divisor latch so software that times the
// line still sees the right thing.
//
//   0  RBR (r) / THR (w)   or DLL when DLAB=1
//   1  IER                 or DLM when DLAB=1
//   2  IIR (r) / FCR (w)
//   3  LCR
//   4  MCR
//   5  LSR
//   6  MSR
//   7  SCR

export const UART_CLOCK = 1843200;

// LSR
const LSR_DR   = 0x01;   // data ready
const LSR_OE   = 0x02;   // overrun
const LSR_PE   = 0x04;
const LSR_FE   = 0x08;
const LSR_BI   = 0x10;
const LSR_THRE = 0x20;   // transmitter holding register empty
const LSR_TSRE = 0x40;   // transmitter shift register empty

// MCR
const MCR_DTR = 0x01;
const MCR_RTS = 0x02;
const MCR_OUT1 = 0x04;
const MCR_OUT2 = 0x08;
const MCR_LOOPBACK = 0x10;

// MSR
const MSR_CTS = 0x10;
const MSR_DSR = 0x20;
const MSR_RI  = 0x40;
const MSR_DCD = 0x80;

const LCR_DLAB = 0x80;

// Interrupt sources, in the priority order the chip resolves them.
const INT_RX_LINE_STATUS = 0x04;
const INT_RX_AVAILABLE   = 0x01;
const INT_THR_EMPTY      = 0x02;
const INT_MODEM_STATUS   = 0x08;

import { take, put } from './snapshot.js';

// The UART's own registers. `cpuClock` stays out: it is a wiring constant the
// constructor takes, not something the chip holds.
const STATE = ['rbr', 'thr', 'ier', 'iir', 'lcr', 'mcr', 'lsr', 'msr', 'scr', 'dl',
               'intPending', 'intLine', 'txActive', 'txTimer', 'rxActive', 'rxTimer',
               'txByte', 'cts', 'dsr', 'dcd', 'ri'];

export class INS8250 {
  /**
   * @param {number} cpuClock      host CPU clock, used to pace the line
   * @param {(byte:number)=>void} onTransmit  a character has left the chip
   * @param {(state:boolean)=>void} onInterrupt
   */
  constructor(cpuClock, onTransmit, onInterrupt) {
    this.cpuClock = cpuClock;
    this.onTransmit = onTransmit;
    this.onInterrupt = onInterrupt;
    this.rxQueue = [];
    this.reset();
  }

  reset() {
    this.rbr = 0; this.thr = 0;
    this.ier = 0; this.iir = 0x01;
    this.lcr = 0; this.mcr = 0;
    this.lsr = LSR_THRE | LSR_TSRE;
    this.msr = 0;
    this.scr = 0;
    this.dl = 0;

    this.intPending = 0;
    this.intLine = false;

    this.txActive = false;
    this.txTimer = 0;
    this.rxActive = false;
    this.rxTimer = 0;
    this.rxQueue.length = 0;

    // Host-side modem inputs. A null-modem cable with handshake tied high is
    // the friendliest default for the ROM's transfer software.
    this.cts = true; this.dsr = true; this.dcd = true; this.ri = false;

    this.updateMSR();
    this.msr &= 0xF0;
    this.updateInterrupt();
  }

  /**
   * A byte halfway down the wire is part of the state, not an artefact: the
   * transmit timer and `txByte` together are what makes a restored machine
   * finish sending the character it was in the middle of, instead of dropping
   * it and leaving the other end waiting for a byte that never arrives.
   */
  snapshot() {
    return { ...take(this, STATE), rxQueue: this.rxQueue.slice() };
  }

  restore(s) {
    put(this, s, STATE);
    this.rxQueue = Array.from(s.rxQueue || []);
  }

  // ---- timing -------------------------------------------------------------

  get baud() {
    return this.dl > 0 ? UART_CLOCK / (16 * this.dl) : 0;
  }

  /** CPU cycles taken by one character on the wire, framing included. */
  charCycles() {
    if (this.dl <= 0) return 0;
    const dataBits = (this.lcr & 0x03) + 5;
    const parity = (this.lcr & 0x08) ? 1 : 0;
    const stop = (this.lcr & 0x04) ? 2 : 1;
    const bits = 1 + dataBits + parity + stop;
    return Math.max(1, Math.round((this.cpuClock * bits) / this.baud));
  }

  // ---- interrupts ---------------------------------------------------------

  triggerInt(flag) { this.intPending |= flag; this.updateInterrupt(); }
  clearInt(flag) { this.intPending &= ~flag; this.updateInterrupt(); }

  updateInterrupt() {
    const active = this.intPending & this.ier & 0x0F;
    let state;

    if (active) {
      state = true;
      this.iir &= ~0x0E;
      if (active & INT_RX_LINE_STATUS) this.iir |= 0x06;
      else if (active & INT_RX_AVAILABLE) this.iir |= 0x04;
      else if (active & INT_THR_EMPTY) this.iir |= 0x02;
      this.iir &= ~0x01;
    } else {
      state = false;
      this.iir |= 0x01;
      this.iir &= ~0x0E;
    }

    if (state !== this.intLine) {
      this.intLine = state;
      this.onInterrupt(state);
    }
  }

  updateMSR() {
    const prev = this.msr & 0xF0;
    let now;

    if (this.mcr & MCR_LOOPBACK) {
      // Loopback ties the outputs back to the status inputs.
      now = ((this.mcr & MCR_DTR) ? MSR_DSR : 0) |
            ((this.mcr & MCR_RTS) ? MSR_CTS : 0) |
            ((this.mcr & MCR_OUT1) ? MSR_RI : 0) |
            ((this.mcr & MCR_OUT2) ? MSR_DCD : 0);
    } else {
      now = (this.cts ? MSR_CTS : 0) | (this.dsr ? MSR_DSR : 0) |
            (this.ri ? MSR_RI : 0) | (this.dcd ? MSR_DCD : 0);
    }

    // Delta bits: 0 dCTS, 1 dDSR, 2 trailing-edge RI, 3 dDCD.
    let delta = 0;
    if ((prev ^ now) & MSR_CTS) delta |= 0x01;
    if ((prev ^ now) & MSR_DSR) delta |= 0x02;
    if ((prev & MSR_RI) && !(now & MSR_RI)) delta |= 0x04;
    if ((prev ^ now) & MSR_DCD) delta |= 0x08;

    this.msr = now | ((this.msr & 0x0F) | delta);
    if (this.msr & 0x0F) this.triggerInt(INT_MODEM_STATUS);
  }

  // ---- host side ----------------------------------------------------------

  /** Feed a byte in from the other end of the cable. */
  receive(byte) { this.rxQueue.push(byte & 0xFF); }

  receiveAll(bytes) { for (const b of bytes) this.rxQueue.push(b & 0xFF); }

  setModem({ cts, dsr, dcd, ri }) {
    if (cts !== undefined) this.cts = !!cts;
    if (dsr !== undefined) this.dsr = !!dsr;
    if (dcd !== undefined) this.dcd = !!dcd;
    if (ri !== undefined) this.ri = !!ri;
    this.updateMSR();
  }

  /** True while the software has asserted DTR+RTS, i.e. it wants to talk. */
  get ready() { return (this.mcr & (MCR_DTR | MCR_RTS)) !== 0; }

  // ---- bus interface ------------------------------------------------------

  read(reg) {
    switch (reg & 7) {
      case 0:
        if (this.lcr & LCR_DLAB) return this.dl & 0xFF;
        this.clearInt(INT_RX_AVAILABLE);
        this.lsr &= ~LSR_DR;
        return this.rbr;

      case 1:
        return (this.lcr & LCR_DLAB) ? ((this.dl >> 8) & 0xFF) : (this.ier & 0x0F);

      case 2: {
        const v = this.iir;
        // Reading IIR acknowledges a transmitter-empty interrupt.
        if ((v & 0x0F) === 0x02) this.clearInt(INT_THR_EMPTY);
        return v;
      }

      case 3: return this.lcr;
      case 4: return this.mcr;

      case 5: {
        const v = this.lsr;
        if (v & (LSR_BI | LSR_FE | LSR_PE | LSR_OE)) {
          this.lsr &= 0xE1;
          this.clearInt(INT_RX_LINE_STATUS);
        }
        return v;
      }

      case 6: {
        const v = this.msr;
        this.msr &= 0xF0;
        this.clearInt(INT_MODEM_STATUS);
        return v;
      }

      // The HPC-102 carries an 82C50A, whose scratch register works. MAME
      // instantiates a plain INS8250 (where it reads back 0xFF) but flags that
      // in a comment as wrong for this board.
      default: return this.scr;
    }
  }

  write(reg, data) {
    data &= 0xFF;

    switch (reg & 7) {
      case 0:
        if (this.lcr & LCR_DLAB) { this.dl = (this.dl & 0xFF00) | data; break; }
        this.thr = data;
        this.lsr &= ~LSR_THRE;
        this.clearInt(INT_THR_EMPTY);
        if (this.lsr & LSR_TSRE) this.startTransmit();
        break;

      case 1:
        if (this.lcr & LCR_DLAB) { this.dl = ((data << 8) | (this.dl & 0xFF)) & 0xFFFF; break; }
        // Enabling the transmit interrupt while the holding register is
        // already empty raises it straight away.
        if ((this.lsr & LSR_THRE) && (data & INT_THR_EMPTY)) this.triggerInt(INT_THR_EMPTY);
        this.ier = data;
        this.updateInterrupt();
        break;

      case 2: break;                 // FCR: no FIFO on an 8250

      case 3: this.lcr = data; break;

      case 4:
        if ((this.mcr & 0x1F) !== (data & 0x1F)) {
          this.mcr = data & 0x1F;
          this.updateMSR();
        }
        break;

      case 5: {
        this.lsr = (this.lsr & (LSR_TSRE | LSR_THRE)) | (data & ~(LSR_TSRE | LSR_THRE));
        let flags = 0;
        if (this.lsr & LSR_DR) flags |= INT_RX_AVAILABLE;
        if (this.lsr & 0x1E) flags |= INT_RX_LINE_STATUS;
        if (this.lsr & LSR_THRE) flags |= INT_THR_EMPTY;
        this.triggerInt(flags);
        break;
      }

      case 6:
        this.msr = (this.msr & 0xF0) | (data & 0x0F);
        if (this.msr & 0x0F) this.triggerInt(INT_MODEM_STATUS);
        else this.clearInt(INT_MODEM_STATUS);
        break;

      default: this.scr = data; break;
    }
  }

  // ---- line pacing --------------------------------------------------------

  startTransmit() {
    this.lsr |= LSR_THRE;
    this.lsr &= ~LSR_TSRE;
    this.txByte = this.thr;
    this.txActive = true;
    this.txTimer = this.charCycles();
    this.triggerInt(INT_THR_EMPTY);
  }

  advance(cycles) {
    const period = this.charCycles();
    if (period === 0) return;        // divisor not programmed yet

    if (this.txActive) {
      this.txTimer -= cycles;
      if (this.txTimer <= 0) {
        this.txActive = false;
        const byte = this.txByte;

        if (this.mcr & MCR_LOOPBACK) this.rxQueue.push(byte);
        else this.onTransmit(byte);

        // Another byte waiting in the holding register goes out next.
        if (!(this.lsr & LSR_THRE)) this.startTransmit();
        else this.lsr |= LSR_TSRE;
      }
    }

    if (!this.rxActive && this.rxQueue.length > 0) {
      this.rxActive = true;
      this.rxTimer = period;
    }

    if (this.rxActive) {
      this.rxTimer -= cycles;
      if (this.rxTimer <= 0) {
        this.rxActive = false;
        const byte = this.rxQueue.shift();

        if (this.lsr & LSR_DR) {
          this.lsr |= LSR_OE;
          this.triggerInt(INT_RX_LINE_STATUS);
        }
        this.rbr = byte;
        this.lsr |= LSR_DR;
        this.triggerInt(INT_RX_AVAILABLE);
      }
    }
  }
}
