// Odczyt C:\SYSTEM\PERMDATA.DAT z pamięci maszyny.
//
// Plik trzyma stan wbudowanych aplikacji — DIP rozpisuje go co do bajta na
// str. 3-35 i 3-36. Dysk C: to RAM-dysk w NVRAM-ie: zwykły FAT12, tyle że
// o sektorze 128-bajtowym, więc czytnik kart z js/ui/fat12.js radzi sobie z nim
// bez zmian, o ile najpierw znajdzie się wolumin po sygnaturze „DIP" w OEM.
//
// Zestaw wymusza powstanie pliku (wejście do Edytora i wyjście z niego), a potem
// sprawdza, czy odczyt zgadza się z tym, co widać na ekranie samego Portfolio.

import { boot, run, press, chord, screen, bootToPrompt, romsAvailable } from '../pofo-headless.mjs';
import { findRamDisk, ramDiskImage, readPermdata } from '../../js/ui/permdata.js';
import { listFiles, readPath } from '../../js/ui/fat12.js';
import { HPC104 } from '../../js/emu/hpc104.js';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) fails++; };

const {machine, cpu} = boot();
bootToPrompt(machine, cpu);

// 1. RAM-dysk daje się znaleźć i sparsować czytnikiem kart.
{
  const base = findRamDisk(machine.ram);
  check('RAM-dysk odnaleziony w pamięci', base > 0, '0x' + base.toString(16));

  const image = ramDiskImage(machine.ram);
  check('wolumin zmieścił się w pamięci', image !== null);
  const root = listFiles(image);
  check('w katalogu głównym jest SYSTEM', root.some((f) => f.isDirectory && f.name === 'SYSTEM'),
        root.map((f) => f.name).join(', ') || '(pusto)');
}

// 2. Świeża maszyna jeszcze tego pliku nie ma — i mówi o tym wprost.
{
  const r = readPermdata(machine.ram);
  check('bez wizyty w aplikacji zgłasza brak pliku', r.ok === false && /wyjściu/.test(r.why));
}

// 3. Wejście do Edytora i wyjście z niego zapisuje plik. Nic tu nie piszemy:
//    pusty dokument wychodzi bez pytania „Save?", więc sekwencja jest krótsza
//    i nie zależy od tego, gdzie w okienku dialogowym stoi kursor.
chord(machine, cpu, 'Backquote', 'KeyE');     // Atari + E
run(machine, cpu, 2000);
press(machine, cpu, 'Escape');                // wyjście z aplikacji do DOS-u
run(machine, cpu, 3000);

{
  const raw = readPath(ramDiskImage(machine.ram), 'SYSTEM/PERMDATA.DAT');
  check('plik powstał', raw !== null);
  check('ma dokumentowane 730 bajtów', raw && raw.length === 730, raw ? `${raw.length} B` : '—');
}

// 4. Dekodowanie zgadza się z tym, co Portfolio pokazuje w Setupie i w Edytorze.
{
  const r = readPermdata(machine.ram);
  check('odczyt się udał', r.ok === true, r.ok ? '' : r.why);
  if (!r.ok) process.exit(1);
  const d = r.data;

  // Ekran Setup -> RS-232 port pokazuje 9600 / None / 8 / 1.
  check('RS-232: prędkość', d.serial.baud === 9600, String(d.serial.baud));
  check('RS-232: parzystość', d.serial.parity === 'brak', d.serial.parity);
  check('RS-232: bity danych', d.serial.dataBits === 8, String(d.serial.dataBits));
  check('RS-232: bity stopu', d.serial.stopBits === 1, String(d.serial.stopBits));

  // Pasek edytora pokazywał M:37 — to prawy margines.
  check('edytor: prawy margines', d.editor.rightMargin === 37, String(d.editor.rightMargin));
  check('edytor: ostatni plik', /UNNAMED\.TXT/i.test(d.editor.lastFile), d.editor.lastFile);
  check('terminarz: ostatni plik', /DIARY\.DRY/i.test(d.diary.lastFile), d.diary.lastFile);
  check('drukarka: cel wydruku', d.printer.destination === 'port równoległy', d.printer.destination);
  check('drukarka: linii na stronę', d.printer.linesPerPage === 66, String(d.printer.linesPerPage));
  check('arkusz: symbol waluty', d.worksheet.currency === '$', d.worksheet.currency);
}

// 5. Z rozszerzeniem HPC-104 dysk C: wyprowadza się z pamięci pokładowej.
//
//    Po zimnym starcie DIP-DOS przelicza pamięć, widzi 256 KB więcej i zakłada
//    RAM-dysk w pamięci rozszerzenia, mapowanej od 0x1F000 — a więc poza tablicą
//    `machine.ram`. Czytnik patrzący wyłącznie w nią meldował wtedy „Nie
//    znaleziono dysku C:", mimo że dysk istniał i miał pliki. Zestaw pilnuje obu
//    stron tej różnicy naraz, bo dopiero razem tłumaczą, na czym polegał błąd.
{
  /** Rozruch prowadzony ekranem: z rozszerzeniem liczenie pamięci trwa dłużej. */
  const bootPatiently = (machine, cpu) => {
    for (let step = 0; step < 40; step++) {
      run(machine, cpu, 500);
      const scr = screen(machine).join(' | ');
      if (/c>\s*$/.test(scr)) return true;
      if (/New date|Neues Datum|New time|Neue Zeit/.test(scr)) press(machine, cpu, 'Enter');
      else if (/keyboard|Tastatur|English/i.test(scr)) press(machine, cpu, 'KeyE');
      else press(machine, cpu, 'Space');
    }
    return false;
  };

  const expansion = new HPC104({});
  const {machine, cpu} = boot();
  machine.attachExpansion(expansion);
  machine.batteryConfig = 0x03;          // zimny start, żeby pamięć została przeliczona
  machine.reset();
  cpu.reset();
  check('maszyna z HPC-104 dochodzi do promptu', bootPatiently(machine, cpu));

  check('w samej pamięci pokładowej dysku C: nie ma', findRamDisk(machine.ram) < 0);

  const image = ramDiskImage(machine.ram, expansion.ram);
  check('z pamięcią rozszerzenia wolumin się znajduje', image !== null,
        image ? `${image.length} B` : '—');
  check('i jest na nim katalog SYSTEM',
        !!image && listFiles(image).some((f) => f.name === 'SYSTEM'));

  const r = readPermdata(machine.ram, expansion.ram);
  check('odczyt nie zgłasza już braku dysku C:',
        r.ok || !/Nie znaleziono dysku C:/.test(r.why), r.ok ? '' : r.why.slice(0, 60));
}

process.exit(fails ? 1 : 0);
