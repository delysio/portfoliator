// Zatrzymywanie maszyny: pułapki na adres, pułapki na port i krokowanie.
//
// To jedyna część inspektora, która **sięga do pętli emulacji**, a nie tylko ją
// podgląda. Reszta okna czyta stan maszyny w biegu i najgorsze, co może zrobić
// źle, to pokazać nieaktualną liczbę. Tutaj każda pomyłka zatrzymuje emulator
// albo — gorzej — nie zatrzymuje go tam, gdzie użytkownik prosił, i wtedy
// wszystko, co zobaczy w rejestrach, dotyczy innego miejsca w programie.
//
// Uruchamiany jest **prawdziwy `js/emu/worker.js`** z podstawionym `self`, tą
// samą drogą co `state-worker.mjs`, i tymi samymi wiadomościami, które wysyła
// `js/main.js`. Sprawdzanie samych funkcji byłoby sprawdzaniem czegoś innego:
// pułapka na port siedzi w uchwytach zakładanych na `machine.out8`, a pułapka
// na adres — w środku pętli `runSlice`, między okrojeniem budżetu cykli
// a `machine.advance`.
//
// Dwie rzeczy w tym zestawie wzięły się z projektu, nie z testu:
//
//   * **adres pułapki nie jest wpisany na sztywno.** Zestaw dochodzi do niego
//     sam: przechodzi krokiem początek rozruchu, spisuje ślad — adres po adresie,
//     razem z licznikiem cykli — i wybiera z niego instrukcję, która pada tam
//     dokładnie raz. Potem zaczyna maszynę od nowa, bo zimny start jest
//     powtarzalny co do cyklu, i sprawdza, czy pułapka trafia w to samo miejsce
//     i w tej samej chwili. Adres wpisany z ROM-u sprawdzałby przy okazji, czy
//     ROM nadal wygląda tak, jak w dniu pisania testu — a to jest zupełnie inne
//     pytanie;
//   * **kontrola negatywna.** Zatrzymanie się na adresie niczego nie dowodzi,
//     dopóki nie wiadomo, że bez pułapki maszyna przez ten sam adres przechodzi
//     bez zatrzymania. Inaczej test przeszedłby również wtedy, gdyby emulator
//     zatrzymywał się zawsze.

import fs from 'node:fs';
import { ROMS, romsAvailable } from '../pofo-headless.mjs';
import { disasmRange } from '../../js/emu/disasm.js';

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
// czekać na nią w czasie rzeczywistym, jej funkcja jest przechwytywana i wołana
// stąd, z odrobiną prawdziwego czasu między wywołaniami — inaczej dt wychodzi
// zerowe i maszyna stoi.
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
const wszystkie = (type) => outbox.filter((m) => m.type === type);

const rom = (p) => new Uint8Array(fs.readFileSync(p)).buffer;
const sysRom = new Uint8Array(0x40000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.app)), 0x00000);
sysRom.set(new Uint8Array(fs.readFileSync(ROMS.bios)), 0x20000);

let fails = 0;
const check = (ok, what, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

const hx = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const adr = (seg, off) => `${hx(seg, 4)}:${hx(off, 4)}`;
const lin = (seg, off) => (((seg << 4) + off) & 0xFFFFF);

const init = () => send({
  type: 'init',
  sysRom: sysRom.buffer.slice(0),
  lcdCharRom: rom(ROMS.lcd),
  cgRom: rom(ROMS.cg),
  nvram: null, card: null, peripheral: 'none', hpc104: false,
});

init();

/** Jedno odpytanie inspektora — dokładnie to, co robi otwarte okno. */
function podgladaj() {
  send({ type: 'inspectPoll', follow: true, memSeg: 0x0040, memOff: 0 });
  const d = jeden('inspectData');
  return d ? { ...d.regs, cycles: d.cycles, kod: d.kod } : null;
}

/** Pierwsze instrukcje spod CS:IP, prosto z okna kodu odesłanego przez workera. */
function instrukcje(p, ile) {
  const base = lin(p.kod.seg, p.kod.off);
  return disasmRange((a) => p.kod.bytes[(a - base) & 0xFFFFF] ?? 0, p.kod.seg, p.kod.off, ile);
}

const krok = () => send({ type: 'step' }).find((m) => m.type === 'paused');

// ---- 1. zatrzymanie na żądanie ---------------------------------------------

await bieg(600);                       // do ekranu powitalnego, czyli w pętlę czekania

const zatrzymanie = send({ type: 'pause' }).find((m) => m.type === 'paused');
check(!!zatrzymanie && zatrzymanie.paused === true && zatrzymanie.why === 'user',
      'maszyna zatrzymuje się na żądanie', zatrzymanie ? `why=${zatrzymanie.why}` : 'brak odpowiedzi');
check(!!send({ type: 'pause' }).find((m) => m.type === 'frame'),
      'zatrzymana odsyła klatkę, więc ekran pokazuje stan z chwili zatrzymania');

const stoi1 = podgladaj();
await bieg(150);
const stoi2 = podgladaj();
check(stoi1.cycles === stoi2.cycles && stoi1.ip === stoi2.ip,
      'zatrzymana maszyna nie liczy cykli', `${stoi1.cycles} wobec ${stoi2.cycles}`);
check(stoi1.cycles > 100000, 'przed zatrzymaniem maszyna naprawdę chodziła',
      `${stoi1.cycles} cykli`);

await bieg(1100);                      // status leci raz na sekundę
const st = wszystkie('status').at(-1);
check(!!st && st.paused === true, 'status niesie zatrzymanie, więc pasek stanu ma co pokazać');
check(!!st && st.speed === 0, 'zatrzymana maszyna zgłasza zerową szybkość',
      st ? `${st.speed}` : '');

// ---- 2. krok to jedna instrukcja -------------------------------------------
//
// Sprawdzane deasemblerem, a nie liczbą cykli: krok ma przenieść IP dokładnie
// o długość instrukcji, którą wykonał. Instrukcje sterujące (skoki, wywołania,
// powroty, przerwania) są z tego wyłączone, bo dla nich prawdziwym wynikiem
// jest właśnie to, że IP idzie gdzie indziej.
//
// Maszyna zaczyna tu od nowa i zostaje zatrzymana, **zanim wykona pierwszą
// instrukcję**. Nie jest to wygoda, tylko konieczność: ekran powitalny czeka na
// klawisz w pętli o jednej instrukcji, więc każdy krok byłby skokiem i test
// przeszedłby, nie sprawdziwszy niczego. Rozruch daje przekrój przez zwykły kod
// - przesłania, arytmetykę, dostępy do portów.

init();
send({ type: 'pause' });

const STERUJACE = /^(j|call|ret|iret|int|loop|hlt|rep)/i;
let sprawdzonych = 0, zgodnych = 0, nazwanych = 0, przerwan = 0, halt = 0;
let zleNazwane = '';

for (let i = 0; i < 120; i++) {
  const przed = podgladaj();
  if (przed.halted) { halt++; krok(); continue; }
  const [ins] = instrukcje(przed, 1);
  const odpowiedz = krok();
  const po = podgladaj();

  // Przyjęte przerwanie też jest jednym krokiem, tylko kończy się gdzie indziej:
  // na stosie leżą trzy słowa, a IF jest skasowane. Takiego kroku nie da się
  // porównać z długością instrukcji, bo tamta instrukcja jeszcze nie ruszyła.
  if (((przed.sp - po.sp) & 0xFFFF) === 6 && !(po.flags & 0x200)) { przerwan++; continue; }
  if (STERUJACE.test(ins.text)) continue;

  sprawdzonych++;
  if (po.cs === przed.cs && po.ip === ((przed.ip + ins.len) & 0xFFFF)) zgodnych++;
  else {
    check(false, 'krok przeniósł IP o długość instrukcji',
          `${adr(przed.cs, przed.ip)} ${ins.text} (${ins.len} B) → ${adr(po.cs, po.ip)}`);
    break;
  }

  // Adres w odpowiedzi to ten, spod którego instrukcja ruszyła, a nie ten,
  // pod którym maszyna się zatrzymała. Sprawdzane tutaj, a nie na dowolnej
  // instrukcji: przy instrukcji powtarzanej (REP) IP zostaje na miejscu i oba
  // odczyty byłyby takie same, więc pomyłka przeszłaby bez śladu.
  if (odpowiedz && odpowiedz.why === 'step'
      && odpowiedz.seg === przed.cs && odpowiedz.off === przed.ip) nazwanych++;
  else if (!zleNazwane) {
    zleNazwane = odpowiedz ? `${adr(odpowiedz.seg, odpowiedz.off)} wobec ${adr(przed.cs, przed.ip)}`
                           : 'brak odpowiedzi';
  }
}

check(sprawdzonych > 20 && zgodnych === sprawdzonych,
      'krok wykonuje dokładnie jedną instrukcję',
      `${zgodnych} z ${sprawdzonych} sprawdzalnych (przerwań ${przerwan}, postojów ${halt})`);
check(sprawdzonych > 20 && nazwanych === sprawdzonych,
      'krok mówi, którą instrukcję wykonał',
      zleNazwane || `${nazwanych} z ${sprawdzonych}`);

const przedKrokiem = podgladaj();
const k = krok();
const poKrokiem = podgladaj();
check(!!k && poKrokiem.cycles === przedKrokiem.cycles + k.took,
      'licznik cykli rośnie dokładnie o tyle, ile krok zgłosił',
      k ? `${przedKrokiem.cycles} + ${k.took} wobec ${poKrokiem.cycles}` : '');

// ---- 3. przyszłość maszyny, spisana krok po kroku --------------------------
//
// Pułapka na adres potrzebuje adresu, który maszyna naprawdę odwiedzi — i to
// takiego, o którym wiadomo, po ilu cyklach to zrobi. Bierze się go stąd, że
// **zimny start jest powtarzalny**: pamięć wypełniana zerami, model czasów LCD
// wyłączony, nic losowego. Zestaw przechodzi więc krokiem sto pięćdziesiąt
// pierwszych instrukcji rozruchu, spisuje ślad, wybiera z niego adres — po czym
// zaczyna maszynę od nowa i sprawdza, czy pułapka trafia dokładnie tam
// i dokładnie wtedy.
//
// Początek rozruchu nie jest wybrany dla wygody. Dopóki BIOS nie włączy
// przerwań, nic nie może wejść między dwie instrukcje, a krokowanie posuwa
// urządzenia po każdej instrukcji, podczas gdy bieg robi to co dwa tysiące
// cykli. Gdyby w oknie mieściło się przerwanie, oba przebiegi miałyby prawo
// rozejść się w czasie i porównanie co do cyklu przestałoby cokolwiek znaczyć.

init();
send({ type: 'pause' });

const slad = [];
for (let i = 0; i < 150; i++) {
  const p = podgladaj();
  slad.push({ lin: lin(p.cs, p.ip), seg: p.cs, off: p.ip, cycles: p.cycles, przerwania: !!(p.flags & 0x200) });
  krok();
}

check(!slad.some((w) => w.przerwania),
      'ślad rozruchu idzie z wyłączonymi przerwaniami, więc jest powtarzalny co do cyklu');

// Adres, który w tym oknie pada dokładnie raz i po którym maszyna idzie dalej,
// a nie w kółko. Instrukcja powtarzana (REP, LOOP) zostawia IP tam, gdzie było,
// więc przy niej nie dałoby się odróżnić zatrzymania przed nią od zatrzymania
// za nią - a to jest właśnie ta różnica, o którą tu chodzi.
let cel = null;
for (let i = slad.length - 2; i > 10; i--) {
  const w = slad[i];
  if (slad[i + 1].lin === w.lin) continue;
  if (slad.filter((x) => x.lin === w.lin).length !== 1) continue;
  cel = w;
  break;
}
check(!!cel, 'w śladzie jest adres odwiedzony raz, po którym maszyna idzie dalej',
      cel ? `${adr(cel.seg, cel.off)} po ${cel.cycles} cyklach` : `${slad.length} kroków bez takiego`);

// ---- 4. kontrola negatywna: bez pułapki nic nie zatrzymuje ------------------
//
// Bez tego zatrzymanie się na adresie nie dowodziłoby niczego: test przeszedłby
// również wtedy, gdyby emulator zatrzymywał się zawsze.

init();
send({ type: 'breakpoints', addrs: [], io: null });
await bieg(200);
const bezPulapki = wszystkie('paused');
const poBiegu = podgladaj();
check(bezPulapki.length === 0 && poBiegu.cycles > cel.cycles,
      'bez pułapki maszyna przechodzi ten sam adres bez zatrzymania',
      `${bezPulapki.length} zatrzymań, ${poBiegu.cycles} cykli wobec ${cel.cycles} na pułapce`);

// ---- 5. pułapka na adres ----------------------------------------------------

init();
send({ type: 'pause' });
send({ type: 'breakpoints', addrs: [cel.lin], io: null });
send({ type: 'resume' });
await bieg(200);

const naAdresie = wszystkie('paused').find((m) => m.paused);
check(!!naAdresie && naAdresie.why === 'addr' && lin(naAdresie.seg, naAdresie.off) === cel.lin,
      'pułapka na adres zatrzymuje maszynę na tym adresie',
      naAdresie ? `${adr(naAdresie.seg, naAdresie.off)} wobec ${adr(cel.seg, cel.off)}` : 'nie zatrzymała się');

const naPulapce = podgladaj();
check(lin(naPulapce.cs, naPulapce.ip) === cel.lin,
      'rejestry pokazują maszynę stojącą przed tą instrukcją, a nie za nią',
      `${adr(naPulapce.cs, naPulapce.ip)} wobec ${adr(cel.seg, cel.off)}`);
check(naPulapce.cycles === cel.cycles,
      'pułapka trafia w tę samą instrukcję co ślad, co do cyklu',
      `${naPulapce.cycles} wobec ${cel.cycles}`);

// Wznowienie ma przestąpić pułapkę, a nie wpaść w nią z powrotem na tej samej
// instrukcji. Kolejne trafienie jest w porządku — ten adres leży w pętli
// przeszukującej ROM i maszyna wróci tu jeszcze nieraz — ale dopiero po
// przejściu tej pętli, czyli za jakieś cykle, a nie za zero.
send({ type: 'resume' });
await bieg(200);
const znowu = wszystkie('paused').find((m) => m.paused);
const dalej = podgladaj();
check(dalej.cycles > naPulapce.cycles && (!znowu || znowu.cycles > naPulapce.cycles),
      'wznowienie przestępuje pułapkę, zamiast wpadać w nią z powrotem',
      znowu ? `${znowu.cycles - naPulapce.cycles} cykli do kolejnego trafienia`
            : `${dalej.cycles - naPulapce.cycles} cykli dalej, bez kolejnego trafienia`);

// ---- 6. pułapki na porty ----------------------------------------------------
//
// Każdy kierunek dostaje maszynę od nowa i pułapkę założoną, zanim wykona
// pierwszą instrukcję. Powód jest zmierzony: ekran powitalny czeka na klawisz
// **nie dotykając żadnego portu** — przez cztery sekundy stania na nim nie ma
// ani jednego dostępu — więc pułapka założona tam nie miałaby na co czekać.
// Rozruch przeciwnie: kilkanaście dostępów w pierwszej ćwierci sekundy, w obie
// strony, i to bez oglądania się na to, co akurat robi ROM.

for (const [kierunek, io, oczekiwane] of [
  ['zapis', { lo: 0x8000, hi: 0x80FF, rd: false, wr: true }, 0],
  ['odczyt', { lo: 0x8000, hi: 0x80FF, rd: true, wr: false }, 1],
]) {
  init();
  send({ type: 'breakpoints', addrs: [], io });
  await bieg(500);
  const trafiona = wszystkie('paused').find((m) => m.paused);
  check(!!trafiona && trafiona.why === 'io' && trafiona.r === oczekiwane
        && trafiona.port >= io.lo && trafiona.port <= io.hi,
        `pułapka na ${kierunek} portu zatrzymuje maszynę i mówi, o który port chodziło`,
        trafiona ? `${hx(trafiona.port, 4)} ${trafiona.r ? 'odczyt' : 'zapis'}, bajt ${hx(trafiona.val, 2)}`
                 : 'nie zatrzymała się');

  // Zatrzymanie po dostępie do portu, a nie w jego połowie: instrukcja, która
  // go zrobiła, jest już wykonana i maszyna stoi na następnej.
  const gdzie = podgladaj();
  check(!!trafiona && gdzie.cycles === trafiona.cycles,
        `zatrzymanie na ${kierunek} kończy instrukcję, zamiast zostawiać ją w połowie`,
        trafiona ? `${gdzie.cycles} wobec ${trafiona.cycles}` : '');
}

// ---- 7. zdjęcie pułapek naprawdę je zdejmuje --------------------------------
//
// Tą drogą idzie zamknięcie okna inspektora: zdejmij pułapki i puść maszynę.
// Gdyby została choć jedna, emulator zatrzymałby się pod zamkniętym oknem, bez
// niczego na ekranie, co by to tłumaczyło.

send({ type: 'breakpoints', addrs: [], io: null });
const wznowienie = send({ type: 'resume' }).find((m) => m.type === 'paused');
check(!!wznowienie && wznowienie.paused === false,
      'wznowienie zgłasza, że maszyna znowu chodzi');

const przedFinalem = podgladaj();
await bieg(400);
const finalne = wszystkie('paused');
const poFinale = podgladaj();
check(finalne.length === 0 && poFinale.cycles > przedFinalem.cycles + 100000,
      'po zdjęciu pułapek maszyna chodzi bez zatrzymań',
      `${finalne.length} zatrzymań, ${poFinale.cycles - przedFinalem.cycles} cykli`);

for (const id of timers) clearInterval(id);
process.exit(fails ? 1 : 0);
