// Regresja na demach: czy program, który wczoraj wyglądał tak, wygląda tak dalej.
//
// Powstało, bo brakowało tego dotkliwie. Model czasowy LCD i licznik taktów
// procesora zmieniano w tej samej sesji, w której zestaw powstał, a jedyne
// sprawdzenie było doraźnym skryptem poza repozytorium, odpalanym z pamięci
// i tylko wtedy, gdy akurat się o nim pomyślało. Przy zmianach czasów procesora
// to za mało: demo stoi na nich całym ciężarem, a psuje się cicho.
//
// Zestaw nie ocenia, czy obraz jest **poprawny** — od tego są oczy i prawdziwy
// Portfolio. Pilnuje, czy jest **taki sam jak wcześniej**. Kiedy któraś wartość
// przestanie się zgadzać, znaczy to jedno z dwóch: zmiana była zamierzona
// i trzeba wpisać nową liczbę, albo nie była i właśnie się o tym dowiedziałeś.
// Obie odpowiedzi są warte tego testu.
//
// Poza skrótem obrazu sprawdzana jest **szerokość linii** kontrolera. To ona
// przewraca się przy naruszeniu czasów dostępu, więc mówi wprost, czy program
// psuje się nadal w tym samym miejscu i w ten sam sposób.
//
// Obrazy kart nie należą do repozytorium — jeśli ich nie ma, blok się pomija.
// Ustaw ZAPISZ_WZORCE=1, żeby zamiast porównywać wypisał bieżące wartości.

import fs from 'node:fs';
import path from 'node:path';
import { boot, run, press, type, cardPath, romsAvailable, ROOT } from '../pofo-headless.mjs';
import { HPC104 } from '../../js/emu/hpc104.js';
import { SCREEN_W, SCREEN_H } from '../../js/emu/hd61830.js';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

const ZAPISZ = !!process.env.ZAPISZ_WZORCE;
let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

// FNV-1a po bitmapie panelu. Skrót, nie obraz — chodzi o wykrycie zmiany,
// nie o jej opisanie.
function skrot(machine) {
  const buf = new Uint8Array(SCREEN_W * SCREEN_H);
  machine.lcd.render(buf);
  let h = 0x811C9DC5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Rozruch bez ani jednego zbędnego klawisza. Bufor klawiatury BIOS-u trzeba na
// koniec opróżnić: program odpytuje wejście przez INT 21h AH=0Bh i każdy zaległy
// klawisz przeskoczyłby mu część pokazu.
function rozruch(obraz, moduly = 0) {
  const { machine, cpu } = boot();
  if (moduly >= 2) {
    const a = new HPC104({ unit: 1 }), b = new HPC104({ unit: 2 });
    a.attachNext(b); machine.attachExpansion(a);
  } else if (moduly === 1) {
    machine.attachExpansion(new HPC104({ unit: 1 }));
  }
  machine.insertCardA(new Uint8Array(fs.readFileSync(obraz)), false);
  machine.reset(); cpu.reset();
  // Ziarno ustalone, żeby uszkodzenie geometrii wypadało dwa razy tak samo.
  machine.lcd.setTiming({ threshold: true, seed: 0x2B7E });
  run(machine, cpu, 14000);              // test pamięci
  press(machine, cpu, 'Space');          // ekran praw autorskich
  run(machine, cpu, 2500);
  press(machine, cpu, 'KeyE');           // układ klawiatury
  run(machine, cpu, 2500);
  press(machine, cpu, 'Enter');          // data
  run(machine, cpu, 2500);
  press(machine, cpu, 'Enter');          // godzina
  run(machine, cpu, 2500);
  machine.ram[0x41A] = 0x1E; machine.ram[0x41B] = 0x00;
  machine.ram[0x41C] = 0x1E; machine.ram[0x41D] = 0x00;
  return { machine, cpu };
}

// Przewija do zadanych sekund licząc od chwili po rozruchu i zdejmuje próbki.
function probki(machine, cpu, sekundy) {
  const out = [];
  let bylo = 0;
  for (const s of sekundy) {
    run(machine, cpu, s * 1000 - bylo);
    bylo = s * 1000;
    out.push({ s, skrot: skrot(machine), hn: machine.lcd.hn });
  }
  return out;
}

function zestaw(nazwa, sciezka, moduly, przygotuj, sekundy, wzorce) {
  if (!fs.existsSync(sciezka)) {
    console.log(`POMINIĘTE — brak ${path.relative(ROOT, sciezka)} (obrazy kart nie należą do repozytorium)`);
    return;
  }
  const { machine, cpu } = rozruch(sciezka, moduly);
  if (przygotuj) przygotuj(machine, cpu);
  const wynik = probki(machine, cpu, sekundy);

  if (ZAPISZ) {
    console.log(`  ${nazwa}: ` + wynik.map((p) => `[${p.s}, '${p.skrot}', ${p.hn}]`).join(', '));
    return;
  }
  for (const p of wynik) {
    const [, ocz, oczHn] = wzorce.find((w) => w[0] === p.s) || [];
    check(`${nazwa}, ${p.s} s — obraz`, p.skrot === ocz, `${p.skrot} wobec ${ocz}`);
    check(`${nazwa}, ${p.s} s — szerokość linii`, p.hn === oczHn, `${p.hn} wobec ${oczHn}`);
  }
}

// --- Nucleus ----------------------------------------------------------------
// Uruchamiane z A: poleceniem N, gra około pięciu i pół minuty. Nie łamie czasów
// kontrolera, więc szerokość linii ma stać na 30 przez cały przebieg — ten blok
// pilnuje, żeby model czasowy nie zaczął psuć czegoś, co psuć się nie powinno.

zestaw('Nucleus', cardPath('nucleus.img'), 0, (machine, cpu) => {
  type(machine, cpu, 'A:\n'); run(machine, cpu, 1000);
  type(machine, cpu, 'N\n'); run(machine, cpu, 2000);
}, [60, 120, 240], [
  [60, '1128f24b', 30],
  [120, '260d0f79', 30],    // 1.02: the clock NMI every 128 s takes its cycles - 66 pixels moved
  [240, 'cd04e7eb', 30],
]);

// --- programy spoza repozytorium --------------------------------------------
// Druga strona medalu — program, który czasy kontrolera **łamie** — siedzi na
// obrazie karty, którego nie publikujemy, więc i jego opis trzyma się poza
// drzewem: `software/demos.local.json`, obok samych obrazów. Kształt pliku:
//
//   [{ "nazwa": "...",            nagłówek w wynikach
//      "obraz": "software/…/x.img",   ścieżka względem katalogu projektu
//      "moduly": 2,              ile modułów HPC-104 podłączyć (0-2)
//      "sekundy": [100, 200],    kiedy zdjąć próbki, licząc od promptu
//      "wzorce": [[100, "f9f040ab", 30], [200, "5f74cdc5", 4]] }]
//
// Bez tego pliku zestaw robi swoje i nic nie zgłasza. Wzorce zdejmuje się
// przebiegiem z ZAPISZ_WZORCE=1.

const lokalne = path.join(ROOT, 'software', 'demos.local.json');
if (fs.existsSync(lokalne)) {
  for (const d of JSON.parse(fs.readFileSync(lokalne, 'utf8'))) {
    zestaw(d.nazwa, path.join(ROOT, d.obraz), d.moduly || 0, null, d.sekundy, d.wzorce);
  }
}

process.exit(fails ? 1 : 0);
