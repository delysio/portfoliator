// Checks the progress bookkeeping behind the file-send dialog: sendJob(),
// cancelJob() and creditJob(), driven through the real SerialHub.
import { SerialHub } from '../../js/ui/serial.js';

const enc = (s) => new TextEncoder().encode(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (a) => new TextDecoder().decode(Uint8Array.from(a));

function makeHub() {
  const got = [];
  const hub = new SerialHub({ send() {}, setModem() {}, onUpdate() {} });
  hub.backend = { write(b) { for (const x of b) got.push(x); }, close() {} };
  return { hub, got };
}

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};

// 1. Pacing off: the whole block leaves at once and progress reports it once.
{
  const { hub, got } = makeHub();
  const seen = [];
  hub.sendJob(enc('ABCDEF'), (done, total) => seen.push([done, total]));
  check('bez dławienia: jeden raport 100%',
    seen.length === 1 && seen[0][0] === 6 && seen[0][1] === 6 && text(got) === 'ABCDEF',
    JSON.stringify(seen));
  check('bez dławienia: zadanie posprzątane', hub.job === null);
}

// 2. Paced: progress climbs monotonically and lands exactly on the total.
{
  const { hub, got } = makeHub();
  const seen = [];
  hub.setTxDelay(5, 0);
  hub.sendJob(enc('ABCDEFGHIJ'), (done) => seen.push(done));
  await sleep(300);
  const monotonic = seen.every((v, i) => i === 0 || v > seen[i - 1]);
  check('dławione: postęp rośnie monotonicznie', monotonic, seen.join(','));
  check('dławione: kończy się dokładnie na całości',
    seen[seen.length - 1] === 10 && text(got) === 'ABCDEFGHIJ');
  check('dławione: zadanie posprzątane', hub.job === null);
}

// 3. A send that starts on a non-empty queue must not count the bytes ahead of it.
{
  const { hub } = makeHub();
  const seen = [];
  hub.setTxDelay(5, 0);
  hub.writeOut(enc('XXXXXX'));                    // someone else's bytes first
  hub.sendJob(enc('AB'), (done) => seen.push(done));
  check('kolejka niepusta: start od zera', seen.length === 0, `raportów: ${seen.length}`);
  await sleep(300);
  check('kolejka niepusta: dochodzi do całości',
    seen[seen.length - 1] === 2 && seen.length === 2, seen.join(','));
}

// 4. Bytes queued behind a running job must not inflate its progress.
{
  const { hub } = makeHub();
  const seen = [];
  hub.setTxDelay(5, 0);
  hub.sendJob(enc('ABCD'), (done) => seen.push(done));
  hub.fromPortfolio(enc('ZZZZZZZZ'));             // emulated Portfolio talks meanwhile
  await sleep(300);
  check('bajty za zadaniem nie zawyżają postępu',
    seen[seen.length - 1] === 4 && Math.max(...seen) === 4, seen.join(','));
}

// 5. Cancelling drops the rest of the job and nothing more.
{
  const { hub, got } = makeHub();
  hub.setTxDelay(20, 0);
  hub.sendJob(enc('ABCDEFGHIJ'), () => {});
  await sleep(50);
  const before = got.length;
  const dropped = hub.cancelJob();
  await sleep(200);
  check('przerwanie porzuca resztę',
    got.length === before && hub.pendingBytes === 0 && before + dropped === 10,
    `wyszło ${before} B, porzucono ${dropped} B`);
  check('przerwanie czyści zadanie', hub.job === null);
}

// 6. Losing the far end must clear the job, so the dialog can notice.
{
  const { hub } = makeHub();
  hub.setTxDelay(20, 0);
  hub.sendJob(enc('ABCDEFGHIJ'), () => {});
  await sleep(50);
  await hub.disconnect();
  check('rozłączenie kasuje zadanie', hub.job === null && hub.pendingBytes === 0);
}

console.log(fails ? `\n${fails} test(ów) nie przeszło` : '\nwszystkie testy przeszły');
process.exit(fails ? 1 : 0);
