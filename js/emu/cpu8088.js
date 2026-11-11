// A cycle-accurate 8088, ported from MartyPC.
//
// MartyPC's 808x core (https://github.com/dbalsom/martypc, crates/lib/marty_core/src/cpu_808x)
// is Copyright 2022-2026 Daniel Balsom and released under the MIT licence:
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this
//   software and associated documentation files (the "Software"), to deal in the Software
//   without restriction, including without limitation the rights to use, copy, modify, merge,
//   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
//   to whom the Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
//   PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
//   FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// The structure follows MartyPC function for function, so that the two can be read side by
// side: one call to cycle() is one clock, the bus unit runs its T1-T4 state machine and the
// pipelined address cycle inside it, and every instruction is straight-line code that spends
// clocks where the microcode does. The microcode line numbers MartyPC passes along are only
// for its trace and do not change timing, so here they are gone and a run of them is a count.
//
// The interface is the one the rest of this emulator already uses: `new CPU8088(bus)` with
// read8/write8/in8/out8/intAck, `step()` returning the clocks it took, `cycles`, `regs`,
// `sregs`, `r8`, `ip`, `halted`, `intLine`, `nmiEdge`, `setIRQ`, `snapshot`/`restore`.

import { take, put, copyBytes, intoBytes } from './snapshot.js';
import { DECODE_SRC } from './cpu8088-decode.js';

export const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
export const ES = 0, CS = 1, SS = 2, DS = 3;
const SEG_NONE = 4;

// T-states of the bus cycle, and the states of the pipelined address cycle.
const TINIT = 0, TI = 1, T1 = 2, T2 = 3, T3 = 4, TW = 5, T4 = 6;
const TA_R = 0, TA_S = 1, TA_0 = 2, TA_D = 3, TA_A = 4;
// Bus status as the 8088 advertises it on S0-S2.
const BS_INTA = 0, BS_IOR = 1, BS_IOW = 2, BS_HALT = 3, BS_CODE = 4, BS_MEMR = 5, BS_MEMW = 6, BS_PASV = 7;
const FS_NORMAL = 0, FS_PAUSED = 1, FS_DELAYED = 2, FS_SUSP = 3, FS_HALTED = 4;
const BP_NONE = 0, BP_EARLY = 1, BP_LATE = 2;
const QO_IDLE = 0, QO_FIRST = 1, QO_FLUSH = 2, QO_SUBS = 3;

const QUEUE_SIZE = 4;
const QUEUE_POLICY_LEN = 3;

const F_CF = 0x0001, F_PF = 0x0004, F_AF = 0x0010, F_ZF = 0x0040, F_SF = 0x0080;
const F_TF = 0x0100, F_IF = 0x0200, F_DF = 0x0400, F_OF = 0x0800;
const FLAGS_RESERVED_ON = 0xF002;
const FLAGS_POP_MASK = 0x0FD5;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let b = i, n = 0;
  while (b) { n += b & 1; b >>= 1; }
  PARITY[i] = (n & 1) === 0 ? 1 : 0;
}

// Register8 order as the ModRM byte names it (AL CL DL BL AH CH DH BH), mapped onto the
// little-endian byte view of `regs`.
const R8_INDEX = [0, 2, 4, 6, 1, 3, 5, 7];
const REG8_NAMES = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'];
// Register16 numbering used by operands: the eight general registers, then ES CS SS DS.
const REG16_NAMES = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI', 'ES', 'CS', 'SS', 'DS'];
const SREG_FROM_FIELD = [8, 9, 10, 11, 8, 9, 10, 11];

// Operand templates (decode table) and resolved operand kinds (per instruction).
const OT = {
  NoOperand: 0, ModRM8: 1, ModRM16: 2, Register8: 3, Register16: 4, SegmentRegister: 5,
  Immediate8: 6, Immediate16: 7, Immediate8SignExtended: 8, Relative8: 9, Relative16: 10,
  Offset8: 11, Offset16: 12, FR8: 13, FR16: 14, FarAddress: 15,
};
const K_NONE = 0, K_REG8 = 1, K_REG16 = 2, K_IMM8 = 3, K_IMM16 = 4, K_IMM8S = 5, K_REL8 = 6,
  K_REL16 = 7, K_OFF8 = 8, K_OFF16 = 9, K_FAR = 10, K_ADDR = 11;

// ALU operations (MartyPC's Xi).
const XI = {
  ADD: 0, ADC: 1, OR: 2, SBB: 3, SUB: 4, CMP: 5, AND: 6, XOR: 7, ROL: 8, ROR: 9, RCL: 10,
  RCR: 11, SHL: 12, SHR: 13, SETMO: 14, SETMOC: 15, SAR: 16, PASS: 17, DAA: 18, DAS: 19,
  AAA: 20, AAS: 21, INC: 22, DEC: 23, NOT: 24, NEG: 25,
};

// GDR bits that matter here.
const GDR_NO_LOAD_EA = 0x0002, GDR_NO_MODRM = 0x0010, GDR_W_VALID = 0x0800, GDR_FORCE_BYTE = 0x1000;

const PREFIX_ES = 0x04, PREFIX_CS = 0x08, PREFIX_SS = 0x10, PREFIX_DS = 0x20, PREFIX_LOCK = 0x40,
  PREFIX_REP1 = 0x80, PREFIX_REP2 = 0x100;

const REP_NONE = 0, REP_REP = 1, REP_REPNE = 2, REP_REPE = 3, REP_MULDIV = 4;

function template(s) {
  if (s.startsWith('FR8:')) return [OT.FR8, REG8_NAMES.indexOf(s.slice(4))];
  if (s.startsWith('FR16:')) return [OT.FR16, REG16_NAMES.indexOf(s.slice(5))];
  if (!(s in OT)) throw new Error('operand template ' + s);
  return [OT[s], 0];
}

const DECODE = DECODE_SRC.map(([op, grp, gdr, fn, xi, mn, o1, o2]) => {
  const [t1, r1] = template(o1);
  const [t2, r2] = template(o2);
  return { op, grp, gdr, fn, xi: xi === null ? -1 : XI[xi], mn, t1, r1, t2, r2 };
});

// ModRM addressing: clocks spent before and after reading the displacement.
const PRE_DISP = [4, 5, 5, 4, 2, 2, 0, 2];
function eaCosts(mod, rm) {
  if (mod === 0) return rm === 6 ? [0, 1] : [PRE_DISP[rm], 0];
  const pre = rm === 6 ? 2 : PRE_DISP[rm];
  return [pre, mod === 1 ? 3 : 2];
}

const STRING_MN = new Set(['MOVSB', 'MOVSW', 'CMPSB', 'CMPSW', 'STOSB', 'STOSW', 'LODSB', 'LODSW',
  'SCASB', 'SCASW']);

// What a snapshot carries. Everything else is either derived or scratch.
const STATE = ['flags', 'pc', 'halted', 'intLine', 'nmiEdge', 'cycles',
  'tCycle', 'taCycle', 'busStatus', 'busStatusLatch', 'plStatus', 'plSlot', 'busSegment',
  'transferSize', 'operandSize', 'transferN', 'finalTransfer', 'fetchState', 'fetchDelay',
  'busPending', 'queueOp', 'lastQueueOp', 'queueByte', 'lastQueueByte', 'addressLatch', 'dataBus',
  'qLen', 'qBack', 'qFront', 'qPreload', 'eaOpr', 'lastEa', 'lock',
  'intrPending', 'interruptInhibit', 'trapEnableDelay', 'trapDisableDelay', 'trapSuppressed',
  'inRep', 'repInit', 'repType', 'haltNotHold', 'instructionReentrant',
  // The decoded instruction outlives a step while a REP is in flight.
  'iDecode', 'iOpcode', 'iPrefixes', 'iSize', 'iWidth', 'iMn', 'iXi', 'iSeg',
  'o1k', 'o1r', 'o2k', 'o2r', 'eaMod', 'eaRm', 'eaDisp', 'eaSize'];

export class CPU8088 {
  constructor(bus) {
    this.bus = bus;

    this.regs = new Uint16Array(8);
    this.r8 = new Uint8Array(this.regs.buffer);
    this.sregs = new Uint16Array(4);
    this.flags = FLAGS_RESERVED_ON;
    this.pc = 0;

    this.halted = false;
    this.intLine = false;   // level-triggered INTR from the ASIC
    this.nmiEdge = false;
    this.cycles = 0;        // total clocks since power-on

    // Bus unit.
    this.tCycle = TI;
    this.taCycle = TA_D;
    this.busStatus = BS_PASV;
    this.busStatusLatch = BS_PASV;
    this.plStatus = BS_PASV;
    this.plSlot = false;
    this.busSegment = CS;
    this.transferSize = 1;
    this.operandSize = 8;
    this.transferN = 0;
    this.finalTransfer = false;
    this.fetchState = FS_NORMAL;
    this.fetchDelay = 0;
    this.busPending = BP_NONE;
    this.queueOp = QO_IDLE;
    this.lastQueueOp = QO_IDLE;
    this.queueByte = 0;
    this.lastQueueByte = 0;
    this.addressLatch = 0;
    this.dataBus = 0;
    this.lock = false;

    // Instruction queue: a ring of four, plus the byte already taken for the next instruction.
    this.q = new Uint8Array(QUEUE_SIZE);
    this.qLen = 0;
    this.qBack = 0;
    this.qFront = 0;
    this.qPreload = -1;

    this.eaOpr = 0;
    this.lastEa = 0;

    this.intrPending = false;
    this.interruptInhibit = false;
    this.trapEnableDelay = 0;
    this.trapDisableDelay = 0;
    this.trapSuppressed = false;
    this.inRep = false;
    this.repInit = false;
    this.repType = REP_NONE;
    this.haltNotHold = false;
    this.instructionReentrant = false;
    this.jumped = false;

    // The decoded instruction.
    this.iDecode = 0;
    this.iOpcode = 0;
    this.iPrefixes = 0;
    this.iSize = 0;
    this.iWidth = 1;
    this.iMn = 'NOP';
    this.iXi = -1;
    this.iSeg = -1;
    this.o1k = K_NONE; this.o1r = 0;
    this.o2k = K_NONE; this.o2r = 0;
    this.eaMod = 0; this.eaRm = 0; this.eaDisp = 0; this.eaSize = 8;

    // Results of the ALU primitives, kept here so the hot path allocates nothing.
    this.rc = false; this.ro = false; this.ra = false;
    // Second results of routines that return two or more values (multiply, divide, far
    // pointers, operand resolution). All declared here, so that the object keeps one shape:
    // a field first assigned in the middle of a run makes every access to every field slower.
    this.eaSeg = DS; this.farSeg = 0; this.modrmLen = 0;
    this.resolvedReg = 0; this.resolvedSize = 0;
    this.rTmpa = 0; this.rTmpc = 0; this.rCarry = false; this.rDx = 0; this.rQ = 0; this.rR = 0;
    this.nTmpa = 0; this.nTmpb = 0; this.nTmpc = 0; this.nCarry = false; this.nNeg = false;
    this.pTmpa = 0;

    // Per-clock trace for validation against SingleStepTests: off unless asked for.
    this.trace = null;

    this.reset();
  }

  // ---- state ------------------------------------------------------------------------

  snapshot() {
    return { ...take(this, STATE),
             regs: copyBytes(this.regs, Uint16Array),
             sregs: copyBytes(this.sregs, Uint16Array),
             q: copyBytes(this.q, Uint8Array) };
  }

  restore(s) {
    if (!('tCycle' in s)) { this.restoreLegacy(s); return; }
    put(this, s, STATE);
    intoBytes(this.regs, s.regs);
    intoBytes(this.sregs, s.sregs);
    if (s.q) intoBytes(this.q, s.q);
  }

  /**
   * A snapshot from the earlier rule-based core, which kept the flags one by one and the queue as
   * arrival times. The architectural state carries over; the bus unit starts idle with an
   * empty queue at the saved IP, which costs the first few instructions a refetch and
   * nothing else.
   */
  restoreLegacy(s) {
    intoBytes(this.regs, s.regs);
    intoBytes(this.sregs, s.sregs);
    let f = FLAGS_RESERVED_ON;
    const bits = [['cf', F_CF], ['pf', F_PF], ['af', F_AF], ['zf', F_ZF], ['sf', F_SF],
      ['tf', F_TF], ['iff', F_IF], ['df', F_DF], ['of', F_OF]];
    for (const [k, m] of bits) if (s[k]) f |= m;
    this.flags = f;
    this.halted = !!s.halted;
    this.intLine = !!s.intLine;
    this.nmiEdge = !!s.nmiEdge;
    this.interruptInhibit = !!s.inhibitInt;
    if (typeof s.cycles === 'number') this.cycles = s.cycles;
    this.trapEnableDelay = 0; this.trapDisableDelay = 0;
    this.intrPending = false;
    this.ip = s.ip;
  }

  /** Reset as the 8088 does it: CS:IP = FFFF:0000, flags clear, queue flushed. */
  reset(vectorCs = 0xFFFF, vectorIp = 0x0000, queue = null) {
    this.regs.fill(0);
    this.sregs[ES] = 0; this.sregs[SS] = 0; this.sregs[DS] = 0;
    this.sregs[CS] = vectorCs;
    this.pc = vectorIp;
    this.flags = FLAGS_RESERVED_ON;
    this.qFlush();
    this.addressLatch = 0;
    this.busStatus = BS_PASV;
    this.busStatusLatch = BS_PASV;
    this.tCycle = TI;
    this.taCycle = TA_D;
    this.plStatus = BS_PASV;
    this.plSlot = false;
    this.fetchState = FS_NORMAL;
    this.busPending = BP_NONE;
    this.inRep = false;
    this.repInit = false;
    this.halted = false;
    this.haltNotHold = false;
    this.interruptInhibit = false;
    this.intrPending = false;
    this.instructionReentrant = false;
    this.jumped = false;
    this.queueOp = QO_IDLE;
    this.lastQueueOp = QO_IDLE;
    this.intLine = false;
    this.nmiEdge = false;
    this.lock = false;

    // Reset takes six clocks before the first fetch.
    this.cycle();
    this.biuFetchSuspend();
    this.cycle(); this.cycle();
    if (queue) this.setQueueContents(queue);
    else this.biuQueueFlush();
    this.cycle(); this.cycle(); this.cycle();
  }

  /** Loads the queue with bytes already fetched - SingleStepTests' prefetched cases. */
  setQueueContents(bytes) {
    this.pc = (this.pc - this.qLen) & 0xFFFF;
    this.qFlush();
    for (let i = 0; i < bytes.length && i < QUEUE_SIZE; i++) {
      this.qPush(bytes[i]);
      this.pc = (this.pc + 1) & 0xFFFF;
    }
  }

  /**
   * IP as software sees it: PC less whatever the queue already holds. While a repeated
   * string instruction is between two iterations it is the instruction's own first byte,
   * prefixes included - where an interrupt would return to, and what a debugger shows.
   */
  get ip() {
    let v = this.pc - this.qLen - (this.qPreload >= 0 ? 1 : 0);
    if (this.inRep) v -= this.iSize;
    return v & 0xFFFF;
  }

  /** Length in bytes of the last instruction decoded, prefixes included. */
  get fetched() { return this.iSize; }

  /**
   * Moves execution elsewhere from outside (a debugger, a test rig). The queue is thrown
   * away and the bus unit starts over from idle, the way it stands just after a reset.
   */
  set ip(v) {
    this.pc = v & 0xFFFF;
    this.qFlush();
    this.tCycle = TI;
    this.taCycle = TA_D;
    this.busStatus = BS_PASV;
    this.busStatusLatch = BS_PASV;
    this.plStatus = BS_PASV;
    this.busPending = BP_NONE;
    this.fetchState = FS_NORMAL;
    this.inRep = false;
    this.repInit = false;
    this.biuFetchStart();
  }

  getFlags() { return this.flags; }
  setFlags(v) { this.flags = (v & ~0x0028) | FLAGS_RESERVED_ON; }

  // The flags one at a time, as 0/1, for code written against the previous core.
  get cf() { return this.flags & F_CF ? 1 : 0; } set cf(v) { this.flagBit(F_CF, v); }
  get pf() { return this.flags & F_PF ? 1 : 0; } set pf(v) { this.flagBit(F_PF, v); }
  get af() { return this.flags & F_AF ? 1 : 0; } set af(v) { this.flagBit(F_AF, v); }
  get zf() { return this.flags & F_ZF ? 1 : 0; } set zf(v) { this.flagBit(F_ZF, v); }
  get sf() { return this.flags & F_SF ? 1 : 0; } set sf(v) { this.flagBit(F_SF, v); }
  get tf() { return this.flags & F_TF ? 1 : 0; } set tf(v) { this.flagBit(F_TF, v); }
  get iff() { return this.flags & F_IF ? 1 : 0; } set iff(v) { this.flagBit(F_IF, v); }
  get df() { return this.flags & F_DF ? 1 : 0; } set df(v) { this.flagBit(F_DF, v); }
  get of() { return this.flags & F_OF ? 1 : 0; } set of(v) { this.flagBit(F_OF, v); }
  flagBit(m, v) { if (v) this.flags |= m; else this.flags &= ~m; }

  setIRQ(state) { this.intLine = !!state; }
  pulseNMI() { this.nmiEdge = true; }

  state() {
    return {
      ax: this.regs[AX], cx: this.regs[CX], dx: this.regs[DX], bx: this.regs[BX],
      sp: this.regs[SP], bp: this.regs[BP], si: this.regs[SI], di: this.regs[DI],
      es: this.sregs[ES], cs: this.sregs[CS], ss: this.sregs[SS], ds: this.sregs[DS],
      ip: this.ip, flags: this.flags, halted: this.halted,
    };
  }

  // ---- flags and registers ----------------------------------------------------------

  getFlag(m) { return (this.flags & m) !== 0; }
  setFlag(m) {
    if (m === F_IF && (this.flags & F_IF) === 0) this.interruptInhibit = true;
    this.flags |= m;
  }
  clearFlag(m) { this.flags &= ~m; }
  setFlagState(m, b) { if (b) this.setFlag(m); else this.clearFlag(m); }

  setSZP8(r) {
    this.setFlagState(F_SF, (r & 0x80) !== 0);
    this.setFlagState(F_ZF, (r & 0xFF) === 0);
    this.setFlagState(F_PF, PARITY[r & 0xFF] === 1);
  }
  setSZP16(r) {
    this.setFlagState(F_SF, (r & 0x8000) !== 0);
    this.setFlagState(F_ZF, (r & 0xFFFF) === 0);
    this.setFlagState(F_PF, PARITY[r & 0xFF] === 1);
  }
  setSZP(r) {
    this.setFlagState(F_SF, (r & (this.iWidth ? 0x8000 : 0x80)) !== 0);
    this.setFlagState(F_ZF, r === 0);
    this.setFlagState(F_PF, PARITY[r & 0xFF] === 1);
  }

  getReg8(n) { return this.r8[R8_INDEX[n]]; }
  setReg8(n, v) { this.r8[R8_INDEX[n]] = v; }
  getReg16(n) { return n < 8 ? this.regs[n] : this.sregs[n - 8]; }
  setReg16(n, v) { if (n < 8) this.regs[n] = v; else this.sregs[n - 8] = v; }
  setRegA(v) { if (this.iWidth) this.regs[AX] = v; else this.r8[0] = v; }

  linear(seg, off) {
    const base = seg === SEG_NONE ? 0 : this.sregs[seg];
    return ((base << 4) + (off & 0xFFFF)) & 0xFFFFF;
  }

  // ---- the queue ------------------------------------------------------------------------

  qFlush() { this.qLen = 0; this.qBack = 0; this.qFront = 0; this.qPreload = -1; }
  qPush(b) {
    if (this.qLen >= QUEUE_SIZE) throw new Error('queue overrun');
    this.q[this.qFront] = b;
    this.qFront = (this.qFront + 1) % QUEUE_SIZE;
    this.qLen++;
  }
  qPop() {
    if (this.qLen === 0) throw new Error('queue underrun');
    const b = this.q[this.qBack];
    this.qBack = (this.qBack + 1) % QUEUE_SIZE;
    this.qLen--;
    return b;
  }
  qRoom() { return this.qLen <= QUEUE_SIZE - 1; }
  qAtPolicy() { return this.qLen === QUEUE_POLICY_LEN; }

  // ---- one clock ------------------------------------------------------------------------

  /**
   * One clock. The bus unit acts on the T-state it is in - a fetch decision at the end of
   * T2 and T4, the transfer itself on T3 - and then moves the address cycle and the bus
   * cycle on to their next states.
   */
  cycle() {
    if (this.tCycle === TINIT) this.tCycle = T1;

    if (this.busStatusLatch === BS_PASV) {
      this.transferN = 0;
      if (this.fetchState === FS_DELAYED) {
        if (this.fetchDelay === 0) {
          this.fetchState = FS_NORMAL;
          this.biuMakeFetchDecision();
        }
      } else if (this.fetchState === FS_PAUSED) {
        if (this.qRoom()) this.biuMakeFetchDecision();
      }
    } else if (this.busStatusLatch !== BS_HALT) {
      switch (this.tCycle) {
        case TI:
          this.biuMakeFetchDecision();
          break;
        case T2:
          if (this.finalTransfer) this.biuMakeFetchDecision();
          break;
        case T3:
        case TW:
          this.biuDoBusTransfer();
          break;
        case T4:
          if (this.busStatusLatch === BS_CODE) {
            this.qPush(this.dataBus & 0xFF);
            this.pc = (this.pc + 1) & 0xFFFF;
          }
          if (this.finalTransfer) this.biuMakeFetchDecision();
          break;
      }
    }

    if (this.trace) this.traceCycle();

    if (this.fetchState === FS_DELAYED && this.tCycle !== TW && this.fetchDelay > 0) this.fetchDelay--;

    // The address cycle.
    switch (this.taCycle) {
      case TA_R: this.taCycle = TA_S; break;
      case TA_S: this.taCycle = TA_0; break;
      case TA_0: {
        const idleOrT4 = this.tCycle === TI || this.tCycle === T4;
        if (this.plStatus === BS_CODE && this.busPending === BP_NONE) {
          if (idleOrT4 && this.fetchState !== FS_SUSP && this.fetchState !== FS_HALTED) {
            this.biuBusBeginFetch();
            this.taCycle = TA_D;
          }
        } else if (this.plStatus === BS_CODE && this.busPending === BP_LATE) {
          if (idleOrT4) this.taCycle = TA_A;     // the fetch is aborted
        } else if (idleOrT4) {
          this.tCycle = TINIT;
          this.taCycle = TA_D;
        }
        break;
      }
    }

    // The bus cycle.
    switch (this.tCycle) {
      case TINIT: this.tCycle = T1; break;
      case TI:
        if (this.busStatusLatch === BS_HALT) {
          this.busStatus = BS_PASV; this.busStatusLatch = BS_PASV;
        } else if (this.busStatusLatch !== BS_PASV) {
          this.tCycle = T1;
        }
        break;
      case T1:
        if (this.busStatusLatch === BS_HALT) {
          this.busStatus = BS_PASV; this.busStatusLatch = BS_PASV;
          this.tCycle = TI;
        } else if (this.busStatusLatch !== BS_PASV) {
          this.tCycle = T2;
        }
        break;
      case T2: this.tCycle = T3; break;
      case T3:
      case TW: this.tCycle = T4; break;     // no wait states on this machine
      case T4:
        this.busStatusLatch = BS_PASV;
        this.tCycle = TI;
        break;
    }

    this.lastQueueOp = this.queueOp;
    this.lastQueueByte = this.queueByte;
    this.queueOp = QO_IDLE;
    this.cycles++;
  }

  cyclesN(n) { for (let i = 0; i < n; i++) this.cycle(); }

  /** The clock as SingleStepTests records it: T-state, bus status, queue status. */
  traceCycle() {
    const t = this.tCycle, latch = this.busStatusLatch;
    const name = ['INTA', 'IOR', 'IOW', 'HALT', 'CODE', 'MEMR', 'MEMW', 'PASV'][latch];
    let tName, bs = 'PASV';
    if (t === T1) {
      if (latch === BS_PASV) tName = 'Ti';
      else { tName = 'T1'; bs = name; }
    } else if (t === T2) {
      tName = 'T2'; bs = name;
    } else {
      tName = t === T3 ? 'T3' : t === TW ? 'Tw' : t === T4 ? 'T4' : 'Ti';
    }
    const qo = ['-', 'F', 'E', 'S'][this.lastQueueOp];
    this.trace.push([tName, bs, qo]);
  }

  // ---- the bus unit -------------------------------------------------------------------

  biuQueueRead(first) {
    if (this.fetchState === FS_DELAYED && this.qAtPolicy()) this.fetchDelay = 0;
    if (this.qPreload >= 0) {
      const b = this.qPreload;
      this.qPreload = -1;
      this.lastQueueOp = QO_FIRST;
      this.lastQueueByte = b;
      this.biuFetchOnQueueRead();
      return b;
    }
    let b;
    if (this.qLen > 0) {
      b = this.qPop();
      this.biuFetchOnQueueRead();
    } else {
      while (this.qLen === 0) this.cycle();
      b = this.qPop();
    }
    this.queueByte = b;
    this.queueOp = first ? QO_FIRST : QO_SUBS;
    this.cycle();
    return b;
  }

  qRead8() { return this.biuQueueRead(false); }
  qRead16() { const lo = this.biuQueueRead(false); return lo | (this.biuQueueRead(false) << 8); }

  biuFetchOnQueueRead() {
    if (this.busStatus === BS_PASV && this.qRoom()) {
      if (this.fetchState === FS_SUSP) {
        this.taCycle = TA_D;
      } else if (this.fetchState === FS_PAUSED) {
        if (this.tCycle === TI) this.taCycle = TA_D;
        else return;
      }
      this.biuFetchStart();
    }
  }

  /** Waits for the first byte of the next instruction and takes it - the RNI. */
  biuFetchNext() {
    if (this.inRep) return;
    if (this.qLen === 0) {
      let guard = 0;
      do {
        this.cycle();
        if (++guard > 64) throw new Error('fetch timeout');
      } while (this.qLen === 0);
    }
    this.qPreload = this.qPop();
    this.queueOp = QO_FIRST;
    this.biuFetchOnQueueRead();
    this.cycle();
  }

  biuFetchSuspend() {
    this.fetchState = FS_SUSP;
    if (this.busStatusLatch === BS_CODE) this.biuBusWaitFinish();
    this.taCycle = TA_D;
    this.plStatus = BS_PASV;
  }

  biuQueueFlush() {
    this.qFlush();
    this.queueOp = QO_FLUSH;
    this.fetchState = FS_NORMAL;
    this.biuFetchStart();
  }

  biuMakeFetchDecision() {
    if (!this.qRoom()) {
      this.fetchState = FS_PAUSED;
    } else if (this.busPending !== BP_EARLY) {
      if (this.fetchState !== FS_SUSP && this.fetchState !== FS_HALTED) {
        if (this.qAtPolicy() && this.busStatusLatch === BS_CODE) {
          if (this.taCycle === TA_D) {
            if (this.fetchState === FS_DELAYED) {
              if (this.fetchDelay === 0) this.fetchDelay = 3;
            } else {
              this.fetchState = FS_DELAYED;
              this.fetchDelay = 3;
            }
          }
        } else if (this.taCycle === TA_D) {
          this.biuFetchStart();
        }
      }
    }
  }

  biuHalt() {
    this.fetchState = FS_HALTED;
    this.biuBusWaitFinish();
    if (this.tCycle === T4) this.cycle();
    this.tCycle = TI;
    this.cycle();
    this.busStatus = BS_HALT;
    this.busStatusLatch = BS_HALT;
    this.busSegment = CS;
    this.tCycle = T1;
    this.dataBus = 0;
    this.transferSize = 1;
    this.operandSize = 8;
    this.transferN = 1;
    this.finalTransfer = true;
    this.cycle();
  }

  biuInta() {
    this.biuBusBegin(BS_INTA, SEG_NONE, 0, 0, 16, true);
    this.biuBusWaitFinish();
    this.biuBusBegin(BS_INTA, SEG_NONE, 0, 0, 16, false);
    this.biuBusWaitFinish();
  }

  biuRead8(seg, off) {
    this.biuBusBegin(BS_MEMR, seg, this.linear(seg, off), 0, 8, true);
    this.biuBusWaitFinish();
    return this.dataBus & 0xFF;
  }

  biuWrite8(seg, off, v) {
    this.biuBusBegin(BS_MEMW, seg, this.linear(seg, off), v & 0xFF, 8, true);
    this.biuBusWaitUntilTx();
  }

  biuRead16(seg, off) {
    this.biuBusBegin(BS_MEMR, seg, this.linear(seg, off), 0, 16, true);
    this.biuBusWaitFinish();
    let w = this.dataBus & 0xFF;
    this.biuBusBegin(BS_MEMR, seg, this.linear(seg, (off + 1) & 0xFFFF), 0, 16, false);
    this.biuBusWaitFinish();
    return w | ((this.dataBus & 0xFF) << 8);
  }

  biuWrite16(seg, off, v) {
    this.biuBusBegin(BS_MEMW, seg, this.linear(seg, off), v & 0xFF, 16, true);
    this.biuBusWaitFinish();
    this.biuBusBegin(BS_MEMW, seg, this.linear(seg, (off + 1) & 0xFFFF), (v >> 8) & 0xFF, 16, false);
    this.biuBusWaitUntilTx();
  }

  biuIoRead8(port) {
    this.biuBusBegin(BS_IOR, SEG_NONE, port & 0xFFFF, 0, 8, true);
    this.biuBusWaitFinish();
    return this.dataBus & 0xFF;
  }

  biuIoWrite8(port, v) {
    this.biuBusBegin(BS_IOW, SEG_NONE, port & 0xFFFF, v & 0xFF, 8, true);
    this.biuBusWaitUntilTx();
  }

  biuIoRead16(port) {
    this.biuBusBegin(BS_IOR, SEG_NONE, port & 0xFFFF, 0, 16, true);
    this.biuBusWaitFinish();
    let w = this.dataBus & 0xFF;
    this.biuBusBegin(BS_IOR, SEG_NONE, (port + 1) & 0xFFFF, 0, 16, false);
    this.biuBusWaitFinish();
    return w | ((this.dataBus & 0xFF) << 8);
  }

  biuIoWrite16(port, v) {
    this.biuBusBegin(BS_IOW, SEG_NONE, port & 0xFFFF, v & 0xFF, 16, true);
    this.biuBusWaitFinish();
    this.biuBusBegin(BS_IOW, SEG_NONE, (port + 1) & 0xFFFF, (v >> 8) & 0xFF, 16, false);
    this.biuBusWaitUntilTx();
  }

  biuBusWaitFinish() {
    if (this.busStatusLatch !== BS_PASV) {
      while (this.tCycle !== T4) this.cycle();
    }
  }

  biuBusWaitDelay() {
    if (this.fetchState !== FS_DELAYED) return false;
    if (this.fetchDelay === 0) {
      this.taCycle = TA_D;
    } else {
      this.cyclesN(this.fetchDelay);
      this.taCycle = TA_A;
    }
    return true;
  }

  biuBusWaitAddress() {
    while (this.taCycle !== TA_D && this.taCycle !== TA_A) this.cycle();
  }

  biuBusWaitHalt() {
    if (this.busStatusLatch === BS_PASV && this.tCycle === T1) this.cycle();
  }

  /** Waits for the transfer clock of a write, so the next instruction overlaps T4. */
  biuBusWaitUntilTx() {
    const s = this.busStatusLatch;
    if (s === BS_MEMR || s === BS_MEMW || s === BS_IOR || s === BS_IOW || s === BS_CODE) {
      while (this.tCycle !== T3 && this.tCycle !== TW) this.cycle();
    }
  }

  /**
   * Starts a bus cycle for the execution unit: waits out the cycle in progress, any fetch
   * delay and the address cycle, and pays the abort penalty when it lands on a fetch that
   * was already scheduled.
   */
  biuBusBegin(status, seg, address, data, opSize, first) {
    let fetchAbort = false;
    switch (this.tCycle) {
      case TI:
        this.biuAddressStart(status);
        break;
      case T1:
      case T2:
        this.busPending = BP_EARLY;
        this.biuAddressStart(status);
        break;
      default:
        if (this.plStatus === BS_CODE) {
          this.busPending = BP_LATE;
          fetchAbort = true;
        } else if (!this.finalTransfer) {
          this.busPending = BP_EARLY;
        }
    }

    this.biuBusWaitFinish();
    const wasDelay = this.biuBusWaitDelay();
    this.biuBusWaitAddress();
    if (wasDelay || fetchAbort) {
      this.biuAddressStart(status);
      this.biuBusWaitAddress();
    }
    if (this.tCycle === T4 && this.busStatusLatch !== BS_CODE) this.cycle();

    if (first) {
      this.transferN = 1;
      this.finalTransfer = opSize === 8;
    } else {
      this.transferN = 2;
      this.finalTransfer = true;
    }

    this.busPending = BP_NONE;
    this.plStatus = BS_PASV;
    this.busStatus = status;
    this.busStatusLatch = status;
    this.busSegment = seg;
    this.tCycle = TINIT;
    this.addressLatch = address;
    this.dataBus = data;
    this.transferSize = 1;
    this.operandSize = opSize;
  }

  biuFetchStart() {
    if (this.busPending !== BP_EARLY && this.plStatus !== BS_CODE) {
      if (this.fetchState !== FS_DELAYED) {
        this.fetchState = FS_NORMAL;
        this.biuAddressStart(BS_CODE);
      }
    }
  }

  biuAddressStart(status) {
    if (this.tCycle !== TI) {
      if (this.taCycle !== TA_A) this.plSlot = !this.plSlot;
    } else {
      this.plSlot = false;
    }
    this.taCycle = this.taCycle === TA_A ? TA_S : TA_R;
    this.plStatus = status;
  }

  biuBusBeginFetch() {
    if (this.qRoom()) {
      this.operandSize = 8;
      this.fetchState = FS_NORMAL;
      this.plStatus = BS_PASV;
      this.busStatus = BS_CODE;
      this.busStatusLatch = BS_CODE;
      this.busSegment = CS;
      this.tCycle = TINIT;
      this.addressLatch = this.linear(CS, this.pc);
      this.dataBus = 0;
      this.transferSize = 1;
      this.transferN = 1;
      this.finalTransfer = true;
    }
  }

  biuDoBusTransfer() {
    const a = this.addressLatch;
    switch (this.busStatusLatch) {
      case BS_CODE: this.dataBus = this.bus.read8(a); break;
      case BS_MEMR: this.dataBus = this.bus.read8(a); break;
      case BS_MEMW: this.bus.write8(a, this.dataBus & 0xFF); break;
      case BS_IOR: this.dataBus = this.bus.in8(a & 0xFFFF) & 0xFF; break;
      case BS_IOW: this.bus.out8(a & 0xFFFF, this.dataBus & 0xFF); break;
      case BS_INTA:
        if (this.transferN === 2) this.lock = false;
        break;
    }
    this.busStatus = BS_PASV;
  }

  /** CORR: points PC back at the next instruction, ahead of a jump. Two clocks. */
  corr() {
    this.pc = (this.pc - this.qLen) & 0xFFFF;
    this.cycle();
  }

  // ---- stepping -----------------------------------------------------------------------

  /** Runs one instruction - or one iteration of a repeated string instruction. */
  step() {
    const c0 = this.cycles;
    this.stepBody();
    this.stepFinish();
    return this.cycles - c0;
  }

  /** The instruction itself, without what follows it - MartyPC's step(). */
  stepBody() {
    if (this.halted) {
      this.cycle();
      return;
    }
    if (!this.inRep) this.decode();
    this.loadOperand();
    this.executeInstruction();
    this.intrPending = false;
  }

  /** What follows an instruction: an interrupt, a trap, or the first byte of the next one. */
  stepFinish() {
    if (this.nmiEdge) {
      this.nmiEdge = false;
      if (this.halted) this.resume();
      this.int2();
    } else if (this.intLine && this.interruptsEnabled()) {
      if (this.inRep) {
        this.intrPending = true;
      } else {
        if (this.halted) this.resume();
        const vector = this.bus.intAck() & 0xFF;
        this.hwInterrupt(vector);
        this.biuFetchNext();
      }
    } else if (this.trapEnabled()) {
      if (this.halted) this.resume();
      this.int1();
    } else if (!this.halted) {
      this.biuFetchNext();
    }
  }

  resume() {
    if (this.halted) this.cyclesN(4);
    this.halted = false;
    this.haltNotHold = false;
  }

  interruptsEnabled() { return (this.flags & F_IF) !== 0 && !this.interruptInhibit; }
  trapEnabled() {
    return ((this.flags & F_TF) !== 0 || this.trapDisableDelay !== 0)
      && !this.trapSuppressed && this.trapEnableDelay === 0;
  }

  // ---- decoding -----------------------------------------------------------------------

  decode() {
    let opcode = this.biuQueueRead(true);
    let size = 1, prefixes = 0, seg = -1;
    for (;;) {
      let p = 0;
      switch (opcode) {
        case 0x26: p = PREFIX_ES; seg = ES; break;
        case 0x2E: p = PREFIX_CS; seg = CS; break;
        case 0x36: p = PREFIX_SS; seg = SS; break;
        case 0x3E: p = PREFIX_DS; seg = DS; break;
        case 0xF0: case 0xF1: p = PREFIX_LOCK; break;
        case 0xF2: p = PREFIX_REP1; break;
        case 0xF3: p = PREFIX_REP2; break;
      }
      if (!p) break;
      prefixes |= p;
      this.cycle();                               // a prefix takes two clocks
      opcode = this.biuQueueRead(true);
      size++;
    }

    let idx = opcode;
    let d = DECODE[idx];
    let modrm = -1;
    if (d.grp !== 0) {
      modrm = this.readModRm();
      size += this.modrmLen;
      idx = 256 + (d.grp - 1) * 8 + ((modrm >> 3) & 7);
      d = DECODE[idx];
    }
    if ((d.gdr & GDR_NO_MODRM) === 0 && modrm < 0) {
      modrm = this.readModRm();
      size += this.modrmLen;
    }

    this.iDecode = idx;
    this.iOpcode = opcode;
    this.iPrefixes = prefixes;
    this.iSeg = seg;
    this.iMn = d.mn;
    this.iXi = d.xi;
    this.iWidth = ((d.gdr & GDR_W_VALID) && (opcode & 1) === 0) || (d.gdr & GDR_FORCE_BYTE)
      || (opcode >= 0xB0 && opcode <= 0xB7) ? 0 : 1;
    this.o1k = this.resolve(d.t1, d.r1, modrm);
    this.o1r = this.resolvedReg;
    size += this.resolvedSize;
    this.o2k = this.resolve(d.t2, d.r2, modrm);
    this.o2r = this.resolvedReg;
    size += this.resolvedSize;
    this.iSize = size;
  }

  /** Reads the ModRM byte and any displacement, spending the EA clocks around them. */
  readModRm() {
    const b = this.biuQueueRead(false);
    const mod = b >> 6, rm = b & 7;
    this.eaMod = mod; this.eaRm = rm; this.eaDisp = 0;
    this.modrmLen = 1;
    if (mod !== 3) {
      const [pre, post] = eaCosts(mod, rm);
      this.cycle();
      this.cyclesN(pre);
      if (mod === 1) {
        const v = this.biuQueueRead(false);
        this.eaDisp = (v & 0x80 ? v | 0xFF00 : v);
        this.modrmLen += 1;
      } else if (mod === 2 || (mod === 0 && rm === 6)) {
        this.eaDisp = this.qRead16();
        this.modrmLen += 2;
      }
      this.cyclesN(post);
    }
    return b;
  }

  resolve(t, r, modrm) {
    this.resolvedReg = 0;
    this.resolvedSize = 0;
    switch (t) {
      case OT.ModRM8:
        if ((modrm >> 6) === 3) { this.resolvedReg = modrm & 7; return K_REG8; }
        this.eaSize = 8;
        return K_ADDR;
      case OT.ModRM16:
        if ((modrm >> 6) === 3) { this.resolvedReg = modrm & 7; return K_REG16; }
        this.eaSize = 16;
        return K_ADDR;
      case OT.Register8: this.resolvedReg = (modrm >> 3) & 7; return K_REG8;
      case OT.Register16: this.resolvedReg = (modrm >> 3) & 7; return K_REG16;
      case OT.SegmentRegister: this.resolvedReg = SREG_FROM_FIELD[(modrm >> 3) & 7]; return K_REG16;
      case OT.Immediate8: this.resolvedSize = 1; return K_IMM8;
      case OT.Immediate16: this.resolvedSize = 2; return K_IMM16;
      case OT.Immediate8SignExtended: this.resolvedSize = 1; return K_IMM8S;
      case OT.Relative8: this.resolvedSize = 1; return K_REL8;
      case OT.Relative16: this.resolvedSize = 2; return K_REL16;
      case OT.Offset8: this.resolvedSize = 2; return K_OFF8;
      case OT.Offset16: this.resolvedSize = 2; return K_OFF16;
      case OT.FR8: this.resolvedReg = r; return K_REG8;
      case OT.FR16: this.resolvedReg = r; return K_REG16;
      case OT.FarAddress: this.resolvedSize = 4; return K_FAR;
      default: return K_NONE;
    }
  }

  // ---- effective addresses and operands -----------------------------------------------

  /** Segment and offset of the ModRM operand; sets `eaSeg`, returns the offset. */
  calcEa(segOverride) {
    const r = this.regs;
    let off, seg;
    const bpBased = this.eaRm === 2 || this.eaRm === 3 || (this.eaRm === 6 && this.eaMod !== 0);
    switch (this.eaRm) {
      case 0: off = r[BX] + r[SI]; break;
      case 1: off = r[BX] + r[DI]; break;
      case 2: off = r[BP] + r[SI]; break;
      case 3: off = r[BP] + r[DI]; break;
      case 4: off = r[SI]; break;
      case 5: off = r[DI]; break;
      case 6: off = this.eaMod === 0 ? 0 : r[BP]; break;
      default: off = r[BX]; break;
    }
    if (this.eaMod !== 0 || this.eaRm === 6) off += this.eaDisp;
    off &= 0xFFFF;
    seg = segOverride >= 0 ? segOverride : bpBased ? SS : DS;
    this.eaSeg = seg;
    this.lastEa = off;
    return off;
  }

  isAddr1() { return this.o1k === K_ADDR; }
  isAddr2() { return this.o2k === K_ADDR; }
  isReg1() { return this.o1k === K_REG8 || this.o1k === K_REG16; }

  /** EALOAD: a memory operand the instruction reads is fetched before it executes. */
  loadOperand() {
    const d = DECODE[this.iDecode];
    if ((d.gdr & GDR_NO_LOAD_EA) === 0) {
      if (this.o1k !== K_ADDR && this.o2k !== K_ADDR) return;
      const off = this.calcEa(this.iSeg);
      this.eaOpr = this.eaSize === 16 ? this.biuRead16(this.eaSeg, off) : this.biuRead8(this.eaSeg, off);
      this.cyclesN(2);
    } else if ((d.gdr & GDR_NO_MODRM) === 0) {
      if (this.o1k === K_ADDR || this.o2k === K_ADDR) this.cyclesN(2);
    }
  }

  segOr(def) { return this.iSeg >= 0 ? this.iSeg : def; }

  readOperand(k, r) {
    switch (k) {
      case K_IMM8: return this.qRead8();
      case K_IMM8S: { const v = this.qRead8(); return v & 0x80 ? v | 0xFF00 : v; }
      case K_REL8: { const v = this.qRead8(); return v & 0x80 ? v | 0xFF00 : v; }
      case K_OFF8: { const off = this.qRead16(); return this.biuRead8(this.segOr(DS), off); }
      case K_REG8: return this.getReg8(r);
      case K_IMM16: return this.qRead16();
      case K_REL16: return this.qRead16();
      case K_OFF16: { const off = this.qRead16(); return this.biuRead16(this.segOr(DS), off); }
      case K_REG16: return this.getReg16(r);
      case K_ADDR: return this.eaOpr;
    }
    throw new Error('readOperand ' + k);
  }

  readOperand8(k, r) {
    switch (k) {
      case K_IMM8: case K_IMM8S: case K_REL8: return this.qRead8();
      case K_OFF8: { const off = this.qRead16(); return this.biuRead8(this.segOr(DS), off); }
      case K_REG8: return this.getReg8(r);
      case K_ADDR: return this.eaOpr & 0xFF;
    }
    throw new Error('readOperand8 ' + k);
  }

  readOperand16(k, r) {
    switch (k) {
      case K_IMM16: case K_REL16: return this.qRead16();
      case K_OFF16: { const off = this.qRead16(); return this.biuRead16(this.segOr(DS), off); }
      case K_REG8: {
        const w = this.regs[r & 3];
        return r < 4 ? w : ((w >> 8) | (w << 8)) & 0xFFFF;
      }
      case K_REG16: return this.getReg16(r);
      case K_ADDR: return this.eaSize === 8 ? (this.eaOpr | 0xFF00) : this.eaOpr;
    }
    throw new Error('readOperand16 ' + k);
  }

  readOperandFarAddr() {
    const o1 = this.biuQueueRead(false), o2 = this.biuQueueRead(false);
    const s1 = this.biuQueueRead(false), s2 = this.biuQueueRead(false);
    this.farSeg = s1 | (s2 << 8);
    return o1 | (o2 << 8);
  }

  /** A far pointer through the ModRM operand; sets `farSeg`, returns the offset. */
  readOperandFarPtr(k) {
    if (k === K_ADDR) {
      const offset = this.eaOpr;
      const eaOff = this.calcEa(this.iSeg);
      this.farSeg = this.biuRead16(this.eaSeg, (eaOff + 2) & 0xFFFF);
      return offset;
    }
    const seg = this.segOr(DS);
    const offset = this.biuRead16(seg, this.lastEa);
    this.farSeg = this.biuRead16(seg, (this.lastEa + 2) & 0xFFFF);
    return offset;
  }

  writeOperand(k, r, v) {
    switch (k) {
      case K_OFF8: { const off = this.qRead16(); this.cycle(); this.biuWrite8(this.segOr(DS), off, v); return; }
      case K_REG8: this.setReg8(r, v & 0xFF); return;
      case K_OFF16: { const off = this.qRead16(); this.cycle(); this.biuWrite16(this.segOr(DS), off, v); return; }
      case K_REG16: this.setReg16(r, v & 0xFFFF); return;
      case K_ADDR: {
        const off = this.calcEa(this.iSeg);
        if (this.eaSize === 8) this.biuWrite8(this.eaSeg, off, v);
        else this.biuWrite16(this.eaSeg, off, v);
        return;
      }
    }
  }

  writeOperand8(k, r, v) {
    switch (k) {
      case K_OFF8: { const off = this.qRead16(); this.cycle(); this.biuWrite8(this.segOr(DS), off, v); return; }
      case K_REG8: this.setReg8(r, v & 0xFF); return;
      case K_ADDR: { const off = this.calcEa(this.iSeg); this.biuWrite8(this.eaSeg, off, v); return; }
    }
  }

  writeOperand16(k, r, v) {
    switch (k) {
      case K_OFF16: { const off = this.qRead16(); this.cycle(); this.biuWrite16(this.segOr(DS), off, v); return; }
      case K_REG16: this.setReg16(r, v & 0xFFFF); return;
      case K_ADDR: { const off = this.calcEa(this.iSeg); this.biuWrite16(this.eaSeg, off, v); return; }
    }
  }

  // ---- execution ----------------------------------------------------------------------

  executeInstruction() {
    this.instructionReentrant = false;
    this.jumped = false;
    this.trapSuppressed = false;
    if (this.trapEnableDelay > 0) this.trapEnableDelay--;
    if (this.trapDisableDelay > 0) this.trapDisableDelay--;

    // An instruction with no byte after its opcode waits a clock before it begins.
    if (this.lastQueueOp === QO_FIRST) this.cycle();

    if (this.iPrefixes & (PREFIX_REP1 | PREFIX_REP2)) {
      let valid = true;
      const m = this.iMn;
      if (m === 'STOSB' || m === 'STOSW' || m === 'LODSB' || m === 'LODSW' || m === 'MOVSB' || m === 'MOVSW') {
        this.repType = REP_REP;
      } else if (m === 'SCASB' || m === 'SCASW' || m === 'CMPSB' || m === 'CMPSW') {
        this.repType = (this.iPrefixes & PREFIX_REP1) ? REP_REPNE : REP_REPE;
      } else if (m === 'MUL' || m === 'IMUL' || m === 'DIV' || m === 'IDIV') {
        this.repType = REP_MULDIV;
      } else {
        valid = false;
      }
      if (valid) this.inRep = true;
    }

    this.interruptInhibit = false;

    MC_FN[this.iDecode].call(this);

    if (!this.inRep) this.repInit = false;
    else this.instructionReentrant = true;

    if (!this.jumped && this.inRep) {
      if (this.repType === REP_MULDIV) this.inRep = false;
      else this.repInit = true;
    }
  }

  // ---- ALU primitives (MartyPC cpu_common::alu) -----------------------------------------

  add(a, b, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, sign = bits === 8 ? 0x80 : 0x8000;
    const s = a + b, r = s & mask;
    this.rc = s > mask;
    this.ro = ((a ^ r) & (b ^ r) & sign) !== 0;
    this.ra = ((a ^ b ^ r) & 0x10) !== 0;
    return r;
  }

  sub(a, b, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, sign = bits === 8 ? 0x80 : 0x8000;
    const r = (a - b) & mask;
    this.rc = a < b;
    this.ro = ((a ^ b) & (a ^ r) & sign) !== 0;
    this.ra = ((a ^ b ^ r) & 0x10) !== 0;
    return r;
  }

  adc(a, b, cin, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, sign = bits === 8 ? 0x80 : 0x8000;
    const s = a + b + (cin ? 1 : 0);
    this.rc = s > mask;
    this.ro = ((a ^ s) & (b ^ s) & sign) !== 0;
    this.ra = ((a ^ b ^ s) & 0x10) !== 0;
    return s & mask;
  }

  sbb(a, b, cin, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, sign = bits === 8 ? 0x80 : 0x8000;
    const s = a - (b + (cin ? 1 : 0));
    this.rc = s < 0;
    this.ro = ((a ^ b) & (a ^ s) & sign) !== 0;
    this.ra = ((a ^ b ^ s) & 0x10) !== 0;
    return s & mask;
  }

  neg16(x) { this.rc = x !== 0; return (-x) & 0xFFFF; }

  shlAf(v, count, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, top = bits - 1;
    let c = false, o = false, a = false;
    while (count > 0) {
      c = (v >> top) !== 0;
      v = (v << 1) & mask;
      o = c !== ((v >> top) & 1) > 0;
      a = (v & 0x10) !== 0;
      count--;
    }
    this.rc = c; this.ro = o; this.ra = a;
    return v;
  }

  shr(v, count) {
    let c = false;
    while (count > 0) { c = (v & 1) !== 0; v >>= 1; count--; }
    this.rc = c;
    return v;
  }

  sar(v, count, bits) {
    const ho = v & (bits === 8 ? 0x80 : 0x8000);
    let c = false;
    for (let i = 0; i < count; i++) { c = (v & 1) !== 0; v = (v >> 1) | ho; }
    this.rc = c;
    return v;
  }

  rol(v, count, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, top = bits - 1;
    let c = 0, o = false;
    for (let i = 0; i < count; i++) {
      c = (v >> top) & 1;
      v = (v << 1) & mask;
      o = (c !== 0) !== (((v >> top) & 1) !== 0);
      v |= c;
    }
    this.rc = c !== 0; this.ro = o;
    return v;
  }

  rcl(v, count, cin, bits) {
    const mask = bits === 8 ? 0xFF : 0xFFFF, top = bits - 1;
    let c = cin ? 1 : 0, o = false;
    for (let i = 0; i < count; i++) {
      const saved = c;
      c = (v >> top) & 1;
      v = ((v << 1) & mask) | saved;
      o = (c !== 0) !== (((v >> top) & 1) !== 0);
    }
    this.rc = c !== 0; this.ro = o;
    return v;
  }

  ror(v, count, bits) {
    const top = bits - 1;
    let c = 0, o = false;
    for (let i = 0; i < count; i++) {
      c = v & 1;
      v >>= 1;
      o = (c !== 0) !== (((v >> (top - 1)) & 1) !== 0);
      v |= c << top;
    }
    this.rc = c !== 0; this.ro = o;
    return v;
  }

  rcr(v, count, cin, bits) {
    const top = bits - 1;
    let c = cin ? (1 << top) : 0, o = false;
    for (let i = 0; i < count; i++) {
      const saved = c;
      c = (v & 1) << top;
      v >>= 1;
      o = (saved !== 0) !== (((v >> (top - 1)) & 1) !== 0);
      v |= saved;
    }
    this.rc = c !== 0; this.ro = o;
    return v;
  }

  /** The ALU op of an instruction at its own width - MartyPC's alu_op. */
  aluOp(xi, a, b) {
    const bits = this.iWidth ? 16 : 8;
    const mask = this.iWidth ? 0xFFFF : 0xFF;
    a &= mask; b &= mask;
    let r;
    switch (xi) {
      case XI.ADD: r = this.add(a, b, bits); break;
      case XI.ADC: r = this.adc(a, b, this.getFlag(F_CF), bits); break;
      case XI.SUB: r = this.sub(a, b, bits); break;
      case XI.SBB: r = this.sbb(a, b, this.getFlag(F_CF), bits); break;
      case XI.CMP: this.sub(a, b, bits); this.flagsArith(this.sub(a, b, bits)); return a;
      case XI.NEG: {
        r = this.sub(0, a, bits);
        this.setFlagState(F_CF, a !== 0);
        this.setFlagState(F_OF, this.ro);
        this.setFlagState(F_AF, this.ra);
        this.setSZPw(r, bits);
        return r;
      }
      case XI.INC: case XI.DEC: {
        r = xi === XI.INC ? this.add(a, 1, bits) : this.sub(a, 1, bits);
        this.setFlagState(F_OF, this.ro);
        this.setFlagState(F_AF, this.ra);
        this.setSZPw(r, bits);
        return r;
      }
      case XI.OR: case XI.AND: case XI.XOR:
        r = xi === XI.OR ? a | b : xi === XI.AND ? a & b : a ^ b;
        this.clearFlag(F_CF); this.clearFlag(F_OF); this.clearFlag(F_AF);
        this.setSZP(r);
        return r;
      case XI.NOT:
        return (~a) & 0xFFFF;
      default:
        throw new Error('aluOp ' + xi);
    }
    this.flagsArith(r);
    return r;
  }

  flagsArith(r) {
    this.setFlagState(F_CF, this.rc);
    this.setFlagState(F_OF, this.ro);
    this.setFlagState(F_AF, this.ra);
    this.setSZPw(r, this.iWidth ? 16 : 8);
  }

  setSZPw(r, bits) { if (bits === 8) this.setSZP8(r); else this.setSZP16(r); }

  /** Shifts and rotates - MartyPC's alu_bitshift_op. */
  aluShift(xi, a, count) {
    if (count === 0) return a;
    const bits = this.iWidth ? 16 : 8;
    const mask = this.iWidth ? 0xFFFF : 0xFF;
    const v = a & mask;
    let r = 0;
    switch (xi) {
      case XI.ROL: r = this.rol(v, count, bits); this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); break;
      case XI.ROR: r = this.ror(v, count, bits); this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); break;
      case XI.RCL: r = this.rcl(v, count, this.getFlag(F_CF), bits); this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); break;
      case XI.RCR: r = this.rcr(v, count, this.getFlag(F_CF), bits); this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); break;
      case XI.SETMO:
        this.clearFlag(F_CF); this.clearFlag(F_OF); this.clearFlag(F_AF);
        r = mask;
        this.setSZPw(r, bits);
        break;
      case XI.SETMOC:
        if (this.r8[2] !== 0) {
          this.clearFlag(F_CF); this.clearFlag(F_OF); this.clearFlag(F_AF);
          r = mask;
          this.setSZPw(r, bits);
        } else {
          r = a;
        }
        break;
      case XI.SHL:
        r = this.shlAf(v, count, bits);
        this.setFlagState(F_CF, this.rc); this.setFlagState(F_AF, this.ra); this.setFlagState(F_OF, this.ro);
        this.setSZPw(r, bits);
        break;
      case XI.SHR:
        r = this.shr(v, count);
        this.setFlagState(F_CF, this.rc);
        if (count === 1) this.setFlagState(F_OF, (v & (bits === 8 ? 0x80 : 0x8000)) !== 0);
        else this.clearFlag(F_OF);
        this.clearFlag(F_AF);
        this.setSZPw(r, bits);
        break;
      case XI.SAR:
        r = this.sar(v, count, bits);
        this.setFlagState(F_CF, this.rc); this.clearFlag(F_OF); this.clearFlag(F_AF);
        this.setSZPw(r, bits);
        break;
    }
    return r;
  }

  // ---- multiply and divide (MartyPC muldiv.rs) ------------------------------------------

  /** CORX: the shift-and-add loop. Returns tmpa, leaves tmpc in `rTmpc`. */
  corx(bits, b, c, carry) {
    const mask = bits === 8 ? 0xFF : 0xFFFF;
    const tmpb = b & mask;
    let tmpc = this.rcr(c & mask, 1, carry, bits); carry = this.rc;
    let tmpa = 0;
    let n = bits - 1;
    this.cyclesN(2);
    for (;;) {
      this.cycle();
      if (carry) {
        tmpa = this.add(tmpa, tmpb, bits); carry = this.rc;
        this.cyclesN(2);
      } else {
        this.cycle();
      }
      tmpa = this.rcr(tmpa, 1, carry, bits); carry = this.rc;
      tmpc = this.rcr(tmpc, 1, carry, bits); carry = this.rc;
      this.cyclesN(3);
      if (n === 0) break;
      n--;
      this.cycle();
    }
    this.cyclesN(2);
    this.rTmpc = tmpc;
    return tmpa;
  }

  /** CORD: the shift-and-subtract loop. Null on overflow; else tmpc, with tmpa in `rTmpa`. */
  cord(bits, a, b, c) {
    const mask = bits === 8 ? 0xFF : 0xFFFF;
    let tmpa = a & mask;
    const tmpb = b & mask;
    let tmpc = c & mask;
    let sigma = this.sub(tmpa, tmpb, bits);
    let carry = this.rc;
    let n = bits;
    this.setFlagState(F_AF, this.ra);
    this.setFlagState(F_OF, this.ro);
    this.setFlagState(F_CF, carry);
    this.setSZP(sigma);
    this.cyclesN(3);
    if (!carry) { this.cycle(); return null; }
    while (n > 0) {
      tmpc = this.rcl(tmpc, 1, carry, bits); carry = this.rc;
      tmpa = this.rcl(tmpa, 1, carry, bits); carry = this.rc;
      this.cyclesN(4);
      if (carry) {
        this.cyclesN(3);
        carry = false;
        tmpa = this.sub(tmpa, tmpb, bits);
        n--;
        if (n > 0) { this.cycle(); continue; }
        this.cyclesN(2);
      } else {
        sigma = this.sub(tmpa, tmpb, bits);
        carry = this.rc;
        this.setFlagState(F_AF, this.ra);
        this.setFlagState(F_OF, this.ro);
        this.setFlagState(F_CF, carry);
        this.setSZP(sigma);
        this.cyclesN(2);
        if (!carry) {
          this.cyclesN(2);
          tmpa = sigma;
          n--;
          if (n > 0) { this.cycle(); continue; }
          this.cyclesN(2);
        } else {
          this.cycle();
          n--;
          if (n > 0) { this.cycle(); continue; }
        }
      }
    }
    tmpc = this.rcl(tmpc, 1, carry, bits); carry = this.rc;
    this.rcl(tmpc, 1, carry, bits); carry = this.rc;
    this.setFlagState(F_CF, carry);
    this.cyclesN(4);
    this.rTmpa = tmpa;
    this.rCarry = carry;
    return tmpc;
  }

  /** NEGATE: flips signs ahead of or after a signed multiply/divide. */
  corNegate(bits, selfV, tmpb, tmpc, neg, skip) {
    let tmpa = selfV & 0xFFFF;
    if (!skip) {
      const s = this.neg16(tmpc);
      const carry = this.rc;
      tmpc = s;
      tmpa = carry ? (~tmpa) & 0xFFFF : this.neg16(tmpa);
      this.cyclesN(5);
      neg = !neg;
    }
    const carry = (tmpb & (bits === 8 ? 0x80 : 0x8000)) !== 0;
    this.setFlagState(F_CF, carry);
    const s = this.neg16(tmpb);
    this.cyclesN(3);
    if (!carry) {
      this.cyclesN(3);
    } else {
      tmpb = s;
      neg = !neg;
      this.cyclesN(2);
    }
    this.nTmpa = tmpa; this.nTmpb = tmpb; this.nTmpc = tmpc; this.nCarry = carry; this.nNeg = neg;
  }

  preIdiv(bits, selfV, tmpb, tmpc, neg) {
    const carry = (selfV & (bits === 8 ? 0x80 : 0x8000)) !== 0;
    this.cyclesN(2);
    if (!carry) {
      this.cycle();
      this.corNegate(bits, selfV, tmpb, tmpc, neg, true);
    } else {
      this.corNegate(bits, selfV, tmpb, tmpc, neg, false);
    }
  }

  /** Null on overflow; else the quotient, with the remainder in `pTmpa`. */
  postIdiv(bits, selfV, tmpb, tmpc, carry, neg) {
    let tmpa = selfV & 0xFFFF;
    this.cycle();
    if (!carry) { this.cycle(); return null; }
    carry = (tmpb & (bits === 8 ? 0x80 : 0x8000)) !== 0;
    let sigma = this.neg16(tmpa);
    this.cyclesN(3);
    if (!carry) this.cycle();
    else { tmpa = sigma; this.cycle(); }
    sigma = (tmpc + 1) & 0xFFFF;
    this.cyclesN(2);
    if (!neg) { sigma = (~tmpc) & 0xFFFF; this.cycle(); } else this.cycle();
    this.clearFlag(F_CF);
    this.clearFlag(F_OF);
    this.cyclesN(2);
    this.pTmpa = tmpa;
    return sigma;
  }

  /** MUL/IMUL r/m8; returns AX. */
  mul8(al, operand, signed, negate) {
    let tmpc = al;
    let carry = (tmpc & 0x80) !== 0;
    let tmpb = operand;
    let tmpa;
    this.cyclesN(2);
    if (signed) {
      const sigma = this.neg16(tmpc);
      this.cyclesN(3);
      if (carry) {
        tmpc = sigma;
        negate = !negate;
        this.cyclesN(3);
      } else {
        this.cycle();
      }
      this.corNegate(8, 0, tmpb, tmpc, negate, true);
      tmpb = this.nTmpb; tmpc = this.nTmpc; carry = this.nCarry; negate = this.nNeg;
    }
    this.cyclesN(2);
    tmpa = this.corx(8, tmpb, tmpc, carry);
    tmpc = this.rTmpc;
    this.cycle();
    if (negate) {
      this.cycle();
      this.corNegate(8, tmpa & 0xFF, tmpb, tmpc, negate, false);
      tmpa = this.nTmpa; tmpc = this.nTmpc;
    }
    this.cycle();
    if (signed) {
      this.cycle();
      carry = (tmpc & 0x80) !== 0;
      const sigma = this.adc(tmpa, 0, carry, 16);
      const af = this.ra;
      this.cyclesN(3);
      this.setFlagState(F_AF, af);
      this.setSZP16(sigma);
      if (sigma === 0) {
        this.clearFlag(F_CF); this.clearFlag(F_OF);
        this.cyclesN(4);
      } else {
        this.setFlag(F_CF); this.setFlag(F_OF);
        this.cyclesN(3);
      }
      this.cyclesN(2);
      return ((tmpa << 8) | (tmpc & 0xFF)) & 0xFFFF;
    }
    this.cyclesN(6);
    if (tmpa === 0) {
      this.clearFlag(F_CF); this.clearFlag(F_OF);
      this.cyclesN(4);
    } else {
      this.setFlag(F_CF); this.setFlag(F_OF);
      this.cyclesN(3);
    }
    return ((tmpa << 8) | (tmpc & 0xFF)) & 0xFFFF;
  }

  /** MUL/IMUL r/m16; returns AX, leaves DX in `rDx`. */
  mul16(ax, operand, signed, negate) {
    let tmpc = ax;
    let carry = (tmpc & 0x8000) !== 0;
    let tmpb = operand;
    let tmpa;
    this.cyclesN(2);
    if (signed) {
      const sigma = this.neg16(tmpc);
      this.cyclesN(3);
      if (carry) {
        tmpc = sigma;
        negate = !negate;
        this.cyclesN(3);
      } else {
        this.cycle();
      }
      this.corNegate(16, 0, tmpb, tmpc, negate, true);
      tmpb = this.nTmpb; tmpc = this.nTmpc; carry = this.nCarry; negate = this.nNeg;
    }
    this.cyclesN(2);
    tmpa = this.corx(16, tmpb, tmpc, carry);
    tmpc = this.rTmpc;
    this.cycle();
    if (negate) {
      this.cycle();
      this.corNegate(16, tmpa, tmpb, tmpc, negate, false);
      tmpa = this.nTmpa; tmpc = this.nTmpc;
    }
    this.cycle();
    if (signed) {
      this.cycle();
      carry = (tmpc & 0x8000) !== 0;
      const sigma = this.adc(tmpa, 0, carry, 16);
      const af = this.ra;
      this.cyclesN(3);
      this.setFlagState(F_AF, af);
      this.setSZP16(sigma);
      if (sigma === 0) {
        this.clearFlag(F_CF); this.clearFlag(F_OF);
        this.cyclesN(4);
      } else {
        this.setFlag(F_CF); this.setFlag(F_OF);
        this.cyclesN(3);
      }
      this.cyclesN(2);
      this.rDx = tmpa;
      return tmpc;
    }
    this.cyclesN(6);
    if (tmpa === 0) {
      this.clearFlag(F_CF); this.clearFlag(F_OF);
      this.cyclesN(4);
    } else {
      this.setFlag(F_CF); this.setFlag(F_OF);
      this.cyclesN(3);
    }
    this.rDx = tmpa;
    return tmpc;
  }

  /** DIV/IDIV: false on a divide error; else quotient in `rQ`, remainder in `rR`. */
  divide(bits, hi, lo, divisor, signed, negate) {
    let tmpa = hi, tmpc = lo, tmpb = divisor;
    this.cyclesN(3);
    if (signed) {
      this.cycle();
      this.preIdiv(bits, tmpa, tmpb, tmpc, negate);
      tmpa = this.nTmpa; tmpb = this.nTmpb; tmpc = this.nTmpc; negate = this.nNeg;
    }
    this.cyclesN(2);
    const q = this.cord(bits, tmpa, tmpb, tmpc);
    if (q === null) return false;
    tmpc = q; tmpa = this.rTmpa;
    const carry = this.rCarry;
    let sigma = (~tmpc) & 0xFFFF;
    tmpb = hi;
    this.cyclesN(2);
    if (signed) {
      this.cycle();
      const s = this.postIdiv(bits, tmpa, tmpb, tmpc, carry, negate);
      if (s === null) return false;
      tmpa = this.pTmpa;
      sigma = s;
    }
    const mask = bits === 8 ? 0xFF : 0xFFFF;
    this.rQ = sigma & mask;
    this.rR = tmpa & mask;
    return true;
  }

  // ---- stack, jumps, interrupts ---------------------------------------------------------

  pushSized(v) {
    this.regs[SP] = (this.regs[SP] - 2) & 0xFFFF;
    if (this.iWidth) this.biuWrite16(SS, this.regs[SP], v);
    else this.biuWrite8(SS, this.regs[SP], v & 0xFF);
  }
  push16(v) {
    this.regs[SP] = (this.regs[SP] - 2) & 0xFFFF;
    this.biuWrite16(SS, this.regs[SP], v);
  }
  pop16() {
    const v = this.biuRead16(SS, this.regs[SP]);
    this.regs[SP] = (this.regs[SP] + 2) & 0xFFFF;
    return v;
  }
  pushReg16(n) {
    this.regs[SP] = (this.regs[SP] - 2) & 0xFFFF;
    this.biuWrite16(SS, this.regs[SP], this.getReg16(n));
  }
  popReg16(n) {
    const v = this.biuRead16(SS, this.regs[SP]);
    if (n === SP) { this.regs[SP] = v; return; }
    this.setReg16(n, v);
    if (n === 10) this.interruptInhibit = true;      // POP SS
    this.regs[SP] = (this.regs[SP] + 2) & 0xFFFF;
  }
  pushFlags() {
    this.regs[SP] = (this.regs[SP] - 2) & 0xFFFF;
    this.biuWrite16(SS, this.regs[SP], this.flags);
  }
  popFlags() {
    const v = this.biuRead16(SS, this.regs[SP]);
    const trapWas = this.getFlag(F_TF), intWas = this.getFlag(F_IF);
    this.flags = (v & FLAGS_POP_MASK) | FLAGS_RESERVED_ON;
    if (!intWas && this.getFlag(F_IF)) this.interruptInhibit = true;
    const trapIs = this.getFlag(F_TF);
    if (!trapWas && trapIs) this.trapEnableDelay = 1;
    if (trapWas && !trapIs) this.trapDisableDelay = 1;
    this.regs[SP] = (this.regs[SP] + 2) & 0xFFFF;
  }

  reljmp(rel, jump) {
    if (jump) this.cycle();
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.corr();
    this.pc = (this.pc + rel) & 0xFFFF;
    this.cycle();
    this.biuQueueFlush();
    this.cycle();
  }

  farcall(newCs, newIp, jump) {
    if (jump) this.cycle();
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.corr();
    this.cycle();
    this.push16(this.sregs[CS]);
    this.sregs[CS] = newCs;
    this.cyclesN(2);
    this.nearcall(newIp);
  }

  farcall2(newCs, newIp) {
    this.cyclesN(2);
    this.corr();
    this.cycle();
    this.push16(this.sregs[CS]);
    this.sregs[CS] = newCs;
    this.cyclesN(2);
    this.nearcall(newIp);
  }

  nearcall(newIp) {
    const ret = this.pc;
    this.cycle();
    this.pc = newIp;
    this.biuQueueFlush();
    this.cyclesN(3);
    this.push16(ret);
  }

  farret(far) {
    this.cycle();
    this.pc = this.pop16();
    this.biuFetchSuspend();
    this.cyclesN(2);
    if (far) {
      this.cycle();
      this.popReg16(9);
      this.biuQueueFlush();
      this.cyclesN(2);
    } else {
      this.biuQueueFlush();
      this.cyclesN(2);
    }
  }

  intrRoutine(vector, skipFirst) {
    if (!skipFirst) this.cycle();
    this.cyclesN(2);
    const va = (vector * 4) & 0xFFFF;
    const newIp = this.biuRead16(SEG_NONE, va);
    this.cycle();
    const newCs = this.biuRead16(SEG_NONE, (va + 2) & 0xFFFF);
    this.biuFetchSuspend();
    this.cyclesN(3);
    this.pushFlags();
    this.clearFlag(F_IF);
    this.clearFlag(F_TF);
    this.cycle();
    this.farcall2(newCs, newIp);
  }

  hwInterrupt(vector) {
    this.biuInta();
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.intrRoutine(vector, false);
  }

  int0() { this.cyclesN(2); this.intrRoutine(0, true); }
  int1() { this.cyclesN(2); this.intrRoutine(1, true); }
  int2() { this.cyclesN(2); this.intrRoutine(2, true); }
  int3() { this.cyclesN(3); this.intrRoutine(3, false); }

  // ---- string instructions --------------------------------------------------------------

  stepIndex(reg, n) {
    this.regs[reg] = (this.getFlag(F_DF) ? this.regs[reg] - n : this.regs[reg] + n) & 0xFFFF;
  }

  stringOp(m) {
    const segDs = this.segOr(DS);
    switch (m) {
      case 'STOSB': this.biuWrite8(ES, this.regs[DI], this.r8[0]); this.stepIndex(DI, 1); break;
      case 'STOSW': this.biuWrite16(ES, this.regs[DI], this.regs[AX]); this.stepIndex(DI, 2); break;
      case 'LODSB': this.r8[0] = this.biuRead8(segDs, this.regs[SI]); this.stepIndex(SI, 1); break;
      case 'LODSW': this.regs[AX] = this.biuRead16(segDs, this.regs[SI]); this.stepIndex(SI, 2); break;
      case 'MOVSB': {
        const v = this.biuRead8(segDs, this.regs[SI]);
        this.cycle();
        this.biuWrite8(ES, this.regs[DI], v);
        this.stepIndex(SI, 1); this.stepIndex(DI, 1);
        break;
      }
      case 'MOVSW': {
        const v = this.biuRead16(segDs, this.regs[SI]);
        this.cycle();
        this.biuWrite16(ES, this.regs[DI], v);
        this.stepIndex(SI, 2); this.stepIndex(DI, 2);
        break;
      }
      case 'SCASB': {
        this.cyclesN(2);
        const v = this.biuRead8(ES, this.regs[DI]);
        this.cyclesN(3);
        const r = this.sub(this.r8[0], v, 8);
        this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); this.setFlagState(F_AF, this.ra);
        this.setSZP8(r);
        this.stepIndex(DI, 1);
        break;
      }
      case 'SCASW': {
        this.cyclesN(2);
        const v = this.biuRead16(ES, this.regs[DI]);
        this.cyclesN(3);
        const r = this.sub(this.regs[AX], v, 16);
        this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); this.setFlagState(F_AF, this.ra);
        this.setSZP16(r);
        this.stepIndex(DI, 2);
        break;
      }
      case 'CMPSB': case 'CMPSW': {
        const w = m === 'CMPSW';
        this.cycle();
        const a = w ? this.biuRead16(segDs, this.regs[SI]) : this.biuRead8(segDs, this.regs[SI]);
        this.cyclesN(2);
        const b = w ? this.biuRead16(ES, this.regs[DI]) : this.biuRead8(ES, this.regs[DI]);
        this.cyclesN(3);
        const r = this.sub(a, b, w ? 16 : 8);
        this.setFlagState(F_CF, this.rc); this.setFlagState(F_OF, this.ro); this.setFlagState(F_AF, this.ra);
        if (w) this.setSZP16(r); else this.setSZP8(r);
        this.stepIndex(SI, w ? 2 : 1); this.stepIndex(DI, w ? 2 : 1);
        break;
      }
    }
  }

  repStart() {
    if (!this.repInit) {
      this.cycle();
      if (this.inRep) {
        if (this.regs[CX] === 0) {
          this.cyclesN(4);
          this.repEnd();
          return false;
        }
        this.cyclesN(7);
        this.instructionReentrant = true;
      }
    }
    this.repInit = true;
    return true;
  }

  repEnd() {
    this.repInit = false;
    this.inRep = false;
    this.repType = REP_NONE;
  }

  repInterrupt() {
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.corr();
    this.cycle();
    this.biuQueueFlush();
    this.pc = (this.pc - 2) & 0xFFFF;
    this.repEnd();
  }

  // ---- the microcode routines (MartyPC execute_fn.rs) -----------------------------------

  mc_nop() {
    switch (this.iOpcode) {
      case 0x9B: this.cyclesN(3); break;
      case 0xF4:
        this.biuBusWaitHalt();
        this.haltNotHold = true;
        this.fetchState = FS_HALTED;
        this.biuBusWaitFinish();
        if (this.intLine && this.interruptsEnabled()) {
          this.cyclesN(2);
          this.haltNotHold = false;
        } else {
          this.halted = true;
          this.biuHalt();
          this.instructionReentrant = true;
        }
        break;
      case 0xF5: this.setFlagState(F_CF, !this.getFlag(F_CF)); break;
      case 0xF8: this.clearFlag(F_CF); break;
      case 0xF9: this.setFlag(F_CF); break;
      case 0xFA: this.clearFlag(F_IF); break;
      case 0xFB: this.setFlag(F_IF); break;
      case 0xFC: this.clearFlag(F_DF); break;
      case 0xFD: this.setFlag(F_DF); break;
    }
  }

  mc_000() {   // MOV rm<->reg
    const v = this.readOperand(this.o2k, this.o2r);
    if (this.isAddr1()) this.cyclesN(2);
    this.writeOperand(this.o1k, this.o1r, v);
  }

  mc_004() {   // LEA
    const v = this.o2k === K_ADDR ? this.calcEa(-1) : this.lastEa;
    this.writeOperand16(this.o1k, this.o1r, v);
  }

  mc_008() {   // ALU rm<->reg
    const a = this.readOperand(this.o1k, this.o1r);
    const b = this.readOperand(this.o2k, this.o2r);
    this.cycle();
    const r = this.aluOp(this.iXi, a, b);
    if (this.iXi !== XI.CMP) {
      if (this.isAddr1()) this.cyclesN(2);
      this.writeOperand(this.o1k, this.o1r, r);
    }
  }

  mc_00c() {   // ALU rm, imm
    const a = this.readOperand(this.o1k, this.o1r);
    const b = this.readOperand(this.o2k, this.o2r);
    if (this.iWidth === 0 || this.iOpcode === 0x83) this.cycle();
    const r = this.aluOp(this.iXi, a, b);
    if (this.isAddr1()) this.cycle();
    if (this.iMn !== 'CMP') this.writeOperand(this.o1k, this.o1r, r);
  }

  mc_014() {   // MOV rm, imm
    const v = this.readOperand(this.o2k, this.o2r);
    if (this.iWidth === 0) this.cycle();
    if (this.isAddr1()) this.cycle();
    this.writeOperand(this.o1k, this.o1r, v);
  }

  mc_018() {   // ALU A, imm
    const a = this.readOperand(this.o1k, this.o1r);
    const b = this.readOperand(this.o2k, this.o2r);
    if (this.iWidth === 0) this.cycle();
    this.setRegA(this.aluOp(this.iXi, a, b));
  }

  mc_01c() {   // MOV r, imm
    const v = this.readOperand(this.o2k, this.o2r);
    if ((this.iOpcode & 0x08) === 0) this.cycle();
    this.writeOperand(this.o1k, this.o1r, v);
  }

  mc_020() {   // INC/DEC rm
    const v = this.readOperand(this.o1k, this.o1r);
    const r = this.aluOp(this.iXi, v, 0);
    this.cycle();
    if (this.isAddr1()) this.cycle();
    this.writeOperand(this.o1k, this.o1r, r);
  }

  mc_026() {   // PUSH rm
    let v = this.readOperand(this.o1k, this.o1r);
    this.cyclesN(3);
    if (this.o1k === K_REG16 && this.o1r === SP) v = (v - 2) & 0xFFFF;
    this.pushSized(v);
  }

  mc_028() { this.cyclesN(3); this.pushReg16(this.iOpcode & 7); }               // PUSH reg
  mc_02c() { this.cyclesN(3); this.pushReg16(8 + ((this.iOpcode >> 3) & 3)); }  // PUSH sreg
  mc_030() { this.cyclesN(3); this.pushFlags(); }                               // PUSHF
  mc_034() { this.popReg16(this.iOpcode & 7); }                                 // POP reg
  mc_038() { const v = this.pop16(); this.writeOperand16(this.o1k, this.o1r, v); if (this.o1r === 10) this.interruptInhibit = true; }
  mc_03c() { this.popFlags(); }                                                 // POPF

  mc_040() {   // POP r/m16
    this.cycle();
    const v = this.pop16();
    this.cycle();
    if (this.isAddr1()) this.cyclesN(2);
    this.writeOperand16(this.o1k, this.o1r, v);
  }

  mc_04c() {   // NOT rm
    const v = this.readOperand(this.o1k, this.o1r);
    const r = this.aluOp(this.iXi, v, 0);
    if (this.isAddr1()) this.cyclesN(2); else this.cycle();
    this.writeOperand(this.o1k, this.o1r, r);
  }

  mc_050() {   // NEG rm
    const v = this.readOperand(this.o1k, this.o1r);
    const r = this.aluOp(this.iXi, v, 0);
    if (this.isAddr1()) this.cyclesN(2); else this.cycle();
    this.writeOperand(this.o1k, this.o1r, r);
  }

  mc_054() { this.r8[1] = this.r8[0] & 0x80 ? 0xFF : 0; }                       // CBW

  mc_058() {   // CWD
    this.cyclesN(3);
    if ((this.regs[AX] & 0x8000) === 0) this.regs[DX] = 0;
    else { this.cycle(); this.regs[DX] = 0xFFFF; }
  }

  mc_060() { this.setRegA(this.readOperand(this.o2k, this.o2r)); }              // MOV A, [offset]
  mc_064() { this.writeOperand(this.o1k, this.o1r, this.regs[AX]); }            // MOV [offset], A

  mc_068() {   // CALL FAR rm
    if (this.o1k === K_ADDR) {
      this.cycle();
      const offset = this.readOperandFarPtr(this.o1k);
      this.farcall(this.farSeg, offset, true);
    } else {
      const seg = this.segOr(DS);
      if (this.isReg1()) this.cycle();
      const segment = this.biuRead16(seg, 0x0004);
      this.cycle();
      this.biuFetchSuspend();
      this.cyclesN(2);
      this.corr();
      this.cycle();
      this.pushReg16(9);
      const next = this.pc;
      this.sregs[CS] = segment;
      this.cyclesN(3);
      this.biuQueueFlush();
      this.cyclesN(3);
      this.push16(next);
    }
    this.jumped = true;
  }

  mc_070() {   // CALLF ptr16:16
    const offset = this.readOperandFarAddr();
    this.farcall(this.farSeg, offset, true);
    this.jumped = true;
  }

  mc_074() {   // CALL rm16
    const ptr = this.readOperand16(this.o1k, this.o1r);
    if (this.isReg1()) this.cycle();
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.corr();
    this.cycle();
    const ret = this.pc;
    this.pc = ptr;
    this.biuQueueFlush();
    this.cyclesN(3);
    this.pushSized(ret);
    this.jumped = true;
  }

  mc_07c() {   // CALL rel16
    const rel = this.readOperand16(this.o1k, this.o1r);
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.corr();
    this.cycle();
    const ret = this.pc;
    this.pc = (this.pc + rel) & 0xFFFF;
    this.biuQueueFlush();
    this.cyclesN(3);
    this.push16(ret);
    this.jumped = true;
  }

  mc_084() {   // XCHG r, AX
    const n = this.iOpcode & 7;
    const ax = this.regs[AX], v = this.regs[n];
    this.cycle();
    this.regs[AX] = v;
    this.regs[n] = ax;
  }

  mc_088() {   // shift/rotate rm, 1
    const v = this.readOperand(this.o1k, this.o1r);
    const r = this.aluShift(this.iXi, v, 1);
    if (this.isAddr1()) this.cyclesN(2);
    this.writeOperand(this.o1k, this.o1r, r);
  }

  mc_08c() {   // shift/rotate rm, CL
    const v = this.readOperand(this.o1k, this.o1r);
    const count = this.r8[2];
    this.cyclesN(6);
    this.cyclesN(4 * count);
    if (this.isAddr1()) this.cycle();
    const r = this.aluShift(this.iXi, v, count);
    this.writeOperand(this.o1k, this.o1r, r);
  }

  mc_094() {   // TEST rm, r
    const a = this.readOperand(this.o1k, this.o1r);
    const b = this.readOperand(this.o2k, this.o2r);
    this.aluOp(XI.AND, a, b);
    this.cycle();
  }

  mc_098() {   // TEST rm, imm
    const a = this.readOperand(this.o1k, this.o1r);
    const b = this.readOperand(this.o2k, this.o2r);
    if (this.iWidth === 0) this.cycle();
    this.cycle();
    this.aluOp(XI.AND, a, b);
  }

  mc_09c() {   // TEST A, imm
    const a = this.regs[AX];
    const b = this.readOperand(this.o2k, this.o2r);
    if (this.iWidth === 0) this.cycle();
    this.aluOp(XI.AND, a, b);
  }

  mc_0a0() {   // SALC
    this.cycle();
    if (this.getFlag(F_CF)) { this.cycle(); this.r8[0] = 0xFF; } else this.r8[0] = 0;
  }

  mc_0a4() {   // XCHG rm, r
    const a = this.readOperand(this.o1k, this.o1r);
    const b = this.readOperand(this.o2k, this.o2r);
    this.cyclesN(2);
    if (this.isAddr2()) this.cyclesN(2);
    this.writeOperand(this.o2k, this.o2r, a);
    this.writeOperand(this.o1k, this.o1r, b);
  }

  mc_0ac() {   // IN A, imm8
    const port = this.readOperand8(this.o2k, this.o2r);
    this.cycle();
    this.setRegA(this.iWidth ? this.biuIoRead16(port) : this.biuIoRead8(port));
  }

  mc_0b0() {   // OUT imm8, A
    const port = this.readOperand8(this.o1k, this.o1r);
    const v = this.readOperand(this.o2k, this.o2r);
    this.cyclesN(2);
    if (this.iWidth) this.biuIoWrite16(port, v); else this.biuIoWrite8(port, v);
  }

  mc_0b4() {   // IN A, DX
    const port = this.regs[DX];
    this.setRegA(this.iWidth ? this.biuIoRead16(port) : this.biuIoRead8(port));
  }

  mc_0b8() {   // OUT DX, A
    const port = this.readOperand16(this.o1k, this.o1r);
    const v = this.readOperand(this.o2k, this.o2r);
    this.cycle();
    if (this.iWidth) this.biuIoWrite16(port, v); else this.biuIoWrite8(port, v);
  }

  mc_0bc() {   // RETN
    this.pc = this.pop16();
    this.biuFetchSuspend();
    this.cycle();
    this.biuQueueFlush();
    this.cyclesN(2);
    this.jumped = true;
  }

  mc_0c0() { this.cycle(); this.farret(true); this.jumped = true; }             // RETF

  mc_0c8() {   // IRET
    this.cycle();
    this.farret(true);
    this.popFlags();
    this.cycle();
    this.jumped = true;
  }

  mc_0cc() {   // RETN/RETF imm16
    const disp = this.readOperand16(this.o1k, this.o1r);
    this.farret((this.iOpcode & 0x08) !== 0);
    this.cycle();
    this.regs[SP] = (this.regs[SP] + disp) & 0xFFFF;
    this.jumped = true;
  }

  mc_0d0() {   // JMP rel
    const rel = this.readOperand(this.o1k, this.o1r);
    if (this.iWidth === 0) this.reljmp(rel, true);
    else this.reljmp(rel, false);
    this.jumped = true;
  }

  mc_0d8() {   // JMP rm16
    const ptr = this.readOperand16(this.o1k, this.o1r);
    if (this.isReg1()) this.cycle();
    this.biuFetchSuspend();
    this.cycle();
    this.pc = ptr;
    this.biuQueueFlush();
    this.jumped = true;
  }

  mc_0dc() {   // JMP FAR rm
    if (this.o1k === K_ADDR) {
      this.cycle();
      this.biuFetchSuspend();
      this.cycle();
      const offset = this.readOperandFarPtr(this.o1k);
      this.sregs[CS] = this.farSeg;
      this.pc = offset;
      this.biuQueueFlush();
    } else {
      const seg = this.segOr(DS);
      this.cycle();
      this.biuFetchSuspend();
      this.cycle();
      this.sregs[CS] = this.biuRead16(seg, 0x0004);
      this.biuQueueFlush();
    }
    this.jumped = true;
  }

  mc_0e0() {   // JMP FAR ptr16:16
    const offset = this.readOperandFarAddr();
    this.biuFetchSuspend();
    this.cyclesN(2);
    this.sregs[CS] = this.farSeg;
    this.pc = offset;
    this.biuQueueFlush();
    this.cycle();
    this.jumped = true;
  }

  mc_0e8() {   // Jcc rel8
    const f = this.flags;
    const cf = (f & F_CF) !== 0, zf = (f & F_ZF) !== 0, sf = (f & F_SF) !== 0,
      of = (f & F_OF) !== 0, pf = (f & F_PF) !== 0;
    let j;
    switch (this.iOpcode & 0x0F) {
      case 0x0: j = of; break;
      case 0x1: j = !of; break;
      case 0x2: j = cf; break;
      case 0x3: j = !cf; break;
      case 0x4: j = zf; break;
      case 0x5: j = !zf; break;
      case 0x6: j = cf || zf; break;
      case 0x7: j = !cf && !zf; break;
      case 0x8: j = sf; break;
      case 0x9: j = !sf; break;
      case 0xA: j = pf; break;
      case 0xB: j = !pf; break;
      case 0xC: j = sf !== of; break;
      case 0xD: j = sf === of; break;
      case 0xE: j = zf || sf !== of; break;
      default: j = !zf && sf === of; break;
    }
    this.jumped = j;
    const rel8 = this.readOperand8(this.o1k, this.o1r);
    this.cycle();
    if (j) this.reljmp(rel8 & 0x80 ? rel8 | 0xFF00 : rel8, true);
  }

  mc_0ec() {   // MOV sreg<->rm
    if (this.isAddr1()) this.cycle();
    const v = this.readOperand(this.o2k, this.o2r);
    this.writeOperand(this.o1k, this.o1r, v);
    if (this.o1k === K_REG16 && this.o1r === 10) this.interruptInhibit = true;   // MOV SS
  }

  mc_0f0() {   // LES
    this.cyclesN(2);
    const offset = this.readOperandFarPtr(this.o2k);
    this.writeOperand16(this.o1k, this.o1r, offset);
    this.sregs[ES] = this.farSeg;
  }

  mc_0f4() {   // LDS
    this.cyclesN(2);
    const offset = this.readOperandFarPtr(this.o2k);
    this.writeOperand16(this.o1k, this.o1r, offset);
    this.sregs[DS] = this.farSeg;
  }

  mc_0f8() {}

  mc_100() { this.cyclesN(2); this.storeFlags(this.r8[1]); }                    // SAHF
  mc_104() { this.r8[1] = this.flags & 0xFF; }                                  // LAHF

  storeFlags(bits) {
    const m = F_CF | F_PF | F_AF | F_ZF | F_SF;
    this.flags = (this.flags & ~m) | (bits & m);
  }

  mc_108() {   // ESC
    if (this.o1k === K_ADDR || this.o1k === K_REG8 || this.o1k === K_REG16) this.readOperand16(this.o1k, this.o1r);
  }

  mc_10c() {   // XLAT
    const seg = this.segOr(DS);
    const off = (this.regs[BX] + this.r8[0]) & 0xFFFF;
    this.cyclesN(3);
    this.r8[0] = this.biuRead8(seg, off);
  }

  mc_11c() {   // STOS
    if (!this.repStart()) return;
    this.stringOp(this.iMn);
    this.cyclesN(2);
    if (this.inRep) {
      this.cycle();
      if (this.intrPending || this.getFlag(F_TF)) {
        this.cycle();
        this.repInterrupt();
      }
      this.cycle();
      this.regs[CX] = (this.regs[CX] - 1) & 0xFFFF;
      if (this.regs[CX] === 0) this.repEnd();
      else this.cycle();
    } else {
      this.cycle();
    }
  }

  mc_120() {   // CMPS, SCAS
    if (!this.repStart()) return;
    this.stringOp(this.iMn);
    if (this.inRep) {
      let end = false;
      this.cycle();
      this.regs[CX] = (this.regs[CX] - 1) & 0xFFFF;
      if (this.repType === REP_REPNE) {
        if (this.getFlag(F_ZF)) { this.repEnd(); this.cycle(); end = true; }
      } else if (this.repType === REP_REPE) {
        if (!this.getFlag(F_ZF)) { this.repEnd(); this.cycle(); end = true; }
      }
      if (!end) {
        this.cycle();
        if (this.intrPending || this.getFlag(F_TF)) {
          this.cycle();
          this.repInterrupt();
        }
        this.cycle();
        if (this.regs[CX] === 0) this.repEnd();
        else this.cycle();
      }
    } else {
      this.cycle();
    }
  }

  mc_12c() {   // MOVS
    if (!this.repStart()) return;
    this.stringOp(this.iMn);
    this.cyclesN(2);
    if (this.inRep) {
      this.regs[CX] = (this.regs[CX] - 1) & 0xFFFF;
      if (this.intrPending || this.getFlag(F_TF)) {
        this.cyclesN(2);
        this.repInterrupt();
      } else {
        this.cyclesN(2);
        if (this.regs[CX] === 0) this.repEnd();
        else this.cycle();
      }
    } else {
      this.cycle();
    }
  }

  mc_12cb() {  // LODS
    if (!this.repStart()) return;
    this.stringOp(this.iMn);
    this.cyclesN(3);
    if (this.inRep) {
      this.cyclesN(2);
      this.regs[CX] = (this.regs[CX] - 1) & 0xFFFF;
      if (this.intrPending || this.getFlag(F_TF)) {
        this.cycle();
        this.repInterrupt();
      } else {
        this.cycle();
        if (this.regs[CX] === 0) this.repEnd();
        else this.cycle();
      }
    }
  }

  mc_134() {   // JCXZ
    this.cyclesN(2);
    const rel8 = this.readOperand8(this.o1k, this.o1r);
    if (this.regs[CX] !== 0) {
      this.cycle();
    } else {
      this.cycle();
      this.reljmp(rel8 & 0x80 ? rel8 | 0xFF00 : rel8, true);
      this.jumped = true;
    }
  }

  mc_138() {   // LOOPNE, LOOPE
    this.regs[CX] = (this.regs[CX] - 1) & 0xFFFF;
    this.cyclesN(2);
    const ne = (this.iOpcode & 1) === 1;
    const rel8 = this.readOperand8(this.o1k, this.o1r);
    if (ne !== this.getFlag(F_ZF)) {
      this.cycle();
    } else if (this.regs[CX] !== 0) {
      this.cycle();
      this.reljmp(rel8 & 0x80 ? rel8 | 0xFF00 : rel8, true);
      this.jumped = true;
    }
  }

  mc_140() {   // LOOP
    this.regs[CX] = (this.regs[CX] - 1) & 0xFFFF;
    this.cyclesN(2);
    const rel8 = this.readOperand8(this.o1k, this.o1r);
    if (this.regs[CX] !== 0) {
      this.reljmp(rel8 & 0x80 ? rel8 | 0xFF00 : rel8, true);
      this.jumped = true;
    }
    if (!this.jumped) this.cycle();
  }

  mc_144() {   // DAA, DAS
    this.cyclesN(2);
    if (this.iXi === XI.DAA) this.daa(); else this.das();
  }

  mc_148() { if (this.iXi === XI.AAA) this.aaa(); else this.aas(); }            // AAA, AAS

  mc_150() {   // MUL/IMUL r/m8
    const v = this.readOperand(this.o1k, this.o1r);
    const negate = (this.iPrefixes & (PREFIX_REP1 | PREFIX_REP2)) !== 0;
    const signed = this.iMn === 'IMUL';
    this.regs[AX] = this.mul8(this.r8[0], v & 0xFF, signed, negate);
    if (!signed) {
      this.setSZP8(this.r8[1]);
      this.clearFlag(F_AF);
    }
    if (this.isReg1()) this.cycle();
  }

  mc_158() {   // MUL/IMUL r/m16
    const v = this.readOperand(this.o1k, this.o1r);
    const negate = (this.iPrefixes & (PREFIX_REP1 | PREFIX_REP2)) !== 0;
    const signed = this.iMn === 'IMUL';
    const ax = this.mul16(this.regs[AX], v, signed, negate);
    this.regs[AX] = ax;
    this.regs[DX] = this.rDx;
    if (!signed) {
      this.setSZP16(this.regs[DX]);
      this.clearFlag(F_AF);
    }
    if (this.isReg1()) this.cycle();
  }

  mc_160() {   // DIV/IDIV r/m8
    const v = this.readOperand(this.o1k, this.o1r);
    const negate = (this.iPrefixes & (PREFIX_REP1 | PREFIX_REP2)) !== 0;
    const signed = this.iMn === 'IDIV';
    if (this.isReg1()) this.cycle();
    if (this.divide(8, this.r8[1], this.r8[0], v & 0xFF, signed, negate)) {
      this.r8[0] = this.rQ;
      this.r8[1] = this.rR;
    } else {
      this.int0();
    }
  }

  mc_168() {   // DIV/IDIV r/m16
    const v = this.readOperand(this.o1k, this.o1r);
    const negate = (this.iPrefixes & (PREFIX_REP1 | PREFIX_REP2)) !== 0;
    const signed = this.iMn === 'IDIV';
    if (this.isReg1()) this.cycle();
    if (this.divide(16, this.regs[DX], this.regs[AX], v, signed, negate)) {
      this.regs[AX] = this.rQ;
      this.regs[DX] = this.rR;
    } else {
      this.int0();
    }
  }

  mc_170() {   // AAD
    this.iWidth = 0;
    const imm = this.readOperand8(this.o1k, this.o1r);
    this.cyclesN(3);
    this.corx(8, this.r8[1], imm, false);
    const product = this.rTmpc;
    const r = this.aluOp(XI.ADD, this.r8[0], product);
    this.r8[0] = r;
    this.r8[1] = 0;
    this.cyclesN(2);
    this.setSZP8(this.r8[0]);
  }

  mc_174() {   // AAM
    const imm = this.readOperand(this.o1k, this.o1r);
    this.cyclesN(3);
    const q = this.cord(8, 0, imm, this.r8[0]);
    if (q !== null) {
      this.r8[1] = (~q) & 0xFF;
      this.r8[0] = this.rTmpa & 0xFF;
      this.cycle();
      this.setSZP8(this.r8[0]);
      this.clearFlag(F_CF); this.clearFlag(F_AF); this.clearFlag(F_OF);
    } else {
      this.setSZP8(0);
      this.clearFlag(F_AF); this.clearFlag(F_CF); this.clearFlag(F_OF);
      this.int0();
      this.jumped = true;
    }
  }

  mc_17c() {   // INC/DEC r16
    const v = this.readOperand16(this.o1k, this.o1r);
    this.writeOperand16(this.o1k, this.o1r, this.aluOp(this.iXi, v, 0));
  }

  mc_1a8() {   // INT imm8
    const v = this.readOperand8(this.o1k, this.o1r);
    this.intrRoutine(v, false);
    this.jumped = true;
  }

  mc_1ac() {   // INTO
    if (this.getFlag(F_OF)) {
      this.cyclesN(4);
      this.intrRoutine(4, false);
      this.jumped = true;
    } else {
      this.cyclesN(2);
    }
  }

  mc_1b0() { this.int3(); this.jumped = true; }                                 // INT 3

  // ---- BCD (MartyPC bcd.rs) ---------------------------------------------------------------

  aaa() {
    this.cyclesN(6);
    const oldAl = this.r8[0];
    let newAl;
    if ((oldAl & 0x0F) > 9 || this.getFlag(F_AF)) {
      this.r8[1] = (this.r8[1] + 1) & 0xFF;
      newAl = (oldAl + 6) & 0xFF;
      this.r8[0] = newAl & 0x0F;
      this.setFlag(F_AF); this.setFlag(F_CF);
    } else {
      newAl = oldAl;
      this.r8[0] = oldAl & 0x0F;
      this.clearFlag(F_AF); this.clearFlag(F_CF);
      this.cycle();
    }
    this.setFlagState(F_ZF, newAl === 0);
    this.setFlagState(F_PF, PARITY[newAl] === 1);
    this.setFlagState(F_OF, oldAl >= 0x7A && oldAl <= 0x7F);
    this.setFlagState(F_SF, oldAl >= 0x7A && oldAl <= 0xF9);
  }

  aas() {
    const oldAl = this.r8[0];
    const oldAf = this.getFlag(F_AF);
    let newAl;
    this.cyclesN(6);
    if ((oldAl & 0x0F) > 9 || oldAf) {
      newAl = (oldAl - 6) & 0xFF;
      this.r8[1] = (this.r8[1] - 1) & 0xFF;
      this.r8[0] = newAl & 0x0F;
      this.setFlag(F_AF); this.setFlag(F_CF);
    } else {
      newAl = oldAl;
      this.r8[0] = oldAl & 0x0F;
      this.clearFlag(F_CF); this.clearFlag(F_AF);
      this.cycle();
    }
    this.clearFlag(F_OF);
    this.clearFlag(F_SF);
    this.setFlagState(F_ZF, newAl === 0);
    this.setFlagState(F_PF, PARITY[newAl] === 1);
    if (oldAf && oldAl >= 0x80 && oldAl <= 0x85) this.setFlag(F_OF);
    if (!oldAf && oldAl >= 0x80) this.setFlag(F_SF);
    if (oldAf && (oldAl <= 0x05 || oldAl >= 0x86)) this.setFlag(F_SF);
  }

  daa() {
    const oldCf = this.getFlag(F_CF), oldAf = this.getFlag(F_AF), oldAl = this.r8[0];
    this.clearFlag(F_CF);
    const alCheck = oldAf ? 0x9F : 0x99;
    this.clearFlag(F_OF);
    if (oldCf) {
      if (this.r8[0] >= 0x1A && this.r8[0] <= 0x7F) this.setFlag(F_OF);
    } else if (this.r8[0] >= 0x7A && this.r8[0] <= 0x7F) {
      this.setFlag(F_OF);
    }
    if ((this.r8[0] & 0x0F) > 9 || this.getFlag(F_AF)) {
      this.r8[0] = (this.r8[0] + 6) & 0xFF;
      this.setFlag(F_AF);
    } else {
      this.clearFlag(F_AF);
    }
    if (oldAl > alCheck || oldCf) {
      this.r8[0] = (this.r8[0] + 0x60) & 0xFF;
      this.setFlag(F_CF);
    } else {
      this.clearFlag(F_CF);
    }
    this.setSZP8(this.r8[0]);
  }

  das() {
    const oldAl = this.r8[0], oldAf = this.getFlag(F_AF), oldCf = this.getFlag(F_CF);
    const alCheck = oldAf ? 0x9F : 0x99;
    const al = this.r8[0];
    this.clearFlag(F_OF);
    if (!oldAf && !oldCf) { if (al >= 0x9A && al <= 0xDF) this.setFlag(F_OF); }
    else if (oldAf && !oldCf) { if ((al >= 0x80 && al <= 0x85) || (al >= 0xA0 && al <= 0xE5)) this.setFlag(F_OF); }
    else if (!oldAf && oldCf) { if (al >= 0x80 && al <= 0xDF) this.setFlag(F_OF); }
    else { if (al >= 0x80 && al <= 0xE5) this.setFlag(F_OF); }
    this.clearFlag(F_CF);
    if ((this.r8[0] & 0x0F) > 9 || this.getFlag(F_AF)) {
      this.r8[0] = (this.r8[0] - 6) & 0xFF;
      this.setFlag(F_AF);
    } else {
      this.clearFlag(F_AF);
    }
    if (oldAl > alCheck || oldCf) {
      this.r8[0] = (this.r8[0] - 0x60) & 0xFF;
      this.setFlag(F_CF);
    } else {
      this.clearFlag(F_CF);
    }
    this.setSZP8(this.r8[0]);
  }
}

// The microcode routine of every decode-table entry, resolved once.
const MC_FN = DECODE.map((d) => {
  const f = CPU8088.prototype[d.fn];
  if (typeof f !== 'function') throw new Error('microcode routine ' + d.fn);
  return f;
});
