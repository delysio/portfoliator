// Kontrast: rejestr, klawisze i to, że da się go odczytać.
//
// Wartość kontrastu żyje **wyłącznie** w rejestrze pod `8060h` — nigdzie
// w pamięci nie ma jej kopii. ROM zmienia ją tak (`E000:1BA0`):
//
//   mov dx, 8060h / in al, dx / cmp al, 0FCh / jnb dalej / add al, 4 / out dx, al
//
// czyli **czyta port, dodaje cztery i zapisuje z powrotem**. Dopóki odczyt
// `8060h` zwracał zero — a zwracał, bo maszyna nie obsługiwała tego portu przy
// czytaniu — ROM za każdym razem widział zero, dodawał cztery i zapisywał
// cztery. Klawisze kontrastu ruszały obraz dokładnie raz, po czym stawały.
//
// Stąd te kontrole: nie tyle o kontrast, ile o to, że rejestr **oddaje to, co
// w nim jest**, bo na tym stoi cała reszta.

import { boot, run, bootToPrompt, chord, romsAvailable } from '../pofo-headless.mjs';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const { machine, cpu } = boot();
bootToPrompt(machine, cpu);

// Atari to klawisz w lewym górnym rogu, u nas `Backquote`.
const krok = (kier, ile = 1) => {
  for (let i = 0; i < ile; i++) { chord(machine, cpu, 'Backquote', kier); run(machine, cpu, 120); }
  return machine.contrast;
};

// --- 1. co zostawia rozruch --------------------------------------------------

check('rozruch ustawia kontrast na środek zakresu', machine.contrast === 0x80,
      `${machine.contrast} (${machine.contrast.toString(16)}h)`);

// --- 2. port oddaje to, co w nim jest ---------------------------------------

{
  machine.out8(0x8060, 0x44);
  const odczyt = machine.in8(0x8060);
  check('odczyt portu zwraca zapisaną wartość', odczyt === 0x44, `${odczyt.toString(16)}h`);
  machine.out8(0x8060, 0x80);
}

// --- 3. klawisze ruszają go w obie strony, po cztery -------------------------

{
  const start = machine.contrast;
  const gora = krok('ArrowUp');
  check('Atari + w górę dodaje cztery', gora === start + 4, `${start} -> ${gora}`);
  const dol = krok('ArrowDown');
  check('Atari + w dół odejmuje cztery', dol === start, `${gora} -> ${dol}`);
}

// --- 4. i robią to za każdym razem, a nie tylko raz --------------------------
// To jest ta kontrola, która wcześniej by nie przeszła: bez odczytu portu ROM
// zapisywał cztery i przy każdym kolejnym naciśnięciu znów cztery.

{
  const kolejne = [];
  for (let i = 0; i < 5; i++) kolejne.push(krok('ArrowUp'));
  const rosnie = kolejne.every((v, i) => i === 0 || v === kolejne[i - 1] + 4);
  check('pięć naciśnięć pod rząd daje pięć różnych wartości', rosnie, kolejne.join(', '));
  krok('ArrowDown', 5);
}

// --- 5. ROM pilnuje obu końców ----------------------------------------------

{
  const max = krok('ArrowUp', 60);
  check('w górę zatrzymuje się na FCh', max === 0xFC, `${max} (${max.toString(16)}h)`);
  const min = krok('ArrowDown', 80);
  check('w dół zatrzymuje się na zerze', min === 0, `${min}`);
  const zdna = krok('ArrowUp');
  check('z dna da się wrócić', zdna === 4, `${zdna}`);
}

// --- 6. zakres ma sześćdziesiąt cztery stopnie ------------------------------

{
  krok('ArrowDown', 5);
  let stopni = 0;
  while (machine.contrast < 0xFC && stopni < 100) { krok('ArrowUp'); stopni++; }
  check('od zera do końca jest 63 stopnie', stopni === 63, `${stopni}`);
}

process.exit(fails ? 1 : 0);
