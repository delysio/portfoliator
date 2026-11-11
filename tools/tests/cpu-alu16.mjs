// Arytmetyka i przesunięcia w szerokości słowa.
//
// `cpu-alu.mjs` przerabia bajty wyczerpująco — wszystkie 65 536 par — i to jest
// mocna kontrola, ale sprawdza tylko jedną z dwóch szerokości. Ścieżka
// szesnastobitowa ma osobny kod: osobne `add16`, osobne `shift16`, osobne
// miejsca, w których liczy się przeniesienie połówkowe i bit znaku. Nic z tego
// nie było dotąd sprawdzane inaczej niż tym, że Portfolio się uruchamia.
//
// Par szesnastobitowych jest ponad cztery miliardy, więc wyczerpać się nie da.
// Zamiast losować na oślep, zestaw bierze **iloczyn wartości granicznych**:
// każdy bajt osobno przyjmuje 00h, 01h, 0Fh, 10h, 7Fh, 80h i FFh, bo to są
// miejsca, w których przewracają się kolejno przeniesienie połówkowe, bit znaku
// bajtu i przeniesienie między bajtami. Do tego deterministyczna próbka ze
// środka zakresu, żeby nie zostało samo obrzeże.
//
// Przy przesunięciach model odniesienia liczy **arytmetycznie, przez potęgi
// dwójki**, podczas gdy rdzeń kręci pętlą bit po bicie. To nie jest ta sama
// pomyłka zapisana dwa razy: pętla i wzór rozjeżdżają się dokładnie tam, gdzie
// takie błędy siedzą, czyli przy licznikach większych od szerokości argumentu.
//
// Osobno sprawdzane są dwie właściwości 8086, których nie mają jego następcy:
// **licznik przesunięcia nie jest maskowany** (CL = 32 to naprawdę trzydzieści
// dwa obroty pętli, a nie zero), oraz **licznik zerowy nie rusza żadnego
// znacznika**, nawet tych, które instrukcja zwykle ustawia.

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

function run(kod, ax, bx, cx, flags) {
  cpu.reset();
  cpu.sregs[0] = cpu.sregs[1] = cpu.sregs[2] = cpu.sregs[3] = 0;
  cpu.ip = BASE;
  bus.mem.set(kod, BASE);
  cpu.regs[0] = ax; cpu.regs[1] = cx; cpu.regs[2] = 0; cpu.regs[3] = bx;
  cpu.regs[4] = 0xFFF0;
  cpu.setFlags(flags & ~0x100);
  cpu.step();
  return { ax: cpu.regs[0], flags: cpu.getFlags() };
}

const par = (r) => { let b = 0, x = r & 0xFF; while (x) { b ^= x & 1; x >>= 1; } return b ? 0 : 1; };
const szp = (r) => ({ zf: r === 0 ? 1 : 0, sf: (r & 0x8000) ? 1 : 0, pf: par(r) });
const hex = (v) => v.toString(16).toUpperCase().padStart(4, '0') + 'h';

const MASKA = CF | PF | AF | ZF | SF | OF;
const spakuj = (f) => (f.cf ? CF : 0) | (f.pf ? PF : 0) | (f.af ? AF : 0)
                    | (f.zf ? ZF : 0) | (f.sf ? SF : 0) | (f.of ? OF : 0);

// Porównywane są wyłącznie te znaczniki, które model odniesienia w ogóle podaje.
// Brak pola znaczy „architektura tego nie określa" — a nie „ma być zero".
const maskaZ = (f) => (('cf' in f) ? CF : 0) | (('pf' in f) ? PF : 0) | (('af' in f) ? AF : 0)
                    | (('zf' in f) ? ZF : 0) | (('sf' in f) ? SF : 0) | (('of' in f) ? OF : 0);

let zle = 0, pierwsze = '';
const zglos = (opis) => { if (!zle) pierwsze = opis; zle++; };
const wynik = (nazwa) => check(nazwa, zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

// Wartości graniczne w obu bajtach, plus deterministyczna próbka ze środka.
function probki() {
  const v = [];
  const B = [0x00, 0x01, 0x0F, 0x10, 0x7F, 0x80, 0xFF];
  for (const hi of B) for (const lo of B) v.push((hi << 8) | lo);
  let s = 987654321;
  for (let i = 0; i < 40; i++) { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; v.push(s & 0xFFFF); }
  return v;
}
const P = probki();

// ---- 1. osiem operacji ALU na słowach ---------------------------------------

const refAdd16 = (a, b, c) => {
  const t = a + b + c, r = t & 0xFFFF;
  return { r, cf: t > 0xFFFF ? 1 : 0, af: ((a & 0xF) + (b & 0xF) + c) > 0xF ? 1 : 0,
           of: ((a & 0x8000) === (b & 0x8000) && (r & 0x8000) !== (a & 0x8000)) ? 1 : 0, ...szp(r) };
};
const refSub16 = (a, b, c) => {
  const t = a - b - c, r = t & 0xFFFF;
  return { r, cf: t < 0 ? 1 : 0, af: ((a & 0xF) - (b & 0xF) - c) < 0 ? 1 : 0,
           of: ((a & 0x8000) !== (b & 0x8000) && (r & 0x8000) !== (a & 0x8000)) ? 1 : 0, ...szp(r) };
};
const refLog16 = (r) => ({ r, cf: 0, of: 0, ...szp(r) });

{
  zle = 0;
  const NAZWY = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'];
  let ile = 0;
  for (let op = 0; op < 8; op++) {
    const logiczna = op === 1 || op === 4 || op === 6;
    for (const fl of [0x0002, 0x0013]) {
      const cin = fl & 1;
      for (const a of P) {
        for (const b of P) {
          let ref;
          switch (op) {
            case 0: ref = refAdd16(a, b, 0); break;
            case 1: ref = refLog16(a | b); break;
            case 2: ref = refAdd16(a, b, cin); break;
            case 3: ref = refSub16(a, b, cin); break;
            case 4: ref = refLog16(a & b); break;
            case 5: ref = refSub16(a, b, 0); break;
            case 6: ref = refLog16(a ^ b); break;
            default: ref = refSub16(a, b, 0); ref.r = a; break;   // CMP nie zapisuje
          }
          const got = run([op * 8 + 1, 0xD8], a, b, 0, fl);      // op AX, BX
          ile++;
          if (got.ax !== ref.r) {
            zglos(`${NAZWY[op]} ${hex(a)},${hex(b)}: AX=${hex(got.ax)}, ma być ${hex(ref.r)}`);
          } else {
            // AF po operacjach logicznych jest architektonicznie nieokreślone.
            const rozne = (got.flags ^ spakuj(ref)) & (MASKA & ~(logiczna ? AF : 0));
            if (rozne) zglos(`${NAZWY[op]} ${hex(a)},${hex(b)}: znaczniki różnią się na ${rozne.toString(16)}h`);
          }
        }
      }
    }
  }
  wynik(`ADD/OR/ADC/SBB/AND/SUB/XOR/CMP na słowach — ${ile} przypadków`);
}

// ---- 2. przesunięcia i obroty na słowach ------------------------------------
//
// Model liczony potęgami dwójki, nie pętlą. RCL i RCR obracają siedemnaście
// bitów, bo CF jest w tym obrocie pełnoprawnym bitem — stąd modulo 17.

function wzor(tryb, v, n, cin) {
  const P16 = 0x10000, P17 = 0x20000;
  if (n === 0) return null;                     // licznik zerowy: patrz kontrola niżej
  let r, cf;
  switch (tryb) {
    case 0: {   // ROL
      const k = n % 16;
      r = k ? ((v * 2 ** k) % P16) + Math.floor(v / 2 ** (16 - k)) : v;
      cf = r & 1;
      break;
    }
    case 1: {   // ROR
      const k = n % 16;
      r = k ? Math.floor(v / 2 ** k) + (v % 2 ** k) * 2 ** (16 - k) : v;
      cf = (r >> 15) & 1;
      break;
    }
    case 2: {   // RCL — obrót siedemnastobitowy
      const k = n % 17, w = cin * P16 + v;
      const r17 = k ? ((w * 2 ** k) % P17) + Math.floor(w / 2 ** (17 - k)) : w;
      r = r17 % P16; cf = Math.floor(r17 / P16);
      break;
    }
    case 3: {   // RCR
      const k = n % 17, w = cin * P16 + v;
      const r17 = k ? Math.floor(w / 2 ** k) + (w % 2 ** k) * 2 ** (17 - k) : w;
      r = r17 % P16; cf = Math.floor(r17 / P16);
      break;
    }
    case 4:           // SHL
      if (n >= 16) { r = 0; cf = n === 16 ? (v & 1) : 0; }
      else { r = (v * 2 ** n) % P16; cf = Math.floor(v / 2 ** (16 - n)) & 1; }
      break;
    case 6:           // SETMO - not SAL on the 8088, see cpu-alu.mjs
      r = 0xFFFF; cf = 0;
      break;
    case 5:           // SHR
      if (n >= 16) { r = 0; cf = n === 16 ? (v >> 15) & 1 : 0; }
      else { r = Math.floor(v / 2 ** n); cf = Math.floor(v / 2 ** (n - 1)) & 1; }
      break;
    default: {        // SAR
      const sv = (v << 16) >> 16;
      if (n >= 16) { r = sv < 0 ? 0xFFFF : 0; cf = sv < 0 ? 1 : 0; }
      else { r = Math.floor(sv / 2 ** n) & 0xFFFF; cf = Math.floor(sv / 2 ** (n - 1)) & 1; }
      break;
    }
  }
  const ref = { r, cf };
  if (tryb >= 4) Object.assign(ref, szp(r));    // obroty nie ruszają S/Z/P
  if (n === 1) {                                // OF określone tylko przy liczniku 1
    if (tryb === 6) ref.of = 0;
    else if (tryb === 0 || tryb === 2 || tryb === 4) ref.of = ((r >> 15) & 1) ^ cf;
    else if (tryb === 1 || tryb === 3) ref.of = ((r >> 15) & 1) ^ ((r >> 14) & 1);
    else if (tryb === 5) ref.of = (v >> 15) & 1;
    else ref.of = 0;
  }
  return ref;
}

{
  const NAZWY = ['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SETMO', 'SAR'];

  // Postać z licznikiem w CL, przez cały zakres liczników — także takich,
  // które przekraczają szerokość argumentu.
  zle = 0;
  let ile = 0;
  const LICZNIKI = [1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 18, 31, 32, 33, 63, 64, 127, 255];
  for (let tryb = 0; tryb < 8; tryb++) {
    for (const cin of [0, 1]) {
      for (const v of P) {
        for (const n of LICZNIKI) {
          const ref = wzor(tryb, v, n, cin);
          const got = run([0xD3, 0xC0 | (tryb << 3)], v, 0, n, 0x0002 | (cin ? CF : 0));
          ile++;
          if (got.ax !== ref.r) {
            zglos(`${NAZWY[tryb]} ${hex(v)} o ${n}: AX=${hex(got.ax)}, ma być ${hex(ref.r)}`);
          } else {
            // AF po przesunięciach jest nieokreślone, OF — tylko przy liczniku 1.
            const rozne = (got.flags ^ spakuj(ref)) & maskaZ(ref) & ~AF;
            if (rozne) zglos(`${NAZWY[tryb]} ${hex(v)} o ${n} przy CF=${cin}: znaczniki różnią się na ${rozne.toString(16)}h`);
          }
        }
      }
    }
  }
  wynik(`ROL/ROR/RCL/RCR/SHL/SHR/SAR na słowach, licznik w CL — ${ile} przypadków`);

  // Postać z licznikiem wpisanym w opkod (D1 dla słów, D0 dla bajtów). To osobna
  // gałąź dekodera niż postać z CL, więc osobno sprawdzona — na gęstej próbce,
  // bo tu licznik jest zawsze jeden i OF jest w pełni określone.
  zle = 0;
  ile = 0;
  for (let tryb = 0; tryb < 8; tryb++) {
    for (const cin of [0, 1]) {
      for (let v = 0; v < 0x10000; v += 7) {
        const ref = wzor(tryb, v, 1, cin);
        const got = run([0xD1, 0xC0 | (tryb << 3)], v, 0, 0, 0x0002 | (cin ? CF : 0));
        ile++;
        if (got.ax !== ref.r) {
          zglos(`${NAZWY[tryb]} ${hex(v)} o 1: AX=${hex(got.ax)}, ma być ${hex(ref.r)}`);
        } else {
          const rozne = (got.flags ^ spakuj(ref)) & maskaZ(ref) & ~AF;
          if (rozne) zglos(`${NAZWY[tryb]} ${hex(v)} o 1 przy CF=${cin}: znaczniki różnią się na ${rozne.toString(16)}h`);
        }
      }
    }
  }
  wynik(`postać jednobitowa D1 — ${ile} przypadków`);

  // I to samo dla bajtów: D0 obok sprawdzonego już D2.
  zle = 0;
  for (let tryb = 0; tryb < 8; tryb++) {
    for (const cin of [0, 1]) {
      for (let v = 0; v < 256; v++) {
        const przezCl = run([0xD2, 0xC0 | (tryb << 3)], v, 0, 1, 0x0002 | (cin ? CF : 0));
        const wOpkodzie = run([0xD0, 0xC0 | (tryb << 3)], v, 0, 0, 0x0002 | (cin ? CF : 0));
        if ((przezCl.ax & 0xFF) !== (wOpkodzie.ax & 0xFF) || przezCl.flags !== wOpkodzie.flags) {
          zglos(`${NAZWY[tryb]} ${v} o 1: D0 dało ${(wOpkodzie.ax & 0xFF).toString(16)}/${wOpkodzie.flags.toString(16)}, D2 z CL=1 ${(przezCl.ax & 0xFF).toString(16)}/${przezCl.flags.toString(16)}`);
        }
      }
    }
  }
  wynik('D0 i D2 z CL=1 dają dokładnie to samo');
}

// ---- 3. dwie właściwości 8086, których nie mają następcy --------------------

{
  // Licznik nie jest maskowany. Na 80186 i dalej CL byłoby brane modulo 32, więc
  // CL=32 zostawiłoby AX bez zmian; na 8086 pętla kręci się 32 razy i wypycha
  // wszystko za krawędź.
  const o32 = run([0xD3, 0xE0], 0xFFFF, 0, 32, 0x0002);            // SHL AX, CL
  const o16 = run([0xD3, 0xE0], 0xFFFF, 0, 16, 0x0002);
  check('licznik przesunięcia nie jest maskowany do pięciu bitów',
        o32.ax === 0x0000 && o16.ax === 0x0000,
        `CL=32 dało ${hex(o32.ax)}, CL=16 dało ${hex(o16.ax)}`);

  // Rotacja o 32 to na słowie dokładnie dwa pełne obroty, więc wartość wraca —
  // ale przez pętlę, nie przez zamaskowanie licznika. Kontrola jest ostrożna:
  // sama wartość by tego nie odróżniła, więc patrzę na CF, który po ostatnim
  // obrocie ma pokazywać bit wysunięty, a nie stan sprzed instrukcji.
  const obrot = run([0xD3, 0xC0], 0x8001, 0, 32, 0x0002);          // ROL AX, CL
  check('ROL o 32 wraca do wartości wyjściowej, ale przez pętlę',
        obrot.ax === 0x8001 && (obrot.flags & CF) === CF,
        `AX=${hex(obrot.ax)}, CF=${(obrot.flags & CF) ? 1 : 0}`);

  // Licznik zerowy nie rusza niczego, łącznie ze znacznikami, które SHL zwykle
  // ustawia. Sprawdzam na wartości, która przy jakimkolwiek przesunięciu
  // zmieniłaby i ZF, i SF, i CF.
  zle = 0;
  const WEJSCIE = 0x0002 | CF | ZF | SF | OF | PF | AF;
  for (let tryb = 0; tryb < 8; tryb++) {
    const got = run([0xD3, 0xC0 | (tryb << 3)], 0x8001, 0, 0, WEJSCIE);
    if (got.ax !== 0x8001) zglos(`tryb ${tryb}: licznik 0 zmienił AX na ${hex(got.ax)}`);
    if ((got.flags & MASKA) !== (WEJSCIE & MASKA)) {
      zglos(`tryb ${tryb}: licznik 0 ruszył znaczniki (${(WEJSCIE & MASKA).toString(16)}h → ${(got.flags & MASKA).toString(16)}h)`);
    }
  }
  wynik('licznik zerowy nie zmienia ani argumentu, ani żadnego znacznika');
}

process.exit(fails ? 1 : 0);
