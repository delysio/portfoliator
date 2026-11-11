// Karta EPROM: obraz, jaki składa eprom.html.
//
// Układ banku odtwarza program „DISK zu EPROM Konverter” z Atari ST, którym
// karty tri tec przygotowywano od 1992 roku — FAT12 z klastrami po 1 KB,
// jedna FAT, katalog główny przycięty do zawartości, kopia sektora
// rozruchowego w ostatnim sektorze. Ten zestaw pilnuje, żeby bank:
//
//   * miał dokładnie te pola, których Portfolio wymaga (komunikaty tamtego
//     programu mówią wprost, że inaczej „PF spinnt”);
//   * dał się odczytać z powrotem co do bajtu i co do daty;
//   * mieścił tyle, ile powinien, i odmawiał, gdy nie mieści;
//   * był czytelny dla prawdziwego DIP-DOS — z ROM-em zestaw montuje go jako
//     kartę A: i sprawdza DIR.
//
// Banki z prawdziwego programu (katalog epr/ w drzewie roboczym, poza
// repozytorium) są wzorcem, jeśli leżą na dysku: zbudowany od nowa bank musi
// mieć ten sam sektor rozruchowy, tę samą FAT i te same wpisy katalogów.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANK_SIZE, shortName, cleanLabel, dosStamp, fromDosStamp, bankUsage, buildBank,
  joinBanks, readBank, splitBanks,
} from '../../js/eprom/epr.js';
import * as fat from '../../js/ui/fat12.js';
import { romsAvailable, boot, bootToPrompt, type, run, screen } from '../pofo-headless.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const bytes = (n, seed) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
};
const when = dosStamp(new Date(1996, 7, 28, 17, 5, 12));
const file = (name, n, seed) => ({ name, dir: false, data: bytes(n, seed), ...when });
const dir = (name, children) => ({ name, dir: true, children, ...when });
const u16 = (img, o) => img[o] | (img[o + 1] << 8);
const fatEntry = (img, c) => {
  const o = 512 + c + (c >> 1);
  const w = u16(img, o);
  return c & 1 ? w >> 4 : w & 0xFFF;
};

const tree = [
  dir('FOLIDASH', [file('FOLIDASH.COM', 6832, 1), file('TITLE.TXT', 809, 2), file('EMPTY.TXT', 0, 3)]),
  dir('NUCLEUS', [file('N.COM', 30000, 4), dir('DATA', [file('TWIRL.ZX0', 2049, 5)])]),
  file('README.TXT', 1024, 6),
];

// --- 1. sektor rozruchowy -----------------------------------------------------

const img = buildBank(tree, { label: 'pofo' });
{
  check('bank ma 128 KB', img.length === BANK_SIZE, `${img.length}`);
  const head = Array.from(img.subarray(0, 11), (v) => v.toString(16).padStart(2, '0')).join(' ');
  check('nagłówek jak u konwertera ST', head === 'e9 00 4e 4e 4e 4e 4e 4e 0e 5f b3', head);
  const bpb = {
    sector: u16(img, 11), perCluster: img[13], reserved: u16(img, 14), fats: img[16],
    root: u16(img, 17), total: u16(img, 19), media: img[21], fatSectors: u16(img, 22),
    track: u16(img, 24), heads: u16(img, 26),
  };
  check('BPB: 512 B, 2 sektory na klaster, 1 zarezerwowany, 1 FAT',
        bpb.sector === 512 && bpb.perCluster === 2 && bpb.reserved === 1 && bpb.fats === 1, JSON.stringify(bpb));
  check('BPB: 256 sektorów, media F9, FAT 1 sektor', bpb.total === 256 && bpb.media === 0xF9 && bpb.fatSectors === 1);
  check('BPB: 8 sektorów na ścieżkę, 2 strony — innych Portfolio nie rozpoznaje',
        bpb.track === 8 && bpb.heads === 2);
  check('katalog główny przycięty do jednego sektora', bpb.root === 16, `${bpb.root}`);
  check('ostatni sektor to kopia sektora rozruchowego',
        img.subarray(BANK_SIZE - 512).every((v, i) => v === img[i]));
}

// --- 2. FAT i kolejność ---------------------------------------------------------

{
  check('FAT zaczyna się od F9 FF FF', img[512] === 0xF9 && img[513] === 0xFF && img[514] === 0xFF);
  // FOLIDASH: katalog w klastrze 2, potem jego pliki; NUCLEUS za nimi.
  const root = (k) => 1024 + 32 * k;
  const name = (o) => String.fromCharCode(...img.subarray(o, o + 11));
  check('etykieta jest pierwszą pozycją, wielkimi literami', name(root(0)) === 'POFO       ' && img[root(0) + 11] === 0x08);
  check('pozycje w zadanej kolejności', name(root(1)) === 'FOLIDASH   ' && name(root(2)) === 'NUCLEUS    ' && name(root(3)) === 'README  TXT');
  check('katalog dostaje klaster przed swoją zawartością', u16(img, root(1) + 26) === 2);
  // FOLIDASH.COM: 6832 B = 7 klastrów od 3, ciągiem.
  let ok = true;
  for (let c = 3; c < 9; c++) if (fatEntry(img, c) !== c + 1) ok = false;
  check('plik leży w ciągłym łańcuchu zakończonym FFF', ok && fatEntry(img, 9) === 0xFFF);
  const sub = 0x600;   // klaster 2 = katalog FOLIDASH
  check('podkatalog zaczyna się od . i ..',
        name(sub) === '.          ' && name(sub + 32) === '..         ' && u16(img, sub + 26) === 2 && u16(img, sub + 32 + 26) === 0);
  const empty = sub + 32 * 4;
  check('pusty plik nie zajmuje klastra', name(empty) === 'EMPTY   TXT' && u16(img, empty + 26) === 0 && u16(img, empty + 28) === 0);
}

// --- 3. odczyt z powrotem -------------------------------------------------------

{
  const back = readBank(img);
  check('etykieta wraca', back.label === 'POFO', back.label);
  const flat = (l, p = '') => l.flatMap((n) => (n.dir ? flat(n.children, `${p}${n.name}/`) : [[p + n.name, n]]));
  const a = flat(tree);
  const b = flat(back.items);
  check('te same pliki w tej samej kolejności', a.map((x) => x[0]).join() === b.map((x) => x[0]).join(), b.map((x) => x[0]).join());
  check('ta sama zawartość co do bajtu',
        a.every(([, n], i) => n.data.length === b[i][1].data.length && n.data.every((v, k) => v === b[i][1].data[k])));
  check('te same daty', b.every(([, n]) => n.date === when.date && n.time === when.time));
  const d = fromDosStamp(when.date, when.time);
  check('data DOS w obie strony', d.getFullYear() === 1996 && d.getMonth() === 7 && d.getDate() === 28 && d.getHours() === 17,
        String(d));
}

// --- 4. pojemność ---------------------------------------------------------------

{
  const u = bankUsage([]);
  check('pusty bank mieści 126 klastrów po 1 KB', u.capacity === 126 && u.clusterBytes === 1024, `${u.capacity}`);
  check('jeden plik 126 KB się mieści', bankUsage([file('A.BIN', 126 * 1024, 7)]).fits);
  let threw = false;
  try { buildBank([file('A.BIN', 126 * 1024 + 1, 7)]); } catch { threw = true; }
  check('plik o bajt za duży jest odrzucony', threw);

  const many = (n) => Array.from({ length: n }, (_, i) => file(`F${String(i).padStart(3, '0')}.TXT`, 10, i));
  check('15 pozycji — katalog główny ma 1 sektor', bankUsage(many(15)).rootSectors === 1);
  const u16e = bankUsage(many(16));
  check('16 pozycji — katalog rośnie do 3 sektorów i oddaje 1 KB', u16e.rootSectors === 3 && u16e.capacity === 125,
        `${u16e.rootSectors} / ${u16e.capacity}`);
  check('111 pozycji to granica', bankUsage(many(111)).fits && !bankUsage(many(112)).fits);
  const big = buildBank(many(47));
  check('przy 3 sektorach katalogu ostatni sektor dalej poza klastrami',
        big.subarray(BANK_SIZE - 512).every((v, i) => v === big[i]) && readBank(big).items.length === 47);
}

// --- 5. nazwy 8.3 ---------------------------------------------------------------

{
  const n1 = shortName('readme.txt');
  check('krótka nazwa przechodzi bez zmian poza wielkością liter', n1.name === 'README.TXT' && !n1.changed);
  const n2 = shortName('Long File Name.text');
  check('długa nazwa jest przycinana', n2.name === 'LONGFILE.TEX' && n2.changed, n2.name);
  const n3 = shortName('Long File Name.text', new Set(['LONGFILE.TEX']));
  check('kolizja dostaje ~1', n3.name === 'LONGFI~1.TEX', n3.name);
  check('znaki spoza DOS zamieniane na _', shortName('a+b.c').name === 'A_B.C');
  check('etykieta ma najwyżej 11 znaków', cleanLabel('Moje gry i dema') === 'MOJEGRYIDEM');
}

// --- 6. EPROM z banków ----------------------------------------------------------

{
  const banks = [buildBank(tree, { label: 'A' }), buildBank([], { label: 'B' })];
  const whole = joinBanks(banks);
  check('banki leżą jeden za drugim', whole.length === 2 * BANK_SIZE && whole[BANK_SIZE + 0x400] === 0x42);
  const parts = splitBanks(whole);
  check('podział oddaje te same banki', parts.length === 2 && parts[1].every((v, i) => v === banks[1][i]));
  let threw = false;
  try { splitBanks(new Uint8Array(100)); } catch { threw = true; }
  check('plik niebędący wielokrotnością 128 KB jest odrzucony', threw);
  threw = false;
  try { readBank(new Uint8Array(BANK_SIZE)); } catch { threw = true; }
  check('pusty (wyzerowany) bank to brak systemu plików, nie śmieci', threw);
}

// --- 7. karta sformatowana przez DIP-DOS też się wczytuje -----------------------

{
  const card = fat.formatCard(131072);
  fat.addFile(card, 'HELLO.TXT', bytes(700, 9), new Date(2000, 0, 2, 3, 4, 6));
  const r = readBank(card);
  check('karta DIP-DOS (klastry 512 B) czyta się tym samym kodem',
        r.items.length === 1 && r.items[0].name === 'HELLO.TXT' && r.items[0].data.length === 700);
}

// --- 8. strona i jej kod mówią o tych samych elementach -------------------------

{
  const html = fs.readFileSync(path.join(ROOT, 'eprom.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'js/eprom/app.js'), 'utf8');
  const modal = fs.readFileSync(path.join(ROOT, 'js/ui/confirm.js'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...new Set([...(app + modal).matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((i) => !ids.has(i));
  check('każde id z app.js i confirm.js jest w eprom.html', !missing.length, missing.join(', ') || `${used.length} id`);
  check('pytania idą przez okno strony, nie przez confirm() przeglądarki', !/\bconfirm\(/.test(app));
  const classes = [...new Set([...app.matchAll(/q\('\.([a-z-]+)'\)/g)].map((m) => m[1]))];
  const absent = classes.filter((c) => !new RegExp(`class="[^"]*\\b${c}\\b`).test(html));
  check('każda klasa szablonu banku jest w szablonie', !absent.length, absent.join(', ') || `${classes.length} klas`);
  check('strona startuje przez boot.js z własnym wejściem', /src="js\/boot\.js" data-entry="js\/eprom\/app\.js"/.test(html));
}

// --- 9. wzorzec: banki z prawdziwego konwertera ---------------------------------

{
  const dirEpr = path.join(ROOT, 'epr');
  const samples = fs.existsSync(dirEpr)
    ? fs.readdirSync(dirEpr).filter((f) => f.endsWith('.epr') && fs.statSync(path.join(dirEpr, f)).size === BANK_SIZE)
    : [];
  if (!samples.length) {
    console.log('POMINIĘTE  banki z konwertera ST — brak epr/*.epr (pliki spoza repozytorium)');
  }
  for (const f of samples) {
    const orig = new Uint8Array(fs.readFileSync(path.join(dirEpr, f)));
    const { label, items } = readBank(orig);
    const again = buildBank(items, { label });
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    check(`${f}: ten sam sektor rozruchowy i kopia na końcu`,
          same(orig.subarray(0, 512), again.subarray(0, 512)) && same(orig.subarray(BANK_SIZE - 512), again.subarray(BANK_SIZE - 512)));
    check(`${f}: ta sama FAT`, same(orig.subarray(512, 1024), again.subarray(512, 1024)));
    const flat = (l, p = '') => l.flatMap((n) => [`${p}${n.name} ${n.dir ? 'd' : n.data.length}`].concat(n.dir ? flat(n.children, `${p}${n.name}/`) : []));
    check(`${f}: te same pozycje i rozmiary`, flat(items).join() === flat(readBank(again).items).join(), `${flat(items).length} pozycji`);
  }
}

// --- 10. DIP-DOS widzi bank jako kartę ------------------------------------------

if (!romsAvailable()) {
  console.log('POMINIĘTE  bank w emulatorze — brak plików ROM w rom/');
} else {
  const { machine, cpu } = boot();
  machine.insertCardA(buildBank(tree, { label: 'pofo' }), false);
  machine.reset(); cpu.reset();
  bootToPrompt(machine, cpu);
  type(machine, cpu, 'DIR A:\n');
  run(machine, cpu, 2000);
  const top = screen(machine).join('\n').toLowerCase();
  check('DIR A: pokazuje katalogi i plik z korzenia',
        /folidash\s+<dir>/.test(top) && /nucleus\s+<dir>/.test(top) && /readme\s+txt\s+1024/.test(top));
  type(machine, cpu, 'DIR A:NUCLEUS\n');
  run(machine, cpu, 2000);
  const sub = screen(machine).join('\n').toLowerCase();
  check('DIR A:NUCLEUS pokazuje zawartość podkatalogu', /n\s+com\s+30000/.test(sub) && /data\s+<dir>/.test(sub));
}

console.log(fails ? `\n${fails} kontroli nie przeszło` : '\nwszystkie kontrole przeszły');
process.exit(fails ? 1 : 0);
