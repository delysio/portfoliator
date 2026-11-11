// Kontrast: co rejestr `8060h` robi z kolorami panelu.
//
// `tools/tests/contrast.mjs` pilnuje samego rejestru — że da się go odczytać,
// że klawisze ruszają go po cztery i że ROM zatrzymuje się na obu końcach.
// Tutaj chodzi o to, co widać, czyli o rampę budowaną z tej wartości.
//
// Kształt krzywej między końcami jest odtworzony, nie zmierzony: przewodnik
// techniczny poświęca rejestrowi jedno zdanie i żadnej charakterystyki. Ale
// **same końce nie są kwestią gustu** i to one były wcześniej źle nastawione:
//
// - na minimum panel gaśnie — po znakach nie zostaje ślad, bo zapalony punkt
//   ma dokładnie kolor tła;
// - na maksimum panel zamyka się w jedno ciemne pole — tło dochodzi do koloru
//   atramentu i punkty przestają się z niego wybijać.
//
// Reszta kontroli pilnuje, żeby droga między końcami nie miała martwych
// odcinków: sześćdziesiąt cztery stopnie mają dawać sześćdziesiąt cztery różne
// obrazy, bo naciśnięcie klawisza, po którym nic się nie zmienia, wygląda jak
// zepsuty klawisz.

import {
  LCD_OFF, LCD_ON, LCD_LEVELS, CONTRAST_DEFAULT, CONTRAST_MAX,
  contrastEnds, buildRamp,
} from '../../js/ui/lcdramp.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const rampa = (contrast) => buildRamp(contrast, new Uint32Array(LCD_LEVELS));
const abgr = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const rgb = (v) => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF];
// Wszystkie wartości rejestru, jakie ROM potrafi ustawić: po cztery, od zera.
const STOPNIE = Array.from({ length: 64 }, (_, i) => i * 4);

// --- 1. oba końce dochodzą do końca -----------------------------------------

{
  const dol = rampa(0);
  const tlo = abgr(LCD_OFF);
  const wszystkie = dol.every((v) => (v >>> 0) === tlo);
  check('na minimum cały panel ma kolor tła', wszystkie,
        `${rgb(dol[LCD_LEVELS - 1]).join(',')} przy tle ${LCD_OFF.join(',')}`);

  const gora = rampa(CONTRAST_MAX);
  const atrament = abgr(LCD_ON);
  check('na maksimum cały panel ma kolor atramentu',
        gora.every((v) => (v >>> 0) === atrament),
        `${rgb(gora[0]).join(',')} przy atramencie ${LCD_ON.join(',')}`);
}

// To jest ta kontrola, której wcześniej by nie było widać po samych kolorach:
// panel na końcu skali ma być **jednolity**, a nie tylko blady albo ciemny.
{
  for (const [opis, contrast] of [['minimum', 0], ['maksimum', CONTRAST_MAX]]) {
    const r = rampa(contrast);
    const roznych = new Set(Array.from(r, (v) => v >>> 0)).size;
    check(`na ${opis} nie da się odróżnić punktu zapalonego od zgaszonego`,
          roznych === 1, `${roznych} różnych kolorów w rampie`);
  }
}

// --- 2. środek zakresu zostaje taki, jaki był -------------------------------
// Zimny start ustawia 80h i tam nic się nie zmieniło: pełna rozpiętość palety,
// od tła do atramentu.

{
  const r = rampa(CONTRAST_DEFAULT);
  check('80h daje pełną rozpiętość palety',
        (r[0] >>> 0) === abgr(LCD_OFF) && (r[LCD_LEVELS - 1] >>> 0) === abgr(LCD_ON),
        `${rgb(r[0]).join(',')} → ${rgb(r[LCD_LEVELS - 1]).join(',')}`);

  // Same końce zgadzałyby się i wtedy, gdyby droga między nimi była rozłożona
  // o pół stopnia obok — a po tej drodze chodzą półcienie bezwładności.
  let zle = 0;
  for (let i = 0; i < LCD_LEVELS; i++) {
    const chcemy = [0, 1, 2].map((ch) => Math.round(LCD_OFF[ch] + (LCD_ON[ch] - LCD_OFF[ch]) * (i / (LCD_LEVELS - 1))));
    if ((r[i] >>> 0) !== abgr(chcemy)) zle++;
  }
  check('przy 80h wszystkie 256 poziomów leży równo między tłem a atramentem',
        zle === 0, `${zle} poziomów obok`);
}

// --- 3. rozpiętość rośnie do środka i maleje za nim --------------------------
// Rozpiętość to odległość między końcami rampy. Ma rosnąć od zera na dole do
// maksimum w środku i wracać do zera na górze — bez zawracania po drodze, bo
// każde zawrócenie to miejsce, gdzie kręcenie kontrastem działa na odwrót.

{
  const rozpietosc = (contrast) => {
    const r = rampa(contrast);
    const a = rgb(r[0]);
    const b = rgb(r[LCD_LEVELS - 1]);
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  };

  const w = STOPNIE.map(rozpietosc);
  const srodek = STOPNIE.indexOf(CONTRAST_DEFAULT);
  let rosnie = true;
  for (let i = 1; i <= srodek; i++) if (w[i] <= w[i - 1]) rosnie = false;
  let maleje = true;
  for (let i = srodek + 1; i < w.length; i++) if (w[i] >= w[i - 1]) maleje = false;

  check('rozpiętość rośnie od dołu do 80h', rosnie, `${w[0]} … ${w[srodek]}`);
  check('rozpiętość maleje od 80h w górę', maleje, `${w[srodek]} … ${w[w.length - 1]}`);
  check('najszerzej jest w środku, czyli tam, gdzie stawia rozruch',
        w[srodek] === Math.max(...w), `${w[srodek]}`);
}

// --- 4. żaden stopień nie jest martwy ---------------------------------------

{
  const podpis = (contrast) => Array.from(rampa(contrast)).join(',');
  const obrazy = STOPNIE.map(podpis);
  const rozne = new Set(obrazy).size;
  check('sześćdziesiąt cztery stopnie dają sześćdziesiąt cztery różne obrazy',
        rozne === 64, `${rozne}`);

  let sasiedzi = 0;
  for (let i = 1; i < obrazy.length; i++) if (obrazy[i] !== obrazy[i - 1]) sasiedzi++;
  check('każde naciśnięcie klawisza zmienia obraz', sasiedzi === 63, `${sasiedzi} z 63`);
}

// --- 5. kierunek: w dół blednie, w górę ciemnieje ----------------------------
// Poniżej środka rusza się **zapalony** koniec, a tło stoi. Powyżej odwrotnie.

{
  let tloStoi = true;
  let atramentBlednie = true;
  for (let i = 1; i <= STOPNIE.indexOf(CONTRAST_DEFAULT); i++) {
    const a = rampa(STOPNIE[i - 1]);
    const b = rampa(STOPNIE[i]);
    if ((a[0] >>> 0) !== (b[0] >>> 0)) tloStoi = false;
    if (rgb(b[LCD_LEVELS - 1])[0] >= rgb(a[LCD_LEVELS - 1])[0]) atramentBlednie = false;
  }
  check('poniżej 80h tło stoi w miejscu', tloStoi);
  check('poniżej 80h zapalony punkt idzie ku tłu', atramentBlednie);

  let atramentStoi = true;
  let tloCiemnieje = true;
  for (let i = STOPNIE.indexOf(CONTRAST_DEFAULT) + 1; i < STOPNIE.length; i++) {
    const a = rampa(STOPNIE[i - 1]);
    const b = rampa(STOPNIE[i]);
    if ((a[LCD_LEVELS - 1] >>> 0) !== (b[LCD_LEVELS - 1] >>> 0)) atramentStoi = false;
    if (rgb(b[0])[0] >= rgb(a[0])[0]) tloCiemnieje = false;
  }
  check('powyżej 80h zapalony punkt stoi w miejscu', atramentStoi);
  check('powyżej 80h tło idzie ku atramentowi', tloCiemnieje);
}

// --- 6. rampa jest monotoniczna w środku ------------------------------------
// Poziomy bezwładności czytają rampę indeksem 0–255 i półcienie mają układać
// się po drodze między końcami, a nie skakać.

{
  let zlych = 0;
  for (const contrast of STOPNIE) {
    const r = rampa(contrast);
    const kierunek = Math.sign(rgb(r[LCD_LEVELS - 1])[0] - rgb(r[0])[0]);
    for (let i = 1; i < LCD_LEVELS; i++) {
      const d = Math.sign(rgb(r[i])[0] - rgb(r[i - 1])[0]);
      if (d !== 0 && kierunek !== 0 && d !== kierunek) zlych++;
    }
  }
  check('półcienie układają się między końcami bez zawracania', zlych === 0, `${zlych}`);
}

// --- 7. wartości spoza zakresu nie wywracają rampy ---------------------------
// Rejestr jest ośmiobitowy, więc program może w niego wpisać cokolwiek —
// wartości powyżej FCh ROM sam odrzuca, ale port jest otwarty dla każdego.

{
  const nad = rampa(0xFF);
  check('powyżej FCh zachowuje się jak FCh',
        Array.from(nad).join(',') === Array.from(rampa(CONTRAST_MAX)).join(','));
  const pod = rampa(-8);
  check('poniżej zera zachowuje się jak zero',
        Array.from(pod).join(',') === Array.from(rampa(0)).join(','));

  const e = contrastEnds(CONTRAST_DEFAULT);
  check('końce w środku zakresu to pełne 0 i 1', e.fog === 0 && e.lit === 1,
        `fog ${e.fog}, lit ${e.lit}`);
}

process.exit(fails ? 1 : 0);
