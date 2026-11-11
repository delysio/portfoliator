// Polish is the source language and the Polish text is the key.
//
// There is no separate namespace of identifiers like `ui.button.save`: the page
// is written in Polish and the dictionary in dict-en.js maps each Polish string
// to its English counterpart. Nothing has to be renamed, the markup stays
// readable, and a string with no entry simply stays Polish instead of turning
// into a broken identifier on screen.
//
// The price is that the key has to match to the character, and the key is *what
// the DOM gives back*, not what the HTML source spells:
//
//   * `data-i18n` reads textContent, so character entities are already decoded:
//     `&gt;` is a plain `>` and `&nbsp;` is U+00A0;
//   * `data-i18n-html` reads innerHTML, which serialises them back, so `&amp;`,
//     `&lt;`, `&gt;` and `&nbsp;` appear in the key exactly as in the source.
//
// Both are then whitespace-collapsed, so the indentation and line breaks that
// make the HTML readable never reach the dictionary. tools/i18n-check.mjs
// rebuilds every key the same way and fails on anything missing, which is what
// keeps the two files honest.

import { EN_DICT } from './dict-en.js';

const STORAGE_KEY = 'portfoliator.lang';
const LANGUAGES = ['pl', 'en'];

// What each variant reads to build its key, and how it writes the result back.
const VARIANTS = [
  ['data-i18n', (el) => el.textContent, (el, v) => { el.textContent = v; }],
  ['data-i18n-html', (el) => el.innerHTML, (el, v) => { el.innerHTML = v; }],
  ['data-i18n-title', (el) => el.title, (el, v) => { el.title = v; }],
  ['data-i18n-placeholder', (el) => el.placeholder, (el, v) => { el.placeholder = v; }],
  ['data-i18n-aria', (el) => el.getAttribute('aria-label'),
    (el, v) => el.setAttribute('aria-label', v)],
];

// The Polish original of every element touched, so switching back is exact
// rather than a translation of a translation.
const originals = new WeakMap();

const listeners = new Set();
let current = 'pl';

export const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export function getLanguage() { return current; }

/** Runs `fn` after every switch, for parts of the page JavaScript builds. */
export function onLanguageChange(fn) { listeners.add(fn); }

/**
 * Translates one string, for text that never exists in the HTML - messages the
 * emulator produces while running. Placeholders are `{0}`, `{1}`, … and are
 * filled after the lookup, so the dictionary holds the template rather than a
 * dozen almost-identical sentences.
 */
export function t(key, ...args) {
  const template = current === 'en' ? (EN_DICT[norm(key)] ?? key) : key;
  return template.replace(/\{(\d+)\}/g, (whole, i) => (args[i] !== undefined ? args[i] : whole));
}

/** Keys asked for that the dictionary does not have; reported by the console. */
const missing = new Set();

function translate(key) {
  const value = EN_DICT[key];
  if (value === undefined) { missing.add(key); return null; }
  return value;
}

function applyTo(root) {
  for (const [attr, read, write] of VARIANTS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      let cache = originals.get(el);
      if (!cache) { cache = {}; originals.set(el, cache); }
      if (cache[attr] === undefined) cache[attr] = read(el);

      if (current === 'pl') { write(el, cache[attr]); continue; }

      const value = translate(norm(cache[attr]));
      if (value !== null) write(el, value);
    }
  }
}

/**
 * Switches the whole page. Elements JavaScript filled in are *not* restored from
 * the cache - they are rebuilt by the listeners, because the cached value would
 * be whatever happened to be on screen when the language last changed.
 */
export function setLanguage(lang, { save = true } = {}) {
  if (!LANGUAGES.includes(lang)) return;
  current = lang;
  missing.clear();

  document.documentElement.lang = lang;
  applyTo(document);

  const title = document.querySelector('title');
  if (title) document.title = title.textContent;

  for (const fn of listeners) {
    try { fn(lang); } catch (err) { console.warn('i18n listener failed', err); }
  }

  if (save) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
  }
  if (missing.size) {
    console.warn(`i18n: brak ${missing.size} tłumaczeń`, [...missing]);
  }
}

/**
 * The language to start in: whatever was chosen here before, and failing that
 * whatever the browser asks for. Anything that is not Polish gets English,
 * which is the wider net of the two.
 */
export function initLanguage() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }

  const fromBrowser = (navigator.languages || [navigator.language || 'en'])
    .some((l) => String(l).toLowerCase().startsWith('pl')) ? 'pl' : 'en';

  setLanguage(LANGUAGES.includes(saved) ? saved : fromBrowser, { save: false });
  return current;
}
