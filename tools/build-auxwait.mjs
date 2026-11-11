// Builds AUXWAIT.COM - a 76-byte DOS program that raises the Portfolio's
// RS-232 receive timeout on real hardware.
//
//   AUXWAIT 14      COPY AUX ... will now wait ~60 s of silence
//   AUXWAIT         restores the BIOS default of 1 (~4.25 s)
//
// The timeout lives at 0040:007C, the COM1 entry of the BIOS RS-232 timeout
// table, and scales at about 4.25 s per unit. One write holds until the next
// reset, so this is a run-once-per-boot program, not a resident driver.
//
// Assembled by hand because the project has no toolchain; the listing below is
// the source. Regenerate with:  node tools/build-auxwait.mjs
//
// Verified on the emulated ROM: AUXWAIT 14 sets the byte to 0Eh, after which a
// ten-second pause in the middle of COPY AUX no longer aborts the transfer.

import fs from 'node:fs';

const MSG = 'AUX timeout set\r\n$';
const MSG_ADDR = 0x100 + 0x3A;

const code = [
  0xBE, 0x81, 0x00,             // 00  mov si, 0081h      command tail
  0x31, 0xDB,                   // 03  xor bx, bx
  // skip:
  0xAC,                         // 05  lodsb
  0x3C, 0x20,                   // 06  cmp al, ' '
  0x74, 0xFB,                   // 08  je skip
  0x4E,                         // 0A  dec si
  // digits:
  0xAC,                         // 0B  lodsb
  0x2C, 0x30,                   // 0C  sub al, '0'
  0x72, 0x12,                   // 0E  jb done
  0x3C, 0x09,                   // 10  cmp al, 9
  0x77, 0x0E,                   // 12  ja done
  0x88, 0xC2,                   // 14  mov dl, al
  0x88, 0xD8,                   // 16  mov al, bl
  0xB7, 0x0A,                   // 18  mov bh, 10
  0xF6, 0xE7,                   // 1A  mul bh             ax = bl * 10
  0x00, 0xD0,                   // 1C  add al, dl
  0x88, 0xC3,                   // 1E  mov bl, al
  0xEB, 0xE9,                   // 20  jmp digits
  // done:
  0x08, 0xDB,                   // 22  or bl, bl
  0x75, 0x02,                   // 24  jnz have
  0xB3, 0x01,                   // 26  mov bl, 1          no argument -> BIOS default
  // have:
  0xB4, 0x09,                   // 28  mov ah, 9
  0xBA, MSG_ADDR & 0xFF, MSG_ADDR >> 8,  // 2A  mov dx, msg
  0xCD, 0x21,                   // 2D  int 21h
  0xB8, 0x40, 0x00,             // 2F  mov ax, 0040h      BIOS data area
  0x8E, 0xD8,                   // 32  mov ds, ax
  0x88, 0x1E, 0x7C, 0x00,       // 34  mov [007Ch], bl    COM1 RS-232 timeout
  0xCD, 0x20,                   // 38  int 20h
];

if (code.length !== 0x3A) throw new Error(`kod ma ${code.length.toString(16)}h bajtow, oczekiwano 3Ah`);

const com = Uint8Array.from([...code, ...[...MSG].map((c) => c.charCodeAt(0))]);
fs.writeFileSync(new URL('auxwait.com', import.meta.url), com);
console.log(`AUXWAIT.COM: ${com.length} bajtow`);
console.log([...com].map((b) => b.toString(16).padStart(2, '0')).join(' '));
