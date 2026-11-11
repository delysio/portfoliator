// Kompletność i spójność warstwy tłumaczeń.
//
// Nie sprawdza jakości angielszczyzny — tego nie da się sprawdzić automatem —
// tylko to, czego przeoczyć jest najłatwiej: napis dodany do interfejsu bez
// wpisu w słowniku, wpis pozostawiony po napisie, którego już nie ma, oraz
// miejsca na argumenty, które nie zgadzają się po obu stronach.
//
// Klucz odtwarzany jest tak, jak zwróci go DOM — patrz nagłówek
// tools/i18n-check.mjs. Dlatego zestaw łapie także pomyłkę, która wygląda jak
// literówka, a nią nie jest: wpis dopisany po źródle HTML, a nie po tym, co
// z tego źródła wychodzi po sparsowaniu.

import { check } from '../i18n-check.mjs';
import { EN_DICT } from '../../js/ui/dict-en.js';
import { t, norm, setLanguage, onLanguageChange } from '../../js/ui/i18n.js';

let fails = 0;
const ok = (n, cond, d = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!cond) fails++;
};

const r = check();

ok('każdy napis interfejsu ma tłumaczenie', r.missing.length === 0,
   r.missing.length ? r.missing.slice(0, 5).map(([k]) => k.slice(0, 50)).join(' | ') : `${r.wanted.size} kluczy`);

ok('żadne tłumaczenie nie jest puste', r.empty.length === 0,
   r.empty.map(([k]) => k.slice(0, 40)).join(' | '));

ok('słownik nie zawiera martwych wpisów', r.dead.length === 0,
   r.dead.slice(0, 5).map((k) => k.slice(0, 50)).join(' | '));

ok('miejsca na argumenty zgadzają się po obu stronach', r.slots.length === 0,
   r.slots.map(([k]) => k.slice(0, 40)).join(' | '));

// Klucze muszą być już znormalizowane: wyszukiwanie zwija białe znaki, więc
// wpis z wiodącą spacją albo z podwójną spacją w środku nigdy by nie trafił.
{
  const odd = Object.keys(EN_DICT).filter((k) => k !== norm(k));
  ok('klucze słownika są znormalizowane', odd.length === 0,
     odd.slice(0, 3).map((k) => JSON.stringify(k.slice(0, 40))).join(' | '));
}

// Domyślnym językiem jest polski, więc t() ma oddawać klucz nietknięty; dopiero
// podstawienie argumentów jest wspólne dla obu języków.
ok('t() bez tłumaczenia oddaje klucz', t('Nieistniejący klucz {0}', 7) === 'Nieistniejący klucz 7');
ok('t() podstawia po numerze', t('{1} przed {0}', 'b', 'a') === 'a przed b');

// Sanity: kilka kluczy, których brak byłby najbardziej widoczny.
for (const key of ['System', 'Karta pamięci', 'Instrukcja', 'uruchomiony']) {
  ok(`jest tłumaczenie: ${key}`, typeof EN_DICT[key] === 'string' && EN_DICT[key].length > 0);
}

// Element, w który pisze JavaScript, kontra przełączenie języka.
//
// Zgłoszona usterka: pasek stanu pokazywał „uruchomiony", po przełączeniu na
// angielski wracał do „starting up…" (czyli do przetłumaczonej treści z HTML-a),
// a dopiero przeładowanie dawało „running". Warstwa statyczna odtwarzała
// element z pamięci podręcznej, kasując to, co wpisał emulator. Poniżej ten sam
// scenariusz na atrapie DOM-u — tyle jej, ile rusza i18n.js.
{
  const elements = [];
  const make = (attr, text) => {
    const el = {
      attrs: new Map([[attr, '']]),
      textContent: text,
      className: '',
      getAttribute: (n) => el.attrs.get(n) ?? null,
      setAttribute: (n, v) => el.attrs.set(n, v),
      removeAttribute: (n) => el.attrs.delete(n),
      get innerHTML() { return el.textContent; },
      set innerHTML(v) { el.textContent = v; },
    };
    elements.push(el);
    return el;
  };

  globalThis.document = {
    documentElement: {},
    querySelectorAll: (sel) => elements.filter((el) => el.attrs.has(sel.slice(1, -1))),
    querySelector: () => null,
  };
  Object.defineProperty(globalThis, 'navigator',
    { value: { languages: ['pl-PL'] }, configurable: true });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };

  const status = make('data-i18n', 'inicjalizacja…');

  // Ten sam mechanizm co reporter() w js/main.js: komunikat to funkcja, a element
  // wypada z warstwy statycznej, gdy tylko emulator ma coś do powiedzenia.
  let last = null;
  const draw = () => {
    if (!last) return;
    status.removeAttribute('data-i18n');
    status.textContent = last();
  };
  onLanguageChange(draw);

  setLanguage('pl', { save: false });
  last = () => t('uruchomiony');
  draw();
  ok('po polsku pasek stanu mówi „uruchomiony"', status.textContent === 'uruchomiony', status.textContent);

  setLanguage('en', { save: false });
  ok('po przełączeniu na angielski mówi „running"', status.textContent === 'running', status.textContent);

  setLanguage('pl', { save: false });
  ok('i wraca do polskiego', status.textContent === 'uruchomiony', status.textContent);

  // Element, którego JavaScript nie tknął, ma zostać przy warstwie statycznej.
  const untouched = make('data-i18n', 'Karta pamięci');
  setLanguage('en', { save: false });
  ok('nietknięty element tłumaczy się statycznie', untouched.textContent === 'Memory card', untouched.textContent);
  setLanguage('pl', { save: false });
  ok('i wraca do oryginału', untouched.textContent === 'Karta pamięci', untouched.textContent);
}

// Napisy wpisywane na ekran z kodu z pominięciem t().
//
// Kontrola słownika widzi tylko to, co do t() trafiło, więc tekst wpisany prosto
// w textContent zostaje po polsku w wersji angielskiej i nikt się nie dowie.
// Tak przetrwały długo nagłówki tabel ROM-ów i plików karty, etykieta linii
// szeregowej, przycisk „Zamknij” po wysyłce i kilka komunikatów. Sprawdzenie jest
// zgrubne: bierze wiersze, które coś wypisują, i każe każdemu literałowi
// z przynajmniej jednym słowem iść przez t(). Pojedyncze słowa-identyfikatory
// (rodzaje komunikatów, nazwy zdarzeń, tryby portu) są wyliczone wprost.
{
  const fs = await import('node:fs');
  const ROOT = new URL('../../', import.meta.url);
  const SINKS = /\.(?:textContent|title)\s*\+?=|\b(?:say\w*|\w+Say)\(|serialDeliver\(|for \(const \w+ of \[/;
  const WORDS = /[a-ząćęłńóśźż]{4}/;
  const IDENTIFIERS = new Set(['function', 'warn', 'dragenter', 'dragover', 'dragleave', 'drop',
    'disconnected', 'terminal', 'webserial', 'modem', 'peer']);
  const found = [];
  const natives = [];
  for (const file of ['js/main.js', 'js/eprom/app.js']) {
    fs.readFileSync(new URL(file, ROOT), 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/(?<![.\w])(alert|confirm)\(/.test(code)) natives.push(`${file}:${i + 1}`);
      if (!SINKS.test(code)) return;
      for (const m of code.matchAll(/(['`])((?:\\.|(?!\1).)*)\1/g)) {
        const text = m[2].replace(/\$\{[^}]*\}/g, '');
        if (!WORDS.test(text) || IDENTIFIERS.has(text)) continue;
        if (/\bt\(\s*$/.test(code.slice(0, m.index))) continue;
        found.push(`${file}:${i + 1} ${m[0].slice(0, 40)}`);
      }
    });
  }
  ok('napisy wpisywane na ekran z kodu idą przez t()', found.length === 0, found.join(' | '));
  ok('pytania i komunikaty idą przez okno strony, nie przez alert()/confirm()', natives.length === 0,
     natives.join(' | '));
}

console.log(`\nkluczy: ${r.wanted.size} (HTML ${r.fromHtml.length}, JS ${r.fromJs.length}), wpisów: ${Object.keys(EN_DICT).length}`);
process.exit(fails ? 1 : 0);
