// Instrukcje łańcuchowe: MOVS, CMPS, STOS, LODS, SCAS.
//
// Pięć instrukcji, dwie szerokości, dwa kierunki, trzy postacie powtarzania
// i przedrostek segmentu, który działa na jedną stronę przesyłu, a na drugą nie.
// Iloczyn tych wyborów jest większy, niż wygląda, i większość z nich nie była
// dotąd sprawdzana niczym poza tym, że Portfolio się uruchamia.
//
// Trzy rzeczy są tu warte uwagi bardziej niż reszta:
//
// **Cel jest zawsze w ES.** Przedrostek segmentu zmienia źródło — `DS:SI`
// w MOVS, CMPS i LODS — ale `ES:DI` jest wmurowane i procesor przedrostek
// ignoruje. Emulator, który obsłuży przedrostek „uczciwie" po obu stronach,
// zachowa się rozsądniej niż sprzęt, a to jest dokładnie ten rodzaj uprzejmości,
// przez który program działa na emulatorze i nie działa na Portfolio.
//
// **CMPS odejmuje źródło od celu, nie odwrotnie.** Pomyłka w kolejności daje
// poprawne ZF i odwrócone CF oraz SF, więc `REPE CMPSB` szukające równości
// nadal działa, a `JB` po nim skacze w drugą stronę.
//
// **Powtarzanie wraca do początku instrukcji, nie do opkodu.** Po każdym obrocie
// IP cofa się na pierwszy bajt razem z przedrostkami, żeby przerwanie miało gdzie
// wejść. Gdyby cofało się na sam opkod, przedrostek segmentu zniknąłby po
// pierwszym obrocie i długie kopiowanie czytałoby dalszy ciąg z innego segmentu.

import { CPU8088, AX, CX, SI, DI, ES, CS, SS, DS } from '../../js/emu/cpu8088.js';

const CF = 0x001, PF = 0x004, AF = 0x010, ZF = 0x040, SF = 0x080, OF = 0x800;
const DF = 0x400;

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

const KOD = 0x1000;                       // CS = 0, więc adres fizyczny to sam offset
const SEG = { es: 0x4000, ss: 0x5000, ds: 0x3000 };
const fiz = (seg, off) => ((seg << 4) + off) & 0xFFFFF;

const PRZEDROSTEK = { es: 0x26, cs: 0x2E, ss: 0x36, ds: 0x3E };

function wpisz(seg, off, bajty) { bus.mem.set(bajty, fiz(seg, off)); }
function czytaj(seg, off, ile = 1) { return Array.from(bus.mem.slice(fiz(seg, off), fiz(seg, off) + ile)); }

// Uruchamia jedną instrukcję łańcuchową. `rep` to 0xF2/0xF3 albo null, `seg` to
// nazwa segmentu w przedrostku albo null. Przy powtarzaniu kręci step() aż IP
// ruszy z miejsca, bo jeden step() to jeden obrót pętli.
function run({ op, rep = null, seg = null, df = 0, si = 0, di = 0, cx = 0, ax = 0 }) {
  cpu.reset();
  cpu.sregs[ES] = SEG.es; cpu.sregs[CS] = 0; cpu.sregs[SS] = SEG.ss; cpu.sregs[DS] = SEG.ds;
  cpu.ip = KOD;
  const kod = [];
  if (rep !== null) kod.push(rep);
  if (seg !== null) kod.push(PRZEDROSTEK[seg]);
  kod.push(op);
  bus.mem.set(kod, KOD);
  cpu.regs[AX] = ax; cpu.regs[CX] = cx; cpu.regs[SI] = si; cpu.regs[DI] = di;
  cpu.regs[4] = 0xFFF0;
  cpu.setFlags(0x0002 | (df ? DF : 0));

  let obroty = 0;
  do { cpu.step(); obroty++; } while (cpu.ip === KOD && obroty < 5000);
  return { si: cpu.regs[SI], di: cpu.regs[DI], cx: cpu.regs[CX], ax: cpu.regs[AX],
           al: cpu.regs[AX] & 0xFF, flags: cpu.getFlags(), ip: cpu.ip, obroty,
           dlugosc: kod.length };
}

let zle = 0, pierwsze = '';
const zglos = (opis) => { if (!zle) pierwsze = opis; zle++; };
const wynik = (nazwa) => check(nazwa, zle === 0, zle ? `${zle} różnic, pierwsza: ${pierwsze}` : '');

const par = (r) => { let b = 0, x = r & 0xFF; while (x) { b ^= x & 1; x >>= 1; } return b ? 0 : 1; };

// ---- 1. przesuw wskaźników: obie szerokości, oba kierunki -------------------
//
// LODS i STOS ruszają jeden wskaźnik, MOVS i CMPS oba. Kierunek bierze się
// wyłącznie z DF, a krok wyłącznie z szerokości.

{
  zle = 0;
  const SPIS = [
    ['MOVSB', 0xA4, 1, true, true], ['MOVSW', 0xA5, 2, true, true],
    ['CMPSB', 0xA6, 1, true, true], ['CMPSW', 0xA7, 2, true, true],
    ['STOSB', 0xAA, 1, false, true], ['STOSW', 0xAB, 2, false, true],
    ['LODSB', 0xAC, 1, true, false], ['LODSW', 0xAD, 2, true, false],
    ['SCASB', 0xAE, 1, false, true], ['SCASW', 0xAF, 2, false, true],
  ];
  for (const [nazwa, op, krok, ruszaSi, ruszaDi] of SPIS) {
    for (const df of [0, 1]) {
      const delta = df ? -krok : krok;
      const got = run({ op, df, si: 0x0100, di: 0x0200 });
      const chceSi = (0x0100 + (ruszaSi ? delta : 0)) & 0xFFFF;
      const chceDi = (0x0200 + (ruszaDi ? delta : 0)) & 0xFFFF;
      if (got.si !== chceSi || got.di !== chceDi) {
        zglos(`${nazwa} przy DF=${df}: SI=${got.si.toString(16)} DI=${got.di.toString(16)}, ma być ${chceSi.toString(16)} ${chceDi.toString(16)}`);
      }
    }
  }
  wynik('przesuw SI i DI — dziesięć instrukcji, oba kierunki');

  // Zawinięcie na granicy segmentu: wskaźniki są szesnastobitowe, więc krok
  // w tył spod zera ma dać FFFFh, a nie wyjść poza segment.
  zle = 0;
  const wstecz = run({ op: 0xAC, df: 1, si: 0x0000 });
  if (wstecz.si !== 0xFFFF) zglos(`LODSB spod SI=0 wstecz dało SI=${wstecz.si.toString(16)}`);
  const naprzod = run({ op: 0xAA, df: 0, di: 0xFFFF });
  if (naprzod.di !== 0x0000) zglos(`STOSB spod DI=FFFF dało DI=${naprzod.di.toString(16)}`);
  wynik('wskaźniki zawijają się w obrębie segmentu');
}

// ---- 2. co która instrukcja faktycznie przenosi ----------------------------

{
  zle = 0;

  wpisz(SEG.ds, 0x0100, [0x12, 0x34]);
  wpisz(SEG.es, 0x0200, [0x00, 0x00]);
  run({ op: 0xA4, si: 0x0100, di: 0x0200 });                     // MOVSB
  if (czytaj(SEG.es, 0x0200, 2).join() !== [0x12, 0x00].join()) zglos('MOVSB nie przeniósł bajtu do ES:DI');

  wpisz(SEG.es, 0x0200, [0x00, 0x00]);
  run({ op: 0xA5, si: 0x0100, di: 0x0200 });                     // MOVSW
  if (czytaj(SEG.es, 0x0200, 2).join() !== [0x12, 0x34].join()) zglos('MOVSW nie przeniósł słowa');

  wpisz(SEG.es, 0x0200, [0x00, 0x00]);
  run({ op: 0xAA, di: 0x0200, ax: 0xBEEF });                     // STOSB
  if (czytaj(SEG.es, 0x0200, 2).join() !== [0xEF, 0x00].join()) zglos('STOSB zapisał co innego niż AL');

  wpisz(SEG.es, 0x0200, [0x00, 0x00]);
  run({ op: 0xAB, di: 0x0200, ax: 0xBEEF });                     // STOSW
  if (czytaj(SEG.es, 0x0200, 2).join() !== [0xEF, 0xBE].join()) zglos('STOSW zapisał słowo w złej kolejności bajtów');

  wpisz(SEG.ds, 0x0100, [0x77, 0x88]);
  const lb = run({ op: 0xAC, si: 0x0100, ax: 0xAA55 });          // LODSB
  if (lb.ax !== 0xAA77) zglos(`LODSB dało AX=${lb.ax.toString(16)}, miało ruszyć tylko AL`);
  const lw = run({ op: 0xAD, si: 0x0100, ax: 0xAA55 });          // LODSW
  if (lw.ax !== 0x8877) zglos(`LODSW dało AX=${lw.ax.toString(16)}`);

  wynik('przesyły trafiają tam, gdzie mają, i we właściwej szerokości');
}

// ---- 3. znaczniki po CMPS i SCAS: wszystkie 65 536 par ----------------------
//
// Odniesienie liczone inaczej niż w rdzeniu — przeniesienie połówkowe wprost
// z nibbli, przepełnienie z porównania bitów znaku.

function refSub(a, b) {
  const t = a - b, r = t & 0xFF;
  return { cf: t < 0 ? 1 : 0, af: ((a & 0xF) - (b & 0xF)) < 0 ? 1 : 0,
           of: ((a & 0x80) !== (b & 0x80) && (r & 0x80) !== (a & 0x80)) ? 1 : 0,
           zf: r === 0 ? 1 : 0, sf: (r & 0x80) ? 1 : 0, pf: par(r) };
}
const spakuj = (f) => (f.cf ? CF : 0) | (f.pf ? PF : 0) | (f.af ? AF : 0)
                    | (f.zf ? ZF : 0) | (f.sf ? SF : 0) | (f.of ? OF : 0);
const MASKA = CF | PF | AF | ZF | SF | OF;

{
  zle = 0;
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      wpisz(SEG.ds, 0x0100, [a]);
      wpisz(SEG.es, 0x0200, [b]);
      const got = run({ op: 0xA6, si: 0x0100, di: 0x0200 });     // CMPSB
      const rozne = (got.flags ^ spakuj(refSub(a, b))) & MASKA;
      // Kolejność: źródło minus cel. Odwrócona dałaby te same ZF i PF, więc
      // dopisuję, na czym różnica polega, żeby diagnoza nie wymagała zgadywania.
      if (rozne) zglos(`CMPSB ${a}-${b}: różnica na ${rozne.toString(16)}h`
                     + (((got.flags ^ spakuj(refSub(b, a))) & MASKA) === 0 ? ' (wygląda na odwróconą kolejność argumentów)' : ''));
    }
  }
  wynik('CMPSB — znaczniki dla 65 536 par');

  zle = 0;
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      wpisz(SEG.es, 0x0200, [b]);
      const got = run({ op: 0xAE, di: 0x0200, ax: 0x5500 | a });  // SCASB
      const rozne = (got.flags ^ spakuj(refSub(a, b))) & MASKA;
      if (rozne) zglos(`SCASB AL=${a} wobec ${b}: różnica na ${rozne.toString(16)}h`);
    }
  }
  wynik('SCASB — znaczniki dla 65 536 par');

  zle = 0;
  for (const [a, b] of [[0x0000, 0x0000], [0x8000, 0x0001], [0x0001, 0x8000],
                        [0x7FFF, 0xFFFF], [0xFFFF, 0x7FFF], [0x1234, 0x1234],
                        [0x8000, 0x8000], [0x0100, 0x00FF]]) {
    wpisz(SEG.ds, 0x0100, [a & 0xFF, a >> 8]);
    wpisz(SEG.es, 0x0200, [b & 0xFF, b >> 8]);
    const got = run({ op: 0xA7, si: 0x0100, di: 0x0200 });        // CMPSW
    const t = a - b, r = t & 0xFFFF;
    const chce = spakuj({ cf: t < 0 ? 1 : 0, af: ((a & 0xF) - (b & 0xF)) < 0 ? 1 : 0,
                          of: ((a & 0x8000) !== (b & 0x8000) && (r & 0x8000) !== (a & 0x8000)) ? 1 : 0,
                          zf: r === 0 ? 1 : 0, sf: (r & 0x8000) ? 1 : 0, pf: par(r) });
    const rozne = (got.flags ^ chce) & MASKA;
    if (rozne) zglos(`CMPSW ${a.toString(16)}-${b.toString(16)}: różnica na ${rozne.toString(16)}h`);
  }
  wynik('CMPSW — znaczniki na wartościach brzegowych');
}

// ---- 4. przedrostek segmentu: działa na źródło, nie na cel ------------------

{
  zle = 0;

  // Ten sam offset w trzech segmentach, każdy z inną zawartością — wtedy widać
  // nie tylko to, że przedrostek zadziałał, ale i z którego segmentu wzięło.
  wpisz(SEG.ds, 0x0100, [0xDD]);
  wpisz(SEG.es, 0x0100, [0xEE]);
  wpisz(SEG.ss, 0x0100, [0x55]);
  bus.mem[fiz(0, 0x0100)] = 0xCC;                                 // CS = 0

  const bez = run({ op: 0xAC, si: 0x0100 });
  if (bez.al !== 0xDD) zglos(`LODSB bez przedrostka wzięło ${bez.al.toString(16)}h zamiast z DS`);
  for (const [nazwa, oczek] of [['es', 0xEE], ['ss', 0x55], ['cs', 0xCC], ['ds', 0xDD]]) {
    const got = run({ op: 0xAC, seg: nazwa, si: 0x0100 });
    if (got.al !== oczek) zglos(`${nazwa.toUpperCase()}: LODSB wzięło ${got.al.toString(16)}h, ma być ${oczek.toString(16)}h`);
  }
  wynik('przedrostek segmentu przestawia źródło LODS');

  zle = 0;
  // STOS pisze do ES:DI i żaden przedrostek tego nie zmienia. Kontrola jest
  // dwustronna: bajt ma się pojawić w ES i **nie** pojawić w segmencie z
  // przedrostka, inaczej „zadziałało" dałoby się pomylić z „nie zadziałało".
  for (const nazwa of ['ds', 'ss', 'cs']) {
    wpisz(SEG.es, 0x0300, [0x00]);
    wpisz(SEG.ds, 0x0300, [0x00]);
    wpisz(SEG.ss, 0x0300, [0x00]);
    bus.mem[fiz(0, 0x0300)] = 0x00;
    run({ op: 0xAA, seg: nazwa, di: 0x0300, ax: 0x00A7 });
    if (czytaj(SEG.es, 0x0300)[0] !== 0xA7) zglos(`${nazwa.toUpperCase()}: STOSB nie zapisał do ES:DI`);
    const podmieniony = { ds: SEG.ds, ss: SEG.ss, cs: 0 }[nazwa];
    if (bus.mem[fiz(podmieniony, 0x0300)] === 0xA7) zglos(`${nazwa.toUpperCase()}: STOSB dał się przekierować z ES`);
  }
  wynik('przedrostek segmentu nie rusza celu STOS');

  zle = 0;
  // MOVS ma obie strony naraz: źródło idzie za przedrostkiem, cel zostaje w ES.
  wpisz(SEG.ss, 0x0100, [0x99]);
  wpisz(SEG.ds, 0x0100, [0x11]);
  wpisz(SEG.es, 0x0400, [0x00]);
  run({ op: 0xA4, seg: 'ss', si: 0x0100, di: 0x0400 });
  if (czytaj(SEG.es, 0x0400)[0] !== 0x99) zglos(`SS: MOVSB przeniósł ${czytaj(SEG.es, 0x0400)[0].toString(16)}h zamiast 99h`);

  // SCAS porównuje z ES:DI również pod przedrostkiem — gdyby przedrostek
  // zadziałał, porównanie wyszłoby z innym bajtem i ZF byłoby odwrotne.
  wpisz(SEG.es, 0x0500, [0x42]);
  wpisz(SEG.ds, 0x0500, [0x43]);
  const sc = run({ op: 0xAE, seg: 'ds', di: 0x0500, ax: 0x0042 });
  if (!(sc.flags & ZF)) zglos('DS: SCASB porównało z DS zamiast z ES');
  wynik('MOVS i SCAS: źródło za przedrostkiem, cel zawsze w ES');
}

// ---- 5. powtarzanie ---------------------------------------------------------

{
  zle = 0;

  const wzorzec = Array.from({ length: 16 }, (_, i) => 0xA0 + i);
  wpisz(SEG.ds, 0x0100, wzorzec);
  wpisz(SEG.es, 0x0200, new Array(16).fill(0));
  const kopia = run({ op: 0xA4, rep: 0xF3, si: 0x0100, di: 0x0200, cx: 16 });
  if (czytaj(SEG.es, 0x0200, 16).join() !== wzorzec.join()) zglos('REP MOVSB nie skopiował całości');
  if (kopia.cx !== 0) zglos(`REP MOVSB zostawiło CX=${kopia.cx}`);
  if (kopia.obroty !== 16) zglos(`REP MOVSB zrobiło ${kopia.obroty} obrotów zamiast 16`);
  if (kopia.si !== 0x0110 || kopia.di !== 0x0210) zglos('REP MOVSB źle przesunęło wskaźniki');
  wynik('REP MOVSB kopiuje dokładnie CX bajtów');

  zle = 0;
  const pusty = run({ op: 0xA4, rep: 0xF3, si: 0x0100, di: 0x0700, cx: 0 });
  if (pusty.si !== 0x0100 || pusty.di !== 0x0700) zglos('REP z CX=0 ruszyło wskaźniki');
  if (pusty.cx !== 0) zglos(`REP z CX=0 dało CX=${pusty.cx} — licznik poszedł w dół pod zero`);
  if (czytaj(SEG.es, 0x0700)[0] !== 0) zglos('REP z CX=0 mimo wszystko coś zapisało');
  if (pusty.obroty !== 1) zglos(`REP z CX=0 kręciło się ${pusty.obroty} razy`);
  wynik('REP z CX=0 nie robi nic');

  zle = 0;
  // Pierwsza różnica na czwartym bajcie: REPE ma stanąć zaraz po niej, więc CX
  // ma pokazać, ile jeszcze zostało nietkniętych.
  wpisz(SEG.ds, 0x0100, [1, 2, 3, 4, 5, 6, 7, 8]);
  wpisz(SEG.es, 0x0200, [1, 2, 3, 9, 5, 6, 7, 8]);
  const repe = run({ op: 0xA6, rep: 0xF3, si: 0x0100, di: 0x0200, cx: 8 });
  if (repe.obroty !== 4) zglos(`REPE CMPSB zrobiło ${repe.obroty} obrotów zamiast 4`);
  if (repe.cx !== 4) zglos(`REPE CMPSB zostawiło CX=${repe.cx} zamiast 4`);
  if (repe.flags & ZF) zglos('REPE CMPSB stanęło z ZF=1, czyli nie na różnicy');
  wynik('REPE CMPSB staje na pierwszej różnicy');

  zle = 0;
  wpisz(SEG.es, 0x0200, [1, 2, 3, 4, 5, 6, 7, 8]);
  const repne = run({ op: 0xAE, rep: 0xF2, di: 0x0200, cx: 8, ax: 0x0005 });
  if (repne.obroty !== 5) zglos(`REPNE SCASB zrobiło ${repne.obroty} obrotów zamiast 5`);
  if (repne.cx !== 3) zglos(`REPNE SCASB zostawiło CX=${repne.cx} zamiast 3`);
  if (!(repne.flags & ZF)) zglos('REPNE SCASB stanęło z ZF=0, czyli nie na trafieniu');
  if (repne.di !== 0x0205) zglos(`REPNE SCASB stanęło z DI=${repne.di.toString(16)}, ma być 0205`);
  wynik('REPNE SCASB staje na pierwszym trafieniu');

  zle = 0;
  // Brak trafienia: pętla ma się wyczerpać licznikiem, a ZF zostać po ostatnim
  // porównaniu.
  const brak = run({ op: 0xAE, rep: 0xF2, di: 0x0200, cx: 8, ax: 0x00FF });
  if (brak.obroty !== 8 || brak.cx !== 0) zglos(`REPNE bez trafienia: ${brak.obroty} obrotów, CX=${brak.cx}`);
  if (brak.flags & ZF) zglos('REPNE bez trafienia zostawiło ZF=1');
  wynik('REPNE bez trafienia wyczerpuje licznik');

  zle = 0;
  // Kopiowanie wstecz zaczyna od **ostatniego** bajtu obszaru, więc kolejność
  // w pamięci docelowej ma wyjść nieodwrócona — to jest cała jego istota
  // i jedyny powód, dla którego DF w ogóle istnieje.
  wpisz(SEG.ds, 0x0100, [1, 2, 3, 4, 5, 6, 7, 8]);
  wpisz(SEG.es, 0x0200, new Array(8).fill(0));
  const wstecz = run({ op: 0xA4, rep: 0xF3, df: 1, si: 0x0107, di: 0x0207, cx: 8 });
  if (wstecz.si !== 0x00FF || wstecz.di !== 0x01FF) {
    zglos(`REP MOVSB wstecz: SI=${wstecz.si.toString(16)} DI=${wstecz.di.toString(16)}, ma być 00FF 01FF`);
  }
  if (czytaj(SEG.es, 0x0200, 8).join() !== [1, 2, 3, 4, 5, 6, 7, 8].join()) {
    zglos(`REP MOVSB wstecz dało ${czytaj(SEG.es, 0x0200, 8).join(' ')}`);
  }
  wynik('REP MOVSB wstecz kopiuje od końca, nie odwracając kolejności');
}

// ---- 6. powrót IP obejmuje przedrostki --------------------------------------
//
// Po obrocie, który ma się powtórzyć, IP musi wskazywać **pierwszy bajt
// instrukcji**, a nie opkod. Inaczej przerwanie w środku kopiowania wróciłoby na
// goły A4 i reszta łańcucha poszłaby z DS zamiast z segmentu z przedrostka.

{
  zle = 0;
  cpu.reset();
  cpu.sregs[ES] = SEG.es; cpu.sregs[CS] = 0; cpu.sregs[SS] = SEG.ss; cpu.sregs[DS] = SEG.ds;
  cpu.ip = KOD;
  bus.mem.set([0xF3, 0x36, 0xA4], KOD);                           // REP SS: MOVSB
  cpu.regs[CX] = 4; cpu.regs[SI] = 0x0600; cpu.regs[DI] = 0x0600;
  cpu.regs[4] = 0xFFF0;
  cpu.setFlags(0x0002);

  wpisz(SEG.ss, 0x0600, [0x21, 0x22, 0x23, 0x24]);
  wpisz(SEG.ds, 0x0600, [0x91, 0x92, 0x93, 0x94]);
  wpisz(SEG.es, 0x0600, [0, 0, 0, 0]);

  cpu.step();
  if (cpu.ip !== KOD) zglos(`po pierwszym obrocie IP=${cpu.ip.toString(16)}, ma wrócić na ${KOD.toString(16)}`);
  // Trzy pozostałe obroty — gdyby przedrostek przepadł, dalsze bajty przyszłyby
  // z DS i w ES zobaczylibyśmy 21 92 93 94.
  cpu.step(); cpu.step(); cpu.step();
  const wyszlo = czytaj(SEG.es, 0x0600, 4);
  if (wyszlo.join() !== [0x21, 0x22, 0x23, 0x24].join()) {
    zglos(`REP SS: MOVSB dało ${wyszlo.map((b) => b.toString(16)).join(' ')}, ma być 21 22 23 24`);
  }
  if (cpu.ip !== KOD + 3) zglos(`po ostatnim obrocie IP=${cpu.ip.toString(16)}, ma być ${(KOD + 3).toString(16)}`);
  wynik('powtarzanie wraca na przedrostki, nie na opkod');
}

process.exit(fails ? 1 : 0);
