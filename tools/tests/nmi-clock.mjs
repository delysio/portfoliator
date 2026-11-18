// Zegar Portfolio jako NMI — i wszystko, co z tego wynika.
//
// Do 1.00 emulator, idąc za MAME, podawał tik zegara jako przerwanie maskowalne
// na wektorze 08h. Na Portfolio to NMI: obsługa w ROM-ie (E000:1D06) czyta 8041h,
// żeby je potwierdzić, woła INT 08h, a potem robi to, czego INT 08h nie robi —
// dzwoni alarmem przez INT 4Ah, odlicza czas do samoczynnego wyłączenia i woła
// INT 1Ch. Przy tamtym modelu alarmy terminarza milczały, a że bit 0 maski BIOS
// zostawia wyłączony, zegar przy znaku zachęty w ogóle prawie stał. Zgłosił to
// użytkownik forum; wszystko poniżej sprawdzono potem w kodzie ROM-u.
//
// 8040h czytany to liczba taktów 2 Hz od ostatniego NMI (BIOS dodaje ją do czasu
// trzymanego w RAM-ie, E000:2B1C), 8041h — dwa bity przyczyny włączenia: klawisz
// albo NMI. W trybie OFF NMI zegara budzi BIOS impulsem MRST, ten przesuwa czas,
// sprawdza alarm i wraca do OFF albo — gdy alarm nadszedł — wznawia sesję.
//
// Trzecie przerwanie sprzętowe, INT 15h, zgłasza wyjęcie karty, którą BIOS ma
// akurat wybraną; jego obsługa w ROM-ie przerywa odczyt.

import fs from 'node:fs';
import { boot, run, press, chord, type, screen, bootToPrompt, insertCard, cardPath, romsAvailable } from '../pofo-headless.mjs';
import { CPU_CLOCK } from '../../js/emu/machine.js';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) fails++; };

const NMI_HANDLER = 0xE0000 + 0x1D06;
const INT4A_HANDLER = 0xFF9F0 + 0x0227;     // systemowa obsługa alarmu, instalowana przez ROM
const INT15_HANDLER = 0xE0000 + 0x1CCC;
const sekundy = (m) => m.cycleCount / CPU_CLOCK;
const slowo = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
// Czas dnia w półsekundach, tak jak liczy go BIOS w E000:2B08 (tryb wolny).
const teraz = (m) => slowo(m, 0x544) + slowo(m, 0x546) * 65536 + m.tickCount - slowo(m, 0x54A);
const tekst = (m) => screen(m).map((l) => l.trimEnd()).filter(Boolean);

/** Liczy wejścia procesora pod zadane adresy liniowe. */
function podsluch(cpu, adresy) {
  const ile = Object.fromEntries(adresy.map((a) => [a, 0]));
  const krok = cpu.step.bind(cpu);
  cpu.step = () => { const lin = cpu.sregs[1] * 16 + cpu.ip; if (lin in ile) ile[lin]++; return krok(); };
  return ile;
}

/** Odczytuje godzinę poleceniem TIME, w sekundach od północy. */
function godzina(machine, cpu) {
  type(machine, cpu, 'TIME\n'); run(machine, cpu, 800);
  const m = tekst(machine).join('\n').match(/Time:\s+(\d+):(\d+):(\d+)/g);
  press(machine, cpu, 'Enter'); run(machine, cpu, 500);
  if (!m) return null;
  const [, h, mi, s] = m[m.length - 1].match(/(\d+):(\d+):(\d+)/);
  return +h * 3600 + +mi * 60 + +s;
}

/** Wpis w terminarzu na 00:03 z włączonym alarmem; plik zapisany, powrót do promptu. */
function alarmWTerminarzu(machine, cpu) {
  chord(machine, cpu, 'Backquote', 'KeyD'); run(machine, cpu, 2500);
  press(machine, cpu, 'Enter'); run(machine, cpu, 1200);
  type(machine, cpu, '00:03 Test'); run(machine, cpu, 600);
  press(machine, cpu, 'Enter'); run(machine, cpu, 1200);
  press(machine, cpu, 'Backquote'); run(machine, cpu, 1200);   // menu aplikacji
  press(machine, cpu, 'KeyA'); run(machine, cpu, 1200);        // Alarm
  press(machine, cpu, 'Escape'); run(machine, cpu, 800);
  press(machine, cpu, 'Escape'); run(machine, cpu, 1200);
  press(machine, cpu, 'Enter'); run(machine, cpu, 2500);       // Save? Yes
}

// 1. NMI co 128 s, obsługa w ROM-ie, potwierdzenie odczytem 8041h.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  const ile = podsluch(cpu, [NMI_HANDLER]);
  run(machine, cpu, 300000);
  check('przez 300 s procesor dwa razy wchodzi w obsługę NMI pod E000:1D06', ile[NMI_HANDLER] === 2, `${ile[NMI_HANDLER]} razy`);
  check('obsługa potwierdza NMI odczytem 8041h', machine.nmiLatched === false);
  check('bit 0 maski (dawny tik) zostaje wyłączony, a nic na nim nie wisi', (machine.ie & 1) === 0 && (machine.ip & 1) === 0);
}

// 2. Zegar idzie: TIME po pięciu minutach pokazuje pięć minut więcej.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  const przed = godzina(machine, cpu);
  const t0 = sekundy(machine);
  run(machine, cpu, 300000);
  const minelo = sekundy(machine) - t0;
  const po = godzina(machine, cpu);
  check('TIME przesuwa się razem z czasem maszyny', przed !== null && po !== null && Math.abs((po - przed) - minelo) <= 2,
    `${przed} s → ${po} s, minęło ${minelo.toFixed(1)} s`);
}

// 3. 8040h to takty od ostatniego NMI.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  const przed = machine.in8(0x8040);
  run(machine, cpu, 10000);
  const po = machine.in8(0x8040);
  check('8040h przybywa dwa na sekundę', po - przed === 20, `${przed} → ${po}`);
  let doNmi = 0;
  const raw = cpu.pulseNMI.bind(cpu);
  cpu.pulseNMI = () => { doNmi++; raw(); };
  while (!doNmi) run(machine, cpu, 100);
  check('po NMI 8040h zaczyna od zera', machine.in8(0x8040) === 0, String(machine.in8(0x8040)));
}

// 4. Alarm z terminarza dzwoni.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  alarmWTerminarzu(machine, cpu);
  check('terminarz przekazuje BIOS-owi godzinę alarmu (00:03 = 360 półsekund)',
    slowo(machine, 0x54F) + slowo(machine, 0x551) * 65536 === 360);
  const ile = podsluch(cpu, [INT4A_HANDLER]);
  machine.soundEvents.length = 0;
  let tony = 0;
  for (let s = 0; s < 240; s++) {
    run(machine, cpu, 1000);
    if (machine.soundEvents.some((e) => e.kind === 'tone' && (e.f0 || e.f1))) tony++;
    machine.soundEvents.length = 0;
  }
  check('NMI woła INT 4Ah', ile[INT4A_HANDLER] > 0, `${ile[INT4A_HANDLER]} wejść`);
  check('alarm brzmi', tony >= 5, `${tony} s z dźwiękiem`);
  check('na ekranie stoi okno alarmu z treścią wpisu', /ALARM/.test(tekst(machine).join(' ')) && /test/i.test(tekst(machine).join(' ')));
}

// 5. Tryb OFF: zegar idzie dalej, maszyna sama nie wstaje.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  type(machine, cpu, 'OFF\n'); run(machine, cpu, 1500);
  check('OFF wyłącza maszynę', machine.poweredOff === true && machine.powerOffCause === 'off');
  const czas0 = teraz(machine), t0 = sekundy(machine);
  let budzen = 0, widoczna = 0, wObsludze = 0;
  const reset = machine.masterReset.bind(machine);
  machine.masterReset = (zrodlo) => { if (zrodlo === 2) budzen++; return reset(zrodlo); };
  // Co 100 ms: czy ktoś patrzący na stronę zobaczyłby maszynę włączoną. Chwila,
  // w której BIOS obsługuje NMI, trwa kilka milisekund, więc próbkowanie łapie ją
  // tylko czasem — liczy się, że ani razu nie wygląda na włączoną.
  for (let i = 0; i < 6000; i++) {
    run(machine, cpu, 100);
    if (!machine.poweredOff && !machine.offService) widoczna++;
    if (machine.offService) wObsludze++;
  }
  machine.masterReset = reset;
  const uplynelo = sekundy(machine) - t0, przesunal = (teraz(machine) - czas0) / 2;
  check('przez 600 s w OFF zegar przesuwa się o tyle samo', Math.abs(przesunal - uplynelo) <= 1,
    `zegar ${przesunal} s, maszyna ${uplynelo.toFixed(1)} s`);
  check('co 128 s NMI budzi BIOS impulsem MRST z bitem 1 w 8041h', budzen === 4 || budzen === 5, `${budzen} razy`);
  check('bez alarmu maszyna za każdym razem wraca do OFF', machine.poweredOff === true && !machine.offService);
  check('w żadnej próbce maszyna nie wygląda na włączoną', widoczna === 0,
    `${widoczna} próbek włączonych, ${wObsludze} w trakcie obsługi`);
  machine.wake();
  press(machine, cpu, 'Space'); run(machine, cpu, 1500);
  type(machine, cpu, 'VER\n'); run(machine, cpu, 1500);
  check('klawisz budzi i sesja trwa dalej', /DIP Operating System/.test(tekst(machine).join(' ')));
}

// 6. Alarm budzi maszynę z trybu OFF.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  alarmWTerminarzu(machine, cpu);
  type(machine, cpu, 'OFF\n'); run(machine, cpu, 1500);
  check('przed alarmem maszyna jest w OFF', machine.poweredOff === true);
  let wstala = null, tony = 0;
  machine.soundEvents.length = 0;
  for (let s = 0; s < 240; s++) {
    run(machine, cpu, 1000);
    if (wstala === null && !machine.poweredOff && !machine.offService) wstala = Math.round(sekundy(machine));
    if (machine.soundEvents.some((e) => e.kind === 'tone' && (e.f0 || e.f1))) tony++;
    machine.soundEvents.length = 0;
  }
  check('alarm włącza maszynę', wstala !== null, wstala === null ? 'nie wstała' : `w ${wstala} s czasu maszyny`);
  check('i alarm brzmi', tony >= 5, `${tony} s z dźwiękiem`);
}

// 7. Wyjęcie karty: INT 15h tylko wtedy, gdy BIOS ma ją wybraną.
{
  const obraz = cardPath('nucleus.img');
  if (!fs.existsSync(obraz)) {
    console.log('POMINIĘTE — brak cards/nucleus.img (obrazy kart nie należą do repozytorium)');
  } else {
    const { machine, cpu } = boot();
    insertCard(machine, obraz); machine.reset(); cpu.reset();
    bootToPrompt(machine, cpu);
    machine.ejectCardA();
    check('przy znaku zachęty wyjęcie karty nie zgłasza przerwania', (machine.ip & 0x10) === 0);

    const { machine: m2, cpu: c2 } = boot();
    insertCard(m2, obraz); m2.reset(); c2.reset();
    bootToPrompt(m2, c2);
    const ile = podsluch(c2, [INT15_HANDLER]);
    // Wyjmuje kartę w środku drugiego odczytu sektora: BIOS ma ją wtedy wybraną
    // (8051h = 43h) i przerwanie karty włączone (8050h = 1Ah, E000:05E6).
    let wybran = 0, wyjeta = false, za = -1;
    const out = m2.out8.bind(m2);
    m2.out8 = (p, v) => { const r = out(p, v); if (p === 0x8050 && (v & 0x10)) wybran++; return r; };
    const krok = c2.step.bind(c2);
    c2.step = () => {
      if (!wyjeta && wybran >= 2 && m2.romB === 3 && (m2.ie & 0x10)) {
        if (za < 0) za = 50; else if (--za === 0) { m2.ejectCardA(); wyjeta = true; }
      }
      return krok();
    };
    type(m2, c2, 'TYPE A:N.COM\n');
    run(m2, c2, 6000);
    check('wyjęcie w trakcie odczytu wchodzi w obsługę INT 15h pod E000:1CCC', wyjeta && ile[INT15_HANDLER] === 1,
      `wyjęta: ${wyjeta}, wejść: ${ile[INT15_HANDLER]}`);
    check('DOS zgłasza błąd odczytu zamiast czytać dalej', /error reading drive a/i.test(tekst(m2).join(' ')));
  }
}

// 8. Ustawienie samoczynnego wyłączania.
{
  const czas = (okresy) => {
    const { machine, cpu } = boot();
    machine.standbyPeriods = okresy;
    bootToPrompt(machine, cpu);
    const t0 = sekundy(machine);
    for (let s = 1; s <= 1200; s++) { run(machine, cpu, 1000); if (machine.poweredOff) return Math.round(sekundy(machine) - t0); }
    return null;
  };
  const nigdy = czas(0), dluzej = czas(4);
  check('„Nigdy” nie pozwala BIOS-owi wyłączyć maszyny przez 20 minut', nigdy === null,
    nigdy === null ? 'nie wyłączyła się' : `wyłączyła się po ${nigdy} s`);
  check('„Dłużej” wyłącza po 6–9 minutach', dluzej !== null && dluzej >= 384 - 10 && dluzej <= 512, `po ${dluzej} s`);
}

// 9. Zrzut stanu sprzed 1.02 wczytuje się w nowy model zegara.
{
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  const stary = machine.snapshot();
  delete stary.tickCount; delete stary.cyclesToHalfSecond; delete stary.nmiLatched; delete stary.offService;
  Object.assign(stary, { counter: 0x1234, cyclesToCounter: 1000, standbyArmed: true, standbyCrossed: 1,
                         poweredOff: true, powerOffCause: 'standby', ip: 0x01,
                         systemTickEnabled: false, standbyPeriods: 8 });
  const { machine: m2, cpu: c2 } = boot();
  m2.standbyPeriods = 2;
  m2.restore(stary);
  check('ustawienia strony wygrywają z zapisanymi w zrzucie', m2.systemTickEnabled === true && m2.standbyPeriods === 2,
    `zegar ${m2.systemTickEnabled}, wyłączanie ${m2.standbyPeriods}`);
  check('młodszy bajt dawnego licznika staje się licznikiem 8040h', m2.tickCount === 0x34);
  check('dawne „czuwanie” wraca jako działająca maszyna', m2.poweredOff === false && m2.powerOffCause === null);
  check('wiszący dawny tik na bicie 0 nie przechodzi', (m2.ip & 1) === 0);
  run(m2, c2, 2000);
  type(m2, c2, 'VER\n'); run(m2, c2, 1500);
  check('maszyna ze starego zrzutu odpowiada', /DIP Operating System/.test(tekst(m2).join(' ')));
}

console.log(fails ? `\n${fails} nie przeszło` : '\nwszystkie testy przeszły');
process.exit(fails ? 1 : 0);
