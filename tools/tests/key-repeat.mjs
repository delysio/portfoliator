// Powtarzanie trzymanego klawisza.
//
// Na prawdziwym Portfolio trzymany klawisz powtarza się sam. Emulator tego nie
// robił, a próba dołożenia tego „gdzieś" kończy się źle, bo miejsce ma znaczenie:
//
//   - BIOS **nie** ma własnego powtarzania. Sprawdzone wprost: nakarmiony samymi
//     kodami naciśnięcia co 100 ms wypisuje równo dziesięć znaków na sekundę,
//     a nakarmiony jednym kodem i ciszą wypisuje jeden znak, choćby klawisz był
//     trzymany bez końca. Znak powstaje z **kodu**, nie ze stanu klawisza.
//   - Powtarzanie powstaje więc poniżej BIOS-u, w ASIC-u, i tam jest modelowane.
//     Nie w warstwie przeglądarki — bo tamto tempo ustawia system operacyjny
//     użytkownika, więc emulacja chodziłaby u każdego inaczej i nie dałaby się
//     przetestować bez przeglądarki.
//
// UWAGA: same liczby — pół sekundy zwłoki i dziesięć powtórzeń na sekundę — są
// domyślnymi wartościami IBM PC, wstawionymi po to, żeby zachowanie w ogóle
// istniało. **Nikt nie zmierzył ich na prawdziwym Portfolio.** Ten zestaw pilnuje
// więc mechanizmu, a nie tempa: sprawdza, że powtarzanie zaczyna się po zwłoce,
// idzie równo, słucha zwolnienia i nie dotyczy klawiszy, które nie dają znaku.

import { PofoKeyboard, DEFAULT_KEYMAP } from '../../js/emu/keyboard.js';
import { boot, run, bootToPrompt, screen } from '../pofo-headless.mjs';
import { romsAvailable } from '../pofo-headless.mjs';

const CLK = 4915200;
let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const A = DEFAULT_KEYMAP.KeyA, B = DEFAULT_KEYMAP.KeyB;
const SHIFT = DEFAULT_KEYMAP.ShiftLeft;

/**
 * Sama matryca, bez maszyny.
 *
 * Kody trzeba podsłuchiwać przy wstawianiu, a nie liczyć w kolejce: kolejka
 * jednocześnie się opróżnia, bo ASIC oddaje jeden kod na skanowanie przy 600 Hz.
 * Mierzymy, co ASIC **wygenerował**, nie co akurat w niej zostało.
 */
function matryca() {
  const kb = new PofoKeyboard(() => {});
  kb.setClock(CLK);
  const kody = [];
  let teraz = 0;
  // `restore()` podmienia całą tablicę kolejki, więc podsłuch trzeba móc założyć
  // ponownie — inaczej po wczytaniu stanu test nie widziałby niczego.
  const podsluchuj = () => {
    const push = kb.queue.push.bind(kb.queue);
    kb.queue.push = (kod) => { kody.push({ t: teraz, kod }); return push(kod); };
  };
  podsluchuj();
  return {
    kb,
    kody,
    podsluchuj,
    /** Przewija `ms` milisekund w krokach po jednej. */
    biegnij(ms) {
      const naKrok = Math.round(CLK / 1000);
      for (let i = 0; i < ms; i++) { teraz++; kb.advance(naKrok); }
    },
    ile: (kod) => kody.filter((k) => k.kod === kod).length,
  };
}

// --- zwłoka przed pierwszym powtórzeniem ------------------------------------
{
  const m = matryca();
  m.kb.keyDown(A);
  m.biegnij(2000);
  const kody = m.kody.filter((k) => k.kod === A);
  const powtorki = kody.slice(1);        // pierwszy to samo naciśnięcie
  check('trzymany klawisz w ogóle się powtarza', powtorki.length > 0, `${powtorki.length} powtórzeń`);
  check('pierwsze powtórzenie po zwłoce, nie od razu',
    powtorki.length > 0 && powtorki[0].t >= 495 && powtorki[0].t <= 505,
    powtorki.length ? `pierwsze po ${powtorki[0].t} ms` : 'brak');

  // Po zwłoce zostaje 1,5 s, czyli piętnaście powtórzeń przy dziesięciu na sekundę.
  check('tempo równe zadanemu', Math.abs(powtorki.length - 15) <= 1, `${powtorki.length} wobec 15`);

  const odstepy = powtorki.slice(1).map((k, i) => k.t - powtorki[i].t);
  check('odstępy między powtórzeniami równe',
    odstepy.every((d) => Math.abs(d - 100) <= 1), `odstępy ${[...new Set(odstepy)].sort().join(', ')} ms`);
}

// --- zwolnienie zatrzymuje -------------------------------------------------
{
  const m = matryca();
  m.kb.keyDown(A);
  m.biegnij(700);
  const przed = m.ile(A);
  check('przed zwolnieniem powtórzenia już były', przed > 1, `${przed} kodów`);
  m.kb.keyUp(A);
  m.biegnij(1000);
  check('po zwolnieniu nie dochodzi ani jedno powtórzenie', m.ile(A) === przed,
    `${przed} przed, ${m.ile(A)} po`);
}

// --- drugi klawisz przejmuje ------------------------------------------------
{
  const m = matryca();
  m.kb.keyDown(A);
  m.biegnij(700);
  const aPrzed = m.ile(A);
  m.kb.keyDown(B);                             // drugi klawisz, A wciąż wciśnięty
  m.biegnij(1000);
  check('po naciśnięciu drugiego klawisza pierwszy przestaje się powtarzać',
    m.ile(A) === aPrzed, `${aPrzed} przed, ${m.ile(A)} po`);
  check('powtarza się teraz drugi', m.ile(B) > 1, `${m.ile(B)} kodów B`);
}

// --- klawisze bez znaku nie powtarzają się ----------------------------------
{
  const m = matryca();
  m.kb.keyDown(SHIFT);
  m.biegnij(2000);
  check('Shift się nie powtarza', m.ile(SHIFT) === 1, `${m.ile(SHIFT)} kodów`);
}

// --- utrata ogniskowania ----------------------------------------------------
{
  const m = matryca();
  m.kb.keyDown(A);
  m.biegnij(700);
  const przed = m.ile(A);
  m.kb.releaseAll();
  m.biegnij(1000);
  check('releaseAll (blur) zatrzymuje powtarzanie', m.ile(A) === przed,
    `${przed} przed, ${m.ile(A)} po`);
}

// --- stan przeżywa zapis ----------------------------------------------------
{
  const a = matryca();
  a.kb.keyDown(A);
  a.biegnij(300);                              // w połowie zwłoki
  const kopia = JSON.parse(JSON.stringify(a.kb.snapshot()));

  const b = matryca();
  b.kb.restore(kopia);
  b.podsluchuj();
  b.kody.length = 0;
  b.biegnij(250);                              // zwłoka dobiega końca, mija jedno okno
  check('powtarzanie przeżywa zapis i wczytanie stanu', b.ile(A) === 1,
    `${b.ile(A)} powtórzeń po wczytaniu`);
}

// --- i to samo widziane przez BIOS ------------------------------------------
if (!romsAvailable()) {
  console.log('POMINIĘTE (koniec) — brak plików ROM w rom/, sprawdzenie przez BIOS odpada');
} else {
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);
  run(machine, cpu, 500);

  machine.keyboard.keyDown(DEFAULT_KEYMAP.KeyA);
  run(machine, cpu, 2000);
  machine.keyboard.keyUp(DEFAULT_KEYMAP.KeyA);
  run(machine, cpu, 300);

  // Tylko wiersz z zachętą: w tekście rozruchu też stoją litery „a" („New date",
  // „Operating"), a liczone z całego ekranu podbijały wynik o dwa.
  const wiersze = screen(machine, 25, 80).map((r) => r.replace(/ +$/, ''));
  const zacheta = wiersze.find((r) => r.startsWith('c>')) || '';
  const ile = zacheta.slice(2).split('').filter((c) => c === 'a').length;

  // Dwie sekundy trzymania: znak z samego naciśnięcia, potem powtórzenia od 500
  // do 2000 ms co sto — szesnaście sztuk, razem siedemnaście.
  check('BIOS wypisuje powtórzenia na ekran', Math.abs(ile - 17) <= 1, `${ile} znaków wobec 17`);
  check('powtórzenia idą jednym ciągiem', zacheta.includes('aaaa'), zacheta);
}

console.log(fails ? `\n${fails} kontroli nie przeszło` : '\nwszystkie kontrole przeszły');
process.exit(fails ? 1 : 0);
