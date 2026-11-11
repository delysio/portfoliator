// Opkody nieudokumentowane, i kontrola, że nikt ich po cichu nie zgubi.
//
// 8086 nie ma wyjątku od nieprawidłowego rozkazu. Każdy z 256 bajtów coś robi,
// a kilkanaście z nich robi coś, czego Intel nie opisał — bo dekoder patrzy na
// mniej bitów, niż wynikałoby z tabeli. Rdzeń realizuje te zachowania świadomie
// (spis w nagłówku `cpu8088.js`), więc muszą być sprawdzone, inaczej pierwsze
// porządkowanie kodu je usunie jako martwe gałęzie.
//
// Sprawdzane są cztery:
//
// - **82h** dekoduje się jak 80h, bo bit odróżniający je nie wchodzi do dekodera;
// - **60h–6Fh** to te same szesnaście skoków warunkowych co 70h–7Fh;
// - **D6h** (SALC) rozlewa CF na cały AL — jednobajtowe „AL = CF ? FFh : 00h";
// - **0Fh** zdejmuje ze stosu CS, czego następcy 8086 już nie robią;
// - **F1h** zachowuje się jak drugi LOCK, czyli jak przedrostek bez skutku.
//
// Ostatnia kontrola w pliku jest ogólniejsza niż reszta i to ona ma największą
// wartość na przyszłość: **dla wszystkich 65 536 par (opkod, drugi bajt)
// deasembler musi policzyć dokładnie tyle bajtów, ile pobrał procesor**.
// `tools/tests/disasm.mjs` robi to samo, ale tylko na instrukcjach, które
// faktycznie wykonuje ROM Portfolio — a ROM nigdy nie trafia w nieudokumentowany
// róg mapy. Właśnie tamtą dziurą przeszło niezauważone, że rdzeń wykonuje
// 60h–6Fh jako skoki, a deasembler pokazywał w tym miejscu `db 60h` o długości
// jednego bajtu: okno inspektora rozjeżdżało się od tego miejsca do końca.

import { CPU8088 } from '../../js/emu/cpu8088.js';
import { disasm } from '../../js/emu/disasm.js';

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
const BASE = 0x1000;

function run(kod, { ax = 0, bx = 0, flags = 0x0002, sp = 0xFFF0 } = {}) {
  cpu.reset();
  cpu.sregs[0] = cpu.sregs[1] = cpu.sregs[2] = cpu.sregs[3] = 0;
  cpu.ip = BASE;
  bus.mem.fill(0x90, BASE, BASE + 8);            // wypełniacz: NOP-y
  bus.mem.set(kod, BASE);
  cpu.regs[0] = ax; cpu.regs[1] = 0; cpu.regs[2] = 0; cpu.regs[3] = bx;
  cpu.regs[4] = sp;
  cpu.setFlags(flags & ~0x100);
  const cykle = cpu.step();
  return { ax: cpu.regs[0], al: cpu.regs[0] & 0xFF, bx: cpu.regs[3], sp: cpu.regs[4],
           cs: cpu.sregs[1], ip: cpu.ip, flags: cpu.getFlags(), pobral: cpu.fetched, cykle };
}

let zle = 0, pierwsze = '';
const zglos = (opis) => { if (!zle) pierwsze = opis; zle++; };
const wynik = (nazwa) => check(nazwa, zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

// ---- 1. 82h dekoduje się jak 80h -------------------------------------------
//
// Kontrola jest różnicowa w najczystszej postaci: nie mówię, co ma wyjść, tylko
// żądam, żeby oba opkody dały to samo — ten sam AL, te same znaczniki, tyle samo
// pobranych bajtów.

{
  zle = 0;
  for (let reg = 0; reg < 8; reg++) {
    const modrm = 0xC0 | (reg << 3);            // operand w AL
    for (let al = 0; al < 256; al += 5) {
      for (let imm = 0; imm < 256; imm += 7) {
        for (const cf of [0, 1]) {
          const a = run([0x80, modrm, imm], { ax: al, flags: 0x0002 | (cf ? CF : 0) });
          const b = run([0x82, modrm, imm], { ax: al, flags: 0x0002 | (cf ? CF : 0) });
          if (a.al !== b.al || a.flags !== b.flags || a.pobral !== b.pobral) {
            zglos(`reg=${reg} AL=${al} imm=${imm} CF=${cf}: 80h dało ${a.al}/${a.flags.toString(16)}, 82h ${b.al}/${b.flags.toString(16)}`);
          }
        }
      }
    }
  }
  wynik('82h zachowuje się dokładnie jak 80h — osiem operacji');
}

// ---- 2. 60h–6Fh to te same skoki co 70h–7Fh --------------------------------
//
// Warunki przebiegane po wszystkich układach sześciu znaczników, które w nich
// występują, więc każdy warunek jest sprawdzony w obie strony.

{
  zle = 0;
  const ZNACZNIKI = [];
  for (let i = 0; i < 64; i++) {
    ZNACZNIKI.push(0x0002 | ((i & 1) ? CF : 0) | ((i & 2) ? PF : 0) | ((i & 4) ? AF : 0)
                          | ((i & 8) ? ZF : 0) | ((i & 16) ? SF : 0) | ((i & 32) ? OF : 0));
  }
  for (let i = 0; i < 16; i++) {
    for (const fl of ZNACZNIKI) {
      const stary = run([0x70 + i, 0x10], { flags: fl });
      const alias = run([0x60 + i, 0x10], { flags: fl });
      if (stary.ip !== alias.ip || stary.pobral !== alias.pobral || stary.cykle !== alias.cykle) {
        zglos(`warunek ${i} przy znacznikach ${fl.toString(16)}h: 7${i.toString(16)} → IP ${stary.ip.toString(16)}, 6${i.toString(16)} → IP ${alias.ip.toString(16)}`);
      }
      // Kontrola pozytywna: przy tych znacznikach skok ma się wykonać albo nie,
      // a nie zawsze to samo — inaczej zgodność byłaby zgodnością dwóch NOP-ów.
      if (stary.ip !== BASE + 2 && stary.ip !== BASE + 0x12) {
        zglos(`warunek ${i}: skok wylądował na ${stary.ip.toString(16)}`);
      }
    }
  }
  wynik('60h–6Fh — szesnaście warunków na 64 układach znaczników');

  // A na koniec dowód, że to nie jest zgodność „nic nie robi z nic nie robi":
  // przynajmniej jeden układ znaczników musi dać skok, i przynajmniej jeden nie.
  const skoczyl = run([0x64, 0x10], { flags: 0x0002 | ZF }).ip === BASE + 0x12;
  const nie = run([0x64, 0x10], { flags: 0x0002 }).ip === BASE + 2;
  check('64h (jz) rzeczywiście skacze i rzeczywiście nie skacze', skoczyl && nie,
        `ze znacznikiem ${skoczyl ? 'skoczył' : 'nie skoczył'}, bez ${nie ? 'nie skoczył' : 'skoczył'}`);
}

// ---- 3. SALC ---------------------------------------------------------------

{
  zle = 0;
  for (const fl of [0x0002, 0x0002 | CF, 0x0002 | ZF | SF | OF, 0x0002 | CF | ZF | SF | OF | PF | AF]) {
    const got = run([0xD6], { ax: 0x1234, flags: fl });
    const chce = (fl & CF) ? 0xFF : 0x00;
    if (got.al !== chce) zglos(`SALC przy znacznikach ${fl.toString(16)}h dało AL=${got.al.toString(16)}h, ma być ${chce.toString(16)}h`);
    if ((got.ax >> 8) !== 0x12) zglos('SALC ruszyło AH');
    // SALC czyta CF i nie zmienia niczego — również CF. Porównanie idzie przez
    // maskę, bo cztery najstarsze bity rejestru znaczników 8086 czyta się jako
    // jedynki niezależnie od tego, co się do nich zapisało.
    const MASKA = 0x0FD5;
    if ((got.flags & MASKA) !== (fl & ~0x100 & MASKA)) {
      zglos(`SALC zmieniło znaczniki: ${fl.toString(16)}h → ${got.flags.toString(16)}h`);
    }
    if (got.pobral !== 1) zglos(`SALC pobrało ${got.pobral} bajtów`);
  }
  wynik('D6h (SALC) rozlewa CF na AL i nie rusza znaczników');
}

// ---- 4. POP CS -------------------------------------------------------------

{
  zle = 0;
  bus.mem[0xFFF0] = 0x00; bus.mem[0xFFF1] = 0xB8;      // na stosie B800h
  const got = run([0x0F], { sp: 0xFFF0 });
  if (got.cs !== 0xB800) zglos(`POP CS dało CS=${got.cs.toString(16)}h, ma być B800h`);
  if (got.sp !== 0xFFF2) zglos(`POP CS zostawiło SP=${got.sp.toString(16)}h, ma być FFF2h`);
  if (got.pobral !== 1) zglos(`POP CS pobrało ${got.pobral} bajtów`);
  wynik('0Fh zdejmuje CS ze stosu');
}

// ---- 5. F1h jako drugi LOCK ------------------------------------------------

{
  zle = 0;
  const goly = run([0x04, 0x05], { ax: 0x0010 });                 // ADD AL, 05h
  for (const przedrostek of [0xF0, 0xF1]) {
    const got = run([przedrostek, 0x04, 0x05], { ax: 0x0010 });
    if (got.al !== goly.al || got.flags !== goly.flags) {
      zglos(`${przedrostek.toString(16)}h zmieniło wynik instrukcji za sobą`);
    }
    if (got.pobral !== goly.pobral + 1) zglos(`${przedrostek.toString(16)}h pobrało ${got.pobral} bajtów zamiast ${goly.pobral + 1}`);
  }
  wynik('F0h i F1h są przedrostkami bez skutku dla wyniku');
}

// ---- 6. długości: cała mapa, nie tylko to, co wykonuje ROM ------------------
//
// Dla każdej pary (opkod, drugi bajt) długość policzona przez deasembler musi
// zgadzać się z liczbą bajtów, którą pobrał procesor. Dalsze bajty to NOP-y,
// więc przedrostki mają za sobą coś sensownego, a instrukcje z operandem
// natychmiastowym dostają rozpoznawalne wartości.
//
// Bez wyjątków: cała mapa, wszystkie 256 × 256 par. Instrukcje, które zatrzymują
// rdzeń albo oddają sterowanie przerwaniu, też się liczą — pobieranie kończy się
// przed tym, co robią dalej, więc długość jest dobrze określona i dla nich.

{
  zle = 0;
  let sprawdzone = 0;
  for (let op = 0; op < 256; op++) {
    for (let drugi = 0; drugi < 256; drugi++) {
      const kod = [op, drugi, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90];
      const got = run(kod);
      const d = disasm((i) => kod[i] ?? 0x90, BASE);
      sprawdzone++;
      if (d.len < 1) { zglos(`opkod ${op.toString(16)}h/${drugi.toString(16)}h: deasembler zwrócił długość ${d.len}`); continue; }
      if (d.len !== got.pobral) {
        zglos(`opkod ${op.toString(16)}h drugi bajt ${drugi.toString(16)}h: procesor pobrał ${got.pobral} b, deasembler mówi ${d.len} b („${d.text}")`);
      }
    }
  }
  check(`długości zgodne na całej mapie — ${sprawdzone} par`, zle === 0,
        zle ? `${zle} rozjazdów, pierwszy: ${pierwsze}` : '');
}

process.exit(fails ? 1 : 0);
