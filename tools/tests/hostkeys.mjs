// Klawiatura hosta: czy do matrycy trafia to samo, niezależnie od przeglądarki.
//
// Powstało z konkretnej awarii. W Chrome i Firefoksie emulator działał, a w
// LibreWolfie nie dawało się zmienić napędu, bo Shift „nie istniał". Zrzut
// zdarzeń z tej przeglądarki (Firefox 154 z resistFingerprinting, strefa
// podmieniona na Atlantic/Reykjavik) pokazał rzecz nieoczywistą: przy Shift+";"
// przychodzą **wyłącznie** zdarzenia klawisza `Semicolon`, za to z `shiftKey`
// ustawionym na `true` i z `key` rozwiązanym na ":". Samego Shifta nie ma ani
// w keydown, ani w keyup.
//
// Dla emulatora, który wysyła do ROM-u gołe kody klawiszy, to znaczy tyle, że
// kod 27 nigdy nie wychodzi i Portfolio widzi średnik. Stąd uzupełnianie
// modyfikatorów z flag — a stąd ten zestaw, bo jest to jedyna część emulatora
// zależna od tego, jak zachowa się cudza przeglądarka, i jedyna, której nie
// widać w żadnym innym teście.
//
// Przebiegi niżej to prawdziwe zdarzenia: kolumny `code`, `key` i `shiftKey`
// przepisane ze zrzutów z obu przeglądarek.

import { HostKeyboard } from '../../js/ui/hostkeys.js';
import { PofoKeyboard, DEFAULT_KEYMAP } from '../../js/emu/keyboard.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const SHIFT = 27, CTRL = 18, ALT = 9, SEMI = 51, A = 62;
const gora = (sc) => 0x80 | sc;

/**
 * Przepuszcza ciąg zdarzeń przez klawiaturę hosta do prawdziwej matrycy
 * i zwraca kody w tej kolejności, w której zobaczy je ROM.
 */
function przepusc(zdarzenia) {
  const kb = new PofoKeyboard(() => {});
  const host = new HostKeyboard((typ, sc) => (typ === 'keydown' ? kb.keyDown(sc) : kb.keyUp(sc)));
  for (const z of zdarzenia) {
    if (z === 'blur') { kb.releaseAll(); host.forget(); kb.queue.length = 0; continue; }
    const e = { code: z.code, key: z.key ?? '', shiftKey: !!z.shift, ctrlKey: !!z.ctrl, altKey: !!z.alt };
    if (host.scancode(e) === undefined) continue;
    if (z.typ === 'down') host.down(e); else host.up(e);
  }
  return { kody: kb.queue.slice(), trzyma: [...kb.held].sort((a, b) => a - b) };
}

// --- Firefox i Chrome: Shift przychodzi jako klawisz ------------------------
{
  const { kody, trzyma } = przepusc([
    { typ: 'down', code: 'ShiftLeft', key: 'Shift', shift: true },
    { typ: 'down', code: 'Semicolon', key: ':', shift: true },
    { typ: 'up',   code: 'Semicolon', key: ':', shift: true },
    { typ: 'up',   code: 'ShiftLeft', key: 'Shift', shift: false },
  ]);
  check('Firefox: Shift+";" daje 27, 51 i zwolnienia w odwrotnej kolejności',
    JSON.stringify(kody) === JSON.stringify([SHIFT, SEMI, gora(SEMI), gora(SHIFT)]),
    kody.join(' '));
  check('Firefox: nic nie zostaje wciśnięte', trzyma.length === 0, trzyma.join(' '));
}

// --- LibreWolf: Shifta nie ma wcale -----------------------------------------
// Dokładnie ten przebieg, który przyszedł ze sprzętu użytkownika: dwa naciśnięcia
// z Shiftem, dwa bez, i znów dwa z Shiftem — bez ani jednego zdarzenia Shifta.
{
  const { kody } = przepusc([
    { typ: 'down', code: 'Semicolon', key: ':', shift: true },
    { typ: 'up',   code: 'Semicolon', key: ':', shift: true },
    { typ: 'down', code: 'Semicolon', key: ';', shift: false },
    { typ: 'up',   code: 'Semicolon', key: ';', shift: false },
    { typ: 'down', code: 'Semicolon', key: ':', shift: true },
    { typ: 'up',   code: 'Semicolon', key: ':', shift: true },
  ]);
  check('LibreWolf: zastępczy Shift wchodzi PRZED średnikiem',
    kody[0] === SHIFT && kody[1] === SEMI, kody.join(' '));
  check('LibreWolf: cały przebieg wygląda jak z Firefoksa',
    JSON.stringify(kody) === JSON.stringify([
      SHIFT, SEMI, gora(SEMI),          // ":" — Shift dostawiony
      gora(SHIFT), SEMI, gora(SEMI),    // ";" — Shift puszczony, bo flaga zgasła
      SHIFT, SEMI, gora(SEMI),          // ":" — i z powrotem
    ]), kody.join(' '));
}

// --- Shift puszczony bez żadnego zdarzenia ----------------------------------
// W LibreWolfie zwolnienie Shifta nie daje zdarzenia, więc zastępczy klawisz
// musi zostać zdjęty przy najbliższej okazji — inaczej matryca trzyma go na
// zawsze i każda kolejna litera wychodzi wielka.
{
  const { kody, trzyma } = przepusc([
    { typ: 'down', code: 'Semicolon', key: ':', shift: true },
    { typ: 'up',   code: 'Semicolon', key: ':', shift: true },
    { typ: 'down', code: 'KeyA', key: 'a', shift: false },
  ]);
  check('zastępczy Shift schodzi, gdy flaga gaśnie bez zdarzenia',
    kody[kody.length - 2] === gora(SHIFT) && kody[kody.length - 1] === A, kody.join(' '));
  check('po tym matryca trzyma już tylko literę',
    JSON.stringify(trzyma) === JSON.stringify([A]), trzyma.join(' '));
}

// --- utrata ogniskowania ----------------------------------------------------
{
  const { kody, trzyma } = przepusc([
    { typ: 'down', code: 'Semicolon', key: ':', shift: true },
    'blur',
    { typ: 'down', code: 'KeyA', key: 'a', shift: false },
  ]);
  check('po blur nic nie zostaje wciśnięte poza nowym klawiszem',
    JSON.stringify(trzyma) === JSON.stringify([A]), trzyma.join(' '));
  check('po blur nie wychodzi zwolnienie klawisza, którego matryca już nie trzyma',
    JSON.stringify(kody) === JSON.stringify([A]), kody.join(' '));
}

// --- Ctrl i Alt tak samo ----------------------------------------------------
{
  const { kody } = przepusc([{ typ: 'down', code: 'KeyA', key: 'a', ctrl: true }]);
  check('Ctrl uzupełnia się tak samo jak Shift',
    JSON.stringify(kody) === JSON.stringify([CTRL, A]), kody.join(' '));
}
{
  const { kody } = przepusc([{ typ: 'down', code: 'KeyA', key: 'a', alt: true }]);
  check('Alt uzupełnia się tak samo jak Shift',
    JSON.stringify(kody) === JSON.stringify([ALT, A]), kody.join(' '));
}

// --- prawy Shift nie dokłada drugiego ---------------------------------------
{
  const { kody } = przepusc([
    { typ: 'down', code: 'ShiftRight', key: 'Shift', shift: true },
    { typ: 'down', code: 'KeyA', key: 'A', shift: true },
  ]);
  check('prawy Shift wystarcza — lewy nie jest dostawiany',
    JSON.stringify(kody) === JSON.stringify([DEFAULT_KEYMAP.ShiftRight, A]), kody.join(' '));
}

// --- klawisz, którego Portfolio nie ma --------------------------------------
{
  const { kody } = przepusc([{ typ: 'down', code: 'F7', key: 'F7', shift: true }]);
  check('klawisz spoza matrycy nie wysyła niczego, nawet modyfikatora',
    kody.length === 0, kody.join(' '));
}

console.log(fails ? `\n${fails} kontroli nie przeszło` : '\nwszystkie kontrole przeszły');
process.exit(fails ? 1 : 0);
