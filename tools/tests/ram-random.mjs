// Zimny start z losową zawartością pamięci.
//
// Prawdziwe Portfolio budzi się z pamięcią pełną resztek, a emulator dawał
// równiutkie zera — więc program czytający pamięć, zanim cokolwiek do niej
// zapisze, zachowywał się tu inaczej niż na sprzęcie. Opcja **Zimny start
// z losową pamięcią RAM** w oknie System wypełnia ją losowo.
//
// Zestaw uruchamia prawdziwy `js/emu/worker.js` w Node, z podstawionym `self`,
// i przepuszcza przez niego te same wiadomości, które wysyła strona. Sprawdza
// pięć rzeczy: że domyślnie nadal są zera, że po włączeniu opcji zer nie ma,
// że dwa zimne starty dają **różne** wypełnienia, że zapamiętana zawartość
// NVRAM-u nie zostaje przez losowanie zadeptana, oraz że pamięć rozszerzenia
// pozostaje nietknięta.

import fs from 'node:fs';
import { ROMS, romsAvailable } from '../pofo-headless.mjs';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

// --- podstawiona strona -----------------------------------------------------

const outbox = [];
const timers = new Set();

globalThis.self = {
  postMessage: (m) => outbox.push(m),
  set onmessage(fn) { globalThis.self._handler = fn; },
  get onmessage() { return globalThis.self._handler; },
};
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { const id = realSetInterval(() => {}, 1e9); timers.add(id); return id; };

await import('../../js/emu/worker.js');
const send = (msg) => { outbox.length = 0; globalThis.self.onmessage({ data: msg }); return outbox; };

const rom = (p) => new Uint8Array(fs.readFileSync(p)).buffer;
const sysRom = new Uint8Array(0x40000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.app)), 0x00000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.bios)), 0x20000);

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

/** Zawartość pamięci głównej, tak jak widzi ją strona. */
function pamiec() {
  const m = send({ type: 'requestNvram' }).find((x) => x.type === 'nvram');
  return m ? Uint8Array.from(m.data) : null;
}

function start({ ramFill, nvram = null, hpc104 = false }) {
  send({
    type: 'init',
    sysRom: sysRom.buffer.slice(0),
    lcdCharRom: rom(ROMS.lcd),
    cgRom: rom(ROMS.cg),
    nvram, card: null, peripheral: 'none', hpc104, ramFill,
  });
  return pamiec();
}

const niezerowe = (b) => { let n = 0; for (const x of b) if (x) n++; return n; };
const rozne = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

// --- 1. domyślnie nadal zera ------------------------------------------------

{
  const ram = start({ ramFill: 'zero' });
  check('bez opcji pamięć startuje wyzerowana', ram && niezerowe(ram) === 0,
        ram ? `${niezerowe(ram)} bajtów niezerowych` : 'brak odpowiedzi');
}

// --- 2. z opcją pamięć jest zaśmiecona --------------------------------------

const pierwszy = start({ ramFill: 'random' });
{
  const ile = niezerowe(pierwszy);
  // Losowy bajt jest zerem raz na 256, więc niezerowych ma być mniej więcej
  // 255/256 całości. Sprawdzamy z dużym zapasem, żeby test nie był kruchy.
  check('z opcją pamięć startuje zaśmiecona', ile > pierwszy.length * 0.9,
        `${ile} z ${pierwszy.length} bajtów niezerowych`);
}

// --- 3. dwa zimne starty różnią się -----------------------------------------

{
  const drugi = start({ ramFill: 'random' });
  const r = rozne(pierwszy, drugi);
  check('dwa zimne starty dają różne wypełnienie', r > pierwszy.length * 0.9,
        `${r} z ${pierwszy.length} bajtów się różni`);
}

// --- 4. zimny reset przesypuje pamięć na nowo -------------------------------

{
  const przed = pamiec();
  send({ type: 'reset', cold: true });
  const po = pamiec();
  check('zimny reset przesypuje pamięć na nowo', rozne(przed, po) > przed.length * 0.9,
        `${rozne(przed, po)} bajtów się różni`);
}

// --- 5. przywrócony NVRAM ma pierwszeństwo ----------------------------------

{
  const zapis = new Uint8Array(0x20000);
  for (let i = 0; i < zapis.length; i++) zapis[i] = (i * 7 + 3) & 0xFF;
  const ram = start({ ramFill: 'random', nvram: zapis.buffer.slice(0) });
  // Rozruch sam z siebie dotyka kilku bajtów obszaru BIOS-u, więc porównujemy
  // z zapasem zamiast żądać zgodności co do bajta.
  const r = rozne(zapis, ram);
  check('zapamiętana pamięć NVRAM nie zostaje zadeptana losowaniem', r < 4096,
        `${r} bajtów różni się od zapisanych`);
}

// --- 6. pamięć rozszerzenia zostaje nietknięta ------------------------------

{
  const dysk = new Uint8Array(0x40000).fill(0xA5);
  send({
    type: 'init',
    sysRom: sysRom.buffer.slice(0),
    lcdCharRom: rom(ROMS.lcd),
    cgRom: rom(ROMS.cg),
    nvram: null, card: null, peripheral: 'none',
    hpc104: true, hpc104Ram: dysk.buffer.slice(0), ramFill: 'random',
  });
  send({ type: 'reset', cold: true });
  const stan = send({ type: 'saveState' }).find((m) => m.type === 'hpc104ram');
  const po = stan ? Uint8Array.from(stan.data) : null;
  const nietknieta = po && po.every((b) => b === 0xA5);
  check('zimny start nie rusza pamięci rozszerzenia (dysk B:)', !!nietknieta,
        po ? `${po.filter((b) => b !== 0xA5).length} bajtów zmienionych` : 'brak odpowiedzi');
}

for (const id of timers) clearInterval(id);
process.exit(fails ? 1 : 0);
