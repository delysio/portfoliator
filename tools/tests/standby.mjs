import { boot, run, screen, press, type, bootToPrompt, romsAvailable } from '../pofo-headless.mjs';

import { DEFAULT_KEYMAP } from '../../js/emu/keyboard.js';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) fails++; };

// 1. Wyłączone (0) — nigdy nie zasypia, jak dotąd.
{
  const {machine, cpu} = boot();
  machine.standbyPeriods = 0;
  bootToPrompt(machine, cpu);
  let slept = false;
  for (let s=0; s<400 && !slept; s++) { run(machine,cpu,1000); slept = machine.poweredOff; }
  check('standbyPeriods=0 nie usypia przez 400 s', !slept);
}

// 2. Zgodność ze sprzętem (2 okresy) — usypia między 128 a 256 s.
{
  const {machine, cpu} = boot();
  machine.standbyPeriods = 2;
  bootToPrompt(machine, cpu);
  let at = null;
  for (let s=1; s<=400; s++) { run(machine,cpu,1000); if (machine.poweredOff) { at = s; break; } }
  check('usypia w oknie 128-256 s', at !== null && at >= 128 && at <= 256, 'po ' + at + ' s');

  // Od 1.02 wyłącza BIOS, odliczając NMI zegara, i robi to trybem OFF (E000:2087).
  check('samoczynne wyłączenie to tryb OFF', machine.powerOffCause === 'off', String(machine.powerOffCause));

  // 3. Klawisz budzi i sesja trwa dalej.
  const woke = machine.wake();
  press(machine, cpu, 'Space');
  run(machine, cpu, 1500);
  check('wake() zgłasza wybudzenie impulsem MRST', woke === 'off');
  check('po wybudzeniu procesor znów pracuje', !cpu.halted || machine.poweredOff === false);
  type(machine, cpu, 'VER\n');
  run(machine, cpu, 2000);
  const scr = screen(machine).slice(-6).join(' | ');
  check('maszyna reaguje po wybudzeniu', /DIP|VER|Operating/i.test(scr), scr.slice(0,90));
}

// 4. Klawisze odsuwają zaśnięcie.
{
  const {machine, cpu} = boot();
  machine.standbyPeriods = 2;
  bootToPrompt(machine, cpu);
  let slept = false;
  for (let s=0; s<300 && !slept; s++) {      // stukaj co 60 s
    run(machine, cpu, 60000);
    slept = machine.poweredOff;
    if (!slept) press(machine, cpu, 'Space');
    s += 60;
  }
  check('aktywność klawiatury odsuwa uśpienie', !slept);
}

console.log(fails ? `\n${fails} nie przeszło` : '\nwszystkie testy przeszły');
process.exit(fails ? 1 : 0);
