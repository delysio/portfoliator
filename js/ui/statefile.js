// The machine state as a file.
//
// The slots in the browser's database are enough to work with, but not to take
// a state elsewhere or to back it up - and a Portfolio's state is often hours of
// typing in Lotus 1-2-3, which nobody wants to keep only in the browser's
// storage, gone with one click of "clear site data".
//
// The format is boring on purpose: JSON in which every byte array becomes
// `{"$":"u8","b":"<base64>"}`. It is not the tightest encoding there is - a
// full state with a card and the expansion weighs some hundreds of kilobytes
// rather than some hundreds of thousands of bytes - but it has two properties
// worth more here than size: it can be read in a text editor, and it **has no
// field layout of its own**. The encoder walks the object recursively and knows
// nothing of what is inside, so adding a field to any device never means
// touching this file. A format that has to be updated along with every device
// sooner or later stops being updated.

import { fileStamp } from './format.js';

const ZNACZNIK = 'portfoliator-state';

const TYPY = {
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i8: Int8Array,
  i16: Int16Array,
  i32: Int32Array,
};
const NAZWY = new Map(Object.entries(TYPY).map(([k, v]) => [v, k]));

/** base64 of a byte array, in chunks - apply() on the whole of it blows the stack. */
function doBase64(bytes) {
  const KAWALEK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += KAWALEK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + KAWALEK, bytes.length)));
  }
  return btoa(s);
}

function zBase64(tekst) {
  const s = atob(tekst);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function spakuj(v) {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const nazwa = NAZWY.get(v.constructor);
    if (!nazwa) throw new Error(`Nieobsługiwany typ tablicy: ${v.constructor.name}`);
    const bajty = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return { $: nazwa, b: doBase64(bajty) };
  }
  if (Array.isArray(v)) return v.map(spakuj);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, w] of Object.entries(v)) out[k] = spakuj(w);
    return out;
  }
  return v;
}

function rozpakuj(v) {
  if (Array.isArray(v)) return v.map(rozpakuj);
  if (v && typeof v === 'object') {
    if (typeof v.$ === 'string' && typeof v.b === 'string') {
      const Ctor = TYPY[v.$];
      if (!Ctor) throw new Error(`Nieznany typ tablicy w pliku: ${v.$}`);
      const bajty = zBase64(v.b);
      return new Ctor(bajty.buffer, bajty.byteOffset, bajty.byteLength / Ctor.BYTES_PER_ELEMENT);
    }
    const out = {};
    for (const [k, w] of Object.entries(v)) out[k] = rozpakuj(w);
    return out;
  }
  return v;
}

/** @returns {string} the contents of a .pofostate file */
export function encode(state) {
  return JSON.stringify({ format: ZNACZNIK, state: spakuj(state) });
}

/**
 * @param {string} tekst
 * @returns {object} a state ready to hand to the worker
 * @throws when the file is not a machine state - with a message to show (in
 *   Polish, the key js/main.js translates)
 */
export function decode(tekst) {
  let paczka;
  try {
    paczka = JSON.parse(tekst);
  } catch {
    throw new Error('To nie jest plik ze stanem maszyny.');
  }
  if (!paczka || paczka.format !== ZNACZNIK || !paczka.state) {
    throw new Error('To nie jest plik ze stanem maszyny.');
  }
  return rozpakuj(paczka.state);
}

/** A file name with the date in it, so several snapshots do not trip over one name. */
export function nazwaPliku(kiedy = Date.now()) {
  return `portfolio-${fileStamp(new Date(kiedy))}.pofostate`;
}
