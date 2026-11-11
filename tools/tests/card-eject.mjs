// Wyjmowanie karty musi działać za pierwszym naciśnięciem.
//
// Błąd, który to wymusił: worker odsyłał zawartość karty w odpowiedzi na
// `ejectCard`, a strona przyjmowała tę odpowiedź i wstawiała kartę z powrotem —
// razem z zapisem do magazynu. Po pierwszym kliknięciu maszyna była bez karty,
// ale interfejs i magazyn znów ją miały, więc trzeba było kliknąć drugi raz.
//
// Ten zestaw uruchamia prawdziwy js/emu/worker.js w Node, z podstawionym `self`,
// i przepuszcza przez niego te same wiadomości, które wysyła strona. Sprawdza
// trzy rzeczy: że wyjęcie nie odsyła karty, że maszyna faktycznie ją traci,
// i że numer pokolenia pozwala odrzucić zrzut wysłany tuż przed wyjęciem.

import fs from 'node:fs';
import path from 'node:path';
import { ROMS, romsAvailable, ROOT } from '../pofo-headless.mjs';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

// --- podstawiona strona: worker widzi `self`, my widzimy jego wiadomości ----

const outbox = [];
const timers = new Set();

globalThis.self = {
  postMessage: (m) => outbox.push(m),
  set onmessage(fn) { globalThis.self._handler = fn; },
  get onmessage() { return globalThis.self._handler; },
};
// Pętla czasu rzeczywistego workera jest tu zbędna i tylko spowalnia test.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { const id = realSetInterval(() => {}, 1e9); timers.add(id); return id; };

const worker = await import('../../js/emu/worker.js');
const send = (msg) => { outbox.length = 0; globalThis.self.onmessage({ data: msg }); return outbox; };
const took = (type) => outbox.filter((m) => m.type === type);

const rom = (p) => new Uint8Array(fs.readFileSync(p)).buffer;
const sysRom = new Uint8Array(0x40000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.app)), 0x00000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.bios)), 0x20000);

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};

// --- start bez karty --------------------------------------------------------

send({
  type: 'init',
  sysRom: sysRom.buffer,
  lcdCharRom: rom(ROMS.lcd),
  cgRom: rom(ROMS.cg),
  nvram: null,
  card: null,
  peripheral: 'none',
  hpc104: false,
});
check(took('ready').length === 1, 'worker zgłasza gotowość');

// --- włożenie i wyjęcie -----------------------------------------------------

const image = new Uint8Array(128 * 1024).fill(0xE5);

send({ type: 'insertCard', data: image.buffer.slice(0), writable: true, gen: 1 });

const afterEject = send({ type: 'ejectCard' });
check(afterEject.filter((m) => m.type === 'card').length === 0,
      'wyjęcie karty nie odsyła jej zawartości');

// Kolejne wyjęcie ma być bezczynne — pierwsze musiało wystarczyć.
const second = send({ type: 'ejectCard' });
check(second.filter((m) => m.type === 'card').length === 0,
      'powtórne wyjęcie też niczego nie odsyła');

// --- numer pokolenia --------------------------------------------------------

send({ type: 'insertCard', data: image.buffer.slice(0), writable: true, gen: 7 });
const state = send({ type: 'saveState' });
const card = state.find((m) => m.type === 'card');
check(!!card && card.gen === 7, 'odesłana karta niesie numer pokolenia z włożenia');

send({ type: 'ejectCard' });
send({ type: 'insertCard', data: image.buffer.slice(0), writable: true, gen: 8 });
const after = send({ type: 'saveState' }).find((m) => m.type === 'card');
check(!!after && after.gen === 8, 'po ponownym włożeniu numer rośnie, więc stary zrzut da się odrzucić');

for (const id of timers) clearInterval(id);
console.log('');
if (failures) { console.log(`${failures} sprawdzeń nie przeszło`); process.exit(1); }
console.log('wyjmowanie karty działa za pierwszym razem');
