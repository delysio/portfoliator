// Atari Portfolio machine: memory map, custom ASIC, expansion port.
//
// Address decoding mirrors MAME's pofo.cpp exactly:
//
//   0x00000-0x1EFFF   on-board RAM (128K minus the 4K video buffer)
//   0x1F000-0xAFFFF   unmapped, reads as 0
//   0xB0000-0xBFFFF   the top 4K of RAM, mirrored every 4K (MDA-style text page)
//   0xC0000-0xDFFFF   switchable window: application ROM, memory card, or
//                     external card, selected by the ROM_B field at port 0x8051
//   0xE0000-0xFFFFF   BIOS/DOS ROM
//
// I/O only decodes 0x80xx (plus the 0x0061 Portfolio-detect port), dispatched
// on bits 7:4 of the port number.

import { HD61830 } from './hd61830.js';
import { PofoKeyboard } from './keyboard.js';
import { PCD3311 } from './pcd3311.js';
import { take, put, copyBytes, intoBytes, takeCard, putCard, STATE_VERSION } from './snapshot.js';

export const CPU_CLOCK = 4915200;

// ROM_B bus selector values (port 0x8051).
const ROM_APP = 0b000;
const ROM_EXT = 0b010;
const CCM_A   = 0b011;
const CCM_B   = 0b111;

// The card window in the CPU map is 128 KB and does not grow. A larger card is
// made of 128 KB pages, selected by writing the page number to offset 000Ah of
// the window - DIP's technical reference, section 2.3.5, which is also why it
// warns that no software may use that byte "no matter what the card capacity".
//
// On a card that fits the window there is no such latch and the byte is ordinary
// storage: every card image this project has seen holds 20h there, the trailing
// space of the OEM name "DIP 2.0 ". Treating it as a page number regardless
// would send a plain 128 KB card off to page 32.
//
// What this models is confirmed: given a blank 256 KB card the ROM's own FORMAT
// completes, reports 256 000 bytes, drives this register with page numbers 0, 1
// and 2, and writes above the 128 KB mark. The layout DIP-DOS lays over that is
// settled too, by watching which window addresses the ROM drives while reading a
// file across the boundary: it takes volume sector 254 from page 0 at 1FC00h and
// then goes straight to page 1 at 200h, so a kilobyte falls out of the volume -
// the last sector of a page together with the first of the next. fat12.js builds
// its 256 KB images to match, and tools/tests/card-page-gap.mjs holds both sides
// of that agreement in place.
const CARD_WINDOW = 0x20000;
const CARD_PAGE_REGISTER = 0x0A;

// The maskable sources, as bits of the pending (8050h read) and enable (8050h
// write) registers. The bit numbers are the ones the BIOS itself sets: 0Ah at the
// prompt - keyboard and external - and 10h on top of that while it has a card
// selected (E000:05E6). The clock tick is not among them, because it is not a
// maskable interrupt at all: see raiseNmi().
const INT_KEYBOARD = 1, INT_EXTERNAL = 3, INT_CARD = 4;
const INTERRUPT_VECTOR = { [INT_KEYBOARD]: 0x09, [INT_CARD]: 0x15 };
const INT_SOURCES = [INT_KEYBOARD, INT_EXTERNAL, INT_CARD];

// Why a reset pulse was a power-up, as the BIOS reads it back at 0x8041. Bit 0
// is a key; bit 1 is the clock's NMI, which is how a machine in OFF mode keeps
// its time and its alarms - see raiseNmi().
const WAKE_KEYBOARD = 0x01;
const WAKE_NMI = 0x02;

// The clock chain. A 2 Hz tick drives an 8-bit counter that 8040h reads back as
// "ticks since the last NMI", and the NMI comes either every second (two ticks)
// or when the counter wraps, which is every 128 seconds - DIP's two rates. The
// BIOS builds the time of day out of exactly that (E000:2B08): half-seconds kept
// in RAM, which the NMI path advances by 2 or by 100h, plus the 8040h reading.
const HALF_SECOND = CPU_CLOCK / 2;

// The BIOS data the inactivity setting works on (segment 0040h): the countdown
// the NMI handler decrements at E000:1D2F, and the flag byte whose bit 7 says a
// key arrived since the wait loop last parked (E000:1553) and bit 2 that the
// fast rate is on.
const BIOS_COUNTDOWN = 0x400 + 0x14C;
const BIOS_FLAGS = 0x400 + 0x125;

const RAM_SIZE = 0x20000;
const VRAM_OFFSET = RAM_SIZE - 0x1000;   // 0x1F000

// Everything the machine itself holds, on top of what its devices hold.
//
// `sysRom` is out because it is the same three images on both sides of a
// restore; `bus` is out because it is a bundle of bound methods; the device
// objects are out because they answer for themselves, one level down.
const STATE = ['ip', 'ie', 'tickCount', 'romB', 'contrast',
               'poweredOff', 'powerOffCause', 'powerUpLatch', 'batteryConfig',
               'nmiLatched', 'offService', 'standbyPeriods', 'standbyExtra',
               'systemTickEnabled', 'systemTickFast',
               'cycleCount', 'cyclesToHalfSecond'];

export class Machine {
  /**
   * @param {object} roms
   *   sysRom     Uint8Array(0x40000) - u4 at 0x00000, u3 at 0x20000
   *   lcdCharRom Uint8Array(0x8000)  - external character generator (c101783)
   *   cgRom      Uint8Array(0x5C0)   - HD61830 internal character generator
   */
  constructor(roms) {
    this.sysRom = roms.sysRom;

    this.ram = new Uint8Array(RAM_SIZE);
    // The Portfolio's LCD board scrambles the external character generator
    // address: the controller emits (charLine << 12) | charCode, the board
    // rewires it to (charCode << 4) | charLine.
    const lcdCharRom = roms.lcdCharRom;
    this.lcd = new HD61830(roms.cgRom, (offset) =>
      lcdCharRom[(((offset & 0xFF) << 4) | ((offset >> 12) & 0x0F)) & (lcdCharRom.length - 1)]);
    this.keyboard = new PofoKeyboard(() => this.triggerInterrupt(INT_KEYBOARD));
    this.keyboard.setClock(CPU_CLOCK);

    // Tone changes are timestamped in CPU cycles so the host can schedule them
    // precisely instead of quantising a melody to the emulation slice.
    this.cycleCount = 0;
    this.soundEvents = [];
    this.sound = new PCD3311(
      (f0, f1) => this.soundEvents.push({ cycle: this.cycleCount, kind: 'tone', f0, f1 }),
      () => this.soundEvents.push({ cycle: this.cycleCount, kind: 'click' }));

    // Memory card slot A (the internal credit-card connector).
    this.cardA = null;          // { data: Uint8Array, writable: bool }
    // Expansion port device, e.g. the HPC-101 parallel interface.
    this.expansion = null;

    this.ip = 0;                // interrupt pending
    this.ie = 0;                // interrupt enable mask
    this.tickCount = 0;         // 2 Hz ticks since the last NMI - what 8040h reads
    this.romB = ROM_APP;
    this.contrast = 0;
    this.poweredOff = false;
    this.powerOffCause = null;    // only 'off' now; a snapshot may still say 'standby'

    // What the ASIC hands the BIOS after a wake-up reset pulse: zero when the
    // reset was not a power-up, otherwise the source bits the ROM reads back
    // at 0x8041. See masterReset() for what reads it and why.
    this.powerUpLatch = 0;

    // The NMI line stays up until the handler reads 8041h, which is what the
    // ROM does as its first act (E000:1D0F). An NMI is taken on the rising edge,
    // so a period that comes round before that read does not make a second one.
    this.nmiLatched = false;

    // OFF mode with the CPU running: the clock's NMI has pulsed MRST and the BIOS
    // is updating the time and looking for an alarm, after which it nearly always
    // switches itself straight back off. To whoever is looking at the machine it
    // is still off - the display stays dark and the status does not flicker every
    // 128 seconds. A contrast write ends it: that is the BIOS bringing the session
    // back, as it does when an alarm is due (E000:20D6).
    this.offService = false;

    // Powering down after a few idle minutes is the BIOS's own doing: the NMI
    // handler counts the countdown at 0040:014C down while no key arrives and,
    // when it reaches zero, takes the path at E000:2008 to OFF mode. The ROM
    // reloads it with 2 at the slow rate, so it fires on the second NMI after the
    // last key - DIP's "always between 128 and 256 seconds".
    //
    // How many slow periods to allow is the one thing the user can change, and
    // only by nudging that countdown just before the NMI would empty it: 2 is the
    // machine left alone, 0 never lets it reach zero, 4 and 8 let it run round
    // once or three times more. standbyExtra counts those extra rounds since the
    // last key.
    this.standbyPeriods = 0;
    this.standbyExtra = 0;

    // Battery/boot configuration, matching MAME's BATTERY port.
    // bit 0: 1 = battery normal, bit 1: 1 = cold boot
    this.batteryConfig = 0x01;

    // DIP's technical reference (INT 61h Fn 1Eh) gives two tick rates: once a
    // second, or once every 128 seconds. The ROM selects one by writing 8040h,
    // see out8. Turning the clock off stops the whole 2 Hz chain - no NMI and no
    // counting - which leaves the Portfolio's clock standing still rather than
    // jumping back 128 seconds every time an unanswered counter wraps.
    this.systemTickEnabled = true;
    this.systemTickFast = false;   // the rate the ROM sets at boot is the slow one

    this.cpu = null;            // wired up by the caller

    this.cyclesToHalfSecond = HALF_SECOND;

    // Bound bus interface handed to the CPU.
    this.bus = {
      read8: (a) => this.read8(a),
      write8: (a, v) => this.write8(a, v),
      in8: (p) => this.in8(p),
      out8: (p, v) => this.out8(p, v),
      intAck: () => this.intAck(),
    };
  }

  attachCPU(cpu) { this.cpu = cpu; }

  /**
   * Installs an expansion-port peripheral (HPC-101 parallel, HPC-102 serial).
   * Peripherals that interrupt drive EINT, which the ASIC latches as its
   * external source and acknowledges with a vector the peripheral supplies.
   */
  attachExpansion(device) {
    this.expansion = device;
    if (device) device.onEint = () => this.externalInterrupt();
  }

  // ---- state snapshots ----------------------------------------------------

  /**
   * The whole machine, in one plain object.
   *
   * "Whole" is the point. What this used to save - the on-board RAM and the card
   * images - is what survives a battery change on the real hardware, and it is
   * not a machine state: restoring it starts the Portfolio cold, from the ROM's
   * own boot, which takes the best part of a minute and loses whatever was on
   * the screen. A snapshot carries the processor, the LCD controller with its
   * display memory, the sound chip, the keyboard queue, the interrupt latches,
   * both countdowns and whatever is fitted to the expansion port, so restoring
   * it puts the machine back mid-instruction-stream instead of at the boot.
   *
   * The cycle counters go in for a reason worth stating: the LCD timing model
   * measures how long ago the last display write happened, so a restore that
   * reset the clock would open a recovery window that never existed and hand the
   * next write a fault the hardware would not have produced.
   */
  snapshot() {
    return {
      version: STATE_VERSION,
      ...take(this, STATE),
      ram: copyBytes(this.ram),
      cardA: takeCard(this.cardA),
      soundEvents: this.soundEvents.map((e) => ({ ...e })),
      cpu: this.cpu ? this.cpu.snapshot() : null,
      lcd: this.lcd.snapshot(),
      keyboard: this.keyboard.snapshot(),
      sound: this.sound.snapshot(),
      expansion: this.expansion && this.expansion.snapshot ? this.expansion.snapshot() : null,
    };
  }

  /**
   * Puts a snapshot back.
   *
   * The expansion board is restored only if one of the same kind is fitted -
   * a snapshot taken with the memory expansion attached cannot conjure the
   * board back into a machine that has none, and quietly building one would
   * change hardware behind the user's back. The caller fits the boards first,
   * then restores.
   */
  restore(s) {
    // Two of the fields are the user's settings rather than the machine's state:
    // the page's current choice holds over whatever was set when the snapshot was
    // taken. Up to 1.00 the clock box started cleared, so most snapshots say the
    // clock is off - which, now that it is the NMI, would stop the time dead.
    const settings = { standbyPeriods: this.standbyPeriods, systemTickEnabled: this.systemTickEnabled };
    put(this, s, STATE);
    Object.assign(this, settings);
    this.adoptOldClock(s);
    intoBytes(this.ram, s.ram);
    this.cardA = putCard(s.cardA);
    this.soundEvents.length = 0;
    for (const e of s.soundEvents || []) this.soundEvents.push({ ...e });
    if (this.cpu && s.cpu) this.cpu.restore(s.cpu);
    if (s.lcd) this.lcd.restore(s.lcd);
    if (s.keyboard) this.keyboard.restore(s.keyboard);
    if (s.sound) this.sound.restore(s.sound);
    if (this.expansion && this.expansion.restore && s.expansion) this.expansion.restore(s.expansion);
    this.checkInterrupt();
  }

  /**
   * Snapshots from 1.00 carry the clock as it was modelled then: a
   * 16-bit counter, a tick delivered as a maskable interrupt on bit 0 and a
   * standby state of the emulator's own. The low byte of that counter is what
   * 8040h read then and reads now, and a machine "in standby" was a CPU halted
   * in the BIOS wait loop, which is simply a running machine waiting for a key.
   */
  adoptOldClock(s) {
    if (!('tickCount' in s) && 'counter' in s) this.tickCount = s.counter & 0xFF;
    if (!('cyclesToHalfSecond' in s) && 'cyclesToCounter' in s) this.cyclesToHalfSecond = s.cyclesToCounter;
    if (this.powerOffCause === 'standby') { this.poweredOff = false; this.powerOffCause = null; }
    this.ip &= INT_SOURCES.reduce((m, b) => m | (1 << b), 0);
  }

  reset() {
    this.ip = 0;
    this.ie = 0;
    this.tickCount = 0;
    this.cyclesToHalfSecond = HALF_SECOND;
    this.romB = ROM_APP;
    this.poweredOff = false;
    this.powerOffCause = null;
    this.powerUpLatch = 0;
    this.nmiLatched = false;
    this.offService = false;
    this.standbyExtra = 0;
    this.systemTickFast = false;      // the BIOS re-selects it on every boot anyway
    this.lcd.reset();
    this.keyboard.reset();
    this.sound.reset();
    this.soundEvents.length = 0;
    if (this.expansion) this.expansion.reset();
    this.checkInterrupt();
  }

  // ---- memory -------------------------------------------------------------

  read8(addr) {
    if (addr < VRAM_OFFSET) return this.ram[addr];

    if (addr >= 0xB0000 && addr < 0xC0000) {
      return this.ram[VRAM_OFFSET + (addr & 0xFFF)];
    }

    if (addr >= 0xC0000 && addr < 0xE0000) {
      switch (this.romB) {
        case ROM_APP:
          return this.sysRom[addr & 0x3FFFF];
        case CCM_A:
          return this.cardA ? this.cardA.data[cardOffset(this.cardA, addr)] : 0xFF;
        case CCM_B:
          // NCC1 asserted: the card lives on the expansion port.
          return this.expansion ? this.expansion.memRead(addr & 0x1FFFF) : 0xFF;
        case ROM_EXT:
        default:
          return 0;
      }
    }

    if (addr >= 0xE0000) return this.sysRom[addr & 0x3FFFF];

    // The hole above the on-board RAM is where a memory expansion maps its own
    // RAM, so let the expansion answer before falling back to open bus.
    if (this.expansion && this.expansion.busRead) {
      const data = this.expansion.busRead(addr);
      if (data !== null) return data;
    }

    return 0;
  }

  write8(addr, val) {
    if (addr < VRAM_OFFSET) { this.ram[addr] = val; return; }

    if (addr >= 0xB0000 && addr < 0xC0000) {
      this.ram[VRAM_OFFSET + (addr & 0xFFF)] = val;
      return;
    }

    if (addr >= 0xC0000 && addr < 0xE0000) {
      if (this.romB === CCM_A) {
        if (this.cardA && cardPageWrite(this.cardA, addr, val)) return;
        if (this.cardA && this.cardA.writable) {
          this.cardA.data[cardOffset(this.cardA, addr)] = val;
          this.cardA.dirty = true;
        }
      } else if (this.romB === CCM_B) {
        if (this.expansion) this.expansion.memWrite(addr & 0x1FFFF, val);
      }
      return;
    }

    if (this.expansion && this.expansion.busWrite) this.expansion.busWrite(addr, val);
    // Writes to ROM space and to an unclaimed hole are simply dropped.
  }

  // ---- I/O ----------------------------------------------------------------

  in8(port) {
    port &= 0xFFFF;

    // Open bus. The 8088 multiplexes address and data on AD0-AD7, so an I/O
    // read that no device answers leaves the low byte of the port address
    // sitting on the bus and reads it straight back. Portfolio software uses
    // this as a machine-detection trick - FoliDash does
    //
    //     MOV DX, 0060h / IN AL, DX / CMP AL, DL
    //
    // and bails out with "Atari Portfolio not detected" unless AL comes back
    // as 0x60. MAME hardcodes only the single case it ran into (port 0x61
    // answering 0x61, commented "Magic port to detect the Pofo"); the general
    // rule covers that one as well.
    //
    // Inside the ASIC's own 0x80xx window MAME reads undecoded sub-addresses
    // back as zero, and that is left as-is here for want of evidence either way.
    const asic = (port & 0xFF00) === 0x8000;
    let data = asic ? 0 : (port & 0xFF);
    let bcom = true;   // active low, so `true` means not selected

    if (asic) {
      switch ((port >> 4) & 0x0F) {
        case 0:
          data = this.keyboard.read();
          break;
        case 1:
          data = (port & 1) ? this.lcd.statusRead() : this.lcd.dataRead();
          break;
        case 4:
          if (port & 1) {
            // Two bits: why the last reset pulse was a power-up - a key (bit 0)
            // or the clock's NMI (bit 1). Reading it consumes them, and it is
            // also the NMI acknowledge: the handler's first act is this read
            // (E000:1D0F), and so is the reset path's (E000:00F2).
            data = this.powerUpLatch & (WAKE_KEYBOARD | WAKE_NMI);
            this.powerUpLatch = 0;
            this.nmiLatched = false;
          } else {
            // 2 Hz ticks since the last NMI. The BIOS adds this to the time it
            // keeps in RAM to get the time of day (E000:2B1C).
            data = this.tickCount;
          }
          break;
        case 5:
          data = (port & 1) ? this.batteryRead() : this.irqStatusRead();
          break;
        case 6:
          // Contrast reads back, and the ROM depends on it. Atari+Up runs
          //     mov dx,8060h / in al,dx / cmp al,0FCh / jnb + / add al,4 / out dx,al
          // at E000:1BA0, so the register is the only place the current level
          // lives - there is no copy in RAM to fall back on. With this read
          // missing the ROM saw zero every time, added four, and wrote four:
          // the contrast keys moved the value exactly once and then stuck.
          data = this.contrast;
          break;
        case 7:
          bcom = false;
          break;
      }
    }

    if (this.expansion) data = this.expansion.ioRead(port, data, bcom);
    return data & 0xFF;
  }

  out8(port, val) {
    port &= 0xFFFF;
    val &= 0xFF;
    let bcom = true;

    if ((port & 0xFF00) === 0x8000) {
      switch ((port >> 4) & 0x0F) {
        case 1:
          if (port & 1) this.lcd.controlWrite(val, this.cpu ? this.cpu.cycles : 0);
          // The panel's own timing needs a clock, and the only one that ticks
          // per instruction is the CPU's: machine.cycleCount only moves when a
          // whole batch has run.
          else this.lcd.dataWrite(val, this.cpu ? this.cpu.cycles : 0);
          break;
        case 2:
          // Bit 7 drives VDD, MODE and A0 together, all active low.
          this.sound.modeW(!(val & 0x80));
          this.sound.a0W(!(val & 0x80));
          this.sound.write(val & 0x3F);
          this.sound.strobeW((val >> 6) & 1);
          break;
        case 3:
          // Bit 1 is OFF mode: the BIOS writes 02h on its way down, from the OFF
          // command and from the inactivity countdown alike (E000:2087), and
          // halts. A write without it is the wait loop at E000:1440 stopping the
          // CPU clock until the next interrupt - standby - which to everything
          // outside the chip is the HLT that follows.
          if (val & 0x02) this.powerDown('off');
          break;
        case 4:
          // Writing 8040h selects the clock rate: 01h one NMI a second, 00h one
          // every 128 seconds. INT 61h Fn 1Eh writes it, and the BIOS at boot and
          // after a wake. The counter is left alone: the BIOS notes what 8040h
          // read when it set the time (0040:014A) and counts from there.
          // KNOWN DIVERGENCE, found by TEMPO8 in August 2026. One block of that
          // program sent this port a stream of varying bytes - 435,752 flips of
          // bit 0 inside its fifteen-second window - and on a real Portfolio the
          // window it timed itself against collapsed to about half. Every flip
          // to the fast rate with two or more ticks counted would fire an NMI
          // and clear the counter here as well, but whether the hardware does
          // more than that is unknown. Nothing in a demo writes to this port.
          if (!(port & 1)) this.setTickRate((val & 1) !== 0);
          break;
        case 5:
          if (port & 1) this.romB = val & 0x0F;
          else { this.ie = val; this.checkInterrupt(); }
          break;
        case 6:
          this.contrast = val;
          this.offService = false;    // the BIOS bringing the display back
          break;
        case 7:
          bcom = false;
          break;
      }
    }

    if (this.expansion) this.expansion.ioWrite(port, val, bcom);
  }

  irqStatusRead() {
    // Bit 3 doubles as ~NMD1 from the expansion port; the BIOS reports a second
    // drive (B:) in its equipment list when it is set.
    const nmd1 = this.expansion ? this.expansion.nmd1() : 1;
    return (this.ip | ((nmd1 ? 0 : 1) << 3)) & 0xFF;
  }

  batteryRead() {
    // Bits 0 and 2 read back part of what was written to the bus selector.
    // Bit 1 is deliberately masked out: letting it through makes the BIOS wedge
    // the external ROM select permanently (see the note in MAME's pofo.cpp).
    let data = this.romB & 0b101;
    if (this.expansion && this.expansion.pdet()) data |= 0x20;
    data |= (this.batteryConfig & 0x03) << 6;
    // Bit 7 answers the BIOS's first question after a reset: is this a power-up
    // at all? A cold start answers yes through batteryConfig; a wake from OFF
    // mode answers it through the latch, which - unlike batteryConfig - clears
    // itself, so a warm reset later in the session is not taken for a cold one.
    if (this.powerUpLatch) data |= 0x80;
    return data;
  }

  // ---- interrupts ---------------------------------------------------------

  checkInterrupt() {
    if (this.cpu) this.cpu.setIRQ((this.ip & this.ie) !== 0);
  }

  triggerInterrupt(level) {
    this.ip |= 1 << level;
    this.checkInterrupt();
  }

  intAck() {
    let vector = 0;
    for (const i of INT_SOURCES) {
      if (this.ip & (1 << i)) {
        this.ip &= ~(1 << i);
        vector = (i === INT_EXTERNAL && this.expansion)
          ? this.expansion.eack()
          : INTERRUPT_VECTOR[i];
        break;
      }
    }
    this.checkInterrupt();
    return vector;
  }

  externalInterrupt() { this.triggerInterrupt(INT_EXTERNAL); }

  /**
   * Switches the clock rate. A switch to the fast rate with two or more ticks
   * already counted is not left waiting for a counter wrap: the next tick finds
   * the count at or past two and fires, see halfSecond().
   */
  setTickRate(fast) {
    this.systemTickFast = fast;
  }

  /** One 2 Hz tick of the clock chain. */
  halfSecond() {
    this.tickCount = (this.tickCount + 1) & 0xFF;
    const due = this.systemTickFast ? this.tickCount >= 2 : this.tickCount === 0;
    if (!due) return;
    this.tickCount = 0;
    this.raiseNmi();
  }

  /**
   * The clock's interrupt. On a Portfolio it is the NMI, not a vectored one: the
   * ROM's handler at E000:1D06 acknowledges it by reading 8041h, calls INT 08h to
   * advance the time and compare it with the alarm, and then does what INT 08h
   * does not - rings a due alarm through INT 4Ah, counts the inactivity
   * countdown down to OFF mode, and ends with INT 1Ch for programs. Raising INT
   * 08h directly, as this emulator did up to 1.00, skipped all of that, and as
   * the interrupt it was raised on was masked at the prompt, the clock itself
   * mostly stood still too.
   *
   * In OFF mode the CPU has no power, so the NMI pulses MRST instead and says so
   * in 8041h bit 1. The BIOS then runs the same time update from its reset path
   * (E000:0100), and either goes straight back to OFF or, with an alarm due,
   * brings the session back.
   */
  raiseNmi() {
    if (this.nmiLatched) return;
    this.nmiLatched = true;

    if (this.poweredOff) {
      if (this.powerOffCause !== 'off') return;
      this.masterReset(WAKE_NMI);
      this.offService = true;
      return;
    }

    this.holdInactivity();
    if (this.cpu) this.cpu.pulseNMI();
  }

  /**
   * Applies the inactivity setting to the BIOS countdown, just before the NMI
   * handler looks at it. Only the one NMI that would empty it is touched: with
   * a key seen since the last park (flag bit 7) the ROM reloads the countdown
   * itself, and anything above one is still on its way down.
   */
  holdInactivity() {
    if (this.standbyPeriods === 2) return;
    const flags = this.ram[BIOS_FLAGS];
    if (flags & 0x80) { this.standbyExtra = 0; return; }
    const left = this.ram[BIOS_COUNTDOWN] | (this.ram[BIOS_COUNTDOWN + 1] << 8);
    if (left !== 1) return;
    if (this.standbyPeriods !== 0) {
      if (this.standbyExtra >= (this.standbyPeriods - 2) / 2) return;
      this.standbyExtra++;
    }
    // One more round, at whatever length the ROM itself would reload.
    const round = (flags & 0x04) ? 0x100 : 2;
    this.ram[BIOS_COUNTDOWN] = (round + 1) & 0xFF;
    this.ram[BIOS_COUNTDOWN + 1] = (round + 1) >> 8;
  }

  // ---- power --------------------------------------------------------------

  /** @param {'off'} cause the power mode entered - OFF is the only one the CPU cannot see out of */
  powerDown(cause) {
    this.poweredOff = true;
    this.powerOffCause = cause;
    this.offService = false;
  }

  /**
   * A key press brings the machine back from OFF mode.
   *
   * OFF MODE, which the OFF command and the inactivity countdown both enter,
   * powers only the custom chip and the RAM. The CPU has no power at all, so
   * there is nothing to resume: waking is a pulse on MRST, which the guide
   * describes as held high for over 300 ms when the system powers up. That is a
   * hardware warm boot - section 3.2.2 spells out that it "also resets the ASIC
   * and Processor which may be necessary if the interrupts have been disabled
   * because the keyboard will not recognize user key presses", which is exactly
   * the state OFF leaves behind: the ROM zeroes the interrupt-enable register,
   * so no key could ever reach the CPU. RAM keeps its power throughout, so drive
   * C: survives the trip, and the BIOS puts the session back where it was.
   *
   * Standby, the other mode DIP describes, is not one here: it is the CPU clock
   * stopped in the BIOS wait loop until the next interrupt, and a halted CPU
   * waiting for the keyboard interrupt is exactly that already.
   *
   * @returns {null|'off'} what the key did, so the caller can tell a keystroke
   *   that was typed from one that only pressed the power button
   */
  wake() {
    if (!this.poweredOff && !this.offService) return null;
    this.masterReset(WAKE_KEYBOARD);
    return 'off';
  }

  /**
   * The ASIC's MRST pulse, plus the two things the ROM demands to see when it
   * comes up that way. Both were found by tracing the BIOS reset path against
   * the real ROM, and both are needed - with either one missing the machine
   * powers itself straight back down:
   *
   *   E000:00D1  IN 8051 / TEST AL,80 / JNZ  - bit 7 clear means "no power-up
   *              was requested", and the ROM answers a reset it did not ask for
   *              by going back to OFF mode;
   *   E000:00F2  IN 8041 / AND AL,03 / JZ    - the wake source. Zero sends it
   *              back to sleep as well; bit 0, a key, leads to the path which
   *              waits for the key to be let go and then restores the session;
   *              bit 1, the clock, to the one that updates the time and looks
   *              for an alarm.
   *
   * Deliberately not a cold boot: RAM keeps its power all through OFF mode, so
   * the POST that would wipe drive C: must not run. The session comes back with
   * its files - and its screen - intact. Nor does the clock chain stop: it is
   * what keeps the time while the machine is off, so the count and the rate go
   * through the pulse untouched.
   *
   * @param {number} source WAKE_KEYBOARD or WAKE_NMI
   */
  masterReset(source = WAKE_KEYBOARD) {
    const clock = { tickCount: this.tickCount, cyclesToHalfSecond: this.cyclesToHalfSecond,
                    systemTickFast: this.systemTickFast };
    this.reset();
    Object.assign(this, clock);
    this.powerUpLatch = source;
    if (this.cpu) this.cpu.reset();
  }

  // ---- timing -------------------------------------------------------------

  // Called after each batch of CPU cycles to advance the ASIC timers - in OFF
  // mode too, because the clock chain is what keeps the time there.
  advance(cycles) {
    this.cycleCount += cycles;
    this.keyboard.advance(cycles);
    if (this.expansion && this.expansion.advance) this.expansion.advance(cycles);

    if (!this.systemTickEnabled) return;
    this.cyclesToHalfSecond -= cycles;
    while (this.cyclesToHalfSecond <= 0) {
      this.cyclesToHalfSecond += HALF_SECOND;     // 32768 / 16384 = 2 Hz
      this.halfSecond();
    }
  }

  // ---- cards --------------------------------------------------------------

  insertCardA(data, writable) {
    this.cardA = { data, writable, dirty: false, page: 0 };
  }

  /**
   * Pulling the card out while the BIOS has it selected and the card interrupt
   * enabled raises INT 15h, the card-access interrupt: the ROM's handler at
   * E000:1CCC then ends whatever program was reading it. At any other moment -
   * the window showing the application ROM, as it does at the prompt - the card
   * simply goes.
   */
  ejectCardA() {
    const selected = this.cardA && this.romB === CCM_A && (this.ie & (1 << INT_CARD));
    this.cardA = null;
    if (selected) this.triggerInterrupt(INT_CARD);
  }
}

/**
 * Where a byte of the card window lands in the image.
 *
 * A card smaller than the window repeats through it, which is what the address
 * lines do on the real thing when the upper ones go nowhere. A larger one is
 * banked: the page register picks which 128 KB is on show.
 */
export function cardOffset(card, addr) {
  const within = addr & (CARD_WINDOW - 1);
  if (card.data.length <= CARD_WINDOW) return within % card.data.length;
  return (card.page * CARD_WINDOW + within) % card.data.length;
}

/**
 * Handles a write that is really a page selection rather than storage.
 *
 * @returns {boolean} true when the write was the page register and nothing else
 *   should be done with it
 */
export function cardPageWrite(card, addr, val) {
  if (card.data.length <= CARD_WINDOW) return false;
  if ((addr & (CARD_WINDOW - 1)) !== CARD_PAGE_REGISTER) return false;

  const pages = Math.ceil(card.data.length / CARD_WINDOW);
  card.page = val % pages;
  return true;
}

export { ROM_APP, ROM_EXT, CCM_A, CCM_B, VRAM_OFFSET, RAM_SIZE, CARD_WINDOW };
