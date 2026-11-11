// Zrzut i odtworzenie pełnego stanu maszyny.
//
// Zestaw stoi na dwóch kontrolach i żadna z nich nie sprawdza pojedynczego
// pola z osobna, bo taka kontrola byłaby dokładnie tak dobra, jak pamięć tego,
// kto ją pisał.
//
// **Kontrola pierwsza: bieg równoległy.** Zrzut robiony jest w środku pracy
// maszyny, odtwarzany w drugiej, zbudowanej od zera, po czym obie chodzą obok
// siebie krok w krok. Po każdej instrukcji porównywane są wszystkie rejestry,
// znaczniki i licznik cykli, a po całym przebiegu — cała pamięć, pamięć obrazu
// kontrolera i jego rejestry. Zapomniane pole nie ma się gdzie ukryć: albo
// natychmiast rozjeżdża wykonanie, albo zostawia ślad w pamięci.
//
// To jest ten rodzaj kontroli, którego brak najbardziej boli w praktyce. Zrzut
// niepełny nie psuje się od razu — maszyna po odtworzeniu chodzi, wygląda
// dobrze, a wywraca się kilka sekund później, w miejscu, które z brakującym
// polem nie ma widocznego związku.
//
// **Kontrola druga: żadne pole nie zostało pominięte przez przeoczenie.**
// Zestaw obchodzi żywe obiekty pole po polu i żąda, żeby każde z nich albo
// znalazło się w zrzucie, albo stało na liście świadomie pominiętych — z
// powodem. Trzeciej możliwości nie ma. Dopisanie pola do urządzenia i
// zapomnienie o nim tutaj wywraca ten test, i o to chodzi.

import { boot, run, bootToPrompt, romsAvailable, screen } from '../pofo-headless.mjs';
import { Machine, CPU_CLOCK } from '../../js/emu/machine.js';
import { CPU8088 } from '../../js/emu/cpu8088.js';
import { HPC104 } from '../../js/emu/hpc104.js';
import { HPC102 } from '../../js/emu/hpc102.js';
import { HPC101 } from '../../js/emu/hpc101.js';
import { STATE_VERSION } from '../../js/emu/snapshot.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

if (!romsAvailable()) {
  console.log('POMINIĘTE  brak plików ROM w rom/');
  process.exit(0);
}

// ---- 1. pola pominięte świadomie, a nie przez zapomnienie -------------------
//
// Przy każdej pozycji stoi powód. Powód jest częścią kontroli: jeśli nie da się
// go napisać, pole prawdopodobnie należy do zrzutu.

const POMINIETE = {
  Machine: {
    sysRom: 'obrazy ROM — te same po obu stronach odtworzenia',
    bus: 'pęk metod związanych z tą maszyną; odtworzony wskazywałby na poprzednią',
    cpu: 'osobny obiekt, ma własny zrzut zagnieżdżony pod kluczem cpu',
    lcd: 'jw. — zrzut pod kluczem lcd',
    keyboard: 'jw. — zrzut pod kluczem keyboard',
    sound: 'jw. — zrzut pod kluczem sound',
    expansion: 'jw. — zrzut pod kluczem expansion, o ile płyta jest wpięta',
  },
  CPU8088: {
    bus: 'interfejs magistrali, wiązany przy budowie',
    r8: 'widok bajtowy na ten sam bufor co regs — odtworzenie regs odtwarza oba',
    trace: 'ślad takt po takcie dla porównań z SingleStepTests — w pracy zawsze null',
    jumped: 'notatnik wykonania, żyje przez jedną instrukcję',
    rc: 'wynik przeniesienia z prymitywu ALU, zużyty w tym samym rozkazie',
    ro: 'jw., przepełnienie', ra: 'jw., półprzeniesienie',
    eaSeg: 'segment adresu wyliczony przez calcEa, zużyty w tym samym rozkazie',
    farSeg: 'jw. — segment wskaźnika dalekiego',
    modrmLen: 'notatnik dekodera, żyje przez jedną instrukcję',
    resolvedReg: 'jw.', resolvedSize: 'jw.',
    rTmpa: 'drugi wynik mnożenia/dzielenia (rejestry tmpa/tmpc mikrokodu) — zużyty w tym samym rozkazie',
    rTmpc: 'jw.', rCarry: 'jw.', rDx: 'jw.', rQ: 'jw.', rR: 'jw.',
    nTmpa: 'jw. — wynik procedury NEGATE', nTmpb: 'jw.', nTmpc: 'jw.', nCarry: 'jw.', nNeg: 'jw.',
    pTmpa: 'jw. — wynik korekty po dzieleniu ze znakiem',
  },
  HD61830: {
    cgRom: 'wewnętrzny generator znaków — ten sam obraz po obu stronach',
    readExternalCG: 'wywołanie zwrotne do zewnętrznego generatora',
  },
  PofoKeyboard: {
    onInterrupt: 'wywołanie zwrotne do ASIC-a',
  },
  PCD3311: {
    onToneChange: 'wywołanie zwrotne do warstwy dźwięku',
    onClick: 'jw.',
  },
  I8255: {
    onPortWrite: 'wywołanie zwrotne do płyty, która trzyma ten układ',
  },
  INS8250: {
    cpuClock: 'stała montażowa, przekazywana konstruktorowi',
    onTransmit: 'wywołanie zwrotne do portu szeregowego hosta',
    onInterrupt: 'wywołanie zwrotne podnoszące EINT',
  },
  HPC101: {
    ppi: 'osobny obiekt, zrzut zagnieżdżony pod kluczem ppi',
    link: 'partner transferu po stronie hosta, nie należy do maszyny',
    onEint: 'wywołanie zwrotne do ASIC-a',
  },
  HPC102: {
    uart: 'osobny obiekt, zrzut zagnieżdżony pod kluczem uart',
    onTransmit: 'wywołanie zwrotne do portu szeregowego hosta',
    onEint: 'wywołanie zwrotne do ASIC-a',
  },
  HPC104: {
    next: 'płyta wpięta za tą — zrzut zagnieżdżony pod kluczem next',
    onEint: 'wywołanie zwrotne do ASIC-a',
  },
};

function pokrycie(obiekt, nazwa, braki) {
  const zrzut = obiekt.snapshot();
  const wolno = POMINIETE[nazwa] || {};
  for (const pole of Object.keys(obiekt)) {
    if (pole in zrzut) continue;
    if (pole in wolno) continue;
    braki.push(`${nazwa}.${pole}`);
  }
}

{
  const { machine, cpu } = boot();
  machine.attachExpansion(new HPC104({ unit: 1 }));
  machine.expansion.attachNext(new HPC102(CPU_CLOCK, () => {}));
  run(machine, cpu, 200);

  const braki = [];
  pokrycie(machine, 'Machine', braki);
  pokrycie(cpu, 'CPU8088', braki);
  pokrycie(machine.lcd, 'HD61830', braki);
  pokrycie(machine.keyboard, 'PofoKeyboard', braki);
  pokrycie(machine.sound, 'PCD3311', braki);
  pokrycie(machine.expansion, 'HPC104', braki);
  pokrycie(machine.expansion.next, 'HPC102', braki);
  pokrycie(machine.expansion.next.uart, 'INS8250', braki);

  const drukarka = new HPC101();
  pokrycie(drukarka, 'HPC101', braki);
  pokrycie(drukarka.ppi, 'I8255', braki);

  check('każde pole urządzeń jest albo w zrzucie, albo świadomie pominięte',
        braki.length === 0,
        braki.length ? `nieuwzględnione: ${braki.join(', ')}` : '');
}

// ---- 2. bieg równoległy ------------------------------------------------------

function bliznjak(stan) {
  const { machine, cpu } = boot();
  machine.restore(stan);
  return { machine, cpu };
}

function rejestry(cpu) {
  return [...cpu.regs, ...cpu.sregs, cpu.ip, cpu.getFlags(), cpu.cycles,
          cpu.halted ? 1 : 0].join(',');
}

function rownolegle(nazwa, przygotuj, krokow) {
  const a = boot();
  przygotuj(a);

  const stan = a.machine.snapshot();
  const b = bliznjak(stan);

  // Zrzut ma być kopią, nie widokiem: zmiana w oryginale nie może przeciekać
  // do odtworzonej maszyny ani odwrotnie.
  a.machine.ram[0x400] = (a.machine.ram[0x400] + 1) & 0xFF;
  const niezalezne = b.machine.ram[0x400] !== a.machine.ram[0x400];
  a.machine.ram[0x400] = (a.machine.ram[0x400] - 1) & 0xFF;

  let rozjazd = '';
  for (let i = 0; i < krokow && !rozjazd; i++) {
    const cyklA = a.cpu.step();
    a.machine.advance(cyklA);
    const cyklB = b.cpu.step();
    b.machine.advance(cyklB);
    if (cyklA !== cyklB) rozjazd = `krok ${i}: oryginał ${cyklA} cykli, odtworzona ${cyklB}`;
    else if (rejestry(a.cpu) !== rejestry(b.cpu)) {
      rozjazd = `krok ${i}: ${rejestry(a.cpu)} ≠ ${rejestry(b.cpu)}`;
    }
  }

  if (!rozjazd) {
    for (let i = 0; i < a.machine.ram.length; i++) {
      if (a.machine.ram[i] !== b.machine.ram[i]) {
        rozjazd = `pamięć różni się pod ${i.toString(16)}h: ${a.machine.ram[i]} ≠ ${b.machine.ram[i]}`;
        break;
      }
    }
  }
  if (!rozjazd) {
    for (let i = 0; i < a.machine.lcd.vram.length; i++) {
      if (a.machine.lcd.vram[i] !== b.machine.lcd.vram[i]) {
        rozjazd = `pamięć obrazu różni się pod ${i.toString(16)}h`;
        break;
      }
    }
  }
  if (!rozjazd) {
    const ra = JSON.stringify(a.machine.lcd.snapshot(), (k, v) => (k === 'vram' ? undefined : v));
    const rb = JSON.stringify(b.machine.lcd.snapshot(), (k, v) => (k === 'vram' ? undefined : v));
    if (ra !== rb) rozjazd = `rejestry kontrolera: ${ra} ≠ ${rb}`;
  }

  check(nazwa, !rozjazd && niezalezne,
        rozjazd || (niezalezne ? '' : 'zrzut dzieli pamięć z maszyną zamiast ją kopiować'));
  return { a, b };
}

rownolegle('zrzut w środku rozruchu — 200 000 instrukcji krok w krok',
           ({ machine, cpu }) => run(machine, cpu, 300), 200000);

rownolegle('zrzut na promptcie — 200 000 instrukcji krok w krok',
           ({ machine, cpu }) => bootToPrompt(machine, cpu), 200000);

// ---- 3. co dokładnie zrzut przenosi -----------------------------------------

{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);

  const przed = screen(machine).join('\n');
  const stan = machine.snapshot();

  const swieza = boot();
  const pustyEkran = screen(swieza.machine).join('\n');
  swieza.machine.restore(stan);

  check('odtworzenie stawia obraz z powrotem, bez rozruchu',
        screen(swieza.machine).join('\n') === przed && pustyEkran !== przed,
        pustyEkran === przed ? 'świeża maszyna ma ten sam ekran — kontrola nic nie dowodzi' : '');

  check('licznik cykli przenosi się razem ze stanem',
        swieza.cpu.cycles === cpu.cycles,
        swieza.cpu.cycles === cpu.cycles ? '' : `${swieza.cpu.cycles} ≠ ${cpu.cycles}`);

  check('zrzut niesie numer wersji formatu', stan.version === STATE_VERSION,
        `wersja ${stan.version}`);
}

// ---- 4. kolejka klawiatury i naciśnięte klawisze ------------------------------
//
// Klawisz wciśnięty w chwili zrzutu ma zostać wciśnięty po odtworzeniu — a nie
// puścić się sam, bo wtedy program czekający na jego zwolnienie stanąłby na
// zawsze.

{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);

  machine.keyboard.keyDown(4);            // dowolny kod, byle trafił do kolejki
  const stan = machine.snapshot();

  const swieza = boot();
  swieza.machine.restore(stan);

  check('wciśnięty klawisz przeżywa odtworzenie',
        swieza.machine.keyboard.held.has(4) && swieza.machine.keyboard.queue.length === machine.keyboard.queue.length,
        `held=${[...swieza.machine.keyboard.held]}, kolejka=${swieza.machine.keyboard.queue.length}`);

  // Zbiór ma być własny, nie współdzielony z maszyną, z której go wzięto.
  machine.keyboard.keyUp(4);
  check('zbiór naciśniętych klawiszy jest kopią, nie tym samym obiektem',
        swieza.machine.keyboard.held.has(4) && !machine.keyboard.held.has(4));
}

// ---- 5. rozszerzenie: RAM płyty i karta w drugim gnieździe -------------------

{
  const a = boot();
  a.machine.attachExpansion(new HPC104({ unit: 1 }));
  a.machine.expansion.ram[0x1234] = 0xA5;
  a.machine.expansion.insertCard(new Uint8Array(0x20000).fill(0x5A), true);
  run(a.machine, a.cpu, 100);

  const stan = a.machine.snapshot();

  const b = boot();
  b.machine.attachExpansion(new HPC104({ unit: 1 }));
  b.machine.restore(stan);

  check('RAM rozszerzenia i karta B przenoszą się',
        b.machine.expansion.ram[0x1234] === 0xA5
        && b.machine.expansion.cardB && b.machine.expansion.cardB.data[0] === 0x5A,
        `ram=${b.machine.expansion.ram[0x1234]}, karta=${b.machine.expansion.cardB ? 'jest' : 'brak'}`);

  // Odtworzenie do maszyny bez płyty nie ma prawa niczego dobudować za plecami
  // użytkownika — ma po prostu pominąć tę część stanu.
  const c = boot();
  let wybuchlo = null;
  try { c.machine.restore(stan); } catch (e) { wybuchlo = e.message; }
  check('odtworzenie do maszyny bez rozszerzenia nie wybucha i nic nie dobudowuje',
        wybuchlo === null && c.machine.expansion === null,
        wybuchlo || (c.machine.expansion ? 'płyta pojawiła się sama' : ''));
}

process.exit(fails ? 1 : 0);
