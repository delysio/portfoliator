// The CPU core against SingleStepTests 8088 v2 (https://github.com/SingleStepTests/8088, MIT):
// about three million single instructions recorded on a real NMOS 8088, each with its initial
// and final registers, memory, and the bus and queue status of every clock in between.
//
// The test data is 761 MB and does not belong to this repository. Point SST_8088 at the
// directory holding the v2 *.json.gz files to run it; without that the suite skips itself.
//
//   SST_8088=../sst-dane node tools/tests/cpu-sst.mjs          every case of every file
//   SST_8088=../sst-dane SST_MAX=300 node tools/tests/cpu-sst.mjs   the first 300 of each
//
// What it holds the core to, file by file:
//   - registers, flags (the undefined ones included) and memory: every case, everywhere;
//   - the number of clocks and the bus/queue status of each of them: every case, except in the
//     files listed in ODSTEPSTWA below, which are the core's known deviations, inherited from
//     MartyPC, from which the core was ported. Those files may fail only the trace (and C6 the
//     clock count), and never in more cases than recorded there.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { CPU8088 } from '../../js/emu/cpu8088.js';

const DIR = process.env.SST_8088;
if (!DIR || !fs.existsSync(DIR)) {
  console.log('POMINIĘTE — ustaw SST_8088 na katalog z testami SingleStepTests 8088 v2 (*.json.gz)');
  process.exit(0);
}
const MAX = +(process.env.SST_MAX || 1e9);

// Known deviations: [cases whose trace may differ, cases whose clock count may differ], out of
// the 10 000 in each file. Measured on the whole set when the core went in.
//   9A, FF.3, CC, CD, CE, D4, F6.6-F7.7  far call and interrupt entry: the push of CS starts a
//                                        clock late and the next one is a clock short - the
//                                        instruction ends on the same clock as the hardware;
//   F6.0, F6.1, F7.0, F7.1               TEST r, imm from a full queue: the immediate byte
//                                        leaves the queue a clock early, same total;
//   C6                                   MOV byte [BX+SI] / [BP+DI] (mod 0 and 1, no prefix)
//                                        from a full queue: the write goes a clock early and
//                                        the instruction is a clock short.
const ODSTEPSTWA = {
  '9A': [10000, 0], 'FF.3': [10000, 0], 'CC': [10000, 0], 'CD': [10000, 0], 'CE': [5051, 0],
  'D4': [47, 0], 'F6.6': [5199, 0], 'F6.7': [7540, 0], 'F7.6': [5095, 0], 'F7.7': [7589, 0],
  'F6.0': [1262, 0], 'F6.1': [1255, 0], 'F7.0': [1258, 0], 'F7.1': [1242, 0],
  'C6': [307, 307],
};

const RN = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const SN = ['es', 'cs', 'ss', 'ds'];
const mem = new Uint8Array(1 << 20);
const bus = { read8: (a) => mem[a & 0xFFFFF], write8: (a, v) => { mem[a & 0xFFFFF] = v; }, in8: () => 0xFF, out8: () => {}, intAck: () => 8 };
const cpu = new CPU8088(bus);

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

function runCase(t) {
  const ini = t.initial, fin = t.final;
  mem.fill(0);
  for (const [a, v] of ini.ram) mem[a] = v;
  cpu.trace = null;
  cpu.reset(ini.regs.cs, ini.regs.ip, ini.queue && ini.queue.length ? ini.queue : null);
  for (let i = 0; i < 8; i++) cpu.regs[i] = ini.regs[RN[i]];
  cpu.sregs[0] = ini.regs.es; cpu.sregs[2] = ini.regs.ss; cpu.sregs[3] = ini.regs.ds;
  cpu.flags = ini.regs.flags;
  cpu.trace = [];
  let guard = 0;
  // A repeated string instruction runs to the end, as the test recorded it.
  do { cpu.stepBody(); guard++; } while (cpu.inRep && guard < 100000);
  cpu.stepFinish();

  const want = { ...ini.regs, ...fin.regs };
  let state = true;
  for (let i = 0; i < 8; i++) if (cpu.regs[i] !== want[RN[i]]) state = false;
  for (let i = 0; i < 4; i++) if (cpu.sregs[i] !== want[SN[i]]) state = false;
  if (cpu.ip !== want.ip || cpu.flags !== want.flags) state = false;
  for (const [a, v] of fin.ram) if (mem[a] !== v) state = false;

  // The test starts at the clock the queue reports the instruction's first byte.
  let tr = cpu.trace;
  const f0 = tr.findIndex((c) => c[2] === 'F');
  if (f0 > 0) tr = tr.slice(f0);
  const clocks = tr.length === t.cycles.length;
  let trace = clocks;
  if (clocks) {
    for (let i = 0; i < tr.length && trace; i++) {
      const c = t.cycles[i];
      if (tr[i][0] !== c[8] || tr[i][1] !== c[7] || tr[i][2] !== c[9]) trace = false;
    }
  }
  return { state, clocks, trace };
}

const files = fs.readdirSync(DIR).filter((f) => /^[0-9A-F]{2}(\.[0-7])?\.json\.gz$/.test(f)).sort();
let total = 0, exact = 0;
for (const f of files) {
  const name = f.replace('.json.gz', '');
  const tests = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, f))).toString());
  let n = 0, badState = 0, badClocks = 0, badTrace = 0;
  for (const t of tests) {
    if (n >= MAX) break;
    n++;
    const r = runCase(t);
    if (!r.state) badState++;
    if (!r.clocks) badClocks++;
    if (!r.trace) badTrace++;
  }
  total += n;
  exact += n - Math.max(badState, badTrace);
  const [allowTrace, allowClocks] = ODSTEPSTWA[name] || [0, 0];
  check(`${name.padEnd(5)} ${n} przypadków`,
    badState === 0 && badTrace <= allowTrace && badClocks <= allowClocks,
    `stan ${badState}, takty ${badClocks} (wolno ${allowClocks}), ślad ${badTrace} (wolno ${allowTrace})`);
}
console.log(`\n${exact} z ${total} przypadków zgodnych co do rejestru, bajtu pamięci i stanu magistrali w każdym takcie`);
console.log(fails ? `\n${fails} kontroli nie przeszło` : '\nwszystkie kontrole przeszły');
process.exit(fails ? 1 : 0);
