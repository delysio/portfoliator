// Zegar procesora: czy `cpu.cycles` liczy wszystko, co się dzieje.
//
// Licznik nie jest księgowością na boku. Model czasowy kontrolera LCD czyta
// właśnie jego, żeby rozstrzygnąć, czy zapis nie przyszedł za wcześnie po
// poprzednim — więc każdy takt, którego licznik nie zobaczy, przesuwa tamten
// osąd o tyle samo.
//
// Kiedyś `step()` dodawał do licznika tylko na ścieżce wykonania instrukcji.
// Przyjęte przerwanie i każdy takt spędzony w postoju po `HLT` przechodziły
// bokiem: funkcja zwracała 61 albo 2, maszyna te takty odliczała, a licznik
// procesora stał. Pętla bezczynności BIOS-u robi `OUT 8030h,0` i `HLT`, więc
// zatrzymanie zegara akurat tam znaczyło, że pierwszy zapis po wybudzeniu był
// oceniany względem chwili dawno minionej.
//
// Ostatnia kontrola jest ogólniejsza od pozostałych i to ona pilnuje przyszłych
// zmian: suma tego, co `step()` **zwrócił**, ma się równać przyrostowi tego, co
// `step()` **naliczył**. Dowolna nowa ścieżka wyjścia, która o liczniku zapomni,
// wywróci ten test bez potrzeby dopisywania kolejnego przypadku.

import { CPU8088 } from '../../js/emu/cpu8088.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

// Goła maszyna: program od 0000:0100, wektor 8 pokazuje na samo IRET.
function maszyna(prog, { irq = false } = {}) {
  const pam = new Uint8Array(1 << 20);
  pam.set(prog, 0x100);
  pam[8 * 4] = 0x00; pam[8 * 4 + 1] = 0x02;
  pam[0x200] = 0xCF;                        // IRET
  const bus = {
    read8: (a) => pam[a],
    write8: (a, v) => { pam[a] = v; },
    in8: () => 0xFF,
    out8: () => {},
    intAck: () => 8,
  };
  const cpu = new CPU8088(bus);
  cpu.reset();
  cpu.sregs[1] = 0;                         // CS
  cpu.ip = 0x100;
  cpu.regs[4] = 0x1000;                     // SP
  if (irq) { cpu.iff = 1; cpu.setIRQ(true); }
  return cpu;
}

const krok = (cpu) => {
  const przed = cpu.cycles;
  const zwrot = cpu.step();
  return { zwrot, przyrost: cpu.cycles - przed };
};

// --- 1. zwykła instrukcja ---------------------------------------------------

{
  const { zwrot, przyrost } = krok(maszyna([0x90]));       // NOP
  check('zwykła instrukcja nalicza tyle, ile zwraca', zwrot === przyrost,
        `zwrot ${zwrot}, przyrost ${przyrost}`);
}

// --- 2. takty spędzone w postoju --------------------------------------------

{
  const cpu = maszyna([0xF4]);                             // HLT
  cpu.step();
  const { zwrot, przyrost } = krok(cpu);                   // krok już w postoju
  check('takty w postoju po HLT są liczone', przyrost === zwrot && przyrost > 0,
        `zwrot ${zwrot}, przyrost ${przyrost}`);
}

// --- 3. przyjęte przerwanie -------------------------------------------------

{
  const { zwrot, przyrost } = krok(maszyna([0x90], { irq: true }));
  check('przyjęte przerwanie jest liczone', przyrost === zwrot && przyrost > 0,
        `zwrot ${zwrot}, przyrost ${przyrost}`);
}

// --- 4. przerwanie niemaskowalne --------------------------------------------

{
  const cpu = maszyna([0x90]);
  cpu.pulseNMI();
  const { zwrot, przyrost } = krok(cpu);
  check('przerwanie niemaskowalne jest liczone', przyrost === zwrot && przyrost > 0,
        `zwrot ${zwrot}, przyrost ${przyrost}`);
}

// --- 5. przerwanie budzi z postoju i też się liczy --------------------------

{
  const cpu = maszyna([0xF4]);                             // HLT
  cpu.step();
  cpu.iff = 1; cpu.setIRQ(true);
  const { zwrot, przyrost } = krok(cpu);
  check('przerwanie budzące z postoju jest liczone',
        przyrost === zwrot && przyrost > 0 && !cpu.halted,
        `zwrot ${zwrot}, przyrost ${przyrost}, postój ${cpu.halted}`);
}

// --- 6. niezmiennik na dłuższym przebiegu -----------------------------------
// Pętla z przerwaniami, postojem i zwykłą pracą: suma zwrotów ma się zgadzać
// z przyrostem licznika co do taktu.

{
  const cpu = maszyna([
    0xFB,                     // STI
    0x90, 0x90, 0x90,         // NOP x3
    0xF4,                     // HLT
    0xEB, 0xF9,               // JMP -7, z powrotem na STI
  ]);
  const start = cpu.cycles;
  let suma = 0;
  for (let i = 0; i < 5000; i++) {
    if (i % 97 === 0) cpu.setIRQ(true);
    suma += cpu.step();
    if (i % 97 === 0) cpu.setIRQ(false);
  }
  const przyrost = cpu.cycles - start;
  check('na 5000 kroków suma zwrotów równa się przyrostowi licznika',
        suma === przyrost, `suma ${suma}, przyrost ${przyrost}`);
}

process.exit(fails ? 1 : 0);
