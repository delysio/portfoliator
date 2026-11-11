// Korekty dziesiętne: AAA, AAS, DAA, DAS, AAM, AAD.
//
// Sześć instrukcji, których emulator dotąd nie sprawdzał niczym, a które są
// wyjątkowo wdzięcznym miejscem na cichy błąd: wynik prawie zawsze wygląda
// sensownie, bo różnica siedzi w jednym znaczniku i wychodzi dopiero przy
// przenoszeniu do następnej cyfry.
//
// Zestaw stoi na dwóch nogach, i nie są równe.
//
// Noga mocna — **kontrola od strony przeznaczenia**. Te instrukcje istnieją po
// to, żeby po zwykłym ADD/SUB/MUL zamienić wynik dwójkowy na dziesiętny. Więc
// zamiast powtarzać tu pseudokod z podręcznika (co sprawdzałoby tylko, czy dwa
// razy przepisałem to samo), zestaw liczy prawdziwą arytmetykę: dla wszystkich
// par liczb dwucyfrowych 0–99 ciąg `ADD AL,BL / DAA` musi dać zapis BCD sumy,
// a przeniesienie musi wyjść wtedy i tylko wtedy, gdy suma przekroczyła 99.
// Taka kontrola nie ma wspólnego źródła z implementacją.
//
// Noga słaba — **zgodność z pseudokodem** dla argumentów, które nie są poprawnym
// BCD. Tam nie ma czego liczyć, bo instrukcja nie ma wtedy sensu arytmetycznego;
// zostaje zapisanie w teście tego, co robi podręcznik, żeby zmiana zachowania
// nie przeszła niezauważona. To kontrola regresji, nie dowód poprawności.
//
// Znaczniki nieokreślone architektonicznie nie są porównywane — spis przy każdej
// grupie.

import { CPU8088 } from '../../js/emu/cpu8088.js';

const CF = 0x001, PF = 0x004, AF = 0x010, ZF = 0x040, SF = 0x080;

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

// Przerwanie 0 skacze na HLT w F000:0000, żeby dało się je rozpoznać po CS.
bus.mem[3] = 0xF0;
bus.mem[0xF0000] = 0xF4;

function run(code, { ax = 0, bx = 0, flags = 0x0002 }, steps = 1) {
  cpu.reset();
  cpu.sregs[0] = cpu.sregs[1] = cpu.sregs[2] = cpu.sregs[3] = 0;
  cpu.ip = BASE;
  bus.mem.set(code, BASE);
  cpu.regs[0] = ax; cpu.regs[1] = 0; cpu.regs[2] = 0; cpu.regs[3] = bx;
  cpu.regs[4] = 0xFFF0;
  cpu.setFlags(flags & ~0x100);             // bez pułapki, inaczej step() ją weźmie
  for (let i = 0; i < steps; i++) cpu.step();
  return { ax: cpu.regs[0], al: cpu.regs[0] & 0xFF, ah: (cpu.regs[0] >> 8) & 0xFF,
           flags: cpu.getFlags(), przerwanie: cpu.sregs[1] === 0xF000 };
}

const par = (r) => { let b = 0, x = r & 0xFF; while (x) { b ^= x & 1; x >>= 1; } return b ? 0 : 1; };
const szp = (r) => ({ zf: r === 0 ? 1 : 0, sf: (r & 0x80) ? 1 : 0, pf: par(r) });
const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10)) & 0xFF;

let zle = 0, pierwsze = '';
const zglos = (opis) => { if (!zle) pierwsze = opis; zle++; };

// Porównuje wybrane znaczniki. `chce` to obiekt {cf, af, zf, sf, pf}; brakujące
// pola są pomijane, bo architektura ich nie określa.
function znaczniki(opis, got, chce) {
  let m = 0, w = 0;
  if ('cf' in chce) { m |= CF; if (chce.cf) w |= CF; }
  if ('af' in chce) { m |= AF; if (chce.af) w |= AF; }
  if ('zf' in chce) { m |= ZF; if (chce.zf) w |= ZF; }
  if ('sf' in chce) { m |= SF; if (chce.sf) w |= SF; }
  if ('pf' in chce) { m |= PF; if (chce.pf) w |= PF; }
  const rozne = (got.flags ^ w) & m;
  if (rozne) zglos(`${opis}: znaczniki różnią się na ${rozne.toString(16)}h`);
  return rozne === 0;
}

// ---- 1. DAA: dodawanie dwucyfrowych liczb dziesiętnych ----------------------
//
// Dla wszystkich 100 × 100 par, raz przez ADD i raz przez ADC z przeniesieniem
// z niższej pary cyfr — bo dokładnie tak wygląda dodawanie liczb dłuższych.

{
  zle = 0;
  for (let cin = 0; cin <= 1; cin++) {
    const kod = cin ? [0x10, 0xD8, 0x27] : [0x00, 0xD8, 0x27];   // ADC/ADD AL,BL ; DAA
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        const suma = x + y + cin;
        const got = run(kod, { ax: bcd(x), bx: bcd(y), flags: 0x0002 | cin }, 2);
        if (got.al !== bcd(suma % 100)) {
          zglos(`${x}+${y}+${cin}: AL=${got.al.toString(16)}h, ma być ${bcd(suma % 100).toString(16)}h`);
        } else {
          znaczniki(`${x}+${y}+${cin}`, got, { cf: suma >= 100 ? 1 : 0, ...szp(bcd(suma % 100)) });
        }
      }
    }
  }
  check('DAA — dodawanie dziesiętne, 20 000 par', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 2. DAS: odejmowanie dwucyfrowych liczb dziesiętnych --------------------

{
  zle = 0;
  for (let cin = 0; cin <= 1; cin++) {
    const kod = cin ? [0x18, 0xD8, 0x2F] : [0x28, 0xD8, 0x2F];   // SBB/SUB AL,BL ; DAS
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        const roznica = x - y - cin;
        const chce = bcd(((roznica % 100) + 100) % 100);
        const got = run(kod, { ax: bcd(x), bx: bcd(y), flags: 0x0002 | cin }, 2);
        if (got.al !== chce) {
          zglos(`${x}-${y}-${cin}: AL=${got.al.toString(16)}h, ma być ${chce.toString(16)}h`);
        } else {
          znaczniki(`${x}-${y}-${cin}`, got, { cf: roznica < 0 ? 1 : 0, ...szp(chce) });
        }
      }
    }
  }
  check('DAS — odejmowanie dziesiętne, 20 000 par', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 3. AAA i AAS: arytmetyka na cyfrach rozpakowanych ----------------------
//
// Rozpakowany BCD trzyma jedną cyfrę na bajt, więc przeniesienie idzie do AH.
// AH ustawiam na wartość różną od zera, żeby zobaczyć, czy instrukcja go
// zwiększa, a nie nadpisuje.

{
  zle = 0;
  for (let ah = 0; ah < 256; ah += 17) {
    for (let x = 0; x <= 9; x++) {
      for (let y = 0; y <= 9; y++) {
        const suma = x + y, nadmiar = suma >= 10 ? 1 : 0;
        const got = run([0x00, 0xD8, 0x37], { ax: (ah << 8) | x, bx: y }, 2);   // ADD AL,BL ; AAA
        if (got.al !== suma % 10) zglos(`AAA ${x}+${y}: AL=${got.al}, ma być ${suma % 10}`);
        else if (got.ah !== ((ah + nadmiar) & 0xFF)) zglos(`AAA ${x}+${y}: AH=${got.ah}, ma być ${(ah + nadmiar) & 0xFF}`);
        else znaczniki(`AAA ${x}+${y}`, got, { cf: nadmiar, af: nadmiar });
      }
    }
  }
  check('AAA — dodawanie cyfr rozpakowanych', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

  zle = 0;
  for (let ah = 0; ah < 256; ah += 17) {
    for (let x = 0; x <= 9; x++) {
      for (let y = 0; y <= 9; y++) {
        const pozyczka = x - y < 0 ? 1 : 0;
        const chce = ((x - y) % 10 + 10) % 10;
        const got = run([0x28, 0xD8, 0x3F], { ax: (ah << 8) | x, bx: y }, 2);   // SUB AL,BL ; AAS
        if (got.al !== chce) zglos(`AAS ${x}-${y}: AL=${got.al}, ma być ${chce}`);
        else if (got.ah !== ((ah - pozyczka) & 0xFF)) zglos(`AAS ${x}-${y}: AH=${got.ah}, ma być ${(ah - pozyczka) & 0xFF}`);
        else znaczniki(`AAS ${x}-${y}`, got, { cf: pozyczka, af: pozyczka });
      }
    }
  }
  check('AAS — odejmowanie cyfr rozpakowanych', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 4. AAM: rozbicie iloczynu na cyfry ------------------------------------

{
  zle = 0;
  for (let x = 0; x <= 9; x++) {
    for (let y = 0; y <= 9; y++) {
      const iloczyn = x * y;
      const got = run([0xF6, 0xE3, 0xD4, 0x0A], { ax: x, bx: y }, 2);           // MUL BL ; AAM
      if (got.ah !== Math.floor(iloczyn / 10) || got.al !== iloczyn % 10) {
        zglos(`AAM ${x}*${y}: AH:AL=${got.ah}:${got.al}, ma być ${Math.floor(iloczyn / 10)}:${iloczyn % 10}`);
      } else {
        znaczniki(`AAM ${x}*${y}`, got, szp(iloczyn % 10));
      }
    }
  }
  check('AAM — rozbicie iloczynu cyfr', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 5. AAM i AAD z dowolną podstawą ---------------------------------------
//
// Bajt po opkodzie to dzielnik, a nie stała 0Ah — 8086 nie sprawdza go w żaden
// sposób. Deasembler pokazuje tę postać wprost (`aam 08h`), więc rdzeń też musi
// ją liczyć, inaczej okno inspektora obiecywałoby co innego, niż maszyna robi.

{
  zle = 0;
  for (let al = 0; al < 256; al++) {
    for (let d = 1; d < 256; d++) {
      const got = run([0xD4, d], { ax: 0xFF00 | al });
      const q = Math.floor(al / d), r = al % d;
      if (got.ah !== q || got.al !== r) {
        zglos(`AAM ${al}/${d}: AH:AL=${got.ah}:${got.al}, ma być ${q}:${r}`);
      } else {
        znaczniki(`AAM ${al}/${d}`, got, szp(r));
      }
    }
  }
  check('AAM z dowolną podstawą — 65 280 przypadków', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

  const zero = run([0xD4, 0x00], { ax: 0x0005 });
  check('AAM z podstawą 0 zgłasza przerwanie 0', zero.przerwanie,
        zero.przerwanie ? '' : 'przeszło bez przerwania');

  zle = 0;
  for (let ah = 0; ah < 256; ah++) {
    for (let d = 0; d < 256; d++) {
      const al = (ah * 7 + d) & 0xFF;
      const got = run([0xD5, d], { ax: (ah << 8) | al });
      const chce = (al + ah * d) & 0xFF;
      if (got.al !== chce || got.ah !== 0) {
        zglos(`AAD ${ah}:${al} podstawa ${d}: AX=${got.ax.toString(16)}h, ma być 00${chce.toString(16)}h`);
      } else {
        znaczniki(`AAD ${ah}:${al} podstawa ${d}`, got, szp(chce));
      }
    }
  }
  check('AAD z dowolną podstawą — 65 536 przypadków', zle === 0,
        zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
}

// ---- 6. Zgodność z pseudokodem podręcznika ---------------------------------
//
// Tu wchodzą argumenty, które nie są poprawnym BCD, i wszystkie kombinacje CF
// oraz AF na wejściu. Arytmetyki do porównania nie ma. Przy dawnym modelu odniesieniem
// był pseudokod z podręcznika 8086, z zastrzeżeniem, że to utrwalenie stanu, a nie
// dowód. Teraz jest nim zachowanie prawdziwego 8088 nagrane przez SingleStepTests
// (opkody 27h i 2Fh, 20 000 przypadków, wszystkie zgodne z rdzeniem co do znacznika)
// i różni się od podręcznika w dwóch miejscach: druga korekta progowana jest na 9Fh,
// a nie 99h, gdy AF był ustawiony, a pierwsza nie ustawia CF z przeniesienia.

function wzorDAA(al, cf, af) {
  const staryAl = al;
  let nowyCf = 0, nowyAf = 0;
  if ((al & 0x0F) > 9 || af) { al = (al + 6) & 0xFF; nowyAf = 1; }
  if (staryAl > (af ? 0x9F : 0x99) || cf) { al = (al + 0x60) & 0xFF; nowyCf = 1; }
  return { al, cf: nowyCf, af: nowyAf, ...szp(al) };
}
function wzorDAS(al, cf, af) {
  const staryAl = al;
  let nowyCf = 0, nowyAf = 0;
  if ((al & 0x0F) > 9 || af) { al = (al - 6) & 0xFF; nowyAf = 1; }
  if (staryAl > (af ? 0x9F : 0x99) || cf) { al = (al - 0x60) & 0xFF; nowyCf = 1; }
  return { al, cf: nowyCf, af: nowyAf, ...szp(al) };
}

{
  for (const [nazwa, opkod, wzor] of [['DAA', 0x27, wzorDAA], ['DAS', 0x2F, wzorDAS]]) {
    zle = 0;
    for (let al = 0; al < 256; al++) {
      for (let cf = 0; cf <= 1; cf++) {
        for (let af = 0; af <= 1; af++) {
          const ref = wzor(al, cf, af);
          const got = run([opkod], { ax: al, flags: 0x0002 | (cf ? CF : 0) | (af ? AF : 0) });
          if (got.al !== ref.al) zglos(`${nazwa} AL=${al.toString(16)}h CF=${cf} AF=${af}: wyszło ${got.al.toString(16)}h, wzór ${ref.al.toString(16)}h`);
          else znaczniki(`${nazwa} AL=${al.toString(16)}h CF=${cf} AF=${af}`, got, ref);
        }
      }
    }
    check(`${nazwa} wobec pseudokodu — 1024 kombinacje`, zle === 0,
          zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
  }

  for (const [nazwa, opkod, znak] of [['AAA', 0x37, +1], ['AAS', 0x3F, -1]]) {
    zle = 0;
    for (let al = 0; al < 256; al++) {
      for (let af = 0; af <= 1; af++) {
        const dziala = ((al & 0x0F) > 9 || af) ? 1 : 0;
        const chceAl = (dziala ? (al + znak * 6) & 0xFF : al) & 0x0F;
        const chceAh = (0x40 + znak * dziala) & 0xFF;
        const got = run([opkod], { ax: 0x4000 | al, flags: 0x0002 | (af ? AF : 0) });
        if (got.al !== chceAl || got.ah !== chceAh) {
          zglos(`${nazwa} AL=${al.toString(16)}h AF=${af}: AH:AL=${got.ah.toString(16)}:${got.al.toString(16)}, ma być ${chceAh.toString(16)}:${chceAl.toString(16)}`);
        } else {
          znaczniki(`${nazwa} AL=${al.toString(16)}h AF=${af}`, got, { cf: dziala, af: dziala });
        }
      }
    }
    check(`${nazwa} wobec pseudokodu — 512 kombinacji`, zle === 0,
          zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');
  }
}

process.exit(fails ? 1 : 0);
