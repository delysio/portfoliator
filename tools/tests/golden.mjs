// Złoty przebieg: rozruch, DOS i wbudowane aplikacje.
//
// Zestaw nie ocenia, czy ekran jest **poprawny** — od tego są oczy i prawdziwe
// Portfolio. Pilnuje, czy jest **taki sam jak wcześniej**. Kiedy któryś wzorzec
// przestanie się zgadzać, znaczy to jedno z dwóch: zmiana była zamierzona
// i trzeba zapisać wzorce od nowa, albo nie była i właśnie się o tym
// dowiedziałeś. Obie odpowiedzi są warte tego testu.
//
// Wzorce leżą w `golden-screens.txt` obok, w postaci **czytelnego tekstu**, i to
// jest w tym zestawie decyzja najważniejsza. Skrót bitmapy — tak jak robi to
// `demos.mjs` dla dem graficznych — mówi „a1b2 ≠ c3d4" i zostawia człowieka
// samego z pytaniem, co się właściwie stało. Wzorzec tekstowy pokazuje wprost,
// że z paska stanu zniknął znak. Różnica jest widoczna także w `git diff`, więc
// zamierzona zmiana daje się przejrzeć przy commicie zamiast być przyklepana
// w ciemno. To nie jest kosmetyka: złoty przebieg, którego nie da się szybko
// ocenić, kończy jako odruchowe „no to przenagrywam", a wtedy nie pilnuje już
// niczego.
//
// **Czego wzorzec nie łapie.** Bajty spoza ASCII zapisywane są wartościami
// (`~C9`, `~CD*26` dla powtórzeń), więc podmiana jednego znaku ramki na inny
// wyjdzie. Nie wyjdzie natomiast nic, co nie dociera do bufora tekstowego MDA:
// grafika rysowana wprost w pamięci kontrolera LCD leży poza zasięgiem tego
// zestawu i tego pilnuje `demos.mjs`.
//
// **Dlaczego akurat te punkty.** Rozruch i wbudowane aplikacje potrzebują
// wyłącznie ROM-ów, czyli tego, co i tak trzeba dostarczyć, żeby uruchomić
// cokolwiek. `demos.mjs` — jedyna regresja obrazu, jaką projekt miał do tej pory
// — potrzebuje obrazów kart spoza repozytorium, więc na świeżym klonie pomija
// się w całości. Ten zestaw działa u każdego.
//
// **Zegar jest sprawdzany osobno, i celowo.** Ekran startowy pokazuje czas
// z rozdzielczością setnych sekundy, więc każda zmiana w liczeniu cykli
// przesuwałaby wzorzec — i każde tempo pracy nad czasami procesora zgłaszałoby
// się jako „zmienił się ekran rozruchu". To dwa różne pytania, więc mają dwie
// różne kontrole: czas jest z ekranu maskowany, a mierzony wprost, niżej.
//
// Sam zegar to jednak za mało, żeby pilnować czasów procesora, i lepiej wiedzieć
// dlaczego: ma rozdzielczość setnej sekundy, czyli około 49 000 cykli, więc
// zmiana kosztu pojedynczej instrukcji o jeden cykl chowa się w nim bez śladu
// (sprawdzone — przechodziła). Od tego jest osobna miara: **liczba instrukcji
// wykonanych do promptu**. Budżet cykli jest stały, bo taki wydaje harmonogram
// prób, więc każde potanienie instrukcji natychmiast zmienia to, ile ich się
// w tym budżecie zmieściło. Zmierzone ponownie po wpięciu modelu kolejki:
// podniesienie kosztu wykonanego skoku warunkowego o jeden cykl przesuwa licznik
// z 938 823 na 938 235, a zegar z ekranu przy tej samej zmianie nadal się zgadza.
//
// Jest granica i lepiej ją znać: zmiana kosztu instrukcji, o której i tak
// decyduje magistrala, nie wyjdzie nigdzie — i tak ma być. Sprawdzone tą samą
// metodą: podniesienie `NOP` z 3 na 4 nie rusza licznika ani o jeden, bo NOP
// zajmuje jeden bajt, a pobranie bajtu trwa cztery takty i to ono wyznacza tempo.
// Na prawdziwym 8088 taka zmiana również nie miałaby skutku.
//
//   ZAPISZ_WZORCE=1 node tools/tests/golden.mjs     zapisuje wzorce od nowa

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, run, press, chord, type, bootToPrompt, romsAvailable } from '../pofo-headless.mjs';

const ZAPISZ = !!process.env.ZAPISZ_WZORCE;
const PLIK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden-screens.txt');

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

// ---- odczyt ekranu ---------------------------------------------------------
//
// Portfolio pokazuje 40 × 8 znaków, ale ROM pisze do zwykłej strony MDA
// o szerokości 80, więc wiersz trzeba brać co 80 komórek, a nie co 40.

const KOLUMNY = 40, WIERSZE = 8, SZEROKOSC_MDA = 80;

function ekran(machine) {
  const baza = machine.ram.length - 0x1000;
  const linie = [];
  for (let y = 0; y < WIERSZE; y++) {
    const bajty = [];
    for (let x = 0; x < KOLUMNY; x++) bajty.push(machine.ram[baza + (y * SZEROKOSC_MDA + x) * 2]);
    while (bajty.length && (bajty[bajty.length - 1] === 0 || bajty[bajty.length - 1] === 32)) bajty.pop();

    // Powtórzenia zwijane, żeby ramka nie zamieniała się w ścianę szumu:
    // `~CD*26` zamiast dwudziestu sześciu razy `~CD`. Zmiana szerokości ramki
    // o jedną kolumnę widać wtedy jako zmianę liczby, co czyta się lepiej niż
    // przesunięcie całej linii.
    let linia = '';
    for (let i = 0; i < bajty.length;) {
      const b = bajty[i];
      let n = 1;
      while (i + n < bajty.length && bajty[i + n] === b) n++;
      if (b >= 32 && b < 127) linia += String.fromCharCode(b).repeat(n);
      else if (b === 0) linia += ' '.repeat(n);
      else {
        const h = '~' + b.toString(16).toUpperCase().padStart(2, '0');
        linia += n >= 3 ? `${h}*${n}` : h.repeat(n);
      }
      i += n;
    }
    linie.push(linia);
  }
  while (linie.length && !linie[linie.length - 1]) linie.pop();

  // Czas z setnymi sekundy ma własną kontrolę; tutaj tylko przeszkadza.
  return linie.map((l) => l.replace(/\d+:\d\d:\d\d\.\d\d/, 'G:MM:SS.hh')).join('\n');
}

// ---- plik wzorców ----------------------------------------------------------

function wczytajWzorce() {
  if (!fs.existsSync(PLIK)) return null;
  const wzorce = new Map();
  let nazwa = null, bufor = [];
  const domknij = () => {
    if (nazwa === null) return;
    while (bufor.length && !bufor[bufor.length - 1]) bufor.pop();
    wzorce.set(nazwa, bufor.join('\n'));
  };
  for (const linia of fs.readFileSync(PLIK, 'utf8').split(/\r?\n/)) {
    if (linia.startsWith('### ')) { domknij(); nazwa = linia.slice(4).trim(); bufor = []; }
    else if (nazwa !== null) bufor.push(linia);
    // wiersze przed pierwszą sekcją to nagłówek pliku
  }
  domknij();
  return wzorce;
}

const NAGLOWEK = `# Wzorce złotego przebiegu — zapisane przez tools/tests/golden.mjs.
#
# Ten plik jest po to, żeby dało się go przeczytać w git diff. Kiedy zmiana
# w emulatorze przesunie cokolwiek na ekranie, widać tu dokładnie co — i można
# zdecydować, czy tak miało być, zamiast przyklepywać nowy skrót w ciemno.
#
# Bajty spoza ASCII zapisane są wartością (~C9), powtórzenia zwinięte (~CD*26).
# Czas na ekranie startowym jest zamaskowany, bo ma osobną kontrolę.
#
# Zapis od nowa:  ZAPISZ_WZORCE=1 node tools/tests/golden.mjs
`;

function zapiszWzorce(wzorce) {
  let out = NAGLOWEK;
  for (const [nazwa, tresc] of wzorce) out += `\n### ${nazwa}\n${tresc}\n`;
  fs.writeFileSync(PLIK, out, 'utf8');
}

const wzorce = wczytajWzorce();
const zebrane = new Map();

function porownaj(nazwa, tresc) {
  zebrane.set(nazwa, tresc);
  if (ZAPISZ) { console.log(`ZAPIS  ${nazwa}  (${tresc.split('\n').length} wierszy)`); return; }

  const wzor = wzorce ? wzorce.get(nazwa) : undefined;
  if (wzor === undefined) {
    check(nazwa, false, 'brak wzorca — uruchom z ZAPISZ_WZORCE=1');
    return;
  }
  if (wzor === tresc) { check(nazwa, true); return; }

  const a = wzor.split('\n'), b = tresc.split('\n');
  const i = Array.from({ length: Math.max(a.length, b.length) }, (_, k) => k)
    .find((k) => a[k] !== b[k]);
  check(nazwa, false,
        `wiersz ${i + 1}\n         wzorzec: ${JSON.stringify(a[i] ?? '(brak wiersza)')}\n         jest:    ${JSON.stringify(b[i] ?? '(brak wiersza)')}`);
}

// ---- 1. rozruch na zimno ----------------------------------------------------
//
// Od resetu, bez skrótów: to jest ta jedna ścieżka, której nie wolno omijać
// zrzutem stanu, bo wtedy przestalibyśmy testować dokładnie to, co najważniejsze.

const { machine, cpu } = boot();

// Liczone są instrukcje, nie cykle, i to nie jest szczegół. `run()` wydaje
// **budżet cykli**, więc suma cykli do promptu jest z góry ustalona przez
// harmonogram prób i nie powie o czasach procesora nic. Liczba instrukcji, które
// w tym budżecie się zmieściły, mówi wszystko: potanienie choćby jednej postaci
// instrukcji przesuwa ją natychmiast. Zegar odczytany z ekranu tego nie łapie —
// ma rozdzielczość setnej sekundy, czyli około 49 000 cykli, i drobna zmiana
// chowa się w tym bez śladu.
let instrukcji = 0;
{
  const krok = cpu.step.bind(cpu);
  cpu.step = () => { instrukcji++; return krok(); };
}

run(machine, cpu, 2000);
porownaj('rozruch/prawa-autorskie', ekran(machine));

press(machine, cpu, 'Space');
run(machine, cpu, 800);
porownaj('rozruch/klawiatura', ekran(machine));

press(machine, cpu, 'KeyE');
run(machine, cpu, 800);
porownaj('rozruch/data', ekran(machine));

press(machine, cpu, 'Enter');
run(machine, cpu, 800);
porownaj('rozruch/czas', ekran(machine));

press(machine, cpu, 'Enter');
run(machine, cpu, 1500);
porownaj('rozruch/prompt', ekran(machine));

// Stan promptu wędruje do wszystkich prób poniżej. Zrzut jest tu na miejscu
// dokładnie dlatego, że nie jest wyposażeniem na dysku: żyje w tym jednym
// przebiegu, więc nie ma czego odtwarzać przy zmianie formatu stanu, a oszczędza
// osiem rozruchów.
const stanPromptu = machine.snapshot();

function odPromptu() {
  const m = boot();
  m.machine.restore(stanPromptu);
  return m;
}

// ---- 2. ile pracy zmieściło się w tym samym czasie --------------------------

{
  const nazwa = 'rozruch/instrukcji';
  const wartosc = String(instrukcji);
  zebrane.set(nazwa, wartosc);
  if (ZAPISZ) console.log(`ZAPIS  ${nazwa}  ${wartosc}`);
  else {
    const wzor = wzorce ? wzorce.get(nazwa) : undefined;
    check(nazwa, wartosc === wzor,
          wartosc === wzor ? ''
            : `wzorzec ${wzor}, jest ${wartosc} — zmieniły się czasy instrukcji`);
  }
}

// ---- 3. zegar, czyli to, co z ekranu zamaskowano ----------------------------
//
// Czas czytany przez ROM w chwili dojścia do promptu. Zmiana tej liczby oznacza,
// że emulowany czas przestał układać się tak samo względem harmonogramu prób —
// czyli że ruszyły się czasy procesora. Jest to informacja warta zgłoszenia,
// ale nie jest to „zmienił się ekran rozruchu", więc ma własną linię.

{
  const m = odPromptu();
  const surowy = (() => {
    const baza = m.machine.ram.length - 0x1000;
    const linie = [];
    for (let y = 0; y < WIERSZE; y++) {
      let l = '';
      for (let x = 0; x < KOLUMNY; x++) {
        const c = m.machine.ram[baza + (y * SZEROKOSC_MDA + x) * 2];
        l += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
      }
      linie.push(l);
    }
    return linie.join('\n');
  })();
  const trafienie = surowy.match(/(\d+:\d\d:\d\d\.\d\d)/);
  const zegar = trafienie ? trafienie[1] : null;

  zebrane.set('zegar/na-promptcie', zegar || '(nie znaleziono)');
  if (ZAPISZ) console.log(`ZAPIS  zegar/na-promptcie  ${zegar}`);
  else {
    const wzor = wzorce ? wzorce.get('zegar/na-promptcie') : undefined;
    check('zegar/na-promptcie', zegar !== null && zegar === wzor,
          zegar === wzor ? '' : `wzorzec ${wzor}, jest ${zegar} — ruszyły się czasy procesora`);
  }
}

// ---- 4. DOS ----------------------------------------------------------------

for (const [nazwa, polecenie, ms] of [['wersja', 'VER\n', 1200], ['katalog', 'DIR\n', 2500]]) {
  const m = odPromptu();
  type(m.machine, m.cpu, polecenie);
  run(m.machine, m.cpu, ms);
  porownaj(`dos/${nazwa}`, ekran(m.machine));
}

// ---- 5. wbudowane aplikacje -------------------------------------------------

const APLIKACJE = [
  ['adresy', 'KeyA'], ['kalkulator', 'KeyC'], ['kalendarz', 'KeyD'],
  ['edytor', 'KeyE'], ['setup', 'KeyS'], ['arkusz', 'KeyW'],
];

for (const [nazwa, klawisz] of APLIKACJE) {
  const m = odPromptu();
  chord(m.machine, m.cpu, 'Backquote', klawisz);
  run(m.machine, m.cpu, 1500);
  porownaj(`aplikacja/${nazwa}`, ekran(m.machine));
}

// ---- 6. kontrola, że wzorce w ogóle coś znaczą ------------------------------
//
// Zestaw, w którym wszystkie wzorce są takie same, przechodziłby zawsze i nie
// pilnował niczego. Ekrany muszą się od siebie różnić.

if (!ZAPISZ) {
  const unikalne = new Set(zebrane.values());
  check('każdy punkt pomiarowy pokazuje co innego',
        unikalne.size === zebrane.size,
        `${zebrane.size} punktów, ${unikalne.size} różnych`);
}

if (ZAPISZ) {
  zapiszWzorce(zebrane);
  console.log(`\nzapisano ${zebrane.size} wzorców do ${path.basename(PLIK)}`);
  process.exit(0);
}

process.exit(fails ? 1 : 0);
