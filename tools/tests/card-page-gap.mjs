// Sektor na styku stron karty 256 KB.
//
// Karta większa niż 128-kilobajtowe okno w mapie procesora jest stronicowana,
// a wolumin nie leży na tych stronach płasko: kilobajt — dwa sektory — wypada
// z niego przy każdej granicy. Wiadomo to było wcześniej; nie było wiadomo,
// *które* dwa sektory wypadają.
//
// Przyjęto, że są to dwa pierwsze sektory strony następnej. ROM czyta inaczej:
// sektor wolumenu 254 bierze ze strony 0 spod 1FC00h i przechodzi od razu na
// stronę 1 pod 200h. Wypada więc sektor **ostatni** strony razem z **pierwszym**
// strony następnej — przesunięcie o jeden sektor.
//
// Różnica ujawnia się na jednym jedynym sektorze wolumenu i tylko w pliku dość
// długim, żeby go zająć. Wszystko przed nim i po nim trafia tam gdzie trzeba,
// więc plik czytany przez DOS ma 512 bajtów śmieci w środku i nic poza tym.
// Jednemu z programów wystarczyło to, żeby jego depacker natrafił na fałszywy
// symbol końca strumienia i cichutko pominął cały jeden efekt.
//
// Zestaw sprawdza jedno i to samo dwiema drogami: gdzie nasz zapis kładzie
// sektor 255 i skąd ROM go bierze (INT 25h, odczyt sektora logicznego).

import { boot, run, bootToPrompt, callInterrupt, romsAvailable } from '../pofo-headless.mjs';
import { formatCard, readBPB, addFile, listFiles } from '../../js/ui/fat12.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

/** Ciąg, w którym żaden blok 512 B nie powtarza innego. */
function wzorzec(n) {
  const out = new Uint8Array(n);
  let x = 0x7E4D;
  for (let i = 0; i < n; i++) {
    x ^= (x << 7) & 0xFFFF; x ^= x >> 9; x ^= (x << 8) & 0xFFFF;
    out[i] = x & 0xFF;
  }
  return out;
}

const PAGE = 0x20000;
const GRANICA = 255;              // sektor wolumenu, który kończy się na granicy

// ---- karta, na której badany sektor jest zajęty ----------------------------

const img = formatCard(262144);
const bpb = readBPB(img);

// Wypełniacz dobija do sektora 255, próbka zajmuje 255 i 256.
const wypelniacz = wzorzec((GRANICA - bpb.dataStartSector) * bpb.sectorSize);
addFile(img, 'FILLER.BIN', wypelniacz, new Date(2026, 0, 1));
const proba = wzorzec(2 * bpb.sectorSize);
addFile(img, 'SPAN.BIN', proba, new Date(2026, 0, 1));

const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
const wpis = listFiles(img).find((e) => e.name === 'SPAN.BIN');
const klaster = wpis ? dv.getUint16(bpb.rootStart + wpis.index * 32 + 26, true) : 0;
const pierwszySektor = bpb.dataStartSector + (klaster - 2) * bpb.sectorsPerCluster;

check('próbka wypadła dokładnie na sektor styku', pierwszySektor === GRANICA,
      pierwszySektor === GRANICA ? '' : `zaczyna się na sektorze ${pierwszySektor}, miał na ${GRANICA}`);

// ---- 1. gdzie nasz zapis położył te dane ----------------------------------

const rowne = (a, ai, b, bi, n) => {
  for (let i = 0; i < n; i++) if (a[ai + i] !== b[bi + i]) return false;
  return true;
};

check('sektor styku leży na stronie 1 pod 200h',
      rowne(img, PAGE + 0x200, proba, 0, 512));

check('sektor po nim leży pod 400h',
      rowne(img, PAGE + 0x400, proba, 512, 512));

{
  // Kilobajt wypadający z woluminu to koniec strony 0 i początek strony 1.
  let zapisane = 0;
  for (let a = PAGE - 512; a < PAGE + 512; a++) if (img[a] !== 0xF6) zapisane++;
  check('kilobajt na styku został poza woluminem', zapisane === 0,
        zapisane ? `${zapisane} bajtów w 1FE00h–201FFh jednak zapisano` : '');
}

// ---- 2. skąd bierze je ROM -------------------------------------------------

if (!romsAvailable()) {
  console.log('POMINIĘTE (część z ROM-em) — brak plików ROM w rom/ (patrz README)');
  process.exit(fails ? 1 : 0);
}

const { machine, cpu } = boot();
bootToPrompt(machine, cpu);
machine.insertCardA(img, false);
run(machine, cpu, 300);

// Bufor w lustrze pamięci ekranu, powyżej 1920 bajtów trybu graficznego —
// obszaru, którego DOS przy wierszu poleceń nie rusza.
const SEG = 0xB000, OFS = 0x800, DS = 3;

function sektorPrzezDOS(nr) {
  for (let i = 0; i < 512; i++) machine.write8((SEG << 4) + OFS + i, 0xAA);
  cpu.sregs[DS] = SEG;
  const r = callInterrupt(machine, cpu, 0x25, { ax: 0x0000, cx: 1, dx: nr, bx: OFS });
  if (!r.halted) return null;
  const buf = new Uint8Array(512);
  for (let i = 0; i < 512; i++) buf[i] = machine.read8((SEG << 4) + OFS + i);
  return buf;
}

for (const [nr, zrodlo, od] of [
  [GRANICA - 1, wypelniacz, wypelniacz.length - 512],
  [GRANICA, proba, 0],
  [GRANICA + 1, proba, 512],
]) {
  const buf = sektorPrzezDOS(nr);
  if (!buf) { check(`ROM oddaje sektor ${nr}`, false, 'usługa nie wróciła'); continue; }
  const ok = rowne(buf, 0, zrodlo, od, 512);
  check(`ROM czyta sektor ${nr} stamtąd, gdzie go zapisaliśmy`, ok,
        ok ? '' : `dostaliśmy ${Buffer.from(buf.slice(0, 8)).toString('hex')}, `
           + `oczekiwano ${Buffer.from(zrodlo.slice(od, od + 8)).toString('hex')}`);
}

// ---- 3. karta mieszcząca się w oknie nie ma żadnej przerwy ------------------

{
  const maly = formatCard(131072);
  const b2 = readBPB(maly);
  const dane = wzorzec((GRANICA + 1 - b2.dataStartSector) * b2.sectorSize);
  addFile(maly, 'PLIK.BIN', dane, new Date(2026, 0, 1));
  const ostatni = dane.length - 512;
  check('na karcie 128 KB sektor 255 leży płasko pod 1FE00h',
        rowne(maly, 0x1FE00, dane, ostatni, 512));
}

process.exit(fails ? 1 : 0);
