// Mnożenie i dzielenie szesnastobitowe, dzielenie ze znakiem, oraz drobiazgi
// wokół nich: NEG, NOT, INC, DEC, CBW, CWD.
//
// `cpu-alu.mjs` przerobił arytmetykę bajtową wyczerpująco i znalazł tam błąd
// w znacznikach IMUL. Ten zestaw bierze to, co tamten zostawił: całą szerokość
// szesnastobitową, obie postacie dzielenia i przypadki brzegowe, w których
// dzielenie zgłasza przerwanie zamiast wyniku.
//
// Odniesieniem jest arytmetyka JavaScriptu w liczbach zmiennoprzecinkowych.
// Wolno jej tutaj zaufać: iloczyn dwóch liczb szesnastobitowych ma najwyżej
// 32 bity, a dzielna 32, więc wszystko mieści się w 53 bitach mantysy dokładnie,
// bez zaokrągleń. `Math.trunc` obcina do zera dokładnie tak, jak procesor.
//
// **Zakres ilorazu, zmierzony na sprzęcie 2026-08-26** (`IDIVTEST.COM`). Każdy
// podręcznik podaje go jako −128…127 dla bajtu i −32768…32767 dla słowa, i każdy
// podręcznik opisuje w tym miejscu procesor późniejszy niż 8086. Prawdziwe
// Portfolio zgłasza przerwanie także dla **−128 i −32768**: sprawdzana jest
// wartość bezwzględna ilorazu, nie zakres ze znakiem, więc wolno tylko
// −127…127 i −32767…32767. Rdzeń przez cały czas przepuszczał dno zakresu i tu
// właśnie się to skończyło — kontrola nazwana wtedy „wybór z podręcznika, nie
// pomiar" upadła jako pierwsza, dokładnie po to tam stała.
//
// Pomiarowi można ufać, bo miał kontrole po obu stronach: +128 i +32768 muszą
// zgłosić przerwanie (i zgłosiły), a −127 i −32767 muszą przejść (i przeszły).
// Bez nich „wszystko zgłasza przerwanie" wyglądałoby tak samo.
//
// Przy okazji zmierzone: **adres powrotu po przerwaniu 0 wskazuje za instrukcję**,
// a nie na nią. Rdzeń robił tak od początku, ale nikt tego nie sprawdził.

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

bus.mem[3] = 0xF0;
bus.mem[0xF0000] = 0xF4;

function run(code, { ax = 0, bx = 0, dx = 0, flags = 0x0002 }) {
  cpu.reset();
  cpu.sregs[0] = cpu.sregs[1] = cpu.sregs[2] = cpu.sregs[3] = 0;
  cpu.ip = BASE;
  bus.mem.set(code, BASE);
  cpu.regs[0] = ax; cpu.regs[1] = 0; cpu.regs[2] = dx; cpu.regs[3] = bx;
  cpu.regs[4] = 0xFFF0;
  cpu.setFlags(flags & ~0x100);
  cpu.step();
  return { ax: cpu.regs[0], dx: cpu.regs[2], al: cpu.regs[0] & 0xFF, ah: (cpu.regs[0] >> 8) & 0xFF,
           flags: cpu.getFlags(), przerwanie: cpu.sregs[1] === 0xF000 };
}

const par = (r) => { let b = 0, x = r & 0xFF; while (x) { b ^= x & 1; x >>= 1; } return b ? 0 : 1; };
const s8 = (v) => (v << 24) >> 24;
const s16 = (v) => (v << 16) >> 16;
const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0') + 'h';

let zle = 0, pierwsze = '';
const zglos = (opis) => { if (!zle) pierwsze = opis; zle++; };
const wynik = (nazwa) => check(nazwa, zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

// Wartości brzegowe plus deterministyczny ciąg pseudolosowy, żeby środek zakresu
// też był odwiedzony. Generator jest liniowy i zapisany wprost — ma dawać ten sam
// zestaw przy każdym uruchomieniu, bo test, który raz przechodzi a raz nie,
// jest gorszy niż żaden.
function probki() {
  const v = [0, 1, 2, 3, 0x7F, 0x80, 0x81, 0xFF, 0x100, 0x1000, 0x3FFF, 0x4000,
             0x7FFE, 0x7FFF, 0x8000, 0x8001, 0xC000, 0xFFFD, 0xFFFE, 0xFFFF];
  let s = 12345;
  for (let i = 0; i < 60; i++) { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; v.push(s & 0xFFFF); }
  return v;
}
const P = probki();

// ---- 1. MUL i IMUL na słowach ----------------------------------------------

{
  zle = 0;
  for (const a of P) {
    for (const b of P) {
      const iloczyn = a * b;
      const got = run([0xF7, 0xE3], { ax: a, bx: b });                    // MUL BX
      const chceAx = iloczyn % 0x10000, chceDx = Math.floor(iloczyn / 0x10000);
      if (got.ax !== chceAx || got.dx !== chceDx) {
        zglos(`MUL ${hex(a)}*${hex(b)}: DX:AX=${hex(got.dx)}:${hex(got.ax)}, ma być ${hex(chceDx)}:${hex(chceAx)}`);
      } else {
        // CF i OF mówią jedno: górna połowa iloczynu nie jest pusta.
        const chce = chceDx ? (CF | OF) : 0;
        if ((got.flags & (CF | OF)) !== chce) zglos(`MUL ${hex(a)}*${hex(b)}: CF/OF=${(got.flags & (CF | OF)).toString(16)}h, ma być ${chce.toString(16)}h`);
      }
    }
  }
  wynik(`MUL na słowach — ${P.length * P.length} par`);

  zle = 0;
  for (const a of P) {
    for (const b of P) {
      const iloczyn = s16(a) * s16(b);
      const got = run([0xF7, 0xEB], { ax: a, bx: b });                    // IMUL BX
      const pelny = iloczyn < 0 ? iloczyn + 0x100000000 : iloczyn;
      const chceAx = pelny % 0x10000, chceDx = Math.floor(pelny / 0x10000);
      if (got.ax !== chceAx || got.dx !== chceDx) {
        zglos(`IMUL ${s16(a)}*${s16(b)}: DX:AX=${hex(got.dx)}:${hex(got.ax)}, ma być ${hex(chceDx)}:${hex(chceAx)}`);
      } else {
        // Ta sama zasada, którą naprawiono w wersji bajtowej: znaczniki mówią,
        // że iloczyn **nie mieści się w samym AX**, a nie że DX jest zerem.
        const zmiescil = iloczyn >= -32768 && iloczyn <= 32767;
        const chce = zmiescil ? 0 : (CF | OF);
        if ((got.flags & (CF | OF)) !== chce) {
          zglos(`IMUL ${s16(a)}*${s16(b)} = ${iloczyn}: CF/OF=${(got.flags & (CF | OF)).toString(16)}h, ma być ${chce.toString(16)}h`);
        }
      }
    }
  }
  wynik(`IMUL na słowach — ${P.length * P.length} par`);
}

// ---- 2. DIV i IDIV na słowach, razem z przerwaniem 0 ------------------------

{
  zle = 0;
  for (const hi of P) {
    for (const lo of [0, 1, 0x7FFF, 0x8000, 0xFFFF, 0x1234]) {
      for (const d of P) {
        const n = hi * 0x10000 + lo;
        const got = run([0xF7, 0xF3], { ax: lo, dx: hi, bx: d });         // DIV BX
        if (d === 0 || Math.floor(n / d) > 0xFFFF) {
          if (!got.przerwanie) zglos(`DIV ${n}/${d} nie zgłosiło przerwania 0`);
        } else if (got.przerwanie) {
          zglos(`DIV ${n}/${d} zgłosiło przerwanie 0 bez powodu`);
        } else if (got.ax !== Math.floor(n / d) || got.dx !== n % d) {
          zglos(`DIV ${n}/${d}: AX=${hex(got.ax)} DX=${hex(got.dx)}, ma być ${hex(Math.floor(n / d))} ${hex(n % d)}`);
        }
      }
    }
  }
  wynik('DIV na słowach, z przepełnieniem ilorazu');

  zle = 0;
  for (const hi of P) {
    for (const lo of [0, 1, 0x7FFF, 0x8000, 0xFFFF, 0x1234]) {
      for (const d of P) {
        let n = hi * 0x10000 + lo;
        if (n >= 0x80000000) n -= 0x100000000;
        const dz = s16(d);
        const got = run([0xF7, 0xFB], { ax: lo, dx: hi, bx: d });         // IDIV BX
        const q = dz === 0 ? 0 : Math.trunc(n / dz);
        if (dz === 0 || q > 32767 || q < -32767) {
          if (!got.przerwanie) zglos(`IDIV ${n}/${dz} nie zgłosiło przerwania 0 (iloraz ${q})`);
        } else if (got.przerwanie) {
          zglos(`IDIV ${n}/${dz} zgłosiło przerwanie 0 bez powodu (iloraz ${q})`);
        } else {
          const r = n % dz;   // reszta bierze znak dzielnej, tak jak na procesorze
          if (got.ax !== (q & 0xFFFF) || got.dx !== (r & 0xFFFF)) {
            zglos(`IDIV ${n}/${dz}: AX=${hex(got.ax)} DX=${hex(got.dx)}, ma być ${hex(q & 0xFFFF)} ${hex(r & 0xFFFF)}`);
          }
        }
      }
    }
  }
  wynik('IDIV na słowach, ze znakiem reszty i przepełnieniem');
}

// ---- 3. IDIV na bajtach ----------------------------------------------------
//
// Dzielna przebiegana z krokiem pierwszym, żeby próbki nie układały się
// w regularny wzór względem dzielnika; dzielnik wyczerpująco.

{
  zle = 0;
  let ile = 0;
  for (let n = 0; n < 0x10000; n += 37) {
    for (let d = 0; d < 256; d++) {
      const dz = s8(d), dzielna = s16(n);
      const got = run([0xF6, 0xFB], { ax: n, bx: d });                    // IDIV BL
      const q = dz === 0 ? 0 : Math.trunc(dzielna / dz);
      ile++;
      if (dz === 0 || q > 127 || q < -127) {
        if (!got.przerwanie) zglos(`IDIV ${dzielna}/${dz} nie zgłosiło przerwania 0 (iloraz ${q})`);
      } else if (got.przerwanie) {
        zglos(`IDIV ${dzielna}/${dz} zgłosiło przerwanie 0 bez powodu (iloraz ${q})`);
      } else {
        const r = dzielna % dz;
        if (got.al !== (q & 0xFF) || got.ah !== (r & 0xFF)) {
          zglos(`IDIV ${dzielna}/${dz}: AH:AL=${got.ah}:${got.al}, ma być ${r & 0xFF}:${q & 0xFF}`);
        }
      }
    }
  }
  wynik(`IDIV na bajtach — ${ile} przypadków`);

  // Granica, zmierzona na sprzęcie. Cztery przypadki, bo dwa same w sobie nie
  // wystarczą: gdyby dzielenie zgłaszało przerwanie zawsze, dwa pierwsze
  // wiersze wyglądałyby identycznie i nic by nie znaczyły.
  const dno8 = run([0xF6, 0xFB], { ax: 0xFF80, bx: 0x01 });                // −128 / 1
  const dno16 = run([0xF7, 0xFB], { ax: 0x8000, dx: 0xFFFF, bx: 0x0001 }); // −32768 / 1
  const tuz8 = run([0xF6, 0xFB], { ax: 0xFF81, bx: 0x01 });                // −127 / 1
  const tuz16 = run([0xF7, 0xFB], { ax: 0x8001, dx: 0xFFFF, bx: 0x0001 }); // −32767 / 1

  check('iloraz na dnie zakresu zgłasza przerwanie',
        dno8.przerwanie && dno16.przerwanie,
        (dno8.przerwanie && dno16.przerwanie) ? ''
          : `bajt: ${dno8.przerwanie ? 'przerwanie' : hex(dno8.al, 2)}, słowo: ${dno16.przerwanie ? 'przerwanie' : hex(dno16.ax)}`);

  check('iloraz o jeden powyżej dna przechodzi',
        !tuz8.przerwanie && tuz8.al === 0x81 && !tuz16.przerwanie && tuz16.ax === 0x8001,
        (!tuz8.przerwanie && !tuz16.przerwanie) ? ''
          : 'przerwanie tam, gdzie sprzęt go nie zgłasza');

  // Adres powrotu po przerwaniu 0. Na 8086 wskazuje **za** instrukcję, a nie na
  // nią — dopiero 286 pozwala wznowić dzielenie. Zmierzone tym samym programem.
  {
    cpu.reset();
    cpu.sregs[0] = cpu.sregs[1] = cpu.sregs[2] = cpu.sregs[3] = 0;
    cpu.ip = BASE;
    bus.mem.set([0xF6, 0xFB], BASE);                                      // idiv bl
    cpu.regs[0] = 0x0100; cpu.regs[3] = 0x0000;
    cpu.regs[4] = 0xFFF0;
    cpu.setFlags(0x0002);
    cpu.step();
    // Procedura z F000:0000 to HLT, więc na stosie leży nietknięty adres powrotu.
    const wrocilNa = bus.mem[0xFFEA] | (bus.mem[0xFFEB] << 8);
    check('przerwanie 0 wraca za instrukcję, nie na nią',
          wrocilNa === BASE + 2,
          wrocilNa === BASE + 2 ? '' : `adres powrotu ${hex(wrocilNa)}, ma być ${hex(BASE + 2)}`);
  }
}

// ---- 4. NEG i NOT ----------------------------------------------------------

{
  zle = 0;
  for (let v = 0; v < 256; v++) {
    const got = run([0xF6, 0xD8], { ax: v });                             // NEG AL
    const r = (-v) & 0xFF;
    if (got.al !== r) zglos(`NEG ${v}: AL=${got.al}, ma być ${r}`);
    else {
      // NEG to odjęcie od zera, więc CF wychodzi wtedy i tylko wtedy, gdy było
      // co odejmować, a OF tylko dla 80h, którego nie da się zanegować.
      const chce = (v !== 0 ? CF : 0) | (v === 0x80 ? OF : 0) | ((v & 0x0F) !== 0 ? AF : 0)
                 | (r === 0 ? ZF : 0) | ((r & 0x80) ? SF : 0) | (par(r) ? PF : 0);
      const rozne = (got.flags ^ chce) & (CF | OF | AF | ZF | SF | PF);
      if (rozne) zglos(`NEG ${v}: znaczniki różnią się na ${rozne.toString(16)}h`);
    }
  }
  wynik('NEG na bajtach — 256 przypadków');

  zle = 0;
  for (let v = 0; v < 0x10000; v += 7) {
    const got = run([0xF7, 0xD8], { ax: v });                             // NEG AX
    const r = (-v) & 0xFFFF;
    if (got.ax !== r) zglos(`NEG ${hex(v)}: AX=${hex(got.ax)}, ma być ${hex(r)}`);
    else {
      const chce = (v !== 0 ? CF : 0) | (v === 0x8000 ? OF : 0) | ((v & 0x0F) !== 0 ? AF : 0)
                 | (r === 0 ? ZF : 0) | ((r & 0x8000) ? SF : 0) | (par(r) ? PF : 0);
      const rozne = (got.flags ^ chce) & (CF | OF | AF | ZF | SF | PF);
      if (rozne) zglos(`NEG ${hex(v)}: znaczniki różnią się na ${rozne.toString(16)}h`);
    }
  }
  wynik('NEG na słowach');

  zle = 0;
  for (let v = 0; v < 256; v++) {
    const got = run([0xF6, 0xD0], { ax: v, flags: 0x0002 | CF | ZF | SF | OF });   // NOT AL
    if (got.al !== ((~v) & 0xFF)) zglos(`NOT ${v}: AL=${got.al}`);
    // NOT jako jedyna z tej grupy nie rusza żadnego znacznika.
    if ((got.flags & (CF | OF | AF | ZF | SF | PF)) !== (CF | ZF | SF | OF)) {
      zglos(`NOT ${v}: znaczniki ruszone, a nie powinny`);
    }
  }
  wynik('NOT nie zmienia żadnego znacznika');
}

// ---- 5. INC i DEC: wszystko oprócz CF --------------------------------------

{
  for (const [nazwa, kod, delta] of [['INC AL', [0xFE, 0xC0], +1], ['DEC AL', [0xFE, 0xC8], -1]]) {
    zle = 0;
    for (let v = 0; v < 256; v++) {
      for (const cf of [0, 1]) {
        const got = run(kod, { ax: v, flags: 0x0002 | (cf ? CF : 0) });
        const r = (v + delta) & 0xFF;
        if (got.al !== r) { zglos(`${nazwa} ${v}: AL=${got.al}, ma być ${r}`); continue; }
        const przelew = delta > 0 ? (v === 0x7F) : (v === 0x80);
        const polowka = delta > 0 ? ((v & 0x0F) === 0x0F) : ((v & 0x0F) === 0x00);
        const chce = (cf ? CF : 0) | (przelew ? OF : 0) | (polowka ? AF : 0)
                   | (r === 0 ? ZF : 0) | ((r & 0x80) ? SF : 0) | (par(r) ? PF : 0);
        const rozne = (got.flags ^ chce) & (CF | OF | AF | ZF | SF | PF);
        if (rozne) zglos(`${nazwa} ${v} przy CF=${cf}: znaczniki różnią się na ${rozne.toString(16)}h`);
      }
    }
    wynik(`${nazwa} — 512 przypadków, z zachowaniem CF`);
  }

  zle = 0;
  for (let v = 0; v < 0x10000; v += 11) {
    for (const cf of [0, 1]) {
      const got = run([0x40], { ax: v, flags: 0x0002 | (cf ? CF : 0) });   // INC AX
      const r = (v + 1) & 0xFFFF;
      if (got.ax !== r) { zglos(`INC AX ${hex(v)}: ${hex(got.ax)}`); continue; }
      const chce = (cf ? CF : 0) | (v === 0x7FFF ? OF : 0) | ((v & 0x0F) === 0x0F ? AF : 0)
                 | (r === 0 ? ZF : 0) | ((r & 0x8000) ? SF : 0) | (par(r) ? PF : 0);
      const rozne = (got.flags ^ chce) & (CF | OF | AF | ZF | SF | PF);
      if (rozne) zglos(`INC AX ${hex(v)} przy CF=${cf}: znaczniki różnią się na ${rozne.toString(16)}h`);
    }
  }
  wynik('INC AX — postać jednobajtowa, z zachowaniem CF');
}

// ---- 6. CBW i CWD ----------------------------------------------------------

{
  zle = 0;
  for (let v = 0; v < 256; v++) {
    const got = run([0x98], { ax: 0xAA00 | v });                          // CBW
    if (got.ax !== (s8(v) & 0xFFFF)) zglos(`CBW ${v}: AX=${hex(got.ax)}, ma być ${hex(s8(v) & 0xFFFF)}`);
  }
  wynik('CBW — 256 przypadków');

  zle = 0;
  for (let v = 0; v < 0x10000; v += 13) {
    const got = run([0x99], { ax: v, dx: 0x5555 });                       // CWD
    if (got.dx !== ((v & 0x8000) ? 0xFFFF : 0) || got.ax !== v) {
      zglos(`CWD ${hex(v)}: DX:AX=${hex(got.dx)}:${hex(got.ax)}`);
    }
  }
  wynik('CWD — rozszerzenie znaku do DX');
}

process.exit(fails ? 1 : 0);
