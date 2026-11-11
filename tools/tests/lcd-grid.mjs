// Geometria siatki punktów na panelu LCD.
//
// Zestaw nie ocenia, czy kratka **wygląda** jak na prawdziwym Portfolio — od
// tego są oczy i zdjęcie egzemplarza. Pilnuje rzeczy, które da się rozstrzygnąć
// rachunkiem, a których gołym okiem nie widać, dopóki nie zrobi się źle:
//
// - **Ile jest atramentu.** Punkt o podziałce `cell` i przerwie `gap` ma zakryć
//   dokładnie `cell × (1 − gap)` piksela urządzenia — ani mniej, ani więcej.
//   Rozsypanie tego po pikselach wyjściowych nie może niczego zgubić ani
//   dorobić, bo zgubione pokrycie to panel, który po powiększeniu robi się
//   ciemniejszy albo jaśniejszy niż przed nim.
// - **Że wyłączona siatka niczego nie zmienia.** Przy przerwie 0 i całkowitej
//   liczbie pikseli na punkt wagi muszą wyjść dokładnie takie, jakie dawało
//   dawne kopiowanie punkt w punkt: jedynka na właściwym punkcie i nic poza
//   tym. Inaczej sama możliwość rysowania kratki przestawiłaby obraz każdemu,
//   kto jej nie chce.
// - **Że ułamkowa podziałka nie psuje rachunku.** Powiększenie systemowe 125%
//   daje 2,5 piksela na punkt i to jest przypadek, dla którego cała ta
//   maszyneria powstała — podział na całe piksele dawał tam prążki.
//
// Osobno sprawdzane jest `rowDuplicates`, czyli skrót, na którym stoi
// wydajność: wiersz uznany za kopię poprzedniego nie jest już liczony, więc
// pomyłka w tę stronę nie zwalnia programu, tylko **cicho psuje obraz**.

import { axisWeights, rowDuplicates, makeGrid, paint } from '../../js/ui/lcdgrid.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const bliskie = (a, b, eps = 1e-2) => Math.abs(a - b) <= eps;

// Podziałki, jakie realnie wypadają: skala 1–4 razy powiększenie systemowe
// 100%, 125%, 150% i 200%.
const PODZIALKI = [1, 2, 2.5, 3, 3.75, 4, 5, 6, 7.5, 8];
const PRZERWY = [0, 0.08, 0.12, 0.2, 0.3];

// --- 1. ile jest atramentu ---------------------------------------------------

let zleSumy = [];
for (const cell of PODZIALKI) {
  for (const gap of PRZERWY) {
    const w = axisWeights(240, cell, gap);
    let ink = 0;
    for (let i = 0; i < w.out; i++) ink += w.wa[i] + w.wb[i];
    const oczek = 240 * cell * (1 - gap);
    if (!bliskie(ink, oczek)) zleSumy.push(`cell=${cell} gap=${gap}: ${ink.toFixed(3)} ≠ ${oczek.toFixed(3)}`);
  }
}
check('pokrycie całego rzędu zgadza się z geometrią', zleSumy.length === 0, zleSumy[0] || '50 kombinacji');

// To samo, ale punkt po punkcie: żaden pojedynczy punkt nie może dostać więcej
// ani mniej niż jego własne `cell × (1 − gap)`. Suma całego rzędu mogłaby się
// zgadzać nawet wtedy, gdyby jeden punkt zabierał sąsiadowi.
let zlePunkty = [];
for (const cell of PODZIALKI) {
  for (const gap of PRZERWY) {
    const w = axisWeights(240, cell, gap);
    const nadot = new Float64Array(240);
    for (let i = 0; i < w.out; i++) {
      nadot[w.a[i]] += w.wa[i];
      nadot[w.b[i]] += w.wb[i];
    }
    const oczek = cell * (1 - gap);
    // Skrajne punkty mogą wystawać poza bufor zaokrąglony do pełnych pikseli.
    for (let c = 1; c < 239; c++) {
      if (!bliskie(nadot[c], oczek, 1e-3)) {
        zlePunkty.push(`cell=${cell} gap=${gap} punkt ${c}: ${nadot[c].toFixed(4)} ≠ ${oczek.toFixed(4)}`);
        break;
      }
    }
  }
}
check('każdy punkt z osobna dostaje swoje pokrycie', zlePunkty.length === 0, zlePunkty[0] || '');

// --- 2. wyłączona siatka to dawne kopiowanie punkt w punkt --------------------

let odstepstwa = [];
for (const cell of [1, 2, 3, 4, 6, 8]) {
  const w = axisWeights(240, cell, 0);
  if (w.out !== 240 * cell) { odstepstwa.push(`cell=${cell}: bufor ${w.out}`); continue; }
  for (let i = 0; i < w.out; i++) {
    if (w.a[i] !== Math.floor(i / cell) || w.wa[i] !== 1 || w.wb[i] !== 0) {
      odstepstwa.push(`cell=${cell} px ${i}: a=${w.a[i]} wa=${w.wa[i]} wb=${w.wb[i]}`);
      break;
    }
  }
}
check('przerwa 0 i całkowita podziałka dają dokładnie punkt w punkt',
  odstepstwa.length === 0, odstepstwa[0] || '');

// --- 3. wagi trzymają się w granicach ----------------------------------------

let poza = [];
for (const cell of PODZIALKI) {
  for (const gap of PRZERWY) {
    const w = axisWeights(240, cell, gap);
    for (let i = 0; i < w.out; i++) {
      const suma = w.wa[i] + w.wb[i];
      if (w.wa[i] < 0 || w.wb[i] < 0 || suma > 1 + 1e-6) {
        poza.push(`cell=${cell} gap=${gap} px ${i}: ${w.wa[i]} + ${w.wb[i]}`);
        break;
      }
      if (w.a[i] < 0 || w.a[i] > 239 || w.b[i] < 0 || w.b[i] > 239) {
        poza.push(`cell=${cell} gap=${gap} px ${i}: indeks ${w.a[i]}/${w.b[i]}`);
        break;
      }
    }
  }
}
// Suma powyżej jedynki oznaczałaby dwa punkty nachodzące na siebie w jednym
// pikselu, a stąd indeks poza końcem rampy kolorów i czarna plamka na panelu.
check('żaden piksel nie zbiera więcej niż całe swoje pole', poza.length === 0, poza[0] || '');

// --- 4. indeksy idą po kolei -------------------------------------------------

let wstecz = [];
for (const cell of PODZIALKI) {
  const w = axisWeights(240, cell, 0.12);
  for (let i = 1; i < w.out; i++) {
    if (w.a[i] < w.a[i - 1] || w.b[i] < w.b[i - 1]) { wstecz.push(`cell=${cell} px ${i}`); break; }
  }
}
check('punkty źródłowe idą wzdłuż rzędu, nigdy wstecz', wstecz.length === 0, wstecz[0] || '');

// --- 5. przerwa naprawdę jest ------------------------------------------------

// Przy całkowitej podziałce ≥ 3 wnętrze punktu ma być pełne, a oba brzegi
// nadgryzione — inaczej suwak przesuwałby liczby, nie obraz.
{
  const cell = 4, gap = 0.25;   // przerwa 1 piksel: pół z każdej strony punktu
  const w = axisWeights(240, cell, gap);
  const brzegLewy = w.wa[4], srodek1 = w.wa[5], srodek2 = w.wa[6], brzegPrawy = w.wa[7];
  check('przerwa nadgryza brzegi punktu, a wnętrze zostawia',
    bliskie(brzegLewy, 0.5, 1e-6) && srodek1 === 1 && srodek2 === 1 && bliskie(brzegPrawy, 0.5, 1e-6),
    `${brzegLewy} ${srodek1} ${srodek2} ${brzegPrawy}`);
}

// I kontrola przeciwna: im szersza przerwa, tym mniej atramentu. Bez tego
// wszystkie sumy powyżej zgadzałyby się także dla suwaka, który nic nie robi.
{
  const ink = (gap) => {
    const w = axisWeights(240, 3, gap);
    let s = 0;
    for (let i = 0; i < w.out; i++) s += w.wa[i] + w.wb[i];
    return s;
  };
  const kolejne = PRZERWY.map(ink);
  let maleje = true;
  for (let i = 1; i < kolejne.length; i++) if (kolejne[i] >= kolejne[i - 1]) maleje = false;
  check('szersza przerwa to mniej atramentu na panelu', maleje,
    kolejne.map((v) => v.toFixed(0)).join(' > '));
}

// --- 6. podziałka mniejsza niż piksel ----------------------------------------

// Przeglądarka oddalona na tyle, że punkt nie wypełnia nawet jednego piksela
// urządzenia. Rysować kratki nie ma już z czego, ale obraz ma zostać obrazem:
// każdy piksel bierze jakiś punkt, w całości i tylko jeden.
{
  const w = axisWeights(240, 0.5, 0.12);
  let zle = 0;
  for (let i = 0; i < w.out; i++) {
    if (w.wa[i] !== 1 || w.wb[i] !== 0 || w.a[i] < 0 || w.a[i] > 239) zle++;
  }
  check('poniżej piksela na punkt zostaje najbliższy punkt, bez pokrycia',
    zle === 0 && w.out === 120, `bufor ${w.out}, wadliwych ${zle}`);
}

// --- 7. powtórzone wiersze ---------------------------------------------------

// Wiersz oznaczony jako kopia musi mieć **te same** wagi, co poprzedni; malarz
// go nie liczy, tylko przepisuje bajty.
{
  let klamstwa = 0, razem = 0;
  for (const cell of PODZIALKI) {
    for (const gap of PRZERWY) {
      const w = axisWeights(64, cell, gap);
      const dup = rowDuplicates(w);
      for (let i = 1; i < w.out; i++) {
        razem += dup[i];
        if (dup[i] && (w.a[i] !== w.a[i - 1] || w.b[i] !== w.b[i - 1]
          || w.wa[i] !== w.wa[i - 1] || w.wb[i] !== w.wb[i - 1])) klamstwa++;
      }
    }
  }
  check('kopią nazwany jest tylko wiersz naprawdę identyczny', klamstwa === 0,
    `powtórzeń ${razem}, fałszywych ${klamstwa}`);
}

// Pierwszy wiersz nie ma czego kopiować.
check('pierwszy wiersz nigdy nie jest kopią', rowDuplicates(axisWeights(64, 4, 0.12))[0] === 0);

// Bez przerwy każdy punkt to `cell` identycznych wierszy — jeden liczony
// i `cell − 1` przepisanych. Ta liczba jest tym, co decyduje o koszcie klatki.
{
  const w = axisWeights(64, 4, 0);
  const dup = rowDuplicates(w);
  const ile = dup.reduce((a, b) => a + b, 0);
  check('bez przerwy przepisuje się wszystko poza pierwszym wierszem punktu',
    ile === 64 * 3, `${ile} z ${w.out}`);
}


// --- 8. malarz: czy z wag wychodzą te piksele, co trzeba -----------------------

// Rampa liniowa, żeby piksel dało się czytać wprost jako jasność 0–255.
const RAMPA = new Uint32Array(256).map((_, i) => i);

// Jeden zapalony punkt na pustym panelu, podziałka 4 piksele, przerwa ćwierć
// podziałki — czyli równo piksel, po pół z każdej strony. Punkt ma wyjść jako
// pełne 2×2 w środku, obwiedzione połową, a rogi ćwiartką, bo tam pokrycie
// mnoży się przez siebie w obu osiach.
{
  const grid = makeGrid(4, 4, 4, 0.25);
  const levels = new Float32Array(16);
  levels[0] = 1;
  const out = new Uint32Array(grid.width * grid.height);
  paint(grid, levels, RAMPA, out);

  const blok = [];
  for (let y = 0; y < 4; y++) blok.push(Array.from(out.slice(y * grid.width, y * grid.width + 4)));
  const oczek = [[63, 127, 127, 63], [127, 255, 255, 127], [127, 255, 255, 127], [63, 127, 127, 63]];
  check('pojedynczy punkt wychodzi z przerwą dookoła i przyciemnionymi rogami',
    JSON.stringify(blok) === JSON.stringify(oczek), JSON.stringify(blok[0]) + ' / ' + JSON.stringify(blok[1]));

  // Reszta panelu ma zostać tłem, a nie rozmazać się na sąsiednie komórki.
  let poza = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) if (x >= 4 || y >= 4) poza += out[y * grid.width + x];
  }
  check('zapalony punkt nie wychodzi poza własną komórkę', poza === 0, `suma poza komórką ${poza}`);
}

// Wyłączona siatka przy całkowitej podziałce ma dać dokładnie to, co dawało
// dawne powielanie punkt w punkt — inaczej sama możliwość rysowania kratki
// przestawiłaby obraz każdemu, kto jej nie chce.
{
  const grid = makeGrid(8, 8, 3, 0);
  const levels = new Float32Array(64);
  for (let i = 0; i < 64; i++) levels[i] = (i * 7 % 3) === 0 ? 1 : 0;
  const out = new Uint32Array(grid.width * grid.height);
  paint(grid, levels, RAMPA, out);

  let zle = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const oczek = levels[Math.floor(y / 3) * 8 + Math.floor(x / 3)] ? 255 : 0;
      if (out[y * grid.width + x] !== oczek) zle++;
    }
  }
  check('bez przerwy malarz powiela punkt w punkt, co do piksela', zle === 0, `różnic ${zle}`);
}

// --- 9. skrót z przepisywaniem wierszy --------------------------------------

// Malarz liczy tylko te wiersze, które nie są kopią poprzedniego. Gdyby uznał
// za kopię wiersz, który nią nie jest, obraz wyszedłby cicho zły — i nic by
// o tym nie powiedziało, bo szybciej to nadal działa. Dlatego obok stoi wersja
// bez żadnego skrótu, licząc każdy piksel z czterech wag osobno.
function malujWolno(grid, levels, ramp, out) {
  const { hx, hy, srcW } = grid;
  const top = ramp.length - 1;

  for (let y = 0; y < hy.out; y++) {
    for (let x = 0; x < hx.out; x++) {
      // Float32 tak samo jak w buforach wierszy, żeby porównanie było
      // porównaniem obrazów, a nie zaokrągleń.
      const wierszA = Math.fround(levels[hy.a[y] * srcW + hx.a[x]] * hx.wa[x]
        + levels[hy.a[y] * srcW + hx.b[x]] * hx.wb[x]);
      const wierszB = Math.fround(levels[hy.b[y] * srcW + hx.a[x]] * hx.wa[x]
        + levels[hy.b[y] * srcW + hx.b[x]] * hx.wb[x]);
      out[y * hx.out + x] = ramp[((wierszA * hy.wa[y] + wierszB * hy.wb[y]) * top) | 0];
    }
  }
}

{
  // Powtarzalny szum: obraz bez żadnej regularności, w którym pomyłka o wiersz
  // nie ma szans przypadkiem wypaść tak samo.
  let ziarno = 0x2B7E1516;
  const losowy = () => {
    ziarno ^= ziarno << 13; ziarno ^= ziarno >>> 17; ziarno ^= ziarno << 5;
    return ((ziarno >>> 0) % 1000) / 1000;
  };

  const levels = new Float32Array(240 * 64);
  for (let i = 0; i < levels.length; i++) levels[i] = losowy();

  let rozne = [];
  for (const cell of [1, 2, 2.5, 3, 3.75, 4, 5]) {
    for (const gap of [0, 0.12, 0.3]) {
      const grid = makeGrid(240, 64, cell, gap);
      const szybko = new Uint32Array(grid.width * grid.height);
      const wolno = new Uint32Array(grid.width * grid.height);
      paint(grid, levels, RAMPA, szybko);
      malujWolno(grid, levels, RAMPA, wolno);

      let n = 0;
      for (let i = 0; i < szybko.length; i++) if (szybko[i] !== wolno[i]) n++;
      if (n) rozne.push(`cell=${cell} gap=${gap}: ${n} pikseli`);
    }
  }
  check('malarz ze skrótami daje ten sam obraz, co liczony bez nich',
    rozne.length === 0, rozne[0] || '21 kombinacji, obrazy identyczne');
}

// Bezwładność panelu zostawia punkty w połowie drogi; malarz ma je oddać jako
// półcienie, a nie zaokrąglić do zapalony/zgaszony.
{
  const grid = makeGrid(2, 2, 4, 0);
  const levels = new Float32Array([0.5, 0.25, 1, 0]);
  const out = new Uint32Array(grid.width * grid.height);
  paint(grid, levels, RAMPA, out);
  const rogi = [out[0], out[4], out[4 * 8], out[4 * 8 + 4]];
  check('poziomy pośrednie wychodzą jako półcienie',
    JSON.stringify(rogi) === JSON.stringify([127, 63, 255, 0]), JSON.stringify(rogi));
}

console.log(fails ? `\n${fails} kontroli nie przeszło` : '\nwszystko przeszło');
process.exit(fails ? 1 : 0);
