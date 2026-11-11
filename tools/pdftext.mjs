// Pulls the text layer out of a scanned PDF, with no dependencies.
//
//   node tools/pdftext.mjs skan.pdf [wyjscie.txt]
//
// Written for reading scanned technical documentation - the Atari Portfolio
// Technical Reference Guide among it - on a machine without poppler or any
// other PDF tooling. It handles the shape those scans actually come in: page
// images plus an invisible OCR text layer, which Tesseract writes using a
// font it calls GlyphLessFont with a ToUnicode map per page.
//
// Three things make such a file harder to read than it looks, and each cost an
// hour the first time:
//
//   * "endstream" ends in "stream", so scanning for stream starts without a
//     guard doubles the hits with false ones and sends the boundary search off
//     into binary data;
//   * the ToUnicode maps are stored *uncompressed*, so a reader that keeps only
//     the streams it managed to inflate throws away exactly the tables it needs
//     to turn glyph codes back into characters;
//   * image data contains "BT" and "Tf" by chance often enough to look like a
//     content stream, so streams have to be filtered by how printable they are.
//
// Line breaks come from the text geometry rather than from the operators: OCR
// emits one word per show operator, so without tracking Tm and Td every word
// lands on a line of its own and any table in the document turns to confetti.

import fs from 'node:fs';
import zlib from 'node:zlib';

/** Every stream in the file, inflated where it can be, raw where it cannot. */
function inflateAll(buf) {
  const raw = buf.toString('latin1');
  const out = [];

  const re = /(?<!end)stream(\r\n|\r|\n)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const head = raw.slice(Math.max(0, m.index - 600), m.index);
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(head);

    const tryAt = (end) => {
      if (end <= start) return null;
      const slice = buf.subarray(start, end);
      try { return zlib.inflateSync(slice); } catch { /* keep looking */ }
      try { return zlib.inflateRawSync(slice); } catch { return null; }
    };

    let data = len ? tryAt(start + Number(len[1])) : null;

    // No usable /Length, or it lied: try the first few candidate ends. Walking
    // every one of them across a 16 MB file costs minutes.
    let tries = 0;
    for (let at = raw.indexOf('endstream', start); !data && at > 0 && tries < 8;
         at = raw.indexOf('endstream', at + 9), tries++) {
      data = tryAt(at) || tryAt(at - 1) || tryAt(at - 2);
    }

    // A stream that will not inflate may simply be stored plain.
    if (!data && len) data = buf.subarray(start, start + Number(len[1]));

    if (data) out.push(data);
  }
  return out;
}

/** Merges every ToUnicode CMap into one code -> character table. */
function buildCMap(streams) {
  const map = new Map();
  const chars = (h) => {
    let s = '';
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCodePoint(parseInt(h.slice(i, i + 4), 16));
    return s || String.fromCodePoint(parseInt(h, 16));
  };

  for (const st of streams) {
    const s = st.toString('latin1');
    if (!s.includes('beginbf')) continue;

    for (const block of s.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
      for (const [, src, dst] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        if (!map.has(parseInt(src, 16))) map.set(parseInt(src, 16), chars(dst));
      }
    }
    for (const block of s.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
      for (const [, lo, hi, dst] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const a = parseInt(lo, 16), b = parseInt(hi, 16), base = parseInt(dst.slice(0, 4), 16);
        for (let c = a; c <= b && c - a < 1024; c++) {
          if (!map.has(c)) map.set(c, String.fromCodePoint(base + (c - a)));
        }
      }
    }
  }
  return map;
}

const ESC = { n: '\n', r: '\r', t: '\t', b: '', f: '' };
const unescape = (s) => s
  .replace(/\\([nrtbf])/g, (_, c) => ESC[c])
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
  .replace(/\\(.)/g, '$1');

/** One content stream to text, decoding through the CMap and the text matrix. */
function streamToText(s, cmap) {
  let out = '';
  let lastY = null;
  const ops = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+Td|\((?:[^()\\]|\\.)*\)\s*(?:Tj|'|")|<[0-9a-fA-F\s]+>\s*Tj|\[(?:[^\][\\]|\\.)*\]\s*TJ|\bT\*/g;

  const decode = (lit, isHex) => {
    if (isHex) {
      const h = lit.replace(/\s+/g, '');
      let s2 = '';
      for (let i = 0; i + 4 <= h.length; i += 4) s2 += cmap.get(parseInt(h.slice(i, i + 4), 16)) ?? '';
      return s2;
    }
    let s2 = '';
    for (const ch of unescape(lit)) s2 += cmap.get(ch.codePointAt(0)) ?? ch;
    return s2;
  };

  let t;
  while ((t = ops.exec(s)) !== null) {
    const frag = t[0];

    if (frag.endsWith('Tm')) {
      const y = Number(t[6]);
      if (lastY !== null && Math.abs(y - lastY) > 1) out += '\n';
      lastY = y;
      continue;
    }
    if (frag.endsWith('Td')) {
      const dy = Number(t[8]);
      if (Math.abs(dy) > 1) { out += '\n'; lastY = lastY === null ? 0 : lastY + dy; }
      else out += ' ';
      continue;
    }
    if (frag === 'T*') { out += '\n'; continue; }

    for (const lit of frag.match(/<[0-9a-fA-F\s]+>|\((?:[^()\\]|\\.)*\)/g) || []) {
      out += lit[0] === '<' ? decode(lit.slice(1, -1), true) : decode(lit.slice(1, -1), false);
    }
  }
  return out;
}

/** Fraction of bytes that look like text, used to tell content from images. */
function printable(b) {
  let n = 0;
  const lim = Math.min(b.length, 2000);
  for (let i = 0; i < lim; i++) {
    const c = b[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) n++;
  }
  return lim ? n / lim : 0;
}

export function extract(file) {
  const streams = inflateAll(fs.readFileSync(file));
  const cmap = buildCMap(streams);

  const pages = [];
  for (const st of streams) {
    if (printable(st) < 0.9) continue;
    const s = st.toString('latin1');
    if (!/\bBT\b/.test(s) || !/\bTf\b/.test(s)) continue;

    const text = streamToText(s, cmap).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 40) pages.push(text);
  }
  return { pages, cmapSize: cmap.size, streams: streams.length };
}

const [, , input, output] = process.argv;
if (!input) {
  console.error('użycie: node tools/pdftext.mjs skan.pdf [wyjscie.txt]');
  process.exit(1);
}

const { pages, cmapSize, streams } = extract(input);
if (!pages.length) {
  console.error(`Brak warstwy tekstowej (${streams} strumieni, ${cmapSize} kodów w mapie).`);
  console.error('Skan bez OCR trzeba najpierw przepuścić przez rozpoznawanie tekstu.');
  process.exit(2);
}

const body = pages.map((p, i) => `===== STRONA ${i + 1} =====\n${p}`).join('\n\n');
if (output) {
  fs.writeFileSync(output, body, 'utf8');
  console.log(`${pages.length} stron, ${cmapSize} kodów w mapie znaków -> ${output}`);
} else {
  process.stdout.write(body);
}
