// Prędkość przerwania zegara systemowego (INT 61h Fn 1Eh).
//
// Portfolio ma dokładnie dwie prędkości tiku — raz na sekundę i raz na 128 sekund
// — a wybiera je zapisem do portu 8040h: 01h to tryb szybki, 00h wolny. Rejestr
// namierzono, śledząc zapisy do portów w trakcie wywołania Fn 1Eh; przez cały
// rozruch, kilka poleceń DOS-u i 20 s bezczynności jest to jedyny zapis pod ten
// adres, więc port nie robi nic poza wyborem prędkości.
//
// Zestaw pilnuje trzech rzeczy: że BIOS przy starcie wybiera tryb wolny, że
// Fn 1Eh faktycznie przełącza w obie strony i że tik przychodzi z częstotliwością,
// którą maszyna sobie zamówiła — a nie z tą, którą wpisaliśmy na sztywno.

import { boot, run, bootToPrompt, callInterrupt, romsAvailable } from '../pofo-headless.mjs';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) fails++; };

const GET = { ax: 0x1E00 };
const setRate = (fast) => ({ ax: 0x1E01, bx: fast ? 1 : 0 });

/** Liczy przerwania wektora 08h przez zadany czas maszynowy. */
function countTicks(machine, cpu, ms) {
  let n = 0;
  const raw = machine.triggerInterrupt.bind(machine);
  machine.triggerInterrupt = (src) => { if (src === 0) n++; return raw(src); };
  run(machine, cpu, ms);
  machine.triggerInterrupt = raw;
  return n;
}

const {machine, cpu} = boot();
bootToPrompt(machine, cpu);

// 1. Stan po rozruchu: tik działa, ale w trybie oszczędnym, tak jak wybrał BIOS.
check('tik jest włączony domyślnie', machine.systemTickEnabled === true);
check('BIOS wybiera przy starcie tryb wolny', machine.systemTickFast === false);
check('Fn 1Eh zgłasza tryb wolny', callInterrupt(machine, cpu, 0x61, GET).bx === 0);
check('w trybie wolnym nie ma tików w 10 s', countTicks(machine, cpu, 10000) === 0);

// 2. Przełączenie na tryb szybki — i tik faktycznie przyspiesza.
callInterrupt(machine, cpu, 0x61, setRate(true));
check('Fn 1Eh zgłasza tryb szybki po ustawieniu', callInterrupt(machine, cpu, 0x61, GET).bx === 1);
check('port przełączył model', machine.systemTickFast === true);
{
  const n = countTicks(machine, cpu, 10000);
  check('w trybie szybkim tik co sekundę', n >= 9 && n <= 11, `${n} tików w 10 s`);
}

// 3. Powrót do trybu wolnego.
callInterrupt(machine, cpu, 0x61, setRate(false));
check('Fn 1Eh wraca do trybu wolnego', callInterrupt(machine, cpu, 0x61, GET).bx === 0);
check('po powrocie znów brak tików w 10 s', countTicks(machine, cpu, 10000) === 0);

// 4. Ciepły restart oddaje maszynę w stanie wyjściowym, a BIOS i tak wybiera na nowo.
{
  const {machine: m2, cpu: c2} = boot();
  bootToPrompt(m2, c2);
  callInterrupt(m2, c2, 0x61, setRate(true));
  m2.reset(); c2.reset();
  run(m2, c2, 3000);
  check('restart nie zostawia trybu szybkiego', m2.systemTickFast === false);
}

process.exit(fails ? 1 : 0);
