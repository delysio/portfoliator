// The EPROM card page: banks of files in, one image for the programmer out.
//
// Everything the image is made of lives in js/eprom/epr.js; this file only
// holds the banks the user is assembling, turns files dropped or picked in the
// browser into the tree that module builds from, and draws it.

import {
  BANK_SIZE, EPROM_TYPES, shortName, cleanLabel, dosStamp, fromDosStamp,
  bankUsage, buildBank, joinBanks, readBank, splitBanks,
} from './epr.js';
import { t, getLanguage, setLanguage, initLanguage, onLanguageChange } from '../ui/i18n.js';
import { confirmModal } from '../ui/confirm.js';
import { isoDateTime, formatNumber } from '../ui/format.js';

initLanguage();

const els = {
  type: document.getElementById('eprom-type'),
  open: document.getElementById('eprom-open'),
  save: document.getElementById('eprom-save'),
  status: document.getElementById('eprom-status'),
  banks: document.getElementById('banks'),
  template: document.getElementById('bank-template'),
  langPl: document.getElementById('lang-pl'),
  langEn: document.getElementById('lang-en'),
};

/** Each bank: { label, items }, items being the tree epr.js builds from. */
let banks = [];

/** The DOM of each bank, rebuilt only when the number of banks changes. */
let views = [];

// ---- status line ------------------------------------------------------------

// Kept as a function, not a string, so a switch of language can say it again
// in the new one.
let lastSay = null;

function say(fn, kind = '') {
  lastSay = fn ? { fn, kind } : null;
  drawStatus();
}

function drawStatus() {
  els.status.textContent = lastSay ? lastSay.fn() : '';
  els.status.className = ['hint', lastSay && lastSay.kind].filter(Boolean).join(' ');
}

// ---- the tree ---------------------------------------------------------------

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The child of `list` that stands for `original`, matched the way DOS would see it. */
function findChild(list, original) {
  const up = original.toUpperCase();
  return list.find((n) => (n.orig || n.name).toUpperCase() === up);
}

function makeNode(list, original, props) {
  const taken = new Set(list.map((n) => n.name));
  const { name, changed } = shortName(original, taken);
  const node = { name, orig: changed ? original : null, ...props };
  list.push(node);
  list.sort(byName);
  return node;
}

/** A directory gets the time of the newest thing inside it, or now if it is empty. */
function stampDirs(list) {
  let newest = null;
  for (const node of list) {
    if (node.dir) {
      const inner = stampDirs(node.children);
      const s = inner || dosStamp(new Date());
      node.date = s.date;
      node.time = s.time;
    }
    const mine = { date: node.date, time: node.time };
    if (!newest || mine.date > newest.date || (mine.date === newest.date && mine.time > newest.time)) {
      newest = mine;
    }
  }
  return newest;
}

/**
 * Puts files into a bank's tree. `entries` are { path, file } with `path` the
 * name relative to the bank's root, folders separated by "/". A file that is
 * already there under the same name is replaced.
 */
async function addEntries(bank, entries) {
  let added = 0;
  for (const { path, file } of entries) {
    const parts = path.split('/').filter(Boolean);
    const leaf = parts.pop();
    let list = bank.items;
    for (const dir of parts) {
      let node = findChild(list, dir);
      if (!node || !node.dir) node = makeNode(list, dir, { dir: true, children: [] });
      list = node.children;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const { date, time } = dosStamp(new Date(file.lastModified || Date.now()));
    const old = findChild(list, leaf);
    if (old && !old.dir) list.splice(list.indexOf(old), 1);
    makeNode(list, leaf, { dir: false, data, date, time });
    added++;
  }
  stampDirs(bank.items);
  return added;
}

/** Walks a dropped folder; the browser hands these out in batches. */
function readDropped(entry, prefix, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => { out.push({ path: prefix + file.name, file }); resolve(); }, () => resolve());
      return;
    }
    const reader = entry.createReader();
    const batch = () => reader.readEntries(async (list) => {
      if (!list.length) { resolve(); return; }
      for (const e of list) await readDropped(e, `${prefix}${entry.name}/`, out);
      batch();
    }, () => resolve());
    batch();
  });
}

function removeNode(list, node) {
  const i = list.indexOf(node);
  if (i >= 0) list.splice(i, 1);
}

// ---- banks ------------------------------------------------------------------

function emptyBank() {
  return { label: '', items: [] };
}

function bankCount() {
  return Number(els.type.value) / BANK_SIZE;
}

function typeId() {
  const size = Number(els.type.value);
  return (EPROM_TYPES.find((e) => e.size === size) || EPROM_TYPES[0]).id;
}

const hasContent = (b) => b.items.length > 0;

function fileSafe(label, fallback) {
  const s = cleanLabel(label).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return s || fallback;
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hex5(n) {
  return n.toString(16).toUpperCase().padStart(5, '0');
}

// ---- drawing ----------------------------------------------------------------

function formatStamp(node) {
  const d = fromDosStamp(node.date, node.time);
  return d ? isoDateTime(d) : '';
}

function drawRows(table, list, depth, bankIndex) {
  for (const node of list) {
    const tr = table.insertRow();

    const name = tr.insertCell();
    name.style.paddingLeft = `${0.4 + depth * 1.2}rem`;
    name.textContent = node.dir ? `${node.name}\\` : node.name;
    if (node.orig) {
      const orig = document.createElement('small');
      orig.className = 'orig';
      orig.textContent = node.orig;
      name.append(' ', orig);
    }

    const size = tr.insertCell();
    size.className = 'num';
    size.textContent = node.dir ? t('<katalog>') : formatNumber(node.data.length);

    const when = tr.insertCell();
    when.className = 'num';
    when.textContent = formatStamp(node);

    const act = tr.insertCell();
    act.className = 'act';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '×';
    del.title = node.dir ? t('Usuń katalog z zawartością') : t('Usuń plik');
    del.addEventListener('click', () => {
      removeNode(list, node);
      stampDirs(banks[bankIndex].items);
      drawBank(bankIndex);
    });
    act.append(del);

    if (node.dir) drawRows(table, node.children, depth + 1, bankIndex);
  }
}

function drawBank(i) {
  const bank = banks[i];
  const v = views[i];

  v.title.textContent = t('Bank {0}', i + 1);
  v.range.textContent = `${hex5(i * BANK_SIZE)}h–${hex5((i + 1) * BANK_SIZE - 1)}h`;
  if (document.activeElement !== v.label) v.label.value = bank.label;

  v.list.replaceChildren();
  drawRows(v.list, bank.items, 0, i);
  v.empty.hidden = hasContent(bank);
  v.list.hidden = !hasContent(bank);

  const u = bankUsage(bank.items);
  const share = Math.min(1, u.used / u.capacity);
  v.bar.style.width = `${(share * 100).toFixed(1)}%`;
  v.bar.classList.toggle('aborted', !u.fits);
  v.usage.textContent = t('Zajęte {0} z {1} KB · katalog główny: {2} z {3} pozycji',
                          u.used, u.capacity, u.rootEntries - 1, u.rootCapacity - 1);
  v.usage.className = u.fits ? 'hint bank-usage' : 'hint warn bank-usage';
  if (!u.fits) {
    v.usage.textContent += ' — ' + (u.rootFits
      ? t('nie zmieści się, usuń coś z tego banku.')
      : t('za dużo pozycji w katalogu głównym, przenieś część do podkatalogu.'));
  }
}

function drawAll() {
  banks.forEach((b, i) => drawBank(i));
  drawStatus();
}

function buildViews() {
  els.banks.replaceChildren();
  views = banks.map((bank, i) => {
    const root = els.template.content.firstElementChild.cloneNode(true);
    const q = (sel) => root.querySelector(sel);
    const v = {
      root,
      title: q('.bank-title'),
      range: q('.bank-range'),
      label: q('.bank-label'),
      drop: q('.bank-drop'),
      files: q('.bank-files'),
      folder: q('.bank-folder'),
      list: q('.bank-list'),
      empty: q('.bank-empty'),
      bar: q('.bank-bar'),
      usage: q('.bank-usage'),
      clear: q('.bank-clear'),
      download: q('.bank-download'),
    };
    wireBank(v, i);
    els.banks.append(root);
    return v;
  });
  // The clones came out of a template the language layer never saw; one pass
  // over the page translates them, and its listeners redraw the rest.
  setLanguage(getLanguage(), { save: false });
}

function setBankCount(n) {
  while (banks.length < n) banks.push(emptyBank());
  banks.length = n;
  buildViews();
}

// ---- wiring -----------------------------------------------------------------

function wireBank(v, i) {
  const bank = () => banks[i];

  v.label.addEventListener('input', () => {
    bank().label = cleanLabel(v.label.value);
  });
  v.label.addEventListener('change', () => {
    v.label.value = bank().label;
  });

  v.files.addEventListener('change', async () => {
    const entries = [...v.files.files].map((file) => ({ path: file.name, file }));
    v.files.value = '';
    await add(i, entries);
  });

  v.folder.addEventListener('change', async () => {
    const files = [...v.folder.files];
    v.folder.value = '';
    if (!files.length) return;
    // webkitRelativePath starts with the folder picked; that folder is the
    // bank itself, as a whole floppy was for the ST program.
    const top = files[0].webkitRelativePath.split('/')[0];
    if (hasContent(bank()) && !await confirmModal({
      title: t('Zastąpić bank?'),
      message: t('Bank {0} nie jest pusty. Zastąpić jego zawartość katalogiem {1}?', i + 1, top),
      ok: t('Zastąp'),
    })) {
      return;
    }
    banks[i] = { label: cleanLabel(top), items: [] };
    const entries = files.map((file) => ({
      path: file.webkitRelativePath.split('/').slice(1).join('/'), file,
    }));
    await add(i, entries);
  });

  v.drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    v.drop.classList.add('over');
  });
  v.drop.addEventListener('dragleave', () => v.drop.classList.remove('over'));
  v.drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    v.drop.classList.remove('over');
    const roots = [...e.dataTransfer.items]
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean);
    const entries = [];
    if (roots.length) {
      for (const entry of roots) await readDropped(entry, '', entries);
    } else {
      for (const file of e.dataTransfer.files) entries.push({ path: file.name, file });
    }
    await add(i, entries);
  });

  v.clear.addEventListener('click', async () => {
    if (hasContent(bank()) && !await confirmModal({
      title: t('Wyczyścić bank?'),
      message: t('Usunąć wszystkie pliki z banku {0}?', i + 1),
      ok: t('Wyczyść'),
    })) return;
    banks[i] = emptyBank();
    drawBank(i);
    say(null);
  });

  v.download.addEventListener('click', () => {
    try {
      const img = buildBank(bank().items, { label: bank().label });
      downloadBytes(img, `${fileSafe(bank().label, `bank${i + 1}`)}.epr`);
      say(() => t('Bank {0} pobrany — 128 KB.', i + 1), 'ok');
    } catch (err) {
      say(() => t('Bank {0}: {1}', i + 1, err.message), 'warn');
    }
  });
}

async function add(i, entries) {
  if (!entries.length) return;
  try {
    const n = await addEntries(banks[i], entries);
    drawBank(i);
    const u = bankUsage(banks[i].items);
    say(() => t('Bank {0}: dodano plików: {1}.', i + 1, n), u.fits ? '' : 'warn');
  } catch (err) {
    drawBank(i);
    say(() => t('Bank {0}: {1}', i + 1, err.message), 'warn');
  }
}

els.type.addEventListener('change', async () => {
  const n = bankCount();
  const lost = banks.slice(n).filter(hasContent).length;
  if (lost && !await confirmModal({
    title: t('Zmienić układ?'),
    message: t('Mniejszy układ nie pomieści banków {0}–{1}. Usunąć ich zawartość?', n + 1, banks.length),
    ok: t('Zmień układ'),
  })) {
    els.type.value = String(banks.length * BANK_SIZE);
    return;
  }
  setBankCount(n);
  say(null);
});

els.save.addEventListener('click', () => {
  const images = [];
  for (let i = 0; i < banks.length; i++) {
    try {
      images.push(buildBank(banks[i].items, { label: banks[i].label }));
    } catch (err) {
      say(() => t('Bank {0}: {1}', i + 1, err.message), 'warn');
      return;
    }
  }
  const empty = banks.filter((b) => !hasContent(b)).length;
  downloadBytes(joinBanks(images), `eprom-${typeId().toLowerCase()}.epr`);
  say(() => (empty
    ? t('Obraz {0} pobrany. Puste banki ({1}) wypalą się jako puste dyski.', typeId(), empty)
    : t('Obraz {0} pobrany.', typeId())), 'ok');
});

els.open.addEventListener('change', async () => {
  const file = els.open.files[0];
  els.open.value = '';
  if (!file) return;
  try {
    const parts = splitBanks(new Uint8Array(await file.arrayBuffer()));
    const type = EPROM_TYPES.find((e) => e.size === parts.length * BANK_SIZE);
    if (!type) throw new Error(t('Plik ma {0} KB, a żaden obsługiwany układ nie ma takiej pojemności.', parts.length * 128));
    if (banks.some(hasContent) && !await confirmModal({
      title: t('Wczytać obraz?'),
      message: t('Wczytanie obrazu {0} zastąpi wszystkie banki.', file.name),
      ok: t('Wczytaj'),
    })) return;

    let unreadable = 0;
    banks = parts.map((img) => {
      try {
        const { label, items } = readBank(img);
        return { label: cleanLabel(label), items };
      } catch {
        unreadable++;
        return emptyBank();
      }
    });
    els.type.value = String(type.size);
    buildViews();
    say(() => (unreadable
      ? t('Wczytano {0}: {1} — banków bez systemu plików: {2}, zostały puste.', file.name, type.id, unreadable)
      : t('Wczytano {0}: {1}.', file.name, type.id)), unreadable ? 'warn' : 'ok');
  } catch (err) {
    say(() => err.message, 'warn');
  }
});

// The same switch as on the emulator page, and the choice is shared with it.
function markLanguage(lang) {
  for (const [code, button] of [['pl', els.langPl], ['en', els.langEn]]) {
    button.classList.toggle('active', code === lang);
    button.setAttribute('aria-pressed', String(code === lang));
  }
}
for (const [code, button] of [['pl', els.langPl], ['en', els.langEn]]) {
  button.addEventListener('click', () => { setLanguage(code); markLanguage(code); });
}
markLanguage(getLanguage());

onLanguageChange(drawAll);
setBankCount(bankCount());
