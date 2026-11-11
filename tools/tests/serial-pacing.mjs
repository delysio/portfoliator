// Drives the real SerialHub from js/ui/serial.js with a stub backend, to check
// the outbound pacing: order, byte count, timing and the queue readout.
import { SerialHub } from '../../js/ui/serial.js';

const enc = (s) => new TextEncoder().encode(s);

function makeHub() {
  const got = [];
  const times = [];
  const hub = new SerialHub({ send() {}, setModem() {}, onUpdate() {} });
  hub.backend = {
    write(bytes) { for (const b of bytes) { got.push(b); times.push(Date.now()); } },
    close() {},
  };
  return { hub, got, times };
}

const text = (a) => new TextDecoder().decode(Uint8Array.from(a));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
};

// 1. No delay: straight through, synchronously, no queue.
{
  const { hub, got } = makeHub();
  hub.sendToLine(enc('ABC\r\nDEF'));
  check('0/0 przechodzi natychmiast', text(got) === 'ABC\r\nDEF' && hub.pendingBytes === 0,
    `dostano ${JSON.stringify(text(got))}, kolejka ${hub.pendingBytes}`);
}

// 2. 15/15: trickles out, order intact, line pause charged once per CRLF.
{
  const { hub, got, times } = makeHub();
  hub.setTxDelay(15, 15);
  const payload = 'AB\r\nCD';           // 6 bytes, one line ending
  hub.sendToLine(enc(payload));
  check('15/15 nie wypuszcza wszystkiego od razu', got.length < payload.length,
    `od razu wyszło ${got.length} z ${payload.length}`);
  const t0 = Date.now();
  await sleep(400);
  const span = times[times.length - 1] - t0;
  // 6 chars * 15 ms + one line pause of 15 ms = ~105 ms, minus the first byte
  // which leaves immediately.
  check('15/15 dowozi komplet w kolejności', text(got) === payload, JSON.stringify(text(got)));
  check('15/15 trwa mniej więcej tyle, ile ma trwać', span > 60 && span < 200, `${span} ms`);
  check('15/15 opróżnia kolejkę', hub.pendingBytes === 0);
}

// 3. CRLF must not be charged the line pause twice.
{
  const { hub, times } = makeHub();
  hub.setTxDelay(0, 100);
  hub.sendToLine(enc('A\r\nB\r\nC'));
  await sleep(500);
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 50);
  check('CRLF liczone jako jeden koniec linii', gaps.length === 2, `przerw >50 ms: ${gaps.length} (${gaps})`);
}

// 4. 0 ms/char with a line delay sends whole lines in one write.
{
  const writes = [];
  const hub = new SerialHub({ send() {}, setModem() {}, onUpdate() {} });
  hub.backend = { write(b) { writes.push(new TextDecoder().decode(b)); }, close() {} };
  hub.setTxDelay(0, 50);
  hub.sendToLine(enc('one\r\ntwo\r\nthree'));
  await sleep(300);
  check('0/N wysyła całymi liniami', writes.length === 3 && writes[0] === 'one\r\n',
    JSON.stringify(writes));
}

// 5. Turning pacing off mid-flight hands over the rest at once.
{
  const { hub, got } = makeHub();
  hub.setTxDelay(50, 0);
  hub.sendToLine(enc('ABCDEFGH'));
  await sleep(60);
  const partial = got.length;
  hub.setTxDelay(0, 0);
  check('wyłączenie dławienia dosyła resztę', text(got) === 'ABCDEFGH' && hub.pendingBytes === 0,
    `przed wyłączeniem ${partial} B, po: ${JSON.stringify(text(got))}`);
}

// 6. Disconnecting drops what is still queued instead of writing to a dead port.
{
  const { hub, got } = makeHub();
  hub.setTxDelay(50, 0);
  hub.sendToLine(enc('ABCDEFGH'));
  await sleep(60);
  const before = got.length;
  await hub.disconnect();
  await sleep(200);
  check('rozłączenie porzuca kolejkę', got.length === before && hub.pendingBytes === 0,
    `${before} B wyszło, po rozłączeniu ${got.length} B`);
}

// 7. The emulated Portfolio's own output goes through the same queue.
{
  const { hub, got } = makeHub();
  hub.setTxDelay(15, 0);
  hub.fromPortfolio(enc('COPY'));
  check('wyjście emulowanego Portfolio też jest dławione', got.length < 4, `${got.length} B od razu`);
  await sleep(200);
  check('...i dochodzi w całości', text(got) === 'COPY', JSON.stringify(text(got)));
  check('licznik rxBytes liczy całość od razu', hub.rxBytes === 4, `${hub.rxBytes}`);
}

console.log(fails ? `\n${fails} test(ów) nie przeszło` : '\nwszystkie testy przeszły');
process.exit(fails ? 1 : 0);
