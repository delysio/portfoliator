// Atari Portfolio HPC-104 memory expansion.
//
// The board does three things at once:
//
//   * adds a second memory card slot, which DIP-DOS mounts as drive B:
//   * adds 256 KB of its own battery-backed RAM, mapped straight into the
//     address hole above the on-board RAM
//   * carries a pass-through connector, so a printer or serial board can still
//     be stacked behind it - which is why this device chains rather than
//     replacing whatever else is attached
//
//   0x1F000-0x5EFFF  on-board RAM, unit 1 (the DIP switch position)
//   0x5F000-0x9EFFF  on-board RAM, unit 2
//   0x807C           write, bit 0: NCC1 out - enables the card slot
//
// One deliberate divergence from MAME's hpc104.cpp: that implementation leaves
// nmd1() at the interface default of 1, and with 1 the ROM never mounts B: at
// all. Measured against the real ROM here, asserting NMD1 is exactly what makes
// DIP-DOS offer a working drive B: - with a card it lists files, without one it
// reports a read error rather than the phantom "Insert disk for drive B:" that
// a bare machine gives. So this asserts it.

import { cardOffset, cardPageWrite } from './machine.js';

const RAM_SIZE = 0x40000;                 // 256 KB
const UNIT_BASE = { 1: 0x1F000, 2: 0x5F000 };

import { take, put, copyBytes, intoBytes, takeCard, putCard } from './snapshot.js';

const STATE = ['unit', 'base', 'ncc1Out', 'ramDirty'];

export class HPC104 {
  /**
   * @param {object}     [opts]
   * @param {1|2}        [opts.unit]  which address window the board answers on
   * @param {Uint8Array} [opts.ram]   restored contents of the on-board RAM
   */
  constructor(opts = {}) {
    this.unit = opts.unit === 2 ? 2 : 1;
    this.base = UNIT_BASE[this.unit];
    this.ram = opts.ram && opts.ram.length === RAM_SIZE ? opts.ram : new Uint8Array(RAM_SIZE);
    this.ramDirty = false;

    this.cardB = null;         // { data, writable, dirty }
    this.ncc1Out = false;
    this.next = null;          // board stacked behind this one
    this.onEint = () => {};
  }

  /**
   * A quarter of a megabyte of battery-backed RAM, the second card, and whatever
   * board is stacked behind - all of it travels, because all of it survives a
   * power cycle on the real hardware too.
   */
  snapshot() {
    return { ...take(this, STATE),
             ram: copyBytes(this.ram),
             cardB: takeCard(this.cardB),
             next: this.next ? this.next.snapshot() : null };
  }

  restore(s) {
    put(this, s, STATE);
    intoBytes(this.ram, s.ram);
    this.cardB = putCard(s.cardB);
    if (this.next && s.next) this.next.restore(s.next);
  }

  /** Stacks another expansion board behind this one, as the real connector does. */
  attachNext(device) {
    this.next = device;
    if (device) device.onEint = () => this.onEint();
  }

  reset() {
    this.ncc1Out = false;
    if (this.next) this.next.reset();
  }

  // ---- expansion bus interface -------------------------------------------

  // The board itself is not a "peripheral" the BIOS probes for; only something
  // stacked behind it can be.
  pdet() { return this.next ? this.next.pdet() : false; }

  // Active low, and this is the whole point of the board: asserted means the
  // BIOS lists a second drive.
  nmd1() { return 0; }

  eack() { return this.next ? this.next.eack() : 0xFF; }

  /** The C0000h window when the bus selector asks for the expansion card. */
  memRead(addr) {
    if (this.ncc1Out && this.cardB) {
      return this.cardB.data[cardOffset(this.cardB, addr)];
    }
    return this.next ? this.next.memRead(addr) : 0xFF;
  }

  memWrite(addr, val) {
    if (this.ncc1Out && this.cardB) {
      // A page selection is not storage, so it counts even on a read-only card.
      if (cardPageWrite(this.cardB, addr, val)) return;
      if (this.cardB.writable) {
        this.cardB.data[cardOffset(this.cardB, addr)] = val;
        this.cardB.dirty = true;
      }
      return;
    }
    if (this.next) this.next.memWrite(addr, val);
  }

  /**
   * The board's own RAM, which unlike the card sits at a fixed address rather
   * than in the banked window. Returns null when the address is not ours, so
   * the machine can fall back to reading the hole as zero.
   */
  busRead(addr) {
    const offset = addr - this.base;
    if (offset >= 0 && offset < RAM_SIZE) return this.ram[offset];
    return this.next && this.next.busRead ? this.next.busRead(addr) : null;
  }

  busWrite(addr, val) {
    const offset = addr - this.base;
    if (offset >= 0 && offset < RAM_SIZE) {
      this.ram[offset] = val;
      this.ramDirty = true;
      return true;
    }
    return this.next && this.next.busWrite ? this.next.busWrite(addr, val) : false;
  }

  ioRead(port, data, bcom) {
    return this.next ? this.next.ioRead(port, data, bcom) : data;
  }

  ioWrite(port, val, bcom) {
    if (!bcom && (port & 0x0F) === 0x0C) this.ncc1Out = !!(val & 0x01);
    if (this.next) this.next.ioWrite(port, val, bcom);
  }

  advance(cycles) {
    if (this.next && this.next.advance) this.next.advance(cycles);
  }

  // ---- host side ----------------------------------------------------------

  insertCard(data, writable) { this.cardB = { data, writable, dirty: false, page: 0 }; }
  ejectCard() { this.cardB = null; }

  // Forwarded so the printer buffer keeps working through the pass-through.
  peekLength() { return this.next && this.next.peekLength ? this.next.peekLength() : 0; }
  takeBuffer() {
    return this.next && this.next.takeBuffer ? this.next.takeBuffer() : new Uint8Array(0);
  }
}

export { RAM_SIZE as HPC104_RAM_SIZE };
