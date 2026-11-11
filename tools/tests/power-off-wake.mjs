// Wybudzanie klawiszem po poleceniu OFF.
//
// Tryb OFF z sekcji 2.5.1 przewodnika DIP-a to nie czuwanie: zasilany jest tylko
// układ ASIC i pamięć RAM, procesor stoi bez napięcia. Powrót idzie więc przez
// impuls MRST, czyli sprzętowy ciepły restart — a ROM zgadza się go wykonać
// dopiero wtedy, gdy ASIC pokaże mu jedno i drugie: bit 7 w rejestrze 8051h
// („to jest włączenie zasilania") oraz źródło wybudzenia w 8041h. Bez
// któregokolwiek z nich BIOS wraca do trybu OFF w kilkanaście milisekund.
//
// Zestaw pilnuje też tego, co odróżnia wybudzenie od zimnego startu: RAM ma
// przeżyć, więc plik zapisany przed OFF musi być czytelny po powrocie.

import { boot, run, type, screen, bootToPrompt, romsAvailable } from '../pofo-headless.mjs';
import { DEFAULT_KEYMAP } from '../../js/emu/keyboard.js';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) fails++; };

/** Doprowadza maszynę do stanu po poleceniu OFF, ze śladem na dysku C:. */
function offWithFile() {
  const {machine, cpu} = boot();
  bootToPrompt(machine, cpu);
  type(machine, cpu, 'ECHO SLAD > TEST.TXT\n');
  run(machine, cpu, 1500);
  type(machine, cpu, 'OFF\n');
  run(machine, cpu, 1500);
  return {machine, cpu};
}

/** Liczy zapalone punkty matrycy — pusty ekran to zero. */
function litPixels(machine) {
  const buf = new Uint32Array(240 * 64);
  machine.lcd.render(buf);
  return buf.reduce((n, v) => n + (v ? 1 : 0), 0);
}

// 1. Samo polecenie OFF gasi maszynę i mówi, którym trybem.
{
  const {machine} = offWithFile();
  check('OFF wyłącza maszynę', machine.poweredOff === true);
  check('OFF odróżnia się od czuwania', machine.powerOffCause === 'off');
}

// 2. Klawisz wybudza — i jest to restart, nie wznowienie.
{
  const {machine, cpu} = offWithFile();
  const what = machine.wake();
  check('wake() zgłasza wybudzenie impulsem MRST', what === 'off');
  run(machine, cpu, 4000);
  check('maszyna nie wraca do trybu OFF', machine.poweredOff === false);

  const lit = litPixels(machine);
  check('ekran znów coś pokazuje', lit > 0, `${lit} punktów`);

  // Sesja żyje: DOS przyjmuje polecenia, a plik sprzed OFF jest na miejscu.
  type(machine, cpu, 'TYPE TEST.TXT\n');
  run(machine, cpu, 2500);
  const scr = screen(machine).slice(-8).join(' | ');
  check('DOS odpowiada po wybudzeniu', /type test\.txt/i.test(scr), scr.slice(0, 80));
  check('dysk C: przeżył wybudzenie', /slad/i.test(scr), scr.slice(0, 80));
}

// 3. Zatrzask zasilania nie zostaje na później: kolejny ciepły restart ma być
//    ciepły, a nie wzięty przez ROM za zimny start.
{
  const {machine, cpu} = offWithFile();
  machine.wake();
  run(machine, cpu, 4000);
  check('zatrzask włączenia skasowany po odczycie', machine.powerUpLatch === 0);
  check('konfiguracja baterii nietknięta', machine.batteryConfig === 0x01,
        '0x' + machine.batteryConfig.toString(16));
}

// 4. Klawisz budzący pracuje jak przycisk zasilania, a nie jak klawisz: worker
//    nie wstrzykuje go do matrycy, więc kolejka klawiatury zostaje pusta.
{
  const {machine, cpu} = offWithFile();
  machine.wake();
  run(machine, cpu, 100);
  check('klawisz budzący nie trafia do bufora', machine.keyboard.queue.length === 0,
        `${machine.keyboard.queue.length} w kolejce`);
}

process.exit(fails ? 1 : 0);
