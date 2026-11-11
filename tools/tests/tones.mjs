// Checks our PCD3311 model against the melody table in DIP's technical reference
// (INT 61h Fn 16h, page 3-11). The manual lists the tone code the ROM writes and
// the note it is meant to sound; our tables come from the chip datasheet by way
// of MAME, so agreement is an independent cross-check of the whole sound chain.
import { PCD3311 } from '../../js/emu/pcd3311.js';

// code, note, frequency in Hz as printed in the manual
const MANUAL = [
  [0x30, 'D#5', 622.3], [0x31, 'E5', 659.3], [0x32, 'F5', 698.5], [0x33, 'F#5', 740.0],
  [0x34, 'G5', 784.0], [0x35, 'G#5', 830.6], [0x36, 'A5', 880.0], [0x37, 'A#5', 932.3],
  [0x38, 'B5', 987.8], [0x39, 'C6', 1046.5], [0x3A, 'C#6', 1108.7], [0x29, 'D6', 1174.7],
  [0x3B, 'D#6', 1244.5], [0x3C, 'E6', 1318.5], [0x3D, 'F6', 1396.9], [0x0E, 'F#6', 1480.0],
  [0x3E, 'G6', 1568.0], [0x2C, 'G#6', 1661.2], [0x3F, 'A6', 1760.0], [0x04, 'A#6', 1864.7],
  [0x05, 'B6', 1975.5], [0x25, 'C7', 2093.0], [0x2F, 'C#7', 2217.5], [0x06, 'D7', 2349.3],
  [0x07, 'D#7', 2489.0],
];

const TOLERANCE = 1.0;   // percent; the chip synthesises by division, so it is close, not exact

let got = 0;
const chip = new PCD3311((f0) => { got = f0; }, () => {});

let worst = 0;
let fails = 0;
for (const [code, note, want] of MANUAL) {
  got = 0;
  chip.loadData(code);
  const err = want ? Math.abs(got - want) / want * 100 : 0;
  if (err > worst) worst = err;
  const ok = got > 0 && err <= TOLERANCE;
  if (!ok) fails++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${code.toString(16).padStart(2, '0')}h  ${note.padEnd(4)}` +
    ` instrukcja ${String(want).padStart(7)} Hz   emulator ${String(got.toFixed(1)).padStart(7)} Hz` +
    `   różnica ${err.toFixed(2)}%`);
}

console.log(`\nnajwiększa różnica: ${worst.toFixed(2)}%`);
console.log(fails ? `${fails} z ${MANUAL.length} nie mieści się w ${TOLERANCE}%`
                  : `wszystkie ${MANUAL.length} tonów zgodne`);
process.exit(fails ? 1 : 0);
