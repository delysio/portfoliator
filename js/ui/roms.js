// User-supplied ROM images: identification, verification and persistence.
//
// The Portfolio ROM and DIP-DOS belong to Atari Corp. and DIP Ltd., so this
// project cannot ship them and a public deployment must not host them either.
// The user provides their own dump, and it stays where they put it: the files
// are read locally, kept in IndexedDB and never sent anywhere.
//
// Files are identified by content rather than by name. Nobody renames a dump to
// match our table, dumps circulate under half a dozen conventions, and the
// u3/u4 numbering is misleading anyway - the BIOS half is the one carrying the
// reset vector, whatever the file is called.

import * as storage from './storage.js';
import { t } from './i18n.js';

/**
 * The four images the machine needs, in the order the dialog lists them.
 *
 * `label` and `role` are Polish source text rather than identifiers, and are
 * translated where they are displayed. They are listed in the dictionary through
 * the calls in `describeRole` below, so the completeness check can see them.
 */
export const ROLES = {
  romApp: {
    label: 'ROM aplikacji',
    file: 'c101782-007.u4',
    size: 0x20000,
    role: 'wbudowane aplikacje, bankowane w C0000h–DFFFFh',
  },
  romBios: {
    label: 'BIOS + DIP-DOS',
    file: 'c101781-007.u3',
    size: 0x20000,
    role: 'system, na stałe w E0000h–FFFFFh',
  },
  lcdCharRom: {
    label: 'Generator znaków LCD',
    file: 'c101783-001a-01.u3',
    size: 0x8000,
    role: 'zewnętrzna tablica znaków ekranu',
  },
  cgRom: {
    label: 'Generator znaków HD61830',
    file: 'hd61830.bin',
    size: 1472,
    role: 'tablica wewnętrzna sterownika LCD',
  },
};

/**
 * The two descriptions the ROM dialog shows for one image, translated. Written
 * out as literal t(…) calls on purpose: that is what makes the strings visible
 * to tools/i18n-check.mjs, which reads the source rather than running it.
 */
export function describeRole(key) {
  switch (key) {
    case 'romApp':
      return { label: t('ROM aplikacji'), role: t('wbudowane aplikacje, bankowane w C0000h–DFFFFh') };
    case 'romBios':
      return { label: t('BIOS + DIP-DOS'), role: t('system, na stałe w E0000h–FFFFFh') };
    case 'lcdCharRom':
      return { label: t('Generator znaków LCD'), role: t('zewnętrzna tablica znaków ekranu') };
    case 'cgRom':
      return { label: t('Generator znaków HD61830'), role: t('tablica wewnętrzna sterownika LCD') };
    default:
      return { label: ROLES[key].label, role: ROLES[key].role };
  }
}

/**
 * The dumps this emulator was actually tested against (DIP-DOS 2.11, ROM
 * v1.072). Anything else still runs - see identify() - but runs unverified.
 *
 * MAINTENANCE: these values are quoted in three other places, and adding a
 * revision means updating all of them: README-PL.MD and README.md (section
 * "Testowane rewizje" / "Tested revisions"), plus the note in the manual dialog
 * in index.html. The checksum table inside the ROM dialog is built from this
 * object at runtime, so that one follows by itself.
 */
export const TESTED = {
  romApp: {
    crc32: 'C9852766',
    sha256: '82ceb9b0a3541191525d87c04c2fe832905fad71bffd162f960b59c0dfb649e6',
  },
  romBios: {
    crc32: 'B8FB730D',
    sha256: '3fd92628ca0f8960149b20700f486c4109eb4a9c0ae7d5a857eb13e9f440c223',
  },
  lcdCharRom: {
    crc32: '61FDAFF1',
    sha256: '60a971516b85b160fb343141b12811af4e627423b8e4e1dc33ef16f19e542cd9',
  },
  cgRom: {
    crc32: '06A934DA',
    sha256: '8738511c6a2f02b0ef1be2cde90898458b4517151cb473ff28ae212dbd1c1737',
  },
};

export const ROLE_KEYS = Object.keys(ROLES);

/** Size of one half of the system ROM region, and of a combined dump. */
const HALF = 0x20000;
const COMBINED = HALF * 2;

/** The reset vector at FFFF0h is a far jump; nothing else in the image is. */
const RESET_OFFSET = 0x1FFF0;
const JMP_FAR = 0xEA;

const STORAGE_KEY = 'rom:set';

// ---- fingerprints ---------------------------------------------------------

// SHA-256 is the authoritative check, but crypto.subtle only exists in a secure
// context - and someone serving this over plain http:// from a LAN address has
// no secure context and would see every correct file reported as an unknown
// revision. CRC32 needs no such privilege, so it runs everywhere and carries
// the identification when SubtleCrypto is missing. It is a weaker check, but
// this is a "did I test with this dump" question, not a security boundary.

let crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c >>> 0;
    }
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

async function sha256(bytes) {
  if (!globalThis.crypto || !crypto.subtle) return null;
  try {
    // A copy, because digest() rejects a view onto a SharedArrayBuffer and we
    // would rather not care where the caller's bytes came from.
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

async function fingerprint(bytes) {
  return { crc32: crc32(bytes), sha256: await sha256(bytes) };
}

/** Which tested dump this is, or null. SHA-256 decides when we have it. */
function matchTested(print) {
  for (const key of ROLE_KEYS) {
    const known = TESTED[key];
    if (print.sha256) {
      if (print.sha256 === known.sha256) return key;
    } else if (print.crc32 === known.crc32) {
      return key;
    }
  }
  return null;
}

// ---- identification -------------------------------------------------------

function hasResetVector(half) {
  return half[RESET_OFFSET] === JMP_FAR;
}

/** Structural guess for one image, used when the fingerprint is unknown. */
function roleBySize(bytes) {
  if (bytes.length === ROLES.lcdCharRom.size) return 'lcdCharRom';
  if (bytes.length === ROLES.cgRom.size) return 'cgRom';
  if (bytes.length === HALF) return hasResetVector(bytes) ? 'romBios' : 'romApp';
  return null;
}

async function entryFor(bytes, name) {
  const print = await fingerprint(bytes);
  const tested = matchTested(print);
  const role = tested || roleBySize(bytes);
  if (!role) return null;

  return {
    role,
    bytes,
    name,
    size: bytes.length,
    crc32: print.crc32,
    sha256: print.sha256,
    tested: tested === role,
  };
}

/**
 * Reads one dropped file and works out what it is. Returns zero, one or - for a
 * combined dump of both system ROMs - two entries. A 256K dump is common enough
 * that refusing it would strand people holding a perfectly good image.
 */
export async function identify(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.length === COMBINED) {
    const first = bytes.slice(0, HALF);
    const second = bytes.slice(HALF);

    // Either order occurs in the wild; the reset vector says which is which.
    let app = null;
    let bios = null;
    if (hasResetVector(second)) { app = first; bios = second; }
    else if (hasResetVector(first)) { app = second; bios = first; }
    else return [];

    const entries = await Promise.all([
      entryFor(app, t('{0} (część 1)', file.name)),
      entryFor(bios, t('{0} (część 2)', file.name)),
    ]);
    return entries.filter(Boolean);
  }

  const entry = await entryFor(bytes, file.name);
  return entry ? [entry] : [];
}

// ---- sets -----------------------------------------------------------------

export function isComplete(set) {
  return !!set && ROLE_KEYS.every((key) => set[key]);
}

/** True when at least one image is not one of the dumps we tested with. */
export function hasUntested(set) {
  return ROLE_KEYS.some((key) => set[key] && !set[key].tested);
}

/**
 * Lays the two system halves out the way the memory map expects and hands back
 * buffers the caller may transfer to the worker. The originals are copied, so
 * the set stays usable afterwards - a transferred buffer is detached, and the
 * dialog still has to show what is loaded.
 */
export function assemble(set) {
  const sysRom = new Uint8Array(0x40000);
  sysRom.set(set.romApp.bytes, 0x00000);
  sysRom.set(set.romBios.bytes, 0x20000);

  if (sysRom[0x3FFF0] !== JMP_FAR) {
    throw new Error(t('brak wektora reset (JMP FAR) pod FFFF0h — pliki systemowe zamienione miejscami?'));
  }

  return {
    sysRom,
    lcdCharRom: set.lcdCharRom.bytes.slice(),
    cgRom: set.cgRom.bytes.slice(),
  };
}

// ---- sources --------------------------------------------------------------

/**
 * The rom/ directory, for local work and private deployments. Absent on the
 * public one, where a missing file is the normal case rather than an error.
 */
export async function fromDirectory() {
  const files = await Promise.all(ROLE_KEYS.map(async (key) => {
    try {
      const res = await fetch(`rom/${ROLES[key].file}`, { cache: 'no-cache' });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }));

  if (files.some((f) => f === null)) return null;

  const set = {};
  for (let i = 0; i < ROLE_KEYS.length; i++) {
    const key = ROLE_KEYS[i];
    const entry = await entryFor(files[i], ROLES[key].file);

    // Trust the directory over the structural guess: these files sit under the
    // names the emulator asks for, so a mismatch is worth reporting as a wrong
    // file rather than quietly filing it under some other role.
    if (!entry || entry.role !== key) return null;
    set[key] = entry;
  }
  return set;
}

export async function fromStorage() {
  const set = await storage.getShared(STORAGE_KEY).catch(() => null);
  return isComplete(set) ? set : null;
}

export async function save(set) {
  await storage.putShared(STORAGE_KEY, set);
  await storage.requestPersistence();
}

export function clear() {
  return storage.removeShared(STORAGE_KEY);
}
