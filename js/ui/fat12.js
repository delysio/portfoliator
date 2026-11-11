// FAT12 reader/writer for Atari Portfolio memory cards.
//
// DIP-DOS formats a card so that it always has exactly 256 sectors; it scales
// the *sector size* with the card instead of the sector count:
//
//   card    sector  sectors  root entries  FAT sectors  capacity
//    32 KB    128       256        32            3          31 232 B
//    64 KB    256       256        64            2          62 720 B
//   128 KB    512       256       128            1         125 952 B
//   256 KB    512       511       128            2         256 000 B
//
// The last row is the odd one out twice over: it is the only size that does not
// fit the 128 KB card window and has to be paged, and the only one whose volume
// is not laid out flat - see sectorOffset() below.
//
// Everything else is ordinary FAT12: one FAT, one sector per cluster, media
// descriptor 0xFF, OEM name "DIP 2.0". The layouts here were captured from
// images the ROM's own FORMAT command produced, and js/ui/fat12.test verifies
// that formatCard() reproduces them byte for byte.

// Boot sector of a 128 KB card as written by DIP-DOS FORMAT. Smaller cards get
// this same sector truncated to their sector size, with the 0x55AA signature
// moved to the last two bytes.
import { t } from './i18n.js';

const BOOT_SECTOR_B64 =
  '6yIARElQIDIuMAAAAgEBAAGAAAAB/wEACAACAAAAAAAAAAAAuAcAzRC4ARO7BwAz0g4HvUMAkLk5AJDN' +
  'ELQAzRbNGU5vbi1TeXN0ZW0gZGlzayBvciBkaXNrIGVycm9yLg0KUmVwbGFjZSBhbmQgcHJlc3MgYW55' +
  'IGtleQA=';

const SUPPORTED = {
  32768:  { sectorSize: 128, rootEntries: 32,  fatSectors: 3, totalSectors: 256 },
  65536:  { sectorSize: 256, rootEntries: 64,  fatSectors: 2, totalSectors: 256 },
  131072: { sectorSize: 512, rootEntries: 128, fatSectors: 1, totalSectors: 256 },
  262144: { sectorSize: 512, rootEntries: 128, fatSectors: 2, totalSectors: 511 },
};

export const CARD_SIZES = [32768, 65536, 131072, 262144];

// A card larger than the 128 KB window in the CPU map is paged, and DIP-DOS does
// not lay its volume out flat across those pages. Measured against the ROM's own
// writing: a file whose directory entry gives cluster 386 - sector 395 by the
// BPB - has its data at sector 397, one kilobyte further into the card.
//
// A kilobyte is two sectors, and where those two sit was read back from the ROM
// itself, by watching which window addresses it drives while reading a file that
// runs across the boundary. On a 256 KB card it reads volume sector 254 from
// page 0 at 1FC00h and then goes straight to page 1 at 200h - so the pair left
// out is the LAST sector of a page together with the first of the next, not the
// first two of the next. The difference is a single sector, and it only shows on
// a file long enough to occupy it: everything before and after still lines up,
// which is why getting it wrong corrupts exactly 512 bytes in the middle of one
// file and nothing else.
const CARD_PAGE = 0x20000;
const PAGE_GAP = 1024;

/** Where a volume sector physically sits in the image. */
function sectorOffset(bpb, sector) {
  const flat = sector * bpb.sectorSize;
  // The gap opens before the sector that ends on the page boundary, hence the
  // sector size added in before the division.
  return flat + bpb.pageGap * Math.floor((flat + bpb.sectorSize) / CARD_PAGE);
}

const ATTR_VOLUME = 0x08;
const ATTR_DIRECTORY = 0x10;
const ATTR_LFN = 0x0F;

function decodeBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- geometry -------------------------------------------------------------

export function readBPB(image) {
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const sectorSize = dv.getUint16(11, true);
  const sectorsPerCluster = image[13];
  const reservedSectors = dv.getUint16(14, true);
  const numFATs = image[16];
  const rootEntries = dv.getUint16(17, true);
  const totalSectors = dv.getUint16(19, true);
  const fatSectors = dv.getUint16(22, true);

  if (!sectorSize || !sectorsPerCluster || !numFATs || !totalSectors) {
    throw new Error(t('To nie wygląda na sformatowaną kartę (uszkodzony BPB).'));
  }

  const rootSectors = Math.ceil((rootEntries * 32) / sectorSize);
  const fatStart = reservedSectors * sectorSize;
  const rootStart = (reservedSectors + numFATs * fatSectors) * sectorSize;
  const dataStartSector = reservedSectors + numFATs * fatSectors + rootSectors;
  const dataStart = dataStartSector * sectorSize;
  const dataSectors = totalSectors - dataStartSector;

  // The reserved area, the FAT and the root all live in the first page, so only
  // the data area feels the gap - but it decides how many clusters really fit.
  const pageGap = image.byteLength > CARD_PAGE ? PAGE_GAP : 0;
  const bpb = {
    sectorSize, sectorsPerCluster, reservedSectors, numFATs, rootEntries,
    totalSectors, fatSectors, rootSectors, fatStart, rootStart, dataStart,
    dataStartSector, pageGap,
    clusterSize: sectorSize * sectorsPerCluster,
  };

  let clusterCount = Math.floor(dataSectors / sectorsPerCluster);
  // A cluster the gap pushes past the end of the card is one the machine could
  // never reach; DIP's own BPB counts one such cluster on a 256 KB card.
  while (clusterCount > 0 &&
         sectorOffset(bpb, dataStartSector + clusterCount * sectorsPerCluster) > image.byteLength) {
    clusterCount--;
  }

  bpb.clusterCount = clusterCount;
  bpb.maxCluster = clusterCount + 1;   // clusters are numbered from 2
  return bpb;
}

// ---- formatting -----------------------------------------------------------

export function formatCard(sizeBytes) {
  const geom = SUPPORTED[sizeBytes];
  if (!geom) {
    throw new Error(t('Nieobsługiwany rozmiar karty: {0} B. Dozwolone: 32, 64, 128, 256 KB.', sizeBytes));
  }

  const image = new Uint8Array(sizeBytes);
  const template = decodeBase64(BOOT_SECTOR_B64);
  const { sectorSize, rootEntries, fatSectors, totalSectors } = geom;

  // Boot sector: the shared template truncated to this card's sector size.
  image.set(template.subarray(0, Math.min(template.length, sectorSize)), 0);

  const dv = new DataView(image.buffer);
  dv.setUint16(11, sectorSize, true);      // bytes per sector
  image[13] = 1;                           // sectors per cluster
  dv.setUint16(14, 1, true);               // reserved sectors
  image[16] = 1;                           // number of FATs
  dv.setUint16(17, rootEntries, true);
  dv.setUint16(19, totalSectors, true);
  image[21] = 0xFF;                        // media descriptor
  dv.setUint16(22, fatSectors, true);
  dv.setUint16(24, 8, true);               // sectors per track
  dv.setUint16(26, 2, true);               // heads

  image[sectorSize - 2] = 0x55;
  image[sectorSize - 1] = 0xAA;

  // FAT: entry 0 holds the media descriptor, entry 1 the end-of-chain marker.
  const fatStart = sectorSize;
  image[fatStart] = 0xFF;
  image[fatStart + 1] = 0xFF;
  image[fatStart + 2] = 0xFF;

  // FORMAT fills the data area with 0xF6, the traditional MS-DOS fill byte.
  // Nothing reads it, but matching it keeps our images identical to the ROM's.
  const rootSectors = Math.ceil((rootEntries * 32) / sectorSize);
  image.fill(0xF6, (1 + fatSectors + rootSectors) * sectorSize);

  return image;
}

// ---- FAT access -----------------------------------------------------------

function getFAT(image, bpb, cluster) {
  const off = bpb.fatStart + cluster + (cluster >> 1);
  const word = image[off] | (image[off + 1] << 8);
  return (cluster & 1) ? (word >> 4) : (word & 0xFFF);
}

function setFAT(image, bpb, cluster, value) {
  const off = bpb.fatStart + cluster + (cluster >> 1);
  const word = image[off] | (image[off + 1] << 8);
  const next = (cluster & 1)
    ? ((word & 0x000F) | ((value & 0xFFF) << 4))
    : ((word & 0xF000) | (value & 0xFFF));
  image[off] = next & 0xFF;
  image[off + 1] = (next >> 8) & 0xFF;
}

function clusterOffset(bpb, cluster) {
  return sectorOffset(bpb, bpb.dataStartSector + (cluster - 2) * bpb.sectorsPerCluster);
}

function freeClusters(image, bpb) {
  const free = [];
  for (let c = 2; c <= bpb.maxCluster; c++) if (getFAT(image, bpb, c) === 0) free.push(c);
  return free;
}

export function freeSpace(image) {
  const bpb = readBPB(image);
  return freeClusters(image, bpb).length * bpb.clusterSize;
}

export function totalSpace(image) {
  const bpb = readBPB(image);
  return bpb.clusterCount * bpb.clusterSize;
}

// ---- 8.3 names ------------------------------------------------------------

/** Converts a host filename into a padded 11-byte 8.3 field. */
export function toShortName(filename) {
  const base = filename.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  let name = (dot > 0 ? base.slice(0, dot) : base);
  let ext = (dot > 0 ? base.slice(dot + 1) : '');

  const clean = (s) => s.toUpperCase().replace(/[^A-Z0-9_^$~!#%&\-{}()@'`]/g, '_');

  name = clean(name).slice(0, 8).padEnd(8, ' ');
  ext = clean(ext).slice(0, 3).padEnd(3, ' ');
  return name + ext;
}

function formatName(raw) {
  const name = raw.slice(0, 8).replace(/ +$/, '');
  const ext = raw.slice(8, 11).replace(/ +$/, '');
  return ext ? `${name}.${ext}` : name;
}

// ---- directory ------------------------------------------------------------

export function listFiles(image) {
  const bpb = readBPB(image);
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const out = [];

  for (let i = 0; i < bpb.rootEntries; i++) {
    const off = bpb.rootStart + i * 32;
    const first = image[off];
    if (first === 0x00) break;         // no further entries were ever used
    if (first === 0xE5) continue;      // deleted

    const attr = image[off + 11];
    if (attr === ATTR_LFN) continue;

    let raw = '';
    for (let j = 0; j < 11; j++) raw += String.fromCharCode(image[off + j]);

    out.push({
      index: i,
      raw,
      name: formatName(raw),
      attr,
      isVolume: !!(attr & ATTR_VOLUME),
      isDirectory: !!(attr & ATTR_DIRECTORY),
      cluster: dv.getUint16(off + 26, true),
      size: dv.getUint32(off + 28, true),
      time: dv.getUint16(off + 22, true),
      date: dv.getUint16(off + 24, true),
    });
  }
  return out;
}

function findEntry(image, bpb, shortName) {
  for (let i = 0; i < bpb.rootEntries; i++) {
    const off = bpb.rootStart + i * 32;
    if (image[off] === 0x00) return -1;
    if (image[off] === 0xE5) continue;
    let raw = '';
    for (let j = 0; j < 11; j++) raw += String.fromCharCode(image[off + j]);
    if (raw === shortName) return i;
  }
  return -1;
}

function findFreeEntry(image, bpb) {
  for (let i = 0; i < bpb.rootEntries; i++) {
    const first = image[bpb.rootStart + i * 32];
    if (first === 0x00 || first === 0xE5) return i;
  }
  return -1;
}

function packDate(d) {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}

function packTime(d) {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
}

export function unpackDate(date, time) {
  if (!date) return null;
  return new Date(
    1980 + ((date >> 9) & 0x7F), ((date >> 5) & 0x0F) - 1, date & 0x1F,
    (time >> 11) & 0x1F, (time >> 5) & 0x3F, (time & 0x1F) * 2);
}

// ---- file operations ------------------------------------------------------

export function deleteFile(image, filename) {
  const bpb = readBPB(image);
  const shortName = toShortName(filename);
  const idx = findEntry(image, bpb, shortName);
  if (idx < 0) return false;

  const off = bpb.rootStart + idx * 32;
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);

  // Release the cluster chain.
  let cluster = dv.getUint16(off + 26, true);
  while (cluster >= 2 && cluster <= bpb.maxCluster) {
    const next = getFAT(image, bpb, cluster);
    setFAT(image, bpb, cluster, 0);
    if (next < 2 || next > bpb.maxCluster) break;
    cluster = next;
  }

  image[off] = 0xE5;
  return true;
}

export function addFile(image, filename, data, mtime) {
  const bpb = readBPB(image);
  const shortName = toShortName(filename);

  if (findEntry(image, bpb, shortName) >= 0) deleteFile(image, filename);

  const needed = Math.ceil(data.length / bpb.clusterSize);
  const free = freeClusters(image, bpb);
  if (free.length < needed) {
    throw new Error(
      t('Za mało miejsca na "{0}": potrzeba {1} klastrów, wolnych {2}.', formatName(shortName), needed, free.length));
  }

  const idx = findFreeEntry(image, bpb);
  if (idx < 0) {
    throw new Error(t('Katalog główny jest pełny (limit {0} pozycji).', bpb.rootEntries));
  }

  // Write the data and chain the clusters.
  const chain = free.slice(0, needed);
  for (let i = 0; i < chain.length; i++) {
    const start = i * bpb.clusterSize;
    image.set(data.subarray(start, start + bpb.clusterSize), clusterOffset(bpb, chain[i]));
    setFAT(image, bpb, chain[i], i === chain.length - 1 ? 0xFFF : chain[i + 1]);
  }

  const off = bpb.rootStart + idx * 32;
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  for (let j = 0; j < 11; j++) image[off + j] = shortName.charCodeAt(j);
  image[off + 11] = 0x20;                     // archive
  for (let j = 12; j < 22; j++) image[off + j] = 0;

  const when = mtime instanceof Date ? mtime : new Date();
  dv.setUint16(off + 22, packTime(when), true);
  dv.setUint16(off + 24, packDate(when), true);
  dv.setUint16(off + 26, needed ? chain[0] : 0, true);
  dv.setUint32(off + 28, data.length, true);

  return formatName(shortName);
}

/**
 * Walks a path with subdirectories in it, which listFiles/readFile cannot: those
 * two only ever look at the root. The Portfolio keeps its own state under
 * `SYSTEM\`, so reaching it means following a directory's cluster chain and
 * reading the same 32-byte entries the root is made of.
 *
 *   readPath(image, 'SYSTEM/PERMDATA.DAT')
 *
 * @returns {Uint8Array|null} the file, or null if any part of the path is missing
 */
export function readPath(image, path) {
  const bpb = readBPB(image);
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return null;

  let cluster = null;                  // null = the root, which is not a chain
  for (let i = 0; i < parts.length - 1; i++) {
    const dir = dirEntries(image, bpb, cluster)
      .find((e) => e.raw === toShortName(parts[i]) && (e.attr & ATTR_DIRECTORY));
    if (!dir) return null;
    cluster = dir.cluster;
  }

  const entry = dirEntries(image, bpb, cluster)
    .find((e) => e.raw === toShortName(parts[parts.length - 1]) && !(e.attr & ATTR_DIRECTORY));
  return entry ? readChain(image, bpb, entry.cluster, entry.size) : null;
}

/** Raw 32-byte entries of one directory; a null cluster means the root. */
function dirEntries(image, bpb, cluster) {
  const out = [];
  const take = (from, length) => {
    for (let off = from; off + 32 <= from + length; off += 32) {
      const first = image[off];
      if (first === 0x00) return true;         // nothing was ever used past here
      if (first === 0xE5) continue;            // deleted
      if (image[off + 11] === ATTR_LFN) continue;
      let raw = '';
      for (let j = 0; j < 11; j++) raw += String.fromCharCode(image[off + j]);
      out.push({
        raw,
        attr: image[off + 11],
        cluster: image[off + 26] | (image[off + 27] << 8),
        size: image[off + 28] | (image[off + 29] << 8) |
              (image[off + 30] << 16) | (image[off + 31] << 24),
      });
    }
    return false;
  };

  if (cluster === null) {
    take(bpb.rootStart, bpb.rootEntries * 32);
    return out;
  }

  let c = cluster, guard = bpb.clusterCount + 2;
  while (c >= 2 && c <= bpb.maxCluster && guard-- > 0) {
    if (take(clusterOffset(bpb, c), bpb.clusterSize)) break;
    c = getFAT(image, bpb, c);
  }
  return out;
}

/** Follows a cluster chain and returns the first `size` bytes of it. */
function readChain(image, bpb, cluster, size) {
  const out = new Uint8Array(size);
  let written = 0, c = cluster, guard = bpb.clusterCount + 2;

  while (c >= 2 && c <= bpb.maxCluster && written < size && guard-- > 0) {
    const chunk = Math.min(bpb.clusterSize, size - written);
    const src = clusterOffset(bpb, c);
    out.set(image.subarray(src, src + chunk), written);
    written += chunk;
    c = getFAT(image, bpb, c);
  }
  return out;
}

export function readFile(image, filename) {
  const bpb = readBPB(image);
  const idx = findEntry(image, bpb, toShortName(filename));
  if (idx < 0) return null;

  const off = bpb.rootStart + idx * 32;
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const size = dv.getUint32(off + 28, true);
  const out = new Uint8Array(size);

  let cluster = dv.getUint16(off + 26, true);
  let written = 0;
  let guard = bpb.clusterCount + 2;

  while (cluster >= 2 && cluster <= bpb.maxCluster && written < size && guard-- > 0) {
    const chunk = Math.min(bpb.clusterSize, size - written);
    const src = clusterOffset(bpb, cluster);
    out.set(image.subarray(src, src + chunk), written);
    written += chunk;
    cluster = getFAT(image, bpb, cluster);
  }

  return out;
}
