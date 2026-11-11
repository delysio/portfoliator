// C:\SYSTEM\PERMDATA.DAT - everything the Portfolio remembers about itself.
//
// The built-in applications keep their settings in one 730-byte file on drive C:,
// and DIP's technical reference lays it out byte by byte (pages 3-35 and 3-36).
// It is the only place the emulator can see what the user chose inside Setup:
// the serial line settings, the printer, the calculator's memories, the file each
// application had open last.
//
// Two things about it are worth knowing before trusting what it says:
//
//   * the file is written when the user leaves the applications - ESC at the top
//     level menu - and not before. Every change made inside an application lives
//     in RAM until then, so a machine sitting inside the Editor still shows the
//     previous session's values here;
//   * a machine that has never been in an application has no such file at all.
//
// Drive C: is a RAM disk living inside NVRAM, in ordinary FAT12 with 128-byte
// sectors, so the card reader in fat12.js parses it unchanged once the volume is
// found. Its position is not fixed - the BIOS lays memory out at boot - so the
// boot sector is located by its signature rather than by a hardcoded address.

import { readBPB, readPath } from './fat12.js';
import { t } from './i18n.js';

// The on-board memory ends here: 0x1F000..0x1FFFF in machine.ram is the frame
// buffer, which the CPU sees at B0000h, and the linear space from 0x1F000 up
// belongs to the HPC-104 expansion.
const ONBOARD_END = 0x1F000;

const SIZE = 730;
const BAUD = [110, 150, 300, 600, 1200, 2400, 4800, 9600];
const PARITY = () => [t('brak'), t('nieparzysta'), t('parzysta')];
const EOL = () => ['CR', 'CR+LF', 'CR+LF+LF'];
const PRINTER_DEST = () => [t('port równoległy'), t('port szeregowy'), t('plik')];
const CALC_FORMAT = () => [t('ogólny'), t('stały'), t('naukowy'), t('inżynierski')];

/**
 * The machine's linear memory, as DOS lays it out.
 *
 * Without an expansion that is the on-board RAM alone, and drive C: ends exactly
 * where the video buffer begins. With an HPC-104 fitted the machine has 256 KB
 * more, mapped straight above - and DIP-DOS, having counted it on a cold start,
 * puts the RAM disk up there. Looking only at the on-board array then finds no
 * drive C: at all, which is what this join exists to prevent.
 */
export function linearMemory(ram, expansionRam = null) {
  const onboard = ram.subarray(0, Math.min(ram.length, ONBOARD_END));
  if (!expansionRam || !expansionRam.length) return onboard;

  const out = new Uint8Array(onboard.length + expansionRam.length);
  out.set(onboard, 0);
  out.set(expansionRam, onboard.length);
  return out;
}

/**
 * Finds the DIP RAM disk inside a memory image.
 *
 * The boot sector opens with a jump and carries "DIP" as the first three bytes of
 * its OEM name, which is enough to tell it from anything else in RAM. The scan
 * steps by 128 bytes because that is the volume's own sector size.
 *
 * @returns {number} byte offset of the boot sector, or -1
 */
export function findRamDisk(ram) {
  for (let a = 0; a + 512 <= ram.length; a += 128) {
    if (ram[a] !== 0xEB && ram[a] !== 0xE9) continue;
    if (ram[a + 3] === 0x44 && ram[a + 4] === 0x49 && ram[a + 5] === 0x50) return a;   // "DIP"
  }
  return -1;
}

/** The RAM disk as an image fat12.js can read, or null if there is none. */
export function ramDiskImage(ram, expansionRam = null) {
  const memory = linearMemory(ram, expansionRam);
  const base = findRamDisk(memory);
  if (base < 0) return null;

  try {
    const head = readBPB(memory.subarray(base, base + 512));
    const end = base + head.totalSectors * head.sectorSize;
    return end <= memory.length ? memory.subarray(base, end) : null;
  } catch {
    return null;                       // signature matched something that is not a BPB
  }
}

/**
 * Reads and decodes the file.
 *
 * @returns {{ok: true, data: object}|{ok: false, why: string}}
 */
export function readPermdata(ram, expansionRam = null) {
  const image = ramDiskImage(ram, expansionRam);
  if (!image) return { ok: false, why: t('Nie znaleziono dysku C: w pamięci maszyny.') };

  // Forward slash on purpose: readPath takes either separator, and this one does
  // not have to survive being escaped every time the line is edited.
  const bytes = readPath(image, 'SYSTEM/PERMDATA.DAT');
  if (!bytes) {
    return {
      ok: false,
      why: t('Portfolio nie zapisało jeszcze tego pliku. Powstaje przy wyjściu ' +
             'z wbudowanych aplikacji — wejdź w dowolną z nich i wróć klawiszem Esc.'),
    };
  }
  if (bytes.length < SIZE) {
    return { ok: false, why: t('Plik ma {0} B zamiast {1} — nie rozpoznaję tego układu.', bytes.length, SIZE) };
  }
  return { ok: true, data: decode(bytes) };
}

/** Zero-terminated ASCII path, as the applications store it. */
function text(bytes, from, to) {
  let out = '';
  for (let i = from; i <= to; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
  }
  return out;
}

const named = (table, i) => table[i] ?? t('nieznane ({0})', i);
const yesNo = (v) => (v ? t('tak') : t('nie'));

/** Byte offsets are DIP's, from the table on pages 3-35 and 3-36. */
export function decode(b) {
  const u16 = (o) => b[o] | (b[o + 1] << 8);

  return {
    system: {
      undeleteEnabled: yesNo(b[0x00]),
      undeleteSaved: yesNo(b[0x01]),
      clipboardEnabled: yesNo(b[0x02]),
      clipboardSaved: yesNo(b[0x03]),
    },
    worksheet: {
      frame: yesNo(b[0x07]),
      lastFile: text(b, 0x08, 0x56),
      autoload: yesNo(!b[0x57]),          // 0 = autoload, FFh = do not
      currency: text(b, 0x58, 0x5B),
      decimalPoint: String.fromCharCode(b[0x5C]),
      paperWidth: b[0x5D],
    },
    diary: {
      frame: yesNo(b[0x61]),
      lastFile: text(b, 0x62, 0xB0),
    },
    editor: {
      frame: yesNo(b[0xB5]),
      lastFile: text(b, 0xB6, 0x104),
      topLine: u16(0x105),
      cursorLine: u16(0x107),
      cursorColumn: u16(0x109),
      rightMargin: b[0x10B],
      wordWrap: yesNo(b[0x10C]),
    },
    address: {
      frame: yesNo(b[0x10F]),
      lastFile: text(b, 0x110, 0x15E),
      dialPrefix: text(b, 0x15F, 0x168),
    },
    calculator: {
      frame: yesNo(b[0x170]),
      format: named(CALC_FORMAT(), b[0x1F7]),
      decimals: b[0x1F8],
      separators: yesNo(b[0x1F9]),
      decimalComma: yesNo(b[0x1FA]),
    },
    printer: {
      destination: named(PRINTER_DEST(), b[0x24F]),
      file: text(b, 0x1FC, 0x24A),
      linesPerPage: b[0x250],
      setupCodeLength: b[0x251],
      endOfLine: named(EOL(), b[0x2D2]),
      marginTop: b[0x2D3],
      marginBottom: b[0x2D4],
      marginLeft: b[0x2D5],
    },
    // Confirmed against the Setup screen rather than taken on trust: a machine
    // showing 9600/None/8/1 there reads back 07h/00h/01h/00h here.
    serial: {
      baud: named(BAUD, b[0x2D6]),
      parity: named(PARITY(), b[0x2D7]),
      dataBits: b[0x2D8] ? 8 : 7,
      stopBits: b[0x2D9] ? 2 : 1,
    },
  };
}
