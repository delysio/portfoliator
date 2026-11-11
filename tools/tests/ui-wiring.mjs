// Okablowanie interfejsu: czy to, po co sięga kod, faktycznie stoi w HTML-u.
//
// Reszta zestawów uruchamia emulator bez DOM-u, więc żaden z nich nie zauważy
// najtańszej z możliwych pomyłek: przemianowanego albo usuniętego `id`.
// W przeglądarce kończy się to `null` w tabeli `els` i wyjątkiem przy pierwszym
// `addEventListener`, czyli martwą stroną — a przy odrobinie pecha nie martwą
// całą, tylko w jednym oknie dialogowym, do którego nikt akurat nie zajrzał.
//
// Zestaw czyta źródła jako tekst, bo projekt nie ma ani kroku budowania, ani
// zależności, więc nie ma też czego wstrzykiwać. Listy, które porównuje —
// gniazda stanu, tryby portu szeregowego, przyciski resetu, kontrolki slotów —
// wyciąga z kodu wyrażeniami regularnymi zamiast wpisywać je tutaj z ręki:
// przepisana lista sprawdzałaby samą siebie.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const main = read('js/main.js');
const boot = read('js/boot.js');
const css = read('css/app.css');

let fails = 0;
const ok = (n, cond, d = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!cond) fails++;
};
const all = (re, s, g = 1) => [...s.matchAll(re)].map((m) => m[g]);

// ---- co jest w HTML-u -----------------------------------------------------

const idList = all(/\sid="([^"]+)"/g, html);
const idSet = new Set(idList);

// Otwierający znacznik każdego id, z jego atrybutami — potrzebny do sprawdzeń
// typu. Wystarczy naiwne dopasowanie, bo w tym pliku żaden atrybut nie zawiera
// znaku `>`; gdyby zaczął zawierać, poniższy licznik zgłosi to natychmiast.
const tags = new Map();
for (const m of html.matchAll(/<(\w+)([^>]*\sid="([^"]+)"[^>]*)>/g)) {
  tags.set(m[3], { name: m[1].toLowerCase(), attrs: m[2] });
}

const attr = (id, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tags.get(id)?.attrs ?? '')?.[1] ?? null;
const kind = (id) => {
  const t = tags.get(id);
  if (!t) return 'brak';
  return t.name === 'input' ? `input[type=${attr(id, 'type') ?? 'text'}]` : t.name;
};

{
  const dup = [...new Set(idList.filter((v, i) => idList.indexOf(v) !== i))];
  ok('żadne id nie powtarza się w HTML-u', dup.length === 0, dup.join(' | ') || `${idSet.size} id`);
  const unparsed = [...idSet].filter((i) => !tags.has(i));
  ok('każdemu id udało się przypisać znacznik', unparsed.length === 0, unparsed.join(' | '));
}

// ---- po co sięga kod ------------------------------------------------------

// Wprost, literałem. Dwa pliki, bo boot.js dobiera się do paska stanu, zanim
// main.js w ogóle wystartuje.
// js/ui/confirm.js fills in the page's question dialog, so its ids count too.
const confirmJs = read('js/ui/confirm.js');
const direct = [...all(/getElementById\('([^']+)'\)/g, main), ...all(/getElementById\('([^']+)'\)/g, boot),
                ...all(/getElementById\('([^']+)'\)/g, confirmJs)];

// Pośrednio: identyfikator jedzie jako argument albo składa się z szablonu.
// Każda z tych list ma po drugiej stronie miejsce, z którego pochodzi.
const stateSlots = all(/'([^']+)'/g, /const STATE_SLOTS = \[([^\]]+)\]/.exec(main)?.[1] ?? '');
const serialModes = all(/'([^']+)'/g, /for \(const kind of \[([^\]]+)\]\)/.exec(main)?.[1] ?? '');
const resetButtons = all(/wireReset\('([^']+)'/g, main);
const slotButtons = all(/(?:create|eject|save): '([^']+)'/g, main);

const templated = [
  ...serialModes.map((k) => `serial-opt-${k}`),
  ...stateSlots.map((s) => `state-when-${s}`),
];

// Z HTML-a: przycisk niosący data-modal każe otworzyć okno o tej nazwie.
const modalTargets = [...new Set(all(/data-modal="([^"]+)"/g, html))];

{
  ok('listy pośrednie dały się wyciągnąć ze źródła',
     stateSlots.length > 0 && serialModes.length > 0 && resetButtons.length > 0 && slotButtons.length > 0,
     `gniazda ${stateSlots.length}, tryby ${serialModes.length}, resety ${resetButtons.length}, karty ${slotButtons.length}`);

  const wanted = [...new Set([...direct, ...templated, ...resetButtons, ...slotButtons, ...modalTargets])];
  const missing = wanted.filter((i) => !idSet.has(i));
  ok('każde id, po które sięga kod, istnieje w HTML-u', missing.length === 0,
     missing.join(' | ') || `${wanted.length} odwołań`);
}

// ---- okna dialogowe -------------------------------------------------------

// showModal() istnieje wyłącznie na <dialog>, a obsługa kliknięcia w tło łapie
// okna przez `dialog.modal`. Okno bez tej klasy otworzy się i nie da zamknąć.
{
  const notDialog = modalTargets.filter((i) => tags.get(i)?.name !== 'dialog');
  ok('każdy przycisk data-modal celuje w <dialog>', notDialog.length === 0,
     notDialog.map((i) => `${i}=${kind(i)}`).join(' | ') || `${modalTargets.length} okien`);

  const notModal = modalTargets.filter((i) => !(attr(i, 'class') ?? '').split(/\s+/).includes('modal'));
  ok('każde takie okno ma klasę "modal"', notModal.length === 0, notModal.join(' | '));
}

// ---- gniazda stanu --------------------------------------------------------

// Trzy atrybuty na gniazdo i jeden odczyt daty. Brak któregokolwiek nie wywala
// niczego — przycisk po prostu nic nie robi, co jest gorsze niż wyjątek.
{
  const byKind = { save: [], load: [], drop: [] };
  for (const m of html.matchAll(/data-state-(save|load|drop)="([^"]+)"/g)) byKind[m[1]].push(m[2]);

  for (const [k, got] of Object.entries(byKind)) {
    const brak = stateSlots.filter((s) => !got.includes(s));
    const nadmiar = got.filter((s) => !stateSlots.includes(s));
    ok(`data-state-${k} pokrywa gniazda ${stateSlots.join(', ')}`, brak.length === 0 && nadmiar.length === 0,
       [brak.length ? 'brakuje ' + brak.join(',') : '', nadmiar.length ? 'nadmiar ' + nadmiar.join(',') : ''].filter(Boolean).join('; '));
  }

  const readouts = stateSlots.filter((s) => !idSet.has(`state-when-${s}`));
  ok('każde gniazdo ma pole na datę zapisu', readouts.length === 0, readouts.join(' | '));
}

// ---- tryby portu szeregowego ----------------------------------------------

// Trzy listy tego samego: opcje w <select>, panele z ustawieniami i pętla,
// która je przełącza. Rozjazd którejkolwiek daje tryb bez ustawień albo panel,
// którego nie da się pokazać.
{
  const sel = /<select[^>]+id="serial-mode"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
  const options = all(/value="([^"]+)"/g, sel);
  ok('opcje #serial-mode zgadzają się z pętlą showSerialModeOptions',
     options.length > 0 && options.join(',') === serialModes.join(','),
     `${options.join(',')} wobec ${serialModes.join(',')}`);

  const panels = all(/\sid="(serial-opt-[^"]+)"/g, html).map((i) => i.slice('serial-opt-'.length));
  ok('panele serial-opt-* zgadzają się z tą samą listą',
     panels.slice().sort().join(',') === serialModes.slice().sort().join(','),
     `${panels.join(',')} wobec ${serialModes.join(',')}`);
}

// ---- tabele els i insp ----------------------------------------------------

const table = (name) => {
  const start = main.indexOf(`const ${name} = {`);
  if (start < 0) return new Map();
  const body = main.slice(start, main.indexOf('\n};', start));
  return new Map([...body.matchAll(/(\w+): document\.getElementById\('([^']+)'\)/g)].map((m) => [m[1], m[2]]));
};
const tables = { els: table('els'), insp: table('insp') };

ok('tabele elementów dały się odczytać', tables.els.size > 50 && tables.insp.size > 5,
   `els ${tables.els.size}, insp ${tables.insp.size}`);

// Kontrolki obu slotów kart chodzą przez slot.el('Nazwa'), które rozwija się
// na els.cardNazwa albo els.cardBNazwa. Slot B bywa dopisywany po slocie A i
// łatwo o nim zapomnieć; wtedy pęka dopiero po włączeniu HPC-104.
{
  const names = [...new Set(all(/slot\.el\('(\w+)'\)/g, main))];
  const brak = [];
  for (const n of names) {
    for (const [prefix, drive] of [['card', 'A'], ['cardB', 'B']]) {
      if (!tables.els.has(prefix + n)) brak.push(`${drive}:${n}`);
    }
  }
  ok('oba sloty kart mają komplet kontrolek', names.length > 0 && brak.length === 0,
     brak.join(' | ') || `${names.length} kontrolek × 2`);
}

// Typ kontrolki wobec sposobu użycia. Zamiana pola wyboru na listę rozwijaną
// przechodzi tu bez śladu w kodzie: .checked na <select> to zawsze undefined,
// czyli cicho wyłączona opcja.
{
  const bad = [];
  let checkedSeen = 0, valueSeen = 0;
  for (const [name, map] of Object.entries(tables)) {
    for (const m of main.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\.checked\\b`, 'g'))) {
      const id = map.get(m[1]); if (!id) continue;
      checkedSeen++;
      if (!/^input\[type=(checkbox|radio)\]$/.test(kind(id))) bad.push(`.checked: ${name}.${m[1]} (#${id}) to ${kind(id)}`);
    }
    for (const m of main.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\.value\\b`, 'g'))) {
      const id = map.get(m[1]); if (!id) continue;
      valueSeen++;
      if (!/^(input\[|select|textarea)/.test(kind(id))) bad.push(`.value: ${name}.${m[1]} (#${id}) to ${kind(id)}`);
    }
  }
  ok('.checked i .value trafiają w kontrolki, które je mają', bad.length === 0,
     [...new Set(bad)].join(' | ') || `${checkedSeen} × .checked, ${valueSeen} × .value`);
}

// ---- w drugą stronę: id, do których nikt nie sięga ------------------------

// Nie jest to błąd, tylko ślad po dawnej zmianie: przemianowany przycisk
// zostawia po sobie element, który nadal stoi w HTML-u i nadal zajmuje miejsce
// w tłumaczeniach. Odsyłacze zbierane są ze wszystkiego, co potrafi wskazać
// element — także z CSS-u i z atrybutów samego HTML-a.
{
  const referenced = new Set([
    ...direct, ...templated, ...resetButtons, ...slotButtons, ...modalTargets,
    ...all(/\bfor="([^"]+)"/g, html),
    ...all(/href="#([^"]+)"/g, html),
    ...all(/\blist="([^"]+)"/g, html),
    ...all(/aria-(?:labelledby|controls|describedby)="([^"]+)"/g, html).flatMap((v) => v.split(/\s+/)),
    ...all(/#([A-Za-z][\w-]*)/g, css),
  ]);
  const dead = [...idSet].filter((i) => !referenced.has(i));
  ok('żadne id w HTML-u nie jest martwe', dead.length === 0,
     dead.map((i) => `${i} <${tags.get(i)?.name}>`).join(' | '));
}

console.log(`\nid w HTML-u: ${idSet.size}, odwołań z kodu: ${new Set(direct).size} wprost + ` +
            `${templated.length + resetButtons.length + slotButtons.length} pośrednich, ` +
            `tabele: els ${tables.els.size}, insp ${tables.insp.size}`);
process.exit(fails ? 1 : 0);
