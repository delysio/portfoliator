// Emulation worker: owns the CPU, the machine and the real-time pacing loop.
// The main thread only ever sees pixels, key events and blobs of card/NVRAM
// data, so nothing here touches the DOM.

import { CPU8088 } from './cpu8088.js';
import { Machine, CPU_CLOCK } from './machine.js';
import { SCREEN_W, SCREEN_H } from './hd61830.js';
import { HPC101 } from './hpc101.js';
import { HPC102 } from './hpc102.js';
import { HPC104 } from './hpc104.js';
import { PofoLink } from './pofo-link.js';
import { STATE_VERSION } from './snapshot.js';

const FRAME_MS = 1000 / 72;        // the Portfolio LCD refreshes at 72 Hz
const NVRAM_SAVE_MS = 5000;
const MAX_CATCHUP_MS = 100;        // never try to make up more than this
const CHUNK_CYCLES = 2000;

let machine = null;

/**
 * The inspector's I/O log.
 *
 * A ring buffer of port accesses, drained by the host every time it refreshes.
 * Reads go in as well as writes, and that is not padding: the fault that made
 * the contrast keys useless was a READ returning nothing, and no amount of
 * staring at writes would have shown it - the writes looked fine, they were
 * just always the same number.
 *
 * Each entry carries the cycle count, so the host can show the gap between one
 * access and the next. That gap is the single most useful number this project
 * has needed and the hardest one to get at: every question about the LCD
 * controller for the past month has been a question about how many cycles sat
 * between two writes, and answering it meant writing a throwaway script each
 * time.
 *
 * The buffer is bounded and drops the OLDEST entries when it overflows, so a
 * burst never pushes out what the host has not seen yet without saying so -
 * `ioDropped` counts what went missing.
 */
const IO_LOG_MAX = 4096;
let ioLog = [];
let ioDropped = 0;
let ioWatch = null;          // { lo, hi } port range, or null when off
let cpu = null;
let running = false;
let timer = null;

/**
 * Breakpoints and single-stepping.
 *
 * Everything else the inspector shows can be read while the machine runs; these
 * cannot. Stopping means the pacing loop stops calling runSlice - the timer
 * keeps ticking, so the host still gets its status line, but no cycles pass.
 *
 * Address breakpoints are tested BEFORE the instruction at that address runs,
 * which is what makes them useful: the registers on screen are the ones the
 * instruction is about to see. `brkResumeAt` remembers the address we are
 * standing on so that resuming does not trip over the same breakpoint again -
 * a plain flag would also swallow the hit in a one-instruction loop, where
 * stopping every time round is exactly right.
 *
 * Port breakpoints cannot stop mid-instruction: the trap is armed by the I/O
 * hook and the loop breaks as soon as the instruction that did the access has
 * finished. So the address on screen is the NEXT instruction, not the one that
 * touched the port. Unwinding the CPU to do better is not worth it.
 */
let paused = false;
let brkAddrs = new Set();          // linear addresses, CS:IP before the step
let brkIo = null;                  // { lo, hi, rd, wr }, or null when off
let brkHit = null;                 // reason armed inside a slice, drained by tick
let brkResumeAt = -1;              // address already stopped at, skipped once

// The expansion connector takes one peripheral at a time. Both the parallel and
// the serial board answer the ID read at 807Fh, so they cannot share the bus.
// The HPC-104 is the exception: it has a pass-through connector, so it sits in
// front and the chosen peripheral stacks behind it.
let peripheral = 'none';
let expansion = null;              // HPC-104, when fitted
let hpc104Fitted = false;
let hpc104Ram = null;              // restored contents, until the board exists

// Which insertion each slot currently holds. The host bumps the number on every
// insert and every eject, and stamps it on the insert message; every card we
// hand back carries it. A copy still in flight when the slot changed therefore
// arrives with a stale number and is dropped rather than overwriting whatever
// took its place. -1 means the slot is empty.
let cardGenA = -1;
let cardGenB = -1;

// The HPC-101 does double duty: a printer when the ROM drives its PPI outward,
// and the file-transfer link when it drives it inward. One device, one cable.
let link = null;
let linkDeadline = 0;
const LINK_TIMEOUT_MS = 20000;

// The HPC-102's bytes are batched per slice rather than posted one at a time -
// at 9600 baud a message per character would be 960 postMessage calls a second.
let serial = null;
const serialOut = [];

// 0040:007C is the COM1 entry of the BIOS RS-232 timeout table, and DIP's BIOS
// honours it: the AUX read gives up after value x 4.25 s of silence, measured
// linearly from 1 (the boot default, ~4.25 s) up to 8 (~34 s). The BIOS rewrites
// it on every reset, so a chosen value has to be held rather than set once.
const AUX_TIMEOUT_ADDR = 0x47C;
let auxTimeout = 0;                // 0 = leave whatever the BIOS put there

let frameBuf = new Uint8Array(SCREEN_W * SCREEN_H);
let lastTime = 0;
let frameAcc = 0;
let nvramAcc = 0;
let cycleDebt = 0;

// Rolling speed measurement.
let cyclesThisSecond = 0;
let speedAcc = 0;

function post(type, payload, transfer) {
  self.postMessage({ type, ...payload }, transfer || []);
}

/**
 * What a cold start leaves in RAM: zeros, or whatever was there before.
 *
 * A real Portfolio powers up with RAM full of leftovers - the cells hold their
 * charge for a while after the batteries come out, and what survives is neither
 * zeros nor repeatable. A program that reads memory it never wrote therefore
 * behaves differently on hardware than on an emulator that hands it a tidy
 * field of zeros, and the difference stays invisible until it is not.
 *
 * 'zero' keeps the tidy field, which is what every run before this option got.
 * 'random' fills it from the platform's generator, so two cold starts differ
 * and a program leaning on uninitialised memory has a chance to trip here the
 * way it trips there.
 */
let ramFill = 'zero';

/**
 * How faithfully the LCD controller is made to refuse writes it cannot take.
 *
 * 'threshold' is the default: the measured 55-cycle recovery a write to display
 * memory needs before the next access, and with it both of the things real
 * hardware does when a program ignores it.
 *
 * 'off' takes everything instantly, which is what every run before this option
 * got and what keeps the screen tidy. No such chip ever existed; it is there so
 * that a picture which looks wrong can be tried both ways, which settles in one
 * click whether timing is to blame.
 */
let lcdTiming = 'threshold';

function applyLcdTiming(m) {
  if (!m || !m.lcd) return;
  m.lcd.setTiming({
    threshold: lcdTiming === 'threshold',
    // Which way the geometry falls over varies between runs on hardware, so it
    // is drawn afresh here as well: two cold starts of the same program do not
    // give the same wreckage, exactly as on a real Portfolio.
    seed: 1 + Math.floor(Math.random() * 0xFFFE),
  });
}

function fillCold(buf) {
  if (ramFill !== 'random') { buf.fill(0); return; }
  // getRandomValues refuses more than 65536 bytes in one call.
  for (let i = 0; i < buf.length; i += 0x10000) {
    crypto.getRandomValues(buf.subarray(i, Math.min(i + 0x10000, buf.length)));
  }
}

/**
 * Puts the machine into the state a cold start finds it in: main RAM and the
 * panel's own SRAM. The expansion board's RAM is deliberately left alone, so
 * drive B: survives a cold start here exactly as it did before.
 */
function coldFill(m) {
  fillCold(m.ram);
  if (ramFill === 'random' && m.lcd && m.lcd.vram) fillCold(m.lcd.vram);
}

function bootMachine(roms, opts) {
  // A fresh machine runs. A reset, on the other hand, leaves a stopped machine
  // stopped on purpose - that is how one steps through the ROM from its very
  // first instruction.
  paused = false;
  brkHit = null;
  brkResumeAt = -1;

  machine = new Machine(roms);
  hookInspector();
  cpu = new CPU8088(machine.bus);
  machine.attachCPU(cpu);

  if (opts.nvram && opts.nvram.length === machine.ram.length) {
    machine.ram.set(opts.nvram);
  } else {
    // Nothing to restore, so this is as cold as a start gets.
    coldFill(machine);
  }

  // Peripherals must be in place before the reset so the BIOS's power-on probe
  // (PDET, the peripheral ID byte, the card type detection) actually sees them.
  hpc104Fitted = !!opts.hpc104;
  hpc104Ram = opts.hpc104Ram || null;
  attachPeripheral(opts.peripheral || 'none');

  // A card restored at boot counts as insertion zero, which is where the host
  // starts its own counter - otherwise the first flush would look stale.
  if (opts.card) { machine.insertCardA(opts.card, opts.cardWritable !== false); cardGenA = 0; }
  if (opts.cardB && expansion) { expansion.insertCard(opts.cardB, opts.cardBWritable !== false); cardGenB = 0; }

  applyLcdTiming(machine);

  machine.reset();
  cpu.reset();
}

/**
 * Rebuilds the expansion chain. The card in slot B and the board's RAM survive
 * a rebuild, so toggling the printer on and off does not wipe drive B:.
 */
function attachPeripheral(which) {
  link = null;
  serial = null;
  serialOut.length = 0;
  peripheral = which;

  let device = null;
  if (which === 'parallel') {
    const par = new HPC101();
    link = new PofoLink();
    par.attachLink(link);
    device = par;
  } else if (which === 'serial') {
    serial = new HPC102(CPU_CLOCK, (byte) => serialOut.push(byte));
    device = serial;
  }

  if (hpc104Fitted) {
    const carriedCard = expansion ? expansion.cardB : null;
    const carriedRam = expansion ? expansion.ram : hpc104Ram;
    expansion = new HPC104({ unit: 1, ram: carriedRam });
    if (carriedCard) expansion.cardB = carriedCard;
    expansion.attachNext(device);
    machine.attachExpansion(expansion);
  } else {
    expansion = null;
    machine.attachExpansion(device);
  }
}

/**
 * Runs one file-transfer exchange. Every exchange starts by synchronising with
 * the Portfolio's idle beacon, which only appears when it is sitting in
 * Setup -> File transfer -> Server.
 */
function runLink(makeOperation) {
  if (!link) {
    post('linkResult', { ok: false, why: 'Interfejs równoległy nie jest podłączony.' });
    return;
  }
  if (link.busy) {
    post('linkResult', { ok: false, why: 'Trwa już inna operacja.' });
    return;
  }

  linkDeadline = performance.now() + LINK_TIMEOUT_MS;

  function* session() {
    const sync = yield* link.connect();
    if (!sync.ok) return sync;
    return yield* makeOperation();
  }

  link.run(session(), (result) => {
    linkDeadline = 0;
    post('linkResult', result);
  });
}

function runSlice(ms) {
  let budget = Math.round((ms * CPU_CLOCK) / 1000) + cycleDebt;

  while (budget > 0) {
    let chunk = 0;

    if (cpu.halted && !cpu.intLine && !cpu.nmiEdge) {
      // Nothing will change until a timer fires; skip ahead instead of
      // burning the whole budget two cycles at a time.
      chunk = Math.min(budget, CHUNK_CYCLES);
      cpu.cycles += chunk;
    } else {
      while (chunk < CHUNK_CYCLES && chunk < budget) {
        if (brkAddrs.size) {
          const lin = ((cpu.sregs[1] << 4) + cpu.ip) & 0xFFFFF;
          if (lin === brkResumeAt) brkResumeAt = -1;
          else if (brkAddrs.has(lin)) { brkHit = { why: 'addr', seg: cpu.sregs[1], off: cpu.ip }; break; }
        }
        chunk += cpu.step();
        if (brkHit) break;
      }
    }

    machine.advance(chunk);
    budget -= chunk;
    cyclesThisSecond += chunk;

    // What is left of the slice is thrown away rather than carried: the machine
    // is about to stop, and paying that debt back on resume would run cycles
    // nobody asked for.
    if (brkHit) { cycleDebt = 0; return; }
  }

  cycleDebt = budget;   // negative: we overshot, pay it back next slice
}

/** One frame to the host, whatever the machine is doing. */
function postFrame() {
  if (!machine) return;
  if (machine.poweredOff) frameBuf.fill(0);
  else machine.lcd.render(frameBuf);
  post('frame', { pixels: frameBuf, contrast: machine.contrast });
}

function tick() {
  if (!running) return;

  const now = performance.now();
  let dt = now - lastTime;
  lastTime = now;
  if (dt > MAX_CATCHUP_MS) dt = MAX_CATCHUP_MS;

  // Stopped at a breakpoint or by hand: no cycles pass, but the status line
  // keeps coming, so the host shows a speed of zero rather than the last
  // number it happened to hear.
  if (paused) {
    speedAcc += dt;
    if (speedAcc >= 1000) { postStatus(); speedAcc = 0; cyclesThisSecond = 0; }
    return;
  }

  const sliceStartCycle = machine.cycleCount;
  if (!machine.poweredOff) runSlice(dt);

  // Hand tone changes to the host as offsets in seconds from the start of this
  // slice, so Web Audio can schedule them rather than fire them on arrival.
  if (machine.soundEvents.length) {
    const events = machine.soundEvents.map((e) => ({
      t: (e.cycle - sliceStartCycle) / CPU_CLOCK,
      kind: e.kind,
      f0: e.f0,
      f1: e.f1,
    }));
    machine.soundEvents.length = 0;
    post('audio', { events, duration: dt / 1000 });
  }

  if (auxTimeout && machine.ram[AUX_TIMEOUT_ADDR] !== auxTimeout) {
    machine.ram[AUX_TIMEOUT_ADDR] = auxTimeout;
  }

  if (serialOut.length) {
    const data = Uint8Array.from(serialOut);
    serialOut.length = 0;
    post('serialData', { data }, [data.buffer]);
  }

  // A Portfolio that is not in Server mode never moves its clock, so the
  // exchange would otherwise wait forever.
  if (linkDeadline && performance.now() > linkDeadline) {
    linkDeadline = 0;
    link.abort('Brak odpowiedzi. Czy Portfolio jest w Setup → File transfer → Server?');
  }

  frameAcc += dt;
  if (frameAcc >= FRAME_MS) {
    frameAcc %= FRAME_MS;
    postFrame();
  }

  nvramAcc += dt;
  if (nvramAcc >= NVRAM_SAVE_MS) {
    nvramAcc = 0;
    post('nvram', { data: machine.ram });
    if (machine.cardA && machine.cardA.dirty) {
      machine.cardA.dirty = false;
      post('card', { data: machine.cardA.data, gen: cardGenA });
    }
    if (expansion) {
      if (expansion.cardB && expansion.cardB.dirty) {
        expansion.cardB.dirty = false;
        post('cardB', { data: expansion.cardB.data, gen: cardGenB });
      }
      if (expansion.ramDirty) {
        expansion.ramDirty = false;
        post('hpc104ram', { data: expansion.ram });
      }
    }
  }

  if (brkHit) enterPause(brkHit);

  speedAcc += dt;
  if (speedAcc >= 1000) {
    postStatus();
    cyclesThisSecond = 0;
    speedAcc = 0;
  }
}

function postStatus() {
  post('status', {
    speed: cyclesThisSecond / CPU_CLOCK,
    printBytes: machine.expansion ? machine.expansion.peekLength() : 0,
    poweredOff: machine.poweredOff,
    paused,
    cpu: cpu.state(),
    // The line settings the ROM programmed, so the host end can match them.
    serial: serial ? {
      baud: serial.uart.baud,
      bits: (serial.uart.lcr & 0x03) + 5,
      parity: (serial.uart.lcr & 0x08) ? ((serial.uart.lcr & 0x10) ? 'even' : 'odd') : 'none',
      stop: (serial.uart.lcr & 0x04) ? 2 : 1,
      dtr: !!(serial.uart.mcr & 0x01),
      rts: !!(serial.uart.mcr & 0x02),
    } : null,
  });
}

// ---- machine state snapshots ------------------------------------------------

/**
 * A snapshot carries the fitted hardware alongside the machine, because the
 * machine cannot describe boards it does not have. Restoring rebuilds the same
 * expansion chain first and only then puts the state back - a snapshot taken
 * with the memory expansion fitted must not quietly come up without drive B:.
 */
function buildSnapshot() {
  return {
    version: STATE_VERSION,
    saved: Date.now(),
    peripheral,
    hpc104: hpc104Fitted,
    machine: machine.snapshot(),
  };
}

function applySnapshot(s, gens = {}) {
  const wracamy = running;
  stop();

  hpc104Fitted = !!s.hpc104;
  brkResumeAt = -1;               // a restored machine stands somewhere else
  attachPeripheral(s.peripheral || 'none');

  // The timing model is applied before the restore, never after: setTiming
  // clears the recovery window and reseeds the generator, which would throw
  // away the very fields the snapshot just brought back.
  applyLcdTiming(machine);
  machine.restore(s.machine);

  // The cards came back with the machine, and they get numbers of their own:
  // the host names them in the request, takes the cards over when this
  // confirms it, and from then on accepts writes stamped with those numbers
  // only - so nothing the old machine still had in flight lands on them.
  cardGenA = machine.cardA ? gens.a | 0 : -1;
  cardGenB = expansion && expansion.cardB ? gens.b | 0 : -1;
  const card = (c) => (c ? { data: c.data.slice(), writable: !!c.writable } : null);

  machine.lcd.render(frameBuf);
  post('frame', { pixels: frameBuf, contrast: machine.contrast });
  post('stateRestored', {
    peripheral,
    hpc104: hpc104Fitted,
    cardA: card(machine.cardA),
    cardB: card(expansion && expansion.cardB),
    genA: gens.a | 0,
    genB: gens.b | 0,
  });

  if (wracamy) start();
}

function start() {
  if (running) return;
  running = true;
  lastTime = performance.now();
  timer = setInterval(tick, 5);
}

function stop() {
  running = false;
  if (timer !== null) { clearInterval(timer); timer = null; }
}

/**
 * Wraps the machine's port handlers so the log sees every access without the
 * emulation core knowing anything about it. Wrapping from outside keeps this
 * out of machine.js entirely: the bus calls `this.out8`, which finds the
 * instance property installed here before it finds the prototype method.
 */
function hookInspector() {
  const out = machine.out8.bind(machine);
  const inp = machine.in8.bind(machine);

  machine.out8 = (port, val) => {
    if (ioWatch && port >= ioWatch.lo && port <= ioWatch.hi) {
      zapisz({ port, val, r: 0, cyc: cpu ? cpu.cycles : 0 });
    }
    if (brkIo && brkIo.wr && port >= brkIo.lo && port <= brkIo.hi && !brkHit) {
      brkHit = { why: 'io', port, val, r: 0 };
    }
    return out(port, val);
  };
  machine.in8 = (port) => {
    const val = inp(port);
    if (ioWatch && port >= ioWatch.lo && port <= ioWatch.hi) {
      zapisz({ port, val, r: 1, cyc: cpu ? cpu.cycles : 0 });
    }
    if (brkIo && brkIo.rd && port >= brkIo.lo && port <= brkIo.hi && !brkHit) {
      brkHit = { why: 'io', port, val, r: 1 };
    }
    return val;
  };
}

// ---- stopping, resuming, stepping ------------------------------------------

/**
 * Stops the machine and says why. The reason travels to the host as it is: the
 * host decides how to word it, this end only knows what happened.
 */
function enterPause(reason) {
  brkHit = null;
  paused = true;
  cycleDebt = 0;
  // The second being measured is over the moment the machine stops, so it is
  // dropped rather than reported: otherwise the first status after a stop shows
  // whatever speed the machine had reached before it, next to a machine that is
  // standing still.
  cyclesThisSecond = 0;
  speedAcc = 0;
  // Only an address stop leaves the CPU standing on a breakpoint; after an I/O
  // stop the instruction has already run and the next one is fair game.
  brkResumeAt = reason && reason.why === 'addr'
    ? (((reason.seg << 4) + reason.off) & 0xFFFFF) : -1;
  post('paused', { paused: true, cycles: cpu ? cpu.cycles : 0, ...reason });
  postFrame();
}

function resumeRun() {
  paused = false;
  brkHit = null;
  cycleDebt = 0;
  cyclesThisSecond = 0;
  speedAcc = 0;
  lastTime = performance.now();
  post('paused', { paused: false });
}

/**
 * One instruction, and the machine time that goes with it.
 *
 * Stepping stops the machine first if it was running, because a step from a
 * moving machine would land somewhere nobody chose. An I/O trap armed by the
 * stepped instruction is dropped: it would report a stop that has already
 * happened, which is the step itself.
 */
function stepOnce() {
  if (!machine || !cpu) return;
  paused = true;
  brkHit = null;
  cycleDebt = 0;

  if (machine.poweredOff) {
    post('paused', { paused: true, why: 'off', cycles: cpu.cycles });
    return;
  }

  const seg = cpu.sregs[1], off = cpu.ip;
  const c = cpu.step();
  machine.advance(c);
  machine.soundEvents.length = 0;

  brkHit = null;
  brkResumeAt = -1;
  post('paused', { paused: true, why: 'step', seg, off, took: c, cycles: cpu.cycles });
  postFrame();
}

function zapisz(wpis) {
  if (ioLog.length >= IO_LOG_MAX) { ioLog.shift(); ioDropped++; }
  ioLog.push(wpis);
}

/** A window of physical memory, read through the bus so paging and ROM apply. */
function czytajPamiec(seg, off, len) {
  const out = new Uint8Array(len);
  const base = ((seg & 0xFFFF) << 4) + (off & 0xFFFF);
  for (let i = 0; i < len; i++) out[i] = machine.read8((base + i) & 0xFFFFF);
  return out;
}

self.onmessage = (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      // Set before the machine exists: a fresh start fills RAM while booting.
      ramFill = msg.ramFill === 'random' ? 'random' : 'zero';
      lcdTiming = msg.lcdTiming || 'off';
      bootMachine({
        sysRom: new Uint8Array(msg.sysRom),
        lcdCharRom: new Uint8Array(msg.lcdCharRom),
        cgRom: new Uint8Array(msg.cgRom),
      }, {
        nvram: msg.nvram ? new Uint8Array(msg.nvram) : null,
        card: msg.card ? new Uint8Array(msg.card) : null,
        cardWritable: msg.cardWritable,
        peripheral: msg.peripheral || 'none',
        hpc104: !!msg.hpc104,
        hpc104Ram: msg.hpc104Ram ? new Uint8Array(msg.hpc104Ram) : null,
        cardB: msg.cardB ? new Uint8Array(msg.cardB) : null,
        cardBWritable: msg.cardBWritable,
      });
      post('ready', { width: SCREEN_W, height: SCREEN_H });
      start();
      break;

    case 'reset':
      if (!machine) break;
      if (msg.cold) coldFill(machine);
      // A cold start redraws the seed, the same as switching on does.
      if (msg.cold) applyLcdTiming(machine);
      machine.batteryConfig = msg.cold ? 0x03 : 0x01;
      machine.reset();
      cpu.reset();
      break;

    case 'keydown':
      if (!machine) break;
      // A key that brings the machine back from the OFF command works the power
      // button rather than the keyboard: the ASIC answers it with a reset pulse
      // (see Machine.wake), and 300 ms of reset is no place to deliver a
      // keystroke. Standby, where the machine really is waiting for a key, hands
      // it through as normal.
      if (machine.wake() === 'off') break;
      machine.keyboard.keyDown(msg.scancode);
      break;

    case 'keyup':
      if (machine) machine.keyboard.keyUp(msg.scancode);
      break;

    case 'blur':
      if (machine) machine.keyboard.releaseAll();
      break;

    // The host reads drive C: straight out of RAM - see js/ui/permdata.js - and
    // the periodic snapshot can be seconds old, which for a file the Portfolio
    // has only just written is the difference between showing it and not.
    case 'requestNvram':
      if (!machine) break;
      post('nvram', { data: machine.ram });
      // With an HPC-104 fitted, drive C: can live in its 256 KB rather than in
      // the on-board RAM, so the host needs both halves to find it.
      if (expansion && expansion.ram) post('hpc104ram', { data: expansion.ram });
      break;

    case 'insertCard':
      if (machine) {
        machine.insertCardA(new Uint8Array(msg.data), !!msg.writable);
        cardGenA = msg.gen | 0;
      }
      break;

    // Nothing is handed back on the way out. The host has already dropped the
    // image and its storage entry by the time this arrives, so a copy would
    // only re-fill the slot it just emptied.
    case 'ejectCard':
      if (machine) machine.ejectCardA();
      cardGenA = -1;
      break;

    case 'setPeripheral':
      if (machine) attachPeripheral(msg.which || 'none');
      break;

    case 'setHpc104':
      if (!machine) break;
      if (!msg.enabled && expansion) {
        // Hand the card and the board RAM back before the board disappears.
        if (expansion.cardB) post('cardB', { data: expansion.cardB.data, gen: cardGenB });
        post('hpc104ram', { data: expansion.ram });
      }
      hpc104Fitted = !!msg.enabled;
      attachPeripheral(peripheral);
      break;

    case 'insertCardB':
      if (expansion) {
        expansion.insertCard(new Uint8Array(msg.data), !!msg.writable);
        cardGenB = msg.gen | 0;
      }
      break;

    case 'ejectCardB':
      if (expansion) expansion.ejectCard();
      cardGenB = -1;
      break;

    case 'serialRecv':
      if (serial) serial.receive(new Uint8Array(msg.data));
      break;

    // Modem status lines, so a virtual modem can raise and drop carrier.
    case 'serialModem':
      if (serial) serial.uart.setModem(msg.lines || {});
      break;

    case 'linkSend':
      runLink(() => link.putFile(msg.path, new Uint8Array(msg.data), { overwrite: !!msg.overwrite }));
      break;

    case 'linkList':
      runLink(() => link.listFiles(msg.pattern || 'C:*.*'));
      break;

    case 'takePrint':
      // Only the parallel board has a print buffer; the serial one does not.
      if (machine && machine.expansion && machine.expansion.takeBuffer) {
        post('print', { data: machine.expansion.takeBuffer() });
      } else {
        post('print', { data: new Uint8Array(0) });
      }
      break;

    case 'saveState':
      if (machine) {
        post('nvram', { data: machine.ram });
        if (machine.cardA) post('card', { data: machine.cardA.data, gen: cardGenA });
        if (expansion) {
          if (expansion.cardB) post('cardB', { data: expansion.cardB.data, gen: cardGenB });
          post('hpc104ram', { data: expansion.ram });
        }
      }
      break;

    case 'snapshot':
      if (machine) post('snapshotData', { slot: msg.slot || '', state: buildSnapshot() });
      else post('snapshotData', { slot: msg.slot || '', state: null });
      break;

    case 'restoreSnapshot': {
      const stan = msg.state;
      if (!machine) { post('stateResult', { ok: false, why: 'Maszyna nie jest uruchomiona.' }); break; }
      if (!stan || !stan.machine) { post('stateResult', { ok: false, why: 'Plik nie zawiera stanu maszyny.' }); break; }
      if (stan.version !== STATE_VERSION) {
        post('stateResult', {
          ok: false,
          why: 'Stan w formacie {0}, a ten emulator czyta {1}.',
          whyArgs: [stan.version, STATE_VERSION],
        });
        break;
      }
      try {
        applySnapshot(stan, { a: msg.genA, b: msg.genB });
        post('stateResult', { ok: true });
      } catch (e) {
        post('stateResult', { ok: false, why: String(e && e.message ? e.message : e) });
      }
      break;
    }

    case 'setOption':
      if (!machine) break;
      if ('systemTick' in msg) machine.systemTickEnabled = !!msg.systemTick;
      if ('standbyPeriods' in msg) machine.standbyPeriods = msg.standbyPeriods | 0;
      if ('auxTimeout' in msg) auxTimeout = msg.auxTimeout | 0;
      if ('ramFill' in msg) ramFill = msg.ramFill === 'random' ? 'random' : 'zero';
      if ('lcdTiming' in msg) { lcdTiming = msg.lcdTiming || 'off'; applyLcdTiming(machine); }
      break;

    // The inspector asks for everything it shows in one round trip: the log
    // since last time, the registers, and two windows of memory. Anything less
    // and the panes would disagree with each other by a frame or two, which for
    // a debugger is worse than being slow.
    case 'inspect':
      ioWatch = msg.on ? { lo: msg.lo | 0, hi: msg.hi | 0 } : null;
      if (!msg.on) { ioLog = []; ioDropped = 0; }
      break;

    case 'inspectPoll': {
      if (!machine || !cpu) break;
      const log = ioLog; ioLog = [];
      const zgubione = ioDropped; ioDropped = 0;
      const kodSeg = msg.follow ? cpu.sregs[1] : (msg.codeSeg | 0);
      const kodOff = msg.follow ? cpu.ip : (msg.codeOff | 0);
      post('inspectData', {
        log, dropped: zgubione,
        cycles: cpu.cycles,
        regs: {
          ax: cpu.regs[0], cx: cpu.regs[1], dx: cpu.regs[2], bx: cpu.regs[3],
          sp: cpu.regs[4], bp: cpu.regs[5], si: cpu.regs[6], di: cpu.regs[7],
          es: cpu.sregs[0], cs: cpu.sregs[1], ss: cpu.sregs[2], ds: cpu.sregs[3],
          ip: cpu.ip, flags: cpu.getFlags ? cpu.getFlags() : 0,
          halted: !!cpu.halted,
        },
        // 96 bajtow, bo dwanascie instrukcji moze siegnac siedemdziesieciu
        // dwoch - okno musi je pomiescic razem z najdluzsza ostatnia.
        kod: { seg: kodSeg, off: kodOff, bytes: czytajPamiec(kodSeg, kodOff, 96) },
        pam: {
          seg: msg.memSeg | 0, off: msg.memOff | 0,
          bytes: czytajPamiec(msg.memSeg | 0, msg.memOff | 0, 256),
        },
      });
      break;
    }

    // The set is replaced whole rather than added to: the host holds the list
    // the user typed, so a partial update here could only disagree with it.
    case 'breakpoints':
      brkAddrs = new Set((msg.addrs || []).map((a) => a & 0xFFFFF));
      brkIo = msg.io
        ? { lo: msg.io.lo | 0, hi: msg.io.hi | 0, rd: !!msg.io.rd, wr: !!msg.io.wr }
        : null;
      break;

    case 'pause':
      if (machine) enterPause({ why: 'user' });
      break;

    case 'resume':
      resumeRun();
      break;

    case 'step':
      stepOnce();
      break;
  }
};
