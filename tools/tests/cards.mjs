// Karty z katalogu cards/ czytane dwoma niezależnymi drogami.
//
// Po jednej stronie nasz czytnik FAT12 z js/ui/fat12.js, po drugiej sam DIP-DOS
// wykonujący `DIR A:` na emulowanej maszynie. Zestaw sprawdza, czy obie drogi
// widzą ten sam zestaw plików — bo tylko zgodność z ROM-em jest tu dowodem, że
// czytnik nie zmyśla.
//
// Powstało przy dokładaniu obsługi kart 256 KB: okno karty w mapie procesora ma
// 128 KB i większa karta musi być stronicowana, a stronicowanie łatwo zepsuć
// tak, że karty mieszczące się w oknie przestaną działać. Ten zestaw pilnuje
// właśnie tego, że nie przestały.

import fs from 'node:fs';
import path from 'node:path';
import { boot, run, type, screen, bootToPrompt, romsAvailable, ROOT } from '../pofo-headless.mjs';
import { listFiles, readBPB, formatCard, addFile, readFile, freeSpace } from '../../js/ui/fat12.js';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

const dir = path.join(ROOT, 'cards');
const images = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.img')) : [];

if (!images.length) {
  console.log('POMINIĘTE — brak obrazów kart w cards/');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

/** Nazwy 8.3 wypisane przez `DIR A:`, znormalizowane do postaci NAZWA.ROZ. */
function namesFromScreen(text) {
  const out = new Set();
  for (const line of text.split('\n')) {
    // DIR wypisuje nazwę w kolumnach 1-8 i rozszerzenie w 10-12.
    const m = line.match(/^([a-z0-9_^$~!#%&@'`(){}-]{1,8})\s+([a-z0-9]{1,3})?\s+(<DIR>|\d)/i);
    if (!m) continue;
    out.add(m[2] ? `${m[1]}.${m[2]}`.toUpperCase() : m[1].toUpperCase());
  }
  return out;
}

for (const name of images.sort()) {
  const image = new Uint8Array(fs.readFileSync(path.join(dir, name)));

  let bpb;
  try {
    bpb = readBPB(image);
  } catch (err) {
    check(`${name}: BPB daje się odczytać`, false, err.message);
    continue;
  }

  const ours = new Set(listFiles(image)
    .filter((f) => !f.isVolume)
    .map((f) => f.name.toUpperCase()));

  const { machine, cpu } = boot();
  machine.reset();
  cpu.reset();
  bootToPrompt(machine, cpu);
  // Karta wchodzi dopiero po dojściu do wiersza poleceń. Gdyby siedziała
  // w slocie podczas rozruchu, DIP-DOS uruchomiłby z niej AUTOEXEC.BAT —
  // a karta z autostartem zabrałaby ekran, zanim `DIR` zdąży cokolwiek
  // wypisać. Napęd A: jest wymienny, więc włożenie w locie jest normalne.
  machine.insertCardA(image.slice(), false);      // kopia: test nie rusza pliku w repo
  type(machine, cpu, 'DIR A:\n');
  run(machine, cpu, 6000);
  const text = screen(machine).join('\n');
  const dos = namesFromScreen(text);

  // Ekran ma osiem wierszy, więc dłuższy listing zjeżdża w górę i widać tylko
  // ogon. Porównywać można zatem dwie rzeczy odporne na przewijanie: żadna
  // pokazana nazwa nie może być zmyślona, a podsumowanie „N Files" na końcu musi
  // zgadzać się z liczbą plików, które naliczył czytnik.
  const extra = [...dos].filter((f) => !ours.has(f));
  const tally = text.match(/(\d+)\s+Files?/i);

  check(`${name}: ${image.length / 1024} KB, sektor ${bpb.sectorSize} B, ${ours.size} plik(ów)`,
        ours.size > 0);
  check(`${name}: DOS nie pokazuje nazw spoza czytnika`, extra.length === 0, extra.join(', '));
  check(`${name}: DOS liczy tyle samo plików`, !!tally && Number(tally[1]) === ours.size,
        tally ? `DOS ${tally[1]}, czytnik ${ours.size}` : 'brak podsumowania na ekranie');
}

// Karta 256 KB: nie mieści się w 128-kilobajtowym oknie karty, więc musi być
// stronicowana, a DIP-DOS nie układa na niej woluminu płasko - dwa pierwsze
// sektory drugiej strony do woluminu nie należą. Zmierzone na obrazie zapisanym
// przez sam ROM: plik z wpisem katalogowym wskazującym klaster 386 (sektor 395
// wg BPB) leży w sektorze 397.
//
// Sprawdzane są oba kierunki, bo tylko razem coś dowodzą: czy nasz obraz czyta
// maszyna i czy nasz czytnik trafia w to, co maszyna zapisała.
{
  const card = formatCard(262144);
  const marker = 'ZNACZNIK-ZZA-GRANICY';
  addFile(card, 'DUZY.BIN', new Uint8Array(160 * 1024).fill(0x41), new Date());
  const eof = String.fromCharCode(13, 10, 26);
  addFile(card, 'MARKER.TXT', new TextEncoder().encode(marker + eof), new Date());

  const at = Buffer.from(card).indexOf(Buffer.from(marker));
  check('256 KB: znacznik trafia poza pierwszą stronę', at >= 0x20000,
        '0x' + at.toString(16));

  const back = readFile(card, 'MARKER.TXT');
  check('256 KB: własny czytnik odzyskuje plik zza granicy',
        !!back && new TextDecoder().decode(back).startsWith(marker));

  const { machine, cpu } = boot();
  machine.insertCardA(card, true);
  machine.reset();
  cpu.reset();
  bootToPrompt(machine, cpu);

  type(machine, cpu, 'DIR A:' + String.fromCharCode(10));
  run(machine, cpu, 6000);
  const listing = screen(machine).join(String.fromCharCode(10));
  const tally = listing.match(/(\d+)\s+Files?/i);
  check('256 KB: DOS listuje oba pliki', !!tally && Number(tally[1]) === 2,
        tally ? `DOS ${tally[1]}` : 'brak podsumowania');

  type(machine, cpu, 'TYPE A:MARKER.TXT' + String.fromCharCode(10));
  run(machine, cpu, 8000);
  check('256 KB: DOS czyta plik leżący w drugiej stronie',
        screen(machine).join(String.fromCharCode(10)).includes(marker));
}

process.exit(fails ? 1 : 0);
