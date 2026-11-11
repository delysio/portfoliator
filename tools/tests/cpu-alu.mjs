// Arytmetyka procesora wobec niezależnego modelu.
//
// Każdy przypadek składa jedną prawdziwą instrukcję, przepuszcza ją przez
// step() rdzenia i porównuje rejestry oraz te znaczniki, które architektura
// w ogóle definiuje. Model odniesienia liczy to samo inaczej — przeniesienie
// połówkowe z arytmetyki na nibblach, przesunięcia modulo zamiast pętli — żeby
// wspólna pomyłka nie mogła się skasować.
//
// Powstało przy szukaniu zupełnie innego błędu. Wyszło stąd, że IMUL na bajtach
// ustawiał CF i OF wedle tego, czy AH wynosi 00 albo FF, a to nie to samo, co
// „iloczyn zmieścił się w AL": 2 × 64 daje AH=00 i AL=80h, czyli −128 odczytane
// z powrotem jako bajt — wynik przepadł, a znaczniki mówiły, że jest dobrze.
// Myliło się 2258 z 65 536 par. Szukanego błędu to nie było, ale znalezione
// zostaje znalezione.

import { CPU8088 } from '../../js/emu/cpu8088.js';

const CF = 0x001, PF = 0x004, AF = 0x010, ZF = 0x040, SF = 0x080, OF = 0x800;

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

class Bus {
  constructor() { this.mem = new Uint8Array(1 << 20); }
  read8(a) { return this.mem[a & 0xFFFFF]; }
  write8(a, v) { this.mem[a & 0xFFFFF] = v & 0xFF; }
  in8() { return 0xFF; }
  out8() {}
  intAck() { return 0xFF; }
}

const bus = new Bus();
const cpu = new CPU8088(bus);
const BASE = 0x2000;

// Przerwanie 0 (dzielenie przez zero) skacze na HLT, żeby dało się je poznać.
bus.mem[3] = 0xF0;
bus.mem[0xF0000] = 0xF4;

function run(code, ax, bx, cx, flags) {
  cpu.reset();
  cpu.sregs[0] = cpu.sregs[1] = cpu.sregs[2] = cpu.sregs[3] = 0;
  cpu.ip = BASE;
  bus.mem.set(code, BASE);
  cpu.regs[0] = ax; cpu.regs[1] = cx; cpu.regs[2] = 0; cpu.regs[3] = bx;
  cpu.regs[4] = 0xFFF0;
  cpu.setFlags(flags & ~0x100);            // bez pułapki, inaczej step() ją weźmie
  cpu.step();
  return { ax: cpu.regs[0], flags: cpu.getFlags(), przerwanie: cpu.sregs[1] === 0xF000 };
}

const par = (r) => { let b = 0, x = r & 0xFF; while (x) { b ^= x & 1; x >>= 1; } return b ? 0 : 1; };
const szp = (r) => ({ zf: r === 0 ? 1 : 0, sf: (r & 0x80) ? 1 : 0, pf: par(r) });

const refAdd = (a, b, c) => {
  const t = a + b + c, r = t & 0xFF;
  return { r, cf: t > 0xFF ? 1 : 0, af: ((a & 0xF) + (b & 0xF) + c) > 0xF ? 1 : 0,
           of: ((a & 0x80) === (b & 0x80) && (r & 0x80) !== (a & 0x80)) ? 1 : 0, ...szp(r) };
};
const refSub = (a, b, c) => {
  const t = a - b - c, r = t & 0xFF;
  return { r, cf: t < 0 ? 1 : 0, af: ((a & 0xF) - (b & 0xF) - c) < 0 ? 1 : 0,
           of: ((a & 0x80) !== (b & 0x80) && (r & 0x80) !== (a & 0x80)) ? 1 : 0, ...szp(r) };
};
const refLog = (r) => ({ r, cf: 0, of: 0, ...szp(r) });

function maski(ref) {
  let m = 0;
  if ('cf' in ref) m |= CF; if ('pf' in ref) m |= PF; if ('af' in ref) m |= AF;
  if ('zf' in ref) m |= ZF; if ('sf' in ref) m |= SF; if ('of' in ref) m |= OF;
  return m;
}
function spakuj(ref) {
  return (ref.cf ? CF : 0) | (ref.pf ? PF : 0) | (ref.af ? AF : 0)
       | (ref.zf ? ZF : 0) | (ref.sf ? SF : 0) | (ref.of ? OF : 0);
}

let zle = 0, pierwsze = '';
function porownaj(opis, got, wynik, ref, pomin = 0) {
  const m = maski(ref) & ~pomin;
  const rozne = (got.flags ^ spakuj(ref)) & m;
  if ((wynik !== null && (got.ax & 0xFF) !== wynik) || rozne) {
    if (!zle) {
      pierwsze = `${opis}: AL=${(got.ax & 0xFF).toString(16)}`
        + (wynik !== null ? ` (ma być ${wynik.toString(16)})` : '')
        + (rozne ? `, znaczniki różnią się na ${rozne.toString(16)}` : '');
    }
    zle++;
  }
}

// ---- 1. dodawanie, odejmowanie i logika: wszystkie 65 536 par --------------

{
  zle = 0;
  const NAZWY = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'];
  for (let op = 0; op < 8; op++) {
    const logiczna = op === 1 || op === 4 || op === 6;
    for (const fl of [0x0002, 0x0013]) {
      const cin = fl & 1;
      for (let a = 0; a < 256; a++) {
        for (let b = 0; b < 256; b++) {
          let ref;
          switch (op) {
            case 0: ref = refAdd(a, b, 0); break;
            case 1: ref = refLog(a | b); break;
            case 2: ref = refAdd(a, b, cin); break;
            case 3: ref = refSub(a, b, cin); break;
            case 4: ref = refLog(a & b); break;
            case 5: ref = refSub(a, b, 0); break;
            case 6: ref = refLog(a ^ b); break;
            default: ref = refSub(a, b, 0); ref.r = a; break;
          }
          const got = run([op * 8, 0xC0 | (3 << 3)], a, b, 0, fl);
          // AF po AND/OR/XOR jest architektonicznie nieokreślone.
          porownaj(`${NAZWY[op]} ${a}, ${b}`, got, ref.r, ref, logiczna ? AF : 0);
        }
      }
    }
  }
  check('ADD/OR/ADC/SBB/AND/SUB/XOR/CMP na bajtach — 262 144 przypadki',
        zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 2. mnożenie ze znakiem i bez: wszystkie 65 536 par --------------------

{
  zle = 0;
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      const iloczyn = a * b;
      let got = run([0xF6, 0xE3], a, b, 0, 2);                    // MUL BL
      if (got.ax !== (iloczyn & 0xFFFF)) { if (!zle) pierwsze = `MUL ${a}*${b} dało AX=${got.ax}`; zle++; }
      else porownaj(`MUL ${a}*${b}`, got, null,
                    { cf: (iloczyn >> 8) ? 1 : 0, of: (iloczyn >> 8) ? 1 : 0 });
    }
  }
  check('MUL na bajtach — 65 536 par', zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

  zle = 0;
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      const sa = (a << 24) >> 24, sb = (b << 24) >> 24, iloczyn = sa * sb;
      const got = run([0xF6, 0xEB], a, b, 0, 2);                  // IMUL BL
      // CF i OF mówią, że iloczyn nie zmieścił się w samym AL.
      const zmiescil = iloczyn >= -128 && iloczyn <= 127;
      if (got.ax !== (iloczyn & 0xFFFF)) { if (!zle) pierwsze = `IMUL ${sa}*${sb} dało AX=${got.ax.toString(16)}`; zle++; }
      else porownaj(`IMUL ${sa}*${sb}`, got, null, { cf: zmiescil ? 0 : 1, of: zmiescil ? 0 : 1 });
    }
  }
  check('IMUL na bajtach — 65 536 par', zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 3. przesunięcia i obroty ----------------------------------------------

{
  zle = 0;
  const LICZNIKI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 63, 255];
  for (let tryb = 0; tryb < 8; tryb++) {
    for (const fl of [0x0002, 0x0003]) {
      const cin = fl & 1;
      for (let v = 0; v < 256; v++) {
        for (const n of LICZNIKI) {
          let r, cf = cin;
          switch (tryb) {
            case 0: { const k = n % 8; r = k ? ((v << k) | (v >>> (8 - k))) & 0xFF : v; cf = r & 1; break; }
            case 1: { const k = n % 8; r = k ? ((v >>> k) | (v << (8 - k))) & 0xFF : v; cf = (r >> 7) & 1; break; }
            case 2: { let w = cin * 256 + v; for (let i = 0; i < n % 9; i++) { const t = w >= 256 ? 1 : 0; w = (w & 0xFF) * 2 + t; }
                      r = w & 0xFF; cf = w > 0xFF ? 1 : 0; break; }
            case 3: { let w = cin * 256 + v; for (let i = 0; i < n % 9; i++) { const t = w & 1; w = Math.floor(w / 2) + t * 256; }
                      r = w & 0xFF; cf = w > 0xFF ? 1 : 0; break; }
            case 4:
              if (n >= 8) { r = 0; cf = n === 8 ? (v & 1) : 0; }
              else { r = (v << n) & 0xFF; cf = (v >>> (8 - n)) & 1; }
              break;
            // /6 is not an alias of SHL on the 8088 but SETMO: all ones, CF, OF and AF
            // clear, S/Z/P from the result (and nothing at all with CL = 0). That is
            // what SingleStepTests recorded on a real 8088 for D0.6-D3.6, and what this
            // core does to the last flag on all 40 000 of those cases.
            case 6: r = 0xFF; cf = 0; break;
            case 5:
              if (n >= 8) { r = 0; cf = n === 8 ? (v >> 7) & 1 : 0; }
              else { r = v >>> n; cf = (v >>> (n - 1)) & 1; }
              break;
            default: {
              const sv = (v << 24) >> 24;
              if (n >= 8) { r = sv < 0 ? 0xFF : 0; cf = sv < 0 ? 1 : 0; }
              else { r = (sv >> n) & 0xFF; cf = (sv >> (n - 1)) & 1; }
              break;
            }
          }
          const ref = { r, cf };
          // Obroty nie ruszają S/Z/P, a OF jest określone tylko przy liczniku 1.
          if (tryb >= 4) Object.assign(ref, szp(r));
          if (n === 1) {
            if (tryb === 6) ref.of = 0;
            else if (tryb === 0 || tryb === 2 || tryb === 4) ref.of = ((r >> 7) & 1) ^ cf;
            else if (tryb === 1 || tryb === 3) ref.of = ((r >> 7) & 1) ^ ((r >> 6) & 1);
            else if (tryb === 5) ref.of = (v >> 7) & 1;
            else ref.of = 0;
          }
          const got = run([0xD2, 0xC0 | (tryb << 3)], v, 0, n, fl);
          porownaj(`tryb ${tryb} ${v}>>${n}`, got, r, ref, tryb < 4 ? AF : 0);
        }
      }
    }
  }
  check('ROL/ROR/RCL/RCR/SHL/SHR/SAR — 65 536 przypadków', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 4. dzielenie, razem z przepełnieniem ilorazu ---------------------------

{
  zle = 0;
  for (let n = 0; n < 0x10000; n += 13) {
    for (let d = 0; d < 256; d += 3) {
      const got = run([0xF6, 0xF3], n, d, 0, 2);                  // DIV BL
      if (d === 0 || Math.floor(n / d) > 0xFF) {
        if (!got.przerwanie) { if (!zle) pierwsze = `DIV ${n}/${d} nie zgłosiło przerwania 0`; zle++; }
      } else if (got.przerwanie) {
        if (!zle) pierwsze = `DIV ${n}/${d} zgłosiło przerwanie 0 bez powodu`; zle++;
      } else {
        const chce = (Math.floor(n / d) & 0xFF) | ((n % d) << 8);
        if (got.ax !== chce) { if (!zle) pierwsze = `DIV ${n}/${d} dało AX=${got.ax.toString(16)}, ma być ${chce.toString(16)}`; zle++; }
      }
    }
  }
  check('DIV na bajtach, z kontrolą przepełnienia ilorazu', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

process.exit(fails ? 1 : 0);
