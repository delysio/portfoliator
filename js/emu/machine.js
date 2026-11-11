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

// ASIC interrupt levels and the vectors they acknowledge with.
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

const INT_TICK = 0, INT_KEYBOARD = 1, INT_ERROR = 2, INT_EXTERNAL = 3;

// Power-up source, as the BIOS reads it back at 0x8041 after a wake-up reset.
// Only the keyboard is modelled; the other bit the ROM tests there leads to a
// different handler, and nothing here knows yet what asserts it.
const WAKE_KEYBOARD = 0x01;

// The slow clock tick, in seconds. DIP documents the pair as "once a second" and
// "once every 128 seconds"; the second one is what the ROM picks at boot, because
// the fast rate costs noticeably more battery.
const SLOW_TICK_SECONDS = 128;
const INTERRUPT_VECTOR = [0x08, 0x09, 0x00];

const RAM_SIZE = 0x20000;
const VRAM_OFFSET = RAM_SIZE - 0x1000;   // 0x1F000

// Everything the machine itself holds, on top of what its devices hold.
//
// `sysRom` is out because it is the same three images on both sides of a
// restore; `bus` is out because it is a bundle of bound methods; the device
// objects are out because they answer for themselves, one level down.
const STATE = ['ip', 'ie', 'counter', 'romB', 'contrast',
               'poweredOff', 'powerOffCause', 'powerUpLatch', 'batteryConfig',
               'standbyPeriods', 'standbyArmed', 'standbyCrossed',
               'systemTickEnabled', 'systemTickFast',
               'cycleCount', 'cyclesToCounter', 'cyclesToTick'];

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
    this.keyboard = new PofoKeyboard(() => {
      this.standbyCrossed = 0;        // any key restarts the standby countdown
      this.triggerInterrupt(INT_KEYBOARD);
    });
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
    this.counter = 0;           // 16-bit free-running counter at 2 Hz
    this.romB = ROM_APP;
    this.contrast = 0;
    this.poweredOff = false;
    this.powerOffCause = null;    // 'standby' or 'off' - they wake differently

    // What the ASIC hands the BIOS after a wake-up reset pulse: zero when the
    // reset was not a power-up, otherwise the source bits the ROM reads back
    // at 0x8041. See masterReset() for what reads it and why.
    this.powerUpLatch = 0;

    // Standby power-down is an ASIC function, not a ROM one. The BIOS wait loop
    // at E000:143F enters standby with OUT 8030h,0 and halts; there is no
    // countdown anywhere in the ROM, so the chip has to be what cuts power. Its
    // timer has 128 s granularity and fires on the second boundary it crosses,
    // which is exactly why DIP documents the timeout as always between 128 and
    // 256 seconds - where in the period the last key fell decides which.
    this.standbyPeriods = 0;      // boundaries to cross before sleeping; 0 = never
    this.standbyArmed = false;    // the ROM has parked itself in the wait loop
    this.standbyCrossed = 0;      // boundaries since the last key

    // Battery/boot configuration, matching MAME's BATTERY port.
    // bit 0: 1 = battery normal, bit 1: 1 = cold boot
    this.batteryConfig = 0x01;

    // DIP's technical reference (INT 61h Fn 1Eh) gives two tick rates: once a
    // second, or once every 128 seconds - there is no 128 Hz mode. Which of the
    // two is live used to be invisible from here, which is why the tick was off
    // by default: ticking every second for a program that asked for the slow
    // rate would have been 128 times too often. It is visible now - the ROM
    // selects the rate by writing 0x8040, see out8 - so the tick runs by default
    // at whatever the machine itself asked for.
    this.systemTickEnabled = true;
    this.systemTickFast = false;   // the rate the ROM sets at boot is the slow one

    this.cpu = null;            // wired up by the caller

    this.cyclesToCounter = CPU_CLOCK / 2;
    this.cyclesToTick = this.tickPeriod();

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
    put(this, s, STATE);
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

  reset() {
    this.ip = 0;
    this.ie = 0;
    this.counter = 0;
    this.romB = ROM_APP;
    this.poweredOff = false;
    this.powerOffCause = null;
    this.powerUpLatch = 0;
    this.systemTickFast = false;      // the BIOS re-selects it on every boot anyway
    this.cyclesToTick = this.tickPeriod();
    this.standbyArmed = false;
    this.standbyCrossed = 0;
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
            // High byte of the counter, plus the power-up source the ROM looks
            // for here after a wake-up reset. Reading it consumes the latch, the
            // way a status register normally behaves - the BIOS reads it exactly
            // once, at E000:00F2, and every read after that is a plain counter
            // read again.
            data = (((this.counter >> 8) & 0xFF) | this.powerUpLatch) & 0xFF;
            this.powerUpLatch = 0;
          } else {
            data = this.counter & 0xFF;
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
          // Bit 1 is the OFF command. Every other write here is the BIOS wait
          // loop announcing that it is about to halt, which is what arms the
          // chip's standby timer.
          if (val & 0x02) this.powerDown('off');
          else this.standbyArmed = true;
          break;
        case 4:
          // Writing the low half selects the clock tick rate rather than loading
          // the counter. That is what INT 61h Fn 1Eh does with it, and it is the
          // only thing anything does with it: over a boot, a handful of DOS
          // commands and twenty seconds of idling, the single write to this port
          // is the 00h the BIOS sends from E000:0322 to choose the slow rate.
          // Fn 1Eh then writes 01h for one tick a second and 00h for one every
          // 128 seconds, which are the only two speeds the hardware has.
          // KNOWN DIVERGENCE, found by TEMPO8 in August 2026. Here the rate
          // change is free and leaves the 2 Hz counter alone; on hardware it is
          // not. One block of that program read its data from the PSP by
          // accident and so sent the port a stream of varying bytes instead of
          // the zeros every other block sends - 435,752 flips of this bit inside
          // its own fifteen-second window. On a real Portfolio the block came
          // back with 038F where the identical block one address lower gave
          // 06AF: the window it was timing itself against had collapsed to about
          // half. Whatever this write does to the counter chain, it does not do
          // it here, and nothing is known about it beyond that one reading.
          // Nothing in a demo writes to this port, so it costs nothing to leave.
          if (port & 1) this.counter = ((val << 8) | (this.counter & 0xFF)) & 0xFFFF;
          else this.setTickRate((val & 1) !== 0);
          break;
        case 5:
          if (port & 1) this.romB = val & 0x0F;
          else { this.ie = val; this.checkInterrupt(); }
          break;
        case 6:
          this.contrast = val;
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
    for (let i = 0; i < 4; i++) {
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

  /** Cycles between clock ticks, for whichever of the two rates is selected. */
  tickPeriod() {
    return this.systemTickFast ? CPU_CLOCK : CPU_CLOCK * SLOW_TICK_SECONDS;
  }

  /**
   * Switches the tick rate, restarting the countdown. Without the restart, going
   * from the slow rate to the fast one would leave up to 128 seconds of the old
   * period still to run before the first quick tick arrived.
   */
  setTickRate(fast) {
    if (fast === this.systemTickFast) return;
    this.systemTickFast = fast;
    this.cyclesToTick = this.tickPeriod();
  }

  // ---- power --------------------------------------------------------------

  /**
   * One 128 s boundary of the standby timer went by.
   *
   * It only counts while the CPU is actually halted, because that is what
   * standby *is* - the manual defines the mode by the stopped clock, and a
   * machine busy running code is in RUN mode, where the timer has no business
   * cutting power. Without this a demo that runs for minutes without asking for
   * a key would be killed mid-frame, the arming write having been left over from
   * the last visit to the BIOS wait loop.
   *
   * It also reproduces a quirk DIP documents: a program that polls the keyboard
   * in a busy loop instead of waiting on INT 16h never lets the machine sleep.
   */
  standbyBoundary() {
    if (!this.standbyPeriods || !this.standbyArmed || this.poweredOff) return;
    if (!this.cpu || !this.cpu.halted) return;
    if (++this.standbyCrossed >= this.standbyPeriods) this.powerDown('standby');
  }

  /** @param {'standby'|'off'} cause which of the two power modes was entered */
  powerDown(cause) {
    this.poweredOff = true;
    this.powerOffCause = cause;
    this.standbyArmed = false;
    this.standbyCrossed = 0;
  }

  /**
   * A key press brings the machine back - but the two power modes DIP describes
   * in section 2.5.1 come back by different routes, and the difference is not
   * cosmetic.
   *
   * STANDBY MODE is the machine waiting for a key: everything stays powered and
   * only the CCLK clock is halted. The ASIC restarts that clock; here the CPU
   * was never stopped mid-instruction, so letting it run again is enough - it is
   * sitting on the HLT inside the BIOS wait loop with its interrupts enabled,
   * and the keyboard interrupt that follows takes it from there.
   *
   * OFF MODE, which the OFF command enters, powers only the custom chip and the
   * RAM. The CPU has no power at all, so there is nothing to resume: waking is a
   * pulse on MRST, which the guide describes as held high for over 300 ms when
   * the system powers up. That is a hardware warm boot - section 3.2.2 spells
   * out that it "also resets the ASIC and Processor which may be necessary if
   * the interrupts have been disabled because the keyboard will not recognize
   * user key presses", which is exactly the state OFF leaves behind: the ROM
   * zeroes the interrupt-enable register, so no key could ever reach the CPU.
   * RAM keeps its power throughout, so drive C: survives the trip.
   *
   * @returns {null|'resume'|'off'} what the key did, so the caller can tell a
   *   keystroke that was typed from one that only pressed the power button
   */
  wake() {
    if (!this.poweredOff) return null;

    if (this.powerOffCause === 'off') {
      this.masterReset();
      return 'off';
    }

    this.poweredOff = false;
    this.powerOffCause = null;
    this.standbyArmed = false;
    this.standbyCrossed = 0;
    return 'resume';
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
   *              back to sleep as well; bit 0 is the one that leads to the path
   *              which waits for the keyboard and then restores the session.
   *
   * Deliberately not a cold boot: RAM keeps its power all through OFF mode, so
   * the POST that would wipe drive C: must not run. The session comes back with
   * its files - and its screen - intact.
   */
  masterReset() {
    this.reset();
    this.powerUpLatch = WAKE_KEYBOARD;
    if (this.cpu) this.cpu.reset();
  }

  // ---- timing -------------------------------------------------------------

  // Called after each batch of CPU cycles to advance the ASIC timers.
  advance(cycles) {
    this.cycleCount += cycles;
    this.keyboard.advance(cycles);
    if (this.expansion && this.expansion.advance) this.expansion.advance(cycles);

    this.cyclesToCounter -= cycles;
    while (this.cyclesToCounter <= 0) {
      this.cyclesToCounter += CPU_CLOCK / 2;      // 32768 / 16384 = 2 Hz
      this.counter = (this.counter + 1) & 0xFFFF;
      if ((this.counter & 0xFF) === 0) this.standbyBoundary();
    }

    if (this.systemTickEnabled) {
      this.cyclesToTick -= cycles;
      while (this.cyclesToTick <= 0) {
        this.cyclesToTick += this.tickPeriod();
        this.triggerInterrupt(INT_TICK);
      }
    }
  }

  // ---- cards --------------------------------------------------------------

  insertCardA(data, writable) {
    this.cardA = { data, writable, dirty: false, page: 0 };
  }

  ejectCardA() { this.cardA = null; }
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
