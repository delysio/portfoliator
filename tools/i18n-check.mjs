// Sprawdza, czy słownik angielski pokrywa cały interfejs.
//
//   node tools/i18n-check.mjs           lista braków
//   node tools/i18n-check.mjs --keys    wypisuje wszystkie klucze, w kolejności strony
//
// Klucz to nie jest to, co widnieje w źródle HTML, tylko to, co zwróci DOM —
// i właśnie tę różnicę narzędzie odtwarza, bo na niej wykłada się każda ręczna
// próba dopisania wpisu:
//
//   * przy `data-i18n` czytany jest textContent, więc encje są już rozkodowane:
//     `&gt;` to zwykłe `>`, a `&nbsp;` to znak U+00A0 (który zwijanie białych
//     znaków sprowadza do zwykłej spacji);
//   * przy `data-i18n-html` czytany jest innerHTML, który serializuje je z
//     powrotem, więc `&amp;`, `&lt;`, `&gt;` i `&nbsp;` zostają w kluczu takie,
//     jakie są w źródle.
//
// Stąd wymóg, żeby atrybuty logiczne pisać w źródle w postaci `download=""`:
// przeglądarka serializuje je właśnie tak, a klucz musi zgadzać się co do znaku.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN_DICT } from '../js/ui/dict-en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Strony z napisami do przetłumaczenia: emulator i narzędzie karty EPROM.
const PAGES = ['index.html', 'eprom.html'];

// Elementy puste, które nie mają domknięcia.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Parser dla podzbioru HTML-a, w jakim napisany jest index.html. Nie jest to
 * pełna implementacja specyfikacji i nie musi nią być — ma zwrócić drzewo
 * elementów z pozycjami, żeby dało się wyciąć źródło wnętrza każdego z nich.
 */
function parse(html) {
  const root = { tag: '#root', attrs: '', children: [], parent: null };
  let node = root;
  let i = 0;

  const TAG = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = TAG.exec(html)) !== null) {
    if (m.index > i) addText(node, html.slice(i, m.index), i);
    i = TAG.lastIndex;

    if (m[0].startsWith('<!')) continue;                 // komentarz albo DOCTYPE

    const [, close, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();

    if (close) {
      let n = node;
      while (n && n.tag !== tag) n = n.parent;
      if (n) { n.end = m.index; node = n.parent; }
      continue;
    }

    const el = { tag, attrs, children: [], parent: node, openEnd: i, end: i };
    node.children.push(el);
    if (VOID.has(tag) || selfClose) continue;

    if (tag === 'script' || tag === 'style') {
      const hit = html.slice(i).match(new RegExp(`</${tag}\\s*>`, 'i'));
      const at = hit ? i + hit.index : html.length;
      el.end = at;
      TAG.lastIndex = hit ? at + hit[0].length : html.length;
      i = TAG.lastIndex;
      continue;
    }
    node = el;
  }
  return root;
}

function addText(node, text, start) {
  if (text) node.children.push({ tag: '#text', text, start, end: start + text.length, parent: node });
}

function walk(node, fn) {
  for (const c of node.children || []) { fn(c); walk(c, fn); }
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// Tylko te encje występują w pliku; obsługiwanie innych dawałoby fałszywe alarmy
// w miejscach, w których żadnego problemu nie ma.
const decode = (s) => s
  .replace(/&nbsp;/g, ' ')
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&');

const attrOf = (el, name) =>
  ((el.attrs || '').match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

/** Wszystkie klucze, jakich strona zażąda od słownika, w kolejności wystąpienia. */
export function collectKeys() {
  const out = [];
  for (const page of PAGES) collectPage(page, out);
  return out;
}

function collectPage(page, out) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const root = parse(html);
  let section = page === 'index.html' ? '(strona)' : page;

  walk(root, (el) => {
    if (el.tag === '#text') return;
    if (el.tag === 'dialog') section = attrOf(el, 'id') || section;

    const attrs = el.attrs || '';
    const inner = html.slice(el.openEnd, el.end);

    if (/\bdata-i18n-html\b/.test(attrs)) out.push({ section, variant: 'html', key: norm(inner) });
    else if (/\bdata-i18n\b(?!-)/.test(attrs)) out.push({ section, variant: 'text', key: norm(decode(inner)) });

    if (/\bdata-i18n-title\b/.test(attrs)) out.push({ section, variant: 'title', key: norm(attrOf(el, 'title')) });
    if (/\bdata-i18n-placeholder\b/.test(attrs)) out.push({ section, variant: 'placeholder', key: norm(attrOf(el, 'placeholder')) });
    if (/\bdata-i18n-aria\b/.test(attrs)) out.push({ section, variant: 'aria', key: norm(attrOf(el, 'aria-label')) });
  });
}

/** Zdejmuje z literału JS-a cudzysłowy i uciekanie. */
function unquote(literal) {
  const body = literal.slice(1, -1);
  return body.replace(/\\(.)/g, (whole, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}

const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;

/**
 * Napisy budowane w JavaScripcie. Oba źródła czytane są ze źródła, nie
 * z uruchomionego kodu:
 *
 *   * wywołania `t('…')`, także wtedy, gdy klucz sklejony jest plusem z kilku
 *     literałów — długie zdania łamie się w kodzie na kilka linii i inaczej
 *     narzędzie widziałoby sam początek;
 *   * bloki oznaczone komentarzem `i18n-keys` — tabele etykiet, które do `t()`
 *     trafiają dopiero jako zmienna, więc żadne czytanie źródła ich nie dogoni.
 */
export function collectRuntimeKeys() {
  const out = [];
  const files = [];
  const scan = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) scan(full);
      else if (name.endsWith('.js')) files.push(full);
    }
  };
  scan(path.join(ROOT, 'js'));

  const call = new RegExp(String.raw`\bt\(\s*((?:${STRING})(?:\s*\+\s*(?:${STRING}))*)`, 'g');
  const strings = new RegExp(STRING, 'g');

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const where = path.relative(ROOT, file);

    for (const m of src.matchAll(call)) {
      const joined = [...m[1].matchAll(strings)].map((s) => unquote(s[0])).join('');
      out.push({ file: where, key: norm(joined) });
    }

    // Blok etykiet: od komentarza do domknięcia nawiasu, który po nim następuje.
    for (const m of src.matchAll(/\/\*\s*i18n-keys\s*\*\//g)) {
      const open = src.slice(m.index).search(/[[{]/);
      if (open < 0) continue;
      let i = m.index + open;
      let depth = 0;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') { depth--; if (!depth) break; }
      }
      const block = src.slice(m.index + open, i + 1);
      for (const s of block.matchAll(strings)) out.push({ file: where, key: norm(unquote(s[0])) });
    }
  }
  return out;
}

export function check() {
  const fromHtml = collectKeys();
  const fromJs = collectRuntimeKeys();
  const wanted = new Map();
  for (const e of fromHtml) if (!wanted.has(e.key)) wanted.set(e.key, e.section);
  for (const e of fromJs) if (!wanted.has(e.key)) wanted.set(e.key, e.file);

  const missing = [...wanted].filter(([key]) => EN_DICT[key] === undefined);
  const empty = [...wanted].filter(([key]) => EN_DICT[key] === '');
  const dead = Object.keys(EN_DICT).filter((key) => !wanted.has(key));

  // Miejsca na argumenty muszą się zgadzać po obu stronach, bo podstawienie idzie
  // po numerze - brakujące {1} znika ze zdania bez śladu w konsoli.
  const slots = [];
  for (const [key] of wanted) {
    const value = EN_DICT[key];
    if (value === undefined) continue;
    const a = [...key.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
    const b = [...value.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
    if (a !== b) slots.push([key, a, b]);
  }

  return { wanted, missing, empty, dead, slots, fromHtml, fromJs };
}

if (process.argv[1] && process.argv[1].endsWith('i18n-check.mjs')) {
  const r = check();

  if (process.argv.includes('--keys')) {
    for (const e of r.fromHtml) console.log(`[${e.section}/${e.variant}] ${e.key}`);
    for (const e of r.fromJs) console.log(`[${e.file}] ${e.key}`);
    process.exit(0);
  }

  console.log(`kluczy w interfejsie: ${r.wanted.size} (HTML ${r.fromHtml.length}, JS ${r.fromJs.length})`);
  console.log(`wpisów w słowniku:    ${Object.keys(EN_DICT).length}`);

  if (r.missing.length) {
    console.log('');
    console.log(`BRAK TŁUMACZENIA (${r.missing.length}):`);
    for (const [key, where] of r.missing) console.log(`  [${where}] ${key}`);
  }
  if (r.empty.length) {
    console.log('');
    console.log(`PUSTE TŁUMACZENIA (${r.empty.length}):`);
    for (const [key] of r.empty) console.log(`  ${key}`);
  }
  if (r.dead.length) {
    console.log('');
    console.log(`MARTWE WPISY — nie ma ich już w interfejsie (${r.dead.length}):`);
    for (const key of r.dead) console.log(`  ${key}`);
  }
  if (r.slots.length) {
    console.log('');
    console.log(`NIEZGODNE MIEJSCA NA ARGUMENTY (${r.slots.length}):`);
    for (const [key, a, b] of r.slots) console.log(`  {${a}} -> {${b}}  ${key.slice(0, 60)}`);
  }

  const bad = r.missing.length + r.empty.length + r.dead.length + r.slots.length;
  console.log('');
  console.log(bad ? `NIEDOMKNIĘTE: ${bad}` : 'Słownik kompletny.');
  process.exit(bad ? 1 : 0);
}
