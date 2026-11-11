// Images for a Portfolio EPROM card, laid out the way "DISK zu EPROM Konverter"
// (SWB 1992, Harun Scheutzow for tri tec) wrote them on the Atari ST.
//
// That program did not build a file system of its own: it copied an ST floppy
// sector by sector and adjusted the boot sector so the Portfolio would accept
// it. What comes out is therefore ST-flavoured FAT12, and this module rebuilds
// it from files instead of from a floppy:
//
//   sector 0        boot sector, ST header (E9 00, "NNNNNN", serial) + BPB
//   sector 1        the one FAT
//   sectors 2..     root directory, cut down to what it holds
//   then            clusters of two sectors, contiguous, in directory order
//   sector 255      a copy of the boot sector
//   everything else zero
//
// Every value in the BPB is the converter's. Its own messages say why some of
// them must be exactly so: one FAT, the true number of sectors on the medium
// "or the Portfolio goes wrong", and eight sectors per track on two sides,
// "the Portfolio recognises nothing else". The copy in the last sector is the
// converter's too; nothing here depends on it, but the cards it made work and
// it costs nothing to keep, because that sector lies outside every cluster.
//
// A bank is 128 KB, the size of the card window in the Portfolio's memory map.
// A larger EPROM holds several banks one after another, each a volume of its
// own; the card decides which one the Portfolio sees.

import { t } from '../ui/i18n.js';
import { formatNumber } from '../ui/format.js';

export const BANK_SIZE = 0x20000;
const SECTOR = 512;
const SECTORS = BANK_SIZE / SECTOR;          // 256
const CLUSTER_SECTORS = 2;
const CLUSTER = SECTOR * CLUSTER_SECTORS;    // 1024
const ENTRIES_PER_SECTOR = SECTOR / 32;      // 16
const ENTRIES_PER_CLUSTER = CLUSTER / 32;    // 32
const MAX_ROOT_SECTORS = 7;

export const MAX_FILE_SIZE = 126 * CLUSTER;

/** EPROMs the converter offered, from 128 KB up; each holds size / 128 KB banks. */
export const EPROM_TYPES = [
  { id: '27C010', size: 0x20000 },
  { id: '27C020', size: 0x40000 },
  { id: '27C040', size: 0x80000 },
  { id: '27C080', size: 0x100000 },
];

// The converter's boot sector, up to the end of the BPB. Bytes 17-18 (root
// entries) are filled in per bank; everything past byte 29 is zero.
const BOOT_HEAD = [
  0xE9, 0x00, 0x4E, 0x4E, 0x4E, 0x4E, 0x4E, 0x4E, 0x0E, 0x5F, 0xB3,   // ST header
  0x00, 0x02,             // 512 bytes per sector
  CLUSTER_SECTORS,        // sectors per cluster
  0x01, 0x00,             // one reserved sector
  0x01,                   // one FAT
  0x10, 0x00,             // root entries (patched)
  0x00, 0x01,             // 256 sectors
  0xF9,                   // media descriptor
  0x01, 0x00,             // one sector per FAT
  0x08, 0x00,             // 8 sectors per track
  0x02, 0x00,             // 2 heads
  0x00, 0x00,             // no hidden sectors
];

const MEDIA = 0xF9;
const ATTR_ARCHIVE = 0x20;
const ATTR_DIRECTORY = 0x10;
const ATTR_VOLUME = 0x08;
const ATTR_LFN = 0x0F;

// ---- names ----------------------------------------------------------------

// What DOS accepts in a short name besides letters and digits.
const NAME_EXTRA = "!#$%&'()-@^_`{}~";

function cleanPart(s) {
  let out = '';
  for (const ch of s.toUpperCase()) {
    if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || NAME_EXTRA.includes(ch)) out += ch;
    else if (ch !== ' ') out += '_';
  }
  return out;
}

/**
 * A DOS 8.3 name for `name`, unique among `taken` (a Set of names already used
 * in the same directory). Returns the short name and whether it had to differ
 * from the original beyond case.
 */
export function shortName(name, taken = new Set()) {
  const dot = name.lastIndexOf('.');
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const rawExt = dot > 0 ? name.slice(dot + 1) : '';
  const base = cleanPart(rawBase) || '_';
  const ext = cleanPart(rawExt).slice(0, 3);
  const join = (b) => (ext ? `${b}.${ext}` : b);

  const lossless = base.length <= 8 && base === rawBase.toUpperCase() &&
                   ext === rawExt.toUpperCase();
  const plain = join(base.slice(0, 8));
  if (!taken.has(plain)) return { name: plain, changed: !lossless };

  for (let n = 1; n < 1000; n++) {
    const tail = `~${n}`;
    const cand = join(base.slice(0, 8 - tail.length) + tail);
    if (!taken.has(cand)) return { name: cand, changed: true };
  }
  throw new Error(t('Za dużo podobnych nazw w jednym katalogu: {0}', name));
}

/** A volume label as the directory entry holds it: up to 11 characters. */
export function cleanLabel(label) {
  return cleanPart(String(label || '').trim()).slice(0, 11);
}

// ---- dates ----------------------------------------------------------------

/** DOS date and time words for a JavaScript Date, in local time. */
export function dosStamp(d) {
  const y = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/** The Date a DOS date and time word stand for, or null if they are not a date. */
export function fromDosStamp(date, time) {
  const month = (date >> 5) & 15;
  const day = date & 31;
  if (!month || month > 12 || !day) return null;
  return new Date(1980 + (date >> 9), month - 1, day,
                  time >> 11, (time >> 5) & 63, (time & 31) * 2);
}

// ---- the tree -------------------------------------------------------------
//
// A bank's contents are a list of nodes:
//   { name, dir: false, data: Uint8Array, date, time }
//   { name, dir: true, children: [...], date, time }
// `name` is the 8.3 short name; `date` and `time` are DOS words. The order of a
// list is the order of the directory, and so the order DIR prints.

const clustersFor = (bytes) => Math.ceil(bytes / CLUSTER);

function dirClusters(children) {
  // "." and ".." come first in every subdirectory.
  return Math.max(1, Math.ceil((children.length + 2) / ENTRIES_PER_CLUSTER));
}

function countClusters(list) {
  let n = 0;
  for (const node of list) {
    n += node.dir ? dirClusters(node.children) + countClusters(node.children) : clustersFor(node.data.length);
  }
  return n;
}

/**
 * How a list of root entries fits into a bank: root sectors, clusters used and
 * clusters available. The root grows by two sectors at a time, so the data
 * area always has an odd number of sectors and the last sector of the bank
 * stays outside every cluster, free for the boot-sector copy.
 */
export function bankUsage(list) {
  const rootEntries = list.length + 1;                 // + the volume label
  let rootSectors = Math.ceil(rootEntries / ENTRIES_PER_SECTOR);
  if (rootSectors % 2 === 0) rootSectors++;
  const fits = rootSectors <= MAX_ROOT_SECTORS;
  rootSectors = Math.min(rootSectors, MAX_ROOT_SECTORS);
  const dataStart = 2 + rootSectors;
  const capacity = Math.floor((SECTORS - 1 - dataStart) / CLUSTER_SECTORS);
  const used = countClusters(list);
  return {
    rootSectors, rootEntries, rootCapacity: rootSectors * ENTRIES_PER_SECTOR,
    rootFits: fits, used, capacity, clusterBytes: CLUSTER,
    fits: fits && used <= capacity,
  };
}

/**
 * Builds one 128 KB bank. Throws, with a message for the user, if the
 * contents do not fit.
 */
export function buildBank(list, { label = '', now = new Date() } = {}) {
  const usage = bankUsage(list);
  if (!usage.rootFits) {
    throw new Error(t('Za dużo pozycji w katalogu głównym: {0}, mieści się {1}.',
                      list.length, MAX_ROOT_SECTORS * ENTRIES_PER_SECTOR - 1));
  }
  if (usage.used > usage.capacity) {
    throw new Error(t('Pliki zajmują {0} KB, a bank mieści {1} KB.', usage.used, usage.capacity));
  }

  const img = new Uint8Array(BANK_SIZE);
  const dv = new DataView(img.buffer);
  const stamp = dosStamp(now);

  img.set(BOOT_HEAD, 0);
  dv.setUint16(17, usage.rootSectors * ENTRIES_PER_SECTOR, true);

  const fatOff = SECTOR;
  const rootOff = 2 * SECTOR;
  const dataOff = (2 + usage.rootSectors) * SECTOR;
  const clusterOff = (c) => dataOff + (c - 2) * CLUSTER;

  const setFat = (c, v) => {
    const o = fatOff + c + (c >> 1);
    if (c & 1) {
      img[o] = (img[o] & 0x0F) | ((v << 4) & 0xF0);
      img[o + 1] = (v >> 4) & 0xFF;
    } else {
      img[o] = v & 0xFF;
      img[o + 1] = (img[o + 1] & 0xF0) | ((v >> 8) & 0x0F);
    }
  };
  setFat(0, 0xF00 | MEDIA);
  setFat(1, 0xFFF);

  let next = 2;
  const allocate = (count) => {
    if (!count) return 0;
    const first = next;
    for (let i = 0; i < count; i++) setFat(next + i, i === count - 1 ? 0xFFF : next + i + 1);
    next += count;
    return first;
  };

  const writeEntry = (off, name83, attr, cluster, size, date, time) => {
    const dot = name83.indexOf('.');
    const base = dot >= 0 ? name83.slice(0, dot) : name83;
    const ext = dot >= 0 ? name83.slice(dot + 1) : '';
    const field = (base.padEnd(8, ' ') + ext.padEnd(3, ' '));
    for (let i = 0; i < 11; i++) img[off + i] = field.charCodeAt(i);
    img[off + 11] = attr;
    dv.setUint16(off + 22, time, true);
    dv.setUint16(off + 24, date, true);
    dv.setUint16(off + 26, cluster, true);
    dv.setUint32(off + 28, size, true);
  };

  // The directory entries of one list, written into the given slots, with the
  // clusters of every entry allocated depth first in list order - a directory's
  // own clusters, then everything inside it - as the converter's images have it.
  const writeList = (items, slot, parentCluster) => {
    for (const node of items) {
      const date = node.date ?? stamp.date;
      const time = node.time ?? stamp.time;
      if (node.dir) {
        const n = dirClusters(node.children);
        const first = allocate(n);
        writeEntry(slot(), node.name, ATTR_DIRECTORY, first, 0, date, time);

        let i = 0;
        const inner = () => {
          const k = i++;
          const c = first + Math.floor(k / ENTRIES_PER_CLUSTER);
          return clusterOff(c) + (k % ENTRIES_PER_CLUSTER) * 32;
        };
        const dotSlot = inner();
        for (let j = 0; j < 11; j++) img[dotSlot + j] = 0x20;
        img[dotSlot] = 0x2E;
        img[dotSlot + 11] = ATTR_DIRECTORY;
        dv.setUint16(dotSlot + 22, time, true);
        dv.setUint16(dotSlot + 24, date, true);
        dv.setUint16(dotSlot + 26, first, true);
        const dotdot = inner();
        for (let j = 0; j < 11; j++) img[dotdot + j] = 0x20;
        img[dotdot] = 0x2E;
        img[dotdot + 1] = 0x2E;
        img[dotdot + 11] = ATTR_DIRECTORY;
        dv.setUint16(dotdot + 22, time, true);
        dv.setUint16(dotdot + 24, date, true);
        dv.setUint16(dotdot + 26, parentCluster, true);
        writeList(node.children, inner, first);
      } else {
        const first = allocate(clustersFor(node.data.length));
        writeEntry(slot(), node.name, node.attr ?? ATTR_ARCHIVE, first, node.data.length, date, time);
        for (let i = 0; i < node.data.length; i += CLUSTER) {
          img.set(node.data.subarray(i, i + CLUSTER), clusterOff(first + i / CLUSTER));
        }
      }
    }
  };

  let rootIndex = 0;
  const rootSlot = () => rootOff + 32 * rootIndex++;

  const vol = cleanLabel(label);
  if (vol) {
    const off = rootSlot();
    const field = vol.padEnd(11, ' ');
    for (let i = 0; i < 11; i++) img[off + i] = field.charCodeAt(i);
    img[off + 11] = ATTR_VOLUME;
    dv.setUint16(off + 22, stamp.time, true);
    dv.setUint16(off + 24, stamp.date, true);
  }
  writeList(list, rootSlot, 0);

  img.copyWithin((SECTORS - 1) * SECTOR, 0, SECTOR);
  return img;
}

/** Banks one after another, as the EPROM holds them. */
export function joinBanks(banks) {
  const out = new Uint8Array(banks.length * BANK_SIZE);
  banks.forEach((b, i) => out.set(b, i * BANK_SIZE));
  return out;
}

// ---- reading --------------------------------------------------------------
//
// Any FAT12 volume in a 128 KB bank: the converter's layout, or a card DIP-DOS
// formatted itself. Deleted entries and long-name fragments are skipped.

/** The label and the contents of a bank, in the tree form buildBank takes. */
export function readBank(img) {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const sectorSize = dv.getUint16(11, true);
  const perCluster = img[13];
  const reserved = dv.getUint16(14, true);
  const fats = img[16];
  const rootEntries = dv.getUint16(17, true);
  const fatSectors = dv.getUint16(22, true);
  if (![128, 256, 512].includes(sectorSize) || !perCluster || !fats || !rootEntries) {
    throw new Error(t('Ten bank nie zawiera systemu plików FAT12.'));
  }

  const clusterSize = sectorSize * perCluster;
  const fatOff = reserved * sectorSize;
  const rootOff = (reserved + fats * fatSectors) * sectorSize;
  const dataOff = rootOff + Math.ceil(rootEntries * 32 / sectorSize) * sectorSize;
  const maxCluster = Math.floor((img.length - dataOff) / clusterSize) + 1;

  const fat = (c) => {
    const o = fatOff + c + (c >> 1);
    const w = img[o] | (img[o + 1] << 8);
    return c & 1 ? w >> 4 : w & 0xFFF;
  };
  const chain = (first) => {
    const out = [];
    for (let c = first; c >= 2 && c <= maxCluster && out.length <= maxCluster; c = fat(c)) out.push(c);
    return out;
  };
  const clusterOff = (c) => dataOff + (c - 2) * clusterSize;

  let label = '';
  const entries = (offsets) => {
    const out = [];
    for (const off of offsets) {
      const b0 = img[off];
      if (b0 === 0) break;
      if (b0 === 0xE5) continue;
      const attr = img[off + 11];
      if (attr === ATTR_LFN) continue;
      const raw = String.fromCharCode(...img.subarray(off, off + 11));
      if (attr & ATTR_VOLUME) { label = raw.trimEnd(); continue; }
      const base = raw.slice(0, 8).trimEnd();
      if (base === '.' || base === '..') continue;
      const ext = raw.slice(8).trimEnd();
      const name = ext ? `${base}.${ext}` : base;
      const date = dv.getUint16(off + 24, true);
      const time = dv.getUint16(off + 22, true);
      const first = dv.getUint16(off + 26, true);
      if (attr & ATTR_DIRECTORY) {
        const slots = [];
        for (const c of chain(first)) {
          for (let k = 0; k < clusterSize / 32; k++) slots.push(clusterOff(c) + k * 32);
        }
        out.push({ name, dir: true, date, time, children: entries(slots) });
      } else {
        const size = dv.getUint32(off + 28, true);
        const data = new Uint8Array(size);
        let at = 0;
        for (const c of chain(first)) {
          if (at >= size) break;
          const n = Math.min(clusterSize, size - at);
          data.set(img.subarray(clusterOff(c), clusterOff(c) + n), at);
          at += n;
        }
        if (at < size) throw new Error(t('Plik {0} jest w obrazie urwany.', name));
        out.push({ name, dir: false, date, time, attr, data });
      }
    }
    return out;
  };

  const rootSlots = [];
  for (let k = 0; k < rootEntries; k++) rootSlots.push(rootOff + k * 32);
  const items = entries(rootSlots);
  return { label, items };
}

/** Splits an EPROM image into its banks; the length must be a whole number of them. */
export function splitBanks(img) {
  if (!img.length || img.length % BANK_SIZE) {
    throw new Error(t('Plik ma {0} B, a obraz EPROM to wielokrotność 128 KB.', formatNumber(img.length)));
  }
  const out = [];
  for (let o = 0; o < img.length; o += BANK_SIZE) out.push(img.subarray(o, o + BANK_SIZE));
  return out;
}
