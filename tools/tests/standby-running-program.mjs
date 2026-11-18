import { boot, run, screen, press, type, bootToPrompt, insertCard, cardPath, romsAvailable } from '../pofo-headless.mjs';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) fails++; };

// Demo działające bez klawiatury nie może zostać zabite.
{
  const {machine, cpu} = boot();
  insertCard(machine, cardPath('nucleus.img'));
  machine.reset(); cpu.reset();
  machine.standbyPeriods = 2;
  bootToPrompt(machine, cpu);
  type(machine, cpu, 'A:\n'); run(machine, cpu, 1000);
  type(machine, cpu, 'N\n');  run(machine, cpu, 3000);
  const running = !cpu.halted;
  // Nucleus gra ok. 5,5 minuty i sam wraca do promptu. Liczy się to, żeby nie
  // zostało przerwane w trakcie - 300 s to bezpiecznie wewnątrz jego przebiegu.
  let at = null, haltedSecs = 0;
  for (let s = 1; s <= 300; s++) {
    let h = 0;
    for (let i = 0; i < 10; i++) { run(machine, cpu, 100); if (cpu.halted) h++; }
    if (h) haltedSecs++;
    if (machine.poweredOff) { at = s; break; }
  }
  check('Nucleus rusza i zajmuje procesor', running);
  check('demo nie zostaje przerwane przez 300 s grania', at === null, at ? 'zabite po ' + at + ' s' : '');
  check('procesor ani razu nie stanął w trakcie demo', haltedSecs === 0, haltedSecs + ' s z HLT');
  // Odliczanie prowadzi BIOS w 0040:014C, a przeładowuje je, dopóki od ostatniego
  // postoju w pętli oczekiwania przyszedł klawisz (0040:0125 bit 7). Demo do tej
  // pętli nie zagląda, więc licznik ma stać na pełnej wartości.
  const zostalo = machine.ram[0x54C] | (machine.ram[0x54D] << 8);
  check('odliczanie BIOS-u stoi w trakcie demo', zostalo === 2, 'zostało ' + zostalo);
}

// Ale bezczynny prompt nadal ma zasypiać.
{
  const {machine, cpu} = boot();
  machine.standbyPeriods = 2;
  bootToPrompt(machine, cpu);
  let at = null;
  for (let s = 1; s <= 400; s++) { run(machine, cpu, 1000); if (machine.poweredOff) { at = s; break; } }
  check('bezczynny prompt nadal zasypia w oknie 128-256 s', at !== null && at >= 128 && at <= 256, 'po ' + at + ' s');
}

// I nadal budzi się klawiszem.
{
  const {machine, cpu} = boot();
  machine.standbyPeriods = 2;
  bootToPrompt(machine, cpu);
  for (let s = 1; s <= 400 && !machine.poweredOff; s++) run(machine, cpu, 1000);
  machine.wake();
  press(machine, cpu, 'Space');
  type(machine, cpu, 'VER\n');
  run(machine, cpu, 2500);
  check('po uśpieniu i wybudzeniu maszyna odpowiada',
    /DIP Operating System/i.test(screen(machine).join(' ')));
}

console.log(fails ? `\n${fails} nie przeszło` : '\nwszystkie testy przeszły');
process.exit(fails ? 1 : 0);
