// Host side of the Atari Portfolio parallel file-transfer link.
//
// The Portfolio's ROM has a "Server" mode (Setup -> File transfer -> Server)
// in which it waits for a PC to drive the exchange. This module is the PC.
//
// Physical layer, as decoded from the ROM's receive loop at E000:36D9:
//
//   towards the Portfolio   bit 0 = data, bit 1 = clock   (its PPI port A)
//   from the Portfolio      bit 0 = clock, bit 1 = data   (its PPI port C)
//
// A byte is eight bits, most significant first, one bit clocked on every edge -
// falling and rising alike - so four full clock cycles carry one byte.
//
// Block layer, on top of that:
//
//   sending     wait for 'Z', send 0xA5, send length low/high, send payload,
//               send checksum, read the checksum back
//   receiving   send 'Z', expect 0xA5, read length, read payload, read
//               checksum, send its two's complement
//
// where checksum is the two's complement of the sum of the length bytes and
// the payload.
//
// The protocol is documented by Klaus Peichl's Transfolio; this is an
// independent implementation of it, not a port of that code.

const READY = 0x5A;        // 'Z'
const ACK = 0xA5;

// Command codes carried in the payload of a control block.
export const CMD_SEND_FILE = 0x03;
export const CMD_RECV_FILE = 0x02;
export const CMD_LIST = 0x06;
export const CMD_OVERWRITE = 0x05;
export const CMD_CANCEL = 0x00;

// Status byte the Portfolio answers a control block with. Note the sense:
// "not found" is the good answer when sending a file, because it means there
// is nothing to overwrite.
export const ST_NOT_FOUND = 0x21;
export const ST_FOUND = 0x20;

// While idle in Server mode the Portfolio cycles this beacon continuously.
// Reading anything else means it is busy rather than waiting for a command.
const BEACON = [0x5A, 0x69, 0xA5, 0x96];

const BLOCK_SIZE = 0x7000;

/*
 * Reasons a transfer failed travel as a dictionary key plus its arguments, not
 * as a finished sentence: this runs in the worker, where there is no DOM and no
 * language, and the page translates the message where it prints it.
 */
export class PofoLink {
  constructor() {
    this.reset();
  }

  reset() {
    this.dataBit = 0;        // what we drive towards the Portfolio
    this.clockBit = 1;
    this.pofoClock = 1;      // what it drives back
    this.pofoData = 1;
    this.task = null;        // running generator
    this.done = null;
    this.pending = null;     // condition the generator is blocked on
    this.now = 0;            // emulated cycles, fed by the peripheral
    this.wakeAt = 0;
    this.log = [];
  }

  /** Called with the CPU cycles elapsed, so the link can time its pauses. */
  advance(cycles) {
    this.now += cycles;
    if (this.task && this.wakeAt && this.now >= this.wakeAt) {
      this.wakeAt = 0;
      this.pump();
    }
  }

  /**
   * The Portfolio needs a moment to turn the line round after sending its
   * ready beacon; talking to it too early means talking over its own
   * transmission. The reference implementation pauses 50 ms here.
   */
  *pause(ms) {
    this.wakeAt = this.now + Math.round((4915200 * ms) / 1000);
    yield 'delay';
  }

  // ---- wiring into HPC101 -------------------------------------------------

  dataOut() { return (this.clockBit << 1) | this.dataBit; }
  statusOut() { return 0xFF; }

  handshake(portC) {
    const clock = portC & 1;
    const data = (portC >> 1) & 1;

    // The Portfolio sets its data line first and only then moves the clock, so
    // several writes can share a clock level. Sampling on any of them would
    // catch the data before it was placed; only the edge carries a valid bit.
    if (clock === this.pofoClock) {
      this.pofoData = data;
      return;
    }

    this.pofoClock = clock;
    this.pofoData = data;
    this.pump();
  }

  /**
   * Drives the generator as far as the current line state allows.
   *
   * The condition belonging to a yield must be checked *before* resuming, not
   * after: resuming is what hands the sampled bit back to the generator, so
   * advancing first would take a sample whether or not the clock had moved.
   */
  pump() {
    if (!this.task) return;
    for (;;) {
      if (this.pending === 'wait0' && this.pofoClock !== 0) return;
      if (this.pending === 'wait1' && this.pofoClock !== 1) return;
      if (this.pending === 'delay' && this.wakeAt) return;

      const step = this.task.next(this.pofoData);
      if (step.done) {
        const cb = this.done;
        this.task = null;
        this.done = null;
        this.pending = null;
        if (cb) cb(step.value);
        return;
      }
      this.pending = step.value;
    }
  }

  /** Starts a protocol exchange; `cb` receives the generator's return value. */
  run(gen, cb) {
    this.task = gen;
    this.done = cb || null;
    this.pending = null;
    this.pump();
  }

  get busy() { return this.task !== null; }

  /**
   * Gives up on the exchange in progress. Needed because a Portfolio that is
   * not sitting in Server mode never moves its clock, and the generator would
   * otherwise wait for an edge that never comes.
   */
  abort(why) {
    const cb = this.done;
    this.task = null;
    this.done = null;
    this.pending = null;
    this.wakeAt = 0;
    this.clockBit = 1;
    this.dataBit = 0;
    if (cb) cb({ ok: false, why });
  }

  // ---- bit level ----------------------------------------------------------

  *putByte(byte) {
    // Both reference implementations pause 50 us before every byte. The
    // Portfolio needs that gap to turn its own loop around; without it the
    // last byte of a block is missed.
    yield* this.pause(0.05);

    for (let i = 0; i < 4; i++) {
      this.dataBit = (byte >> 7) & 1;
      this.clockBit = 0;
      byte = (byte << 1) & 0xFF;
      yield 'wait0';

      this.dataBit = (byte >> 7) & 1;
      this.clockBit = 1;
      byte = (byte << 1) & 0xFF;
      yield 'wait1';
    }
  }

  *getByte() {
    let byte = 0;
    for (let i = 0; i < 4; i++) {
      const a = yield 'wait0';
      byte = ((byte << 1) | a) & 0xFF;
      // While receiving, the data line towards the Portfolio is held low - it
      // reads port A twice per bit and a stale data bit left over from the
      // previous transmission confuses it.
      this.dataBit = 0;
      this.clockBit = 0;

      const b = yield 'wait1';
      byte = ((byte << 1) | b) & 0xFF;
      this.dataBit = 0;
      this.clockBit = 1;
    }
    return byte;
  }

  // ---- synchronisation ----------------------------------------------------

  /**
   * While it sits in Server mode the Portfolio streams 'Z' continuously as a
   * ready beacon. There is no frame marker, so the only way to find the byte
   * boundary is to keep slipping one clock cycle at a time until a read lands
   * on 0x5A.
   */
  *connect(maxSlips = 256) {
    this.clockBit = 1;
    this.dataBit = 0;
    yield 'wait1';

    let byte = yield* this.getByte();
    for (let i = 0; byte !== READY && i < maxSlips; i++) {
      yield 'wait0';
      this.clockBit = 0;
      yield 'wait1';
      this.clockBit = 1;
      byte = yield* this.getByte();
    }

    if (byte !== READY) return { ok: false, why: 'nie udało się zsynchronizować z Portfolio' };
    return { ok: true };
  }

  // ---- block level --------------------------------------------------------

  /**
   * Once synchronised, the byte boundary holds, so no slipping is needed here.
   * The idle beacon cycles 0x5A 0x69 0xA5 0x96; a block may only start right
   * after the 0x5A, so the other three are read and discarded. Anything else
   * means the server is busy rather than idle.
   */
  *waitReady(maxBytes = 32) {
    for (let i = 0; i < maxBytes; i++) {
      const byte = yield* this.getByte();
      if (byte === READY) return true;
      if (!BEACON.includes(byte)) return false;
    }
    return false;
  }

  *sendBlock(bytes) {
    // Every block waits for its own 0x5A, including the first one after
    // synchronisation - the beacon keeps running until a block actually starts.
    if (!(yield* this.waitReady())) {
      return { ok: false, why: 'Portfolio nie zgłosiło gotowości' };
    }

    yield* this.pause(50);
    yield* this.putByte(ACK);

    let sum = 0;
    const lenL = bytes.length & 0xFF;
    const lenH = (bytes.length >> 8) & 0xFF;
    yield* this.putByte(lenL); sum = (sum - lenL) & 0xFF;
    yield* this.putByte(lenH); sum = (sum - lenH) & 0xFF;

    for (const b of bytes) {
      yield* this.putByte(b);
      sum = (sum - b) & 0xFF;
    }
    yield* this.putByte(sum);

    // No pause here: the ROM's wait loops time out after roughly 10 ms, so
    // anything longer than the inter-byte gap breaks the block apart.
    const echo = yield* this.getByte();
    if (echo !== sum) {
      return { ok: false, why: 'suma kontrolna: oczekiwano 0x{0}, dostano 0x{1}',
               whyArgs: [sum.toString(16), echo.toString(16)] };
    }
    return { ok: true };
  }

  *receiveBlock() {
    yield* this.putByte(READY);

    const ack = yield* this.getByte();
    if (ack !== ACK) {
      return { ok: false, why: 'oczekiwano 0xA5, dostano 0x{0}', whyArgs: [ack.toString(16)] };
    }

    let sum = 0;
    const lenL = yield* this.getByte(); sum = (sum + lenL) & 0xFF;
    const lenH = yield* this.getByte(); sum = (sum + lenH) & 0xFF;
    const len = (lenH << 8) | lenL;

    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const b = yield* this.getByte();
      sum = (sum + b) & 0xFF;
      data[i] = b;
    }

    const check = yield* this.getByte();
    const ok = ((256 - check) & 0xFF) === sum;
    yield* this.putByte((256 - sum) & 0xFF);

    return { ok, data, why: ok ? null : 'niezgodna suma kontrolna' };
  }

  // ---- commands -----------------------------------------------------------

  /** Builds the 90-byte control block that announces an incoming file. */
  static sendFileCommand(destPath, length) {
    const block = new Uint8Array(90);
    block.set([CMD_SEND_FILE, 0x00, 0x70, 0x0C, 0x7A, 0x21, 0x32], 0);
    block[7] = length & 0xFF;
    block[8] = (length >> 8) & 0xFF;
    block[9] = (length >> 16) & 0xFF;
    for (let i = 0; i < destPath.length && i < 78; i++) {
      block[11 + i] = destPath.charCodeAt(i) & 0xFF;
    }
    return block;
  }

  /** Builds the 82-byte control block used for listing and for fetching. */
  static pathCommand(fn, path) {
    const block = new Uint8Array(82);
    block[0] = fn;
    block[1] = BLOCK_SIZE & 0xFF;
    block[2] = (BLOCK_SIZE >> 8) & 0xFF;
    for (let i = 0; i < path.length && i < 78; i++) {
      block[3 + i] = path.charCodeAt(i) & 0xFF;
    }
    return block;
  }

  /** Sends one file to the Portfolio. Yields until the exchange finishes. */
  *putFile(destPath, bytes, { overwrite = true } = {}) {
    let r = yield* this.sendBlock(PofoLink.sendFileCommand(destPath, bytes.length));
    if (!r.ok) return r;

    r = yield* this.receiveBlock();
    if (!r.ok) return r;

    const status = r.data[0];

    if (status === ST_FOUND) {
      // The file already exists; say whether to replace it.
      const answer = overwrite
        ? Uint8Array.from([CMD_OVERWRITE, 0x00, 0x70])
        : Uint8Array.from([CMD_CANCEL, 0x00, 0x00]);
      r = yield* this.sendBlock(answer);
      if (!r.ok) return r;
      if (!overwrite) return { ok: false, why: 'plik już istnieje, nadpisanie odrzucone' };
    }

    const blockSize = (r.data[1] | (r.data[2] << 8)) || BLOCK_SIZE;

    for (let off = 0; off < bytes.length; off += blockSize) {
      const chunk = bytes.subarray(off, Math.min(off + blockSize, bytes.length));
      r = yield* this.sendBlock(chunk);
      if (!r.ok) return r;
    }

    r = yield* this.receiveBlock();
    if (!r.ok) return r;
    if (r.data[0] !== ST_FOUND) return { ok: false, why: 'zapis nie powiódł się (brak miejsca lub katalogu)' };
    return { ok: true };
  }

  /** Asks the Portfolio for the names matching a pattern. */
  *listFiles(pattern) {
    let r = yield* this.sendBlock(PofoLink.pathCommand(CMD_LIST, pattern));
    if (!r.ok) return r;

    r = yield* this.receiveBlock();
    if (!r.ok) return r;

    const count = r.data[0] | (r.data[1] << 8);
    const names = [];
    let p = 2;
    for (let i = 0; i < count && p < r.data.length; i++) {
      let s = '';
      while (p < r.data.length && r.data[p] !== 0) s += String.fromCharCode(r.data[p++]);
      p++;
      names.push(s);
    }
    return { ok: true, names };
  }
}
