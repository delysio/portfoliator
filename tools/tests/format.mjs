// Daty i liczby na stronie: zawsze RRRR-MM-DD i zawsze kropka dziesiętna.
//
// Wcześniej strona formatowała przez toLocaleString('pl-PL'), więc wersja
// angielska pokazywała daty jako 11.11.2026, a wynik zależał od przeglądarki.
// Zestaw pilnuje dwóch rzeczy: że js/ui/format.js daje dokładnie ten zapis
// i że nikt w kodzie strony nie formatuje już po swojemu.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoDate, isoDateTime, fileStamp, formatNumber } from '../../js/ui/format.js';
import { nazwaPliku } from '../../js/ui/statefile.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let fails = 0;
const check = (ok, what, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};
const show = (s) => JSON.stringify(s).replace(/ /g, '⍽');

// ---- daty ---------------------------------------------------------------------

const d = new Date(2026, 0, 5, 7, 4, 9);
check(isoDate(d) === '2026-01-05', 'data to RRRR-MM-DD, z zerami wiodącymi', isoDate(d));
check(isoDateTime(d) === '2026-01-05 07:04', 'data z godziną: RRRR-MM-DD GG:MM', isoDateTime(d));
check(fileStamp(d) === '2026-01-05-070409', 'w nazwie pliku: RRRR-MM-DD-GGMMSS, bez dwukropka', fileStamp(d));
check(nazwaPliku(d.getTime()) === 'portfolio-2026-01-05-070409.pofostate', 'plik stanu nazywa się według tej samej daty',
      nazwaPliku(d.getTime()));

// ---- liczby -------------------------------------------------------------------

const cases = [
  [0, 0, '0'],
  [1234, 0, '1234'],
  [12345, 0, '12 345'],
  [1234567.25, 2, '1 234 567.25'],
  [0.5, 1, '0.5'],
  [99999.96, 1, '100 000.0'],
  [-12345.678, 2, '-12 345.68'],
  [-0.01, 1, '0.0'],
];
for (const [n, dec, want] of cases) {
  const got = formatNumber(n, dec);
  check(got === want, `formatNumber(${n}, ${dec})`, show(got));
}
check(!cases.some(([n, dec]) => formatNumber(n, dec).includes(',')), 'przecinka nie ma nigdy, ani dziesiętnego, ani w grupach');

// ---- nikt nie formatuje po swojemu --------------------------------------------

const offenders = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.js') || p.endsWith(path.join('ui', 'format.js'))) continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/\.toLocale(?:Date|Time)?String\(|Intl\.(?:NumberFormat|DateTimeFormat)/.test(code)) {
        offenders.push(`${path.relative(ROOT, p)}:${i + 1}`);
      }
    });
  }
})(path.join(ROOT, 'js'));
check(offenders.length === 0, 'daty i liczby formatuje tylko js/ui/format.js', offenders.join(' | '));

process.exit(fails ? 1 : 0);
