// Runs every suite in tools/tests/ and reports the tally.
//
// There is no test framework here on purpose: the project has no build step and
// no dependencies, and neither should its tests. Each suite is a plain module
// that prints PASS/FAIL lines and exits non-zero if anything failed.
//
// Suites that need the ROM images skip themselves when rom/ is empty, so this
// runs on a fresh clone without the files the project is not allowed to ship.
//
//   node tools/run-tests.mjs            everything
//   node tools/run-tests.mjs standby    only suites matching "standby"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'tests');
const filter = process.argv[2];

const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'))
  .filter((f) => !filter || f.includes(filter));

if (!suites.length) {
  console.error(filter ? `Żaden zestaw nie pasuje do "${filter}".` : 'Brak zestawów w tools/tests/.');
  process.exit(1);
}

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ${'='.repeat(Math.max(0, 60 - suite.length))}`);
  const res = spawnSync(process.execPath, [path.join(dir, suite)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
}

console.log('\n' + '='.repeat(64));
console.log(failed ? `${failed} z ${suites.length} zestawów nie przeszło` : `wszystkie zestawy przeszły (${suites.length})`);
process.exit(failed ? 1 : 0);
