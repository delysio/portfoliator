// 8086/8088 disassembler, for the inspector.
//
// Deliberately small. It decodes one instruction at a time from a byte reader
// and returns the text plus how many bytes it took, which is all a memory
// window needs to walk forwards. It has no notion of symbols, no formatting
// options and no state between calls.
//
// A disassembler is only as useful as its coverage, and the coverage here is
// aimed at what actually appears in Portfolio ROM and in the programs that run
// on it: the whole one-byte map, the group opcodes, both string blocks with
// their prefixes, and the segment overrides. The undocumented corners the
// emulator implements on purpose - 82h as an alias of 80h, D6h as SALC, 0Fh as
// POP CS, 60-6F as the conditional jumps, F1h as a second LOCK - are decoded
// too, and marked, because the only reason to look at them in an inspector is
// that something unexpected got there.
//
// Anything genuinely unassigned comes back as `db XXh`, one byte long, so the
// walk never desynchronises on a bad guess.

const REG16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const REG8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const SREG = ['es', 'cs', 'ss', 'ds'];
const RM = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'];

const COND = ['o', 'no', 'b', 'nb', 'z', 'nz', 'be', 'nbe',
              's', 'ns', 'p', 'np', 'l', 'nl', 'le', 'nle'];

const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
const SHIFT = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sal', 'sar'];

const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0') + 'h';

/** Signed byte as it should read in an address expression: `bx+si-4`. */
function disp8(v) {
  const s = (v & 0x80) ? v - 0x100 : v;
  return (s < 0 ? '-' : '+') + hex(Math.abs(s), 2);
}

/**
 * Disassembles one instruction.
 *
 * Relative jumps are printed as absolute offsets, so the caller has to say
 * where the instruction starts. Left at zero the targets come out relative to
 * the instruction itself, which is right for a lone byte sequence and wrong
 * for anything read out of memory - disasmRange below fills it in.
 *
 * @param {(offset:number)=>number} read  byte at `addr + offset`
 * @param {number} [origin]  offset the instruction starts at, for jump targets
 * @returns {{text:string, len:number}}
 */
export function disasm(read, origin = 0) {
  let p = 0;
  const b = () => read(p++) & 0xFF;
  const w = () => { const lo = b(); return lo | (b() << 8); };

  let seg = '';           // segment override, printed inside the brackets
  let rep = '';           // rep / repne
  let lock = '';

  // ---- prefixes -----------------------------------------------------------
  for (;;) {
    const c = read(p) & 0xFF;
    if (c === 0x26 || c === 0x2E || c === 0x36 || c === 0x3E) { seg = SREG[(c >> 3) & 3] + ':'; p++; }
    else if (c === 0xF2) { rep = 'repne '; p++; }
    else if (c === 0xF3) { rep = 'rep '; p++; }
    else if (c === 0xF0 || c === 0xF1) { lock = 'lock '; p++; }
    else break;
  }

  const op = b();
  const pre = lock + rep;
  const done = (text) => ({ text: pre + text, len: p });

  // ---- ModRM --------------------------------------------------------------
  let mod = 0, reg = 0, rm = 0, mem = '';
  function modrm(wide) {
    const m = b();
    mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7;
    if (mod === 3) { mem = wide ? REG16[rm] : REG8[rm]; return; }
    if (mod === 0 && rm === 6) { mem = `[${seg}${hex(w(), 4)}]`; return; }
    const d = mod === 1 ? disp8(b()) : mod === 2 ? '+' + hex(w(), 4) : '';
    mem = `[${seg}${RM[rm]}${d}]`;
  }
  const r = (wide) => (wide ? REG16[reg] : REG8[reg]);

  // ---- the map ------------------------------------------------------------

  // 00-3F: the ALU block, plus the segment pushes and the BCD adjusts.
  if (op < 0x40 && (op & 7) < 6) {
    const name = ALU[op >> 3];
    const wide = (op & 1) !== 0;
    switch (op & 7) {
      case 0: case 1: modrm(wide); return done(`${name} ${mem}, ${r(wide)}`);
      case 2: case 3: modrm(wide); return done(`${name} ${r(wide)}, ${mem}`);
      case 4: return done(`${name} al, ${hex(b(), 2)}`);
      case 5: return done(`${name} ax, ${hex(w(), 4)}`);
    }
  }
  if (op < 0x40 && (op & 7) === 6) return done(`push ${SREG[op >> 3]}`);
  if (op === 0x0F) return done('pop cs            ; nieudokumentowane');
  if (op < 0x40 && (op & 7) === 7) return done(`pop ${SREG[op >> 3]}`);

  if (op === 0x27) return done('daa');
  if (op === 0x2F) return done('das');
  if (op === 0x37) return done('aaa');
  if (op === 0x3F) return done('aas');

  if (op >= 0x40 && op <= 0x47) return done(`inc ${REG16[op & 7]}`);
  if (op >= 0x48 && op <= 0x4F) return done(`dec ${REG16[op & 7]}`);
  if (op >= 0x50 && op <= 0x57) return done(`push ${REG16[op & 7]}`);
  if (op >= 0x58 && op <= 0x5F) return done(`pop ${REG16[op & 7]}`);

  // The 8086 decodes the conditional jumps from five bits, so 60-6F land on the
  // same sixteen conditions as 70-7F. The core takes that alias, and a window
  // that showed `db 60h` here would be one byte out for everything after it.
  if (op >= 0x60 && op <= 0x7F) {
    const d = b(); const s = (d & 0x80) ? d - 0x100 : d;
    const uwaga = op < 0x70 ? `   ; nieudokumentowany alias ${hex(op + 0x10, 2)}` : '';
    return done(`j${COND[op & 15]} ${hex((origin + p + s) & 0xFFFF, 4)}${uwaga}`);
  }

  if (op === 0x80 || op === 0x81 || op === 0x82 || op === 0x83) {
    const wide = (op & 1) !== 0;
    modrm(wide);
    const imm = (op === 0x81) ? hex(w(), 4) : hex(b(), 2);
    const uwaga = op === 0x82 ? '   ; nieudokumentowany alias 80h' : '';
    return done(`${ALU[reg]} ${mem}, ${imm}${uwaga}`);
  }

  if (op === 0x84 || op === 0x85) { const wd = op & 1; modrm(wd); return done(`test ${mem}, ${r(wd)}`); }
  if (op === 0x86 || op === 0x87) { const wd = op & 1; modrm(wd); return done(`xchg ${mem}, ${r(wd)}`); }
  if (op >= 0x88 && op <= 0x8B) {
    const wd = op & 1; modrm(wd);
    return done((op & 2) ? `mov ${r(wd)}, ${mem}` : `mov ${mem}, ${r(wd)}`);
  }
  if (op === 0x8C) { modrm(true); return done(`mov ${mem}, ${SREG[reg & 3]}`); }
  if (op === 0x8D) { modrm(true); return done(`lea ${REG16[reg]}, ${mem}`); }
  if (op === 0x8E) { modrm(true); return done(`mov ${SREG[reg & 3]}, ${mem}`); }
  if (op === 0x8F) { modrm(true); return done(`pop ${mem}`); }

  if (op === 0x90) return done('nop');
  if (op > 0x90 && op <= 0x97) return done(`xchg ax, ${REG16[op & 7]}`);
  if (op === 0x98) return done('cbw');
  if (op === 0x99) return done('cwd');
  if (op === 0x9A) { const off = w(), sg = w(); return done(`call ${hex(sg, 4)}:${hex(off, 4)}`); }
  if (op === 0x9B) return done('wait');
  if (op === 0x9C) return done('pushf');
  if (op === 0x9D) return done('popf');
  if (op === 0x9E) return done('sahf');
  if (op === 0x9F) return done('lahf');

  if (op >= 0xA0 && op <= 0xA3) {
    const wd = op & 1, a = `[${seg}${hex(w(), 4)}]`, acc = wd ? 'ax' : 'al';
    return done((op & 2) ? `mov ${a}, ${acc}` : `mov ${acc}, ${a}`);
  }
  if (op === 0xA4 || op === 0xA5) return done(`movs${op & 1 ? 'w' : 'b'}`);
  if (op === 0xA6 || op === 0xA7) return done(`cmps${op & 1 ? 'w' : 'b'}`);
  if (op === 0xA8) return done(`test al, ${hex(b(), 2)}`);
  if (op === 0xA9) return done(`test ax, ${hex(w(), 4)}`);
  if (op === 0xAA || op === 0xAB) return done(`stos${op & 1 ? 'w' : 'b'}`);
  if (op === 0xAC || op === 0xAD) return done(`lods${op & 1 ? 'w' : 'b'}`);
  if (op === 0xAE || op === 0xAF) return done(`scas${op & 1 ? 'w' : 'b'}`);

  if (op >= 0xB0 && op <= 0xB7) return done(`mov ${REG8[op & 7]}, ${hex(b(), 2)}`);
  if (op >= 0xB8 && op <= 0xBF) return done(`mov ${REG16[op & 7]}, ${hex(w(), 4)}`);

  if (op === 0xC0 || op === 0xC2) return done(`ret ${hex(w(), 4)}`);
  if (op === 0xC1 || op === 0xC3) return done('ret');
  if (op === 0xC4) { modrm(true); return done(`les ${REG16[reg]}, ${mem}`); }
  if (op === 0xC5) { modrm(true); return done(`lds ${REG16[reg]}, ${mem}`); }
  if (op === 0xC6) { modrm(false); return done(`mov ${mem}, ${hex(b(), 2)}`); }
  if (op === 0xC7) { modrm(true); return done(`mov ${mem}, ${hex(w(), 4)}`); }
  if (op === 0xC8 || op === 0xCA) return done(`retf ${hex(w(), 4)}`);
  if (op === 0xC9 || op === 0xCB) return done('retf');
  if (op === 0xCC) return done('int 3');
  if (op === 0xCD) return done(`int ${hex(b(), 2)}`);
  if (op === 0xCE) return done('into');
  if (op === 0xCF) return done('iret');

  if (op >= 0xD0 && op <= 0xD3) {
    const wd = op & 1; modrm(wd);
    return done(`${SHIFT[reg]} ${mem}, ${(op & 2) ? 'cl' : '1'}`);
  }
  if (op === 0xD4) { const n = b(); return done(n === 0x0A ? 'aam' : `aam ${hex(n, 2)}`); }
  if (op === 0xD5) { const n = b(); return done(n === 0x0A ? 'aad' : `aad ${hex(n, 2)}`); }
  if (op === 0xD6) return done('salc              ; nieudokumentowane');
  if (op === 0xD7) return done('xlat');
  if (op >= 0xD8 && op <= 0xDF) { modrm(true); return done(`esc ${op & 7}, ${mem}`); }

  if (op >= 0xE0 && op <= 0xE3) {
    const nazwy = ['loopne', 'loope', 'loop', 'jcxz'];
    const d = b(); const s = (d & 0x80) ? d - 0x100 : d;
    return done(`${nazwy[op & 3]} ${hex((origin + p + s) & 0xFFFF, 4)}`);
  }
  if (op === 0xE4) return done(`in al, ${hex(b(), 2)}`);
  if (op === 0xE5) return done(`in ax, ${hex(b(), 2)}`);
  if (op === 0xE6) return done(`out ${hex(b(), 2)}, al`);
  if (op === 0xE7) return done(`out ${hex(b(), 2)}, ax`);
  if (op === 0xE8 || op === 0xE9) {
    const d = w(); const s = (d & 0x8000) ? d - 0x10000 : d;
    return done(`${op === 0xE8 ? 'call' : 'jmp'} ${hex((origin + p + s) & 0xFFFF, 4)}`);
  }
  if (op === 0xEA) { const off = w(), sg = w(); return done(`jmp ${hex(sg, 4)}:${hex(off, 4)}`); }
  if (op === 0xEB) {
    const d = b(); const s = (d & 0x80) ? d - 0x100 : d;
    return done(`jmp short ${hex((origin + p + s) & 0xFFFF, 4)}`);
  }
  if (op === 0xEC) return done('in al, dx');
  if (op === 0xED) return done('in ax, dx');
  if (op === 0xEE) return done('out dx, al');
  if (op === 0xEF) return done('out dx, ax');

  if (op === 0xF4) return done('hlt');
  if (op === 0xF5) return done('cmc');
  if (op === 0xF6 || op === 0xF7) {
    const wd = op & 1; modrm(wd);
    const nazwy = ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'];
    if (reg < 2) return done(`test ${mem}, ${wd ? hex(w(), 4) : hex(b(), 2)}`);
    return done(`${nazwy[reg]} ${mem}`);
  }
  if (op === 0xF8) return done('clc');
  if (op === 0xF9) return done('stc');
  if (op === 0xFA) return done('cli');
  if (op === 0xFB) return done('sti');
  if (op === 0xFC) return done('cld');
  if (op === 0xFD) return done('std');
  if (op === 0xFE) {
    modrm(false);
    return done(`${reg === 0 ? 'inc' : 'dec'} ${mem}`);
  }
  if (op === 0xFF) {
    modrm(true);
    // Reg field 7 is not an instruction. Printing `db [bx+si]` - which is what
    // naming it in the table alongside the others did - reads as an address
    // expression that means nothing. Dump the bytes instead, keeping the length,
    // because the core consumes the mod r/m byte here whatever the reg field.
    if (reg === 7) {
      const bajty = [];
      for (let i = 0; i < p; i++) bajty.push(hex(read(i) & 0xFF, 2));
      return done(`db ${bajty.join(', ')}`);
    }
    const nazwy = ['inc', 'dec', 'call', 'call far', 'jmp', 'jmp far', 'push'];
    return done(`${nazwy[reg]} ${mem}`);
  }

  return { text: pre + `db ${hex(op, 2)}`, len: p };
}

/**
 * Walks `count` instructions from `seg:off`, reading through `read8` on linear
 * addresses. Each line carries the address, the raw bytes and the text, which
 * is what a window pane wants and what a test can compare against.
 */
export function disasmRange(read8, seg, off, count) {
  const out = [];
  let o = off & 0xFFFF;
  for (let i = 0; i < count; i++) {
    const base = ((seg << 4) + o) & 0xFFFFF;
    const { text, len } = disasm((k) => read8((base + k) & 0xFFFFF), o);
    const bytes = [];
    for (let k = 0; k < len; k++) bytes.push(read8((base + k) & 0xFFFFF));
    out.push({
      seg, off: o, text, len,
      bytes: bytes.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    });
    o = (o + len) & 0xFFFF;
  }
  return out;
}
