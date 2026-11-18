// Nagrywanie obrazu: układ klatki, wybór formatu i to, co widać na przycisku.
//
// Samego MediaRecordera w Node nie ma, więc tu sprawdzane są części, od których
// zależy, czy plik wyjdzie dobry: gdzie w klatce ląduje ekran i obudowa, jaki
// format dostanie dana przeglądarka i jaką przepływność. Przebieg w prawdziwej
// przeglądarce sprawdza się osobno, przez CDP.
//
// Układ jest liczony z tej samej tabeli SHELLS, której używa strona, wyciętej
// z js/main.js tekstowo - przepisana tu z ręki sprawdzałaby samą siebie.

import fs from 'node:fs';
import {
  FRAMES, pickMimeType, extensionFor, bitrateFor, formatElapsed, recordingLayout,
} from '../../js/ui/recorder.js';

let fails = 0;
const check = (ok, what, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const main = fs.readFileSync(new URL('../../js/main.js', import.meta.url), 'utf8');
const SHELLS = {};
for (const m of main.matchAll(/^\s+(\d): \{ image: '[^']+',\s+w: (\d+),\s+h: (\d+), x: (\d+), y: (\d+),\s+mul: (\d+) \}/gm)) {
  SHELLS[m[1]] = { w: +m[2], h: +m[3], x: +m[4], y: +m[5], mul: +m[6] };
}
check(Object.keys(SHELLS).length === 4, 'tabela obudów wyczytana z js/main.js', Object.keys(SHELLS).join(','));

const SCREEN_W = 240, PANEL_H = 80;

// ---- układ klatki --------------------------------------------------------

{
  const s = 4, dpr = 1;
  const screenW = SCREEN_W * s * dpr, screenH = PANEL_H * s * dpr;
  const withCase = recordingLayout({ frame: 'case', shell: SHELLS[s], dpr, screenW, screenH });
  check(withCase.width === 1628 && withCase.height === 716,
        'obudowa 4× daje klatkę 1628×716 (715 dociągnięte do parzystej)', `${withCase.width}×${withCase.height}`);
  check(withCase.shell.w === 1628 && withCase.shell.h === 715,
        'grafika obudowy rysuje się w swoim rozmiarze, bez rozciągania na dodany wiersz',
        `${withCase.shell.w}×${withCase.shell.h}`);
  check(withCase.screen.x === 436 && withCase.screen.y === 220 && withCase.screen.w === 960 && withCase.screen.h === 320,
        'ekran ląduje w otworze obudowy, tam gdzie stawia go strona', JSON.stringify(withCase.screen));

  const alone = recordingLayout({ frame: 'screen', shell: SHELLS[s], dpr, screenW, screenH });
  check(alone.width === 960 && alone.height === 320 && alone.shell === null,
        'sam ekran 4× to 960×320, bez obudowy', `${alone.width}×${alone.height}`);
}

// Każda skala i typowe powiększenia systemowe: ekran zawsze mieści się w klatce,
// a wymiary są parzyste, bo inaczej część koderów odmawia pracy.
{
  const bad = [];
  for (const s of [1, 2, 3, 4]) {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const screenW = Math.round(SCREEN_W * s * dpr), screenH = Math.round(PANEL_H * s * dpr);
      for (const frame of FRAMES) {
        const L = recordingLayout({ frame, shell: SHELLS[s], dpr, screenW, screenH });
        const fits = L.screen.x >= 0 && L.screen.y >= 0 &&
                     L.screen.x + L.screen.w <= L.width && L.screen.y + L.screen.h <= L.height;
        if (!fits || L.width % 2 || L.height % 2) bad.push(`${frame} ${s}× dpr ${dpr}: ${L.width}×${L.height}`);
      }
    }
  }
  check(bad.length === 0, 'w każdej skali i przy każdym powiększeniu ekran mieści się w parzystej klatce', bad.join(' | '));
}

// ---- format i przepływność ------------------------------------------------

{
  const chrome = new Set(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
  const firefox = new Set(['video/webm;codecs=vp8,opus', 'video/webm']);
  const safari = new Set(['video/mp4', 'video/mp4;codecs=avc1,mp4a.40.2']);
  check(pickMimeType((t) => chrome.has(t)) === 'video/webm;codecs=vp9,opus', 'Chrome dostaje VP9 w WebM');
  check(pickMimeType((t) => firefox.has(t)) === 'video/webm;codecs=vp8,opus', 'Firefox dostaje VP8 w WebM');
  check(pickMimeType((t) => safari.has(t)) === 'video/mp4;codecs=avc1,mp4a.40.2', 'Safari dostaje MP4');
  check(pickMimeType(() => false) === '', 'bez żadnego formatu wynik jest pusty, a nie zgadnięty');
  check(extensionFor('video/mp4;codecs=avc1') === 'mp4' && extensionFor('video/webm;codecs=vp9') === 'webm',
        'rozszerzenie pliku idzie za formatem');

  check(bitrateFor(1628, 716) === 6_993_888, 'obudowa 4× nagrywa się z ok. 7 Mb/s', String(bitrateFor(1628, 716)));
  check(bitrateFor(240, 80) === 2_000_000, 'mała klatka nie spada poniżej 2 Mb/s');
  check(bitrateFor(4000, 2000) === 12_000_000, 'duża klatka nie przekracza 12 Mb/s');
}

// ---- licznik na przycisku -------------------------------------------------

{
  const cases = [[0, '0:00'], [999, '0:00'], [42_000, '0:42'], [363_400, '6:03'], [3_600_000, '60:00'], [-5, '0:00']];
  for (const [ms, want] of cases) {
    check(formatElapsed(ms) === want, `formatElapsed(${ms}) = ${want}`, formatElapsed(ms));
  }
}

process.exit(fails ? 1 : 0);
