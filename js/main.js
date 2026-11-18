// Main thread: ROM loading, canvas output, keyboard capture and persistence.
// All emulation happens in js/emu/worker.js.

import { disasmRange } from './emu/disasm.js';
import * as storage from './ui/storage.js';
import * as fat from './ui/fat12.js';
import * as roms from './ui/roms.js';
import { AudioOutput } from './ui/audio.js';
import { readPermdata } from './ui/permdata.js';
import { HostKeyboard } from './ui/hostkeys.js';
import { makeGrid, paint } from './ui/lcdgrid.js';
import {
  LCD_LEVELS, CONTRAST_DEFAULT, buildRamp,
} from './ui/lcdramp.js';
import { t, getLanguage, setLanguage, initLanguage, onLanguageChange } from './ui/i18n.js';
import { SerialHub } from './ui/serial.js';
import { encode as encodeState, decode as decodeState, nazwaPliku } from './ui/statefile.js';
import { confirmModal, noticeModal } from './ui/confirm.js';
import { isoDate, isoDateTime, fileStamp, formatNumber } from './ui/format.js';
import { padCardImage, romSignature } from './ui/cardimage.js';
import { ScreenRecorder, FRAMES, recordingLayout, recordingSupported, formatElapsed } from './ui/recorder.js';

const SCREEN_W = 240;
const SCREEN_H = 64;

// THE GLASS IS TALLER THAN THE PICTURE. On a real Portfolio one character row of
// dots sits above the driven area and one below it - they are part of the panel
// and carry the same lattice, they are simply never lit. The controller drives
// 64 rows; the glass shows 80.
//
// Those rows are painted here rather than left to the artwork, so that they get
// the same dot grid, the same contrast ramp and the same panel inertia as the
// rest of the screen. Anything else would show a seam the moment the contrast
// register moved.
const BLANK_ROWS = 8;                          // one character row, top and bottom
const PANEL_H = SCREEN_H + 2 * BLANK_ROWS;     // 80 rows of glass
const PANEL_OFF = BLANK_ROWS * SCREEN_W;       // where the driven area starts

// Case artwork, one asset per zoom level. These are separately drawn rather
// than scaled copies - the heights are 180/358/537/715 and the origins are not
// exact multiples - so every entry carries its own measured geometry.
//
//   w, h  artwork size
//   x     left edge of the PICTURE - there are no blank columns, only blank rows
//   y     top edge of the GLASS, which is BLANK_ROWS * s above the picture
//   mul   integer upscale applied to the artwork, kept for levels without their own
//
// The two coordinates deliberately mean different things, because the canvas
// starts at the top of the glass: its top-left is (x, y) and the picture then
// lands at y + BLANK_ROWS * s on its own. At 1x that puts it at 109, 63.
//
// The glass in the artwork is a little larger than the canvas - a pixel or
// several at the sides, a row below at 3x - so it is painted in LCD_OFF from
// js/ui/lcdramp.js. In any other shade that margin shows as a band.
const SHELLS = {
  1: { image: 'gfx/portfoliator.png',    w: 407,  h: 180, x: 109, y: 55,  mul: 1 },
  2: { image: 'gfx/portfoliator-2x.png', w: 814,  h: 358, x: 217, y: 110, mul: 1 },
  3: { image: 'gfx/portfoliator-3x.png', w: 1221, h: 537, x: 326, y: 165, mul: 1 },
  4: { image: 'gfx/portfoliator-4x.png', w: 1628, h: 715, x: 436, y: 220, mul: 1 },
};

/** Cache-busting stamp set by js/boot.js; empty when loaded some other way. */
function versionQuery() {
  return window.APP_VERSION ? `?ver=${window.APP_VERSION}` : '';
}

// The status bar carries one label the power-off reporting owns. Whether it is
// currently up is tracked here rather than by comparing the text on screen,
// which would stop working the moment that text can be translated.
let poweredOffLabelUp = false;
// The same, for the inspector: a machine stopped at a breakpoint says so in
// the status bar, and the label has to come down when it runs on again.
let pausedLabelUp = false;


const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });

// Fed from repaint(), so it sees every picture the panel shows and nothing else.
const recorder = new ScreenRecorder(canvas);

// The backing store is measured in device pixels, not emulated ones, and how
// many of them a dot gets is what buildGrid() works out; until it has run there
// is nothing here to draw into.
let imageData = null;
let pix32 = null;

// The whole off-to-on ramp, packed once and blitted from. Rebuilt whenever the
// contrast register moves, which is rarely - a keypress at most - so the cost
// never lands in the frame loop.
const LCD_RAMP = new Uint32Array(LCD_LEVELS);
let contrastLevel = -1;

/** Rebuilds the palette when, and only when, the register has actually moved. */
function setContrast(contrast) {
  if (contrast === contrastLevel) return;
  contrastLevel = contrast;
  buildRamp(contrast, LCD_RAMP);
  // Every pixel now wants a different colour although not one of them moved,
  // and the painter skips panels where nothing moved.
  redrawPending = true;
}

buildRamp(CONTRAST_DEFAULT, LCD_RAMP);

const els = {
  status: document.getElementById('status'),
  speed: document.getElementById('speed'),
  printBytes: document.getElementById('print-bytes'),
  cardInfo: document.getElementById('card-info'),
  cardFiles: document.getElementById('card-files'),
  cardFile: document.getElementById('card-file'),
  cardAdd: document.getElementById('card-add'),
  cardSize: document.getElementById('card-size'),
  cardWarn: document.getElementById('card-warn'),
  cardWritable: document.getElementById('opt-card-rw'),

  hpc104: document.getElementById('opt-hpc104'),
  stateMsg: document.getElementById('state-msg'),
  stateFile: document.getElementById('state-file'),
  hpc104Panel: document.getElementById('hpc104-panel'),
  cardBInfo: document.getElementById('cardb-info'),
  cardBFiles: document.getElementById('cardb-files'),
  cardBFile: document.getElementById('cardb-file'),
  cardBAdd: document.getElementById('cardb-add'),
  cardBSize: document.getElementById('cardb-size'),
  cardBWarn: document.getElementById('cardb-warn'),
  cardBWritable: document.getElementById('opt-cardb-rw'),
  parallel: document.getElementById('opt-parallel'),
  parallelPanel: document.getElementById('parallel-panel'),
  linkFile: document.getElementById('link-file'),
  linkDest: document.getElementById('link-dest'),
  linkStatus: document.getElementById('link-status'),
  linkFiles: document.getElementById('link-files'),
  instanceNote: document.getElementById('instance-note'),
  serial: document.getElementById('opt-serial'),
  serialPanel: document.getElementById('serial-panel'),
  serialMode: document.getElementById('serial-mode'),
  serialDial: document.getElementById('serial-dial'),
  serialChannel: document.getElementById('serial-channel'),
  serialTimeout: document.getElementById('serial-timeout'),
  serialDir: document.getElementById('serial-dir'),
  serialStatus: document.getElementById('serial-status'),
  serialLine: document.getElementById('serial-line'),
  serialRx: document.getElementById('serial-rx'),
  serialTx: document.getElementById('serial-tx'),
  serialPending: document.getElementById('serial-pending'),
  serialDelayChar: document.getElementById('serial-delay-char'),
  serialDelayLine: document.getElementById('serial-delay-line'),

  sendDialog: document.getElementById('dlg-serial-send'),
  sendName: document.getElementById('send-name'),
  sendFill: document.getElementById('send-fill'),
  sendDone: document.getElementById('send-done'),
  sendTotal: document.getElementById('send-total'),
  sendPct: document.getElementById('send-pct'),
  sendEta: document.getElementById('send-eta'),
  sendNote: document.getElementById('send-note'),
  sendCancel: document.getElementById('btn-send-cancel'),
  serialTerm: document.getElementById('serial-term'),
  serialInput: document.getElementById('serial-input'),
  serialFile: document.getElementById('serial-file'),
  serialCapture: document.getElementById('btn-serial-capture'),
  romDialog: document.getElementById('dlg-rom'),
  romClose: document.getElementById('rom-close'),
  romList: document.getElementById('rom-list'),
  romFile: document.getElementById('rom-file'),
  romDrop: document.getElementById('rom-drop'),
  romStatus: document.getElementById('rom-status'),
  romUntested: document.getElementById('rom-untested'),
  romStart: document.getElementById('btn-rom-start'),
  romDir: document.getElementById('btn-rom-dir'),
  romClear: document.getElementById('btn-rom-clear'),
  romHashes: document.getElementById('rom-hashes'),

  permdataStatus: document.getElementById('permdata-status'),
  permdataTable: document.getElementById('permdata-table'),
  permdataTabs: document.getElementById('permdata-tabs'),
  permdataPanel: document.getElementById('permdata-panel'),

  audioSwitch: document.getElementById('opt-audio'),
  audioHint: document.getElementById('audio-hint'),
  audioOptions: document.getElementById('audio-options'),
  volume: document.getElementById('opt-volume'),
  timbre: document.getElementById('opt-timbre'),
  systemTick: document.getElementById('opt-systick'),
  ramRandom: document.getElementById('opt-ramrandom'),
  lcdTiming: document.getElementById('opt-lcdtiming'),
  standby: document.getElementById('opt-standby'),
  scale: document.getElementById('opt-scale'),
  inertia: document.getElementById('opt-inertia'),
  inertiaValue: document.getElementById('inertia-value'),
  rise: document.getElementById('opt-rise'),
  grid: document.getElementById('opt-grid'),
  gridValue: document.getElementById('grid-value'),
  shell: document.getElementById('shell'),

  record: document.getElementById('btn-record'),
  recordDialog: document.getElementById('dlg-record'),
  recordFrame: document.getElementById('opt-record-frame'),
  recordStart: document.getElementById('btn-record-start'),
  recordMsg: document.getElementById('record-msg'),
};

// Before anything is drawn: a reader who does not speak Polish should not have
// to watch the page in Polish first and then see it change under them.
initLanguage();

let worker = null;

// The main thread keeps its own copy of the card image so files can be added
// and extracted without stopping the emulator. The worker owns a separate copy;
// whenever DOS writes to the card the worker ships it back and we re-sync here.
let currentCard = null;

const audio = new AudioOutput();

// ---- ROM images -----------------------------------------------------------

// What the machine is running, and what the dialog is currently editing. The
// two are separate: a set being assembled in the dialog only becomes the live
// one once it is complete and the user says so.
let romSet = null;
let romDraft = {};

// Set while the dialog is holding up the boot, waiting for a complete set.
let romResolve = null;

/**
 * A one-line report that survives a change of language.
 *
 * Elements JavaScript writes into are the trap in a dictionary-based layer: on a
 * switch the static layer puts back what the HTML originally said, wiping out
 * whatever the emulator had reported since. So a report is passed in as a
 * function rather than as a finished string - the function is kept, and calling
 * it again after the switch produces the same message in the new language.
 *
 * @param {HTMLElement} el
 * @param {string} base class the element carries regardless of the message
 * @returns {(say: (() => string)|string, kind?: string) => void}
 */
function reporter(el, base = 'hint') {
  let last = null;

  const draw = () => {
    if (!last) return;
    // Once the emulator has something to say, the static layer must let go of
    // this element for good: it would otherwise put the original HTML back on
    // the next switch, wiping out the report underneath.
    el.removeAttribute('data-i18n');
    el.removeAttribute('data-i18n-html');
    el.textContent = typeof last.say === 'function' ? last.say() : last.say;
    el.className = [base, last.kind].filter(Boolean).join(' ');
  };

  onLanguageChange(draw);
  return (say, kind = '') => { last = { say, kind }; draw(); };
}

const romSay = reporter(els.romStatus);

// The status bar has no base class of its own; the kind is the whole className.
const sayStatus = reporter(els.status, '');

/** One row per required image, so a half-finished set shows what is missing. */
function renderRomList() {
  const table = els.romList;
  table.textContent = '';

  const head = document.createElement('tr');
  for (const label of [t('Plik'), t('Rozmiar'), t('Stan')]) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);

  for (const key of roms.ROLE_KEYS) {
    const spec = roms.ROLES[key];
    const entry = romDraft[key];

    const tr = document.createElement('tr');

    const described = roms.describeRole(key);
    const what = document.createElement('td');
    const strong = document.createElement('b');
    strong.textContent = described.label;
    const role = document.createElement('em');
    role.textContent = described.role;
    what.append(strong, document.createElement('br'), role);

    const size = document.createElement('td');
    size.className = 'num';
    size.textContent = `${formatBytes(spec.size)} B`;

    const state = document.createElement('td');
    if (!entry) {
      state.textContent = t('brak pliku');
    } else if (entry.tested) {
      state.className = 'ok';
      state.textContent = t('zgodny z testowaną rewizją — {0}', entry.name);
    } else {
      state.className = 'warn';
      state.textContent = t('nieznana rewizja — rozmiar i struktura się zgadzają, ' +
        'uruchomi się bez gwarancji — {0}', entry.name);
    }

    tr.append(what, size, state);
    table.append(tr);
  }

  const complete = roms.isComplete(romDraft);
  els.romStart.disabled = !complete;
  els.romUntested.hidden = !(complete && roms.hasUntested(romDraft));
}

/** The tested checksums, built from the table in roms.js so they cannot drift. */
function renderRomHashes() {
  const table = els.romHashes;
  table.textContent = '';

  const head = document.createElement('tr');
  for (const label of [t('Plik'), 'CRC32', 'SHA-256']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);

  for (const key of roms.ROLE_KEYS) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = roms.ROLES[key].file;

    const crc = document.createElement('td');
    crc.textContent = roms.TESTED[key].crc32;

    const sha = document.createElement('td');
    sha.className = 'hash';
    sha.textContent = roms.TESTED[key].sha256;

    tr.append(name, crc, sha);
    table.append(tr);
  }
}

async function addRomFiles(files) {
  const rejected = [];
  let added = 0;

  for (const file of files) {
    let entries;
    try {
      entries = await roms.identify(file);
    } catch (err) {
      rejected.push(`${file.name} (${err.message})`);
      continue;
    }

    if (entries.length === 0) {
      rejected.push(file.name);
      continue;
    }

    for (const entry of entries) {
      romDraft[entry.role] = entry;
      added++;
    }
  }

  renderRomList();

  if (rejected.length) {
    romSay(() => t('Nie rozpoznano: {0}. Sprawdź, czy to na pewno zrzut ' +
      'ROM-u Portfolio — decyduje zawartość, nie nazwa pliku.', rejected.join(', ')), 'warn');
  } else if (added) {
    romSay(roms.isComplete(romDraft)
      ? t('Komplet plików. Można uruchomić.')
      : t('Przyjęto. Brakuje jeszcze pozostałych plików.'));
  }
}

/** Hands the assembled set to whoever is waiting, or restarts the page. */
async function applyRoms() {
  if (!roms.isComplete(romDraft)) return;

  try {
    roms.assemble(romDraft);            // validated here so a bad pair never lands in storage
  } catch (err) {
    romSay(() => t('Nie da się złożyć ROM-u systemowego: {0}', err.message), 'warn');
    return;
  }

  try {
    await roms.save(romDraft);
  } catch (err) {
    // A notice rather than the dialog's status line, which is about to close
    // with the dialog. This is the private-browsing and out-of-quota path, and
    // being asked for the same four files on every visit without ever being
    // told why would be maddening.
    console.warn('ROM save failed', err);
    await noticeModal({
      title: t('Pliki ROM niezapamiętane'),
      message: t('Pliki ROM przyjęte, ale nie udało się ich zapamiętać — przeglądarka ' +
        'nie udostępnia pamięci lokalnej (np. tryb prywatny). Emulator uruchomi się ' +
        'teraz normalnie, ale przy następnej wizycie trzeba będzie wskazać je ponownie.'),
    });
  }

  els.romDialog.dataset.required = '';
  els.romClose.hidden = false;
  els.romDialog.close();

  if (romResolve) {
    const resolve = romResolve;
    romResolve = null;
    resolve(romDraft);
    return;
  }

  // The machine is already running on the old images, and the worker was handed
  // them as transferred buffers it now owns. Rebuilding that in place would mean
  // tearing down the worker and every device hanging off it; a reload is both
  // simpler and what the user expects after swapping the ROM.
  location.reload();
}

function openRomDialog({ required = false } = {}) {
  romDraft = romSet ? { ...romSet } : {};

  // A required dialog loses its close button as well as its Escape and backdrop
  // routes: the form inside it submits straight to close() and would slip past
  // both of those guards.
  els.romDialog.dataset.required = required ? '1' : '';
  els.romClose.hidden = required;

  renderRomList();
  romSay(required
    ? t('Wskaż pliki ROM, żeby uruchomić emulator.')
    : t('Wskazanie nowego pliku zastąpi ten, który jest teraz w użyciu.'));

  if (!els.romDialog.open) els.romDialog.showModal();
}

function wireRomDialog() {
  renderRomHashes();

  // Wired here rather than through data-modal: at first boot this dialog is up
  // long before wireControls() runs, and the checksums have to be reachable
  // exactly then - that is when the user is asking "is my dump the right one".
  document.getElementById('btn-rom-hashes').addEventListener('click', () => {
    document.getElementById('dlg-rom-hashes').showModal();
  });

  els.romFile.addEventListener('change', async (e) => {
    await addRomFiles([...e.target.files]);
    e.target.value = '';
  });

  // Dropping the four files straight in saves a trip through the file picker,
  // which is the slowest part of this for anyone doing it twice.
  //
  // The whole dialog is the target, not just the dashed strip - aiming at a
  // 3rem box is a needless demand. The document-wide guard underneath it is
  // what makes that safe: a file dropped anywhere else would otherwise make the
  // browser navigate to it, throwing away a running emulator to display a ROM
  // image as text. Nothing else on this page accepts a drop, so swallowing them
  // all costs nothing.
  for (const type of ['dragenter', 'dragover', 'drop']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }

  for (const type of ['dragenter', 'dragover']) {
    els.romDialog.addEventListener(type, () => els.romDrop.classList.add('over'));
  }

  for (const type of ['dragleave', 'drop']) {
    els.romDialog.addEventListener(type, () => els.romDrop.classList.remove('over'));
  }

  els.romDialog.addEventListener('drop', async (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) {
      await addRomFiles([...e.dataTransfer.files]);
    }
  });

  els.romStart.addEventListener('click', applyRoms);

  els.romDir.addEventListener('click', async () => {
    romSay(() => t('Szukam plików w katalogu rom/…'));
    const set = await roms.fromDirectory();
    if (!set) {
      romSay(() => t('W katalogu rom/ nie ma kompletu plików pod oczekiwanymi nazwami.'), 'warn');
      return;
    }
    romDraft = set;
    renderRomList();
    romSay(() => t('Wczytano z katalogu rom/.'));
  });

  els.romClear.addEventListener('click', async () => {
    if (!await confirmModal({
      title: t('Usunąć zapamiętane pliki ROM?'),
      message: t('Przy następnym uruchomieniu trzeba będzie wskazać je ponownie.'),
      ok: t('Usuń'),
    })) return;

    await roms.clear().catch((err) => console.warn('ROM clear failed', err));
    romDraft = {};
    romSet = null;
    renderRomList();
    romSay(() => t('Usunięto. Wskaż pliki albo odśwież stronę.'));
  });

  // Escape must not dismiss the dialog while it is the only thing standing
  // between the user and a blank screen.
  els.romDialog.addEventListener('cancel', (e) => {
    if (els.romDialog.dataset.required) e.preventDefault();
  });
}

/**
 * Storage first, then the rom/ directory, then the user. The directory is the
 * convenience path for local work and private deployments; on a public one it
 * simply is not there, and a miss is the normal case rather than an error.
 */
async function acquireRoms() {
  let set = await roms.fromStorage();
  let broken = false;

  if (!set) {
    set = await roms.fromDirectory();
    if (set) await roms.save(set).catch((err) => console.warn('ROM save failed', err));
  }

  if (set) {
    try {
      const images = roms.assemble(set);
      romSet = set;
      return images;
    } catch (err) {
      // A stored set that will not assemble is worse than none at all - it would
      // stop the boot with no way out short of clearing the database by hand.
      console.warn('stored ROM set unusable', err);
      set = null;
      broken = true;
    }
  }

  sayStatus(() => t('brak plików ROM'), 'warn');
  openRomDialog({ required: true });
  if (broken) romSay(() => t('Zapamiętane pliki ROM nie dają się złożyć — wskaż je ponownie.'), 'warn');

  // applyRoms() assembles before resolving, so this one cannot throw.
  romSet = await new Promise((resolve) => { romResolve = resolve; });
  return roms.assemble(romSet);
}

// ---- rendering ------------------------------------------------------------

// The Portfolio panel is a supertwist LCD, and such a cell does not flip the
// moment the controller says so - it drifts towards the new state over roughly
// a tenth of a second. That smear is what scrolling text looks like on the real
// machine, so instead of blitting the emulated bit we keep a per-pixel level
// and ease it towards that bit.
//
// Both directions are exponential, but relaxing back to clear takes longer than
// being driven to dark, so the fall gets its own, longer time constant.
const INERTIA_FALL_RATIO = 1.6;

// Below this the pixel is close enough to count as settled; snapping stops the
// tail from crawling towards the target for ever at a fraction of a step.
const INERTIA_SETTLED = 0.5 / (LCD_LEVELS - 1);

// A frame gap longer than this means the tab was hidden or the machine stalled,
// not that the panel was really smearing for that long.
const MAX_FRAME_DT = 100;

/** Rise time constant in ms; 0 turns the model off and restores a plain blit. */
let inertiaMs = 0;

// Four shapes for the way a dot reaches its new state, picked in the settings.
// The slider above stays the time scale for all of them; only the shape
// differs. They are two choices crossed:
//
//               no slow finish             long slow finish
//   hard start  0  one exponential,        1  the dot shows up at once but
//                  fastest at the instant     pale, and full ink arrives
//                  of switching               several times later
//   soft start  2  two exponentials in     3  both: nothing, then a rush,
//                  cascade - nothing for      then a long crawl to full ink
//                  a moment, then a rush
//
// Shapes 1 and 3 are 0 and 2 with part of the travel handed to a slow
// component, so the fast part is the same curve in each column. Testers with a
// real Portfolio decided to leave the choice to users;
// shape 0 is the default and the model the panel had before there was a choice.
const RISE_SLOW = 4.0;   // the slow component, as a multiple of the slider
const W_FAST = 0.55;     // how much of the travel the fast part carries
const W_SLOW = 0.45;

/** Which of the four is on the panel right now. */
let riseModel = 0;

// Per-pixel state, 0 = clear, 1 = fully dark. These span the whole GLASS, not
// just the driven area: the blank row above the picture and the one below it
// are dots like any other and are drawn through the same grid. Nothing ever
// writes to them, so they stay clear for the life of the page - which is
// exactly what an undriven row looks like.
const lcdLevel = new Float32Array(SCREEN_W * PANEL_H);

// The shapes need more state than one level per dot: a fast component, the
// second stage of the cascade and a slow component. Shape 0 uses lcdFast alone.
const lcdFast = new Float32Array(SCREEN_W * PANEL_H);
const lcdCascade = new Float32Array(SCREEN_W * PANEL_H);
const lcdSlow = new Float32Array(SCREEN_W * PANEL_H);

let lastFrameAt = 0;

// The dots themselves. A cell is one dot plus the unpowered margin around it,
// and gridGap says how much of the cell that margin takes; 0 leaves the dots
// touching, which is how the panel looked before the grid existed.
//
// The weights are geometry, so they outlive any number of frames and are only
// rebuilt when the geometry moves under them - a different zoom level,
// a different gap, or a window dragged onto a monitor the browser scales
// differently.

/** Gap between dots as a share of the pitch. Negative until first applied. */
let gridGap = -1;

/** Coverage weights for the current geometry, with the buffers they feed. */
let grid = null;

/** The device pixel ratio those weights were built for. */
let gridDpr = 0;

/**
 * Set when the panel needs repainting although no pixel moved - a new palette
 * from the contrast register, or a backing store the browser has just cleared.
 */
let redrawPending = true;

function buildGrid() {
  const s = Number(els.scale.value) || 2;
  const dpr = window.devicePixelRatio || 1;
  const cell = s * dpr;
  const gap = gridGap > 0 ? gridGap : 0;

  grid = makeGrid(SCREEN_W, PANEL_H, cell, gap);

  // The canvas keeps the CSS size the case artwork has a hole cut for, and
  // gains a backing store covering it device pixel for device pixel - which is
  // the whole point, because a lattice drawn any coarser than the screen it
  // lands on would sit on some rows of dots and miss others.
  canvas.width = grid.width;
  canvas.height = grid.height;

  imageData = ctx.createImageData(grid.width, grid.height);
  pix32 = new Uint32Array(imageData.data.buffer);

  gridDpr = dpr;

  // Setting canvas.width wiped what was there, and waiting for the next frame
  // to fill it back in would not do: a machine stopped at a breakpoint sends no
  // frames at all, so changing the scale would blank the panel until it ran
  // again. The levels are still in hand, so put them straight back.
  repaint();
}

/** The levels as they stand, on the canvas, without advancing anything. */
function repaint() {
  paint(grid, lcdLevel, LCD_RAMP, pix32);
  ctx.putImageData(imageData, 0, 0);
  redrawPending = false;
  if (recorder.active) recorder.frame();
}

function drawFrame(pixels) {
  const now = performance.now();
  const dt = lastFrameAt ? Math.min(now - lastFrameAt, MAX_FRAME_DT) : 0;
  lastFrameAt = now;

  // A window dragged onto a monitor the browser scales differently changes the
  // pitch underfoot, and does it without firing anything worth wiring up for.
  if (grid === null || gridDpr !== (window.devicePixelRatio || 1)) buildGrid();

  let moved = false;

  if (inertiaMs > 0 && dt > 0) {
    // One frame's worth of every time constant the four shapes use.
    const stepFor = (tau) => 1 - Math.exp(-dt / tau);
    const F = INERTIA_FALL_RATIO;
    const mainUp = stepFor(inertiaMs), mainDown = stepFor(inertiaMs * F);
    const slowUp = stepFor(inertiaMs * RISE_SLOW), slowDown = stepFor(inertiaMs * RISE_SLOW * F);

    // Close enough counts as arrived, or the tail crawls for ever at a
    // fraction of a step - and with two components there are two such tails.
    const approach = (v, target, k) => {
      const n = v + (target - v) * k;
      return Math.abs(target - n) < INERTIA_SETTLED ? target : n;
    };

    // `pixels` is the driven area alone, so every index is shifted past the
    // blank row at the top of the glass.
    for (let i = 0; i < pixels.length; i++) {
      const j = PANEL_OFF + i;
      const target = pixels[i] ? 1 : 0;
      const kMain = target ? mainUp : mainDown;
      const kSlow = target ? slowUp : slowDown;
      let level;

      if (riseModel === 1) {
        const fast = lcdFast[j] = approach(lcdFast[j], target, kMain);
        const slow = lcdSlow[j] = approach(lcdSlow[j], target, kSlow);
        level = W_FAST * fast + W_SLOW * slow;
      } else if (riseModel === 2) {
        const fast = lcdFast[j] = approach(lcdFast[j], target, kMain);
        level = lcdCascade[j] = approach(lcdCascade[j], fast, kMain);
      } else if (riseModel === 3) {
        const fast = lcdFast[j] = approach(lcdFast[j], target, kMain);
        const cascade = lcdCascade[j] = approach(lcdCascade[j], fast, kMain);
        const slow = lcdSlow[j] = approach(lcdSlow[j], target, kSlow);
        level = W_FAST * cascade + W_SLOW * slow;
      } else {
        level = lcdFast[j] = approach(lcdFast[j], target, kMain);
      }

      if (lcdLevel[j] !== level) {
        lcdLevel[j] = level;
        moved = true;
      }
    }
  } else {
    for (let i = 0; i < pixels.length; i++) {
      const j = PANEL_OFF + i;
      const target = pixels[i] ? 1 : 0;
      if (lcdLevel[j] !== target) {
        lcdLevel[j] = target;
        moved = true;
      }
      // Keep the components with the panel, so turning the model back on picks
      // up where the picture is instead of flashing.
      lcdFast[j] = lcdCascade[j] = lcdSlow[j] = target;
    }
  }

  // A panel where nothing settled and nothing moved is the panel already on
  // screen. Leaving it alone is what makes a still picture cost nothing, and
  // a still picture is what a Portfolio shows most of the time.
  if (!moved && !redrawPending) return;

  repaint();
}

function applyInertia() {
  inertiaMs = Number(els.inertia.value) || 0;
  els.inertiaValue.textContent = inertiaMs ? `${inertiaMs} ms` : t('wyłączona');
}

/** Which rise shape the panel uses, switched live. */
function applyRise() {
  riseModel = Number(els.rise.value) || 0;

  // Hand the new shape the panel as it stands. Every model composes its level
  // from components that agree when they all sit on the visible level, so this
  // swaps the curve without the picture jumping.
  lcdFast.set(lcdLevel);
  lcdCascade.set(lcdLevel);
  lcdSlow.set(lcdLevel);
}

function applyGrid() {
  const gap = (Number(els.grid.value) || 0) / 100;
  els.gridValue.textContent = gap ? `${Math.round(gap * 100)}%` : t('wyłączona');

  // Also the path a change of language takes, and that one moves no geometry.
  if (gap === gridGap) return;
  gridGap = gap;
  buildGrid();
}

function applyScale() {
  // The physical panel is roughly 3.6:1 against a 240x64 (3.75:1) bitmap, so
  // the pixels are square - no aspect correction, unlike the Portfolio 2.
  const s = Number(els.scale.value) || 2;
  const shell = SHELLS[s] || SHELLS[2];
  const m = shell.mul;

  els.shell.style.backgroundImage = `url('${shell.image}${versionQuery()}')`;
  els.shell.style.width = `${shell.w * m}px`;
  els.shell.style.height = `${shell.h * m}px`;

  canvas.style.left = `${shell.x * m}px`;
  canvas.style.top = `${shell.y * m}px`;
  canvas.style.width = `${SCREEN_W * s}px`;
  canvas.style.height = `${PANEL_H * s}px`;

  // The CSS size settles how much room a dot has, so the backing store has to
  // be re-cut to match it.
  buildGrid();
}

// ---- keyboard -------------------------------------------------------------

// Browser keys the emulator claims for itself rather than passing through.
const HOST_KEYS = new Set(['F5', 'F11', 'F12']);

// While a modal is open the keyboard belongs to the dialog, not the emulator -
// otherwise Escape would be swallowed and typing would leak into DIP-DOS.
//
// The inspector is the exception. It is there to watch the machine work, and a
// machine at the prompt does nothing at all - it sits on HLT in the BIOS wait loop
// and touches no port - until a key arrives. So with the inspector open the keys
// still go to the Portfolio, except Escape, which closes the window, and except
// while the cursor stands in one of its text fields.
function modalOpen() {
  const open = document.querySelector('dialog[open]');
  if (!open) return false;
  if (open.id !== 'dlg-inspect') return true;
  const el = document.activeElement;
  return !!(el && el.matches('input:not([type=checkbox]):not([type=radio]), select, textarea'));
}

function keyForDialog(e) {
  return modalOpen() || (e.key === 'Escape' && document.querySelector('dialog[open]') !== null);
}

// The browser's keyboard, with the modifiers reconciled from their flags - see
// js/ui/hostkeys.js for why that is not the same as trusting the key events.
const hostKeys = new HostKeyboard((type, scancode) =>
  worker.postMessage({ type, scancode }));

function onKeyDown(e) {
  if (HOST_KEYS.has(e.key) || keyForDialog(e)) return;

  if (hostKeys.scancode(e) === undefined) return;

  e.preventDefault();
  hostKeys.down(e);
}

function onKeyUp(e) {
  if (keyForDialog(e)) return;

  if (hostKeys.scancode(e) === undefined) return;
  e.preventDefault();
  hostKeys.up(e);
}

// ---- persistence ----------------------------------------------------------

function saveNvram(data) {
  storage.put('nvram', data).catch((err) => console.warn('NVRAM save failed', err));
}

function saveCard(key, data) {
  storage.put(key, data).catch((err) => console.warn('Card save failed', err));
}

/**
 * Hardware fitted to the expansion port, remembered across reloads. Without
 * this a page refresh would leave a card sitting in slot B with no board to
 * hold it, and drive B: would quietly disappear.
 */
function saveSettings() {
  storage.put('settings', {
    hpc104: els.hpc104.checked,
    parallel: els.parallel.checked,
    serial: els.serial.checked,
    inertia: Number(els.inertia.value),
    rise: els.rise.value,
    grid: Number(els.grid.value),
    standby: Number(els.standby.value),
    clock: els.systemTick.checked,
    ramRandom: els.ramRandom.checked,
    lcdTiming: els.lcdTiming.value,
    txDelayChar: Number(els.serialDelayChar.value),
    txDelayLine: Number(els.serialDelayLine.value),
  }).catch((err) => console.warn('Settings save failed', err));
}

// Output level is a property of this browser on this machine, not of the
// emulated Portfolio: it says how loud the speakers are, so every tab should
// open where the last one was left. Hence localStorage - shared across tabs and
// readable synchronously - rather than the per-instance settings blob above.
const VOLUME_KEY = 'portfoliator.volume';

/** @returns {number|null} the remembered level, 0-100, or null if there is none */
function loadVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
  } catch {
    return null;                  // storage can be blocked outright by settings
  }
}

function saveVolume(v) {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* nothing to do - the session simply will not be remembered */
  }
}

// ---- printing -------------------------------------------------------------

function downloadBlob(bytes, filename, mime) {
  downloadFile(new Blob([bytes], { type: mime }), filename);
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // A minute rather than a moment: a recording runs to hundreds of megabytes,
  // and the browser may still be reading it when a short timer would fire.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** The moment, for the name of a file being downloaded. */
function stamp() {
  return fileStamp(new Date());
}

// ---- recording ------------------------------------------------------------

const RECORD_FRAME_KEY = 'portfoliator.recordFrame';

const recordSay = reporter(els.recordMsg);

/** Ticks the elapsed time on the toolbar button while a recording runs. */
let recordTimer = 0;

/** Set between the Stop click and the file being ready. */
let recordStopping = false;

function loadRecordFrame() {
  try {
    const raw = localStorage.getItem(RECORD_FRAME_KEY);
    return FRAMES.includes(raw) ? raw : 'case';
  } catch {
    return 'case';
  }
}

function saveRecordFrame(frame) {
  try {
    localStorage.setItem(RECORD_FRAME_KEY, frame);
  } catch {
    /* the choice simply will not be remembered */
  }
}

/** The case artwork as an image the recording can draw, rather than a CSS background. */
function loadShellImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

/**
 * The toolbar button doubles as the stop control, so while a recording runs it
 * shows the time and takes the click that ends it. Written from here on every
 * change of language, because the static layer would put "Nagrywanie" back.
 */
function showRecordButton() {
  const button = els.record;
  button.removeAttribute('data-i18n');
  button.classList.toggle('recording', recorder.active);
  button.disabled = recordStopping;
  button.textContent = recorder.active
    ? t('Zakończ nagrywanie ({0})', formatElapsed(recorder.elapsed))
    : t('Nagrywanie');
}

/** Leaving the page mid-recording would throw the recording away, so ask first. */
function holdWhileRecording(e) {
  e.preventDefault();
  e.returnValue = '';
}

async function startRecording() {
  if (recorder.active) return;
  const frame = els.recordFrame.value === 'screen' ? 'screen' : 'case';

  // A recording always carries a sound track, so that switching sound on
  // halfway through is heard in the file too - a track cannot be added to a
  // running recording. With the switch off the track exists but stays silent.
  // Started first, while the click still counts as the gesture audio needs.
  if (!els.audioSwitch.checked) audio.setMuted(true);
  await audio.start();
  const audioStream = audio.captureStream();

  const s = Number(els.scale.value) || 2;
  const shell = SHELLS[s] || SHELLS[2];
  let shellImage = null;
  if (frame === 'case') {
    try {
      shellImage = await loadShellImage(`${shell.image}${versionQuery()}`);
    } catch {
      audio.releaseStream();
      recordSay(() => t('Nie udało się wczytać grafiki obudowy.'), 'err');
      return;
    }
  }

  const layout = recordingLayout({
    frame, shell, dpr: window.devicePixelRatio || 1,
    screenW: canvas.width, screenH: canvas.height,
  });

  try {
    recorder.start({
      layout, shellImage, audioStream,
      // The artwork has rounded corners; outside them the page shows through.
      background: getComputedStyle(document.body).backgroundColor,
    });
  } catch (err) {
    audio.releaseStream();
    recordSay(() => t('Nagrywanie nie ruszyło: {0}', err.message), 'err');
    return;
  }

  // The layout is fixed for the length of the file; a new zoom would need
  // a different one.
  els.scale.disabled = true;
  recordSay('');
  els.recordDialog.close();
  // Focus returns to the toolbar button when the dialog closes, and a button
  // with focus is one Space away from ending the recording.
  els.record.blur();
  recordTimer = setInterval(showRecordButton, 1000);
  showRecordButton();
  window.addEventListener('beforeunload', holdWhileRecording);
}

async function stopRecording() {
  if (!recorder.active || recordStopping) return;
  recordStopping = true;
  clearInterval(recordTimer);
  showRecordButton();

  const { blob, extension } = await recorder.stop();
  audio.releaseStream();
  window.removeEventListener('beforeunload', holdWhileRecording);
  els.scale.disabled = false;
  recordStopping = false;
  showRecordButton();
  els.record.blur();

  if (!blob.size) {
    noticeModal({ title: t('Nagrywanie'), message: t('Nagranie wyszło puste — przeglądarka nie oddała żadnych danych.') });
    return;
  }
  downloadFile(blob, `portfolio-${stamp()}.${extension}`);
}

function wireRecorder() {
  els.recordFrame.value = loadRecordFrame();
  els.recordFrame.addEventListener('change', () => saveRecordFrame(els.recordFrame.value));

  els.record.addEventListener('click', () => {
    if (recorder.active) {
      stopRecording();
      return;
    }
    // The same courtesy as every other dialog: let go of held keys first.
    if (worker) worker.postMessage({ type: 'blur' });
    hostKeys.forget();

    const supported = recordingSupported();
    els.recordStart.disabled = !supported;
    if (!supported) recordSay(() => t('Ta przeglądarka nie potrafi nagrywać obrazu ze strony.'), 'warn');
    els.recordDialog.showModal();
  });

  els.recordStart.addEventListener('click', startRecording);
}

// ---- memory card ----------------------------------------------------------

function formatBytes(n) {
  return formatNumber(n);
}

/**
 * The two card slots behave identically apart from which drive they become and
 * which worker messages and storage keys they use, so one description drives
 * both. Slot A is the built-in connector; slot B only exists while an HPC-104
 * is fitted.
 */
const SLOTS = {
  A: {
    drive: 'A:',
    storageKey: 'cardA',
    insertMsg: 'insertCard',
    ejectMsg: 'ejectCard',
    image: null,
    gen: 0,
    el: (name) => els[`card${name}`],
  },
  B: {
    drive: 'B:',
    storageKey: 'cardB',
    insertMsg: 'insertCardB',
    ejectMsg: 'ejectCardB',
    image: null,
    gen: 0,
    el: (name) => els[`cardB${name}`],
  },
};

function slotWritable(slot) {
  const box = slot.el('Writable');
  return box ? box.checked : true;
}

/** Installs an image in a slot: worker, storage and UI all follow. */
function setCard(slot, image, { reinsert = true, warn = false } = {}) {
  slot.image = image;
  if (slot === SLOTS.A) currentCard = image;

  if (reinsert) {
    // The worker gets a copy; ours stays authoritative until DOS writes back.
    // The number stamped here comes back on every card the worker hands over,
    // so a copy of the previous occupant still in flight can be recognised.
    slot.gen++;
    worker.postMessage({
      type: slot.insertMsg,
      data: image.slice(),
      writable: slotWritable(slot),
      gen: slot.gen,
    });
    saveCard(slot.storageKey, image);
  }

  if (warn) slot.el('Warn').hidden = false;
  refreshCardUI(slot);
}

/** A stored card image at its card size, written back when it had to grow. */
function padStoredCard(key, image) {
  if (!image) return image;
  const { image: padded, padded: grew } = padCardImage(image);
  if (grew) saveCard(key, padded);
  return padded;
}

function refreshCardUI(slot) {
  const table = slot.el('Files');
  const info = slot.el('Info');
  if (!table || !info) return;

  table.textContent = '';

  if (!slot.image) {
    info.textContent = t('Brak karty.');
    return;
  }

  const kb = formatNumber(slot.image.length / 1024);

  let entries;
  try {
    entries = fat.listFiles(slot.image);
    info.textContent = t('Karta {0} KB — {1} plik(ów), wolne {2} z {3} B',
      kb, entries.length,
      formatBytes(fat.freeSpace(slot.image)), formatBytes(fat.totalSpace(slot.image)));
  } catch (err) {
    // No file system is no fault when the card is a ROM extension: the BIOS
    // runs it from its first bytes, and that is all it is for.
    const signature = romSignature(slot.image);
    info.textContent = signature
      ? t('Karta {0} KB — rozszerzenie ROM ({1}), bez systemu plików', kb, signature)
      : t('Karta {0} KB — nierozpoznany format ({1})', kb, err.message);
    return;
  }

  if (entries.length === 0) return;

  const head = document.createElement('tr');
  for (const label of [t('Plik'), t('Rozmiar'), t('Data'), '']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);

  for (const entry of entries) {
    if (entry.isVolume) continue;

    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = entry.name;

    const size = document.createElement('td');
    size.className = 'num';
    size.textContent = entry.isDirectory ? '<DIR>' : formatBytes(entry.size);

    const when = document.createElement('td');
    const d = fat.unpackDate(entry.date, entry.time);
    when.textContent = d ? isoDate(d) : '';

    const actions = document.createElement('td');
    actions.className = 'act';

    if (!entry.isDirectory) {
      const get = document.createElement('button');
      get.textContent = t('pobierz');
      get.addEventListener('click', () => {
        const data = fat.readFile(slot.image, entry.name);
        if (data) downloadBlob(data, entry.name, 'application/octet-stream');
      });

      const del = document.createElement('button');
      del.textContent = t('usuń');
      del.addEventListener('click', async () => {
        if (!await confirmModal({
          title: t('Usunąć {0} z karty {1}?', entry.name, slot.drive),
          message: t('Tego nie da się cofnąć.'),
          ok: t('Usuń'),
        })) return;
        // The card may have been swapped or written to while the question was up.
        if (!slot.image) return;
        fat.deleteFile(slot.image, entry.name);
        setCard(slot, slot.image, { warn: true });
      });

      actions.append(get, del);
    }

    tr.append(name, size, when, actions);
    table.append(tr);
  }
}

async function addFilesToCard(slot, files) {
  if (!slot.image) {
    await noticeModal({
      title: t('Brak karty'),
      message: t('Najpierw utwórz albo wgraj kartę w slocie {0}.', slot.drive),
    });
    return;
  }

  const added = [];
  for (const file of files) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      added.push(fat.addFile(slot.image, file.name, data, new Date(file.lastModified)));
    } catch (err) {
      // Shown once what did go in is on the card, so the list behind the notice
      // is already the true one.
      if (added.length) setCard(slot, slot.image, { warn: true });
      await noticeModal({
        title: t('Nie dodano pliku'),
        message: t('Nie udało się dodać "{0}": {1}', file.name, err.message),
      });
      return;
    }
  }

  if (added.length) setCard(slot, slot.image, { warn: true });
}

// ---- file transfer over the parallel link ---------------------------------

// The link carries one exchange at a time, so files go out one after another.
let linkQueue = [];
let linkPending = null;

/**
 * Translates a reason the worker sent up.
 *
 * The worker and the link protocol run where there is no DOM and no language to
 * speak of, so they report in Polish and the translation happens here. Every
 * message is written out as a literal t(…) call rather than t(msg.why), because
 * tools/i18n-check.mjs reads the source and cannot follow a variable - and a
 * message nobody can see is missing is a message that stays Polish forever.
 */
function linkWhy(why, args = []) {
  switch (why) {
    case 'suma kontrolna: oczekiwano 0x{0}, dostano 0x{1}':
      return t('suma kontrolna: oczekiwano 0x{0}, dostano 0x{1}', ...args);
    case 'oczekiwano 0xA5, dostano 0x{0}':
      return t('oczekiwano 0xA5, dostano 0x{0}', ...args);
    case 'Interfejs równoległy nie jest podłączony.':
      return t('Interfejs równoległy nie jest podłączony.');
    case 'Trwa już inna operacja.':
      return t('Trwa już inna operacja.');
    case 'Brak odpowiedzi. Czy Portfolio jest w Setup → File transfer → Server?':
      return t('Brak odpowiedzi. Czy Portfolio jest w Setup → File transfer → Server?');
    case 'nie udało się zsynchronizować z Portfolio':
      return t('nie udało się zsynchronizować z Portfolio');
    case 'Portfolio nie zgłosiło gotowości':
      return t('Portfolio nie zgłosiło gotowości');
    case 'plik już istnieje, nadpisanie odrzucone':
      return t('plik już istnieje, nadpisanie odrzucone');
    case 'zapis nie powiódł się (brak miejsca lub katalogu)':
      return t('zapis nie powiódł się (brak miejsca lub katalogu)');
    default:
      return why;
  }
}

const linkSay = reporter(els.linkStatus);

/** Turns a host filename into something DIP-DOS will accept. */
function toDosName(filename) {
  const base = filename.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  const clean = (s) => s.toUpperCase().replace(/[^A-Z0-9_^$~!#%&\-{}()@'`]/g, '_');
  const name = clean(dot > 0 ? base.slice(0, dot) : base).slice(0, 8) || 'PLIK';
  const ext = clean(dot > 0 ? base.slice(dot + 1) : '').slice(0, 3);
  return ext ? `${name}.${ext}` : name;
}

function linkNext() {
  if (linkPending || linkQueue.length === 0) return;

  linkPending = linkQueue.shift();
  const left = linkQueue.length;
  linkSay(left
    ? t('Wysyłanie {0} ({1} B), w kolejce jeszcze {2}…',
        linkPending.path, formatBytes(linkPending.data.length), left)
    : t('Wysyłanie {0} ({1} B)…', linkPending.path, formatBytes(linkPending.data.length)));

  worker.postMessage({
    type: 'linkSend',
    path: linkPending.path,
    data: linkPending.data,
    overwrite: true,
  });
}

async function linkSendFiles(files) {
  if (!els.parallel.checked) {
    linkSay(() => t('Najpierw podłącz interfejs równoległy i zrób Reset.'), 'warn');
    return;
  }

  let dir = els.linkDest.value.trim() || 'C:\\';
  if (!dir.endsWith('\\')) dir += '\\';

  for (const file of files) {
    linkQueue.push({
      path: dir + toDosName(file.name),
      data: new Uint8Array(await file.arrayBuffer()),
    });
  }
  linkNext();
}

function renderLinkFiles(names) {
  const table = els.linkFiles;
  table.textContent = '';
  if (!names || names.length === 0) return;

  const head = document.createElement('tr');
  const th = document.createElement('th');
  th.textContent = t('Pliki na Portfolio ({0})', names.length);
  head.append(th);
  table.append(head);

  for (const n of names) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = n;
    tr.append(td);
    table.append(tr);
  }
}

function onLinkResult(msg) {
  if (linkPending) {
    const sent = linkPending;
    linkPending = null;

    if (!msg.ok) {
      linkQueue = [];
      linkSay(() => t('Nie udało się wysłać {0}: {1}', sent.path, linkWhy(msg.why, msg.whyArgs)), 'warn');
      return;
    }

    if (linkQueue.length === 0) linkSay(() => t('Wysłano {0}.', sent.path));
    linkNext();
    return;
  }

  // Not a send, so it was a directory listing.
  if (!msg.ok) { linkSay(() => t('Błąd: {0}', linkWhy(msg.why, msg.whyArgs)), 'warn'); return; }
  renderLinkFiles(msg.names);
  linkSay(msg.names && msg.names.length
    ? t('Odczytano {0} plik(ów).', msg.names.length)
    : t('Brak pasujących plików.'));
}

// ---- expansion port -------------------------------------------------------

// One connector, one board: the HPC-101 and the HPC-102 both answer the
// peripheral-ID read at 807Fh, so they cannot be present at the same time.
/**
 * Hides the settings of an interface that is not fitted: with no board in the
 * socket there is nothing for a baud rate or a print buffer to belong to.
 */
function syncPeripheralPanels() {
  els.parallelPanel.hidden = !els.parallel.checked;
  els.serialPanel.hidden = !els.serial.checked;
}

function setPeripheral(which) {
  els.parallel.checked = which === 'parallel';
  els.serial.checked = which === 'serial';
  // Both boards share the one expansion socket, so fitting either can unfit the
  // other - which is why the panels follow from the checkboxes here, at the one
  // place that owns them, rather than from each change handler separately.
  syncPeripheralPanels();
  worker.postMessage({ type: 'setPeripheral', which });
}

// ---- serial port ----------------------------------------------------------

const serialHub = new SerialHub({
  send: (bytes) => worker.postMessage({ type: 'serialRecv', data: bytes }),
  setModem: (lines) => worker.postMessage({ type: 'serialModem', lines }),
  onUpdate: () => refreshSerialUI(),
});

let serialUpdatePending = false;
let lastSerialLine = null;

function refreshSerialUI() {
  // Bytes arrive in bursts; repaint once per frame instead of once per burst.
  if (serialUpdatePending) return;
  serialUpdatePending = true;
  requestAnimationFrame(() => {
    serialUpdatePending = false;

    const term = els.serialTerm;
    const atBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 24;
    term.textContent = serialHub.screen.toString();
    if (atBottom) term.scrollTop = term.scrollHeight;

    els.serialStatus.textContent = serialHub.statusLine;
    els.serialStatus.className = serialHub.statusKind ? `hint ${serialHub.statusKind}` : 'hint';
    els.serialRx.textContent = formatBytes(serialHub.rxBytes);
    els.serialTx.textContent = formatBytes(serialHub.txBytes);

    // Only worth showing while the pacing queue actually holds something -
    // otherwise it is noise on a line that is already three numbers long.
    const pending = serialHub.pendingBytes;
    els.serialPending.textContent = pending ? t(' · w kolejce {0} B', formatBytes(pending)) : '';

    // The hub drops a running job when the far end goes away, and the progress
    // callback never fires again - so the dialog has to notice it here.
    if (send && !send.ended && !serialHub.job) finishSend('disconnected');
    els.serialCapture.textContent = serialHub.capturing
      ? t('Zakończ zapis i pobierz') : t('Zapisuj do pliku');
  });
}

// ---- file send progress ---------------------------------------------------

// A paced transfer runs for minutes, so it gets a window of its own rather than
// a number ticking away in the panel behind. `send` is null when nothing is in
// flight; `done === total` marks a finished one still on screen.
let send = null;
let sendRepaintPending = false;

function openSendDialog(name, total) {
  send = { name, total, done: 0, started: performance.now(), ended: 0 };
  els.sendName.textContent = name;
  els.sendTotal.textContent = formatBytes(total);
  saySendNote(() => t('Bajty schodzą z kolejki w tempie ustawionym w polu '
    + '„Opóźnienie nadawania”. Przerwanie porzuca resztę — prawdziwe Portfolio '
    + 'dostanie wtedy plik ucięty w tym miejscu.'));
  showSendButton();
  els.sendFill.className = 'bar-fill';
  els.sendFill.style.width = '0';
  els.sendDialog.dataset.required = '1';   // no dismissing a transfer by accident
  if (!els.sendDialog.open) els.sendDialog.showModal();
  paintSend();
}

/**
 * The one button under the progress bar: Abort while bytes are going out, Close
 * after. Written from here, so the static layer has to let go of it - otherwise
 * a change of language would put "Abort" back under a finished transfer.
 */
function showSendButton() {
  const running = !!send && !send.ended;
  els.sendCancel.removeAttribute('data-i18n');
  els.sendCancel.textContent = running ? t('Przerwij') : t('Zamknij');
  els.sendCancel.className = running ? 'danger' : '';
}

/** Repaints at most once per frame - the queue steps up to 60 times a second. */
function paintSend() {
  if (sendRepaintPending || !send) return;
  sendRepaintPending = true;
  requestAnimationFrame(() => {
    sendRepaintPending = false;
    if (!send) return;

    const { done, total } = send;
    const pct = total ? Math.round((done / total) * 100) : 100;
    els.sendDone.textContent = formatBytes(done);
    els.sendPct.textContent = `${pct}%`;
    els.sendFill.style.width = `${pct}%`;

    // Rate measured from what has actually gone out, rather than computed from
    // the delay settings - they can be changed halfway through a transfer.
    const elapsed = (performance.now() - send.started) / 1000;
    const left = total - done;
    if (!send.ended && left > 0 && elapsed > 1 && done > 0) {
      const eta = Math.round(left / (done / elapsed));
      els.sendEta.textContent = eta > 90
        ? t(' · zostało ok. {0} min', Math.round(eta / 60))
        : t(' · zostało ok. {0} s', eta);
    } else {
      els.sendEta.textContent = '';
    }
  });
}

function finishSend(kind) {
  if (!send) return;
  send.ended = performance.now();
  delete els.sendDialog.dataset.required;
  showSendButton();

  if (kind === 'done') {
    els.sendFill.className = 'bar-fill done';
    saySendNote(() => t('Wysłane w całości. Jeśli po drugiej stronie czeka '
      + 'COPY AUX, zamknij plik przyciskiem „Znak końca pliku (Ctrl+Z)” — bez tego '
      + 'Portfolio będzie czekało na dalsze dane i zgłosi Not ready error.'));
  } else {
    els.sendFill.className = 'bar-fill aborted';
    saySendNote(kind === 'disconnected'
      ? () => t('Połączenie zostało zerwane w trakcie. Plik po drugiej stronie jest ucięty.')
      : () => t('Przerwane. Plik po drugiej stronie jest ucięty w tym miejscu.'));
  }
  paintSend();
}

function startFileSend(file, bytes) {
  openSendDialog(file.name, bytes.length);

  const ok = serialHub.sendJob(bytes, (done) => {
    if (!send) return;
    send.done = done;
    if (done >= send.total) finishSend('done');
    else paintSend();
  });

  // Refused - no backend, or a send already running. The panel says why.
  if (!ok) {
    els.sendDialog.close();
    send = null;
  }
}

/** How many 128 s clock periods without a key the BIOS may count before switching off. */
function applyStandby() {
  worker.postMessage({ type: 'setOption', standbyPeriods: Number(els.standby.value) || 0 });
}

function applySystemTick() {
  worker.postMessage({ type: 'setOption', systemTick: els.systemTick.checked });
}

/**
 * What a cold start puts in RAM. Takes effect on the next cold start, not now:
 * refilling memory under a running program would not reproduce anything, it
 * would just crash it.
 */
function applyRamFill() {
  worker.postMessage({ type: 'setOption', ramFill: els.ramRandom.checked ? 'random' : 'zero' });
}

/**
 * How faithfully the LCD controller refuses writes it cannot take. Unlike the
 * RAM fill this one bites at once - it changes what happens to the next write,
 * not what memory started as - so there is nothing to wait for.
 */
function applyLcdTiming() {
  worker.postMessage({ type: 'setOption', lcdTiming: els.lcdTiming.value });
}

function applyTxDelay() {
  serialHub.setTxDelay(Number(els.serialDelayChar.value) || 0,
                       Number(els.serialDelayLine.value) || 0);
}

/**
 * Routes bytes to whichever end the user picked: the local emulated Portfolio,
 * or out onto the cable towards whatever is on the other side.
 */
function serialDeliver(bytes, what) {
  if (els.serialDir.value === 'line') {
    if (serialHub.sendToLine(bytes)) serialHub.status(() => t('{0} → na linię ({1} B).', what, formatBytes(bytes.length)));
  } else {
    serialHub.toPortfolio(bytes);
    serialHub.status(() => t('{0} → do emulowanego Portfolio ({1} B).', what, formatBytes(bytes.length)));
  }
}

function showSerialModeOptions() {
  const mode = els.serialMode.value;
  for (const kind of ['terminal', 'webserial', 'modem', 'peer']) {
    document.getElementById(`serial-opt-${kind}`).hidden = kind !== mode;
  }
}

/** The line settings the ROM programmed, reported back by the worker. */
function updateSerialLine(info) {
  if (!info || !info.baud) {
    els.serialLine.textContent = els.serial.checked ? t('nieskonfigurowana') : '—';
    return;
  }
  const parity = { none: 'N', odd: 'O', even: 'E' }[info.parity] || 'N';
  els.serialLine.textContent =
    `${Math.round(info.baud)} ${info.bits}${parity}${info.stop}` +
    (info.dtr ? ' DTR' : '') + (info.rts ? ' RTS' : '');

  // A host port is opened at whatever the ROM had programmed at that moment.
  // Change the speed in the Portfolio's Setup afterwards and the two ends drift
  // apart silently - the symptom is garbage, not an error, so say it out loud.
  const opened = serialHub.openedBaud;
  if (opened && Math.round(info.baud) !== opened) {
    serialHub.status(
      () => t('Port sprzętowy otwarty na {0} baud, a Portfolio nadaje {1}. ' +
              'Rozłącz i podłącz ponownie, żeby zrównać prędkości.', opened, Math.round(info.baud)), 'warn');
  }
}

async function connectSerialBackend() {
  const mode = els.serialMode.value;
  const opts = {
    dialTemplate: els.serialDial.value.trim(),
    channel: els.serialChannel.value.trim(),
    baudRate: lastSerialLine && lastSerialLine.baud ? Math.round(lastSerialLine.baud) : 9600,
    dataBits: lastSerialLine ? lastSerialLine.bits : 8,
    stopBits: lastSerialLine ? lastSerialLine.stop : 1,
    parity: lastSerialLine ? lastSerialLine.parity : 'none',
  };

  try {
    await serialHub.select(mode, opts);
  } catch (err) {
    // A cancelled port picker is a user decision, not a failure worth shouting about.
    const cancelled = err && err.name === 'NotFoundError';
    serialHub.status(cancelled
      ? () => t('Nie wybrano portu.')
      : () => t('Nie udało się podłączyć: {0}', err.message),
      cancelled ? '' : 'warn');
  }
}

// ---- machine state snapshots ----------------------------------------------
//
// Three slots in the browser's database plus a file, and one rule that decides
// how the whole thing is wired: **the worker owns the state, the page only
// carries it**. Every save is a round trip - ask for a snapshot, wait for it to
// come back, then store what came - because the machine is running in another
// thread and the page has no consistent view of it to grab.
//
// `pending` is what the answer is for. One message type serves the slots and
// the file download alike, so the slot name travels out with the request and
// comes back with the reply; without it a download started while a slot save was
// in flight would write the wrong thing into the wrong place.

const STATE_SLOTS = ['1', '2', '3'];
const stateKey = (slot) => `state${slot}`;
let statePending = null;

function sayState(text, kind = '') {
  els.stateMsg.textContent = text;
  els.stateMsg.className = kind ? `hint ${kind}` : 'hint';
}

function stateWhen(kiedy) {
  return isoDateTime(new Date(kiedy));
}

async function refreshStateSlots() {
  for (const slot of STATE_SLOTS) {
    const el = document.getElementById(`state-when-${slot}`);
    if (!el) continue;
    const stan = await storage.get(stateKey(slot)).catch(() => null);
    el.textContent = stan && stan.saved ? stateWhen(stan.saved) : t('puste');
    for (const b of document.querySelectorAll(`[data-state-load="${slot}"], [data-state-drop="${slot}"]`)) {
      b.disabled = !stan;
    }
  }
}

/**
 * Translates a reason a state was refused. The worker and js/ui/statefile.js
 * report in Polish; every message is a literal t(…) here for the same reason as
 * in linkWhy(). Anything else - an exception from deep inside a restore - goes
 * through as it came.
 */
function stateWhy(why, args = []) {
  switch (why) {
    case 'Maszyna nie jest uruchomiona.':
      return t('Maszyna nie jest uruchomiona.');
    case 'Plik nie zawiera stanu maszyny.':
      return t('Plik nie zawiera stanu maszyny.');
    case 'To nie jest plik ze stanem maszyny.':
      return t('To nie jest plik ze stanem maszyny.');
    case 'Stan w formacie {0}, a ten emulator czyta {1}.':
      return t('Stan w formacie {0}, a ten emulator czyta {1}.', ...args);
    default:
      return why;
  }
}

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The card slots a state would change. A snapshot is the whole machine, the
 * card in A: included - and B: as well when the HPC-104 was fitted - so loading
 * it puts that card in the slot, or empties the slot if there was none.
 */
function slotsReplacedBy(stan) {
  const m = stan && stan.machine;
  if (!m) return [];
  const differs = (slot, card) => slot.image && !(card && card.data && sameBytes(slot.image, card.data));
  const out = [];
  if (differs(SLOTS.A, m.cardA)) out.push(SLOTS.A.drive);
  if (stan.hpc104 && differs(SLOTS.B, m.expansion && m.expansion.cardB)) out.push(SLOTS.B.drive);
  return out;
}

async function restoreState(stan) {
  const replaced = slotsReplacedBy(stan);
  if (replaced.length && !await confirmModal({
    title: t('Wczytać stan?'),
    message: t('Zapisany stan ma własną kartę pamięci, więc karta w slocie {0} zostanie ' +
      'zastąpiona tą z zapisu. Jeśli chcesz zachować obecną, najpierw ją pobierz.', replaced.join(', ')),
    ok: t('Wczytaj'),
  })) {
    sayState('');
    return;
  }
  sayState(t('Wczytywanie…'));
  // The numbers the restored cards will answer to. They only become the
  // slots' own once the worker confirms the restore; until then a write still
  // in flight from the old machine is accepted as before.
  worker.postMessage({
    type: 'restoreSnapshot', state: stan, genA: SLOTS.A.gen + 1, genB: SLOTS.B.gen + 1,
  });
}

async function loadStateSlot(slot) {
  const stan = await storage.get(stateKey(slot)).catch(() => null);
  if (!stan) { sayState(t('To gniazdo jest puste.'), 'warn'); return; }
  await restoreState(stan);
}

function wireState() {
  for (const b of document.querySelectorAll('[data-state-save]')) {
    b.addEventListener('click', () => {
      statePending = b.dataset.stateSave;
      sayState(t('Zapisywanie…'));
      worker.postMessage({ type: 'snapshot', slot: statePending });
    });
  }
  for (const b of document.querySelectorAll('[data-state-load]')) {
    b.addEventListener('click', () => loadStateSlot(b.dataset.stateLoad));
  }
  for (const b of document.querySelectorAll('[data-state-drop]')) {
    b.addEventListener('click', async () => {
      const slot = b.dataset.stateDrop;
      const stan = await storage.get(stateKey(slot)).catch(() => null);
      if (!stan) { await refreshStateSlots(); return; }
      if (!await confirmModal({
        title: t('Usunąć zapis z gniazda {0}?', slot),
        message: t('Stan zapisany {0} zniknie z pamięci przeglądarki. Tego nie da się cofnąć.',
                   stan.saved ? stateWhen(stan.saved) : '—'),
        ok: t('Usuń'),
      })) return;
      await storage.remove(stateKey(slot)).catch(() => {});
      await refreshStateSlots();
      sayState(t('Gniazdo opróżnione.'));
    });
  }

  document.getElementById('btn-state-download').addEventListener('click', () => {
    statePending = '#plik';
    sayState(t('Przygotowywanie pliku…'));
    worker.postMessage({ type: 'snapshot', slot: statePending });
  });

  els.stateFile.addEventListener('change', async () => {
    const file = els.stateFile.files && els.stateFile.files[0];
    els.stateFile.value = '';
    if (!file) return;
    try {
      await restoreState(decodeState(await file.text()));
    } catch (e) {
      sayState(stateWhy(e.message), 'err');
    }
  });

  refreshStateSlots();
  onLanguageChange(() => refreshStateSlots());
}

async function onSnapshotData(msg) {
  // The slot comes back from the worker rather than being read off `statePending`
  // here, so an answer that overtakes another one still lands where it belongs.
  const slot = msg.slot || statePending;
  statePending = null;
  if (!msg.state) { sayState(t('Maszyna nie jest jeszcze uruchomiona.'), 'warn'); return; }

  if (slot === '#plik') {
    try {
      downloadBlob(new TextEncoder().encode(encodeState(msg.state)),
                   nazwaPliku(msg.state.saved), 'application/json');
      sayState(t('Stan zapisany do pliku.'), 'ok');
    } catch (e) {
      sayState(e.message, 'err');
    }
    return;
  }

  if (!slot) return;
  try {
    await storage.put(stateKey(slot), msg.state);
    await refreshStateSlots();
    sayState(t('Stan zapisany w gnieździe {0}.', slot), 'ok');
  } catch (e) {
    // A snapshot is a few hundred kilobytes and the quota is the usual reason
    // this fails, so say which slot did not take it rather than a bare error.
    sayState(t('Nie udało się zapisać w gnieździe {0}: {1}', slot, e.message), 'err');
  }
}

/**
 * The worker rebuilt the expansion chain from the snapshot, so the switches on
 * the page now describe hardware the machine no longer has. Put them back in
 * step - and write the settings out, so a reload does not undo the restore.
 */
function onStateRestored(msg) {
  els.hpc104.checked = !!msg.hpc104;
  els.hpc104Panel.hidden = !msg.hpc104;
  els.parallel.checked = msg.peripheral === 'parallel';
  els.serial.checked = msg.peripheral === 'serial';
  saveSettings();

  // The machine now runs on the cards the snapshot carried, so the slots take
  // them over - list, storage and download alike - and from here on accept
  // only what the restored machine writes. Slot B is left alone when the
  // snapshot had no HPC-104: the card then waits outside the machine, as it
  // does at start-up with the board unfitted.
  adoptRestoredCard(SLOTS.A, msg.cardA, msg.genA);
  if (msg.hpc104) adoptRestoredCard(SLOTS.B, msg.cardB, msg.genB);
}

function adoptRestoredCard(slot, card, gen) {
  slot.gen = gen;
  slot.image = card ? card.data : null;
  if (slot === SLOTS.A) currentCard = slot.image;
  const box = slot.el('Writable');
  if (card && box) box.checked = card.writable;
  if (card) saveCard(slot.storageKey, card.data);
  else storage.remove(slot.storageKey).catch(() => {});
  slot.el('Warn').hidden = true;
  refreshCardUI(slot);
}

// ---- worker plumbing ------------------------------------------------------

function onWorkerMessage(e) {
  const msg = e.data;

  switch (msg.type) {
    case 'ready':
      sayStatus(() => t('uruchomiony'), 'ok');
      break;

    case 'frame':
      if (msg.contrast !== undefined) setContrast(msg.contrast);
      drawFrame(msg.pixels);
      break;

    case 'inspectData':
      inspectDraw(msg);
      break;

    case 'paused':
      onPaused(msg);
      break;

    case 'snapshotData':
      onSnapshotData(msg);
      break;

    case 'stateRestored':
      onStateRestored(msg);
      break;

    case 'stateResult':
      if (msg.ok) sayState(t('Stan wczytany.'), 'ok');
      else sayState(stateWhy(msg.why, msg.whyArgs), 'err');
      break;

    case 'audio':
      audio.schedule(msg.events, msg.duration);
      break;

    case 'linkResult':
      onLinkResult(msg);
      break;

    case 'serialData':
      serialHub.fromPortfolio(msg.data);
      break;

    case 'status':
      els.speed.textContent = `${formatNumber(msg.speed * 100)}%`;
      els.printBytes.textContent = String(msg.printBytes);
      lastSerialLine = msg.serial;
      updateSerialLine(msg.serial);
      // The flag clears on reset, so the label has to clear with it - otherwise
      // it sticks for the rest of the session and stops being evidence of
      // anything. Only this one label is managed here; an error put up by the
      // ROM loader or the worker stays where it is.
      if (msg.poweredOff) {
        sayStatus(() => t('wyłączony (soft power off)'), 'warn');
        poweredOffLabelUp = true;
        pausedLabelUp = false;
      } else if (msg.paused) {
        sayStatus(() => t('zatrzymany w inspektorze'), 'warn');
        poweredOffLabelUp = false;
        pausedLabelUp = true;
      } else if (poweredOffLabelUp || pausedLabelUp) {
        sayStatus(() => t('uruchomiony'), 'ok');
        poweredOffLabelUp = false;
        pausedLabelUp = false;
      }
      break;

    case 'nvram':
      saveNvram(msg.data);
      // The same snapshot is what the PERMDATA.DAT view reads drive C: out of.
      lastNvram = msg.data;
      if (permdataPending) { permdataPending = false; showPermdata(); }
      break;

    case 'card':
      // DOS wrote to the card; adopt its version so host-side edits build on
      // top of those writes rather than discarding them. Unless the slot has
      // since been emptied or refilled - a flush already in flight when Eject
      // was pressed must not put the card back, and must not overwrite a card
      // put in after it. The host side decides what is in a slot.
      if (!SLOTS.A.image || msg.gen !== SLOTS.A.gen) break;
      SLOTS.A.image = msg.data;
      currentCard = msg.data;
      els.cardWarn.hidden = true;
      saveCard('cardA', msg.data);
      refreshCardUI(SLOTS.A);
      break;

    case 'cardB':
      if (!SLOTS.B.image || msg.gen !== SLOTS.B.gen) break;
      SLOTS.B.image = msg.data;
      els.cardBWarn.hidden = true;
      saveCard('cardB', msg.data);
      refreshCardUI(SLOTS.B);
      break;

    case 'hpc104ram':
      saveCard('hpc104ram', msg.data);
      // Drive C: may well be in here rather than in the on-board RAM.
      lastHpc104Ram = msg.data;
      break;

    case 'print': {
      if (msg.data.length === 0) {
        noticeModal({ title: t('Wydruk'), message: t('Bufor wydruku jest pusty.') });
      } else {
        downloadBlob(msg.data, `wydruk-${stamp()}.txt`, 'text/plain');
      }
      break;
    }
  }
}

// ---- inspector ------------------------------------------------------------
//
// Four panels, one request per refresh. The worker sends the port log, the
// registers and both memory windows in one reply, so the panels never drift a
// frame apart - in a view of the machine that is worse than a little lag.
//
// Polling runs only while the window is open. Closed, it costs exactly nothing,
// and the log on the worker's side switches off along with it.

const INSPECT_MS = 250;

const insp = {
  dlg: document.getElementById('dlg-inspect'),
  regs: document.getElementById('insp-regs'),
  disasm: document.getElementById('insp-disasm'),
  dump: document.getElementById('insp-dump'),
  log: document.getElementById('insp-log'),
  kod: document.getElementById('insp-code'),
  mem: document.getElementById('insp-mem'),
  follow: document.getElementById('opt-insp-follow'),
  io: document.getElementById('opt-insp-io'),
  lo: document.getElementById('insp-lo'),
  hi: document.getElementById('insp-hi'),
  clear: document.getElementById('btn-insp-clear'),
  pause: document.getElementById('btn-insp-pause'),
  step: document.getElementById('btn-insp-step'),
  brk: document.getElementById('insp-brk'),
  brkIo: document.getElementById('opt-insp-brk-io'),
  brkDir: document.getElementById('insp-brk-dir'),
  brkLo: document.getElementById('insp-brk-lo'),
  brkHi: document.getElementById('insp-brk-hi'),
  state: document.getElementById('insp-state'),
};
let inspectTimer = null;
let inspectLog = [];
let inspectPrevCyc = null;

// Being stopped lives on the worker's side; this is only its reflection: the
// button, the status line and the reason the machine stands still.
let inspectHalted = false;
let inspectStop = null;            // the last reason for stopping, as the worker sent it
let inspectBreakCount = 0;
let inspectBadBreaks = [];         // entries in the breakpoint field that could not be read

const sayInspect = reporter(insp.state, 'insp-state');

const hx = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `E000:1BA0`, `E000`, `1BA0` or empty - everything anyone will actually type. */
function parseAddr(text, domyslnySeg) {
  const m = String(text).trim().match(/^([0-9a-f]{1,4})?\s*:?\s*([0-9a-f]{1,4})?$/i);
  if (!m || (!m[1] && !m[2])) return null;
  if (m[1] && m[2]) return { seg: parseInt(m[1], 16), off: parseInt(m[2], 16) };
  return { seg: domyslnySeg, off: parseInt(m[1] || m[2], 16) };
}

function inspectOpen() {
  if (inspectTimer) return;
  inspectSetWatch();
  inspectSetBreaks();
  inspectTimer = setInterval(inspectPoll, INSPECT_MS);
  inspectPoll();
}

function inspectClose() {
  clearInterval(inspectTimer);
  inspectTimer = null;
  if (!worker) return;
  worker.postMessage({ type: 'inspect', on: false });
  // Breakpoints belong to the inspector, not to the machine. Left behind a
  // closed window they would stop the emulator with nothing on screen to
  // explain it, and nothing to get it moving again.
  worker.postMessage({ type: 'breakpoints', addrs: [], io: null });
  worker.postMessage({ type: 'resume' });
}

/**
 * Breakpoint addresses from the text field, separated by commas or spaces, each
 * through the same parser as the panels' address fields - so a bare offset means
 * ROM. Unreadable entries are not dropped quietly; they come back in the status line.
 */
function inspectBreakAddrs() {
  const dobre = [];
  inspectBadBreaks = [];
  for (const kawalek of insp.brk.value.split(/[\s,;]+/).filter(Boolean)) {
    const a = parseAddr(kawalek, 0xE000);
    if (a) dobre.push((((a.seg << 4) + a.off) & 0xFFFFF));
    else inspectBadBreaks.push(kawalek);
  }
  return dobre;
}

function inspectSetBreaks() {
  if (!worker) return;
  const addrs = inspectBreakAddrs();
  inspectBreakCount = addrs.length;
  const lo = parseInt(insp.brkLo.value, 16);
  const hi = parseInt(insp.brkHi.value, 16);
  const dir = insp.brkDir.value;
  worker.postMessage({
    type: 'breakpoints',
    addrs,
    io: insp.brkIo.checked ? {
      lo: Number.isNaN(lo) ? 0 : lo,
      hi: Number.isNaN(hi) ? (Number.isNaN(lo) ? 0xFFFF : lo) : hi,
      rd: dir !== 'w',
      wr: dir !== 'r',
    } : null,
  });
  inspectSayState();
}

/** Where the stop came from - one sentence, because the status line has one. */
function inspectStopText() {
  const s = inspectStop;
  if (!s) return t('Maszyna zatrzymana.');
  if (s.why === 'addr') return t('Zatrzymana na pułapce {0}', `${hx(s.seg, 4)}:${hx(s.off, 4)}`);
  if (s.why === 'io') {
    return s.r
      ? t('Zatrzymana po odczycie portu {0}, bajt {1}', hx(s.port, 4), hx(s.val, 2))
      : t('Zatrzymana po zapisie do portu {0}, bajt {1}', hx(s.port, 4), hx(s.val, 2));
  }
  if (s.why === 'step') {
    return t('Krok: {0} wykonane w {1} cyklach', `${hx(s.seg, 4)}:${hx(s.off, 4)}`, s.took);
  }
  if (s.why === 'off') return t('Maszyna jest wyłączona — nie ma czego krokować.');
  return t('Maszyna zatrzymana.');
}

function inspectSayState() {
  sayInspect(() => {
    const czesci = [inspectHalted ? inspectStopText() : t('Maszyna chodzi.')];
    if (inspectBreakCount) czesci.push(t('pułapek na adres: {0}', inspectBreakCount));
    if (insp.brkIo.checked) czesci.push(t('pułapka na port włączona'));
    if (inspectBadBreaks.length) czesci.push(t('nieczytelne: {0}', inspectBadBreaks.join(' ')));
    return czesci.join('   ·   ');
  }, inspectHalted ? 'stopped' : '');
}

/**
 * The label on the run button. Written from here, so the static layer has to let
 * go of it: otherwise a change of language would put "Stop" back under a
 * machine that is standing still.
 */
function inspectShowButtons() {
  insp.pause.removeAttribute('data-i18n');
  insp.pause.textContent = inspectHalted ? t('Wznów') : t('Zatrzymaj');
}

/** The worker says the machine has stopped or started - and why it stopped. */
function onPaused(msg) {
  inspectHalted = !!msg.paused;
  inspectStop = msg.paused ? msg : null;
  inspectShowButtons();
  inspectSayState();
  if (!poweredOffLabelUp) {
    if (inspectHalted) sayStatus(() => t('zatrzymany w inspektorze'), 'warn');
    else sayStatus(() => t('uruchomiony'), 'ok');
    pausedLabelUp = inspectHalted;
  }
  inspectPoll();
}

function inspectSetWatch() {
  if (!worker) return;
  const lo = parseInt(insp.lo.value, 16), hi = parseInt(insp.hi.value, 16);
  worker.postMessage({
    type: 'inspect',
    on: insp.io.checked,
    lo: Number.isNaN(lo) ? 0 : lo,
    hi: Number.isNaN(hi) ? 0xFFFF : hi,
  });
  if (!insp.io.checked) { inspectLog = []; inspectPrevCyc = null; }
}

function inspectPoll() {
  if (!worker || !insp.dlg.open) return;
  const kod = parseAddr(insp.kod.value, 0xE000) || { seg: 0xE000, off: 0 };
  const mem = parseAddr(insp.mem.value, 0x0040) || { seg: 0x0040, off: 0 };
  worker.postMessage({
    type: 'inspectPoll',
    follow: insp.follow.checked,
    codeSeg: kod.seg, codeOff: kod.off,
    memSeg: mem.seg, memOff: mem.off,
  });
}

const FLAGI = [['o', 0x800], ['d', 0x400], ['i', 0x200], ['t', 0x100],
               ['s', 0x080], ['z', 0x040], ['a', 0x010], ['p', 0x004], ['c', 0x001]];

function inspectDraw(msg) {
  if (!insp.dlg.open) return;

  // --- registers ---
  const r = msg.regs;
  const f = FLAGI.map(([n, b]) => (r.flags & b) ? n.toUpperCase() : '<i>' + n + '</i>').join(' ');
  insp.regs.innerHTML =
    `AX <b>${hx(r.ax, 4)}</b>  BX <b>${hx(r.bx, 4)}</b>  CX <b>${hx(r.cx, 4)}</b>  DX <b>${hx(r.dx, 4)}</b>\n` +
    `SI <b>${hx(r.si, 4)}</b>  DI <b>${hx(r.di, 4)}</b>  BP <b>${hx(r.bp, 4)}</b>  SP <b>${hx(r.sp, 4)}</b>\n` +
    `CS <b>${hx(r.cs, 4)}</b>  DS <b>${hx(r.ds, 4)}</b>  ES <b>${hx(r.es, 4)}</b>  SS <b>${hx(r.ss, 4)}</b>\n` +
    `IP <b>${hx(r.ip, 4)}</b>  ${f}` +
    (r.halted ? `  <b>${esc(t('postój po HLT'))}</b>` : '') +
    `\n${esc(t('cykli od resetu'))} <b>${formatNumber(msg.cycles)}</b>`;

  // --- code ---
  const kb = msg.kod.bytes;
  const linie = disasmRange((a) => kb[a - ((msg.kod.seg << 4) + msg.kod.off)] ?? 0,
                            msg.kod.seg, msg.kod.off, 12);
  insp.disasm.innerHTML = linie.map((l, i) =>
    `${i === 0 ? '<b>&gt;</b>' : ' '} ${hx(l.seg, 4)}:${hx(l.off, 4)}  ` +
    `<i>${l.bytes.padEnd(17)}</i>  ${esc(l.text)}`).join('\n');

  // --- memory ---
  const pb = msg.pam.bytes;
  const wiersze = [];
  for (let i = 0; i < pb.length; i += 16) {
    const bajty = [];
    let znaki = '';
    for (let k = 0; k < 16; k++) {
      const v = pb[i + k];
      bajty.push(hx(v, 2));
      znaki += (v >= 32 && v < 127) ? String.fromCharCode(v) : '.';
    }
    wiersze.push(`${hx(msg.pam.seg, 4)}:${hx((msg.pam.off + i) & 0xFFFF, 4)}  ` +
                 `${bajty.join(' ')}  ${esc(znaki)}`);
  }
  insp.dump.innerHTML = wiersze.join('\n');

  // --- port log ---
  if (msg.dropped) inspectLog.push({ drop: msg.dropped });
  for (const w of msg.log) inspectLog.push(w);
  // The whole kept log is drawn afresh every time, so the first line measures its
  // gap from the entry just before it - the last one trimmed off the front - and
  // not from wherever the previous drawing happened to end, which came out
  // negative.
  if (inspectLog.length > 400) {
    const cut = inspectLog.length - 400;
    const before = inspectLog[cut - 1];
    inspectPrevCyc = before.drop ? null : before.cyc;
    inspectLog = inspectLog.slice(cut);
  }

  if (!insp.io.checked) {
    insp.log.innerHTML = `<i>${esc(t('Śledzenie wyłączone.'))}</i>`;
  } else if (!inspectLog.length) {
    insp.log.innerHTML = `<i>${esc(t('Brak dostępów w tym zakresie.'))}</i>`;
  } else {
    let poprz = inspectPrevCyc;
    const out = inspectLog.map((w) => {
      if (w.drop) { poprz = null; return `<i>${esc(t('… pominięto {0} wpisów', w.drop))}</i>`; }
      // A reset zeroes the CPU's cycle count, so a gap across one is not a gap.
      const luka = poprz === null || w.cyc < poprz ? '' : String(w.cyc - poprz);
      poprz = w.cyc;
      return `${hx(w.port, 4)}  ${w.r ? '<i>&lt;-</i>' : '<b>-&gt;</b>'}  ${hx(w.val, 2)}  ` +
             `<i>${luka.padStart(8)}</i>`;
    });
    insp.log.innerHTML =
      `<i>${esc(t('port / kierunek / bajt / cykli od poprzedniego'))}</i>\n` + out.join('\n');
    insp.log.scrollTop = insp.log.scrollHeight;
  }
}

function wireInspector() {
  insp.dlg.addEventListener('close', inspectClose);
  for (const el of [insp.io, insp.lo, insp.hi]) {
    el.addEventListener('change', inspectSetWatch);
  }
  insp.clear.addEventListener('click', () => {
    inspectLog = []; inspectPrevCyc = null;
    insp.log.innerHTML = '';
  });
  insp.follow.addEventListener('change', () => { insp.kod.disabled = insp.follow.checked; });
  insp.kod.disabled = insp.follow.checked;

  insp.pause.addEventListener('click', () => {
    if (worker) worker.postMessage({ type: inspectHalted ? 'resume' : 'pause' });
  });
  insp.step.addEventListener('click', () => {
    if (!worker) return;
    worker.postMessage({ type: 'step' });
    // Straight after the step, so the panels show the machine after it rather
    // than as it was a quarter of a second ago. Messages arrive in order, so the
    // worker answers once the instruction has run.
    inspectPoll();
  });
  for (const el of [insp.brk, insp.brkIo, insp.brkDir, insp.brkLo, insp.brkHi]) {
    el.addEventListener('change', inspectSetBreaks);
  }
  onLanguageChange(inspectShowButtons);
}

function wireModals() {
  for (const btn of document.querySelectorAll('[data-modal]')) {
    btn.addEventListener('click', () => {
      // Let go of any key the user is holding before focus leaves the emulator,
      // otherwise the matrix keeps it pressed for good. The ROM dialog can open
      // before there is a worker at all, so this stays guarded.
      if (worker) worker.postMessage({ type: 'blur' });
      hostKeys.forget();

      if (btn.dataset.modal === 'dlg-rom') openRomDialog();
      else {
        document.getElementById(btn.dataset.modal).showModal();
        if (btn.dataset.modal === 'dlg-inspect') inspectOpen();
      }
    });
  }

  for (const dlg of document.querySelectorAll('dialog.modal')) {
    dlg.addEventListener('click', (e) => {
      // Comparing e.target to the dialog is the usual trick for detecting a
      // backdrop click, but it also fires on the dialog's own padding. Test the
      // pointer against the box instead.
      if (e.clientX === 0 && e.clientY === 0) return;   // keyboard activation
      if (dlg.dataset.required) return;                 // no ROM, nothing to go back to

      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right &&
                     e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
  }
}

/**
 * Restarts the machine and gets out of the way. Every reset button sits inside
 * a dialog that covers the screen it just changed, so the dialog closes too -
 * otherwise the user restarts the Portfolio and watches a panel instead of the
 * boot they asked for.
 */
function resetMachine(cold, fromEl) {
  audio.silence();
  worker.postMessage({ type: 'reset', cold });

  const dialog = fromEl && fromEl.closest('dialog');
  if (dialog && dialog.open) dialog.close();
}

function wireReset(id, { cold = false, question = null } = {}) {
  // The button is held on to here rather than read off the event: the handler
  // awaits, and by the time it resumes the browser has cleared
  // event.currentTarget - the dialog around a cold start then stayed open.
  const button = document.getElementById(id);
  button.addEventListener('click', async () => {
    if (question && !await confirmModal(question())) return;
    if (cold) await storage.remove('nvram');
    resetMachine(cold, button);
  });
}

// ---- what the Portfolio remembers about itself ----------------------------

// The last RAM snapshot the worker sent, and whether a click is waiting for a
// fresher one. Drive C: lives inside it, and PERMDATA.DAT lives on drive C:.
let lastNvram = null;
let lastHpc104Ram = null;
let permdataPending = false;

// The order the sections are shown in, as DIP's own table has them. Kept apart
// from the labels below so that the marked block holds nothing but text meant
// for the reader - these are identifiers and have no business in a dictionary.
const PERMDATA_ORDER = ['serial', 'printer', 'editor', 'worksheet', 'diary',
  'address', 'calculator', 'system'];

// Row labels, one set per tab. The headings live in the HTML, as the tabs
// themselves. The marker tells tools/i18n-check.mjs that every string in here is
// a dictionary key: they reach t() as a variable, which no tool reading the
// source could follow on its own.
/* i18n-keys */
const PERMDATA_LABELS = {
  serial: {
    baud: 'Prędkość', parity: 'Parzystość', dataBits: 'Bity danych', stopBits: 'Bity stopu',
  },
  printer: {
    destination: 'Cel wydruku', file: 'Plik docelowy', linesPerPage: 'Linii na stronę',
    endOfLine: 'Koniec linii', marginTop: 'Margines górny', marginBottom: 'Margines dolny',
    marginLeft: 'Wcięcie od lewej', setupCodeLength: 'Długość kodów sterujących',
  },
  editor: {
    lastFile: 'Ostatni plik', cursorLine: 'Linia kursora', cursorColumn: 'Kolumna kursora',
    topLine: 'Górna linia ekranu', rightMargin: 'Prawy margines', wordWrap: 'Zawijanie słów',
    frame: 'Ramka przy wejściu',
  },
  worksheet: {
    lastFile: 'Ostatni plik', autoload: 'Wczytuj ostatni', currency: 'Symbol waluty',
    decimalPoint: 'Separator dziesiętny', paperWidth: 'Szerokość papieru',
    frame: 'Ramka przy wejściu',
  },
  diary: {
    lastFile: 'Ostatni plik', frame: 'Ramka przy wejściu',
  },
  address: {
    lastFile: 'Ostatni plik', dialPrefix: 'Prefiks wybierania', frame: 'Ramka przy wejściu',
  },
  calculator: {
    format: 'Format liczb', decimals: 'Miejsca po przecinku', separators: 'Separatory tysięcy',
    decimalComma: 'Przecinek dziesiętny', frame: 'Ramka przy wejściu',
  },
  system: {
    clipboardEnabled: 'Schowek włączony', clipboardSaved: 'Schowek zapisywany',
    undeleteEnabled: 'Bufor undelete włączony', undeleteSaved: 'Bufor zapisywany',
  },
};

const permdataSay = reporter(els.permdataStatus);
const sayAudio = reporter(els.audioHint);
const saySendNote = reporter(els.sendNote);

// The decoded file, kept between renders: switching tabs must not need another
// snapshot from the worker, and a change of language redraws from the same data.
let permdata = null;
let permdataTab = PERMDATA_ORDER[0];

/** Fills the table with the section the active tab names. */
function renderPermdataTab() {
  els.permdataTable.replaceChildren();

  for (const button of els.permdataTabs.querySelectorAll('[data-group]')) {
    const active = button.dataset.group === permdataTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    // Only the selected tab is in the tab order; the arrow keys move between
    // them, which is how a tab strip is expected to behave.
    button.tabIndex = active ? 0 : -1;
    if (active) els.permdataPanel.setAttribute('aria-labelledby', button.id);
  }

  if (!permdata) return;

  const labels = PERMDATA_LABELS[permdataTab];
  const values = permdata[permdataTab];

  for (const [key, label] of Object.entries(labels)) {
    const value = values[key];
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const val = document.createElement('td');
    name.textContent = t(label);
    // An empty path or currency reads better as a dash than as nothing at all.
    val.textContent = value === '' ? '—' : String(value);
    tr.append(name, val);
    els.permdataTable.append(tr);
  }
}

/** Decodes the snapshot already in hand and puts it on the screen. */
function showPermdata() {
  if (!lastNvram) {
    permdata = null;
    renderPermdataTab();
    permdataSay(() => t('Brak zrzutu pamięci — poczekaj chwilę i spróbuj ponownie.'), 'warn');
    return;
  }

  const result = readPermdata(lastNvram, els.hpc104.checked ? lastHpc104Ram : null);
  if (!result.ok) {
    permdata = null;
    renderPermdataTab();
    permdataSay(result.why, 'warn');
    return;
  }

  permdata = result.data;
  renderPermdataTab();
  permdataSay(() => t('Odczytano z dysku C: emulowanej maszyny.'), 'ok');
}

function wirePermdata() {
  const tabs = [...els.permdataTabs.querySelectorAll('[data-group]')];
  for (const button of tabs) button.id = `permdata-tab-${button.dataset.group}`;

  const select = (group) => { permdataTab = group; renderPermdataTab(); };

  for (const button of tabs) {
    button.addEventListener('click', () => select(button.dataset.group));
  }

  // Arrow keys walk the strip, as a tablist is expected to.
  els.permdataTabs.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = tabs.findIndex((b) => b.dataset.group === permdataTab);
    const next = tabs[(at + step + tabs.length) % tabs.length];
    select(next.dataset.group);
    next.focus();
  });

  const read = () => {
    permdataSay(() => t('Odczytywanie…'));
    permdataPending = true;
    worker.postMessage({ type: 'requestNvram' });
  };

  // Opening the dialog reads straight away - the button says "read", and having
  // to press a second one inside would be a poor joke.
  document.getElementById('btn-permdata').addEventListener('click', read);
  document.getElementById('btn-permdata-refresh').addEventListener('click', read);

  renderPermdataTab();
}

/** Reports which of the two timbres is actually being heard right now. */
function sayAudioState() {
  sayAudio(els.timbre.value === 'raw'
    ? () => t('Dźwięk włączony — surowa fala prostokątna, tak jak syntezuje ją MAME.')
    : () => t('Dźwięk włączony — dwa tony przez filtr głośnika Portfolio, w paśmie telefonicznym.'));
}

/**
 * Redraws everything JavaScript put on screen itself. The static layer restores
 * elements from its own cache, which for these would mean resurrecting whatever
 * text happened to be there when the language last changed - so they are built
 * again from their current state instead.
 */
function retranslateDynamic() {
  applyInertia();
  applyGrid();
  renderRomList();
  renderRomHashes();
  refreshCardUI(SLOTS.A);
  refreshCardUI(SLOTS.B);
  refreshSerialUI();
  updateSerialLine(lastSerialLine);
  showSendButton();
  markWebSerial();
  showRecordButton();
  if (els.audioSwitch.checked) sayAudioState();
  if (permdata) renderPermdataTab();
}

/**
 * Greys out the Web Serial choice where the browser has no such API. The note
 * is appended to the option's own text, which the static layer would wipe on a
 * change of language, so the whole label is written from here.
 */
function markWebSerial() {
  if (SerialHub.webSerialAvailable) return;
  const option = els.serialMode.querySelector('option[value="webserial"]');
  option.disabled = true;
  option.removeAttribute('data-i18n');
  option.textContent = t('Prawdziwy port RS-232 (Web Serial)') + t(' — niedostępne w tej przeglądarce');
}

function wireLanguage() {
  const buttons = { pl: document.getElementById('lang-pl'), en: document.getElementById('lang-en') };

  const mark = (lang) => {
    for (const [code, button] of Object.entries(buttons)) {
      button.classList.toggle('active', code === lang);
      button.setAttribute('aria-pressed', String(code === lang));
    }
  };

  for (const [code, button] of Object.entries(buttons)) {
    button.addEventListener('click', () => { setLanguage(code); mark(code); });
  }

  onLanguageChange(retranslateDynamic);
  mark(getLanguage());
}

function wireControls() {
  wireModals();
  wireInspector();
  wireState();
  wireLanguage();
  wirePermdata();
  wireRecorder();

  wireReset('btn-reset');
  wireReset('btn-print-reset');
  wireReset('btn-serial-reset');
  wireReset('btn-hpc104-reset');

  wireReset('btn-cold', {
    cold: true,
    question: () => ({
      title: t('Zimny start?'),
      message: t('Zimny start kasuje całą pamięć NVRAM (wszystkie pliki na C:).'),
      ok: t('Zimny start'),
    }),
  });

  wireReset('btn-hpc104-cold', {
    cold: true,
    question: () => ({
      title: t('Zimny start?'),
      message: t('Zimny start przeliczy pamięć, ale skasuje zawartość dysku C:. ' +
        'Karty w slotach A: i B: zostaną nienaruszone.'),
      ok: t('Zimny start'),
    }),
  });

  // Sound always starts off - a browser blocks Web Audio until a gesture, and
  // flipping this switch is that gesture. Level and timbre only appear once
  // there is something for them to act on.
  const restored = loadVolume();
  if (restored !== null) els.volume.value = restored;
  audio.setVolume(Number(els.volume.value) / 100);

  const showAudioOptions = () => {
    els.audioOptions.hidden = !els.audioSwitch.checked;
  };
  els.audioSwitch.checked = false;
  showAudioOptions();

  els.audioSwitch.addEventListener('change', async () => {
    if (!els.audioSwitch.checked) {
      audio.setMuted(true);
      audio.silence();
      showAudioOptions();
      sayAudio(() => t('Dźwięk wyciszony.'));
      return;
    }

    const ok = await audio.start();
    if (!ok) {
      els.audioSwitch.checked = false;       // nothing was switched on, so say so
      showAudioOptions();
      sayAudio(() => t('Ta przeglądarka nie udostępnia Web Audio.'));
      return;
    }
    audio.setMuted(false);
    showAudioOptions();
    sayAudioState();
  });

  els.volume.addEventListener('input', () => {
    audio.setVolume(Number(els.volume.value) / 100);
  });

  // Written on release rather than on every step of the drag: localStorage is
  // synchronous, and a range fires input per pixel of travel.
  els.volume.addEventListener('change', () => saveVolume(Number(els.volume.value)));

  els.timbre.addEventListener('change', () => {
    audio.setTimbre(els.timbre.value);
    if (els.audioSwitch.checked) sayAudioState();
  });

  // Both slots get the same five controls, wired from one description.
  const wireSlot = (slot, ids) => {
    slot.el('File').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // A raw ROM shorter than a card goes in the way it would be burnt: at the
      // start of the chip, with the rest of the chip erased.
      const { image, padded } = padCardImage(new Uint8Array(await file.arrayBuffer()));
      setCard(slot, image, { warn: true });
      e.target.value = '';
      if (padded) {
        noticeModal({
          title: t('Obraz dopełniony'),
          message: t('Plik {0} ma {1} B, mniej niż karta. Reszta karty do {2} KB jest wypełniona bajtami FFh, tak jak niezapisane miejsce w EPROM-ie.',
            file.name, formatNumber(file.size), formatNumber(image.length / 1024)),
        });
      }
    });

    slot.el('Add').addEventListener('change', async (e) => {
      await addFilesToCard(slot, [...e.target.files]);
      e.target.value = '';
    });

    document.getElementById(ids.create).addEventListener('click', async () => {
      const size = Number(slot.el('Size').value);
      if (slot.image && !await confirmModal({
        title: t('Zastąpić kartę w slocie {0} nową, pustą?', slot.drive),
        message: t('Pliki z obecnej karty przepadną, chyba że najpierw ją pobierzesz.'),
        ok: t('Zastąp'),
      })) return;
      setCard(slot, fat.formatCard(size), { warn: true });
    });

    document.getElementById(ids.eject).addEventListener('click', () => {
      slot.gen++;
      worker.postMessage({ type: slot.ejectMsg });
      slot.image = null;
      if (slot === SLOTS.A) currentCard = null;
      slot.el('File').value = '';
      storage.remove(slot.storageKey).catch(() => {});
      refreshCardUI(slot);
    });

    document.getElementById(ids.save).addEventListener('click', () => {
      if (!slot.image) {
        noticeModal({ title: t('Brak karty'), message: t('Brak karty w slocie {0}.', slot.drive) });
        return;
      }
      downloadBlob(slot.image, `karta-${slot.drive[0]}-${stamp()}.img`, 'application/octet-stream');
    });
  };

  wireSlot(SLOTS.A, { create: 'btn-new-card', eject: 'btn-eject', save: 'btn-save-card' });
  wireSlot(SLOTS.B, { create: 'btn-new-cardb', eject: 'btn-eject-b', save: 'btn-save-cardb' });

  els.hpc104.addEventListener('change', () => {
    const on = els.hpc104.checked;
    els.hpc104Panel.hidden = !on;
    worker.postMessage({ type: 'setHpc104', enabled: on });
    if (on && SLOTS.B.image) {
      // With the slot's own number: without it the worker counted the card as
      // generation 0, and once the slot had been refilled in this session
      // every write DOS made to B: was turned away here as stale.
      worker.postMessage({
        type: 'insertCardB',
        data: SLOTS.B.image.slice(),
        writable: slotWritable(SLOTS.B),
        gen: SLOTS.B.gen,
      });
    }
    // Remembered, so reloading the page does not silently drop drive B:.
    saveSettings();
  });

  document.getElementById('btn-print').addEventListener('click', () => {
    worker.postMessage({ type: 'takePrint' });
  });

  els.parallel.addEventListener('change', () => {
    setPeripheral(els.parallel.checked ? 'parallel' : 'none');
    linkSay(els.parallel.checked
      ? t('Interfejs podłączony. Zrób Reset, żeby BIOS go wykrył.')
      : t('Interfejs odłączony.'));
    saveSettings();
  });

  els.serial.addEventListener('change', () => {
    // Taking the board out of the socket leaves the far end of the cable
    // attached to nothing, and its Disconnect button has just been hidden along
    // with the rest of the panel - so drop the backend here rather than leaving
    // a real serial port held open with no way to release it.
    if (!els.serial.checked && serialHub.backend) serialHub.disconnect();

    setPeripheral(els.serial.checked ? 'serial' : 'none');
    serialHub.status(els.serial.checked
      ? () => t('Interfejs podłączony. Zrób Reset, żeby BIOS go wykrył.')
      : () => t('Interfejs odłączony.'));
    updateSerialLine(null);
    saveSettings();
  });

  els.serialTimeout.addEventListener('change', () => {
    const units = Number(els.serialTimeout.value);
    worker.postMessage({ type: 'setOption', auxTimeout: units });
    serialHub.status(units
      ? () => t('Limit ciszy na linii: ok. {0} s.', Math.round(units * 4.25))
      : () => t('Limit ciszy na linii: domyślny z BIOS-u (ok. 4 s).'));
  });

  els.serialMode.addEventListener('change', () => {
    showSerialModeOptions();
    if (serialHub.backend) serialHub.disconnect();
  });

  document.getElementById('btn-serial-connect')
    .addEventListener('click', connectSerialBackend);

  document.getElementById('btn-serial-disconnect')
    .addEventListener('click', () => serialHub.disconnect());

  const sendTypedLine = () => {
    const text = els.serialInput.value;
    els.serialInput.value = '';
    serialDeliver(new TextEncoder().encode(text + '\r'), t('Tekst'));
  };

  document.getElementById('btn-serial-send').addEventListener('click', sendTypedLine);
  els.serialInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendTypedLine(); }
  });

  document.getElementById('btn-serial-clear').addEventListener('click', () => {
    serialHub.screen.clear();
    refreshSerialUI();
  });

  els.serialCapture.addEventListener('click', () => {
    if (!serialHub.capturing) {
      serialHub.startCapture();
      return;
    }
    const data = serialHub.stopCapture();
    if (data.length === 0) noticeModal({ title: t('Zapis z linii'), message: t('Nic nie przyszło na linię.') });
    else downloadBlob(data, `serial-${stamp()}.bin`, 'application/octet-stream');
  });

  document.getElementById('btn-serial-eof').addEventListener('click', () => {
    serialDeliver(Uint8Array.of(0x1A), t('Znak końca pliku'));
  });

  els.serialFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Only the cable end is paced and slow enough to be worth a progress bar;
    // bytes handed to the emulated Portfolio are gone the moment they are sent.
    if (els.serialDir.value === 'line') startFileSend(file, bytes);
    else serialDeliver(bytes, t('Plik {0}', file.name));
  });

  els.sendCancel.addEventListener('click', () => {
    if (send && !send.ended) {
      serialHub.cancelJob();
      finishSend('cancelled');
    } else {
      els.sendDialog.close();
      send = null;
    }
  });

  // Escape and backdrop clicks must not walk away from a running transfer.
  els.sendDialog.addEventListener('cancel', (e) => {
    if (send && !send.ended) e.preventDefault();
  });

  els.linkFile.addEventListener('change', async (e) => {
    await linkSendFiles([...e.target.files]);
    e.target.value = '';
  });

  document.getElementById('btn-link-list').addEventListener('click', () => {
    if (!els.parallel.checked) {
      linkSay(() => t('Najpierw podłącz interfejs równoległy i zrób Reset.'), 'warn');
      return;
    }

    // The field doubles as a destination directory and a search pattern, so a
    // bare directory gets *.* appended while a wildcard is passed through.
    const raw = els.linkDest.value.trim() || 'C:\\';
    const pattern = /[*?]/.test(raw) ? raw : (raw.endsWith('\\') ? raw : raw + '\\') + '*.*';

    linkSay(() => t('Odczytywanie listy: {0}…', pattern));
    worker.postMessage({ type: 'linkList', pattern });
  });

  els.systemTick.addEventListener('change', () => {
    applySystemTick();
    saveSettings();
  });

  els.ramRandom.addEventListener('change', () => {
    applyRamFill();
    saveSettings();
  });

  els.lcdTiming.addEventListener('change', () => {
    applyLcdTiming();
    saveSettings();
  });

  els.standby.addEventListener('change', () => {
    applyStandby();
    saveSettings();
  });

  els.scale.addEventListener('change', applyScale);

  // Takes effect on the next byte queued; only letting go of the field saves.
  for (const el of [els.serialDelayChar, els.serialDelayLine]) {
    el.addEventListener('input', applyTxDelay);
    el.addEventListener('change', saveSettings);
  }

  // Dragging retunes the model at once - the next frame is 14 ms away - while
  // only letting go of the slider hits storage.
  els.inertia.addEventListener('input', applyInertia);
  els.inertia.addEventListener('change', saveSettings);
  els.rise.addEventListener('change', () => { applyRise(); saveSettings(); });

  // Dragging re-cuts the backing store, which is one allocation per step of the
  // slider and cheap enough to do live; only letting go hits storage.
  els.grid.addEventListener('input', applyGrid);
  els.grid.addEventListener('change', saveSettings);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // The matrix is emptied on the worker's side, so our idea of what is held has
  // to go with it - otherwise a key released while the page was away would stay
  // down in our books and never be sent up.
  window.addEventListener('blur', () => {
    worker.postMessage({ type: 'blur' });
    hostKeys.forget();
  });

  // Give the emulator a chance to flush NVRAM when the tab goes away.
  window.addEventListener('pagehide', () => worker.postMessage({ type: 'saveState' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') worker.postMessage({ type: 'saveState' });
  });
}

// ---- boot -----------------------------------------------------------------

async function boot() {
  applyGrid();
  applyScale();
  showSerialModeOptions();
  markWebSerial();
  drawFrame(new Uint8Array(SCREEN_W * SCREEN_H));
  wireRomDialog();

  let images;
  try {
    sayStatus(() => t('ładowanie ROM…'));
    images = await acquireRoms();
  } catch (err) {
    sayStatus(() => t('błąd ROM: {0}', err.message), 'err');
    return;
  }

  // Whatever the ROM dialog left in the status bar has served its purpose.
  sayStatus(() => t('inicjalizacja…'));

  // Claim a storage slot before touching IndexedDB, so a second tab never
  // reads or writes the first one's NVRAM.
  const slot = await storage.claimInstance().catch(() => 0);
  if (slot > 0) {
    els.instanceNote.hidden = false;
    els.instanceNote.textContent = t('instancja #{0} — własny, osobny stan zapisu', slot + 1);
  }

  const nvram = await storage.get('nvram').catch(() => null);
  // Short raw images stored before they were padded on the way in get their
  // erased tail now, so they read as they would on hardware.
  const card = padStoredCard('cardA', await storage.get('cardA').catch(() => null));
  const cardB = padStoredCard('cardB', await storage.get('cardB').catch(() => null));
  const hpc104Ram = await storage.get('hpc104ram').catch(() => null);

  // Restore the fitted hardware before init, so the worker builds the right
  // chain first time and the BIOS sees it on its one and only probe.
  const settings = await storage.get('settings').catch(() => null);
  if (settings) {
    els.hpc104.checked = !!settings.hpc104;
    els.parallel.checked = !!settings.parallel;
    els.serial.checked = !!settings.serial;
    if (settings.inertia !== undefined) els.inertia.value = settings.inertia;
    if (settings.rise !== undefined) els.rise.value = settings.rise;
    if (settings.grid !== undefined) els.grid.value = settings.grid;
    if (settings.standby !== undefined) els.standby.value = settings.standby;
    if (settings.ramRandom !== undefined) els.ramRandom.checked = !!settings.ramRandom;
    if (settings.lcdTiming !== undefined) els.lcdTiming.value = settings.lcdTiming;
    // Up to 1.00 this box started cleared and was saved as `systemTick`, so nearly
    // every stored setting says false without anyone having chosen it - harmless
    // then, when the tick it governed never reached the CPU anyway, and a dead
    // clock now that it is the NMI. Only the new key, written by someone who has
    // seen the box as it is now, is honoured.
    if (settings.clock !== undefined) els.systemTick.checked = !!settings.clock;
    if (settings.txDelayChar !== undefined) els.serialDelayChar.value = settings.txDelayChar;
    if (settings.txDelayLine !== undefined) els.serialDelayLine.value = settings.txDelayLine;
  }
  applyInertia();
  applyRise();
  applyGrid();
  applyTxDelay();

  // The worker's own imports are already fresh in the HTTP cache (js/boot.js
  // walked the graph), so only the entry point needs stamping.
  worker = new Worker(`js/emu/worker.js${versionQuery()}`, { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    sayStatus(() => t('błąd workera: {0}', e.message), 'err');
  };

  wireControls();

  worker.postMessage({
    type: 'init',
    sysRom: images.sysRom.buffer,
    lcdCharRom: images.lcdCharRom.buffer,
    cgRom: images.cgRom.buffer,
    nvram: nvram ? nvram.buffer : null,
    card: card ? card.buffer : null,
    cardWritable: true,
    peripheral: els.serial.checked ? 'serial' : (els.parallel.checked ? 'parallel' : 'none'),
    hpc104: els.hpc104.checked,
    ramFill: els.ramRandom.checked ? 'random' : 'zero',
    lcdTiming: els.lcdTiming.value,
    hpc104Ram: hpc104Ram ? hpc104Ram.buffer : null,
    cardB: cardB ? cardB.buffer : null,
    cardBWritable: true,
  }, [images.sysRom.buffer, images.lcdCharRom.buffer, images.cgRom.buffer]);

  applyStandby();
  applySystemTick();
  applyRamFill();

  // Already handed to the worker in the init message; just adopt them locally.
  if (card) { SLOTS.A.image = card; currentCard = card; }
  if (cardB) SLOTS.B.image = cardB;

  els.hpc104Panel.hidden = !els.hpc104.checked;
  syncPeripheralPanels();
  refreshCardUI(SLOTS.A);
  refreshCardUI(SLOTS.B);
}

boot();
