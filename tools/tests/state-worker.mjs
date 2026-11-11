// Zrzut stanu drogą, którą idzie strona: przez wiadomości workera.
//
// `state.mjs` sprawdza sam mechanizm — że zrzut niczego nie gubi. Ten zestaw
// sprawdza to, czego tamten dotknąć nie może: czy **worker** składa i przyjmuje
// stan poprawnie. To jest osobne pytanie, bo w workerze siedzi wszystko, czego
// maszyna o sobie nie wie: która płyta jest wpięta, czy zamontowane jest
// rozszerzenie pamięci, jakie numery pokoleń mają karty i czy po odtworzeniu
// pętla emulacji wraca do biegu.
//
// Uruchamiany jest **prawdziwy `js/emu/worker.js`**, z podstawionym `self` — ten
// sam sposób, którym `card-eject.mjs` złapał swój błąd. Wiadomości są dokładnie
// te, które wysyła `js/main.js`.
//
// Jedna rzecz sprawdzana tu jest nieoczywista i wzięła się z projektu, a nie
// z testu: odtworzenie stanu **przestawia sprzęt**. Stan zapisany z wpiętym
// rozszerzeniem pamięci musi po wczytaniu wrócić z tym rozszerzeniem, inaczej
// dysk B: znika razem z danymi. Worker odsyła więc po odtworzeniu, co ma wpięte,
// żeby strona mogła zsynchronizować przełączniki — bez tego interfejs
// pokazywałby konfigurację, której maszyna już nie ma.

import fs from 'node:fs';
import { ROMS, romsAvailable } from '../pofo-headless.mjs';

if (!romsAvailable()) {
  console.log('POMINIĘTE — brak plików ROM w rom/ (patrz README)');
  process.exit(0);
}

const outbox = [];
const timers = new Set();

globalThis.self = {
  postMessage: (m) => outbox.push(m),
  set onmessage(fn) { globalThis.self._handler = fn; },
  get onmessage() { return globalThis.self._handler; },
};
// Pętla workera chodzi na setInterval i liczy czas z performance.now(). Zamiast
// czekać na nią w czasie rzeczywistym, przechwytuję jej funkcję i wołam ją sam,
// przepuszczając między wywołaniami trochę prawdziwego czasu — inaczej dt
// wychodzi zerowe i maszyna stoi. Bez tego licznik cykli po obu stronach
// odtworzenia wynosiłby zero i porównanie niczego by nie dowodziło.
let tick = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn) => { tick = fn; const id = realSetInterval(() => {}, 1e9); timers.add(id); return id; };
const spij = (ms) => new Promise((r) => setTimeout(r, ms));

async function bieg(ms) {
  outbox.length = 0;
  const doKiedy = Date.now() + ms;
  while (Date.now() < doKiedy) { await spij(20); if (tick) tick(); }
}

await import('../../js/emu/worker.js');
const send = (msg) => { outbox.length = 0; globalThis.self.onmessage({ data: msg }); return outbox; };
const jeden = (type) => outbox.find((m) => m.type === type);

const rom = (p) => new Uint8Array(fs.readFileSync(p)).buffer;
const sysRom = new Uint8Array(0x40000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.app)), 0x00000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.bios)), 0x20000);

let fails = 0;
const check = (ok, what, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

function init(opts = {}) {
  return send({
    type: 'init',
    sysRom: sysRom.buffer.slice(0),
    lcdCharRom: rom(ROMS.lcd),
    cgRom: rom(ROMS.cg),
    nvram: null,
    card: null,
    peripheral: 'none',
    hpc104: false,
    ...opts,
  });
}

// ---- 1. zrzut niesie konfigurację sprzętu ----------------------------------

init({ peripheral: 'serial', hpc104: true });
await bieg(200);
send({ type: 'snapshot', slot: 'test' });
const zrzut = jeden('snapshotData');

check(!!zrzut && !!zrzut.state, 'worker odsyła stan na żądanie');
check(!!zrzut && zrzut.slot === 'test', 'odpowiedź niesie nazwę gniazda, o które pytano',
      zrzut ? `slot="${zrzut.slot}"` : '');
check(!!zrzut && zrzut.state.peripheral === 'serial' && zrzut.state.hpc104 === true,
      'zrzut zapamiętuje wpiętą płytę i rozszerzenie pamięci',
      zrzut ? `${zrzut.state.peripheral}, hpc104=${zrzut.state.hpc104}` : '');
check(!!zrzut && !!zrzut.state.machine && !!zrzut.state.machine.cpu,
      'w zrzucie jest maszyna razem z procesorem');
check(!!zrzut && typeof zrzut.state.saved === 'number',
      'zrzut jest datowany, więc da się go pokazać w interfejsie');

const stan = zrzut.state;

// ---- 2. odtworzenie przestawia sprzęt i mówi o tym ---------------------------

init({ peripheral: 'none', hpc104: false });
const po = send({ type: 'restoreSnapshot', state: stan });

check(!!po.find((m) => m.type === 'stateResult' && m.ok), 'odtworzenie zgłasza powodzenie',
      (po.find((m) => m.type === 'stateResult') || {}).why || '');
const przywrocone = po.find((m) => m.type === 'stateRestored');
check(!!przywrocone && przywrocone.peripheral === 'serial' && przywrocone.hpc104 === true,
      'worker odsyła, co ma po odtworzeniu wpięte',
      przywrocone ? `${przywrocone.peripheral}, hpc104=${przywrocone.hpc104}` : 'brak wiadomości');
check(!!po.find((m) => m.type === 'frame'),
      'po odtworzeniu leci klatka, więc ekran nie zostaje z poprzedniego stanu');

// ---- 3. maszyna naprawdę wróciła tam, gdzie była ----------------------------

send({ type: 'snapshot' });
const ponownie = jeden('snapshotData').state;
// Próg jest niski celowo. Ile cykli zdąży przejść przez te 200 ms, zależy od
// obciążenia maszyny, na której test chodzi, więc próg blisko rzeczywistej
// liczby robi z tego test, który raz przechodzi a raz nie. Chodzi wyłącznie
// o to, żeby porównanie liczników nie okazało się porównaniem dwóch zer.
check(stan.machine.cpu.cycles > 100000,
      'maszyna w tym teście naprawdę chodziła, więc jest co porównywać',
      `${stan.machine.cpu.cycles} cykli przed zrzutem`);
check(ponownie.machine.cpu.cycles === stan.machine.cpu.cycles,
      'licznik cykli po odtworzeniu zgadza się co do cyklu',
      `${ponownie.machine.cpu.cycles} wobec ${stan.machine.cpu.cycles}`);
check(ponownie.machine.cpu.ip === stan.machine.cpu.ip,
      'procesor stoi na tej samej instrukcji');

// Bieg po odtworzeniu ma iść dalej, a nie zaczynać od nowa.
await bieg(100);
send({ type: 'snapshot' });
check(jeden('snapshotData').state.machine.cpu.cycles > stan.machine.cpu.cycles,
      'po odtworzeniu maszyna liczy dalej od miejsca, w którym stanęła');

// ---- 4. odmowy, które muszą być odmowami ------------------------------------

const zlaWersja = send({ type: 'restoreSnapshot', state: { ...stan, version: 999 } });
const w = zlaWersja.find((m) => m.type === 'stateResult');
check(!!w && !w.ok, 'stan w nieznanym formacie jest odrzucany, a nie wczytywany po cichu',
      w ? w.why : 'brak odpowiedzi');

const smiec = send({ type: 'restoreSnapshot', state: { version: 1 } });
const s2 = smiec.find((m) => m.type === 'stateResult');
check(!!s2 && !s2.ok, 'stan bez maszyny jest odrzucany', s2 ? s2.why : 'brak odpowiedzi');

// Maszyna po odrzuconym wczytaniu ma chodzić dalej, a nie zostać w połowie.
send({ type: 'snapshot' });
check(!!jeden('snapshotData').state, 'po odrzuconym wczytaniu maszyna nadal odpowiada');

// ---- 5. karta w gnieździe A przeżywa obieg ----------------------------------

init({ peripheral: 'none', hpc104: false });
const obraz = new Uint8Array(128 * 1024).fill(0xE5);
obraz[0x1000] = 0x77;
send({ type: 'insertCard', data: obraz.buffer.slice(0), writable: true, gen: 3 });

send({ type: 'snapshot' });
const zKarta = jeden('snapshotData').state;
check(!!zKarta.machine.cardA && zKarta.machine.cardA.data[0x1000] === 0x77,
      'zrzut zabiera zawartość karty z gniazda A');

init({ peripheral: 'none', hpc104: false });
send({ type: 'restoreSnapshot', state: zKarta });
send({ type: 'saveState' });
const odesłana = jeden('card');
check(!!odesłana && odesłana.data[0x1000] === 0x77,
      'po odtworzeniu maszyna ma tę samą kartę');
check(!!odesłana && odesłana.gen === 0,
      'karta z odtworzonego stanu dostaje pokolenie 0, więc stary zrzut hosta jej nie nadpisze',
      odesłana ? `gen=${odesłana.gen}` : '');

// ---- 6. strona przejmuje karty z odtworzonego stanu ------------------------
//
// Zgłoszone przy przeglądzie kodu: maszyna po wczytaniu stanu chodziła na karcie
// z zapisu, a strona dalej pokazywała i zapisywała swoją. Teraz worker odsyła
// karty razem z potwierdzeniem, pod numerami, które podała strona.

init({ peripheral: 'none', hpc104: false });
const zNumerem = send({ type: 'restoreSnapshot', state: zKarta, genA: 5, genB: 9 });
const przejęte = zNumerem.find((m) => m.type === 'stateRestored');
check(!!przejęte && !!przejęte.cardA && przejęte.cardA.data[0x1000] === 0x77 && przejęte.cardA.writable === true,
      'potwierdzenie odtworzenia niesie kartę A z zapisu');
check(!!przejęte && przejęte.genA === 5 && przejęte.cardB === null,
      'i numer, pod którym ją przyjąć; gniazda B bez płyty nie ma',
      przejęte ? `genA=${przejęte.genA}, cardB=${przejęte.cardB}` : '');
send({ type: 'saveState' });
const poNumerze = jeden('card');
check(!!poNumerze && poNumerze.gen === 5, 'dalsze zapisy karty idą pod tym numerem',
      poNumerze ? `gen=${poNumerze.gen}` : '');

// Stan zapisany bez karty opróżnia gniazdo, a nie zostawia w nim cudzej.
const bezKarty = send({ type: 'restoreSnapshot', state: stan, genA: 6 })
  .find((m) => m.type === 'stateRestored');
check(!!bezKarty && bezKarty.cardA === null, 'stan bez karty zgłasza puste gniazdo A');

// Ponowne włączenie HPC-104 z numerem karty B: worker ma go odsyłać, a nie 0.
init({ peripheral: 'none', hpc104: false });
send({ type: 'setHpc104', enabled: true });
send({ type: 'insertCardB', data: obraz.buffer.slice(0), writable: true, gen: 4 });
send({ type: 'saveState' });
const kartaB = jeden('cardB');
check(!!kartaB && kartaB.gen === 4, 'karta B po ponownym włożeniu wraca pod swoim numerem',
      kartaB ? `gen=${kartaB.gen}` : 'brak odpowiedzi');

// Powód odmowy to szablon z argumentami, żeby strona mogła go przetłumaczyć.
check(!!w && w.why === 'Stan w formacie {0}, a ten emulator czyta {1}.' &&
      Array.isArray(w.whyArgs) && w.whyArgs[0] === 999,
      'odmowa z powodu formatu przychodzi jako szablon do przetłumaczenia', w ? `${w.why} ${w.whyArgs}` : '');

for (const id of timers) clearInterval(id);
process.exit(fails ? 1 : 0);
