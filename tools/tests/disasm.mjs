// Deasembler: czy czyta to samo, co wykonuje procesor.
//
// Zestaw stoi na dwóch nogach. Pierwsza to garść ciągów bajtów sprawdzonych
// ręcznie — w tym te z ROM-u Portfolio, które akurat trzeba było przeczytać
// w śledztwie, żeby dowiedzieć się, co robi ROM z kontrastem.
//
// Druga jest ważniejsza i to ona wyłapie prawdziwe błędy: **na kilkudziesięciu
// tysiącach instrukcji z prawdziwego rozruchu długość policzona przez
// deasembler musi zgadzać się z liczbą bajtów, które pobrał procesor**.
// Procesor liczy je sam, w `cpu.fetched`, więc nie trzeba niczego zakładać.
// Rozjazd choćby o bajt oznacza, że deasembler czyta inaczej niż maszyna
// wykonuje — a wtedy okno inspektora pokazywałoby fikcję, i to tym gorszą, że
// wyglądającą sensownie.

import { disasm, disasmRange } from '../../js/emu/disasm.js';
import { boot, run, bootToPrompt, romsAvailable } from '../pofo-headless.mjs';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

// --- 1. ciągi sprawdzone ręcznie --------------------------------------------

const PRZYKLADY = [
  [[0x90], 'nop', 1],
  [[0xEE], 'out dx, al', 1],
  [[0xEC], 'in al, dx', 1],
  [[0xBA, 0x60, 0x80], 'mov dx, 8060h', 3],
  [[0x3C, 0xFC], 'cmp al, FCh', 2],
  [[0x04, 0x04], 'add al, 04h', 2],
  [[0xB0, 0x0C], 'mov al, 0Ch', 2],
  [[0xA0, 0x04, 0x05], 'mov al, [0504h]', 3],
  [[0xA3, 0x00, 0x05], 'mov [0500h], ax', 3],
  [[0x8B, 0x3E, 0xFA, 0x04], 'mov di, [04FAh]', 4],
  [[0xC7, 0x06, 0x00, 0x05, 0x1E, 0x00], 'mov [0500h], 001Eh', 6],
  [[0x83, 0x06, 0x00, 0x05, 0x1E], 'add [0500h], 1Eh', 5],
  [[0xF6, 0x06, 0x65, 0x01, 0x20], 'test [0165h], 20h', 5],
  [[0x8A, 0x47, 0x01], 'mov al, [bx+01h]', 3],
  [[0x8A, 0x87, 0x34, 0x12], 'mov al, [bx+1234h]', 4],
  [[0x2E, 0x8A, 0x07], 'mov al, [cs:bx]', 3],
  [[0xF3, 0xA4], 'rep movsb', 2],
  [[0xF2, 0xAE], 'repne scasb', 2],
  [[0xCD, 0x21], 'int 21h', 2],
  [[0xCF], 'iret', 1],
  [[0xF4], 'hlt', 1],
  [[0xD1, 0xE3], 'shl bx, 1', 2],
  [[0xD3, 0xE8], 'shr ax, cl', 2],
  [[0xF7, 0xE3], 'mul bx', 2],
  [[0xEA, 0x00, 0x01, 0x00, 0xF0], 'jmp F000h:0100h', 5],
  [[0xD6], 'salc              ; nieudokumentowane', 1],
  [[0x0F], 'pop cs            ; nieudokumentowane', 1],
  [[0x82, 0xC0, 0x05], 'add al, 05h   ; nieudokumentowany alias 80h', 3],
  // Ten wiersz stał tu wcześniej jako `db 64h` o długości bajtu i utrwalał błąd:
  // rdzeń od zawsze wykonywał 60h–6Fh jako skoki warunkowe, więc deasembler
  // liczył o bajt za mało i całe okno rozjeżdżało się od tego miejsca w dół.
  // Wyszło to dopiero, gdy `cpu-undoc.mjs` porównał długości na całej mapie,
  // a nie tylko na instrukcjach, które wykonuje ROM.
  [[0x64, 0x00], 'jz 0002h   ; nieudokumentowany alias 74h', 2],
  // Jedyne miejsce na mapie, które naprawdę nie jest instrukcją: FFh z polem
  // reg równym 7. Wychodzi jako zrzut bajtów, a nie jako zmyślona mnemonika —
  // ale o długości takiej, jaką pobiera procesor, żeby chodzenie po pamięci nie
  // straciło synchronizacji.
  [[0xFF, 0x38], 'db FFh, 38h', 2],
];

for (const [bajty, tekst, dlugosc] of PRZYKLADY) {
  const r = disasm((i) => bajty[i] ?? 0);
  check(`${bajty.map((b) => b.toString(16).padStart(2, '0')).join(' ')} → ${tekst}`,
        r.text === tekst && r.len === dlugosc, `dostano "${r.text}", ${r.len} B`);
}

// --- 2. skoki liczone od końca instrukcji -----------------------------------
// Cel skoku krótkiego liczy się od bajtu ZA instrukcją, nie od jej początku —
// klasyczne miejsce na pomyłkę o dwa.

{
  const r = disasm((i) => [0xEB, 0xFE][i]);            // skok w samego siebie
  check('skok krótki liczy cel od końca instrukcji', r.text === 'jmp short 0000h',
        r.text);
  const g = disasm((i) => [0x75, 0x06][i]);
  check('jnz +6 wskazuje osiem bajtów dalej', g.text === 'jnz 0008h', g.text);
}

// --- 3. chodzenie po kolejnych instrukcjach ---------------------------------

{
  // ba 60 80  ec  3c fc  73 03  04 04  ee   — pętla kontrastu z E000:1BA0
  const kod = [0xBA, 0x60, 0x80, 0xEC, 0x3C, 0xFC, 0x73, 0x03, 0x04, 0x04, 0xEE];
  const linie = disasmRange((a) => kod[a - 0x1BA0] ?? 0, 0x0000, 0x1BA0, 6);
  const tekst = linie.map((l) => l.text).join(' / ');
  check('sześć instrukcji pętli kontrastu z ROM-u',
        tekst === 'mov dx, 8060h / in al, dx / cmp al, FCh / jnb 1BABh / add al, 04h / out dx, al',
        tekst);
}

// --- 4. długości zgodne z procesorem, na prawdziwym kodzie ------------------

if (!romsAvailable()) {
  console.log('POMINIĘTE — sprawdzenie różnicowe wymaga ROM-ów w rom/');
} else {
  const { machine, cpu } = boot();
  bootToPrompt(machine, cpu);

  let sprawdzonych = 0, rozjazdow = 0;
  const pierwszy = [];

  for (let i = 0; i < 60000; i++) {
    const cs = cpu.sregs[1], ip = cpu.ip;
    const base = ((cs << 4) + ip) & 0xFFFFF;
    const { text, len } = disasm((k) => cpu.bus.read8((base + k) & 0xFFFFF));

    cpu.step();

    // Przerwanie albo postój po HLT nie pobierają instrukcji, więc nie ma czego
    // porównywać; liczymy wyłącznie kroki, które faktycznie coś wykonały.
    if (cpu.fetched === 0) continue;
    sprawdzonych++;
    if (cpu.fetched !== len) {
      rozjazdow++;
      if (pierwszy.length < 3) {
        pierwszy.push(`${cs.toString(16)}:${ip.toString(16)} "${text}" ` +
                      `deasembler ${len} B, procesor ${cpu.fetched} B`);
      }
    }
  }

  check(`długości zgodne z procesorem na ${sprawdzonych} instrukcjach`,
        rozjazdow === 0, rozjazdow ? pierwszy.join(' | ') : 'bez rozjazdów');
  check('sprawdzono sensowną próbkę', sprawdzonych > 10000, `${sprawdzonych}`);
}

process.exit(fails ? 1 : 0);
