// Surowe obrazy ROM na karcie: dopełnianie do rozmiaru układu i rozpoznawanie
// rozszerzenia ROM.
//
// Zgłoszone przez testera: rozszerzenie z podręcznika technicznego Atari ma
// 513 bajtów, a emulator powtarzał je w oknie karty co 513 bajtów. Na sprzęcie
// reszta wypalonego układu to FFh, a mały układ powtarza się co swój rozmiar.
// Zestaw sprawdza dopełnienie, to, co procesor faktycznie odczyta z okna karty,
// i opis karty, która nie ma systemu plików, bo jest rozszerzeniem.

import { cardSizeFor, padCardImage, romSignature } from '../../js/ui/cardimage.js';
import { cardOffset } from '../../js/emu/machine.js';
import * as fat from '../../js/ui/fat12.js';

let fails = 0;
const check = (ok, what, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const KB = 1024;

// ---- rozmiar układu --------------------------------------------------------

for (const [length, want] of [
  [1, 32 * KB], [513, 32 * KB], [32 * KB, 32 * KB], [32 * KB + 1, 64 * KB], [100000, 128 * KB],
  [128 * KB, 128 * KB], [128 * KB + 1, 256 * KB], [256 * KB, 256 * KB], [300000, 384 * KB], [1024 * KB, 1024 * KB],
]) {
  check(cardSizeFor(length) === want, `${length} B mieści się w układzie ${want / KB} KB`, String(cardSizeFor(length) / KB));
}

// ---- dopełnienie -------------------------------------------------------------

// Obraz w rodzaju rozszerzenia: słowo AA55h na początku, kod, koniec po 513 bajtach.
const xrom = new Uint8Array(513);
xrom[0] = 0x55; xrom[1] = 0xAA;
for (let i = 2; i < xrom.length; i++) xrom[i] = (i * 7) & 0x7F;
xrom[512] = 0x42;

const { image, padded } = padCardImage(xrom);
check(padded && image.length === 32 * KB, 'obraz 513 B dopełniony do 32 KB', `${image.length} B`);
check(image.subarray(0, 513).every((v, i) => v === xrom[i]), 'plik leży na początku, bajt w bajt');
check(image.subarray(513).every((v) => v === 0xFF), 'reszta to FFh, jak niezapisany EPROM');

const whole = fat.formatCard(128 * KB);
const same = padCardImage(whole);
check(!same.padded && same.image === whole, 'pełna karta zostaje nietknięta, ta sama tablica');
const banks = new Uint8Array(384 * KB);
check(!padCardImage(banks).padded, 'trzy banki EPROM po 128 KB też');
check(!padCardImage(new Uint8Array(0)).padded, 'pusty plik nie rośnie z niczego');

// ---- co odczyta procesor -----------------------------------------------------

// Okno karty ma 128 KB. Dawniej obraz 513 B powtarzał się w nim co 513 bajtów.
const read = (data, addr) => data[cardOffset({ data, page: 0 }, addr)];
check(read(xrom, 513) === 0x55, 'bez dopełnienia pod 513 wraca początek pliku — tak było', read(xrom, 513).toString(16));
check(read(image, 512) === 0x42 && read(image, 513) === 0xFF, 'po dopełnieniu za końcem pliku jest FFh');
check(read(image, 32 * KB) === 0x55 && read(image, 32 * KB + 1) === 0xAA,
      'układ 32 KB powtarza się w oknie co 32 KB, jak na sprzęcie');

// ---- opis karty --------------------------------------------------------------

check(romSignature(image) === 'AA55h', 'słowo AA55h rozpoznane');
check(romSignature(Uint8Array.of(0xAA, 0x55)) === '55AAh' && romSignature(Uint8Array.of(0x55, 0x55)) === '5555h',
      'pozostałe dwa słowa też');
check(romSignature(whole) === null, 'karta sformatowana tutaj nie udaje rozszerzenia');

let fatError = null;
try { fat.listFiles(image); } catch (err) { fatError = err.message; }
check(fatError !== null, 'surowy ROM nie przechodzi za dysk FAT12, więc okno karty sięgnie po opis rozszerzenia',
      fatError || 'listFiles przeszło');

process.exit(fails ? 1 : 0);
