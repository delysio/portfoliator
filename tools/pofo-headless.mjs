// Runs the emulator core in Node, with no browser and no worker.
//
// Nothing in js/emu/ touches the DOM, so the same Machine and CPU8088 that run
// in the page can be driven from a script - roughly 45x faster than real time,
// and with full visibility into the ASIC registers. Fifteen minutes of machine
// time costs about twenty seconds of waiting, which is what makes questions
// like "does it ever power down on its own" answerable at all.
//
// Needs the ROM images in rom/. They are not part of this project (see the
// README), so anything built on this has to cope with them being absent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Machine, CPU_CLOCK } from '../js/emu/machine.js';
import { CPU8088 } from '../js/emu/cpu8088.js';
import { DEFAULT_KEYMAP } from '../js/emu/keyboard.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROM_DIR = path.join(ROOT, 'rom');
const CHUNK = 4096;                 // cycles between machine.advance calls, as in the worker

export const ROMS = {
  app:  path.join(ROM_DIR, 'c101782-007.u4'),
  bios: path.join(ROM_DIR, 'c101781-007.u3'),
  lcd:  path.join(ROM_DIR, 'c101783-001a-01.u3'),
  cg:   path.join(ROM_DIR, 'hd61830.bin'),
};

/** True when every ROM image is present, so a test can skip instead of crashing. */
export function romsAvailable() {
  return Object.values(ROMS).every((p) => fs.existsSync(p));
}

export function boot() {
  const sysRom = new Uint8Array(0x40000);
  sysRom.set(fs.readFileSync(ROMS.app), 0x00000);
  sysRom.set(fs.readFileSync(ROMS.bios), 0x20000);
  if (sysRom[0x3FFF0] !== 0xEA) throw new Error('brak wektora reset pod FFFF0h — pliki ROM zamienione?');

  const machine = new Machine({
    sysRom,
    lcdCharRom: new Uint8Array(fs.readFileSync(ROMS.lcd)),
    cgRom: new Uint8Array(fs.readFileSync(ROMS.cg)),
  });
  const cpu = new CPU8088(machine.bus);
  machine.attachCPU(cpu);
  machine.reset();
  cpu.reset();
  return { machine, cpu };
}

/** Runs `ms` of emulated time, pacing the CPU exactly as the worker does. */
export function run(machine, cpu, ms) {
  let budget = Math.round((ms * CPU_CLOCK) / 1000);

  while (budget > 0) {
    let chunk = 0;
    if (machine.poweredOff || (cpu.halted && !cpu.intLine && !cpu.nmiEdge)) {
      chunk = Math.min(budget, CHUNK);          // the worker's skip-ahead; in OFF mode only the clock runs
      cpu.cycles += chunk;
    } else {
      while (chunk < CHUNK && chunk < budget) chunk += cpu.step();
    }
    machine.advance(chunk);
    budget -= chunk;
  }
}

/**
 * The MDA text buffer, which is the top 4 KB of system RAM. Far easier to read
 * than decoding the LCD controller, and it is what the ROM actually writes into.
 */
export function screen(machine, rows = 25, cols = 80) {
  const base = machine.ram.length - 0x1000;
  const out = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const ch = machine.ram[base + (y * cols + x) * 2];
      line += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : (ch === 0 ? ' ' : '.');
    }
    out.push(line.replace(/\s+$/, ''));
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** Presses and releases one key, leaving time for the 600 Hz matrix scan. */
export function press(machine, cpu, code, holdMs = 40, gapMs = 60) {
  const sc = DEFAULT_KEYMAP[code];
  if (sc === undefined) throw new Error(`nieznany klawisz: ${code}`);
  machine.keyboard.keyDown(sc);
  run(machine, cpu, holdMs);
  machine.keyboard.keyUp(sc);
  run(machine, cpu, gapMs);
}

/** Holds a modifier down for another key - Atari + S opens Setup, for instance. */
export function chord(machine, cpu, holdCode, tapCode) {
  const hold = DEFAULT_KEYMAP[holdCode];
  machine.keyboard.keyDown(hold);
  run(machine, cpu, 60);
  press(machine, cpu, tapCode);
  machine.keyboard.keyUp(hold);
  run(machine, cpu, 60);
}

const TYPE_MAP = {
  A: 'KeyA', B: 'KeyB', C: 'KeyC', D: 'KeyD', E: 'KeyE', F: 'KeyF', G: 'KeyG',
  H: 'KeyH', I: 'KeyI', J: 'KeyJ', K: 'KeyK', L: 'KeyL', M: 'KeyM', N: 'KeyN',
  O: 'KeyO', P: 'KeyP', Q: 'KeyQ', R: 'KeyR', S: 'KeyS', T: 'KeyT', U: 'KeyU',
  V: 'KeyV', W: 'KeyW', X: 'KeyX', Y: 'KeyY', Z: 'KeyZ',
  '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4',
  '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9',
  ' ': 'Space', '\n': 'Enter', ';': 'Semicolon', '.': 'Period', ',': 'Comma',
  '-': 'Minus', '=': 'Equal', '/': 'Slash',
};

// Characters living on the shifted half of a key. Without this, typing "A:" to
// change drive quietly produces "A;" and the command does nothing.
const SHIFTED = { ':': 'Semicolon', '>': 'Period', '<': 'Comma', '?': 'Slash', '"': 'Quote' };

export function type(machine, cpu, text) {
  for (const ch of text) {
    if (SHIFTED[ch]) chord(machine, cpu, 'ShiftLeft', SHIFTED[ch]);
    else press(machine, cpu, TYPE_MAP[ch.toUpperCase()] ?? ch);
  }
}

/** Boots all the way to the DIP-DOS prompt, answering the start-up questions. */
export function bootToPrompt(machine, cpu) {
  run(machine, cpu, 2000);
  press(machine, cpu, 'Space');          // copyright screen
  run(machine, cpu, 800);
  press(machine, cpu, 'KeyE');           // keyboard layout: English
  run(machine, cpu, 800);
  press(machine, cpu, 'Enter');          // date
  run(machine, cpu, 800);
  press(machine, cpu, 'Enter');          // time
  run(machine, cpu, 1500);
  return screen(machine);
}

// Spare bytes of the MDA buffer, past the 4000 the 80x25 page occupies. Nothing
// displays them and no ROM code touches them, which makes them the one piece of
// RAM a stub can be planted in without disturbing the running session. The CPU
// sees the buffer at B0000h, so B0FA0h is offset 4000 into it.
const STUB_SEG = 0xB0FA, STUB_PHYS = 0xB0FA0;
const CS = 1, AX = 0, BX = 3, CX = 1, DX = 2;

/**
 * Calls a ROM service the way a program would, and hands back the registers.
 *
 * The interrupt is executed rather than simulated: a two-byte `INT n` followed by
 * `HLT` is planted in spare video RAM and the CPU is pointed at it, so the vector,
 * the flags and the IRET all behave exactly as they do for real code. Whatever the
 * machine was doing is lost, which is fine for a question asked of the ROM.
 *
 *   callInterrupt(machine, cpu, 0x61, { ax: 0x1E01, bx: 1 })   // tick once a second
 *
 * @returns {{ax:number, bx:number, cx:number, dx:number, halted:boolean}}
 */
export function callInterrupt(machine, cpu, vector, { ax = 0, bx = 0, cx = 0, dx = 0 } = {}) {
  [0xCD, vector & 0xFF, 0xF4].forEach((b, i) => machine.write8(STUB_PHYS + i, b));
  cpu.sregs[CS] = STUB_SEG;
  cpu.ip = 0;
  cpu.regs[AX] = ax; cpu.regs[BX] = bx; cpu.regs[CX] = cx; cpu.regs[DX] = dx;
  cpu.halted = false;

  // Generous, but bounded: a BIOS service that never returns must not hang a test.
  for (let i = 0; i < 2_000_000 && !cpu.halted; i++) machine.advance(cpu.step());

  return {
    ax: cpu.regs[AX], bx: cpu.regs[BX], cx: cpu.regs[CX], dx: cpu.regs[DX],
    halted: cpu.halted,
  };
}

/** Puts a card image in slot A. Reset the machine afterwards so the BIOS sees it. */
export function insertCard(machine, file, writable = false) {
  machine.insertCardA(new Uint8Array(fs.readFileSync(file)), writable);
}

export const cardPath = (name) => path.join(ROOT, 'cards', name);
