// Model kolejki rozkazów wobec prawdziwego Portfolio.
//
// To jest jedyny zestaw w projekcie, którego wzorce nie pochodzą z emulatora,
// z tabeli ani z dokumentacji, tylko **z pomiaru na sprzęcie**. Dwa programy,
// `TEMPO.COM` i `TEMPO2.COM`, liczyły na prawdziwej maszynie, ile razy pętla
// obróci się w piętnastu sekundach licznika ASIC-a; stąd, po podzieleniu przez
// liczbę powtórzeń, koszt jednego obiegu w cyklach. Dokładność pomiaru to około
// jednej dziesiątej procenta — okno jest równe co do tyknięcia, a liczba obrotów
// wychodziła od 928 do 1666, więc kwantyzacja nic tu nie psuje.
//
// Wiarygodność samych przebiegów potwierdzają dwie rzeczy. Oba programy mają po
// dwa bloki, które nic nie mierzą, na początku i na końcu — wyszły identyczne
// (1666), więc nic się w trakcie nie przesunęło. I oba zmierzyły `MOV AX,BX` na
// 8,00 c po odjęciu rusztowania, dokładnie na podłodze magistrali, czyli zegar
// 4,9152 MHz i cztery takty na bajt są potwierdzone niezależnie.
//
// Sama liczba z ekranu programu pomiarowego to jeszcze nie koszt pętli: mieści
// w sobie także rusztowanie, które odmierza piętnastosekundowe okno, podzielone
// przez INNER danego bloku. Dlatego przy każdej grupie stoi tablica INNER-ów,
// a model dostaje to samo obciążenie — patrz `NARZUT` niżej.
//
// Czego pilnuje ten zestaw: żeby zmiana w modelu czasowym nie oddaliła się od
// sprzętu po cichu. Wzorce są **pomiarem**, a nie zapisem stanu emulatora, więc
// gdy któryś przestanie pasować, nie wolno go po prostu przenagrać — to znaczy,
// że model właśnie zaczął kłamać o tym konkretnym kształcie kodu. Dopuszczalne
// odchylenie jest wpisane przy każdym bloku i wynika z tego, jak blisko sprzętu
// model dziś na nim jest: krótkie formy mieszczą się w dwóch procentach,
// a przedrostek segmentu w czterech. Przedrostek miał siedem i osiem, dopóki rdzeń
// liczył za jego bajt cztery takty zamiast zmierzonych 2,25; zostało mu tyle, ile
// zostało, bo blok chodzi skokami po osiem taktów — jeden na rozkaz — a sprzęt
// leży dokładnie między dwoma sąsiednimi liczbami całkowitymi, które ten model
// magistrali potrafi wypisać. Trzydzieści limitów zostało w tym wydaniu
// zacieśnionych; żaden nie został poszerzony.
//
// Bloki są odtworzone instrukcja w instrukcję z programów pomiarowych, razem
// z ogonem pętli (`DEC BP` + `JNE`), bo on też jest częścią zmierzonego kosztu.
// Źródła programów leżą poza repozytorium, w katalogu roboczym z programami
// testowymi na sprzęt; tu potrzebne są tylko ich bajty.

import { CPU8088 } from '../../js/emu/cpu8088.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

// Goła maszyna z płaską pamięcią. Porty odpowiadają czymkolwiek — mierzymy czas,
// nie zawartość.
function maszyna(prog) {
  const pam = new Uint8Array(1 << 20);
  pam.set(prog, 0x100);
  const bus = {
    read8: (a) => pam[a],
    write8: (a, v) => { pam[a] = v; },
    in8: () => 0xFF,
    out8: () => {},
    intAck: () => 8,
  };
  const cpu = new CPU8088(bus);
  cpu.reset();
  cpu.sregs[1] = 0;                    // CS
  cpu.sregs[0] = 0;                    // ES = DS, żeby STOSW pisał w to samo miejsce
  cpu.ip = 0x100;
  cpu.regs[4] = 0x1000;                // SP
  cpu.regs[3] = 0x800;                 // BX — bufor danych, z dala od kodu
  cpu.regs[6] = 1;                     // SI
  cpu.regs[2] = 0x8040;                // DX — port bez skutków ubocznych
  cpu.regs[1] = 8;                     // CX — liczba obrotów dla SHL AL,CL
  return { cpu, pam };
}

/**
 * Koszt jednego obiegu pętli w stanie ustalonym.
 *
 * Pierwsze obiegi biegną z pustą kolejką, więc liczy się dopiero to, co dzieje
 * się później: przebieg jest długi, a wynik brany z drugiej połowy.
 */
function obieg(cialo, { powtorzen = 400, ogon = [], pamiec = [], cx = null, bx = null,
                        ax = null, dx = null } = {}) {
  // dec bp / jne wstecz na początek: skok liczy się od bajtu ZA nim, więc
  // przesunięcie to −(długość ciała + 3).
  const prog = [...cialo, 0x4D, 0x75, (256 - (cialo.length + 3)) & 0xFF, ...ogon];
  const { cpu, pam } = maszyna(prog);
  // Bajty dosadzone poza programem — `CALL BX` potrzebuje `RET` pod adresem,
  // na który BX już pokazuje.
  for (const [adres, bajt] of pamiec) pam[adres] = bajt;
  // Bloki, ktore mierza SHL przy innym CL: w programie pomiarowym CX ustawia
  // setup, poza mierzona petla.
  if (cx !== null) cpu.regs[1] = cx;
  // Bloki `MUL BL` mierzą skalowanie mnożnika; drugi operand ustawia setup,
  // poza mierzoną pętlą, tak samo jak w programie pomiarowym.
  if (bx !== null) cpu.regs[3] = bx;
  // `REPNE SCASB` porównuje z AL, a `DIV BX` dzieli DX:AX — jedno i drugie
  // ustawia setup programu pomiarowego, więc i tu musi być ustawione.
  if (ax !== null) cpu.regs[0] = ax;
  if (dx !== null) cpu.regs[2] = dx;
  cpu.regs[5] = powtorzen;                         // BP

  const doPolowy = Math.floor(powtorzen / 2);
  let odliczaj = false, start = 0, obiegi = 0;
  // Zabezpieczenie przed zapetleniem, nie element pomiaru: petla i tak konczy
  // sie na BP = 1. Musi wystarczyc na najdluzsze cialo w zestawie — korpus dema
  // z 54 NOP-ami to 1804 rozkazy na jedno powtorzenie.
  for (let i = 0; i < powtorzen * 4000; i++) {
    if (cpu.ip === 0x100) {
      if (!odliczaj && cpu.regs[5] === doPolowy) { odliczaj = true; start = cpu.cycles; }
      if (odliczaj) obiegi++;
      if (cpu.regs[5] === 1 && odliczaj) break;
    }
    cpu.step();
  }
  return (cpu.cycles - start) / (obiegi - 1);
}

const powtorz = (n, ...b) => Array.from({ length: n }, () => b).flat();
const NOP = 0x90;

/**
 * Pętla zewnętrzna programu pomiarowego, w taktach na jeden obieg.
 *
 * Każdy program `TEMPO` mierzy blok tak: ustawia BP na INNER, obraca pętlę
 * wewnętrzną INNER razy, a potem — wciąż w mierzonym oknie — dolicza jeden do
 * licznika, odczytuje port ASIC-a i sprawdza, czy piętnaście sekund już minęło.
 * To rusztowanie jest **bajt w bajt identyczne we wszystkich sześciu
 * programach**, ale nie jest darmowe, a jego koszt dzieli się przez INNER.
 * Przy INNER = 2000 to 0,13 taktu i nie widać go wcale; przy INNER = 25, na
 * którym mierzona była pętla dema, to 10,60 taktu, czyli ponad pół procenta.
 *
 * Wartość zmierzona wprost: NARZUT.COM to sześć bloków „nic" przy INNER 45,
 * 100, 250, 600, 1200 i 2000. Koszt bloku wychodzi wtedy `c + N/INNER`, czyli
 * `73728000/licznik = c*INNER + N` — prosta. Sześć punktów układa się na niej
 * co do kwantyzacji licznika i dają `c = 22,00` (pusta pętla) oraz `N = 264,94`.
 *
 * Kontrola, która to przesądza: pętla dema była mierzona dwa razy przy dwóch
 * różnych INNER — 1902,17 przy 40 (TEMPO2) i 1906,35 przy 25 (TEMPO4 i TEMPO6).
 * Surowe liczby różnią się o 4,18 taktu (0,22%) i przez rok wyglądały na szum
 * pomiaru. Po odjęciu narzutu wychodzi 1895,55 i 1895,75 — **0,011%**. To nie
 * był szum, tylko rusztowanie.
 *
 * TEMPO7 zmierzył to samo **na sprzęcie**: dwa bloki „nic" przy INNER 2000 i 45
 * dają `c = 21,995` i `N = 264,25`. Pusta pętla wychodzi więc 22,00, a nie
 * 22,13, jak stało w dokumentacji od pierwszego programu. Model liczy swoje
 * rusztowanie na 264,94, czyli o 0,26% drożej — i tyle właśnie ta stała ma
 * zostać, bo modelowi dolicza się to, co jego własne rusztowanie by kosztowało.
 * Przy INNER 25 różnica między 264,94 a 264,25 to 0,03 taktu.
 *
 * Dlatego doliczamy narzut **modelowi**, a nie odejmujemy go od wzorca: wzorzec
 * ma zostać surowym pomiarem, bo taka jest reguła tego pliku. Model dostaje to
 * samo obciążenie, które miał sprzęt, i dopiero wtedy obie liczby są tej samej
 * wielkości.
 */
const NARZUT = 264.94;

// Sprzęt, 2026-08-28. Koszt jednego obiegu w cyklach, razem z ogonem pętli.
const POMIARY = [
  ['pusta pętla (DEC BP + JNE)',        22.13, 2.0, []],
  ['MOV AX,BX x8',                      86.29, 2.0, powtorz(8, 0x89, 0xD8)],
  ['MOV AX,[BX] x8',                   168.56, 1.0, powtorz(8, 0x8B, 0x07)],
  ['MOV [BX],AX x8',                   168.56, 1.0, powtorz(8, 0x89, 0x07)],
  ['MOV AL,[BX] x8',                   136.37, 1.5, powtorz(8, 0x8A, 0x07)],
  ['MOV [BX],AL x8',                   136.37, 1.5, powtorz(8, 0x88, 0x07)],
  ['MOV AX,ES:[BX] x8',                186.56, 3.5, powtorz(8, 0x26, 0x8B, 0x07)],
  ['MOV DI,imm + STOSW x8',            160.47, 4.0, [0xBF, 0x00, 0x08, ...powtorz(8, 0xAB)]],
  ['IN AL,DX x8',                       88.28, 1.0, powtorz(8, 0xEC)],
  ['OUT DX,AL x8',                      88.28, 1.0, powtorz(8, 0xEE)],
  ['MOV AL,[BX+SI+d16] x8',            198.62, 1.0, powtorz(8, 0x8A, 0x80, 0x00, 0x08)],
  ['MOV CX,8 + LOOP $ x8',             168.56, 1.0, [0xB9, 0x08, 0x00, 0xE2, 0xFE]],
  // Pętla, którą rysuje trainfolio, instrukcja w instrukcję — ta jedna rządzi
  // tempem demówek, bo demo spędza w niej 94% taktów.
  //
  // Ta pętla wychodzi −1,61%, ale ta liczba jest sumą **dwóch zmierzonych
  // błędów, które się kasują**. Rdzeń liczy skok `LOOP` na 19,00 przy
  // zmierzonych 18,00, czyli o takt za drogo, i te 29 taktów na obieg zasłaniają
  // drugi, przeciwny dług tej pętli. Poprawiony sam `LOOP` daje tu −3,13%.
  //
  // Ten drugi dług jest zmierzony: **2,00 taktu na kopię korpusu**, stały.
  // Bloki „pętla dema, 15 x 2" i „6 x 5" (POMIARY7) to ta sama praca przy 14
  // i 5 skokach zamiast 29, a deficyt wychodzi w nich 59,98 i 59,96 wobec 59,75
  // tutaj — nie zależy od liczby skoków, tylko od liczby kopii. To **nie jest**
  // koszt skoku.
  //
  // Co o nim wiadomo z drugiej strony: TEMPO2 zmierzył tę samą pętlę bez `OUT`
  // i bez odczytu, i każde z usunięć oszczędzało na sprzęcie 5,99 taktu. Model
  // oddaje odczyt co do setnej (6,00), ale za `OUT` liczy 8,00 — o 2,01 za dużo
  // **w tej pętli**, choć w bloku ośmiu kopii ten sam rozkaz kosztuje 8,25
  // i model trafia. Czyli korpus bez `OUT` jest w modelu o 4,00 taktu na obrót
  // za tani, a `OUT` oddaje z tego połowę. Dwa błędy, oba zmierzone co do
  // setnej, żadnego nie da się poprawić osobno bez pogorszenia całości.
  ['pętla dema (30 bajtów na matrycę)', 1902.17, 1.0,
    [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,           // mov cx,30 / mov si,1
     NOP, NOP, 0x8A, 0x80, 0x00, 0x08,             // nop / nop / mov al,[bx+si+d16]
     0x46, 0xEE, 0xE2, 0xF6]],                     // inc si / out dx,al / loop
];

// INNER każdego bloku w programie pomiarowym — potrzebny, żeby doliczyć NARZUT.
// TEMPO (bloki 1-10) i TEMPO2 (11-13), w kolejności wierszy powyżej.
const INNER_POMIARY = [2000, 800, 450, 450, 550, 550, 400, 450, 800, 800, 400, 450, 40];


// --- TEMPO3 ------------------------------------------------------------------
// Trzeci program, ten sam sposób pomiaru, kształty których dwa pierwsze nie
// objęły: krótkie rozkazy **za pełną kolejką**, ALU z pamięcią, skoki, CALL/RET.
//
// Wypełniaczem jest `SHL AL,CL` przy CL=8 — czterdzieści taktów za dwa bajty,
// więc zostawia magistrali osiem wolnych cykli i kolejka zdąży się napełnić.
// Bloki 6, 7 i 8 to ten sam rozkaz w seriach dwóch, czterech i ośmiu; rabat nie
// może przeżyć kolejki, więc ich trójka mierzy wprost jej głębokość.
//
// Blok „odczyt x8" powtarza kształt zmierzony już w TEMPO2 (198,62) i wyszedł
// 199,10 — zgodność 0,24% między dwoma przebiegami sprzed tygodnia i dzisiejszym
// mówi, ile ta metoda pomiaru jest warta.

const SHLCL = [0xD2, 0xE0];              // shl al,cl — wypełniacz, CL=8
const SHL1 = [0xD0, 0xE0];               // shl al,1
const CZYT = [0x8A, 0x80, 0x00, 0x08];   // mov al,[bx+si+800h]
const mies = (krotki, ile, wyp = SHLCL) =>
  Array.from({ length: 4 }, () => [...wyp, ...powtorz(ile, ...krotki)]).flat();

// Osiem CALL-i do wspólnego RET tuż za pętlą; RET dostawia `ogon`.
const CELRET = 0x100 + 8 * 3 + 3;
const CALLE = Array.from({ length: 8 }, (_, i) => {
  const d = CELRET - (0x100 + i * 3 + 3);
  return [0xE8, d & 0xFF, (d >> 8) & 0xFF];
}).flat();

const POMIARY3 = [
  ['NOP x8',                            54.28, 2.0, powtorz(8, NOP)],
  ['SHL AL,1 x8',                       86.47, 2.0, powtorz(8, ...SHL1)],
  ['MOV AL,[BX+SI+d16] x8(TEMPO3)',    199.10, 2.0, powtorz(8, ...CZYT)],
  ['SHL AL,CL x4',                     185.01, 2.0, powtorz(4, ...SHLCL)],
  ['(SHL CL + NOP x2) x4',             207.20, 2.0, mies([NOP], 2)],
  ['(SHL CL + NOP x4) x4',             233.34, 2.0, mies([NOP], 4)],
  ['(SHL CL + NOP x8) x4',             287.78, 3.0, mies([NOP], 8)],
  ['(SHL CL + SHL 1 x4) x4',           287.61, 2.5, mies(SHL1, 4)],
  ['(odczyt + NOP x4) x4',             174.98, 2.0, mies([NOP], 4, CZYT)],
  ['OR AL,[BX] x8',                    136.93, 1.0, powtorz(8, 0x0A, 0x07)],
  ['JNZ skoczony x8',                  167.03, 2.0, powtorz(8, 0x75, 0x00)],
  ['JZ nieskoczony x8',                 86.47, 2.0, powtorz(8, 0x74, 0x00)],
  ['CALL + RET x8',                    415.95, 3.0, CALLE, { ogon: [0xC3] }],
];

// TEMPO3, w kolejności wierszy powyżej.
const INNER_POMIARY3 = [850, 540, 230, 250, 215, 190, 150, 150, 265, 280, 255, 540, 125];


// --- TEMPO4 ------------------------------------------------------------------
// Czwarty program, 2026-08-29, szesnaście bloków po 15 s. Powstał, żeby
// rozstrzygnąć, czy port danych LCD kosztuje więcej niż zwykły port — bo po
// policzeniu gęstości magistrali w obu demach to był jedyny kandydat, jaki
// został na dwuprocentową lukę trainfolio.
//
// **Nie kosztuje.** Bloki 2, 3 i 4 to ten sam `OUT DX,AL` wycelowany w 8040h,
// 8011h i 8010h, i wszystkie trzy wróciły z identycznym 0613. Bloki 6 i 7 to ta
// sama pętla dema pisząca raz do 8040h, raz do 8010h — oba 060B, różnica zero
// taktów na trzydzieści bajtów. Hipoteza taktów oczekiwania na porcie LCD jest
// zamknięta i nie ma po co do niej wracać.
//
// Kotwice: bloki 1 i 16 wróciły z 0682, tą samą liczbą co w TEMPO, TEMPO2
// i TEMPO3 — przebieg jest porównywalny z tamtymi. TEMPO4 odtworzyło też dwie
// wielkości zmierzone wcześniej: `OUT` wyszedł 88,46 wobec 88,28 z TEMPO2,
// a pętla dema 1906,35 wobec 1902,17. Zgodność 0,2% między przebiegami
// oddalonymi o dzień mówi, ile ta metoda jest warta.
//
// Czego jeszcze nie wiadomo: `JMP` przez rejestr i przez pamięć. Rdzeń liczy je
// na 18 i 24+EA wobec tabelarycznych 11 i 18+EA, żaden nie był mierzony i żaden
// nie ma rodzeństwa, które by to rozstrzygało. Czeka na TEMPO5.
const POMIARY4 = [
  // Zapis zwrotny, którego CMP nie robi. Blok 9 jest kontrolą: SUB różni się od
  // CMP wyłącznie tym, że wynik zachowuje, i sprzęt stawia je 6,86 taktu od
  // siebie — tabela mówi 7. Rdzeń liczył je tak samo do 2026-08-29.
  ['CMP [BX],AL x8',                    137.08, 1.0, powtorz(8, 0x38, 0x07)],
  ['SUB [BX],AL x8',                    192.00, 1.0, powtorz(8, 0x28, 0x07)],
  ['CMP [BX],AX x8',                    169.07, 1.0, powtorz(8, 0x39, 0x07)],
  // Odczyt-modyfikacja-zapis w pamięci. Słowo leży dokładnie osiem taktów nad
  // bajtem — cztery na transfer, a transfery są dwa — i to jest najczystsze
  // potwierdzenie reguły ośmiobitowej szyny, jakie w tym projekcie jest.
  // Rdzeń doliczał tę karę bajtowi, który jej nie płaci, i słowu dwa razy.
  //
  // Limit 3% jest tu szczerszy niż wygodny: model siedzi na −2,5% i −1,9%,
  // czyli tam, gdzie po TEMPO4 siedzi prawie każdy kształt ruszający magistralę
  // (`OUT` −2,3%, CALL przez rejestr −2,7%, pętla dema −1,7%), podczas gdy pusta
  // pętla wypada co do setnej. To nie jest błąd tych rozkazów, tylko wspólne
  // przesunięcie modelu magistrali — i to samo dwa procent, o które trainfolio
  // kończy się za wcześnie. Zaciśnięcie limitu tutaj niczego by nie naprawiło,
  // a zamaskowałoby, gdzie naprawdę jest robota.
  ['INC bajt [BX] x8',                  185.63, 1.0, powtorz(8, 0xFE, 0x07)],
  ['INC słowo [BX] x8',                 249.66, 1.0, powtorz(8, 0xFF, 0x07)],
  ['SHL bajt [BX],1 x8',                185.63, 1.0, powtorz(8, 0xD0, 0x27)],
  ['SHL słowo [BX],1 x8',               249.66, 1.0, powtorz(8, 0xD1, 0x27)],
  // CALL przez rejestr do wspólnego RET tuż za pętlą. BX pokazuje na 800h,
  // więc RET musi tam leżeć. Para wychodzi 45,27 taktu wobec 49,23 dla CALL
  // bezpośredniego z TEMPO3 — forma przez rejestr jest o bajt krótsza i tańsza.
  ['CALL BX + RET x8',                  384.25, 3.0, powtorz(8, 0xFF, 0xD3),
    { powtorzen: 400, pamiec: [[0x800, 0xC3]] }],
];

// TEMPO4, w kolejności wierszy powyżej.
const INNER_POMIARY4 = [240, 240, 240, 156, 156, 156, 156, 113];


// --- TEMPO5 ------------------------------------------------------------------
// Piąty program, 2026-08-29, szesnaście bloków po 15 s. Pytanie: czy rozkaz
// sięgający po dane dostaje rabat kolejki tak samo jak rozkaz rejestrowy.
//
// **Nie dostaje.** Drabina — ten sam `MOV AL,[BX]` w seriach po 1, 2, 4 i 8 za
// czterdziestotaktowym wypełniaczem, który zostawia magistralę wolną i kolejkę
// pełną — wróciła **płaska: 14,09, 14,06, 14,07, 14,06**. Model dawał wtedy 13,07
// i dopiero w strumieniu nasyconym 14,07, czyli rozdawał rabat, którego sprzęt
// nie zna. Dla porównania rozkazy rejestrowe rabat mają i TEMPO3 go zmierzył:
// `NOP` 3,02 za pełną kolejką wobec 4,02 w strumieniu.
//
// Drugie ustalenie tego przebiegu, i trzecie niezależne potwierdzenie tej samej
// rzeczy: **odczyt kosztuje tyle co zapis**. Drabina zapisów wypadła 14,21 i
// 14,11 wobec 14,06 odczytu, a bloki nasycone 136,69 i 136,74. Tabela drukuje
// 8+EA dla odczytu i 9+EA dla zapisu — tej asymetrii na tej maszynie nie ma
// i rdzeń liczy odtąd jedno i drugie po 9+EA.
//
// Kotwice: bloki 1 i 16 wróciły z 0682, wypełniacz z 184,94 wobec 185,01
// z TEMPO3, bloki nasycone z 136,69 / 136,74 / 88,46 wobec 136,37 / 136,37 /
// 88,28 z TEMPO2 i TEMPO4. Pięć kotwic z czterech przebiegów, wszystkie w 0,25%.
//
// Co ten przebieg zostawił otwarte: `OUT` wypada 8,29 na sprzęcie i 8,00
// w tabeli, wszędzie i niezależnie od stanu kolejki. Ćwierć taktu na dostęp,
// którego żadna całkowita wartość tabelaryczna nie odda.
const SHL_CL = [0xD2, 0xE0];             // wypełniacz, CL=8 — zostawia magistralę wolną
const drabina = (rozkaz, n) =>
  Array.from({ length: 4 }, () => [...SHL_CL, ...powtorz(n, ...rozkaz)]).flat();

const POMIARY5 = [
  ['SHL AL,CL x4 (wypełniacz)',          184.94, 2.0, powtorz(4, ...SHL_CL)],
  // Drabina odczytów. To ona rozstrzygnęła, że rabatu tu nie ma — cztery
  // liczby, które muszą zostać płaskie, bo takie wróciły ze sprzętu.
  ['(SHL CL + MOV AL,[BX] x1) x4',       241.30, 2.0, drabina([0x8A, 0x07], 1)],
  ['(SHL CL + MOV AL,[BX] x2) x4',       297.43, 2.0, drabina([0x8A, 0x07], 2)],
  ['(SHL CL + MOV AL,[BX] x4) x4',       409.99, 2.0, drabina([0x8A, 0x07], 4)],
  ['(SHL CL + MOV AL,[BX] x8) x4',       634.95, 2.0, drabina([0x8A, 0x07], 8)],
  ['(SHL CL + MOV [BX],AL x2) x4',       298.60, 2.0, drabina([0x88, 0x07], 2)],
  ['(SHL CL + MOV [BX],AL x8) x4',       636.40, 2.0, drabina([0x88, 0x07], 8)],
  ['(SHL CL + OUT DX,AL x2) x4',         252.39, 1.0, drabina([0xEE], 2)],
  ['(SHL CL + OUT DX,AL x8) x4',         445.30, 1.0, drabina([0xEE], 8)],
  ['(SHL CL + MOV AX,[BX] x2) x4',       329.68, 2.0, drabina([0x8B, 0x07], 2)],
  ['(SHL CL + MOV AX,[BX] x8) x4',       763.89, 2.0, drabina([0x8B, 0x07], 8)],
  ['MOV AL,[BX] x8 (TEMPO5)',            136.69, 1.5, powtorz(8, 0x8A, 0x07)],
  ['MOV [BX],AL x8 (TEMPO5)',            136.74, 1.0, powtorz(8, 0x88, 0x07)],
  ['OUT DX,AL x8 (TEMPO5)',               88.46, 1.0, powtorz(8, 0xEE)],
];

// TEMPO5, w kolejności wierszy powyżej.
const INNER_POMIARY5 = [249, 194, 159, 117, 77, 155, 73, 185, 104, 144, 63, 344, 332, 536];


// --- TEMPO6 ------------------------------------------------------------------
// Szósty program, 2026-08-29, szesnaście bloków po 15 s. Powstał z uwagi
// użytkownika, że emulator rozjeżdża się z Portfolio **najbardziej podczas
// efektu tunelu** w trainfolio. Profil dema pokazał, gdzie ten tunel jest:
// sekundy 78-96, a 99,4% ich taktów zjada jedna pętla — osiem pikseli na obrót,
// szesnaście odczytów i jeden zapis do portu, magistrala zajęta w 95,5%,
// najwięcej w całym demie. Bloki 2-5 to ta sama pętla z jedną rzeczą zmienioną
// na raz, więc odejmowanie liczników odpowiada wprost, bez pośrednictwa modelu.
//
// **Pętla wyszła dokładnie sumą swoich części.** Szesnaście odczytów po 22,12
// (zmierzone osobno w tym samym przebiegu), osiem `INC SI` po 4,02 (tyle, co
// `NOP` w TEMPO3), `OUT` 8,29 i pusta pętla 22,13 dają 416,50 wobec zmierzonych
// **416,23**. Zgodność 0,07% — na sprzęcie mieszanka rozkazów nie dostaje
// żadnego rabatu, koszty się po prostu dodają. Model dawał wtedy 387,00, czyli
// **6,5% za szybko**, bo wciskał pobranie kodu w każdą szczelinę, jaką widział.
// Stąd `QUEUE_START` = 2: dwa takty widocznego luzu, zanim BIU podejmie decyzję.
// Po tej zmianie wszystkie cztery bloki tunelu leżą w 0,6%.
//
// Trzy tryby adresowania — `[SI+d16]`, `[BX+DI+d16]` i `[BX+SI+d16]`, czyli
// EA 9, 12 i 11 według tabeli — w strumieniu nasyconym kosztują **dokładnie tyle
// samo**, trzy razy 199,10: magistrala chowa całe EA. Za pełną kolejką różnica
// wychodzi na wierzch, 19,94 taktu na osiem odczytów, czyli 2,49 na rozkaz przy
// tabelarycznych 3.
//
// Kotwice: bloki 1 i 16 z 0682, blok z `[BX+SI+d16]` 199,10 co do setnej wobec
// TEMPO3, `MOV AL,[BX]` 136,69 i `OUT` 88,46 wobec TEMPO5, pętla dema 1906,35
// wobec 1902,17 z TEMPO4. Wszystkie pięć trafiły.
//
// **Czego tu nie ma, a zostało zmierzone:** ta sama pętla tunelu przepisana na
// przemieszczenie ośmiobitowe — szesnaście bajtów kodu mniej, to samo EA według
// każdej tabeli — kosztuje na sprzęcie **462,92**, czyli o 2,92 taktu na rozkaz
// **więcej** niż wersja z disp16. Rdzeń liczy odwrotnie i wychodzi mu 371.
// Bloku nie ma w zestawie, bo model tego mechanizmu nie zna i nie da się go
// dopasować bez zgadywania; w obu demach rozkazy z disp8 to 0,08% i 1,69%, więc
// zwłoka nic nie kosztuje. Opisane w nagłówku `js/emu/cpu8088.js`.
const D_TUNEL = 0x800;
const MOV_BL_SI = [0x8A, 0x9C, D_TUNEL & 0xFF, D_TUNEL >> 8];      // mov bl,[si+d16]
const czytAL = (op, k) => [op, 0x81, (D_TUNEL + 16 * k) & 0xFF, (D_TUNEL + 16 * k) >> 8];

// Pętla, którą trainfolio rysuje tunel, rozkaz w rozkaz. Osiem pikseli: indeks
// tekstury do BL, bit z tablicy do AL, i tak osiem razy na jeden bajt obrazu.
const tunel = ({ out = true, inc = true, alu = true,
                 przed = 0, naPoczatku = 0 } = {}) => {
  const c = [];
  for (let i = 0; i < naPoczatku; i++) c.push(NOP);
  for (let p = 0; p < 8; p++) {
    c.push(...MOV_BL_SI);
    if (inc) c.push(0x46);                                  // inc si
    c.push(...czytAL(p === 0 || !alu ? 0x8A : 0x0A, p));     // mov/or al,[bx+di+d16]
  }
  // TEMPO17: bajt kodu wcisniety tuz przed `OUT` tunelu kosztuje na sprzecie
  // dokladnie tyle, co na poczatku korpusu — patrz grupa TEMPO17 nizej.
  for (let i = 0; i < przed; i++) c.push(NOP);
  if (out) c.push(0xEE);
  return c;
};

const POMIARY6 = [
  ['pętla tunelu (trainfolio)',           416.23, 2.0, tunel()],
  ['pętla tunelu bez OUT',                408.21, 2.0, tunel({ out: false })],
  ['pętla tunelu bez INC SI',             384.27, 2.0, tunel({ inc: false })],
  ['pętla tunelu, MOV zamiast OR',        416.23, 2.0, tunel({ alu: false })],
  ['MOV BL,[SI+d16] x8',                  199.10, 2.0, powtorz(8, ...MOV_BL_SI)],
  ['OR AL,[BX+DI+d16] x8',                199.10, 2.0, powtorz(8, ...czytAL(0x0A, 0))],
  // Limit podniesiony z 3,0 do 3,5 przy doliczeniu narzutu, i to jest jedyne
  // miejsce w pliku, gdzie limit musiał ustąpić. Nie dlatego, że model się
  // pogorszył — dlatego, że przestał być zamazany. Poprzednio ten blok wypadał
  // +2,66% w tłumie innych po −0,5%; po odjęciu rusztowania cała reszta rodziny
  // `(SHL CL + ...)` siedzi między +0,04% a +0,44%, a ten jeden stoi na +3,28%
  // i jest teraz **trzecim co do wielkości znanym błędem modelu**.
  //
  // Czego o nim wiadomo: bliźniak `[BX+DI+d16]` w tej samej drabinie wychodzi
  // −0,26%, więc to nie jest wspólny błąd drabiny, tylko coś w samym `[SI+d16]`
  // za pełną kolejką. Sprzęt mówi, że różnica między tymi dwoma trybami to 2,49
  // taktu na rozkaz, model liczy 1,00, a tabela 3. W ciągu nasyconym oba wychodzą
  // co do setnej (+0,03%), bo magistrala chowa całe EA — błąd widać wyłącznie
  // tam, gdzie kolejka jest pełna.
  //
  // Czego nie wiadomo: mechanizmu. Punkt pomiarowy jest **jeden**, więc dobranie
  // do niego liczby w tabeli EA byłoby dopasowaniem, a nie pomiarem, i tak
  // zostaje do czasu, aż ten kształt zostanie zmierzony przy kilku długościach
  // drabiny. Na demach nic nie kosztuje: tunel wykonuje ten rozkaz osiem razy na
  // bajt obrazu, ale przy 95% zajętości magistrali różnica nie ma się gdzie
  // pokazać i pętla tunelu wychodzi +0,01%.
  ['(SHL CL + MOV BL,[SI+d16] x2) x4',    336.06, 1.5, drabina(MOV_BL_SI, 2)],
  // Limit poszerzony po TEMPO10. Ten blok różni się od zmierzonego tam
  // `[BX+SI+d16]` (345,66) dwiema rzeczami naraz — rozkazem (`OR` zamiast `MOV`,
  // tabelaryczne +1) i indeksem — więc nie jest czystym pomiarem EA. Czysty
  // pomiar, przy identycznej długości rozkazu, mówi że **`[BX+DI]` kosztuje
  // dokładnie tyle, co `[BX+SI]`** (313,68 wobec 313,68, ten sam licznik), i to
  // on wszedł do `EA_CYCLES`. Zostająca różnica 1,29 taktu na rozkaz to koszt
  // `OR`-a, którego rdzeń w tym kształcie nie pokazuje — magistrala go chowa.
  ['(SHL CL + OR AL,[BX+DI+d16] x2) x4 [ZNANY -0.82]', 356.00, 0.3, drabina(czytAL(0x0A, 0), 2), { znane: -0.82 }],
  ['INC SI x8',                            54.28, 2.0, powtorz(8, 0x46)],
  // Ta sama pętla dema trzeci raz, teraz w TEMPO6: 1906,35 wobec 1902,17
  // z TEMPO2 i 1906,35 z TEMPO4. Trzy przebiegi w 0,22%.
  ['pętla dema (TEMPO6)',                1906.35, 2.0,
    [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,
     NOP, NOP, 0x8A, 0x80, 0x00, 0x08,
     0x46, 0xEE, 0xE2, 0xF6]],
];

// TEMPO6, w kolejności wierszy powyżej.
const INNER_POMIARY6 = [116, 116, 116, 116, 230, 230, 128, 128, 850, 25];

// Sprzęt, 2026-08-30, TEMPO7. Program powstał, żeby sprawdzić, czy koszt skoku
// wykonanego zależy od tego, na co skacze — bo pętla dema kosztuje na sprzęcie
// 1,76 taktu na obrót więcej, niż wynika z sumy jej części, a tunel jest
// addytywny co do 0,07%, i jedyne, czym się różnią, to gęstość skoków.
//
// **Nie zależy.** Sześć bloków to te same 96 NOP-ów ułożone w 1, 3, 6, 12, 24
// i 48 obrotów — praca stała, zmienia się wyłącznie liczba skoków i wielkość
// lądowania (34, 18, 10, 6 i 4 bajty). Koszt skoku wychodzi 17,99, 18,00,
// 17,99, 17,99 i 17,99. Rozwinięcie pętli dema mówi to samo z drugiej strony:
// 17,98 i 18,00 na jeden usunięty skok. Siedem pomiarów, wszystkie 18,00.
//
// Zysk jest mimo to duży, bo rdzeń liczył **19,00** — o takt za dużo, i to
// wyłącznie dla `LOOP`. `DEC CX` + `JNZ` (blok 9) wrócił z licznikiem 061F,
// identycznym co do jedności z modelem, więc skok warunkowy był policzony
// dobrze. Na tej maszynie `LOOP` kosztuje dokładnie tyle, co skok warunkowy;
// takt, który tabela dolicza za zmniejszenie licznika, nie istnieje.
//
// Bloki 3-9 mają wspólne INNER = 50, bloki 10-11 wspólne 25 — w każdej grupie
// licznik porównuje się z licznikiem, a narzut rusztowania jest identyczny
// i znika w odejmowaniu.
const NOPY = (n) => powtorz(n, NOP);
// mov cx,n / korpus / loop wstecz — dokładnie jak w programie pomiarowym.
const petlaCX = (n, cialo) => [0xB9, n & 0xFF, n >> 8, ...cialo,
                               0xE2, (256 - (cialo.length + 2)) & 0xFF];
// to samo, ale dec cx + jnz zamiast loop
const petlaJNZ = (n, cialo) => [0xB9, n & 0xFF, n >> 8, ...cialo,
                                0x49, 0x75, (256 - (cialo.length + 3)) & 0xFF];
// Korpus pętli dema: dwa NOP-y, odczyt, INC SI, zapis do portu — osiem bajtów.
const KORPUS_DEMA = [NOP, NOP, 0x8A, 0x80, 0x00, 0x08, 0x46, 0xEE];
const demaRozwinieta = (obrotow, kopii) =>
  [0xBE, 0x01, 0x00, ...petlaCX(obrotow, powtorz(kopii, ...KORPUS_DEMA))];

const POMIARY7 = [
  // Ten sam kształt co „pusta pętla", ale zmierzony przy INNER 45 zamiast 2000.
  // Surowe liczby różnią się o 5,74 taktu — i to jest cała kontrola poprawki
  // NARZUT: jeśli model dostanie ją dobrze, oba bloki wyjdą tak samo blisko.
  ['nic przy INNER 45',                  27.87, 2.0, []],
  ['96 NOP, bez pętli wewnętrznej',     411.20, 2.0, NOPY(96)],
  ['3 x NOP x32',                       467.22, 2.0, petlaCX(3,  NOPY(32))],
  ['6 x NOP x16',                       521.23, 2.0, petlaCX(6,  NOPY(16))],
  ['12 x NOP x8',                       629.08, 2.0, petlaCX(12, NOPY(8))],
  // Te dwa bloki były przez dwa programy najgłośniejszym objawem tego, że rdzeń
  // liczy skok `LOOP` na 19,00 przy zmierzonych 18,00: błąd rósł wprost z liczbą
  // skoków, do +2,75% przy dwudziestu trzech i +3,73% przy czterdziestu siedmiu,
  // a limity były rozciągnięte świadomie, żeby uwierały. Poprawka weszła razem
  // ze swoją drugą połową (`IO_SETUP`) i cała drabina leży teraz w 0,05%, więc
  // limity wróciły do 2,0. Blok „DEC CX + JNZ" niżej jest kontrolą: ten sam
  // korpus i tyle samo skoków, ale bez `LOOP`-a — wychodził +0,03% także wtedy,
  // gdy tamte dwa były rozjechane.
  ['24 x NOP x4',                       845.02, 2.0, petlaCX(24, NOPY(4))],
  ['48 x NOP x2',                      1276.68, 2.0, petlaCX(48, NOPY(2))],
  ['24 x NOP x4, DEC CX + JNZ',         941.01, 2.0, petlaJNZ(24, NOPY(4))],
  // Ta sama praca co pętla dema, przy połowie i jednej piątej skoków. To one
  // pokazały, że brakujące takty są **stałe na kopię korpusu i niezależne od
  // liczby skoków** — czyli że nie są kosztem skoku. Szukanie przeniosło się
  // wtedy do wnętrza korpusu i skończyło się na `IO_SETUP`; oba bloki wychodzą
  // teraz w 0,01%.
  ['pętla dema, 15 x 2 kopie',         1636.58, 2.0, demaRozwinieta(15, 2)],
  ['pętla dema, 6 x 5 kopii',          1474.56, 2.0, demaRozwinieta(6, 5)],
  // Przemieszczenie ośmiobitowe wobec szesnastobitowego, jedna zmiana na raz.
  // TEMPO6 dostał na tunelu +2,92 taktu na rozkaz **na korzyść dłuższej formy**
  // i to była jedyna przesłanka, że disp8 jest droższy. Tutaj, przy zmienionym
  // wyłącznie kodowaniu, disp8 wychodzi o 1,75 taktu **tańszy** — czyli tak, jak
  // mówi każda tabela. Tamta anomalia miała inną przyczynę.
  ['MOV AL,[BX+SI+d8] x8',              185.08, 2.5, powtorz(8, 0x8A, 0x40, 0x33)],
  // Drugi punkt dla SHIFT_CL_BASE. Z tego i z CL=8 (40,49 na rozkaz, TEMPO3)
  // wychodzi 4,00 taktu na obrót — dokładnie tyle, co w tabeli — i podstawa
  // 8,50. Rdzeń ma 9 i wychodzi mu o 0,25 za dużo na rozkaz przy obu CL.
  ['SHL AL,CL x4 przy CL=1',             72.46, 2.0, powtorz(4, 0xD2, 0xE0), { cx: 1 }],
];

// TEMPO7, w kolejności wierszy powyżej.
const INNER_POMIARY7 = [45, 50, 50, 50, 50, 50, 50, 50, 25, 25, 230, 550];




// --- TEMPO8 i TEMPO9 ---------------------------------------------------------
// Osmy i dziewiaty program, 2026-08-30, po szesnascie blokow po 15 s. Oba
// rozbieraja te sama petle, ktora trainfolio rysuje dema, i razem odpowiadaja na
// pytanie, ktore ciagnelo sie od TEMPO2: **kiedy zapis do portu kosztuje 10,00
// taktu, a kiedy 8,00**.
//
// Odpowiedz jest jedna liczba i jeden warunek. Cykl wejscia-wyjscia kosztuje
// **dwa takty wiecej, chyba ze poprzedni rozkaz tez siegal po magistrale** —
// po dane albo po port. Stad `IO_SETUP` w rdzeniu. Co ja ustalilo, blok po bloku:
//
//   - `bez OUT` nie ma dlugu wcale (+0,05 na obrot po poprawce `LOOP`), a korpus
//     z jednym zapisem ma +2,05. Sam zapis;
//   - `odczyt -> cztery NOP-y` nie ma zadnego dostepu do danych i ma **ten sam**
//     dlug +2,02. Odczyt z pamieci nie ma z tym nic wspolnego;
//   - `dwa OUT-y` maja +2,08, nie +4,10, a `trzy OUT-y obok siebie` +2,07.
//     W ciagu placi tylko pierwszy;
//   - `trzy OUT-y co dwa NOP-y` maja **+6,03**, czyli po 2,00 na kazdy. Rozsuniete
//     placa osobno — to ten blok rozstrzygnal, ze zwolnienie zalezy od rozkazu
//     poprzedzajacego, a nie od liczby zapisow;
//   - `IN AL,DX zamiast OUT DX,AL` ma dokladnie ten sam dlug. Kierunek nie gra;
//   - `OUT przed odczytem` tez ten sam. Kolejnosc nie gra;
//   - cztery pary z `OUT`-em i bez, przy obrocie 53, 77, 125 i 266 taktu, daja
//     koszt zapisu 10,00 / 9,99 / 10,02 / (12,84). Plasko — wiec to **nie** jest
//     luz na magistrali, jak sie wydawalo. Czwarta para jest skazona wlasna
//     anomalia bloku bez `OUT`, opisana nizej;
//   - `DEC CX + JNZ zamiast LOOP` ma +1,98. To nie jest wlasciwosc `LOOP`-a.
//
// Po wpisaniu reguly **czternascie z szesnastu licznikow TEMPO9 i trzynascie
// z pietnastu waznych licznikow TEMPO8 wychodzi co do jednosci** — a licznik jest
// calkowity, wiec to znaczy z dokladnoscia okolo 0,03%.
//
// Blok 10 TEMPO8 (`odczyt [BX+SI]` przy BX=0) jest tu **pominiety**: czytal PSP
// zamiast wyzerowanego bufora i wysylal na port 8040h zmienne bajty, a bit 0 tego
// portu przelacza tempo zegara, z ktorego program mierzy wlasne okno. Wrocil
// z 038F zamiast ~06AF. Pytanie powtorzyl blok 15 TEMPO9, z BX na buforze.
//
// Bloki, ktore powtarzaja pomiar juz obecny w zestawie (petla dema 1906,35,
// petla tunelu 416,23, `MOV AL,[BX+SI+d16] x8` 199,10), sa pominiete, zeby nie
// liczyc tej samej liczby dwa razy. Wszystkie trzy trafily w oba przebiegi.

// Petla dema w wariantach — dokladnie tak, jak skladaja ja build-tempo8.mjs
// i build-tempo9.mjs. Cialo zaczyna sie od `MOV CX,30` i `MOV SI,1`, a konczy
// skokiem wstecz, wiec jeden pomiar to trzydziesci obrotow.
const dema9 = ({ nop = 2, pad = 0, czyt = 'd16', trzeci = 'inc', out = 1,
                 rozsun = 0, we = false, skok = 'loop' } = {}) => {
  const c = [];
  for (let i = 0; i < nop; i++) c.push(NOP);
  if (czyt === 'd16') c.push(0x8A, 0x80, 0x00, 0x08);        // mov al,[bx+si+0800]
  else if (czyt === 'bx') c.push(0x8A, 0x07);                // mov al,[bx]
  else if (czyt === 'bxsi') c.push(0x8A, 0x00);              // mov al,[bx+si]
  else if (czyt === 'nopy') c.push(NOP, NOP, NOP, NOP);
  if (trzeci === 'inc') c.push(0x46);                        // inc si
  else if (trzeci === 'incdi') c.push(0x47);                 // inc di
  else if (trzeci === 'nop') c.push(NOP);
  for (let i = 0; i < out; i++) {
    if (i > 0) for (let k = 0; k < rozsun; k++) c.push(NOP);
    c.push(we ? 0xEC : 0xEE);                                // in al,dx / out dx,al
  }
  for (let i = 0; i < pad; i++) c.push(NOP);
  const ogon = skok === 'jnz'
    ? [0x49, 0x75, (256 - (c.length + 3)) & 0xFF]             // dec cx / jnz
    : [0xE2, (256 - (c.length + 2)) & 0xFF];                  // loop
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...c, ...ogon];
};

const POMIARY8 = [
  ['petla dema: jeden NOP',            1786.26, 2.0, dema9({ nop: 1 })],
  ['petla dema: bez NOP-ow',           1666.17, 2.0, dema9({ nop: 0 })],
  ['petla dema: cztery NOP-y',         2146.38, 2.0, dema9({ nop: 4 })],
  // Jedyny blok obu programow, ktorego model nie oddaje, i najwiekszy blad
  // w calym zestawie. Sprzet jest o 3,85 taktu na obrot wolniejszy, niz wychodzi
  // z czegokolwiek, co tu stoi, i zaden wariant reguly tego nie zdejmuje.
  //
  // Wiadomo juz DLACZEGO zaden. Petla tunelu ma ten sam ksztalt — odczyt pamieci
  // tuz przed `OUT`-em — i tam sprzet kaze nie karac wcale, co do licznika.
  // Zapis calego stanu jednostki magistrali w chwili cyklu portu daje w obu
  // ksztaltach te same trzy liczby: q=1, prevAccessed=1, prevPort=0. Zadna regula
  // napisana po tym, co model w tej chwili wie, nie ukarze jednego i oszczedzi
  // drugiego. Zwolnienie tylko dla portu probowano ponownie pozniej: blok schodzi
  // na -3,01%, a tunel traci dokladny licznik i idzie na +0,49% — czyli jeden
  // niewyjasniony dlug 3,85 taktu rozlozony na dwa bloki, a nie wyjasnienie.
  // Limit szeroki i wpisany swiadomie; co by to rozstrzygnelo — w naglowku rdzenia.
  ['petla dema: bez INC SI',           1842.05, 0.5, dema9({ trzeci: null })],
  ['petla dema: bez OUT',              1606.27, 2.0, dema9({ out: 0 })],
  ['petla dema: odczyt -> NOP-y',      1725.64, 2.0, dema9({ czyt: 'nopy' })],
  // Wzorzec przemierzony przez TEMPO17 (blok 10) i **poprawiony z 1723,62 na
  // 1721,61**, czyli o 0,12%. Ksztalt kodu jest ten sam bajt w bajt, a jedyna
  // roznica miedzy przebiegami to wartosc, ktora ten blok wysyla na port 8040h:
  // TEMPO8 mial BX=0, wiec czytal PSP i wysylal staly bajt CDh, a TEMPO17 ma BX
  // na wyzerowanym buforze i wysyla 00h. Bit 0 tego portu wybiera tempo tiku,
  // z ktorego program mierzy wlasne okno, wiec przebieg z zerem jest ten, ktoremu
  // mozna wierzyc. Co dokladnie robi ASIC z tym bitem — nie wiadomo; 0,12% to
  // za malo na czynnik dwa i za duzo na kwantyzacje licznika, ktora wszystkie
  // pozostale kotwice siedemnastu programow trafia co do jednosci.
  ['petla dema: odczyt [BX]',          1721.61, 2.0, dema9({ czyt: 'bx' })],
  ['petla dema: dwa OUT-y',            2146.38, 2.0, dema9({ out: 2 })],
  ['petla dema: OUT przed odczytem',   1906.35, 2.0,
    [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,
     NOP, NOP, 0xEE, 0x8A, 0x80, 0x00, 0x08, 0x46, 0xE2, 0xF6]],
  ['petla dema: DEC CX + JNZ',         2025.49, 2.0, dema9({ skok: 'jnz' })],
];

// TEMPO8, w kolejnosci wierszy powyzej.
const INNER_POMIARY8 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25];

const POMIARY9 = [
  ['petla dema: trzy OUT-y w ciagu',   2388.34, 2.0, dema9({ out: 3 })],
  ['petla dema: trzy OUT-y co 2 NOP-y', 2990.99, 2.0, dema9({ out: 3, rozsun: 2 })],
  ['petla dema: IN zamiast OUT',       1906.35, 2.0, dema9({ we: true })],
  ['petla dema + 6 NOP-ow',            2629.01, 2.0, dema9({ pad: 6 })],
  ['petla dema + 6 NOP-ow, bez OUT',   2329.18, 2.0, dema9({ pad: 6, out: 0 })],
  ['petla dema + 18 NOP-ow',           4076.97, 2.0, dema9({ pad: 18 })],
  ['petla dema + 18 NOP-ow, bez OUT',  3776.28, 2.0, dema9({ pad: 18, out: 0 })],
  ['petla dema + 54 NOP-y',            8416.44, 2.0, dema9({ pad: 54 })],
  // TEN BLOK BYL ZMIERZONY DWA RAZY I ZA PIERWSZYM RAZEM WYSZEDL INACZEJ.
  // TEMPO9 dal 8031,37, czyli 3,92 taktu na NOP zamiast 4,00, i przez trzy
  // programy uchodzilo to za anomalie — TEMPO11 szukal dla niej granicy przy 30
  // i 42 NOP-ach i jej nie znalazl. TEMPO15 powtorzyl blok **bajt w bajt, przy
  // tym samym INNER** i dostal 8116,25, czyli licznik 05EA zamiast 05FA. W tym
  // samym przebiegu piec innych kotwic, z pieciu roznych sesji, trafilo co do
  // jedności, a dryf wyszedl zerowy. Stoi tu wiec pomiar nowszy: tamten byl
  // jednorazowy, a NOP-y w tym ksztalcie kosztuja rowne cztery takty.
  ['petla dema + 54 NOP-y, bez OUT',   8116.25, 2.0, dema9({ pad: 54, out: 0 })],
  ['petla dema: INC DI zamiast INC SI', 1906.35, 2.0, dema9({ trzeci: 'incdi' })],
  ['petla dema: NOP zamiast INC SI',   1906.35, 2.0, dema9({ trzeci: 'nop' })],
  // Odlozone pytanie o tryb adresowania, zadane wreszcie bezpiecznie. `[BX+SI]`
  // wobec `[BX+SI+d16]` to na sprzecie -4,15 taktu na obrot, a model liczy -6,10;
  // razem z blokiem `[BX]` z TEMPO8 (-6,09) wychodzi, ze `[BX+SI]` kosztuje
  // **1,94 taktu wiecej niz `[BX]`** — dokladnie tyle, ile mowi tabela (EA 7
  // wobec 5). Model tej roznicy nie zna, bo w nasyconym strumieniu magistrala ja
  // chowa, i tu wychodzi 3,3% za szybko. To ten sam brak, co `[SI+d16]` nizej.
  ['petla dema: odczyt [BX+SI]',       1781.95, 4.0, dema9({ czyt: 'bxsi' })],
];

// TEMPO9, w kolejnosci wierszy powyzej.
const INNER_POMIARY9 = [21, 17, 25, 19, 19, 12, 12, 6, 6, 25, 25, 25];


// --- TEMPO10 i TEMPO11 -------------------------------------------------------
// Dziesiąty i jedenasty program, 2026-08-30, po szesnaście bloków po 15 s. Razem
// zdejmują z listy „STILL WRONG" wszystko, co dało się zmierzyć, i dokładają
// cztery rzeczy, których nikt wcześniej nie mierzył wcale.
//
// **Adres efektywny za pełną kolejką (TEMPO10, bloki 2-7).** Sześć trybów w tym
// samym kształcie, więc różnica jest odejmowaniem liczników. Wynik rozdziela to,
// co TEMPO6 zmieniał naraz:
//
//   [BX]          EA 5, 2 bajty   36,98
//   [BX+SI]       EA 7, 2 bajty   38,98   +2,00 ponad [BX], tabela +2   trafia
//   [BX+DI]       EA 8, 2 bajty   38,98   +2,00 ponad [BX], tabela +3   NIE trafia
//   [SI+d8]       EA 9, 3 bajty   40,99   +4,01                        trafia
//   [SI+d16]      EA 9, 4 bajty   41,72   jeden bajt kodu = +0,73
//   [BX+SI+d16]   EA 11, 4 bajty  42,98   +6,00                        trafia
//
// Dwie rzeczy z tego. Po pierwsze **`[BX+DI]` kosztuje dokładnie tyle, co
// `[BX+SI]`** — tabelaryczna asymetria 7/8 nie istnieje na tej maszynie, i to
// jest poprawka wpisana do rdzenia. Po drugie **bajt kodu kosztuje tu 0,73
// taktu**, nie 2,00, jak liczy rdzeń — po długim `SHL AL,CL` kolejka jest pełna
// i dodatkowy bajt prawie nic nie kosztuje. To jest ten sam brak, przez który
// blok `[SI+d16]` stoi na +3,28%, i dlatego dwa bloki poniżej mają wpisany limit.
//
// **Przedrostek segmentu (TEMPO10, bloki 8-9).** Kosztuje 2,45 taktu w strumieniu
// nasyconym i 1,91 za pełną kolejką, przy tabelarycznych 2. Rdzeń dolicza 3,30
// i stąd `MOV AX,ES:[BX] x8` jest najgorszym blokiem zestawu.
//
// **Reguła portowa (TEMPO10, bloki 10-11).** To był cel tej pary i odpowiedź jest
// jednoznaczna. `OUT` po długim `SHL AL,CL` **nie płaci** `IO_SETUP` — model był
// tam o 7,95 taktu za wysoki, czyli o równe cztery kary. `OUT` po dziesięciu
// NOP-ach płaci co do setnej. Różnica: po `SHL` kolejka jest pełna. Stąd drugie
// zwolnienie w `busUnit` i stąd drabina `(SHL CL + OUT x2) x4` wróciła z +2,39%
// na zero.
//
// **Skok pośredni (TEMPO10, bloki 12-15), nigdy dotąd nie mierzony.** `JMP BX`
// jest o 3,00 takty **tańszy** od `JMP short`, a rdzeń liczył go o 3 droższym —
// sześć taktów w złą stronę, 16,7% na bloku. `JMP [wsk]` wychodzi 39,73 na rozkaz.
//
// **Anomalia `bez INC SI` (TEMPO11, bloki 2-3) — rozwiązana.** Ten sam korpus
// o jeden NOP dłuższy ma **dokładnie ten sam dług**, a dodany NOP kosztuje równe
// 4,00. Więc to nie długość: to **przyległość odczytu do `OUT`-a**. Korpus
// ośmiobajtowy z `NOP`-em między nimi (TEMPO9) ma dług zero, ten sam korpus
// ośmiobajtowy bez przerwy ma +3,85. Zwolnienie `IO_SETUP` dla poprzedniego
// dostępu do pamięci jest w tym kształcie **za hojne** — patrz komentarz przy
// `IO_SETUP`.
//
// **Anomalia NOP-ów bez portu (TEMPO11, bloki 5-6) — rozwiązana.** Doklejone
// NOP-y kosztują 3,997 / 3,998 / 4,002 / 3,993 przy 6, 18, 30 i 42 sztukach.
// Równe 4,00 na całej długości. Podejrzenie brało się z jednego punktu (54 NOP-y),
// który wychodził 3,76 — i to on jest odosobniony, nie reguła.
//
// **disp8 w strumieniu nasyconym (TEMPO11, bloki 8-9).** Ta sama pętla, to samo
// EA w każdym z szesnastu odczytów, te same adresy, szesnaście bajtów kodu mniej:
// **4,878 taktu na bajt**. Rdzeń liczy 4,192. Żadnej anomalii disp8 nie ma —
// tamten pomiar z TEMPO6 zmieniał EA razem z długością.
//
// **MUL skaluje się z mnożnikiem (TEMPO11, bloki 4, 10-13).** 71,24 / 73,21 /
// 77,20 taktu przy AL = 1, 15 i 255, a rdzeń liczy płasko 70,96. Blok 4 zamienia
// operandy rolami i daje 78,19 przy AL=255, BL=1 — czyli **drugi operand też coś
// wnosi**, około jednego taktu, czego żadna reguła oparta na samym AL nie odda.
// Trzy punkty na jednej osi i jeden na drugiej to za mało, żeby to dopasować bez
// zgadywania, więc bloki wchodzą z limitem i opisem. Na demach `MUL` to 0,1%.
//
// **Rozkazy łańcuchowe z REP (TEMPO11, bloki 14-15), nigdy nie mierzone.**
// `REP STOSW` 17,56 taktu na słowo przy tabelarycznych 14, `REP MOVSB` 21,68 na
// bajt przy 17. Rdzeń jest na obu za wolny o 4,2% i 1,5%.

// (MOV BX,adres + skok) osiem razy; skok ląduje na rozkazie tuż za sobą.
// Ciało zaczyna się pod 0x100, a każda para ma pięć bajtów.
const skokiBX = (przezRejestr) => {
  const c = [];
  for (let i = 0; i < 8; i++) {
    const cel = 0x100 + 5 * (i + 1);
    c.push(0xBB, cel & 0xFF, cel >> 8);
    c.push(...(przezRejestr ? [0xFF, 0xE3] : [0xEB, 0x00]));
  }
  return c;
};

// `JMP [wsk]` osiem razy, po cztery bajty; wskaźniki leżą pod 0x300.
const WSK_JMP = 0x300;
const skokiPamiec = () => {
  const c = [];
  for (let i = 0; i < 8; i++) {
    const p = WSK_JMP + 2 * i;
    c.push(0xFF, 0x26, p & 0xFF, p >> 8);
  }
  return c;
};
const PAMIEC_JMP = Array.from({ length: 8 }, (_, i) => {
  const cel = 0x100 + 4 * (i + 1);
  return [[WSK_JMP + 2 * i, cel & 0xFF], [WSK_JMP + 2 * i + 1, cel >> 8]];
}).flat();

// Ten sam kształt co pętla tunelu, ale bez `OUT`-a i z adresami dobranymi tak,
// żeby disp8 i disp16 miały identyczne EA (9) i identyczne adresy. Zostaje
// wyłącznie długość kodu: 74 bajty wobec 58.
const tunelDisp = (d8) => {
  const c = [0x31, 0xF6];                                  // xor si,si
  for (let p = 0; p < 8; p++) {
    c.push(...(d8 ? [0x8A, 0x5C, 0x33] : [0x8A, 0x9C, 0x33, 0x00]));   // mov bl,[si+d]
    c.push(0x46);                                          // inc si
    const dd = 0x40 + 2 * p;
    const op = p === 0 ? 0x8A : 0x0A;                      // mov al / or al
    c.push(...(d8 ? [op, 0x45, dd] : [op, 0x85, dd, 0x00]));           // [di+d]
  }
  return c;
};

const mnozenie = (imm) => powtorz(4, 0xB0, imm, 0xF6, 0xE3);   // (mov al,imm + mul bl) x4
const BUF_REP = 0x800;
const repStosw = powtorz(4, 0xBF, BUF_REP & 0xFF, BUF_REP >> 8,
                            0xB9, 0x08, 0x00, 0xF3, 0xAB);
const repMovsb = powtorz(4, 0xBE, BUF_REP & 0xFF, BUF_REP >> 8,
                            0xBF, (BUF_REP + 256) & 0xFF, (BUF_REP + 256) >> 8,
                            0xB9, 0x08, 0x00, 0xF3, 0xA4);

const POMIARY10 = [
  // Sześć trybów adresowania w jednym kształcie. Blok `[BX]` z TEMPO5 (297,43)
  // powtórzył się tu na 297,70, czyli w 0,09%.
  ['(SHL + MOV AL,[BX+SI] x2) x4',       313.68, 2.0, drabina([0x8A, 0x00], 2)],
  ['(SHL + MOV AL,[BX+DI] x2) x4',       313.68, 2.0, drabina([0x8A, 0x01], 2)],
  ['(SHL + MOV AL,[SI+d8] x2) x4',       329.75, 2.0, drabina([0x8A, 0x44, 0x33], 2)],
  // BAJT KODU. Ten blok różni się od poprzedniego **wyłącznie jednym bajtem
  // kodu**, przy identycznym EA (9) i identycznym adresie. Sprzęt liczy ten bajt
  // **0,73 taktu**, rdzeń 2,00. Bliźniaczy pomiar w drugą stronę zrobił TEMPO11:
  // ta sama pętla tunelu w wersji disp8, szesnaście bajtów kodu mniej przy tym
  // samym EA i tych samych adresach, kosztuje na sprzęcie **4,878 taktu na
  // bajt**, a w rdzeniu 4,192. Czyli w strumieniu nasyconym bajt kodu jest
  // droższy, niż liczy rdzeń, a za pełną kolejką dużo tańszy — rdzeń ma go zbyt
  // płaskim. Przemiatanie czterech stałych BIU po 315 kombinacjach wskazało
  // dzisiejsze wartości jako optimum, więc to nie jest kwestia dostrojenia
  // `QUEUE_BYTE` ani `QUEUE_START`; brakuje mechanizmu. Dwa pomiary, ten sam
  // kierunek, oba z limitem wpisanym świadomie.
  ['(SHL + MOV AL,[SI+d16] x2) x4',      335.62, 1.5, drabina([0x8A, 0x84, 0x00, 0x08], 2)],
  ['(SHL + MOV AL,[BX+SI+d16] x2) x4',   345.66, 2.0, drabina([0x8A, 0x80, 0x00, 0x08], 2)],
  // Przedrostek segmentu za pełną kolejką: 1,91 taktu ponad ten sam odczyt bez
  // przedrostka (329,68/8 = 41,07 na rozkaz), przy tabelarycznych 2.
  ['(SHL + MOV AX,ES:[BX] x2) x4',       345.66, 1.0, drabina([0x26, 0x8B, 0x07], 2)],
  // Para, która rozstrzygnęła drugie zwolnienie `IO_SETUP`.
  ['(SHL + OUT DX,AL) x4',               218.18, 2.0, drabina([0xEE], 1)],
  ['(NOP x10 + OUT DX,AL) x4',           223.12, 2.0,
    Array.from({ length: 4 }, () => [...NOPY(10), 0xEE]).flat()],
  // Skok pośredni, pierwszy pomiar w projekcie.
  ['(MOV BX,imm + JMP BX) x8',           239.39, 2.0, skokiBX(true)],
  ['(MOV BX,imm + JMP short 0) x8',      263.41, 2.0, skokiBX(false)],
  // Model przeskakuje przez zmierzoną wartość: przy 27 w tabeli wychodzi −4,95%,
  // przy 28 +2,57%, i nie ma nic pomiędzy — ten jeden takt decyduje o tym, czy
  // między skokami mieści się jeszcze jedno pobranie kodu. Zostaje bliższa.
  ['JMP [wsk] x8',                       319.36, 3.0, skokiPamiec(), { pamiec: PAMIEC_JMP }],
  ['JMP short 0 x8',                     166.78, 1.0, powtorz(8, 0xEB, 0x00)],
];

// TEMPO10, w kolejności wierszy powyżej.
const INNER_POMIARY10 = [145, 145, 145, 145, 145, 145, 220, 220, 180, 180, 170, 310];

const POMIARY11 = [
  // Odczyt tuż przed `OUT`-em: ten sam dług przy siedmiu i ośmiu bajtach korpusu,
  // a dodany NOP kosztuje równe 4,00. Anomalia jest przyległością, nie długością.
  ['petla dema: bez INC SI, trzy NOP-y', 1962.16, 0.5, dema9({ nop: 3, trzeci: null })],
  // Doklejone NOP-y bez `OUT`-a: 4,00 na sztukę na całej długości.
  ['petla dema + 30 NOP-ow, bez OUT',    5224.49, 2.0, dema9({ pad: 30, out: 0 })],
  ['petla dema + 42 NOP-y, bez OUT',     6670.41, 2.0, dema9({ pad: 42, out: 0 })],
  // SPRAWA disp8 ZAMKNIĘTA. Przy identycznym EA w każdym z szesnastu odczytów
  // i identycznych adresach krótsza forma jest **tańsza**, tak jak mówi każda
  // tabela. Anomalii z TEMPO6 („disp8 droższy o 2,92 taktu na rozkaz") nie ma —
  // tamten pomiar zmieniał EA razem z długością. Zostaje to, co opisano wyżej
  // przy `[SI+d16]`: bajt kodu kosztuje tu 4,878 taktu, a rdzeń liczy 4,192,
  // więc limit jest poszerzony z tego samego powodu i o tyle samo.
  ['tunel bez OUT, disp16',               416.23, 2.0, tunelDisp(false)],
  ['tunel bez OUT, disp8',                337.80, 4.0, tunelDisp(true)],
  // MUL skaluje się z mnożnikiem, rdzeń liczy płasko. Limity szerokie i opisane
  // w nagłówku tej sekcji — trzy punkty na jednej osi to za mało na regułę.
  ['(MOV AL,01 + MUL BL) x4, BL=FF',      329.75, 2.0, mnozenie(0x01), { bx: 0x00FF }],
  ['(MOV AL,0F + MUL BL) x4, BL=FF',      337.63, 2.0, mnozenie(0x0F), { bx: 0x00FF }],
  ['(MOV AL,FF + MUL BL) x4, BL=FF',      353.59, 2.0, mnozenie(0xFF), { bx: 0x00FF }],
  ['(MOV AL,FF + MUL BL) x4, BL=01',      357.57, 2.0, mnozenie(0xFF), { bx: 0x0001 }],
  ['MOV AL,imm x8',                        86.43, 2.0, powtorz(8, 0xB0, 0x5A)],
  // Rozkazy łańcuchowe z `REP`, pierwszy pomiar w projekcie.
  ['(MOV DI + MOV CX + REP STOSW) x4',    597.32, 2.0, repStosw],
  ['(MOV SI + MOV DI + REP MOVSB) x4',    745.88, 2.0, repMovsb],
];

// TEMPO11, w kolejności wierszy powyżej.
const INNER_POMIARY11 = [25, 9, 7, 116, 140, 145, 145, 145, 145, 550, 77, 63];


// --- TEMPO12 -----------------------------------------------------------------
// Dwunasty program, 2026-08-30, szesnascie blokow po 15 s. Poszedl tam, gdzie byl
// najwiekszy pojedynczy blad zestawu — `MOV AX,ES:[BX] x8`, +6,49% — i wynik jest
// taki, ze **przedrostek segmentu nie jest przyczyna niczego**.
//
// Ile kosztuje przedrostek, w czterech rezimach:
//
//                            sprzet   model
//   nasycony, bez pamieci      4,00    4,00   trafia
//   nasycony, z pamiecia       2,24    3,38   -1,14
//   za pelna kolejka, bez pam. 2,00    2,99   -0,99
//   za pelna kolejka, z pam.   1,99    2,00   trafia
//
// Czyli **przedrostek kosztuje 2,00 taktu**, a 4,00 wychodzi wylacznie tam, gdzie
// strumien jest calkowicie zwiazany magistrala (`NOP x8`: jeden bajt na rozkaz,
// cztery takty na rozkaz), i wtedy jego bajt to po prostu jeszcze jeden cykl.
// Do tego: `CS:` kosztuje **dokladnie tyle samo** co `ES:` (ten sam licznik, co do
// jednosci), zapis tyle samo co odczyt, dostep bajtowy tyle samo co slowny. Wiec
// nie liczy sie ani segment, ani kierunek, ani szerokosc — tylko bajt kodu.
//
// Skad wobec tego +6,49%? Z tego, ze caly ten ksztalt jest w modelu za wolny.
// Osiem blokow ma ten sam objaw i wszystkie sa osmioma kopiami krotkiego rozkazu
// siegajacego po pamiec: `MOV AX,[BX]` +1,80, `MOV [BX],AX` +1,80, `MOV AL,[BX]`
// +2,28, `MOV [BX],AL` +2,28, `OR AL,[BX]` +2,20, `CMP [BX],AL` +2,21,
// `CMP [BX],AX` +1,79. Przedrostek dokłada trzeci bajt kodu i ten sam blad rosnie
// do +6,49%. Sprzet jest w nich prawie dokladnie zwiazany magistrala — `MOV AX,[BX]`
// potrzebuje czterech cykli, czyli 16 taktow, i kosztuje 18,36; z przedrostkiem
// pieciu cykli, czyli 20, i kosztuje 20,60 — a model dokłada 2,7 i 2,1 zamiast
// 2,36 i 0,60.
//
// **Czego nie da sie tym naprawic: `EA_READY`.** Przemiatanie powtorzone na 116
// punktach (bylo na 70 i przed `IO_SETUP`) daje dzisiejsze 6 jako jedyna wartosc
// bez odpadow. Blok z przedrostkiem jest na nia bardzo czuly — przy 4, 5, 6 i 7
// wychodzi −2,09%, +2,20%, +6,49% i +10,78% — ale blok bez przedrostka nie
// reaguje wcale, a petla dema i petla tunelu przypinaja szostke: przy piatce
// tunel idzie na −3,83%, przy trojce `QUEUE_START` na +7,70%. Model potrzebowalby
// dwoch roznych `EA_READY` do dwoch ksztaltow, wiec brakuje mechanizmu, nie
// dostrojenia stalej.

const POMIARY12 = [
  // Przedrostek, ktory nic nie robi: bez dostepu do pamieci nie ma adresu do
  // policzenia ani segmentu do podmiany. Zostaje sam bajt kodu.
  ['ES: NOP x8',                          86.41, 2.0, powtorz(8, 0x26, NOP)],
  ['ES: MOV AX,BX x8',                   118.58, 2.0, powtorz(8, 0x26, 0x89, 0xD8)],
  // Trzy bloki, ktore rozkladaja przedrostek na czesci: inny segment, inny
  // kierunek, inna szerokosc dostepu. Na sprzecie **wszystkie trzy daja to samo**
  // co `MOV AX,ES:[BX] x8`, wiec przedrostek to wylacznie bajt kodu. Limity
  // szerokie z tego samego powodu, co tam: caly ksztalt jest w modelu za wolny.
  ['MOV AX,CS:[BX] x8',                  186.93, 3.5, powtorz(8, 0x2E, 0x8B, 0x07)],
  ['MOV ES:[BX],AX x8',                  186.93, 3.5, powtorz(8, 0x26, 0x89, 0x07)],
  ['MOV AL,ES:[BX] x8',                  154.96, 4.0, powtorz(8, 0x26, 0x8A, 0x07)],
  // Czysty koszt bajtu kodu w strumieniu nasyconym: to samo EA (9), ten sam
  // adres, jedyna roznica to d8 wobec d16. Sprzet liczy 3,75 taktu na bajt,
  // rdzen 3,38. TEMPO11 zmierzyl to samo na petli tunelu i dostal 4,878 — wiec
  // koszt bajtu **zalezy od ksztaltu** i nie da sie go wpisac jako stalej.
  ['MOV AX,[SI+33h] x8',                 201.16, 2.0, powtorz(8, 0x8B, 0x44, 0x33)],
  ['MOV AX,[SI+0033h] x8',               231.12, 2.0, powtorz(8, 0x8B, 0x84, 0x33, 0x00)],
  // Przedrostek za pelna kolejka, bez dostepu do pamieci: sprzet 2,00, rdzen 2,99.
  ['(SHL + ES: NOP x2) x4',              223.12, 2.0, drabina([0x26, NOP], 2)],
];

// TEMPO12, w kolejnosci wierszy powyzej.
const INNER_POMIARY12 = [600, 430, 260, 260, 260, 220, 220, 220];

// --- TEMPO13 -----------------------------------------------------------------
// Trzynasty program, 2026-09-01, szesnaście bloków po 15 s: **cała rodzina
// łańcuchowa**, po raz pierwszy z osiami. Do tej pory stała na dwóch punktach
// (`REP STOSW` i `REP MOVSB`, oba przy CX=8), a z jednego punktu nie da się
// odróżnić kosztu rozruchu `REP` od kosztu elementu.
//
// Dwie osie po CX (2, 8, 16) — jedna na rozkazie z jednym dostępem do pamięci na
// element, druga z dwoma — wyszły **prostymi**: punkt środkowy leży 0,012%
// i 0,016% kosztu bloku od cięciwy. Nachylenie to element, wyraz wolny to
// rozruch, i jedno z drugim się nie miesza.
//
// KOSZT ELEMENTU TO DOKŁADNIE TABELA, dla wszystkich pięciu rozkazów:
//
//   rozkaz   sprzęt   tabela        rozkaz   sprzęt   tabela
//   STOSB     10,05     10          MOVSB     17,09     17
//   LODSB     13,06     13          MOVSW     25,12     17+8
//   SCASB     15,08     15          CMPSB     21,89     22
//   STOSW     14,07     10+4
//
// Forma słowna dokłada równe cztery takty na każdy szesnastobitowy transfer —
// `STOSW` jeden, `MOVSW` dwa — czyli dokładnie tyle, ile kosztuje ośmiobitowa
// magistrala. Rdzeń liczył każdy z tych rozkazów o 2 c za drogo, bo tabelaryczną
// liczbę brał za koszt elementu, choć zawiera ona także rozruch; jedyny naprawdę
// zły był `CMPS` z 30 c zamiast 22.
//
// `REPE` I `REPNE` KOSZTUJĄ TYLE SAMO — dwa bloki dobrane tak, żeby oba przeszły
// pełne osiem obrotów (przy AL=00 na wyzerowanym buforze `REPE` trafia za każdym
// razem, przy AL=FF `REPNE` za każdym razem pudłuje), dały **ten sam licznik co
// do jedności**.
//
// Bloki 2 i 15 tamtego programu to bloki 14 i 15 z TEMPO11 przy tych samych
// INNER — trafiły co do jedności i dlatego siedzą wyżej, w `POMIARY11`, a nie tu.

const w16 = (v) => [v & 0xFF, v >> 8];
const CEL_REP = BUF_REP + 256;

/** `(MOV DI,bufor + MOV CX,n + <przedrostek> <rozkaz>)` cztery razy. */
const lanc1 = (n, op, pref = 0xF3, rej = 0xBF) =>
  powtorz(4, rej, ...w16(BUF_REP), 0xB9, ...w16(n), pref, op);

/** `(MOV SI + MOV DI + MOV CX,n + <przedrostek> <rozkaz>)` cztery razy. */
const lanc2 = (n, op, pref = 0xF3) =>
  powtorz(4, 0xBE, ...w16(BUF_REP), 0xBF, ...w16(CEL_REP), 0xB9, ...w16(n), pref, op);

const POMIARY13 = [
  // Oś `STOSW`: dolny i górny punkt. Środkowy jest w `POMIARY11`.
  ['(MOV DI + CX=2 + REP STOSW) x4',      259.51, 2.0, lanc1(2, 0xAB)],
  ['(MOV DI + CX=16 + REP STOSW) x4',    1047.57, 2.0, lanc1(16, 0xAB)],
  ['(MOV DI + CX=8 + REP STOSB) x4',      468.65, 2.0, lanc1(8, 0xAA)],
  // Oś `MOVSB`: dolny i górny punkt. Środkowy jest w `POMIARY11`.
  ['(MOV SI+DI + CX=2 + REP MOVSB) x4',   335.80, 2.0, lanc2(2, 0xA4)],
  ['(MOV SI+DI + CX=16 + REP MOVSB) x4', 1292.93, 2.0, lanc2(16, 0xA4)],
  ['(MOV SI+DI + CX=8 + REP MOVSW) x4',  1002.99, 2.0, lanc2(8, 0xA5)],
  ['(MOV SI + CX=8 + REP LODSB) x4',      565.13, 2.0, lanc1(8, 0xAC, 0xF3, 0xBE)],
  // Para przedrostków: identyczny licznik na sprzęcie.
  ['(MOV DI + CX=8 + REPE SCASB) x4',     629.56, 2.0, lanc1(8, 0xAE), { ax: 0x0000 }],
  ['(MOV DI + CX=8 + REPNE SCASB) x4',    629.56, 2.0, lanc1(8, 0xAE, 0xF2), { ax: 0x00FF }],
  ['(MOV SI+DI + CX=8 + REPE CMPSB) x4',  899.43, 2.0, lanc2(8, 0xA6)],
  // Tła: te same przeładowania wskaźników bez rozkazu łańcuchowego. Rdzeń trafia
  // w nie co do setnej, więc różnica na blokach wyżej nie bierze się z `MOV`-ów.
  ['tlo: (MOV DI + MOV CX,8) x4',         118.67, 1.0,
    powtorz(4, 0xBF, ...w16(BUF_REP), 0xB9, 0x08, 0x00)],
  ['tlo: (MOV SI+DI + MOV CX,8) x4',      166.88, 1.0,
    powtorz(4, 0xBE, ...w16(BUF_REP), 0xBF, ...w16(CEL_REP), 0xB9, 0x08, 0x00)],
];

// TEMPO13, w kolejności wierszy powyżej.
const INNER_POMIARY13 = [163, 45, 90, 129, 36, 46, 82, 70, 70, 46, 390, 277];

// --- TEMPO14 -----------------------------------------------------------------
// Czternasty program, 2026-09-01, szesnaście bloków po 15 s: **mnożenie
// i dzielenie poza `MUL r8`**. Do tej pory z całej rodziny zmierzony był jeden
// rozkaz, a reszta szła płasko z tabeli.
//
// DZIELENIE SKALUJE SIĘ TAK SAMO JAK MNOŻENIE. `DIV BL` kosztuje 80,93 taktu przy
// ilorazie 1 i 86,97 przy 127 — sześć taktów na sześć bitów, czyli ten sam takt na
// bit, którym skaluje się `MUL`. `MUL BX` daje 115,75 przy mnożniku 1 i 129,74
// przy 65535. Tabelaryczne stałe są w obu razach opisem jednego punktu.
//
// `IMUL` PŁACI ZA ZNAK ILOCZYNU, nie za rozmiar operandu: (−1)·(−1) kosztuje
// 79,83, a 1·(−1) — te same wartości bezwzględne, ten sam mnożnik co do bitu —
// 89,86. Dziesięć taktów to przebieg poprawiający.
//
// `IDIV` to `DIV` plus 21,06 taktu i rdzeń miał tę różnicę dobrze (21,12).
//
// DRUGI OPERAND `MUL` JEST ZAMKNIĘTY. TEMPO11 miał trzy rogi kwadratu operandów
// i zamiana ról wychodziła na takt, którego reguła oparta na samym AL nie oddaje.
// Czwarty róg (AL=01, BL=01) wyszedł **co do jedności tak samo** jak (AL=01,
// BL=FF), więc przy małym AL drugi operand nie wnosi nic, a cały efekt to −0,99
// taktu przy AL=FF. Na to nie warto osobnej osi.
//
// Bloki 2 i 3 tamtego programu to bloki 13 i 12 z TEMPO11 przy tych samych INNER —
// trafiły co do jedności i siedzą wyżej, w `POMIARY11`.

const arytm8 = (imm, op) => powtorz(4, 0xB0, imm, 0xF6, op);
const arytm16 = (imm, op) => powtorz(4, 0xB8, ...w16(imm), 0xF7, op);

const POMIARY14 = [
  // Czwarty róg kwadratu operandów `MUL r8`.
  ['(MOV AL,01 + MUL BL) x4, BL=01',      329.75, 2.0, arytm8(0x01, 0xE3), { bx: 0x0001 }],
  // `IMUL` przy tych samych wartościach bezwzględnych, raz z dodatnim iloczynem,
  // raz z ujemnym. Cała różnica to znak.
  ['(MOV AL,FF + IMUL BL) x4, BL=FF',     373.60, 2.0, arytm8(0xFF, 0xEB), { bx: 0x00FF }],
  ['(MOV AL,01 + IMUL BL) x4, BL=FF',     413.73, 2.0, arytm8(0x01, 0xEB), { bx: 0x00FF }],
  // Oś ilorazu `DIV r8`. Dzielnik jest jedynką, więc reszta zawsze zeruje AH
  // i grupa ma jedno przeładowanie.
  ['(MOV AL,01 + DIV BL) x4, BL=01',      378.02, 2.0, arytm8(0x01, 0xF3), { bx: 0x0001 }],
  ['(MOV AL,7F + DIV BL) x4, BL=01',      402.14, 2.0, arytm8(0x7F, 0xF3), { bx: 0x0001 }],
  ['(MOV AL,7F + IDIV BL) x4, BL=01',     486.38, 2.0, arytm8(0x7F, 0xFB), { bx: 0x0001 }],
  ['(MOV AL,FF + AAM) x4',                373.01, 2.0, powtorz(4, 0xB0, 0xFF, 0xD4, 0x0A)],
  ['(MOV AH,FF + MOV AL,FF + AAD) x4',    311.80, 2.0,
    powtorz(4, 0xB4, 0xFF, 0xB0, 0xFF, 0xD5, 0x0A)],
  ['MOV AX,imm16 x8',                     118.68, 1.0, powtorz(8, 0xB8, 0x5A, 0x5A)],
  // Oś mnożnika `MUL r16`, jeden bit wobec szesnastu.
  ['(MOV AX,0001 + MUL BX) x4, BX=FFFF',  533.39, 2.0, arytm16(0x0001, 0xE3), { bx: 0xFFFF }],
  ['(MOV AX,FFFF + MUL BX) x4, BX=FFFF',  589.35, 2.0, arytm16(0xFFFF, 0xE3), { bx: 0xFFFF }],
  // `DIV r16`: DX musi być wyzerowane, bo dzieli się DX:AX.
  ['(MOV AX,7FFF + DIV BX) x4, BX=0001',  701.59, 2.0, arytm16(0x7FFF, 0xF3),
    { bx: 0x0001, dx: 0 }],
];

// TEMPO14, w kolejności wierszy powyżej.
const INNER_POMIARY14 = [145, 145, 145, 117, 117, 96, 119, 141, 389, 75, 75, 69];

// --- TEMPO15 -----------------------------------------------------------------
// Piętnasty program, 2026-09-02, szesnaście bloków po 15 s: **domknięcie taniej
// części listy**. Sześć kotwic z pięciu sesji, dryf zerowy; pięć trafiło co do
// jedności, a szósta jest wynikiem i siedzi wyżej, w `POMIARY9`.
//
// ROZRUCH `REP` TO DWA EFEKTY, NIE JEDEN. TEMPO13 zostawił pytanie, czy wyraz
// wolny osi zależy od rozkazu, czy od liczby przeładowań w grupie — obie
// odpowiedzi pasowały do tych samych czternastu liczników, bo w całym tamtym
// programie te dwie rzeczy szły razem. Blok z **jednym** dostępem do pamięci na
// element i **trzema** przeładowaniami rozerwał parę i wylądował pośrodku, więc
// pytanie było źle postawione: trzy kształty rozdzielają dwie zmienne dokładnie.
// Dodatkowe przeładowanie w grupie to +2,22 taktu, drugi dostęp do pamięci na
// element — +1,23. Pierwsze nie jest rozruchem `REP` w ogóle, tylko źle
// wycenionym kodem **za** nim; drugie jest. Jedna stała nie obsłuży trzech
// kształtów: chcą 11,52, 13,74 i 14,97.
//
// REGUŁA „TAKT NA POZYCJĘ BITU" JEST MARTWA. AL=80h i AL=FFh mają tyle samo
// bitów znaczących i różnią się o 6,97 taktu na rozkaz. Przez 80h, 0Fh i FFh
// przechodzi prosta o nachyleniu 0,99 i 1,00 — równy takt na jedynkę — a AL=01h
// leży takt nad nią, i ten sam takt wraca w rogu kwadratu operandów (przy AL=FF
// zamiana BL z FFh na 01h to +1,00). Zostaje więc reszta rzędu jednego taktu,
// której sześć punktów nie tłumaczy.
//
// `[BP+SI]` KOSZTUJE TYLE, CO `[BX+SI]` — ten sam licznik co do jedności.
// Ostatnia wywnioskowana liczba w `EA_CYCLES` przestała być wywnioskowana.
//
// `IMUL r16` liczy **moduł** mnożnika: przy FFFFh (czyli −1) jest o 3,03 taktu
// TAŃSZY od `MUL`, który płaci tam za szesnaście jedynek. Baza to `MUL` plus 11
// — dwie niezależne drogi dają 10,97 i 10,96 — a znak iloczynu kosztuje 9,96,
// czyli te same dziesięć taktów, co na bajtach. `IDIV r16` to `DIV r16` plus
// 21,02; liczba wpisana tam wcześniej przez symetrię okazała się trafiona.

/** `(MOV DI + MOV AX,0 + MOV CX,n + REP STOSW)` cztery razy — trzy przeładowania. */
const lanc3 = (n) =>
  powtorz(4, 0xBF, ...w16(BUF_REP), 0xB8, 0x00, 0x00, 0xB9, ...w16(n), 0xF3, 0xAB);

const POMIARY15 = [
  // Oś `REP STOSW` z trzema przeładowaniami — ta, która rozdzieliła dwa efekty.
  ['(MOV DI+AX + CX=2 + REP STOSW) x4',   307.52, 2.0, lanc3(2)],
  ['(MOV DI+AX + CX=8 + REP STOSW) x4',   645.24, 2.0, lanc3(8)],
  ['(MOV DI+AX + CX=16 + REP STOSW) x4', 1095.77, 2.0, lanc3(16)],
  // Tło dla osi wyżej. Trzy `MOV`-y w innych rejestrach niż tło TEMPO13, ta sama
  // postać — i sprzęt daje ten sam koszt na grupę (36,21 wobec 36,19).
  ['tlo: (MOV DI + MOV AX + MOV CX,8) x4', 166.96, 1.0,
    powtorz(4, 0xBF, ...w16(BUF_REP), 0xB8, 0x00, 0x00, 0xB9, 0x08, 0x00)],
  // Osiem bitów znaczących, jedna jedynka.
  ['(MOV AL,80 + MUL BL) x4, BL=FF',      325.73, 2.0, arytm8(0x80, 0xE3), { bx: 0x00FF }],
  // Różni się od `[BX+SI]` wyżej wyłącznie polem r/m w bajcie mod/rm.
  ['(SHL + MOV AL,[BP+SI] x2) x4',        313.68, 2.0, drabina([0x8A, 0x02], 2)],
  // `IMUL r16`: oba bloki mają moduł mnożnika równy jeden (FFFFh to −1), więc
  // skalowanie się skraca i cała różnica między nimi to znak iloczynu.
  ['(MOV AX,FFFF + IMUL BX) x4, BX=FFFF', 577.24, 2.0, arytm16(0xFFFF, 0xEB), { bx: 0xFFFF }],
  ['(MOV AX,0001 + IMUL BX) x4, BX=FFFF', 617.10, 2.0, arytm16(0x0001, 0xEB), { bx: 0xFFFF }],
  ['(MOV AX,7FFF + IDIV BX) x4, BX=0001', 785.68, 2.0, arytm16(0x7FFF, 0xFB),
    { bx: 0x0001, dx: 0 }],
  // Dwanaście NOP-ów za pięćdziesiątym czwartym, przy tym samym INNER co blok
  // z 54 NOP-ami w `POMIARY9`: różnica liczników to czysty koszt tych NOP-ów
  // i wyszła po 3,997 taktu, tyle samo w sprzęcie i w rdzeniu.
  ['petla dema + 66 NOP-ow, bez OUT',    9555.21, 2.0, dema9({ pad: 66, out: 0 })],
];

// TEMPO15, w kolejności wierszy powyżej.
const INNER_POMIARY15 = [153, 72, 42, 276, 145, 145, 75, 75, 69, 6];

// ---- TEMPO16 ---------------------------------------------------------------
//
// Przebieg wzorcowy: **osiem kotwic na osiem trafionych co do jedności**, dryf
// 0,000%. Cztery pytania, cztery ostre odpowiedzi.
//
// **`MUL` płaci za jedynki, a położenie nie kosztuje nic.** `AL` = 02h — jedna
// jedynka na bicie 1 — wróciło z **tym samym licznikiem** co `AL` = 80h, jedna
// jedynka na bicie 7. `AL` = C0h, dwie jedynki, leży na prostej popcountu
// z dokładnością setnej. Zostało `AL` = 01h, które siedzi **takt nad prostą**,
// choć ma jedną jedynkę dokładnie tak samo jak 80h i 02h.
//
// To nie jest bit zerowy — FFh ma go zapalony i leży na prostej. To jest
// **wartość jeden**, i liczy się po obu stronach: w kwadracie operandów `AL`=FF
// z `BL`=01 stoi takt nad `AL`=FF z `BL`=FF, a `AL`=01 z `BL`=01 stoi tam, gdzie
// `AL`=01 z `BL`=FF, a nie dwa takty wyżej. Jeden takt, jeśli którykolwiek
// operand jest jedynką, raz. Sześć punktów, wszystkie dokładnie.
//
// **`AAM` skaluje się ilorazem**, po 0,995 taktu na jedynkę — czyli tym samym
// nachyleniem, co `DIV`. Zmieniony sam bajt bezpośredni (`AAM 02` zamiast
// `AAM 0A`, ten sam `AL`, ta sama długość) podniósł iloraz z 25 na 127 i blok
// o 3,98 taktu na rozkaz. Tabelaryczna wartość płaska była opisem jednego punktu.
//
// **`AAD` nie skaluje się mnożną.** Ten sam blok z wyzerowanym `AH`, więc
// mnożenie przez dziesięć nie ma czego mnożyć, wrócił z **tym samym licznikiem**
// (068D dwa razy). Wartość płaska jest właściwa i teraz jest to zmierzone.
//
// **Pętla rysująca: płaci przyległość, nie liczba odczytów.** Oś 1-2-3-4
// odczytów przed `OUT`-em, przy tym samym INNER i tym samym adresie efektywnym,
// daje dług **3,85 / 3,85 / 3,81 / 3,84** taktu na obrót — stały. Koszt każdego
// kolejnego odczytu to 21,98 taktu i rdzeń liczy **21,98**, co do setnej. A blok
// z `INC SI` wciśniętym między ostatni odczyt a `OUT` trafia **co do licznika**
// także przy czterech odczytach (3885,53 wobec 3885,53).
//
// Czyli płaci jeden odczyt przylegający do `OUT`-a, raz na obrót, niezależnie od
// tego, ile odczytów stoi przed nim i jak długi jest korpus. To **obala** hipotezę,
// z którą ten blok powstał: że tunel nie płaci, bo ma szesnaście dostępów
// i pięćdziesiąt siedem bajtów kodu. Ani jedno, ani drugie. Różnica między
// demą a tunelem leży gdzie indziej i lista otwartych pozycji ma to zapisane.
const dema16 = (odczytow, inc) => [
  0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,
  0x90, 0x90,
  ...powtorz(odczytow, 0x8A, 0x80, 0x00, 0x08),
  ...(inc ? [0x46] : []),
  0xEE,
  0xE2, (256 - (3 + 4 * odczytow + (inc ? 1 : 0) + 2)) & 0xFF,
];

const POMIARY16 = [
  ['(MOV AL,02 + MUL BL) x4, BL=FF',       325.73, 2.0, mnozenie(0x02), { bx: 0x00FF }],
  ['(MOV AL,C0 + MUL BL) x4, BL=FF',       329.75, 2.0, mnozenie(0xC0), { bx: 0x00FF }],
  ['(MOV AL,FF + AAM 02) x4',              388.93, 2.0, powtorz(4, 0xB0, 0xFF, 0xD4, 0x02)],
  ['(MOV AH,00 + MOV AL,FF + AAD) x4',     311.80, 2.0,
    powtorz(4, 0xB4, 0x00, 0xB0, 0xFF, 0xD5, 0x0A)],
  ['dema bez INC SI, 2 odczyty',          2501.37, 0.5, dema16(2, false)],
  ['dema bez INC SI, 3 odczyty',          3160.90, 0.5, dema16(3, false)],
  ['dema bez INC SI, 4 odczyty',          3820.10, 0.5, dema16(4, false)],
  ['dema z INC SI, 4 odczyty',            3885.53, 2.0, dema16(4, true)],
];

// TEMPO16, w kolejności wierszy powyżej.
const INNER_POMIARY16 = [145, 145, 119, 141, 25, 25, 25, 25];

// ---- TEMPO17 ---------------------------------------------------------------
//
// Siedemnasty program, 2026-09-03. Szesc kotwic na siedem trafionych co do
// jednosci, dryf 0,000%; siodma to blok `[BX]`, ktory sam byl ponownym pomiarem
// podejrzanego punktu — patrz notka przy jego wzorcu wyzej.
//
// Program mial rozstrzygnac jedna rzecz: **ile kosztuje bajt kodu w zaleznosci
// od tego, gdzie w korpusie petli stoi**. Odpowiedzial pieciu osiami i zadna nie
// wyszla tak, jak model przewidywal.
//
// **OS A — POZYCJA BAJTU W KORPUSIE DEMA.** Cztery miejsca, ten sam NOP:
//
//     na poczatku korpusu                4,00   (TEMPO8, trzy punkty)
//     miedzy odczytem a `OUT`-em         2,14   pierwszy
//                                        3,97   drugi
//                                        4,03   trzeci
//     miedzy `OUT`-em a `LOOP`-em        0,15   czyli DARMO
//
// Bajt za portem nie kosztuje nic, pierwszy bajt przed portem kosztuje polowe,
// kazdy nastepny pelna cene. To wyglada na jedna szczeline okolo dwoch taktow
// magistrali w okolicy `OUT`-a: pierwsza wstawka ja zjada, dalsze placa normalnie.
// Model liczy 4,00 na poczatku (dobrze), 5,99 / 3,97 / 4,03 miedzy odczytem
// a portem (pierwszy zle) i 4,00 za portem (zle o cale cztery takty).
//
// **OS B — TA SAMA POZYCJA W TUNELU, I TO JEST NIESPODZIANKA.** Ten sam NOP
// przed `OUT`-em tunelu i na poczatku korpusu tunelu daly **ten sam licznik**,
// 05E9 dwa razy, czyli 3,85 taktu jeden i drugi. W tunelu szczeliny przed portem
// **nie ma**. Model przewidywal 5,80 i 3,85, czyli te sama asymetrie, co w demie,
// wiec myli sie tu w druga strone niz tam: przed `OUT`-em tunelu liczy o 1,95
// za duzo. Tunel wychodzil dotad co do licznika, bo tego jednego bajtu nikt
// nigdy nie zmierzyl.
//
// Wniosek jest twardy: **dema i tunel naprawde zachowuja sie inaczej** w tym
// samym miejscu kodu, i nie jest to artefakt modelu. Rozne sa dwie rzeczy —
// dlugosc korpusu (dziewiec bajtow wobec pieciudziesieciu siedmiu) i to, czy
// petla konczy sie `LOOP`-em, ktory czysci kolejke, tuz za portem.
//
// **OS C — ADRES EFEKTYWNY PRZY ROWNEJ DLUGOSCI KODU.** Cztery odczyty
// dwubajtowe, wszystkie w tym samym korpusie:
//
//     `[BX]`      EA 5    1721,61
//     `[DI]`      EA 5    1721,61   ten sam licznik co `[BX]`
//     `[BX+SI]`   EA 7    1781,95   +2,01 taktu na obrot
//     `[BX+DI]`   EA 7    1781,95   ten sam licznik co `[BX+SI]`
//
// Dwa ustalenia. Pierwsze: **czas EA wychodzi na wierzch takt za takt** —
// dwa takty tabeli to 2,01 taktu sprzetu. Drugie: **tabelaryczne rozroznienie
// 7 wobec 8 dla form bazowo-indeksowych nie istnieje**. `[BX+DI]` ma wedlug
// tabeli 8, a kosztuje dokladnie tyle, co `[BX+SI]` z siodemka — tak samo, jak
// TEMPO15 pokazal dla `[BP+SI]`. Plaska siodemka w `EA_CYCLES` jest teraz
// zmierzona we wszystkich czterech formach, nie wywnioskowana.
//
// **OS D — BAJT KODU ODCZYTU PRZY TEJ SAMEJ RODZINIE ADRESOWANIA.** Drabina
// dwa-trzy-cztery bajty przy `[BX+SI...]`:
//
//     `[BX+SI]`        2 bajty, EA 7    1781,95
//     `[BX+SI+00]`     3 bajty, EA 11   1902,66   +4,02
//     `[BX+SI+bufor]`  4 bajty, EA 11   1906,35   +0,12
//
// Czwarty bajt odczytu jest **darmowy**, a trzeci kosztuje 4,02 — czyli dokladnie
// tyle, ile wynosza jego cztery takty EA. Razem z osia C daje to jedno zdanie:
// **w tym korpusie sprzet placi za takty EA jeden do jednego, a bajty kodu samego
// odczytu ma za darmo**. Model robi odwrotnie: chowa cale EA za magistrala,
// a za bajty liczy 3,99 i 2,10. Oba opisy daja te sama sume od `[BX]` do
// `[BX+SI+bufor]` (6,15 wobec 6,09) i dlatego dwa konce drabiny wychodzily
// dotad dobrze, a nikt nie widzial, ze srodek jest przestawiony.
//
// **OS E — REJESTR INDEKSOWY NIE MA Z DLUGIEM NIC WSPOLNEGO.** Korpus bez
// wstawki, odczyt przez `[BX+DI+bufor]` zamiast `[BX+SI+bufor]` — jeden bajt
// roznicy w calym programie — wrocil z **tym samym licznikiem** 0641. Dlug 3,85
// taktu jest wiec wlasnoscia ksztaltu, a nie tego, ktory rejestr indeksowy bierze
// udzial w adresie, i hipoteza "tunel nie placi, bo czyta przez DI" jest obalona.
const ODCZYT17 = {
  d16si: [0x8A, 0x80, 0x00, 0x08],        // mov al,[bx+si+0800]   4 bajty, EA 11
  d16di: [0x8A, 0x81, 0x00, 0x08],        // mov al,[bx+di+0800]   4 bajty, EA 11
  d8si:  [0x8A, 0x40, 0x00],              // mov al,[bx+si+00]     3 bajty, EA 11
  bx:    [0x8A, 0x07],                    // mov al,[bx]           2 bajty, EA 5
  di:    [0x8A, 0x05],                    // mov al,[di]           2 bajty, EA 5
  bxsi:  [0x8A, 0x00],                    // mov al,[bx+si]        2 bajty, EA 7
  bxdi:  [0x8A, 0x01],                    // mov al,[bx+di]        2 bajty, EA 7
};

/**
 * Korpus petli dema z TEMPO17 i TEMPO18 — ten sam ksztalt co `dema9`, ale
 * z wstawkami liczonymi osobno przed i za portem, z wyborem portu i skoku.
 * To sa osie tych dwoch programow, wiec kazda z nich jest tu parametrem.
 */
const dema17 = ({ czyt = 'd16si', miedzy = 0, po = 0, inc = false,
                  port = 'out', skok = 'loop' } = {}) => {
  const c = [NOP, NOP, ...ODCZYT17[czyt], ...(inc ? [0x46] : []),
             ...powtorz(miedzy, NOP),
             ...(port === 'out' ? [0xEE] : port === 'in' ? [0xEC] : []),
             ...powtorz(po, NOP)];
  const ogon = skok === 'jnz'
    ? [0x49, 0x75, (256 - (c.length + 3)) & 0xFF]     // dec cx / jnz
    : [0xE2, (256 - (c.length + 2)) & 0xFF];          // loop
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...c, ...ogon];
};

const POMIARY17 = [
  ['petla dema: 2 NOP-y miedzy',       2025.49, 2.0, dema17({ miedzy: 2 })],
  ['petla dema: 3 NOP-y miedzy',       2146.38, 2.0, dema17({ miedzy: 3 })],
  ['petla dema: NOP za OUT-em',        1846.66, 2.0, dema17({ po: 1 })],
  ['tunel: NOP przed OUT-em',           420.08, 2.0, tunel({ przed: 1 })],
  ['tunel: NOP na poczatku korpusu',    420.08, 2.0, tunel({ naPoczatku: 1 })],
  ['petla dema: odczyt [DI]',          1721.61, 2.0, dema17({ czyt: 'di', inc: true })],
  ['petla dema: odczyt [BX+DI]',       1781.95, 4.0, dema17({ czyt: 'bxdi', inc: true })],
  ['petla dema: odczyt [BX+SI+00]',    1902.66, 4.0, dema17({ czyt: 'd8si', inc: true })],
  ['petla dema: bez INC SI, [BX+DI]',  1842.05, 0.5, dema17({ czyt: 'd16di' })],
];

// TEMPO17, w kolejnosci wierszy powyzej.
const INNER_POMIARY17 = [25, 25, 25, 116, 116, 25, 25, 25, 25];

// ---- TEMPO18 ---------------------------------------------------------------
//
// Osiemnasty program, 2026-09-03. Szesc kotwic na siedem trafionych co do
// jednosci, dryf 0,000%. Siodma wypadla o **jedna jednostke licznika** (063E
// wobec 063D, czyli 1845,51 wobec 1846,66) i to jest ten sam blok, ktory
// TEMPO17 zmierzyl dzien wczesniej — czyli powtarzalnosc metody na tym ksztalcie
// wynosi jedna jednostke, 0,06%. Wzorca dla niego nie zmieniamy: 0,06% to
// rozdzielczosc, a nie pomiar.
//
// **OS A2 — SZCZELINA ZA PORTEM MA DOKLADNIE JEDEN BAJT.** NOP-y wciskane miedzy
// `OUT` a `LOOP`, wobec ksztaltu bez wstawki (1842,05, zmierzonego trzy razy):
//
//     jeden NOP      +0,12   darmo         (TEMPO17 dal 0,15)
//     dwa NOP-y      +4,13   drugi kosztuje 4,01
//     trzy NOP-y     +8,12   trzeci kosztuje 3,99
//
// Rdzen liczy **oba dalsze punkty co do setnej** (1966,08 i 2085,66 wobec
// 1966,08 i 2085,66) i myli sie wylacznie tam, gdzie szczelina jest nietknieta.
//
// **Nie chodzi o to, czym rozerwac przyleglosc.** Blok z `DEC CX` + `JNZ`
// w miejsce `LOOP`-a, w tym samym ksztalcie bez wstawki, wrocil z **tym samym
// licznikiem, co blok z NOP-em** — 063E oba. Rozkaz, ktory naprawde cos robi,
// jest tam tak samo darmowy jak wypelniacz. Dla porownania: w ksztalcie
// z `INC SI` ta sama zamiana kosztuje 3,97 (TEMPO8, 2025,49) i rdzen liczy to
// dobrze; a blok z `INC SI` i NOP-em za portem wychodzi rowniez 2025,49, czyli
// szczelina za portem jest niezalezna od tego, co stoi przed portem.
//
// **JEDNO OKNO TLUMACZY WSZYSTKIE PIEC LICZB.** Wokol zapisu do portu jest okolo
// 3,85 taktu, ktorych magistrala nie uzywa na nic, i mieści sie w nich jedno
// pobranie:
//
//     bajt ZA portem lezy w oknie caly              kosztuje 0,12
//     bajt PRZED portem lezy w nim czesciowo        kosztuje 2,14
//     drugi bajt z ktorejkolwiek strony             kosztuje 4,00
//     nikt okna nie uzywa                           obrot jest 3,85 dluzszy
//
// Ostatni wiersz jest tym, co rdzen liczy za szybko, a dwa pierwsze tym, co
// liczy za drogo — i to jest **jeden blad, nie trzy**: 5,99 wobec 2,14 to 3,85,
// 4,00 wobec 0,12 to 3,88, a niedomiar w ksztalcie bez wstawki to 3,85.
//
// **KIERUNEK CYKLU PORTU JEDNAK MA ZNACZENIE — w tym jednym ksztalcie.** `IN AL,DX`
// w miejsce `OUT DX,AL`, przy odczycie przyleglym i `LOOP`-ie zaraz za portem,
// kosztuje **1,86 taktu mniej** (1786,26 wobec 1842,05), czyli dlug spada z 3,85
// na 1,99. TEMPO9 mierzyl te dwa rozkazy w ksztalcie **z** `INC SI` i dostal
// licznik identyczny — i tamto nadal jest prawda. Roznica jest wiec wlasnoscia
// samej przyleglosci zapis-skok, nie rozkazu: po zapisie magistrala musi zdazyc
// zwolnic linie, zanim skok pobierze cel, a po odczycie nie ma czego zwalniac.
// To najlepszy trop, jaki ta rodzina blokow dala, i jednoczesnie powod, dla
// ktorego zadna z probowanych regul nie moze byc prawdziwa: wszystkie one
// traktuja cykl portu jak jeden rodzaj zdarzenia.
//
// **OS F i OS G — HIPOTEZA \"KORPUSOWI SKONCZYLY SIE BAJTY\" JEST OBALONA.**
// Roznica `[BX+SI]` nad `[BX]`, ta sama para dwubajtowa, w trzech dlugosciach
// ogona za odczytem:
//
//     odczyt, INC SI, OUT, LOOP          4 bajty za odczytem    2,01
//     odczyt, 4 NOP-y, OUT, LOOP         8 bajtow za odczytem   2,00
//     odczyt, LOOP                       2 bajty za odczytem    2,00
//
// **Plasko.** Czas EA kosztuje w tej petli dwa takty niezaleznie od tego, ile
// bajtow zostalo do konca korpusu, wiec wyjasnienie \"kolejka mieści cztery bajty,
// a poza `LOOP`-a BIU pobierac nie moze\" jest nieprawdziwe. Rdzen daje we
// wszystkich trzech zero, wiec trzy nowe bloki tej rodziny sa u niego 2,7-5,5%
// za szybkie. Zostaje sama obserwacja: w petli rysujacej EA liczy sie takt za
// takt, w nasyconym ciagu nie liczy sie wcale (`[SI+d16]`, `[BX+DI+d16]`
// i `[BX+SI+d16]` po 199,10), a granicy miedzy jednym a drugim ten model nie zna.
//
// CZEGO NIE POWTARZAC — osiem mechanizmow przemierzonych na tych punktach
// i wszystkie odrzucone liczbami, nie przeczuciem:
//
//   - termin gotowosci adresu zalezny od trybu adresowania (bloku `[BX+SI]`
//     nie rusza wcale, bo kolejka wchlania odsuniecie; zestaw 1,31% -> 1,99%);
//   - fora skoku ograniczona tak, zeby nie cofala magistrali przed cykl, ktory
//     naprawde biegl (rusza wszystkim, pusta petla +9,05%; zestaw -> 2,67%);
//   - zwolnienie `IO_SETUP` tylko dla portu-po-porcie (zestaw 1,31% -> 1,05%
//     i blok z -6,27% na -3,01%, ale nowy blok \"NOP za OUT-em\" wychodzi
//     z limitu na +3,25%, a trzy bloki tunelu traca dokladny licznik);
//   - ogon cyklu portu, ktory trzyma magistrale dluzej, niz trzyma jednostke
//     wykonawcza (`IO_TAIL`): przy jednym takcie zestaw idzie na 1,87%, przy
//     czterech na 5,42%, bo dotyka wszystkich blokow z portem, a nie tego jednego
//     ksztaltu;
//   - termin gotowosci adresu liczony od POCZATKU rozkazu i rowny czasowi EA
//     (`max(last, now + eaTime)` w miejsce `last + EA_READY`), razem z zakazem
//     pobierania z wyprzedzeniem w tym okresie: zestaw 1,42% -> 3,12%. Powod jest
//     arytmetyczny i wart zapisania, zeby nie wracac: dla formy dwubajtowej
//     `last + EA_READY` wypada juz na `now + 11`, a czas EA to 5 albo 7, wiec
//     nowy termin nigdy nie wiaze, a zniesienie wyprzedzenia przyspiesza odczyt
//     o caly cykl. Zeby EA wyszlo na wierzch, kosztem musi byc czas jednostki
//     wykonawczej, a nie termin adresu — i **potrzebna jest zmiana relacji
//     miedzy `eu`, `last` i dostepem, nie kolejna stala**. Wymagane liczby sa
//     znane: odczyt ma kosztowac w tej petli 12 + EA niezaleznie od dlugosci;
//   - **wszystkiego, co wyzwala sie przy SKOKU** (`flushQueue`, `JUMP_LEAD`,
//     rozroznienie skoku wykonanego od niewykonanego). TEMPO19 obalil to wprost:
//     `JMP $+0` wcisniety miedzy `OUT` a `LOOP` kladzie skok WYKONANY w miejscu,
//     w ktorym dlug mial powstawac, i blok wychodzi co do setnej na modelu;
//   - **wszystkiego, co opiera sie na KIERUNKU cyklu** (zapis wobec odczytu).
//     TEMPO19 obalil i to: zapis na port ma okno, zapis do pamieci nie ma,
//     odczyt z pamieci ma. Ta czworka nie dzieli sie na zapisy i odczyty;
//   - **port wyprzedzajacy pobieranie**, tak samo jak wyprzedza je wlasny dostep
//     do pamieci, z powrotem do pobierania zaraz po cyklu portu. Slad pokazuje, ze
//     rdzen wciska pobranie tuz PRZED zapisem do portu, a sprzet tego bajtu nie
//     bierze — i ksztalt z dlugiem faktycznie siada na swojej liczbie (57 taktow
//     na obrot robi sie 61 wobec 60,85 ze sprzetu). Tyle ze te same cztery takty
//     dostaja trzy ksztalty, ktore byly dokladne: 63 -> 67, 61 -> 65, 65 -> 69.
//     Znaczy to, ze **brakujace takty nie sa pobraniem, ktore port zabiera** —
//     zadna regula wyzwalana przy cyklu portu tych czterech ksztaltow nie rozroznia;
//   - **prog na wlasnym dostepie do pamieci**: dostep nie wczesniej niz
//     `now + eu + 2`. Trafia wszystkie cztery punkty EA co do taktu, w petli
//     z portem i bez portu — i mimo to jest falszywy: zestaw 1,42% -> 4,43%
//     i 55 kontroli nie przechodzi, wszystkie za wolno, po ok. 1,6 taktu na rozkaz
//     wszedzie tam, gdzie nasycony ciag siega pamieci;
//   - **podloga pod samym rozkazem**: nigdy taniej niz tabela plus k (1,42% ->
//     2,32% przy jednym takcie, 4,10% przy dwoch, 6,17% przy trzech, 8,44% przy
//     czterech). Ten warto zapamietac, bo wyklucza **cala rodzine**: w nasyconym
//     ciagu rozkazy nie kosztuja po rowno, tylko na przemian mniej i wiecej od
//     sredniej, wiec podloga pod kazdym z osobna podnosi srednia takze tam, gdzie
//     srednia byla dokladna.
//
// GDZIE DOKLADNIE GINA TE DWA TAKTY — magistrala przesledzona w petli rysujacej
// dla wszystkich szesciu form. Rdzen liczy 17 / 17 / 21 / 23 dla EA 5 / 7 / 11 / 11
// wobec 17 / 19 / 23 / 23 ze sprzetu, czyli **oba konce drabiny ma dobrze**,
// a myli sie o dwa takty tylko w srodku. Powod widac w jednej liczbie: dostep
// laduje na `at` = 13 dla kazdej formy dwubajtowej, bez wzgledu na EA, bo `at`
// bierze sie z `busFree` po dwoch pobraniach do `last + EA_READY`. O koszcie
// odczytu w tej petli decyduje **ile bajtow BIU zdazylo wziac przed dostepem**,
// a w tej liczbie nie ma nic z EA. Poprawka siedzi wiec w ograniczeniu pobierania,
// nie w skladniku doliczanym do dostepu ani do rozkazu.
// Badany cykl TEMPO19 — to, co stoi miedzy odczytem a skokiem.
const CYKL19 = {
  out:     [0xEE],                    // out dx,al        zapis na port
  in:      [0xEC],                    // in al,dx         odczyt z portu
  stosb:   [0xAA],                    // stosb            zapis do pamieci
  lodsb:   [0xAC],                    // lodsb            odczyt z pamieci
  nop:     [NOP],                     // nop              zaden cykl
  out2:    [0xEE, 0xEE],              // dwa zapisy z rzedu
  outjmp:  [0xEE, 0xEB, 0x00],        // out / jmp $+0    skok WYKONANY
  outjcxz: [0xEE, 0xE3, 0x00],        // out / jcxz $+0   skok niewykonany
};

const POMIARY18 = [
  ['petla dema: 2 NOP-y za OUT-em',    1966.08, 2.0, dema17({ po: 2 })],
  ['petla dema: 3 NOP-y za OUT-em',    2085.66, 2.0, dema17({ po: 3 })],
  ['petla dema: k=0, DEC CX + JNZ',    1845.51, 2.0, dema17({ skok: 'jnz' })],
  ['petla dema: INC SI, NOP za OUT-em', 2025.49, 2.0, dema17({ inc: true, po: 1 })],
  ['petla dema: k=0, IN zamiast OUT',  1786.26, 4.0, dema17({ port: 'in' })],
  ['petla dema: [BX], 4 NOP-y przed',  2021.33, 3.0,
    dema17({ czyt: 'bx', miedzy: 4 })],
  ['petla dema: [BX+SI], 4 NOP-y przed', 2081.24, 6.0,
    dema17({ czyt: 'bxsi', miedzy: 4 })],
  ['petla dema: [BX], bez portu',      1302.04, 2.0,
    dema17({ czyt: 'bx', port: 'brak' })],
  ['petla dema: [BX+SI], bez portu',   1362.18, 5.0,
    dema17({ czyt: 'bxsi', port: 'brak' })],
];

// TEMPO18, w kolejnosci wierszy powyzej.
const INNER_POMIARY18 = [25, 25, 25, 25, 25, 25, 25, 25, 25];

// ---- TEMPO19 ---------------------------------------------------------------
//
// Dziewietnasty program, 2026-09-03. **Piec kotwic na piec trafionych co do
// jednosci, dryf 0,000%**, a kontrola metody (blok 10, NOP zamiast portu) lezy
// dokladnie na modelu. Przebieg jest czytelny w calosci.
//
// Program pytal o jedno: **jaki rodzaj cyklu magistrali, stojac tuz przed skokiem
// wykonanym, zostawia za soba szczeline.** Kazda para blokow odpowiadala sama
// sobie — ten sam korpus raz z NOP-em miedzy badanym cyklem a `LOOP`-em i raz bez
// niego — wiec odpowiedz nie przechodzi przez model.
//
// DLUGI (sprzet minus model, takty na obrot; korpus wszedzie `NOP NOP`,
// `MOV AL,[BX+SI+d16]`, badany cykl, ewentualny NOP, `LOOP`):
//
//     odczyt, OUT, LOOP                +3,85       odczyt, OUT, NOP, LOOP     0,00
//     odczyt, LODSB, LOOP              +3,84       odczyt, LODSB, NOP, LOOP  +0,99
//     odczyt, STOSB, LOOP              -0,04       odczyt, STOSB, NOP, LOOP  +0,96
//     odczyt, IN, LOOP                 +1,99       odczyt, IN, NOP, LOOP     +1,99
//     odczyt, NOP, LOOP                 0,00       odczyt, NOP, NOP, LOOP     0,00
//     odczyt, OUT, OUT, LOOP           +3,84       odczyt, OUT, OUT, NOP      0,00
//     odczyt, OUT, JMP $+0, LOOP        0,00
//     odczyt, OUT, JCXZ $+0, LOOP       0,00
//
// **SKOK WYKONANY NIE JEST WYZWALACZEM — to jest obalone.** Blok z `JMP $+0`
// wcisnietym miedzy `OUT` a `LOOP` kladzie skok WYKONANY dokladnie tam, gdzie
// dlug mial sie brac, i wychodzi **co do setnej na modelu**: 9,97 taktu nad
// dwoma NOP-ami, model 9,97. Skok wykonany zabiera dlug tak samo jak zwykly NOP.
// A blok z `JCXZ $+0`, ktory ma **te same dwa bajty i ten sam koszt co dwa NOP-y**,
// ale jest skokiem (i nigdy sie nie wykonuje, bo CX idzie 30..1), tez lezy na
// modelu. Czyli nie liczy sie ani to, ze rozkaz jest skokiem, ani to, ze skok
// jest wykonany — liczy sie **wylacznie to, ze miedzy cyklem a skokiem nie ma
// niczego**. Szukanie reguly przy `flushQueue` i `JUMP_LEAD` bylo wiec falszywym
// tropem i nie ma po co tam wracac.
//
// **JEDNO OKNO, PRZY OSTATNIM CYKLU, RAZ.** Dwa `OUT`-y z rzedu daja dlug 3,84 —
// **taki sam, a nie podwojony** — a drugi `OUT` kosztuje nad pierwszym 7,97 przy
// modelowych 7,98, czyli co do setnej. Bajt pierwszego `OUT`-a wypelnia okno
// pierwszego, a okno drugiego zostaje nieuzyte i to ono jest dlugiem. Z NOP-em za
// drugim `OUT`-em blok wychodzi na modelu. To jest najczystsze potwierdzenie
// obrazu jednego okna, jakie ta rodzina dala.
//
// **ODCZYT Z PAMIECI ZACHOWUJE SIE JAK ZAPIS NA PORT, A ZAPIS DO PAMIECI NIE.**
// `LODSB` tuz przed skokiem ma dlug 3,84 — ten sam co `OUT` (3,85) — a `STOSB`
// w tym samym miejscu lezy na modelu (-0,04). Model tych dwoch rozkazow **nie
// odroznia w ogole**: oba to 12 taktow z jednym dostepem i oba daja identyczny
// slad magistrali, 61 taktow na obrot z tym samym rozkladem. Sprzet daje miedzy
// nimi 3,88 taktu. Z NOP-em za nimi oba wychodza na +0,97, czyli roznica znika
// i jest **wylacznie o przyleglosc do skoku**.
//
// Czyli w tej czworce zapis na port ma okno, zapis do pamieci nie ma, a odczyt
// z pamieci ma — i przez dwa wydania czytano to jako „kierunek cyklu nie dzieli
// tej rodziny". **TEMPO21 pokazal, ze czytano zle**: dla zwyklych rozkazow
// kierunek dzieli ja co do dwoch setnych, a `STOSB` i `LODSB` sa DWOMA
// WYJATKAMI, kazdy odwrotnie niz jego wlasny kierunek. Patrz grupa TEMPO21.
//
// **ODCZYT Z PORTU TO OSOBNE ZWIERZE.** `IN` ma dlug 1,99 i **z NOP-em, i bez
// niego** — bajt tego dlugu nie zabiera, a wiec to nie jest okno. Nie jest tez
// kosztem samego rozkazu: `IN AL,DX x8` i `OUT DX,AL x8` w nasyconym ciagu daja
// te sama liczbe 88,28, a w ksztalcie z `INC SI` oba daja 1906,35. Dlug pojawia
// sie dopiero wtedy, gdy `IN` przylega do odczytu z pamieci — i wtedy zostaje,
// cokolwiek za nim postawic.
//
// CZEGO NIE POWTARZAC, dopisane do listy nizej: reguly przy skoku, obalonej
// blokiem z `JMP`. Reguly opartej na kierunku cyklu ta para NIE obala — para
// STOSB/LODSB jest wyjatkiem od niej, co pokazal dopiero TEMPO21.
const dema19 = ({ cykl = 'out', po = 0, di = false } = {}) => {
  const c = [NOP, NOP, 0x8A, 0x80, 0x00, 0x08, ...CYKL19[cykl], ...powtorz(po, NOP)];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,       // mov cx,30 / mov si,1
          ...(di ? [0xBF, 0x00, 0x08] : []),        // mov di,0800  (dla STOSB)
          ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
};

const POMIARY19 = [
  ['petla dema: STOSB przed skokiem',   1853.63, 1.5, dema19({ cykl: 'stosb', di: true })],
  ['petla dema: STOSB, NOP, skok',      1973.98, 0.5,
    dema19({ cykl: 'stosb', po: 1, di: true })],
  ['petla dema: LODSB przed skokiem',   1958.25, 0.5, dema19({ cykl: 'lodsb' })],
  ['petla dema: LODSB, NOP, skok',      1962.16, 0.5, dema19({ cykl: 'lodsb', po: 1 })],
  ['petla dema: IN, NOP za nim',        1906.35, 4.0, dema19({ cykl: 'in', po: 1 })],
  ['petla dema: NOP zamiast portu',     1606.27, 1.0, dema19({ cykl: 'nop' })],
  ['petla dema: NOP zamiast portu x2',  1726.65, 1.0, dema19({ cykl: 'nop', po: 1 })],
  ['petla dema: OUT, JMP $+0, skok',    2265.07, 1.0, dema19({ cykl: 'outjmp' })],
  ['petla dema: OUT, JCXZ $+0, skok',   1966.08, 1.0, dema19({ cykl: 'outjcxz' })],
  ['petla dema: dwa OUT-y, skok',       2081.24, 0.5, dema19({ cykl: 'out2' })],
  ['petla dema: dwa OUT-y, NOP, skok',  2085.66, 1.0, dema19({ cykl: 'out2', po: 1 })],
];

// TEMPO19, w kolejnosci wierszy powyzej.
const INNER_POMIARY19 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25];

// ---- TEMPO20 ---------------------------------------------------------------
//
// Dwudziesty program, 2026-09-03. **Cztery kotwice na cztery trafione co do
// jednostki, dryf 0,000%**, obie kotwice miekkie w tolerancji, a kontrola metody
// (blok 12) co do setnej. Przebieg jest czytelny w calosci.
//
// Program nie wzial sie z modelu, tylko z demka. Profil trainfolia rozkaz po
// rozkazie pokazal, ze **15,8% jego taktow to rozkazy z adresem BEZPOSREDNIM**
// (`test [F592h],01`, `cmp bl,[F595h]`, `inc [F591h]`), a **w zadnym z 195
// wczesniejszych pomiarow nie bylo ani jednego takiego rozkazu** - wszystkie
// siegaly pamieci przez rejestr bazowy. Tak samo nie bylo ani jednego pomiaru
// odczytu-modyfikacji-zapisu, w zadnej postaci.
//
// Korpus wszedzie ten sam co w TEMPO4/6/8/17/18/19 - zmierzona petla dema
// (1906,35): `NOP NOP`, badany dostep, `INC SI`, `OUT`, `LOOP`, trzydziesci
// obrotow, INNER 25. Zmienia sie wylacznie badany rozkaz, wiec **blok minus blok
// "bez odczytu" (1246,46) to czysty koszt tego rozkazu w tej petli**:
//
//     rozkaz                          sprzet   model   model-sprzet
//                                              (przed poprawka)
//     MOV AL,[BX+SI+d16]  4B EA 11    22,00   22,00      0,00
//     MOV AL,[d16]        4B EA 6     22,00   25,97     +3,97
//     MOV AL,[d16] akum   3B EA 6     15,97   22,00     +6,02
//     MOV AL,[BX]         2B EA 5     15,84   15,91     +0,07
//     CMP AL,[d16]        4B EA 6     22,00   25,97     +3,97
//     TEST [d16],01       5B EA 6     25,97   30,00     +4,03
//     INC byte [d16]      4B EA 6 RMW 27,97   30,00     +2,02
//     NOT byte [d16]      4B EA 6 RMW 27,97   25,97     -2,01
//     ADD byte [d16],02   5B EA 6 RMW 30,00   33,95     +3,96
//     INC byte [BX]       2B EA 5 RMW 21,83   19,89     -1,94
//
// **ADRES BEZPOSREDNI JEST TAK SAMO DROGI JAK INDEKSOWANY.** Bloki 2, 3 i 6
// wrocily z identycznym licznikiem 060B: czterobajtowy odczyt kosztuje 22,00
// **bez wzgledu na EA** (11 czy 6, to samo), a `CMP` tyle samo co `MOV`. Obie
// przepowiednie postawione przed przebiegiem byly zle - model mowil +3,97 dla
// formy bezposredniej, "EA co do taktu" -5,00, a prawda to 0,00. **EA miedzy 6
// a 11 nie wychodzi w tej petli na wierzch w ogole.**
//
// **ODCZYT-MODYFIKACJA-ZAPIS TO DOKLADNIE 6,00 TAKTU PONAD SAM ODCZYT**, i to na
// obu koncach drabiny: 28,00 wobec 22,00 przy EA 6 i 21,83 wobec 15,84 przy EA 5.
// **Tozsamosc rozkazu nie ma znaczenia - `INC` i `NOT` wrocily z tym samym
// licznikiem 0586**, choc model rozdziela je o cztery takty.
//
// **FORMA AKUMULATOROWA `A0` (3 bajty) KOSZTUJE TYLE, CO `MOV AL,[BX]`** (15,97
// wobec 15,84), a nie tyle, co czterobajtowa forma z tym samym EA i tym samym
// adresem (22,00). Model daje jej 22,00 - to najwiekszy pojedynczy blad przebiegu.
//
// **PETLA TRAINFOLIA ZAMYKA RACHUNEK.** Bloki 13 i 14 odtwarzaja petle spod
// `076D7`, w ktorej demo spedza 28% taktow, rozkaz w rozkaz i w obu wariantach
// skoku. Blok 14 (`JNZ` wykonany) ma dlug dokladnie **-4,00 taktu na obrot** -
// `test [d16],01` jest tam jedynym rozkazem z adresem bezposrednim, wiec caly
// dlug to te wlasnie cztery takty. Blok 13 (`JNZ` niewykonany) wychodzi -0,17,
// czyli praktycznie na modelu, ale **nie dlatego, ze model ma racje: dwa
// zmierzone bledy sie tam kasuja**. Model liczy +4,00 za duzo za adres
// bezposredni i -3,85 za malo za okno przed skokiem wykonanym (TEMPO19) - bo
// w bloku 13 `OUT` przylega do `LOOP`, a w bloku 14 przed `OUT`-em stoi wykonany
// skok, ktory to okno zabiera. Jeden takt na obrot tej petli to 0,10 s calego
// przebiegu dema.
//
// CO Z TEGO POPRAWIONO. Adres bezposredni dostawal w rdzeniu plaskie 6 taktow
// EA, podczas gdy kazda inna forma placi swoja podstawe plus cztery za
// przemieszczenie, ktore pobiera. Ta czworka wrocila na swoje miejsce i trzy
// bloki siadly na licznikach co do setnej (`MOV AL,[d16]`, `CMP AL,[d16]`,
// `ADD byte [d16],02`), a czwarty (`INC byte [d16]`) przeszedl z +2,92% na
// -2,83%. W calym zestawie ruszyly sie **cztery wiersze i zaden nie na gorsze**;
// stala skoku przez pamiec zeszla z 28 na 25, zeby `JMP [wsk]` zostal tam, gdzie
// byl. Trainfolio skrocilo sie o 0,95 s (122,70 -> 121,75 s w tym samym punkcie
// konca).
//
// CO ZOSTAJE ZMIERZONE I NIEPOPRAWIONE: `TEST [d16],imm` o 4,03 za drogo,
// czterobajtowe RMW o 1,97 za tanio (drugi dostep kosztuje na sprzecie 6,00,
// a w modelu 4,00), forma akumulatorowa `A0` o 6,03 za drogo — ta ostatnia to ta
// sama sprawa, co bajt kodu w petli rysujacej: sprzet liczy go 0,12, model 4,00.
//
// CZEGO NIE POWTARZAC: nie wracac do pomyslu, ze czas EA wychodzi w tej petli na
// wierzch dla form CZTEROBAJTOWYCH. Wychodzi dla dwubajtowych (`[BX]` EA 5 wobec
// `[BX+SI]` EA 7 to +2,01, TEMPO16) i nie wychodzi dla czterobajtowych (EA 6
// wobec 11 to 0,00). To jest prog, a nie proporcja.
const D20 = 0x800;                       // ten sam bufor, co w reszcie zestawu
const d20 = [D20 & 0xFF, D20 >> 8];
const FLAGA20 = 0x900;                   // bajt dla `TEST` w petli trainfolia
const f20 = [FLAGA20 & 0xFF, FLAGA20 >> 8];

// Badany dostep TEMPO20 - to, co stoi miedzy `NOP NOP` a `INC SI`.
const DOSTEP20 = {
  ea11:  [0x8A, 0x80, ...d20],          // mov al,[bx+si+d16]  4B EA 11
  d16:   [0x8A, 0x06, ...d20],          // mov al,[d16]        4B EA 6
  akum:  [0xA0, ...d20],                // mov al,[d16]        3B EA 6
  bx:    [0x8A, 0x07],                  // mov al,[bx]         2B EA 5
  cmp:   [0x3A, 0x06, ...d20],          // cmp al,[d16]        4B EA 6
  test:  [0xF6, 0x06, ...d20, 0x01],    // test [d16],01       5B EA 6
  inc:   [0xFE, 0x06, ...d20],          // inc byte [d16]      4B EA 6 RMW
  not:   [0xF6, 0x16, ...d20],          // not byte [d16]      4B EA 6 RMW
  add:   [0x80, 0x06, ...d20, 0x02],    // add byte [d16],02   5B EA 6 RMW
  incbx: [0xFE, 0x07],                  // inc byte [bx]       2B EA 5 RMW
  brak:  [],
};

const dema20 = (dostep) => {
  const c = [NOP, NOP, ...DOSTEP20[dostep], 0x46, 0xEE];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,       // mov cx,30 / mov si,1
          ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
};

// Petla trainfolia spod `076D7`: BX bierze sie z CX, wiec oba odczyty chodza po
// buforze, a `TEST` decyduje, czy drugi z nich sie wykona.
const tf20 = () => {
  const c = [0x89, 0xCB,                             // mov bx,cx
             0x8A, 0x87, ...d20,                     // mov al,[bx+d16]
             0xF6, 0x06, ...f20, 0x01,               // test byte [flaga],01
             0x75, 0x04,                             // jnz +4
             0x8A, 0x87, (D20 + 0x20) & 0xFF, (D20 + 0x20) >> 8,
             0xEE];                                  // out dx,al
  return [0xB9, 0x1E, 0x00, ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
};

const POMIARY20 = [
  ['petla dema: MOV AL,[d16] 4B',        1906.35, 0.5, dema20('d16')],
  ['petla dema: MOV AL,[d16] akum 3B',   1725.64, 0.5, dema20('akum')],
  ['petla dema: CMP AL,[d16] 4B',        1906.35, 0.5, dema20('cmp')],
  ['petla dema: TEST [d16],01 5B',       2025.49, 0.5, dema20('test')],
  ['petla dema: INC byte [d16] RMW',     2085.66, 0.5, dema20('inc')],
  ['petla dema: NOT byte [d16] RMW',     2085.66, 0.5, dema20('not')],
  ['petla dema: ADD byte [d16],02 RMW',  2146.38, 0.5, dema20('add')],
  ['petla dema: INC byte [BX] RMW',      1901.43, 0.5, dema20('incbx')],
  ['petla dema: bez odczytu',            1246.46, 1.0, dema20('brak')],
  ['petla trainfolia: JNZ niewykonany',  3515.88, 0.5, tf20()],
  ['petla trainfolia: JNZ wykonany',     3101.07, 0.5, tf20(), { pamiec: [[FLAGA20, 0x01]] }],
];

// TEMPO20, w kolejnosci wierszy powyzej.
const INNER_POMIARY20 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 15, 15];

// ---- TEMPO21 ---------------------------------------------------------------
//
// Dwudziesty pierwszy program, 2026-09-04. **Piec kotwic na piec trafionych,
// dryf 0,000%**, kontrola metody na 3,98 wobec wymaganych 4,00. Szosta kotwica
// wypadla o JEDNA jednostke (06AD wobec 06AC z TEMPO19) i to jest ten sam blok,
// o ktorym TEMPO18 juz raz tak powiedzial — wzorca nie zmieniamy, 0,06% to
// rozdzielczosc metody, a nie pomiar.
//
// Program mial rozstrzygnac jedno: **czy szczeline przed skokiem zostawia
// ODCZYT, czy ROZKAZ LANCUCHOWY**. Przez dwadziescia programow przed `LOOP`-em
// nie stal ani raz zwykly dostep do pamieci — stal `OUT`, `IN`, `STOSB`,
// `LODSB`, `NOP`, `JMP` i `JCXZ`, czyli sam port albo sam rozkaz lancuchowy.
//
// **ODPOWIEDZ JEST TAKA, ZE KIERUNEK CYKLU JEDNAK DZIELI TE RODZINE — a oba
// ROZKAZY LANCUCHOWE LEZA PO ZLEJ STRONIE TEJ LINII.** Koszt jednego NOP-a
// wcisnietego miedzy badany cykl a `LOOP` (~0,1 = szczelina jest, ~4,0 = nie ma):
//
//     ZAPIS, szczelina JEST            ODCZYT, szczeliny NIE MA
//     OUT DX,AL        0,15            IN AL,DX          4,00
//     MOV [DI],AL      0,15            MOV AL,[DI]       4,02
//     INC byte [DI]    0,12            XLAT              4,00
//                                      MOV AX,[DI]       3,98
//     WYJATKI — dokladnie odwrotnie niz reszta ich kierunku:
//     LODSB (odczyt)   0,13            STOSB (zapis)     4,01
//
// Kazda para odpowiada sama sobie, bez posrednictwa modelu, a kontrola metody
// (`NOP` za `NOP`-em, 3,98) lezy tam, gdzie ma lezec. Piec liczb po lewej i piec
// po prawej, kazda zmierzona co do dwoch setnych, i miedzy grupami jest 3,9
// taktu przepasci — to nie jest efekt na granicy szumu.
//
// CO TO OBALA. Naglowek rdzenia trzymal dotad zdanie „zapis na port ma okno,
// zapis do pamieci nie ma, odczyt z pamieci ma, wiec read-versus-write nie jest
// ta linia". To zdanie stalo **w calosci** na `STOSB` i `LODSB`, bo innych
// dostepow do pamieci w tym miejscu nikt nie zmierzyl. Zwykly `MOV [DI],AL`
// i zwykly `MOV AL,[DI]` — ten sam rejestr, ten sam EA, jeden bit roznicy
// w opkodzie — mowia dokladnie odwrotnie. Linia jest wiec kierunkiem cyklu,
// a wyjasnic trzeba nie ja, tylko dlaczego oba rozkazy lancuchowe sa po drugiej
// jej stronie.
//
// CO JESZCZE Z TEGO PRZEBIEGU WIADOMO:
//
//   - **`INC byte [DI]` ma szczeline**, choc ma dwa cykle: odczyt, a po nim
//     zapis. Skoro zachowuje sie jak zapis, liczy sie **ostatni cykl przed
//     skokiem**, a nie pierwszy cykl rozkazu.
//   - **`XLAT` zachowuje sie jak zwykly odczyt** (4,00) mimo jednego bajtu kodu
//     i adresu spod `BX+AL`. Szczelina nie zalezy od dlugosci rozkazu ani od
//     tego, skad bierze sie adres.
//   - **`MOV AX,[DI]`, dwa cykle odczytu z rzedu, tez nie ma szczeliny** (3,98).
//     Drugi odczyt jej nie tworzy — tak samo jak drugi `OUT` w TEMPO19 nie
//     dostawal wlasnej.
//
// Korpus ten sam co w TEMPO8/9/17/18/19, INNER 25, trzydziesci obrotow.
const CYKL21 = {
  rdDI:  [0x8A, 0x05],        // mov al,[di]       zwykly odczyt      2B EA 5
  wrDI:  [0x88, 0x05],        // mov [di],al       zwykly zapis       2B EA 5
  rmwDI: [0xFE, 0x05],        // inc byte [di]     odczyt i zapis     2B EA 5
  xlat:  [0xD7],              // xlat              odczyt             1B
  rdWDI: [0x8B, 0x05],        // mov ax,[di]       slowo, dwa cykle
};

const dema21 = ({ cykl, po = 0, di = true } = {}) => {
  const c = [NOP, NOP, 0x8A, 0x80, 0x00, 0x08, ...CYKL21[cykl], ...powtorz(po, NOP)];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,       // mov cx,30 / mov si,1
          ...(di ? [0xBF, 0x00, 0x08] : []),        // mov di,0800
          ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
};

const POMIARY21 = [
  ['petla dema: MOV AL,[DI] przed skok', 1973.98, 0.5, dema21({ cykl: 'rdDI' })],
  ['petla dema: MOV AL,[DI], NOP, skok', 2094.55, 0.5, dema21({ cykl: 'rdDI', po: 1 })],
  ['petla dema: MOV [DI],AL przed skok', 2090.09, 0.5, dema21({ cykl: 'wrDI' })],
  ['petla dema: MOV [DI],AL, NOP, skok', 2094.55, 0.5, dema21({ cykl: 'wrDI', po: 1 })],
  ['petla dema: INC [DI] RMW przed skok', 2270.30, 0.5, dema21({ cykl: 'rmwDI' })],
  ['petla dema: INC [DI] RMW, NOP, skok', 2273.80, 0.5, dema21({ cykl: 'rmwDI', po: 1 })],
  ['petla dema: XLAT przed skokiem', 1901.43, 3.5, dema21({ cykl: 'xlat', di: false })],
  ['petla dema: XLAT, NOP, skok', 2021.33, 4.5,
    dema21({ cykl: 'xlat', po: 1, di: false })],
  ['petla dema: MOV AX,[DI] przed skok', 2094.55, 0.5, dema21({ cykl: 'rdWDI' })],
  ['petla dema: MOV AX,[DI], NOP, skok', 2214.05, 0.5, dema21({ cykl: 'rdWDI', po: 1 })],
];

// TEMPO21, w kolejnosci wierszy powyzej.
const INNER_POMIARY21 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25];

// ---- TEMPO22 ---------------------------------------------------------------
//
// Dwudziesty drugi program, 2026-09-04. Dziewiec kotwic na dziewiec trafionych
// co do jednosci, dryf 0,000%, obie kontrole metody przeszly: bajt za `OUT`-em
// kosztuje 0,12 (ma 0,15), bajt na gorze korpusu 4,00 (ma 4,00). Trzy z tych
// kotwic to bloki, na ktorych rdzen KLAMIE, i wrocily dokladnie tam, gdzie stana
// w tym pliku - 1842,05, 2081,24 i 1962,16 - wiec przebieg jest wiarygodny mimo
// tego, ze model ich nie trafia.
//
// PO CO BYL. TEMPO21 pokazal, ze szczeline zostawia zapis. Regule probowano
// zbudowac przy biurku i jedna wersja kladla dziesiec blokow co do setnej,
// a psula dwa dokladne - `OUT, JMP $+0, skok` i petle trainfolia z niewykonanym
// `JNZ` w ciele. Ten program mial znalezc warunek, ktory te dwa oszczedzi.
// Znalazl cos lepszego: **trzy zdania, z ktorych kazde jest para blokow o TYCH
// SAMYCH bajtach, i zadne z nich nie potrzebuje modelu za posrednika**.
//
// (1) JEDNO MIEJSCE NA CALY OBIEG PETLI, NIE JEDNO NA ZAPIS. `OUT, NOP, OUT,
//     NOP` i `OUT, OUT, NOP, NOP` to te same dziesiec bajtow, ta sama para
//     cykli portu, inna kolejnosc - i **ten sam licznik 0539, co do jednosci**.
//     Dwa NOP-y kosztuja 4,15 w obu ukladach, czyli jeden z nich jest darmowy,
//     a drugi placi pelne cztery takty, obojetnie gdzie stoi. Drugi zapis NIE
//     dostaje wlasnego miejsca. TEMPO19 wnioskowal to samo z dwoch `OUT`-ow
//     stojacych obok siebie; rozsuniete mowia to wprost.
//
// (2) MIEJSCE OTWIERA ZAPIS, A BAJT ZAJMUJE JE Z KTOREJKOLWIEK STRONY. NOP
//     wciety miedzy odczyt a `OUT` kosztuje 2,14 - dokladnie tyle, co `INC SI`
//     w tym samym miejscu w pelnej demie - i dlug znika. Ten sam NOP wciety
//     miedzy odczyt a `MOV AL,[DI]` kosztuje 4,02, czyli pelna cene: przy
//     odczycie na koncu korpusu taniej pozycji NIE MA. Trzy ceny jednego bajtu
//     sa wiec zamkniete: 4,00 na gorze korpusu, 2,14 tuz przed zapisem, 0,15
//     tuz za nim.
//
// (3) SKOK W CIELE PETLI NIE ROBI NIC. Cztery NOP-y na gorze i dwa NOP-y plus
//     niewykonany `JCXZ $+0` w tym samym miejscu daja **ten sam licznik 0589,
//     co do jednosci**. Dlug zostaje w obu. To bylo pytanie o petle trainfolia,
//     ktora dlugu nie ma, choc reguly kaza jej go miec - i odpowiedz brzmi, ze
//     jej niewykonany `JNZ` nie ma z tym nic wspolnego. Czym trainfolio rozni
//     sie od tych blokow, dalej nie wiadomo, ale o jedna hipoteze mniej.
//
// Blok z `JMP $+0` na gorze korpusu mowi jeszcze jedno: ten sam skok kosztuje
// 18,03 taktu na gorze i 14,10 wcisniety za `OUT`-a, a roznica to te same 3,93.
// Za zapisem jego wlasny bajt opkodu wchodzi w miejsce i skok jest o tyle
// tanszy. Model liczy sam skok dobrze (17,97 na gorze) - caly blad tego bloku
// to jeden dlug, nie dwa.
//
// CZEGO NIE POWTARZAC: pytania "czy skok w ciele zjada dlug". Zamkniete
// blokami 10-11, ktore wyszly na tym samym liczniku.
//
// Bloki, ktore powtarzaja pomiar juz obecny w zestawie (1842,05, 1846,66,
// 2081,24, 1973,98, 1962,16, 2025,49, 1906,35), sa pominiete, zeby nie liczyc
// tej samej liczby dwa razy. Wszystkie siedem trafilo; `odczyt, OUT, NOP, LOOP`
// wrocil o jedna jednostke licznika obok (063E wobec 063D, czyli 1845,51 wobec
// 1846,66) i wzorca sie nie rusza - to zmierzona powtarzalnosc metody, 0,06%.

const OUT22 = 0xEE;
const RD_DI22 = [0x8A, 0x05];        // mov al,[di]
const JCXZ22 = [0xE3, 0x00];         // jcxz $+0    nigdy nieskoczony: CX idzie 30..1
const JMP22 = [0xEB, 0x00];          // jmp short $+0

// Korpus TEMPO22: NOP-y na gorze, ewentualny rozkaz przed odczytem, odczyt
// czterobajtowy, ogon miedzy odczytem a `LOOP`-em. Trzydziesci obrotow.
const dema22 = ({ gora = 2, przed = [], ogon = [], di = false } = {}) => {
  const c = [...powtorz(gora, NOP), ...przed, 0x8A, 0x80, 0x00, 0x08, ...ogon];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,       // mov cx,30 / mov si,1
          ...(di ? [0xBF, 0x00, 0x08] : []),        // mov di,bufor
          ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
};

const POMIARY22 = [
  ['petla dema: OUT, NOP, OUT, NOP', 2205.77, 3.0,
    dema22({ ogon: [OUT22, NOP, OUT22, NOP] })],
  ['petla dema: OUT, OUT, NOP, NOP', 2205.77, 0.5,
    dema22({ ogon: [OUT22, OUT22, NOP, NOP] })],
  ['petla dema: NOP miedzy, potem OUT', 1906.35, 0.5, dema22({ ogon: [NOP, OUT22] })],
  ['petla dema: NOP miedzy, potem odczyt', 2094.55, 0.5,
    dema22({ ogon: [NOP, ...RD_DI22], di: true })],
  ['petla dema: cztery NOP-y na gorze', 2081.24, 0.5, dema22({ gora: 4, ogon: [OUT22] })],
  ['petla dema: JCXZ na gorze korpusu', 2081.24, 0.5,
    dema22({ przed: JCXZ22, ogon: [OUT22] })],
  ['petla dema: JMP $+0 na gorze korpusu', 2382.16, 0.5,
    dema22({ przed: JMP22, ogon: [OUT22] })],
];

// TEMPO22, w kolejnosci wierszy powyzej.
const INNER_POMIARY22 = [25, 25, 25, 25, 25, 25, 25];

// ---- TEMPO23 ---------------------------------------------------------------
//
// Dwudziesty trzeci program, 2026-09-13. **Szesc kotwic na szesc, dryf 0,000%**,
// obie kontrole metody co do setnej (`JMP $+0` za `OUT`-em 14,10 wobec 14,10,
// forma czterobajtowa wobec `A0` 6,02 wobec 6,02). Sprawdzian pieciu poprawek
// wpisanych tego samego dnia przy biurku.
//
// **WYJATEK OKNA NALEZY DO DWUBAJTOWEGO SKOKU, NIE DO BEZWARUNKOWEGO.** Wykonany
// `JNZ $+0` za `OUT`-em wrocil na liczniku `JMP short` (0516 oba), a `JMP near`
// (E9, trzy bajty) na 04D4 - cztery takty okna i jeden wiecej, tak jak `JMP rel8`
// dostal w TEMPO10 16 zamiast tabelarycznych 15. Model zgadywal odwrotnie w obu.
//
// **ODCZYT-MODYFIKACJA-ZAPIS NA SLOWIE ZACHOWUJE SIE JAK NA BAJCIE** - `INC word
// [DI]` przed skokiem co do jednostki (0497), z modyfikacja po odczycie i oknem.
//
// **FORMA AKUMULATOROWA:** `ES: A0` co do jednostki. `A0` i `A1` model liczy
// o jeden takt na rozkaz za drogo (w petli dema i w strumieniu nasyconym),
// `A2` o jeden za tanio. Przesuniecie terminu zapisu o dwa takty klalo `A2`
// co do setnej, a terminu odczytu nie rusza nic - dostep w `A0` nie czeka na
// termin, tylko na ostatni bajt, a za nim kolejka jest pusta i `INC SI` placi
// pobranie. Nic z tego nie weszlo: jeden punkt na ksztalt i zadnej fizyki.
//
// **ROZKAZY LANCUCHOWE** przed skokiem nie trafily zadnej hipotezy: `MOVSB`
// wypada miedzy "placi okno" a "nie placi" (-1,93 od drugiej), `SCASB` i `CMPSB`
// blizej "placi" o 1,04 i 2,91 taktu. Tu stale samych rozkazow nakladaja sie
// na okno i jeden blok na rozkaz tego nie rozdzieli.
const D23 = [0x00, 0x08];                 // bufor 0800h, jak w reszcie zestawu
const OUT23 = 0xEE;

// Petla dema TEMPO23: `odczyt` to bajty czytajace (domyslnie `[BX+SI+bufor]`),
// `inc` doklada `INC SI`, `ogon` stoi przed `LOOP`-em. `di` kladzie DI na
// bufor+200, `al0` zeruje AL przed petla (blok z `A2`).
const dema23 = ({ odczyt = [0x8A, 0x80, ...D23], inc = false, ogon = [], di = false,
                  al0 = false } = {}) => {
  const c = [NOP, NOP, ...odczyt, ...(inc ? [0x46] : []), ...ogon];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00,       // mov cx,30 / mov si,1
          ...(di ? [0xBF, 0xC8, 0x08] : []),        // mov di,08C8h
          ...(al0 ? [0xB0, 0x00] : []),             // mov al,0
          ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
};

const POMIARY23 = [
  ['petla dema: OUT, JMP near $+0, skok', 2386.02, 0.5,
    dema23({ ogon: [OUT23, 0xE9, 0x00, 0x00] })],
  ['petla dema: OUT, JNZ $+0, skok',      2265.07, 0.5, dema23({ ogon: [OUT23, 0x75, 0x00] })],
  ['petla dema: INC word [DI] przed skok', 2509.89, 0.5, dema23({ ogon: [0xFF, 0x05], di: true })],
  ['petla dema: MOVSB przed skokiem',     2093.06, 0.5, dema23({ ogon: [0xA4], di: true })],
  ['petla dema: SCASB przed skokiem',     2029.68, 0.5, dema23({ ogon: [0xAE], di: true })],
  ['petla dema: CMPSB przed skokiem',     2182.92, 0.5, dema23({ ogon: [0xA6], di: true })],
  ['petla dema: ES: A0 akum',             1846.66, 0.5,
    dema23({ odczyt: [0x26, 0xA0, ...D23], inc: true, ogon: [OUT23] })],
  ['petla dema: A1 akum',                 1845.51, 0.5,
    dema23({ odczyt: [0xA1, ...D23], inc: true, ogon: [OUT23] })],
  ['petla dema: A2 akum',                 1793.87, 0.5,
    dema23({ odczyt: [0xA2, ...D23], inc: true, ogon: [OUT23], al0: true })],
  ['MOV AL,[d16] akum x8',                 150.59, 0.5, powtorz(8, 0xA0, ...D23)],
];

// TEMPO23, w kolejnosci wierszy powyzej.
const INNER_POMIARY23 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 400];

// ---- TEMPO24 ---------------------------------------------------------------
//
// Dwudziesty czwarty program, 2026-09-13. **Piec kotwic na piec, dryf 0,000%**,
// kontrola metody (`ES: NOP x2` wobec blizniaka bez przedrostka) 15,92 wobec
// 15,95 z TEMPO12 i TEMPO3.
//
// **FORMA AKUMULATOROWA:** `A0`, `A1`, `A2` i `A3` w strumieniu nasyconym co do
// jednostki z odczytem ruszajacym przy ostatnim bajcie i zapisem dwa takty pozniej
// (`ACC_WRITE_LATE`). Za dlugim `SHL CL` obie hipotezy chybily - trafia dopiero
// forma, w ktorej BIU nie dopobiera przed wlasnym odczytem i nie odrabia potem
// bezczynnej magistrali wstecz.
//
// **ROZKAZY LANCUCHOWE NIE ZOSTAWIAJA OKNA** - poza `LODS`. NOP za `MOVSB`,
// `SCASB` i `CMPSB` kosztuje 4,03 / 3,99 / 3,92 taktu. Po kazdym z pieciu model
// liczy tego NOP-a o takt za tanio (-1,1 do -1,5%); regula, ktora to zdejmuje
// (lancuchowy bez `REP` zostawia w kolejce najwyzej bajt), wydluza Nucleusa
// o 4,8 s i czeka na wlasny pomiar.
//
// **PRZEDROSTEK** z pelnej kolejki: dwa takty (`PREFIX_QUEUE_BYTE`) sa blizej
// w kazdym bloku, ale jeden `ES: NOP` i `NOP, ES: NOP` zostaja +1,03 i +0,53%.
const SHL24 = [0xD2, 0xE0];                // shl al,cl - wypelniacz, CL=8
const drabina24 = (...g) => Array.from({ length: 4 }, () => [...SHL24, ...g]).flat();

const POMIARY24 = [
  ['A2 akum x8',                          166.65, 0.5, powtorz(8, 0xA2, ...D23)],
  ['A1 akum x8',                          182.86, 0.5, powtorz(8, 0xA1, ...D23)],
  ['A3 akum x8',                          198.83, 0.5, powtorz(8, 0xA3, ...D23)],
  ['(SHL CL + A0 x2) x4',                 287.33, 0.5, drabina24(0xA0, ...D23, 0xA0, ...D23)],
  ['(SHL CL + A0) x4',                    222.91, 0.5, drabina24(0xA0, ...D23)],
  ['petla dema: MOVSB, NOP, skok',       2214.05, 0.5, dema23({ ogon: [0xA4, NOP], di: true })],
  ['petla dema: SCASB, NOP, skok',       2149.50, 0.5, dema23({ ogon: [0xAE, NOP], di: true })],
  ['petla dema: CMPSB, NOP, skok',       2300.41, 0.5, dema23({ ogon: [0xA6, NOP], di: true })],
  ['(SHL CL + ES: NOP) x4',               203.95, 1.5, drabina24(0x26, NOP)],
  ['(SHL CL + NOP, ES: NOP) x4',          217.05, 1.0, drabina24(NOP, 0x26, NOP)],
];

// TEMPO24, w kolejnosci wierszy powyzej.
const INNER_POMIARY24 = [400, 300, 300, 200, 250, 25, 25, 25, 250, 220];

// ---- TEMPO25 ---------------------------------------------------------------
//
// Dwudziesty piaty program, 2026-09-13. **Piec kotwic na piec, dryf 0,000%**, obie
// kontrole metody co do setnej. Jedno pytanie: czy rozkaz lancuchowy bez `REP`
// zostawia w kolejce najwyzej bajt - regula, ktora klada wszystkie bloki "NOP za
// rozkazem lancuchowym przed skokiem", ale wydluza Nucleusa o 4,8 s.
//
// **OBALONE.** W osmiu blokach, w ktorych obie wersje sie rozchodza, sprzet stoi
// przy dzisiejszej kolejce (polozenie -0,04 do 0,36 na odcinku dzis-regula), petla
// Nucleusa spod 366:1609 -0,72% wobec +4,56% z regula.
//
// **Za to nowa rodzina, ktorej model nie umie.** Dwubajtowy `XCHG AL,BH` za
// `LODSB` w petli dema kosztuje 3,97 taktu wiecej niz NOP, za `STOSB` 0,13 - model
// liczy oba jednakowo (-2,82% i +2,82%). Petla Nucleusa spod 366:54AB (`LODSB`,
// `XOR AL,[DI]`, `OUT`) +4,22%, `(STOSB + XCHG AL,BH) x8` -4,69%, `LODSB x8` -2,32%.
const SI25 = [0xBE, 0x00, 0x08];          // mov si,0800h
const DI25 = [0xBF, 0xC8, 0x08];          // mov di,08C8h
const LODSB25 = 0xAC, STOSB25 = 0xAA, XCHG_AL_BH25 = [0x86, 0xF8];

// Petla Nucleusa spod 366:1609, BX w miejscu BP (BP jest licznikiem pomiaru).
const nucleus1609 = (() => {
  const c = [0xAD, 0x93, 0x8B, 0x97, 0x18, 0x0D, 0x8B, 0x9F, 0xD6, 0x04,
             0xAD, 0x93, 0x03, 0x97, 0x4C, 0x0E, 0x03, 0x9F, 0x64, 0x0E,
             0xAD, 0x93, 0x03, 0x97, 0xD8, 0x04, 0x03, 0x9F, 0x02, 0x0C,
             0x31, 0xC0, 0x86, 0xF0, 0x04, 0x20, 0xAB, 0x86, 0xF8, 0x04, 0x20, 0xAB];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...DI25, ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
})();
// Petla Nucleusa spod 366:54AB: CL=30, `DEC CL` / `JNZ`.
const nucleus54AB = (() => {
  const c = [NOP, 0xAC, 0x32, 0x05, 0xEE, 0x47, 0xFE, 0xC9];
  return [0xB1, 0x1E, ...SI25, 0xBF, 0x00, 0x09, ...c, 0x75, (256 - (c.length + 2)) & 0xFF];
})();

const POMIARY25 = [
  ['MOV SI + (LODSB + NOP) x8',            154.73, 1.0, [...SI25, ...powtorz(8, LODSB25, NOP)]],
  ['MOV DI + (STOSB + NOP) x8',            146.79, 0.5, [...DI25, ...powtorz(8, STOSB25, NOP)]],
  ['MOV SI + (LODSB + XCHG AL,BH) x8',     178.94, 1.0, [...SI25, ...powtorz(8, LODSB25, ...XCHG_AL_BH25)]],
  ['MOV DI + (STOSB + XCHG AL,BH) x8',     178.88, 5.0, [...DI25, ...powtorz(8, STOSB25, ...XCHG_AL_BH25)]],
  ['MOV SI + (LODSB + MOV DX,[BX+d16]) x8', 309.72, 0.5,
    [...SI25, ...powtorz(8, LODSB25, 0x8B, 0x97, 0x18, 0x0D)]],
  ['MOV SI + LODSB x8 [ZNANY -3.71]',      132.62, 0.3, [...SI25, ...powtorz(8, LODSB25)], { znane: -3.71 }],
  ['MOV SI + (LODSW + XCHG AX,BX) x8',     186.93, 1.0, [...SI25, ...powtorz(8, 0xAD, 0x93)]],
  ['petla dema: LODSB, XCHG AL,BH, skok', 2081.24, 0.5, dema23({ ogon: [LODSB25, ...XCHG_AL_BH25] })],
  ['petla dema: STOSB, XCHG AL,BH, skok', 1977.95, 0.5,
    dema23({ ogon: [STOSB25, ...XCHG_AL_BH25], di: true })],
  ['petla Nucleusa 366:1609',             8856.22, 1.0, nucleus1609],
  ['petla Nucleusa 366:54AB',             1973.98, 4.5, nucleus54AB],
];

// TEMPO25, w kolejnosci wierszy powyzej.
const INNER_POMIARY25 = [320, 330, 270, 280, 150, 380, 260, 25, 25, 5, 25];

// ---- TEMPO26 ---------------------------------------------------------------
//
// Dwudziesty szosty program, 2026-09-13. **Piec kotwic na piec, dryf 0,000%**, obie
// kontrole metody co do setnej. Jedno pytanie: czy obieg petli stoi na kratce
// czterech taktow - przy biurku wyszlo, ze kazdy obieg petli dema zmierzony od
// TEMPO19 jest wielokrotnoscia cyklu magistrali, a model wypada z kratki dokladnie
// w wierszach, w ktorych chybia.
//
// **STOI.** Jedenascie blokow, kazdy na kratce - takze `STOSB, NOP x3`, ktory
// kazda przygotowana hipoteza dawala na 69 taktow, a sprzet na 72. Obieg zamkniety
// `LOOP`-em zaokragla sie w gore, liczac od miejsca, w ktorym BIU ostatnio sie
// zwolnilo, plus dwa takty (`LOOP_GRID_PHASE`), a bajty kolejki licza sie przy tym
// po dwa takty, nie po trzy (`LOOP_QUEUE_BYTE`). `DEC BP` / `JNZ` na koncu
// strumienia nasyconego sie nie zaokragla.
const POMIARY26 = [
  ['petla dema: STOSB, CWD, skok',          2090.09, 0.5, dema23({ ogon: [0xAA, 0x99], di: true })],
  ['petla dema: STOSB, NOP NOP, skok',      2094.55, 0.5, dema23({ ogon: [0xAA, NOP, NOP], di: true })],
  ['petla dema: STOSB, NOP x3, skok',       2214.05, 0.5, dema23({ ogon: [0xAA, NOP, NOP, NOP], di: true })],
  ['petla dema: STOSB, MOV AX,imm, skok',   2097.52, 0.5, dema23({ ogon: [0xAA, 0xB8, 0x00, 0x00], di: true })],
  ['petla dema: MOV AL,[DI], MOV AH,AL',    2097.52, 0.5, dema23({ ogon: [0x8A, 0x05, 0x88, 0xC4], di: true })],
  ['petla dema: LODSB, CWD, skok',          2078.31, 0.5, dema23({ ogon: [0xAC, 0x99] })],
  ['petla dema: LODSB, NOP NOP, skok',      2081.24, 0.5, dema23({ ogon: [0xAC, NOP, NOP] })],
  ['petla dema: MOV [DI],AL, CWD, skok',    2209.08, 0.5, dema23({ ogon: [0x88, 0x05, 0x99], di: true })],
  ['petla dema: STOSB, CLC, MOV AH,AL',     2097.52, 0.5, dema23({ ogon: [0xAA, 0xF8, 0x88, 0xC4], di: true })],
  ['petla dema: MOV AL,[DI], NOP NOP',      2214.05, 0.5, dema23({ ogon: [0x8A, 0x05, NOP, NOP], di: true })],
  ['petla dema: MOV [DI],AL, NOP NOP',      2214.05, 0.5, dema23({ ogon: [0x88, 0x05, NOP, NOP], di: true })],
];

// TEMPO26, w kolejnosci wierszy powyzej.
const INNER_POMIARY26 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25];

// TEMPO27: petla dema z wyborem zamkniecia ('loop', 'jnz' = DEC CX / JNZ,
// 'loopnz' z OR AL,1 przed petla). Wykonany LOOPNZ kosztuje tyle co LOOP.
const dema27 = ({ ogon = [], di = false, zamk = 'loop' } = {}) => {
  const c = [NOP, NOP, 0x8A, 0x80, ...D23, ...ogon];
  const koniec = zamk === 'jnz' ? [0x49, 0x75, (256 - (c.length + 3)) & 0xFF]
    : [zamk === 'loopnz' ? 0xE0 : 0xE2, (256 - (c.length + 2)) & 0xFF];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...(di ? [0xBF, 0xC8, 0x08] : []),
          ...(zamk === 'loopnz' ? [0x0C, 0x01] : []), ...c, ...koniec];
};
const POMIARY27 = [
  ['petla dema: MOV AL,[DI], CWD, LOOP',     2209.08, 0.5, dema27({ ogon: [0x8A, 0x05, 0x99], di: true })],
  ['petla dema: LODSB, NOP x3, LOOP',        2202.48, 0.5, dema27({ ogon: [0xAC, NOP, NOP, NOP] })],
  ['petla dema: MOV AL,[DI], NOP x3, LOOP',  2333.16, 0.5, dema27({ ogon: [0x8A, 0x05, NOP, NOP, NOP], di: true })],
  ['petla dema: STOSB, DEC CX, JNZ',         1973.98, 2, dema27({ ogon: [0xAA], di: true, zamk: 'jnz' })],
  ['petla dema: STOSB, NOP, DEC CX, JNZ',    1977.95, 3.5, dema27({ ogon: [0xAA, NOP], di: true, zamk: 'jnz' })],
  ['petla dema: STOSB, NOP NOP, DEC CX,JNZ', 2097.52, 2, dema27({ ogon: [0xAA, NOP, NOP], di: true, zamk: 'jnz' })],
  ['petla dema: LODSB, NOP, DEC CX, JNZ',    2081.24, 3, dema27({ ogon: [0xAC, NOP], zamk: 'jnz' })],
  ['petla dema: [DI], NOP NOP, DEC CX, JNZ', 2217.38, 2, dema27({ ogon: [0x8A, 0x05, NOP, NOP], di: true, zamk: 'jnz' })],
  ['petla dema: STOSB, NOP, LOOPNZ',         1981.94, 0.5, dema27({ ogon: [0xAA, NOP], di: true, zamk: 'loopnz' })],
  ['petla dema: STOSB, NOP NOP, LOOPNZ',     2102.01, 0.5, dema27({ ogon: [0xAA, NOP, NOP], di: true, zamk: 'loopnz' })],
  ['petla dema: LODSB, XCHG AL,BH, LOOPNZ',  2090.09, 0.5, dema27({ ogon: [0xAC, 0x86, 0xF8], zamk: 'loopnz' })],
];
const INNER_POMIARY27 = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25];

// TEMPO28: petle 30 obrotow bez odczytu dema, zamkniete LOOP albo DEC CX / JNZ.
const petla28 = (raz, cialo, zamk) => {
  const k = zamk === 'jnz' ? [0x49, 0x75, (256 - (cialo.length + 3)) & 0xFF] : [0xE2, (256 - (cialo.length + 2)) & 0xFF];
  return [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...raz, ...cialo, ...k];
};
const DI28 = [0xBF, 0x90, 0x09], SI28 = [0xBE, 0x00, 0x08], XC28 = [0x86, 0xF8];
const POMIARY28 = [
  ['T28 NOP NOP, STOSB, NOP, DEC CX, JNZ',   1374.09, 0.5, petla28(DI28, [NOP, NOP, 0xAA, NOP], 'jnz')],
  ['T28 STOSB, NOP, DEC CX, JNZ',            1133.84, 0.5, petla28(DI28, [0xAA, NOP], 'jnz')],
  ['T28 STOSB, NOP, LOOP',                   1013.36, 0.5, petla28(DI28, [0xAA, NOP], 'loop')],
  ['T28 MOV DI, STOSB, NOP, DEC CX, JNZ',    1483.22, 0.5, petla28([], [...DI28, 0xAA, NOP], 'jnz')],
  ['T28 MOV DI, (STOSB,NOP)x2, DEC CX, JNZ', 1905.56, 0.5, petla28([], [...DI28, ...powtorz(2, 0xAA, NOP)], 'jnz')],
  ['T28 MOV DI, (STOSB,NOP)x8, DEC CX, JNZ', 4438.77, 0.5, petla28([], [...DI28, ...powtorz(8, 0xAA, NOP)], 'jnz')],
  ['T28 MOV DI, (STOSB,NOP)x8, LOOP',        4318.65, 0.5, petla28([], [...DI28, ...powtorz(8, 0xAA, NOP)], 'loop')],
  ['T28 LODSB, NOP, DEC CX, JNZ',            1121.42, 0.5, petla28([], [0xAC, NOP], 'jnz')],
  ['T28 MOV SI, (LODSB,XCHG)x8, DEC CX, JNZ', 5403.69, 1, petla28([], [...SI28, ...powtorz(8, 0xAC, ...XC28)], 'jnz')],
  ['T28 MOV SI, (LODSB,XCHG)x8, LOOP',       5285.16, 0.5, petla28([], [...SI28, ...powtorz(8, 0xAC, ...XC28)], 'loop')],
  ['T28 MOV DI, (STOSB,XCHG)x8, LOOP',       5281.38, 4.5, petla28([], [...DI28, ...powtorz(8, 0xAA, ...XC28)], 'loop')],
];
const INNER_POMIARY28 = [38, 45, 47, 34, 27, 11, 11, 45, 9, 9, 10];

// TEMPO29: petle LOOP 30 obrotow bez odczytu dema.
const petla29 = (raz, cialo, zamk = 0xE2) => [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...raz,
  ...(zamk === 0xE0 ? [0x0C, 0x01] : []), ...cialo, zamk, (256 - (cialo.length + 2)) & 0xFF];
const POMIARY29 = [
  ['T29 STOSB, LOOP',                 892.85, 0.5, petla29(DI28, [0xAA])],
  ['T29 STOSB, NOP x3, LOOP',        1254.18, 0.5, petla29(DI28, [0xAA, NOP, NOP, NOP])],
  ['T29 STOSB, STOSB, LOOP',         1250.94, 0.5, petla29(DI28, [0xAA, 0xAA])],
  ['T29 LODSB, LOOP',                 997.25, 0.5, petla29([], [0xAC])],
  ['T29 MOVSB, NOP, LOOP',           1250.94, 0.5, petla29(DI28, [0xA4, NOP])],
  ['T29 SCASB, NOP, LOOP',           1186.10, 1, petla29(DI28, [0xAE, NOP])],
  ['T29 STOSB, NOP, LOOPNZ',         1022.31, 0.5, petla29(DI28, [0xAA, NOP], 0xE0)],
  ['T29 STOSB, OUT, NOP, LOOP',      1262.77, 0.5, petla29([...DI28, 0xB0, 0x00], [0xAA, 0xEE, NOP])],
  ['T29 IN, STOSB, NOP, LOOP',       1315.35, 0.5, petla29(DI28, [0xEC, 0xAA, NOP])],
  ['T29 STOSB, MOV AL,[DI], LOOP',   1371.58, 0.5, petla29(DI28, [0xAA, 0x8A, 0x05])],
  ['T29 LODSB, XCHG AL,BH, LOOP',    1121.68, 5.5, petla29([], [0xAC, 0x86, 0xF8])],
];
const INNER_POMIARY29 = [52, 38, 38, 47, 38, 40, 41, 37, 36, 34, 42];

// TEMPO30: petle LOOP 30 obrotow bez odczytu dema.
const SI30 = [0xBE, 0x00, 0x08];
const POMIARY30 = [
  ['T30 STOSB, ADD AX,imm16, LOOP',       1374.50, 9.5, petla29(DI28, [0xAA, 0x81, 0xC0, 0x00, 0x00])],
  ['T30 STOSB, MOV AL,[DI+d8], LOOP',     1492.23, 4.5, petla29(DI28, [0xAA, 0x8A, 0x45, 0x00])],
  ['T30 STOSB, MOV AX,[d16], LOOP',       1495.50, 4.5, petla29(DI28, [0xAA, 0xA1, 0x00, 0x08])],
  ['T30 STOSB, MOV w[DI],imm16, LOOP',    1675.64, 7.5, petla29(DI28, [0xAA, 0xC7, 0x05, 0x00, 0x00])],
  ['T30 LODSB, MOV AH,AL, LOOP',          1121.68, 5.5, petla29([], [0xAC, 0x88, 0xC4])],
  ['T30 LODSB, XCHG AL,BH, NOP, LOOP',    1241.46, 2.5, petla29([], [0xAC, 0x86, 0xF8, NOP])],
  ['T30 NOP, LODSB, XCHG AL,BH, LOOP',    1242.93, 2.5, petla29([], [NOP, 0xAC, 0x86, 0xF8])],
  ['T30 MOV SI, LODSB, XCHG AL,BH, LOOP', 1483.58, 0.5, petla29([], [...SI30, 0xAC, 0x86, 0xF8])],
  ['T30 STOSB, XCHG AL,BH, LOOP',         1133.51, 3, petla29(DI28, [0xAA, 0x86, 0xF8])],
  ['T30 IN, NOP, LOOP',                   1001.10, 0.5, petla29([], [0xEC, NOP])],
  ['T30 MOV AL,[DI], NOP, LOOP',          1190.10, 0.5, petla29(DI28, [0x8A, 0x05, NOP])],
];
const INNER_POMIARY30 = [40, 32, 34, 32, 42, 42, 38, 32, 46, 49, 41];

// TEMPO31: strumienie (STOSB/LODSB, XCHG) w petli LOOP 30 obrotow, DI raz.
const XC31 = [0x86, 0xF8];
const POMIARY31 = [
  ['T31 (STOSB, XCHG) x2, LOOP',     1676.06, 0.5, petla29(DI28, powtorz(2, 0xAA, ...XC31))],
  ['T31 (STOSB, XCHG) x4, LOOP',     2761.87, 3, petla29(DI28, powtorz(4, 0xAA, ...XC31))],
  ['T31 (STOSB, XCHG) x8, LOOP',     4931.97, 4, petla29(DI28, powtorz(8, 0xAA, ...XC31))],
  ['T31 (LODSB, XCHG) x2, LOOP',     1664.33, 4, petla29([], powtorz(2, 0xAC, ...XC31))],
  ['T31 (LODSB, XCHG) x4, LOOP',     2748.17, 2.5, petla29([], powtorz(4, 0xAC, ...XC31))],
  ['T31 (LODSB, XCHG) x8, LOOP',     4917.49, 1.5, petla29([], powtorz(8, 0xAC, ...XC31))],
  ['T31 STOSB, XCHG, NOP, LOOP',     1254.45, 0.5, petla29(DI28, [0xAA, ...XC31, NOP])],
  ['T31 STOSB, NOP, XCHG, LOOP',     1254.45, 0.5, petla29(DI28, [0xAA, NOP, ...XC31])],
  ['T31 STOSB, XCHG, XCHG, LOOP',    1374.50, 1, petla29(DI28, [0xAA, ...XC31, ...XC31])],
  ['T31 NOP, MOV AL,[DI+d8], LOOP',  1311.14, 0.5, petla29(DI28, [NOP, 0x8A, 0x45, 0x00])],
  ['T31 NOP, MOV AX,[d16], LOOP',    1314.93, 0.5, petla29(DI28, [NOP, 0xA1, 0x00, 0x08])],
];
const INNER_POMIARY31 = [31, 19, 11, 31, 19, 11, 39, 39, 36, 36, 35];

// TEMPO32: za STOSB rozkazy od "na pewno magistrala" do "na pewno praca".
const POMIARY32 = [
  ['T32 STOSB, CWD, LOOP',              1129.52, 0.5, petla29(DI28, [0xAA, 0x99])],
  ['T32 STOSB, SHL AL,1, LOOP',         1134.00, 3, petla29(DI28, [0xAA, 0xD0, 0xE0])],
  ['T32 STOSB, AAD, LOOP',              2758.25, 1.5, petla29(DI28, [0xAA, 0xD5, 0x0A])],
  ['T32 STOSB, AAD, NOP, LOOP',         2877.86, 1.5, petla29(DI28, [0xAA, 0xD5, 0x0A, NOP])],
  ['T32 AAD, STOSB, LOOP',              2815.98, 6.5, petla29(DI28, [0xD5, 0x0A, 0xAA])],
  ['T32 LODSB, AAD, LOOP',              2745.31, 1.5, petla29([], [0xAC, 0xD5, 0x0A])],
  // Model regulowy: +1,00 - to rodzina `STOSB, AAD, LOOP` (+1,10) i `LODSB, AAD, LOOP` (+1,14): model
  // jest tu za drogi o takt na obrot. Wczesniej ten wiersz trafial, bo nie bylo w nim taktu
  // MUL za pusta gorna polowe iloczynu (0 x 0) - dwa bledy sie znosily. TEMPO60 obalil
  // obie bramy, ktore by ten takt tu zdejmowaly (po dostepie do pamieci, w petli LOOP).
  // Potem wyladowal (+0,05) razem z cala rodzina - LOOP w obrocie lancuchowym rounduje na
  // siatce skoku (TEMPO61-63).
  ['T32 STOSB, MUL BL (BL=0), LOOP',    3067.91, 0.5, petla29([...DI28, 0xB3, 0x00], [0xAA, 0xF6, 0xE3])],
  ['T32 STOSB, LEA AX,[BX+SI], LOOP',   1251.07, 0.5, petla29(DI28, [0xAA, 0x8D, 0x00])],
  ['T32 STOSB, ADD BX,imm16, LOOP',     1373.88, 9, petla29(DI28, [0xAA, 0x81, 0xC3, 0x00, 0x00])],
  ['T32 (STOSB, SHL AL,1) x4, LOOP',    2761.97, 2.5, petla29(DI28, powtorz(4, 0xAA, 0xD0, 0xE0))],
  ['T32 STOSB, PUSH AX, POP AX, LOOP',  1792.95, 0.5, petla29(DI28, [0xAA, 0x50, 0x58])],
];
const INNER_POMIARY32 = [43, 42, 18, 17, 19, 18, 16, 36, 39, 18, 27];

// TEMPO33: sprawdzian reguły siatki na kształtach, których przy niej nie było.
const AL033 = [...DI28, 0xB0, 0x00];
const POMIARY33 = [
  ['T33 STOSB, NOP, IN, LOOP',          1314.41, 0.5, petla29(DI28, [0xAA, NOP, 0xEC])],
  ['T33 NOP, OUT, STOSB, LOOP (AL=0)',  1262.77, 5, petla29(AL033, [NOP, 0xEE, 0xAA])],
  ['T33 STOSB, AAM, LOOP',              3248.65, 4, petla29(AL033, [0xAA, 0xD4, 0x0A])],
  ['T33 STOSB, NOP, XLAT, LOOP',        1370.46, 4.5, petla29(DI28, [0xAA, NOP, 0xD7])],
  ['T33 STOSB, PUSHF, POPF, LOOP',      1792.95, 0.5, petla29(DI28, [0xAA, 0x9C, 0x9D])],
  ['T33 STOSB, LEA AX,[SI], LOOP',      1250.31, 0.5, petla29(DI28, [0xAA, 0x8D, 0x04])],
  ['T33 STOSB, CMP AL,[BX+SI], LOOP',   1546.83, 11.5, petla29(DI28, [0xAA, 0x3A, 0x00])],
  ['T33 STOSB, MOV AL,[BX], LOOP',      1370.82, 1, petla29(DI28, [0xAA, 0x8A, 0x07])],
  ['T33 AAD, NOP, STOSB, LOOP',         2886.54, 5.5, petla29(AL033, [0xD5, 0x0A, NOP, 0xAA])],
  ['T33 STOSB, AAD, AAD, LOOP',         4603.40, 1, petla29(AL033, [0xAA, 0xD5, 0x0A, 0xD5, 0x0A])],
  ['T33 STOSB, CWD, CWD, LOOP',         1250.31, 0.5, petla29(DI28, [0xAA, 0x99, 0x99])],
];
const INNER_POMIARY33 = [37, 37, 15, 37, 27, 39, 36, 36, 18, 11, 39];

// TEMPO34: jedenaście gorących pętli Nucleusa, rozkaz w rozkaz, w nawiasie ich adres.
// Program pomiarowy kładzie dane we własnych buforach; tutaj leżą pod stałymi
// adresami z dala od kodu i stosu. Wartości nie wpływają na czas, tylko długości
// przemieszczeń - te są takie jak w Nucleusie. Dane zbiera CH zamiast CL, a przed OUT
// stoi XCHG AX,BX zamiast XCHG AX,CX, żeby przeżył licznik LOOP-a; blok 0D263 ma cztery
// grupy końcowe zamiast dwunastu, bo przy dwunastu rusztowanie nie sięga skokiem rel8.
const w34 = (v) => [v & 0xFF, (v >> 8) & 0xFF];
const B34 = 0x2000, Z34 = 0x3000, T34 = 0x4000, LIC34 = 0x1800, SI34 = 0x1806;
const petla34 = (raz, cialo, zamk = 'loop', po = []) => [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...raz, ...cialo,
  ...(zamk === 'loop'
    ? [0xE2, (256 - (cialo.length + 2)) & 0xFF]
    : zamk === 'jnz'
      ? [0x49, 0x75, (256 - (cialo.length + 3)) & 0xFF]                  // dec cx / jnz
      : [0x49, 0x74, 0x03, 0xE9, ...w34(0x10000 - (cialo.length + 6))]),   // dec cx / jz / jmp near
  ...po];
const DI34 = [0xBF, ...w34(B34 + 400)];
const GRUPA9_34 = (op) => [0xAD, 0x93, 0xAD, 0x97, 0x02, 0x1D, op, 0x2F];
const GRUPA10_34 = (k) => (k === 0 ? [0xAD, 0x93, 0x8A, 0x29] : [0xAD, 0x93, 0x0A, 0xA9, k * 8, 0x00]);
const OBIEG11_34 = [
  0x21, 0xEF, 0x2E, 0x8B, 0x95, ...w34(Z34), 0x8B, 0x1E, ...w34(LIC34), 0x21, 0xEB,
  0x2E, 0x03, 0x97, ...w34(Z34), 0x8B, 0x1E, ...w34(LIC34 + 2), 0x21, 0xEB,
  0x2E, 0x03, 0x97, ...w34(Z34 + 0x100), 0x8B, 0x1E, ...w34(LIC34 + 4), 0x21, 0xEB,
  0x2E, 0x03, 0x97, ...w34(Z34 + 0x100), 0x83, 0xC7, 0x09,
  0x83, 0x2E, ...w34(LIC34), 0x06, 0x83, 0x06, ...w34(LIC34 + 2), 0x05, 0x83, 0x2E, ...w34(LIC34 + 4), 0x09,
  0x2E, 0x8B, 0x36, ...w34(SI34), 0x01, 0xD6,
  ...powtorz(4, 0xAD, 0x93, 0xAC, 0x2E, 0x08, 0x87, ...w34(B34 + 300)),
];
const OBIEG12_34 = [
  0xAD, 0x95, 0x8B, 0x96, ...w34(Z34 + 0x10), 0x8B, 0x9E, ...w34(Z34 + 0x20),
  0xAD, 0x95, 0x03, 0x96, ...w34(Z34 + 0x30), 0x03, 0x9E, ...w34(Z34 + 0x40),
  0xAD, 0x95, 0x03, 0x96, ...w34(Z34 + 0x50), 0x03, 0x9E, ...w34(Z34 + 0x60),
  0x31, 0xC0, 0x86, 0xF0, 0x04, 0x29, 0xAB, 0x86, 0xF8, 0x04, 0x20, 0xAB,
];
const OBIEG13_34 = [0x47, ...powtorz(4, NOP, NOP, NOP, NOP, 0x8A, 0x05, 0x88, 0x1D, 0xEE, 0x47), 0x47, 0x83, 0xC6, 0x1E];
const TAB9_34 = Array.from({ length: 30 * 16 }, (_, i) => [[T34 + 2 * i, Z34 & 0xFF], [T34 + 2 * i + 1, Z34 >> 8]]).flat();
const POMIARY34 = [
  ['T34 ADD BX,BX, LOOP (0481E)',        820.29, 1, petla34([], [0x01, 0xDB])],
  ['T34 NOP2,[DI],OUT,INC DI (0F270)',  1671.84, 0.5, petla34(DI34, [NOP, NOP, 0x8A, 0x05, 0xEE, 0x47])],
  ['T34 NOP6,[DI],INC DI,OUT (09CD8)',  2215.32, 0.5, petla34(DI34, [...powtorz(6, NOP), 0x8A, 0x05, 0x47, 0xEE])],
  ['T34 NOP,[DI],[DI]<-AH,OUT (08B4B)', 1981.94, 3.5, petla34([...DI34, 0x31, 0xC0], [NOP, 0x8A, 0x05, 0x88, 0x25, 0xEE, 0x47])],
  ['T34 NOP4,MOV AL,0,OUT (0EDF4)',     1603.72, 0.5, petla34([], [NOP, NOP, NOP, NOP, 0xB0, 0x00, 0xEE])],
  ['T34 XOR AX,AX x30, LOOP (0EF5A)',   7816.79, 1.5, petla34([], powtorz(30, 0x31, 0xC0))],
  ['T34 kolumna 0D92A',                16984.11, 1, petla34([0xBE, ...w34(T34)],
    [...GRUPA9_34(0x8A), ...powtorz(7, ...GRUPA9_34(0x0A)), 0x93, 0xEE]), { pamiec: TAB9_34 }],
  ['T34 kolumna 0C3EF',                10810.56, 5, petla34([0xBE, ...w34(Z34), 0xBF, ...w34(Z34)],
    [...Array.from({ length: 8 }, (_, k) => GRUPA10_34(k)).flat(), 0x93, 0xEE])],
  ['T34 obieg 0D263, JZ/JMP',          20221.61, 2, petla34([], OBIEG11_34, 'jzjmp'),
    { pamiec: [[SI34, (Z34 + 0x200) & 0xFF], [SI34 + 1, (Z34 + 0x200) >> 8]] }],
  ['T34 obieg 04C69',                   8885.03, 1, petla34([0xBE, ...w34(Z34), 0xBF, ...w34(B34 + 1000), 0x55],
    OBIEG12_34, 'loop', [0x5D])],
  ['T34 obieg 0D75A, JZ/JMP',           8186.54, 3.5, petla34(DI34, OBIEG13_34, 'jzjmp')],
];
const INNER_POMIARY34 = [60, 30, 23, 25, 31, 6, 3, 5, 1, 6, 6];

// TEMPO35: pudła TEMPO34 rozcięte na części. Pętle 08B4B i 0D75A z NOP-ami przed
// odczytem, bez OUT i z NOP-em przed OUT; kolumna 0C3EF z MOV zamiast OR, bez
// przemieszczeń i z NOP-em zamiast XCHG. DI i AX=0 ustawia jednorazowy wstęp.
const RAZ35 = [...DI34, 0x31, 0xC0];
const RW35 = [0x8A, 0x05, 0x88, 0x25];                      // mov al,[di] / mov [di],ah
const ZERA35 = [0xBE, ...w34(Z34), 0xBF, ...w34(Z34)];
const KOLUMNA35 = ({ op = 0x0A, disp = true, xchg = true }) => [...Array.from({ length: 8 }, (_, k) => [
  0xAD, xchg ? 0x93 : NOP,
  ...(k === 0 ? [0x8A, 0x29] : disp ? [op, 0xA9, k * 8, 0x00] : [op, 0x29])]).flat(), 0x93, 0xEE];
const POMIARY35 = [
  ['T35 NOP2,[DI],[DI]<-AH,OUT,INC DI',  2103.39, 3.5, petla34(RAZ35, [NOP, NOP, ...RW35, 0xEE, 0x47])],
  ['T35 NOP4,[DI],[DI]<-AH,OUT,INC DI',  2343.70, 3, petla34(RAZ35, [...powtorz(4, NOP), ...RW35, 0xEE, 0x47])],
  ['T35 ([DI],[DI]<-AH,OUT,INC DI)x2',   3489.92, 1.5, petla34(RAZ35,
    [...RW35, 0xEE, 0x47, ...powtorz(4, NOP), ...RW35, 0xEE, 0x47])],
  ['T35 NOP,[DI],[DI]<-AH,INC DI',       1740.51, 4, petla34(RAZ35, [NOP, ...RW35, 0x47])],
  ['T35 NOP,[DI],[DI]<-AH,NOP,OUT',      2103.39, 6.5, petla34(RAZ35, [NOP, ...RW35, NOP, 0xEE, 0x47])],
  ['T35 ([DI],[DI]<-AH,INC DI)x2',       3008.08, 1.5, petla34(RAZ35, [...RW35, 0x47, ...powtorz(4, NOP), ...RW35, 0x47])],
  ['T35 NOP2,[DI],NOP4,OUT,INC DI',      2046.58, 3.5, petla34(RAZ35,
    [NOP, NOP, 0x8A, 0x05, ...powtorz(4, NOP), 0xEE, 0x47])],
  ['T35 ([DI],OUT,INC DI)x2, NOP4',      2648.28, 0.5, petla34(RAZ35,
    [0x8A, 0x05, 0xEE, 0x47, ...powtorz(4, NOP), 0x8A, 0x05, 0xEE, 0x47])],
  ['T35 kolumna 0C3EF, MOV zamiast OR', 10755.36, 4.5, petla34(ZERA35, KOLUMNA35({ op: 0x8A }))],
  ['T35 kolumna 0C3EF, bez disp [ZNANY -1.75]', 10113.58, 0.3, petla34(ZERA35, KOLUMNA35({ disp: false })), { znane: -1.75 }],
  ['T35 kolumna 0C3EF, NOP zamiast XCHG', 10810.56, 5, petla34(ZERA35, KOLUMNA35({ xchg: false }))],
];
const INNER_POMIARY35 = [23, 21, 14, 30, 23, 15, 25, 16, 5, 6, 5];

// TEMPO36: odczyt przez adres za rozkazem łańcuchowym i przed nim. Kolumna 0C3EF bez
// LODSW i z adresem jednorejestrowym, pojedyncza grupa w obu kolejnościach, a za STOSB
// odczyt [BX+SI] z MOV zamiast CMP, z NOP-ami, z przemieszczeniem i za LODSB.
const ZAPIS36 = [0xBF, ...w34(B34 + 400), 0xBE, ...w34(Z34), 0x31, 0xC0];
const KOLUMNA36 = (wez, adres) => [...Array.from({ length: 8 }, (_, k) => [
  ...wez, 0x93, k === 0 ? 0x8A : 0x0A, adres]).flat(), 0x93, 0xEE];
const POMIARY36 = [
  ['T36 kolumna [BX+DI], MOV AX,[SI]',  11740.13, 2, petla34(ZERA35, KOLUMNA36([0x8B, 0x04, 0x46, 0x46], 0x29))],
  ['T36 kolumna [DI] za LODSW',          9061.95, 2, petla34(ZERA35, KOLUMNA36([0xAD], 0x2D))],
  ['T36 LODSW, XCHG, OR CH,[BX+DI]',     1799.56, 10, petla34(ZERA35, [0xAD, 0x93, 0x0A, 0x29])],
  ['T36 OR CH,[BX+DI], LODSW, XCHG',     1828.39, 8.5, petla34(ZERA35, [0x0A, 0x29, 0xAD, 0x93])],
  ['T36 STOSB, MOV AL,[BX+SI]',          1449.74, 4.5, petla34(ZAPIS36, [0xAA, 0x8A, 0x00])],
  ['T36 STOSB, CMP AL,[SI]',             1506.34, 8, petla34(ZAPIS36, [0xAA, 0x3A, 0x04])],
  ['T36 STOSB, NOP, MOV AL,[BX+SI]',     1570.55, 4, petla34(ZAPIS36, [0xAA, NOP, 0x8A, 0x00])],
  ['T36 STOSB, MOV AL,[BX+SI+d16]',      1574.17, 0.5, petla34(ZAPIS36, [0xAA, 0x8A, 0x80, 0x08, 0x00])],
  ['T36 LODSB, MOV AL,[BX+SI]',          1449.74, 4.5, petla34(ZAPIS36, [0xAC, 0x8A, 0x00])],
  ['T36 MOV AL,[BX+SI], STOSB',          1509.95, 4.5, petla34(ZAPIS36, [0x8A, 0x00, 0xAA])],
  ['T36 STOSB, NOP x4, MOV AL,[BX+SI]',  1932.02, 6.5, petla34(ZAPIS36, [0xAA, NOP, NOP, NOP, NOP, 0x8A, 0x00])],
];
const INNER_POMIARY36 = [5, 6, 34, 34, 39, 39, 36, 36, 39, 39, 31];

// TEMPO37: adres dwurejestrowy za innymi rozkazami łańcuchowymi i przy zapisie, obiegi
// z LODSW z adresem jednorejestrowym, z przemieszczeniem i bez XCHG, oraz rozkazy
// arytmetyczne z odczytem [SI] za STOSB i za NOP-em.
const RAZ37 = (si) => [0xBF, ...w34(B34 + 400), 0xBE, ...w34(si), 0x31, 0xC0];
const ZERA37 = [0xBE, ...w34(Z34), 0xBF, ...w34(Z34), 0x31, 0xC0];
const POMIARY37 = [
  ['T37 STOSB, MOV [BX+SI],AH',          1566.25, 11.5, petla34(RAZ37(B34 + 500), [0xAA, 0x88, 0x20])],
  ['T37 STOSB, INC byte [BX+SI]',        1746.82, 3.5, petla34(RAZ37(B34 + 600), [0xAA, 0xFE, 0x00])],
  ['T37 SCASB, MOV AL,[BX+SI]',          1510.73, 4.5, petla34(ZERA37, [0xAE, 0x8A, 0x00])],
  ['T37 STOSW, MOV AX,[BX+SI]',          1691.16, 4, petla34(RAZ37(Z34), [0xAB, 0x8B, 0x00])],
  ['T37 MOVSB, MOV AL,[BX+SI]',          1630.79, 1, petla34(RAZ37(Z34), [0xA4, 0x8A, 0x00])],
  ['T37 LODSW, XCHG, MOV CH,[DI]',       1631.66, 6, petla34(ZERA37, [0xAD, 0x93, 0x8A, 0x2D])],
  ['T37 LODSW, XCHG, OR CH,[BX+DI+d16]', 1932.02, 6.5, petla34(ZERA37, [0xAD, 0x93, 0x0A, 0xA9, 0x08, 0x00])],
  ['T37 LODSW, NOP, OR CH,[BX+DI]',      1807.06, 10, petla34(ZERA37, [0xAD, NOP, 0x0A, 0x29])],
  ['T37 STOSB, OR AL,[SI]',              1506.34, 8, petla34(RAZ37(Z34), [0xAA, 0x0A, 0x04])],
  ['T37 NOP, CMP AL,[SI]',               1325.28, 9, petla34(RAZ37(Z34), [NOP, 0x3A, 0x04])],
  ['T37 STOSB, CMP [SI],AL',             1506.34, 8, petla34(RAZ37(Z34), [0xAA, 0x38, 0x04])],
];
const INNER_POMIARY37 = [39, 33, 37, 36, 33, 34, 31, 34, 39, 48, 39];

// TEMPO38: rozkazy arytmetyczne z odczytem bez przemieszczenia i z disp8, adres
// dwurejestrowy przy XCHG i CMPSB, oba kształty razem za LODSB, STOSW i SCASB, a do
// otwartych pudeł zapis jednorejestrowy za STOSB i LODSW bez XCHG.
const SI38 = [0xBE, ...w34(Z34)], DI38 = [0xBF, ...w34(B34 + 400)], ZDI38 = [0xBF, ...w34(Z34)];
const SIB38 = [0xBE, ...w34(B34 + 500)], AX38 = [0x31, 0xC0];
const POMIARY38 = [
  ['T38 LODSB, TEST AL,[SI]',            1495.04, 8, petla34([...SI38, ...AX38], [0xAC, 0x84, 0x04])],
  ['T38 STOSB, AND AL,[DI]',             1495.04, 8, petla34([...DI38, ...AX38], [0xAA, 0x22, 0x05])],
  ['T38 NOP, CMP AL,[BX]',               1313.76, 9, petla34([0xBB, ...w34(Z34), ...AX38], [NOP, 0x3A, 0x07])],
  ['T38 NOP, CMP AL,[SI+d8]',            1435.18, 8.5, petla34([...SI38, ...AX38], [NOP, 0x3A, 0x44, 0x08])],
  ['T38 STOSB, XCHG AH,[BX+SI]',         1752.13, 0.5, petla34([...DI38, ...SIB38, ...AX38], [0xAA, 0x86, 0x20])],
  ['T38 CMPSB, MOV AL,[BX+SI]',          1722.46, 1, petla34([...SI38, ...ZDI38, ...AX38], [0xA6, 0x8A, 0x00])],
  ['T38 LODSB, CMP AL,[BX+SI]',          1555.84, 11.5, petla34([...SI38, ...AX38], [0xAC, 0x3A, 0x00])],
  ['T38 STOSW, AND AX,[BX+DI]',          1796.71, 10, petla34([...DI38, ...AX38], [0xAB, 0x23, 0x01])],
  ['T38 SCASB, CMP AL,[BX+SI]',          1597.78, 2, petla34([...SI38, ...ZDI38, ...AX38], [0xAE, 0x3A, 0x00])],
  ['T38 STOSB, MOV [SI],AH',             1506.99, 8, petla34([...DI38, ...SIB38, ...AX38], [0xAA, 0x88, 0x24])],
  ['T38 LODSW, MOV CH,[DI]',             1511.63, 1, petla34([...SI38, ...ZDI38, ...AX38], [0xAD, 0x8A, 0x2D])],
];
const INNER_POMIARY38 = [35, 35, 40, 36, 29, 29, 33, 29, 32, 36, 33];

// TEMPO39: zawężenia trzech wcześniejszych reguł LOOP - XCHG z pamięcią, co zwalnia odczyt ALU,
// MOVS i CMPS przy odczycie ALU, zapis za LODS i odczyt-zmiana-zapis za STOS - oraz
// LODSW z XCHG bez odczytu i dwa NOP-y między STOSB a odczytem.
const Z39 = [0xBE, ...w34(Z34)], D39 = [0xBF, ...w34(B34 + 400)], ZD39 = [0xBF, ...w34(Z34)];
const S5_39 = [0xBE, ...w34(B34 + 500)], D5_39 = [0xBF, ...w34(B34 + 500)], A39 = [0x31, 0xC0];
const POMIARY39 = [
  ['T39 LODSB, XCHG AH,[BX+DI]',         1752.13, 0.5, petla34([...Z39, ...D5_39, ...A39], [0xAC, 0x86, 0x21])],
  ['T39 STOSW, XCHG AX,[BX+SI]',         2113.52, 0.5, petla34([...D39, ...S5_39, ...A39], [0xAB, 0x87, 0x00])],
  ['T39 NOP, CMP word [SI],imm16',       1443.27, 0.5, petla34([...Z39, ...A39], [NOP, 0x81, 0x3C, 0x34, 0x12])],
  ['T39 NOP, CMP AL,[SI+d16]',           1499.27, 8.5, petla34([...Z39, ...A39], [NOP, 0x3A, 0x84, 0x08, 0x00])],
  ['T39 NOP, CMP byte [SI],imm8',        1318.74, 0.5, petla34([...Z39, ...A39], [NOP, 0x80, 0x3C, 0x05])],
  ['T39 MOVSB, CMP AL,[SI]',             1688.14, 3.5, petla34([...Z39, ...D39, ...A39], [0xA4, 0x3A, 0x04])],
  ['T39 CMPSB, OR AL,[SI]',              1748.52, 2, petla34([...Z39, ...ZD39, ...A39], [0xA6, 0x0A, 0x04])],
  ['T39 LODSB, MOV [DI],AL',             1507.55, 1, petla34([...Z39, ...D5_39, ...A39], [0xAC, 0x88, 0x05])],
  ['T39 STOSB, ADD [SI],AL',             1692.64, 0.5, petla34([...D39, ...S5_39, ...A39], [0xAA, 0x00, 0x04])],
  ['T39 LODSW, XCHG AX,BX, NOP',         1261.67, 0.5, petla34([...Z39, ...A39], [0xAD, 0x93, NOP])],
  ['T39 STOSB, NOP, NOP, MOV AL,[BX+SI]', 1691.55, 0.5, petla34([...D39, ...Z39, ...A39], [0xAA, NOP, NOP, 0x8A, 0x00])],
];
const INNER_POMIARY39 = [29, 27, 36, 36, 36, 29, 29, 33, 29, 43, 31];

// TEMPO40: co zwalnia odczyt arytmetyczny z dopłaty obiegu. Cztery pętle z odczytem
// czterobajtowym (przemieszczenie d8, d16, adres dwurejestrowy i bezpośredni), trzy
// z pięciobajtowym albo z daną imm16, dwie z MOVSB i po jednej za STOSB i LODSB.
// BX jest zerem, więc przemieszczenie równe Z34 wskazuje strefę zer; SI zostaje
// jedynką tam, gdzie wstęp go nie zmienia.
const Z40 = [0xBE, ...w34(Z34)], D40 = [0xBF, ...w34(B34 + 400)], A40 = [0x31, 0xC0];
const POMIARY40 = [
  ['T40 NOP, CMP byte [SI+d8],imm8',     1439.21, 0.5, petla34([...Z40, ...A40], [NOP, 0x80, 0x7C, 0x08, 0x05])],
  ['T40 NOP, CMP AL,[BX+d16]',           1487.29, 0.5, petla34(A40, [NOP, 0x3A, 0x87, ...w34(Z34)])],
  ['T40 NOP, CMP byte [SI+d16],imm8',    1491.38, 0.5, petla34(A40, [NOP, 0x80, 0xBC, ...w34(Z34), 0x05])],
  ['T40 NOP, TEST AL,[BX+SI+d16]',       1487.29, 0.5, petla34(A40, [NOP, 0x84, 0x80, ...w34(Z34)])],
  ['T40 NOP, CMP word [SI+d8],imm16',    1563.43, 0.5, petla34([...Z40, ...A40], [NOP, 0x81, 0x7C, 0x08, 0x34, 0x12])],
  ['T40 NOP, CMP AX,[d16]',              1606.27, 0.5, petla34(A40, [NOP, 0x3B, 0x06, ...w34(Z34)])],
  ['T40 NOP, TEST byte [d16],01',        1491.38, 0.5, petla34(A40, [NOP, 0xF6, 0x06, ...w34(Z34), 0x01])],
  ['T40 MOVSB, MOV AL,[SI]',             1571.93, 4.5, petla34([...Z40, ...D40, ...A40], [0xA4, 0x8A, 0x04])],
  ['T40 MOVSB, NOP, CMP AL,[SI]',        1748.52, 5, petla34([...Z40, ...D40, ...A40], [0xA4, NOP, 0x3A, 0x04])],
  ['T40 STOSB, CMP AL,[BX+d16]',         1679.61, 0.5, petla34([...D40, ...A40], [0xAA, 0x3A, 0x87, ...w34(Z34)])],
  ['T40 LODSB, CMP AL,[d16]',            1679.61, 0.5, petla34([...Z40, ...A40], [0xAC, 0x3A, 0x06, ...w34(Z34)])],
];
const INNER_POMIARY40 = [36, 36, 34, 36, 34, 36, 34, 31, 29, 31, 31];

// TEMPO41: obieg z rozkazem łańcuchowym i odczytem przez adres. Cztery bloki ze zwykłym
// odczytem za MOVSW, SCASB, CMPSB i MOVSB, cztery z odczytem arytmetycznym za MOVSB
// w różnych kształtach adresu i odległościach, jeden z odczytem przed rozkazem
// łańcuchowym i dwa kontrolne: dana imm16 zwalniająca odczyt oraz ten sam odczyt za STOSB.
const Z41 = [0xBE, ...w34(Z34)], D41 = [0xBF, ...w34(B34 + 400)], ZD41 = [0xBF, ...w34(Z34)];
const A41 = [0x31, 0xC0];
const POMIARY41 = [
  ['T41 MOVSW, MOV AX,[SI]',             1931.87, 3.5, petla34([...Z41, ...D41, ...A41], [0xA5, 0x8B, 0x04])],
  ['T41 SCASB, MOV AL,[SI]',             1451.71, 8.5, petla34([...Z41, ...ZD41, ...A41], [0xAE, 0x8A, 0x04])],
  ['T41 CMPSB, MOV AL,[SI]',             1662.00, 4, petla34([...Z41, ...ZD41, ...A41], [0xA6, 0x8A, 0x04])],
  ['T41 MOVSB, MOV AL,[DI]',             1571.93, 4.5, petla34([...Z41, ...D41, ...A41], [0xA4, 0x8A, 0x05])],
  ['T41 MOVSB, CMP AL,[BX+SI]',          1718.96, 5, petla34([...Z41, ...D41, ...A41], [0xA4, 0x3A, 0x00])],
  ['T41 MOVSB, CMP AL,[SI+d8]',          1808.21, 0.5, petla34([...Z41, ...D41, ...A41], [0xA4, 0x3A, 0x44, 0x08])],
  ['T41 MOVSB, CMP word [SI],imm16',     1816.81, 0.5, petla34([...Z41, ...D41, ...A41], [0xA4, 0x81, 0x3C, 0x34, 0x12])],
  ['T41 MOVSB, NOP, NOP, CMP AL,[SI]',   1869.04, 0.5, petla34([...Z41, ...D41, ...A41], [0xA4, NOP, NOP, 0x3A, 0x04])],
  ['T41 MOV AL,[SI], MOVSB',             1691.55, 3.5, petla34([...Z41, ...D41, ...A41], [0x8A, 0x04, 0xA4])],
  ['T41 STOSB, MOV AL,[SI]',             1391.36, 0.5, petla34([...Z41, ...D41, ...A41], [0xAA, 0x8A, 0x04])],
  ['T41 MOVSB, MOV AL,[SI], NOP',        1692.64, 4, petla34([...Z41, ...D41, ...A41], [0xA4, 0x8A, 0x04, NOP])],
];
const INNER_POMIARY41 = [29, 33, 31, 31, 29, 29, 27, 27, 31, 35, 29];

// TEMPO42: ziarno rozliczenia obiegu, mierzone drabiną długości. Ta sama pętla wydłużana
// NOP-em o jeden bajt na blok, raz za MOVSB i raz za STOSB. Obie drabiny wchodzą po
// czterech taktach na bajt — tyle, co jedno pobranie — i spłaszczają się na tym samym
// szczeblu, gdzie pętla przestaje być związana magistralą. Model trzyma krok, ale drabina
// z MOVSB leży u niego o stałe dwa takty wyżej; te punkty pilnują jednego i drugiego.
// Zerowe szczeble obu drabin i pierwszy szczebel drabiny z MOVSB stoją już w TEMPO40
// i TEMPO41 — przebieg powtórzył je co do setnej (1571,93, 1692,64 i 1391,36).
const Z42 = [0xBE, ...w34(Z34)], D42 = [0xBF, ...w34(B34 + 400)], A42 = [0x31, 0xC0];
const RAZ42 = [...Z42, ...D42, ...A42];
const POMIARY42 = [
  ['T42 MOVSB, MOV AL,[SI], NOP x2',     1813.19, 3.5, petla34(RAZ42, [0xA4, 0x8A, 0x04, NOP, NOP])],
  ['T42 MOVSB, MOV AL,[SI], NOP x3',     1933.85, 3.5, petla34(RAZ42, [0xA4, 0x8A, 0x04, ...powtorz(3, NOP)])],
  ['T42 MOVSB, MOV AL,[SI], NOP x4',     1938.17, 3.5, petla34(RAZ42, [0xA4, 0x8A, 0x04, ...powtorz(4, NOP)])],
  ['T42 STOSB, MOV AL,[SI], NOP',        1511.63, 0.5, petla34(RAZ42, [0xAA, 0x8A, 0x04, NOP])],
  ['T42 STOSB, MOV AL,[SI], NOP x2',     1632.34, 0.5, petla34(RAZ42, [0xAA, 0x8A, 0x04, NOP, NOP])],
  ['T42 STOSB, MOV AL,[SI], NOP x3',     1752.13, 0.5, petla34(RAZ42, [0xAA, 0x8A, 0x04, ...powtorz(3, NOP)])],
  ['T42 MOVSB, NOP, MOV AL,[SI]',        1632.85, 2.5, petla34(RAZ42, [0xA4, NOP, 0x8A, 0x04])],
  ['T42 MOV AL,[SI], MOVSB, NOP',        1812.08, 3.5, petla34(RAZ42, [0x8A, 0x04, 0xA4, NOP])],
];
const INNER_POMIARY42 = [27, 25, 24, 33, 31, 29, 29, 29];

// TEMPO43: gdzie leżą cykle magistrali rozkazu łańcuchowego względem sąsiedniego dostępu.
// Nadwyżka, którą model dokłada obiegowi z MOVSB, gaśnie z odległością — 2,09 taktu przy
// zerze, 1,11 przy jednym NOP-ie i 0,08 przy dwóch — więc sięga tylko sąsiada. Za SCASB
// gaśnie dużo wolniej, po takcie na NOP. Dotyczy dostępu, nie odczytu (zapis za MOVSB
// daje to samo) i liczy się raz na obieg (dwa odczyty dają tyle, co jeden).
//
// Dwa punkty z NOP-em przed odczytem jednorejestrowym to pudło MODELU, nie sprzętu:
// sprzęt daje `STOSB, NOP, MOV AL,[SI]` i `STOSB, MOV AL,[SI], NOP` te same ~1511 taktów,
// a model rozdziela je o sześć procent, bo NOP przed odczytem daje u niego kolejce czas
// na pobranie i tanieją obie instrukcje naraz. Z adresem dwurejestrowym model trafia.
const Z43 = [0xBE, ...w34(Z34)], D43 = [0xBF, ...w34(B34 + 400)], ZD43 = [0xBF, ...w34(Z34)];
const A43 = [0x31, 0xC0];
const PISZ43 = [...Z43, ...D43, ...A43];      // MOVSB/MOVSW/STOSB piszą do bufora
const CZYT43 = [...Z43, ...ZD43, ...A43];     // SCASB/CMPSB/LODSB czytają strefę zer
const POMIARY43 = [
  ['T43 MOVSB, NOP x2, MOV AL,[SI]',     1753.80, 0.5, petla34(PISZ43, [0xA4, NOP, NOP, 0x8A, 0x04])],
  ['T43 MOVSB, NOP x3, MOV AL,[SI]',     1872.89, 0.5, petla34(PISZ43, [0xA4, ...powtorz(3, NOP), 0x8A, 0x04])],
  ['T43 SCASB, NOP, MOV AL,[SI]',        1511.97, 6.5, petla34(CZYT43, [0xAE, NOP, 0x8A, 0x04])],
  ['T43 SCASB, NOP x2, MOV AL,[SI]',     1632.85, 4, petla34(CZYT43, [0xAE, NOP, NOP, 0x8A, 0x04])],
  ['T43 CMPSB, NOP, MOV AL,[SI]',        1782.85, 2, petla34(CZYT43, [0xA6, NOP, 0x8A, 0x04])],
  ['T43 LODSB, MOV AL,[SI]',             1391.36, 0.5, petla34(CZYT43, [0xAC, 0x8A, 0x04])],
  ['T43 LODSB, NOP, MOV AL,[SI]',        1511.13, 6, petla34(CZYT43, [0xAC, NOP, 0x8A, 0x04])],
  ['T43 MOVSB, MOV [DI],AL',             1687.95, 4, petla34(PISZ43, [0xA4, 0x88, 0x05])],
  ['T43 MOVSB, MOV AL,[SI] x2',          1993.19, 3.5, petla34(PISZ43, [0xA4, 0x8A, 0x04, 0x8A, 0x04])],
  ['T43 STOSB, NOP, MOV AL,[SI]',        1511.13, 6, petla34(PISZ43, [0xAA, NOP, 0x8A, 0x04])],
  ['T43 MOVSW, NOP, MOV AX,[SI]',        1993.19, 2, petla34(PISZ43, [0xA5, NOP, 0x8B, 0x04])],
];
const INNER_POMIARY43 = [27, 27, 31, 29, 29, 35, 35, 31, 27, 35, 27];

// TEMPO44: ile bajtów kolejka wnosi w skok i czy położenie NOP-a cokolwiek zmienia.
// Pięć pętli różniących się wyłącznie miejscem NOP-a wróciło z JEDNYM licznikiem
// (50,37 taktu na obrót co do cyfry), a trzy układy dwóch NOP-ów z drugim — sprzętowi
// jest wszystko jedno, gdzie ten bajt stoi, i czy rozkazem łańcuchowym jest STOSB czy
// LODSB. Model rozjeżdża się tylko wtedy, gdy NOP-y stoją MIĘDZY rozkazem łańcuchowym
// a odczytem, i tym bardziej, im jest ich więcej.
//
// Rodzina z rozkazem rejestrowym tuż przed skokiem mierzy to wprost: jeden bajt 50,37,
// dwa bajty 50,52, trzy bajty 54,52. DRUGI BAJT JEST DARMOWY, a trzeci kosztuje równe
// cztery takty - pełny cykl magistrali. Model ma to odwrotnie (drugi +4,93, trzeci
// +3,01), czyli wnosi w skok jeden bajt tam, gdzie sprzęt wnosi dwa.
//
// Bloki 4 i 5 programu powtarzały kształty z TEMPO42 i TEMPO43 i wróciły na tych samych
// wartościach (1511,13 przy INNER 35 wobec 1511,63 przy INNER 33), więc nie ma ich tutaj.
const Z44 = [0xBE, ...w34(Z34)], D44 = [0xBF, ...w34(B34 + 400)], A44 = [0x31, 0xC0];
const RAZ44 = [...Z44, ...D44, ...A44];
const POMIARY44 = [
  ['T44 NOP, STOSB, MOV AL,[SI]',         1511.13, 0.5, petla34(RAZ44, [NOP, 0xAA, 0x8A, 0x04])],
  ['T44 NOP, LODSB, MOV AL,[SI]',         1511.13, 0.5, petla34(RAZ44, [NOP, 0xAC, 0x8A, 0x04])],
  ['T44 LODSB, MOV AL,[SI], NOP',         1511.13, 0.5, petla34(RAZ44, [0xAC, 0x8A, 0x04, NOP])],
  ['T44 NOP, STOSB, MOV AL,[SI], NOP',    1632.34, 0.5, petla34(RAZ44, [NOP, 0xAA, 0x8A, 0x04, NOP])],
  ['T44 NOP x2, STOSB, MOV AL,[SI]',      1632.34, 0.5, petla34(RAZ44, [NOP, NOP, 0xAA, 0x8A, 0x04])],
  ['T44 STOSB, NOP x2, MOV AL,[SI]',      1631.98, 7.5, petla34(RAZ44, [0xAA, NOP, NOP, 0x8A, 0x04])],
  ['T44 STOSB, MOV AL,[SI], MOV AX,imm16', 1635.71, 7.5, petla34(RAZ44, [0xAA, 0x8A, 0x04, 0xB8, 0x34, 0x12])],
  ['T44 STOSB, MOV AL,[SI], XCHG AX,BX',  1511.13, 0.5, petla34(RAZ44, [0xAA, 0x8A, 0x04, 0x93])],
  ['T44 STOSB, MOV AL,[SI], MOV AL,AH',   1515.73, 10, petla34(RAZ44, [0xAA, 0x8A, 0x04, 0x88, 0xE0])],
];
const INNER_POMIARY44 = [35, 35, 35, 31, 31, 33, 31, 35, 33];

// TEMPO45: co rozstrzyga o kolejności wokół rozkazu łańcuchowego, czym mierzy się
// „odległość jeden" i jak daleko sięga nadwyżka za SCAS-em.
//
// KOLEJNOŚĆ, A NIE DŁUGOŚĆ PRACY. `MUL BL` za `STOSB`-em był trafiony co do setnej,
// ale przed nim nie było ani jednego pomiaru. Sprzęt daje przechył +1,96 taktu na
// obieg (z przodu drożej), model −4,83, czyli myli się o +6,79. Na parze `AAD` —
// pracy niemal dwa razy krótszej, 59 taktów wobec 100 — pomyłka wynosi +6,82. Ta sama
// siódemka przy dwukrotnie innej długości pracy zamyka hipotezę, że reszta siedzi
// w napełnianiu kolejki podczas pracy EU: rozstrzyga KOLEJNOŚĆ, nie długość.
//
// ODLEGŁOŚĆ MIERZY SIĘ W BAJTACH KODU, NIE W ROZKAZACH. Ten sam układ
// `MOVSB, <x>, MOV AL,[SI]` z jednym rozkazem o długości 1, 2 i 3 bajtów daje
// +1,10 / +0,09 / +0,09 taktu. Jednobajtowy `XCHG AX,BX` zachowuje się dokładnie jak
// `NOP` (+1,10 obydwa), więc nie chodzi ani o `NOP`-a, ani o liczbę rozkazów —
// nadwyżka żyje dokładnie wtedy, gdy między łańcuchowym a dostępem stoi JEDEN BAJT.
// To zastępuje wcześniejsze „gaśnie z odległością jednego rozkazu" z TEMPO43.
//
// ZA SCAS-em NADWYŻKA NIE GAŚNIE, TYLKO ROŚNIE SCHODKAMI. Po bajtach między `SCASB`
// a dostępem: 0 → +0,11, 1 → +2,11, 2 → +2,11, 3 → +4,08. To ani zanik z odległością
// (tak zachowuje się rodzina MOVS), ani gaśnięcie po takcie na NOP-a, jak czytał to
// TEMPO43 — to schodek dwóch taktów co drugi bajt, i jest nadal nierozłożony.
//
// Blok `MOVSB, NOP, MOV AL,[SI]` powtórzył kształt z TEMPO42 przy innym INNER-ze
// (1631,73 przy 32 wobec 1632,85 przy 27, czyli 0,07%), więc nie ma go tutaj —
// posłużył za kontrolę powtarzalności metody i ją przeszedł.
//
// `BX` idzie opcją, a nie bajtami `mov bl,0` jak w T32: w programie pomiarowym
// zerował go setup bloku, poza mierzoną pętlą, więc doliczenie go do ciała
// dołożyłoby modelowi ustawienia, którego sprzęt w tym pomiarze nie miał.
const Z45 = [0xBE, ...w34(Z34)], D45 = [0xBF, ...w34(B34 + 400)], ZD45 = [0xBF, ...w34(Z34)];
const A45 = [0x31, 0xC0];
const PISZ45 = [...Z45, ...D45, ...A45];      // STOSB/MOVSB piszą do bufora
const CZYT45 = [...Z45, ...ZD45, ...A45];     // SCASB czyta strefę zer
const POMIARY45 = [
  // Ten sam znany blad co `T32 STOSB, MUL BL`, i wyladowal tak jak tamten.
  ['T45 STOSB, MUL BL',                  3080.21, 0.5, petla34(PISZ45, [0xAA, 0xF6, 0xE3]), { bx: 0 }],
  ['T45 MUL BL, STOSB',                  3138.96, 7, petla34(PISZ45, [0xF6, 0xE3, 0xAA]), { bx: 0 }],
  ['T45 STOSB, AAD',                     2776.95, 1.5, petla34(PISZ45, [0xAA, 0xD5, 0x0A])],
  ['T45 AAD, STOSB',                     2838.31, 6.5, petla34(PISZ45, [0xD5, 0x0A, 0xAA])],
  ['T45 MUL BL, NOP, STOSB',             3200.00, 6, petla34(PISZ45, [0xF6, 0xE3, NOP, 0xAA]), { bx: 0 }],
  ['T45 MOVSB, XCHG AX,BX, MOV AL,[SI]', 1632.34, 2.5, petla34(PISZ45, [0xA4, 0x93, 0x8A, 0x04])],
  ['T45 MOVSB, MOV AL,AH, MOV AL,[SI]',  1752.63, 0.5, petla34(PISZ45, [0xA4, 0x88, 0xE0, 0x8A, 0x04])],
  ['T45 MOVSB, MOV AX,imm16, MOV AL,[SI]', 1872.12, 0.5, petla34(PISZ45, [0xA4, 0xB8, 0x34, 0x12, 0x8A, 0x04])],
  ['T45 SCASB, NOP x3, MOV AL,[SI]',     1692.56, 7.5, petla34(CZYT45, [0xAE, ...powtorz(3, NOP), 0x8A, 0x04])],
  ['T45 SCASB, XCHG AX,BX, MOV AL,[SI]', 1511.63, 4.5, petla34(CZYT45, [0xAE, 0x93, 0x8A, 0x04])],
];
const INNER_POMIARY45 = [16, 16, 18, 17, 15, 31, 31, 29, 30, 33];

// TEMPO46: gdzie siedzi siódemka rodziny (A) - w obiegu czy w zaokrąglaniu LOOP-a.
//
// PRZECHYŁ SPRZĘTU NIE ZALEŻY OD ZAMKNIĘCIA PĘTLI. `AAD` przed `STOSB`-em jest droższy
// od `AAD` za nim o +1,99 taktu na obieg przy LOOP-ie i o +1,95 przy `DEC CX / JNZ` -
// ta sama liczba. Z TEMPO45 (`MUL BL` +1,96, `AAD` +2,05) i z parą `IMUL BL` (+1,97)
// daje to PIĘĆ niezależnych pomiarów na +1,97 ± 0,05, przy trzech różnych długościach
// pracy EU (59, 68 i ~80 taktów) i dwóch zamknięciach pętli. Model daje przechył -4,86
// z LOOP-em i -0,97 z JNZ-em; pozostałe 2,92 siedzi w obiegu i jest od zamknięcia niezależne.
// To dzieli pozycję (A) na dwie osobne, mierzalne części.
//
// POPRAWIONE PO WYDANIU 2026-09-17. Pierwsza wersja tego komentarza obarczała te 3,93 taktu
// regułą siatki taktowanego LOOP-a — OBALONE przy ławie. Wyłączenie zaokrąglania przesuwa
// wszystkie cztery wiersze tej rodziny zamknięte LOOP-em o te same +58 taktów bloku (+1,93 na
// obieg) i zostawia przechył identyczny co do setnej: zaokrąglanie daje czołowemu rozkazowi
// następnego obiegu dwa takty, w obu kolejnościach tyle samo, i przechyłu nie wytwarza wcale.
// Nośnikiem jest to, że model liczy taktowany LOOP na 20 taktów, gdy obieg zamykał długi
// rozkaz poza magistralą, i na 16, gdy zamykał go STOSB, a DEC CX / JNZ kosztuje 16 w obu.
// Samo zaokrąglanie ZOSTAJE: zdjęcie go daje 105 wierszy ponad limitem, podłoga na tym, co
// ustawił zrzut kolejki — 14, podłoga na JUMP_LEAD — 78.
//
// CZOŁO OBIEGU NIE GRA ROLI: `NOP, AAD, STOSB` ma resztę -5,89 wobec -5,84 dla samego
// `AAD, STOSB`. Zsunięcie długiego rozkazu z czoła nie zmienia niczego, więc chodzi
// o SĄSIEDZTWO długiego rozkazu i dostępu, nie o miejsce w obiegu.
// DRUGI DŁUGI ROZKAZ DOKŁADA 2,11 taktu, a nie kolejne 5,84 ani zero.
// JEDEN BAJT PRZERWY ODDAJE 0,97 taktu (`AAD, XCHG AX,BX, STOSB`) - dokładnie tyle co
// NOP w TEMPO45, więc przerwa liczy się w BAJTACH, tak jak we wcześniejszej warstwie MOVS.
// ZA ZWYKŁYM ODCZYTEM I ZA `LODSB` nadwyżka też jest, ale mniejsza (-2,91 i -2,03).
//
// Bloki 3 i 4 programu powtórzyły `STOSB, AAD` i `AAD, STOSB`, które są już w zestawie
// jako wiersze T45, więc ich tu nie ma. `STOSB, AAD` wyszło CO DO SETNEJ tak samo
// (2776,95 przy tym samym INNER 18, ten sam licznik 05C3 w obu programach) - to
// najmocniejsza kontrola powtarzalności metody, jaką ten zestaw ma.
const POMIARY46 = [
  ['T46 STOSB, AAD, DEC CX, JNZ',        2894.70, 2.5, petla34(PISZ45, [0xAA, 0xD5, 0x0A], 'jnz')],
  ['T46 AAD, STOSB, DEC CX, JNZ',        2953.14, 5.5, petla34(PISZ45, [0xD5, 0x0A, 0xAA], 'jnz')],
  ['T46 AAD, MOV AL,[SI]',               2896.75, 3.5, petla34(PISZ45, [0xD5, 0x0A, 0x8A, 0x04])],
  ['T46 AAD, LODSB',                     2868.35, 2.5, petla34(PISZ45, [0xD5, 0x0A, 0xAC])],
  ['T46 NOP, AAD, STOSB',                2957.40, 6.5, petla34(PISZ45, [NOP, 0xD5, 0x0A, 0xAA])],
  ['T46 AAD, AAD, STOSB',                4677.28, 5.5, petla34(PISZ45, [0xD5, 0x0A, 0xD5, 0x0A, 0xAA])],
  ['T46 AAD, XCHG AX,BX, STOSB',         2896.75, 5.5, petla34(PISZ45, [0xD5, 0x0A, 0x93, 0xAA])],
  ['T46 IMUL BL, STOSB',                 3439.61, 4.5, petla34(PISZ45, [0xF6, 0xEB, 0xAA]), { bx: 0 }],
  ['T46 STOSB, IMUL BL',                 3380.47, 2.5, petla34(PISZ45, [0xAA, 0xF6, 0xEB]), { bx: 0 }],
];
const INNER_POMIARY46 = [18, 18, 18, 18, 18, 11, 18, 15, 15];

// TEMPO47: OŚ DŁUGOŚCI PRACY JEDNOSTKI WYKONAWCZEJ PRZED ROZKAZEM ŁAŃCUCHOWYM. Licznik
// obrotów siedzi w DX, a pętla zamyka się `DEC DX / JNZ`, żeby CL zostało wolne na liczbę
// przesunięć: `SHL AL,CL` to jedyny rozkaz na tym procesorze, który zmienia czas pracy
// jednostki wykonawczej przy STAŁEJ liczbie bajtów i bez dostępu do pamięci. Praca według
// pomiaru TEMPO7: 12,58 / 24,64 / 40,72 / 56,80 taktu.
//
// PROGU W ZMIERZONYM PRZEDZIALE NIE MA. Nadwyżka nad modelem wynosi +4,87 / +2,98 / +3,09
// / +3,00 taktu na obieg, a przy `AAD` (59 taktów pracy) +2,92 — czyli dopłata stoi już przy
// 12,58 i dalej się nie zmienia. `MOV DI,imm16` (4 takty) jej nie ma, więc próg leży między
// czterema a dwunastoma i pół. To jedyne, co pomiar o progu mówi.
//
// TA SAMA NADWYŻKA PRZY `DEC DX / JNZ`, CO PRZY `LOOP`-ie, więc ramię PRZEDNIE nie może być
// bramkowane taktowanym LOOP-em — inaczej niż ramię tylne, zmierzone tak w TEMPO28-31.
// Sprawdzone przez bramkę: włączenie jej nie zmienia ani jednego z szesnastu liczników.
//
// PUNKT CL=1 WYSTAJE Z PŁASKOWYŻU o około 1,9 taktu i wystaje WYŁĄCZNIE W RAMIENIU TYLNYM
// (+2,06 wobec +0,17 / +0,22 / +0,17 na pozostałych szczeblach). Nierozłożony. Hipoteza
// długości kolejki przy skoku OBALONA dwukrotnie: sondą (1 takt — 35 wierszy ponad limitem,
// 2 — 55, 3 — 62, 4 — 144) oraz śladem, w którym kolejka przyjmuje wartości 1, 2, 3 i 4,
// a anomalny jest tylko szczebel q=3, podczas gdy zmierzony q=2 jest trafiony co do setnej.
const petla47 = (raz, cialo) => [0xBA, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...raz, ...cialo,
  0x4A, 0x75, (256 - (cialo.length + 3)) & 0xFF];            // mov dx,30 ... dec dx / jnz
const SHL47 = [0xD2, 0xE0];                                  // shl al,cl
const CL47 = (k) => [0xB1, k];                               // mov cl,imm8
const POMIARY47 = [
  ['T47 STOSB, SHL AL,CL (CL=1)',        1399.01, 5,   petla47([...PISZ45, ...CL47(1)], [0xAA, ...SHL47])],
  ['T47 SHL AL,CL, STOSB (CL=1)',        1515.35, 3,   petla47([...PISZ45, ...CL47(1)], [...SHL47, 0xAA])],
  ['T47 STOSB, SHL AL,CL (CL=4)',        1817.21, 1,   petla47([...PISZ45, ...CL47(4)], [0xAA, ...SHL47])],
  ['T47 SHL AL,CL, STOSB (CL=4)',        1876.79, 2.5, petla47([...PISZ45, ...CL47(4)], [...SHL47, 0xAA])],
  ['T47 STOSB, SHL AL,CL (CL=8)',        2298.54, 1,   petla47([...PISZ45, ...CL47(8)], [0xAA, ...SHL47])],
  ['T47 SHL AL,CL, STOSB (CL=8)',        2360.05, 2,   petla47([...PISZ45, ...CL47(8)], [...SHL47, 0xAA])],
  ['T47 STOSB, SHL AL,CL (CL=12)',       2782.61, 0.5, petla47([...PISZ45, ...CL47(12)], [0xAA, ...SHL47])],
  ['T47 SHL AL,CL, STOSB (CL=12)',       2842.47, 1.5, petla47([...PISZ45, ...CL47(12)], [...SHL47, 0xAA])],
];
const INNER_POMIARY47 = [34, 34, 28, 28, 22, 22, 18, 18];

// TEMPO48: CZYM ROZKAZ Z PRZODU RÓŻNI SIĘ OD INNEGO — OBIE OŚ PUSTE.
//
// Model liczy WSZYSTKIE TRZY formy przesunięcia identycznie: po dwa bajty, po 26 taktów przy
// CL=4, zero dostępów. Każda różnica pokazana przez sprzęt byłaby więc czystym sygnałem.
// Sprzęt nie pokazał żadnej.
//
// SZEROKOŚĆ WYNIKU NIE RZĄDZI: `SHL AX,CL` dał liczniki CO DO CYFRY takie same jak
// `SHL AL,CL`. Tym samym to, że `AAD`, `MUL` i `IMUL` piszą do AX, było zbiegiem
// okoliczności, a nie ich wspólną własnością.
// REJESTR DOCELOWY NIE RZĄDZI: `SHL BL,CL` też dał te same liczniki, choć `STOSB` nie czyta
// BL, więc zależności danych między rozkazem a dostępem nie ma wcale. Przy CL=1 obie pary
// wyszły `060E` i `0597` — dokładnie tyle samo co para z AL w TEMPO47, osiem cyfr bez różnicy.
// Anomalia CL=1 zostaje więc przy zmianie rejestru (+2,04 wobec +2,06) i nie jest zależnością
// danych.
//
// PRZECHYŁ SPRZĘTU +1,99 dla wszystkich trzech form, przy pracy jednostki wykonawczej 26
// taktów — dotąd najkrótszy zmierzony był 59. Razem z `AAD` (+1,95 i +2,05), `MUL BL` (+1,96)
// i `IMUL BL` (+1,97) daje to OSIEM pomiarów na +1,97 ± 0,05 przy pracy od 26 do 80 taktów
// i dwóch zamknięciach pętli. Przechył sprzętu jest stałą; różnią się wyłącznie reszty modelu.
//
// Cztery układy z tego programu powtórzyły wiersze T47 co do cyfry (i blok `STOSB, AAD`
// po raz czwarty), więc jako nowe punkty nie wchodzą — posłużyły za kontrolę powtarzalności
// i ją przeszły. Tutaj są wyłącznie kształty, których zestaw nie miał.
const SHLAX48 = [0xD3, 0xE0];                                // shl ax,cl
const SHLBL48 = [0xD2, 0xE3];                                // shl bl,cl
const POMIARY48 = [
  ['T48 STOSB, SHL AX,CL (CL=4)',        1817.21, 1,   petla47([...PISZ45, ...CL47(4)], [0xAA, ...SHLAX48])],
  ['T48 SHL AX,CL, STOSB (CL=4)',        1876.79, 2.5, petla47([...PISZ45, ...CL47(4)], [...SHLAX48, 0xAA])],
  ['T48 STOSB, SHL BL,CL (CL=4)',        1817.21, 1,   petla47([...PISZ45, ...CL47(4)], [0xAA, ...SHLBL48]), { bx: 0 }],
  ['T48 SHL BL,CL, STOSB (CL=4)',        1876.79, 2.5, petla47([...PISZ45, ...CL47(4)], [...SHLBL48, 0xAA]), { bx: 0 }],
  ['T48 STOSB, SHL BL,CL (CL=1)',        1399.01, 5,   petla47([...PISZ45, ...CL47(1)], [0xAA, ...SHLBL48]), { bx: 0 }],
  ['T48 SHL BL,CL, STOSB (CL=1)',        1515.35, 3,   petla47([...PISZ45, ...CL47(1)], [...SHLBL48, 0xAA]), { bx: 0 }],
];
const INNER_POMIARY48 = [28, 28, 28, 28, 34, 34];

// --- TEMPO52/53/54 -----------------------------------------------------------
// Trzy programy o jednym pytaniu: ile kosztuje krotki rozkaz stojacy ZA dlugim.
// Bloki proste, bez petli wewnetrznej, w rusztowaniu DEC BP / JNE.
//
// CO ZMIERZONO. Za pelna kolejka rozkaz rejestrowy kosztuje SWOJA PRACE EU i nic
// ponadto: `CLC` 1,93 (tabela 2), `NOP` 3,02 (tabela 3, jeszcze TEMPO3) i
// `MOV AL,imm8` 4,01 (tabela 4). Kazdy nastepny rozkaz z rzedu zjada KREDYT, ktory
// dlugi poprzednik zostawil w kolejce, a po jego wyczerpaniu placi stawke magistralna
// 4,02 na bajt. Kredyt nasyca sie na 7,16 taktu po `AAD` (TEMPO53) i 7,26 (TEMPO54) -
// TO SAMO mimo konsumentow o roznej dlugosci, czyli kredyt jest wielkoscia BAJTOWA
// (okolo 1,8 bajta), nie pozycyjna. Piec blokow powtorzylo sie miedzy programami
// CO DO 0,00 taktu i jako nowe punkty nie wchodza - precedens z T48.
//
// CZEGO MODEL NIE MA, I DLACZEGO NIE ZOSTALO TO NAPRAWIONE W TYM WYDANIU.
// Podloga QUEUE_BYTE liczy kazdy bajt z kolejki po trzy takty i jest zla W OBIE
// STRONY: pierwszemu krotkiemu rozkazowi po dlugim liczy 6 zamiast pracy EU 4
// (za drogo), a k-temu 6 zamiast magistralnych 8,04 (za tanio). Na wierszach
// mieszanych oba bledy sie kasuja - dlatego przemiatanie po JEDNEJ osi, ktorym
// strojono te stala, nie moglo jej ruszyc.
//
// TRZY MECHANIZMY SPRAWDZONE I ODRZUCONE (2026-09-19, po 27 przebiegach zestawu):
//   - plytsza kolejka (QUEUE_MAX=2 bez podlogi): 85 wierszy ponad limitem;
//   - przyciecie qLen po dlugim rozkazie, wzorem REP_QUEUE_LEFT: najlepiej 30;
//   - kredyt zamiast podlogi, tylko dla rozkazow bez dostepu do magistrali: najlepiej 38.
// Trzeci obnaza przyczyne. Najgorszym wierszem jest ZAWSZE ten sam
// `T31 (STOSB, XCHG) x2, LOOP` - 10,65% niezaleznie od WARTOSCI kredytu - a w tym
// wydaniu stoi on na -0,15% przy limicie 0,5%, wiec jest jednym z najciasniej
// trafionych w calym zestawie. Zwrot przy zaokraglaniu petli (floorRefund,
// LOOP_QUEUE_BYTE) liczy sie jako floorQ minus praca, wiec podmiana floorQ zabiera mu
// podstawe. KREDYTU NIE DA SIE WNIESC bez rownoczesnej przerobki zwrotu petli, ktora
// jest osobno zmierzona (TEMPO26-31). To osobne zadanie, nie strojenie stalej.
//
// NAPRAWIONE w modelu regulowym - i nie kredytem. Podloga nie dziala za PELNA kolejka (rozkaz placi tam
// swoja prace), a o tym, kiedy kolejka wysycha, decyduje to, ze dlugi rozkaz nie rusza, zanim
// ma w srodku WSZYSTKIE swoje bajty - patrz A LONG INSTRUCTION DOES NOT START ON HALF ITS
// BYTES w rdzeniu. Zwrot petli zostal nietkniety, bo brama `prevAccessed` trzyma nowa regule
// z dala od rodziny lancuchowej. Nasycone szczeble T53/T54/T55 trafiaja co do 0,15%,
// a z dziesieciu wierszy ze znanym bledem trzy wyladowaly i straznik z nich zszedl.
//
// Nastepnie: rabat przesuniecia z pelnej kolejki (TEMPO57) i siatka skoku (TEMPO58) laduja
// `SHL AL,CL x8 (CL=1)` (+3,90% -> +0,02%) i `AAD x8` (-0,34% -> +0,05%). Rodzina
// `(SHL+MOV) x8` zmienia znak i maleje - +4,42/+1,98/+1,43/+0,99 na +1,90/-0,74/-0,38/-0,37 -
// ale `(SHL+MOV x2) x8 CL=12` sie POGARSZA, z -0,68% na -1,93%: tu przesuniecie za dwoma
// `MOV AL,imm8` dostaje rabat, ktorego sprzet mu nie daje. Nie dopasowane, zapisane.
const AAD52 = [0xD5, 0x0A];
const SHL52 = [0xD2, 0xE0];                                  // shl al,cl
const MOVFF52 = [0xB0, 0xFF];                                // mov al,FF
const CLC52 = [0xF8];                                        // clc, jeden bajt, praca EU 2
const CLI52 = (k) => [0xB1, k];                              // mov cl,imm8
const rzad52 = (n, ile, ...g) =>
  powtorz(n, ...AAD52, ...Array.from({ length: ile }, () => g).flat());
const POMIARY52 = [
  ['T52 SHL AL,CL x8 (CL=1)',                     128.62,  0.3, [...CLI52(1), ...powtorz(8, ...SHL52)]],
  ['T52 (SHL+MOV) x8 (CL=1)',       158.94,  0.5, [...CLI52(1), ...powtorz(8, ...SHL52, ...MOVFF52)]],
  ['T52 SHL AL,CL x8 (CL=4)',                     225.05,  2.5, [...CLI52(4), ...powtorz(8, ...SHL52)]],
  ['T52 (SHL+MOV) x8 (CL=4)',       257.37,  0.5, [...CLI52(4), ...powtorz(8, ...SHL52, ...MOVFF52)]],
  ['T52 SHL AL,CL x8 (CL=8)',                     353.69,    2, [...CLI52(8), ...powtorz(8, ...SHL52)]],
  ['T52 (SHL+MOV) x8 (CL=8)',       385.54,  0.5, [...CLI52(8), ...powtorz(8, ...SHL52, ...MOVFF52)]],
  ['T52 SHL AL,CL x8 (CL=12)',                    482.19,  1.5, [...CLI52(12), ...powtorz(8, ...SHL52)]],
  ['T52 (SHL+MOV) x8 (CL=12)',      514.59,  0.5, [...CLI52(12), ...powtorz(8, ...SHL52, ...MOVFF52)]],
  ['T52 AAD x8',                                  513.28,  0.3, powtorz(8, ...AAD52)],
  ['T52 (AAD+MOV) x8',                            545.39,  0.5, powtorz(8, ...AAD52, ...MOVFF52)],
];
const INNER_POMIARY52 = [413, 274, 234, 182, 149, 128, 107, 98, 105, 95];

const POMIARY53 = [
  ['T53 (AAD+MOV x2) x8',                         584.62,  1.5, powtorz(8, ...AAD52, ...MOVFF52, ...MOVFF52)],
  ['T53 (AAD+MOV x3) x8',                         648.86,  1.5, powtorz(8, ...AAD52, ...MOVFF52, ...MOVFF52, ...MOVFF52)],
  ['T53 (AAD+MOV x4) x8',                         713.38,  0.5, powtorz(8, ...AAD52, ...MOVFF52, ...MOVFF52, ...MOVFF52, ...MOVFF52)],
  ['T53 (AAD+MOV x5) x8',                         777.67,  0.5, powtorz(8, ...AAD52, ...MOVFF52, ...MOVFF52, ...MOVFF52, ...MOVFF52, ...MOVFF52)],
  ['T53 (SHL+MOV x2) x8 CL=12',     560.64,  0.5, [...CLI52(12), ...powtorz(8, ...SHL52, ...MOVFF52, ...MOVFF52)]],
  ['T53 (SHL+MOV x3) x8 CL=12',                   624.96,  1.5, [...CLI52(12), ...powtorz(8, ...SHL52, ...MOVFF52, ...MOVFF52, ...MOVFF52)]],
];
const INNER_POMIARY53 = [89, 83, 75, 69, 94, 87];

const POMIARY54 = [
  ['T54 (AAD+CLC x1) x8',                         527.38,    2, rzad52(8, 1, ...CLC52)],
  ['T54 (AAD+CLC x2) x8',                         545.45,  0.5, rzad52(8, 2, ...CLC52)],
  ['T54 (AAD+CLC x3) x8',                         559.63,    2, rzad52(8, 3, ...CLC52)],
  ['T54 (AAD+CLC x4) x8',                         584.66,  1.5, rzad52(8, 4, ...CLC52)],
  ['T54 (AAD+CLC x5) x8',                         616.87,  0.5, rzad52(8, 5, ...CLC52)],
  ['T54 (AAD+CLC x6) x8',                         649.00,  1.5, rzad52(8, 6, ...CLC52)],
  ['T54 (AAD+CLC x7) x8',                         681.25,    3, rzad52(8, 7, ...CLC52)],
  ['T54 (AAD+CLC x8) x8',                         713.59,  0.5, rzad52(8, 8, ...CLC52)],
  ['T54 CLC x16',                                  86.41,  0.5, powtorz(16, ...CLC52)],
];
const INNER_POMIARY54 = [100, 96, 92, 88, 83, 79, 76, 72, 609];

// --- TEMPO55 -----------------------------------------------------------------
// Ta sama drabina z `NOP`-em: JEDEN bajt jak `CLC`, ale praca EU 3,02 zamiast 1,93. Rozstrzygnal
// pytanie "pojemnosc czy wyscig" na korzysc wyscigu - zakret miedzy k=7 a k=8, kredyt nasycony
// 7,16, czyli ten sam co przy `MOV` i `CLC`. Przy biurku 2026-10-09 wyszlo, skad ta jedna liczba:
// cztery bajty kolejki minus dwa bajty NASTEPNEGO `AAD`, ktory nie rusza bez nich, minus jeden
// takt - patrz A LONG INSTRUCTION DOES NOT START ON HALF ITS BYTES w rdzeniu. Szczebel k=0 to
// `AAD x8`, powtorzony CO DO BAJTU z T52 (0558 czwarty raz), wiec jako punkt nie wchodzi.
// `(AAD+NOP x8)` lezy na samym zakrecie, gdzie model jest najmniej pewny - stad 1%.
const POMIARY55 = [
  ['T55 (AAD+NOP x2) x8',                         559.54,  0.5, rzad52(8, 2, NOP)],
  ['T55 (AAD+NOP x4) x8',                         609.68,  0.5, rzad52(8, 4, NOP)],
  ['T55 (AAD+NOP x5) x8',                         630.89,  0.5, rzad52(8, 5, NOP)],
  ['T55 (AAD+NOP x6) x8',                         655.94,  0.5, rzad52(8, 6, NOP)],
  ['T55 (AAD+NOP x7) x8',                         681.01,  0.5, rzad52(8, 7, NOP)],
  ['T55 (AAD+NOP x8) x8',                         713.19,    1, rzad52(8, 8, NOP)],
  ['T55 (AAD+NOP x10) x8',                        777.67,  0.5, rzad52(8, 10, NOP)],
  ['T55 (AAD+NOP x11) x8',                        809.49,  0.5, rzad52(8, 11, NOP)],
];
const INNER_POMIARY55 = [95, 87, 83, 80, 77, 74, 69, 66];

// --- TEMPO56 -----------------------------------------------------------------
// Czy dlugi rozkaz TUZ ZA SKOKIEM czeka na swoj drugi bajt. Przepowiednie czterech hipotez
// zapisane przed przebiegiem, liczniki modelu zdjete z gotowego .COM. Wszystkie kontrole
// przeszly: piec kotwic, `AAD x8` 0558 PIATY raz, `STOSB, AAD` 05C3 DWUNASTY raz, `NOP x16`
// 86,41, a blok kontrolny `SHL AL,CL, NOP x2` co do jednostki - co przy okazji potwierdza baze
// przesuniecia 9 (przy 8 wychodzi -1,44%).
//
// WERDYKT: za skokiem, ktory sam czekal na swoje bajty, czekaja wszystkie trzy - `AAD`, `SHL`
// i `MUL` (dwa pierwsze co do jednostki licznika). Hipoteza, ze `AAD` czeka, a przesuniecie
// nie - dopasowana przy biurku do wierszy `(SHL CL + A0)` i `(SHL + ES: NOP x2)` - zostala
// OBALONA.
//
// CZEGO MODEL NIE MA. Cztery bloki, w ktorych dlugi rozkaz stoi PO serii dwunastu `NOP`-ow,
// wychodza o 1,5-2 takty za tanio - i to w obu ustawieniach: gdy kolejka od skoku ani razu
// nie byla pelna (model nie kaze wtedy czekac wcale, sprzet czeka okolo dwoch taktow, czyli
// mniej niz pelne piec), i gdy byla (model czeka piec, sprzet o dwa wiecej). Jedna regula,
// ktora wzielaby oba, nie zostala znaleziona: krotsze czekanie przed zapelnieniem laduje
// dwa z nich i psuje `T52 SHL AL,CL x8`, spozniony restart BIU po pelnej kolejce psuje 10-20
// innych wierszy. Stoja wiec jako ZNANY BLAD - straznik dryfu, nie amnestia.
// `MUL BL` (bloki 5 i 8) chce do tego jeszcze okolo taktu.
//
// Potem trzy z czterech wyladowaly (do 0,08%) - brakujace takty nie siedzialy w dlugim
// rozkazie, tylko w tym, gdzie skok konczacy obieg odstawia magistrale (TEMPO57/58). Czwarty,
// `AAD, NOP x12, MUL BL`, stoi na -0,46%: to ten sam takt `MUL`, co w TEMPO57/58.
// Nastepnie wyladowal i on (+0,05) - takt za pusta gorna polowe iloczynu (TEMPO59/60).
const SHL56 = [0xD2, 0xE0];                                  // shl al,cl - CL = 8
const MUL56 = [0xF6, 0xE3];                                  // mul bl    - BL = 0
const NOP56 = (k) => Array(k).fill(NOP);
const POMIARY56 = [
  ['T56 AAD, NOP x12',                            124.62,  0.5, [...AAD52, ...NOP56(12)]],
  ['T56 SHL AL,CL, NOP x12',                      104.53,  0.5, [...SHL56, ...NOP56(12)]],
  ['T56 MUL BL, NOP x12',                         134.64,    1, [...MUL56, ...NOP56(12)]],
  ['T56 NOP x12, AAD',                            132.60,  0.3, [...NOP56(12), ...AAD52]],
  ['T56 NOP x12, SHL AL,CL',                      112.51,  0.3, [...NOP56(12), ...SHL56]],
  ['T56 AAD, NOP x12, MUL BL',                     196.95,  0.3, [...AAD52, ...NOP56(12), ...MUL56]],
  ['T56 AAD, NOP x12, SHL AL,CL',                 166.84,  0.3, [...AAD52, ...NOP56(12), ...SHL56]],
  ['T56 SHL AL,CL, NOP x2',                        68.35,  0.5, [...SHL56, ...NOP56(2)]],
];
const INNER_POMIARY56 = [396, 496, 384, 378, 447, 255, 300, 723];

// --- TEMPO57 -----------------------------------------------------------------
// Czy dwa takty, ktorych modelowi brakowalo w czterech blokach T56, naleza do SKOKU, ktory
// zastaje kolejke pelna, i czy przesuniecie o CL z pelnej kolejki oddaje takt - sobie czy
// nastepnemu rozkazowi. Przepowiednie zapisane przed przebiegiem, liczniki modelu zdjete
// z gotowego .COM. Kontrole przeszly: piec kotwic, `AAD x8` 0558 SZOSTY raz.
//
// WERDYKT: rabat przesuniecia JEST i bierze go SAMO przesuniecie (trzy bloki co do jednostki
// licznika; wersja "takt dla nastepnego rozkazu" chybila w `SHL x2, MOV [DI],AL`). Regula
// "skok z pelna kolejka +2" OBALONA: `AAD, NOP` wyszedl o takt TANSZY od modelu. Zostal wzor
// +2 / -1 / 0 dla zadnego, jednego i dwoch `NOP`-ow przed skokiem - podpis siatki, ktora
// sprawdzil dopiero TEMPO58 (patrz JUMP_GRID_PHASE w rdzeniu).
//
// CZEGO MODEL NIE MA: `MUL BL x2` chce okolo taktu na obieg (to samo co MUL w T58) i
// `MOV AL,[SI], AAD` okolo taktu - obieg z dostepem do pamieci, siatka go nie dotyczy.
// Potem `MUL BL x2` wyladowal (+0,05) - takt za pusta gorna polowe iloczynu przy kazdym
// MUL i takt mniej za drugi MUL w obiegu (TEMPO60).
const LD57 = [0x8A, 0x04];                                   // mov al,[si] - strefa zer
const ST57 = [0x88, 0x05];                                   // mov [di],al - bufor
const POMIARY57 = [
  ['T57 NOP x12, AAD, NOP',                       132.67,  0.5, [...NOP56(12), ...AAD52, NOP]],
  ['T57 NOP x12, AAD, NOP x2',                    136.69,  0.5, [...NOP56(12), ...AAD52, ...NOP56(2)]],
  ['T57 AAD, NOP',                                 84.43,  0.5, [...AAD52, NOP]],
  ['T57 AAD, NOP x2',                              88.42,  0.5, [...AAD52, ...NOP56(2)]],
  ['T57 MUL BL x2',                               164.78,  0.5, [...MUL56, ...MUL56]],
  ['T57 MOV AL,[SI], AAD',           99.50,  0.5, [...LD57, ...AAD52]],
  ['T57 SHL AL,CL x2',                            104.51,  0.5, [...SHL56, ...SHL56]],
  ['T57 SHL x2, NOP x2',                          108.53,  0.5, [...SHL56, ...SHL56, ...NOP56(2)]],
  ['T57 SHL x2, MOV [DI],AL',                     116.56,  0.5, [...SHL56, ...SHL56, ...ST57]],
];
const INNER_POMIARY57 = [370, 362, 570, 560, 305, 500, 477, 452, 420];

// --- TEMPO58 -----------------------------------------------------------------
// Siatka czy liczba bajtow: miedzy dlugim rozkazem a skokiem jeden rozkaz jednobajtowy
// o czasie 2 (`CLC`), 4 (`SAHF`) i 8 (`AAA`) taktow. Siatka ma okres czterech taktow, wiec
// `CLC` nie kosztuje nic, a `SAHF` cztery takty wiecej; regula bajtowa daje obu po -1.
// Przepowiednie pieciu hipotez zapisane przed przebiegiem. Kontrole przeszly: piec kotwic,
// `AAD x8` 0558 SIODMY raz, `NOP x16` 86,41.
//
// WERDYKT: SIATKA. `AAD`, `AAD, CLC`, `AAD, SAHF`, `SHL AL,CL` i `SHL, SAHF` co do jednostki
// licznika; regula bajtowa chybila o 52-67 jednostek, dotychczasowy model o 34-47, siatka przesunieta o takt
// w ktorakolwiek strone o 17-23. Bloki z `SAHF` trafione, wiec czas `SAHF` (4, z tabel
// Intela, nigdzie indziej niezmierzony) jest dobry.
//
// CZEGO MODEL NIE MA. Trzy bloki z `MUL BL` wychodza o TAKT za tanio - takze `MUL, CLC`,
// gdzie siatka nie dziala - a wzor wypelniaczy jest u nich ten sam co u `AAD`, przesunieta
// jest tylko baza. To nie jest czas samego MUL: takt wiecej dla MUL (z zerowym operandem albo
// za rozkazem bez magistrali) psuje `T32/T45 STOSB, MUL BL` i `T57 MUL BL x2` albo osiem
// wierszy `(MOV AL,xx + MUL BL) x4`. `AAD, AAA` tez o takt za tanio, a model pod siatka nie
// czuje czasu `AAA` od 8 do 11 taktow - wiec to tez nie jest po prostu dluzszy `AAA`.
//
// Potem trzy bloki `MUL` wyladowaly (do 0,05) - to byl takt za pusta gorna polowe
// iloczynu (0 x 0), a T32/T45 go nie przeczyly, tylko maskowaly (patrz T32).
const SAHF58 = [0x9E];                                       // sahf, 4 takty
const AAA58 = [0x37];                                        // aaa, 8 taktow (Intel)
const POMIARY58 = [
  ['T58 AAD',                                      84.43,  0.5, [...AAD52]],
  ['T58 AAD, CLC',                                 84.43,  0.5, [...AAD52, ...CLC52]],
  ['T58 AAD, SAHF',                                88.42,  0.5, [...AAD52, ...SAHF58]],
  ['T58 AAD, AAA',                   93.42,  0.5, [...AAD52, ...AAA58]],
  ['T58 SHL AL,CL',                                64.31,  0.5, [...SHL56]],
  ['T58 SHL, SAHF',                                68.33,  0.5, [...SHL56, ...SAHF58]],
  ['T58 MUL BL',                                   94.47,  0.5, [...MUL56]],
  ['T58 MUL, SAHF',                                98.47,  0.5, [...MUL56, ...SAHF58]],
  ['T58 MUL, CLC',                                 94.46,  0.5, [...MUL56, ...CLC52]],
];
const INNER_POMIARY58 = [590, 576, 563, 538, 781, 733, 532, 509, 520];

// --- TEMPO59 -----------------------------------------------------------------
// Skad takt `MUL` z T57/T58: z danych mnozenia czy z ksztaltu obiegu. Operandy ustawia setup
// przed petla (`ax`, `bx`). Przepowiednie czterech hipotez zapisane przed przebiegiem.
// Kontrole przeszly: piec kotwic, `AAD x8` 0558 OSMY raz.
//
// WERDYKT: Z DANYCH. `MUL` z BL=01 przy AL=00/0F/FF i stary ksztalt `MOV AL,xx + MUL BL`
// w jednym egzemplarzu trafione przez model co do jednostki; `MUL` z AL=00 przy BL<>01 - takt
// drozej, ale ten takt nie sumuje sie z taktem za operand 1. Regule rozstrzygnal TEMPO60.
//
// CZEGO MODEL NIE MA: `AAA` bez korekty kosztuje takt WIECEJ niz z korekta, a model pod
// siatka nie da 93 zadnym czasem `AAA` (4-7 daje 88, 8-11 daje 92, 12 i wiecej 96).
const AAA59 = [0x37];                                        // aaa
const POMIARY59 = [
  ['T59 MUL BL=01 AL=00',                          94.44,  0.5, [...MUL56], { ax: 0x0000, bx: 0x01 }],
  ['T59 MUL BL=01 AL=0F',                          98.51,  0.5, [...MUL56], { ax: 0x000F, bx: 0x01 }],
  ['T59 MUL BL=01 AL=FF',                         102.52,  0.5, [...MUL56], { ax: 0x00FF, bx: 0x01 }],
  ['T59 MUL BL=FF AL=00',                          94.47,  0.5, [...MUL56], { ax: 0x0000, bx: 0xFF }],
  ['T59 MOV AL,00 + MUL BL=00',                   102.47,  0.5, [0xB0, 0x00, ...MUL56], { ax: 0x0000, bx: 0x00 }],
  ['T59 MOV AL,FF + MUL BL=FF',                   109.58,  0.5, [0xB0, 0xFF, ...MUL56], { ax: 0x0000, bx: 0xFF }],
  ['T59 MOV AL,01 + MUL BL=FF',                   103.53,  0.5, [0xB0, 0x01, ...MUL56], { ax: 0x0000, bx: 0xFF }],
  ['T59 AAD, AAA AX=0000',           93.45,  0.5, [...AAD52, ...AAA59], { ax: 0x0000 }],
  ['T59 AAD, AAA AX=000A',                         92.47,  0.5, [...AAD52, ...AAA59], { ax: 0x000A }],
];
const INNER_POMIARY59 = [516, 495, 475, 521, 480, 445, 471, 527, 527];

// --- TEMPO60 -----------------------------------------------------------------
// Kiedy `MUL` placi takt. Przepowiednie szesciu hipotez zapisane przed przebiegiem: dane
// (gorna polowa iloczynu zero albo AL=0), lancuch (MUL nie pierwszy w obiegu takt taniej),
// brama (bez taktu po dostepie do pamieci albo w petli LOOP). Kontrole przeszly: piec kotwic,
// `AAD x8` 0558 DZIEWIATY raz, `NOP x16` 86,41.
//
// WERDYKT: takt placi iloczyn z PUSTA GORNA POLOWA (bloki 1-3 co do jednostki, "AL=0" chybilo
// o caly takt), a kazdy MUL po pierwszym w obiegu kosztuje takt mniej (bloki 4-6 co do
// jednostki, takze rozdzielone NOP-ami). Obie bramy OBALONE: `STOSB, MUL` placi.
//
// Potem `MUL` w petli LOOP wyladowal (-0,09) - obrot LOOP bez magistrali placi takt
// (LOOP_QUIET_CLOCK). Zostaje `STOSB, NOP, MUL` - wypelniacz za STOSB (patrz TEMPO61-63).
//
// CZEGO MODEL NIE MA: `MUL` w petli LOOP i `STOSB, NOP, MUL` chca jeszcze takt na obieg ponad
// to - przy `T32 STOSB, MUL BL, LOOP` model jest za to o takt za drogi. To wyglada na czas
// dlugiego rozkazu przy LOOP i za zapisem, nie na `MUL`: rodzina `STOSB, AAD, LOOP` ma
// ten sam takt w druga strone.
const DI60 = [0xBF, ...w34(B34 + 400)];                      // mov di,bufor - co obieg od nowa
const POMIARY60 = [
  ['T60 MOV AL,FF + MUL BL=00',                   110.53,  0.5, [0xB0, 0xFF, ...MUL56], { ax: 0x0000, bx: 0x00 }],
  ['T60 MOV AL,0F + MUL BL=10',                   106.50,  0.5, [0xB0, 0x0F, ...MUL56], { ax: 0x0000, bx: 0x10 }],
  ['T60 MOV AL,0F + MUL BL=20',                   105.51,  0.5, [0xB0, 0x0F, ...MUL56], { ax: 0x0000, bx: 0x20 }],
  ['T60 MUL BL x3',                               235.21,  0.5, [...MUL56, ...MUL56, ...MUL56], { ax: 0x0000, bx: 0x00 }],
  ['T60 MUL, NOP x4, MUL',                        176.85,  0.5, [...MUL56, ...NOP56(4), ...MUL56], { ax: 0x0000, bx: 0x00 }],
  ['T60 (MOV AL,FF + MUL BL=FF) x2',              190.98,  0.5, [0xB0, 0xFF, ...MUL56, 0xB0, 0xFF, ...MUL56], { ax: 0x0000, bx: 0xFF }],
  ['T60 MOV DI, STOSB, MUL',                      116.52,  0.5, [...DI60, 0xAA, ...MUL56], { ax: 0x0000, bx: 0x00 }],
  ['T60 LOOP x30 { MUL }',                        2744.29,  0.5, [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, ...MUL56, 0xE2, 0xFC], { ax: 0x0000, bx: 0x00 }],
  ['T60 MOV DI, STOSB, NOP, MUL',   120.52,  0.5, [...DI60, 0xAA, NOP, ...MUL56], { ax: 0x0000, bx: 0x00 }],
];
const INNER_POMIARY60 = [445, 464, 464, 208, 277, 256, 437, 19, 426];

// --- TEMPO61-63 ---------------------------------------------------------------
// Dlugie rozkazy w petli LOOP x30 (CX=30, SI na strefe zer, DI na bufor, wszystko przed
// petla wewnetrzna) w petli DEC BP / JNE. Trzy programy, przepowiednie hipotez zapisane przed
// kazdym przebiegiem. Kontrole przeszly we wszystkich: piec kotwic, `AAD x8` 0558 po raz
// dziesiaty, jedenasty i dwunasty, `NOP x16` 86,41.
//
// TEMPO61 obalil regule LF z biurka (siatka LOOP przy pelnej kolejce, faza dobrana do starych
// wierszy) i pokazal schodek: kazdy NOP za dlugim rozkazem kosztuje cztery takty. TEMPO62 obalil
// regule "pobieranie celu nie wczesniej niz trzy takty za BIU" i dal czwarty NOP ZA DARMO:
// STOSB, AAD z 0..4 NOP = 92 / 96 / 100 / 104 / 104 - siatka co cztery takty. Model mial ja
// przesunieta o dwa takty. Wczesniejsza siatka skoku (faza 3, wyprzedzenie 3) trafila przy biurku
// wszystkie osiem obrotow drabinek, a TEMPO63 potwierdzil ja na wypelniaczach 2, 3 i 4 takty,
// na MUL i na szesciu NOP-ach (siedem blokow do dwoch jednostek licznika). Obrot LOOP bez
// magistrali placi takt (LOOP_QUIET_CLOCK): potwierdzone na AAD, NOP x3, AAD, AAD i AAD, CLC x2.
//
// CZEGO MODEL NIE MA: wypelniacz miedzy STOSB a dlugim rozkazem kosztuje na sprzecie pelny
// cykl magistrali - STOSB, CLC, AAD tyle co STOSB, AAD, CLC x2 - a model daje mu trzy takty
// (cztery wiersze, takze T60 w DEC/JNE). `AAM` zalezy od danych: (MOV AL,FF + AAM) x4 model
// za tani o takt na AAM, LOOP { AAM } na zerach za drogi o takt.
const L61 = (...c) => [0xB9, 0x1E, 0x00, 0xBE, 0x01, 0x00, 0xBE, ...w34(Z34), 0xBF, ...w34(B34 + 400), ...c, 0xE2, (256 - (c.length + 2)) & 0xFF];
const POMIARY61 = [
  ['T61 LOOP { STOSB, AAD, NOP x2 }', 3007.59, 0.5, L61(0xAA, 0xD5, 0x0A, NOP, NOP), { ax: 0, bx: 0 }],
  ['T61 LOOP { STOSB, AAD, NOP x3 }', 3128.31, 0.5, L61(0xAA, 0xD5, 0x0A, NOP, NOP, NOP), { ax: 0, bx: 0 }],
  ['T61 LOOP { STOSB, NOP x2, AAD }', 3009.67, 0.5, L61(0xAA, NOP, NOP, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T61 LOOP { LODSB, MUL BL }', 3072.00, 0.5, L61(0xAC, 0xF6, 0xE3), { ax: 0, bx: 0 }],
  ['T61 LOOP { STOSB, AAD, STOSB }', 3130.43, 0.5, L61(0xAA, 0xD5, 0x0A, 0xAA), { ax: 0, bx: 0 }],
  ['T61 LOOP { AAD }', 2469.12, 0.5, L61(0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T61 LOOP { AAD, NOP x2 }', 2705.42, 0.5, L61(0xD5, 0x0A, NOP, NOP), { ax: 0, bx: 0 }],
  ['T61 LOOP { MOV AL,[SI], AAD }', 2920.50, 0.5, L61(0x8A, 0x04, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T61 LOOP { NOP, AAD }', 2588.67, 0.5, L61(NOP, 0xD5, 0x0A), { ax: 0, bx: 0 }],
];
const INNER_POMIARY61 = [17, 16, 17, 16, 16, 20, 18, 17, 19];
const POMIARY62 = [
  ['T62 LOOP { STOSB, AAD, NOP x4 }', 3132.70, 0.5, L61(0xAA, 0xD5, 0x0A, NOP, NOP, NOP, NOP), { ax: 0, bx: 0 }],
  ['T62 LOOP { LODSB, AAD, NOP x2 }', 3007.83, 0.5, L61(0xAC, 0xD5, 0x0A, NOP, NOP), { ax: 0, bx: 0 }],
  ['T62 LOOP { STOSB, MUL BL, NOP x2 }', 3307.67, 0.5, L61(0xAA, 0xF6, 0xE3, NOP, NOP), { ax: 0, bx: 0 }],
  ['T62 LOOP { STOSB, MUL BL, NOP }', 3191.69, 0.5, L61(0xAA, 0xF6, 0xE3, NOP), { ax: 0, bx: 0 }],
  ['T62 LOOP { STOSB, NOP, AAD }', 2891.29, 0.5, L61(0xAA, NOP, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T62 LOOP { AAD, NOP x3 }', 2824.83, 0.5, L61(0xD5, 0x0A, NOP, NOP, NOP), { ax: 0, bx: 0 }],
  ['T62 LOOP { AAM }', 2950.30, 0.5, L61(0xD4, 0x0A), { ax: 0, bx: 0 }],
  ['T62 LOOP { AAD, AAD }', 4305.54, 0.5, L61(0xD5, 0x0A, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T62 LOOP { MOV AL,[SI], AAD, NOP x2 }', 3158.33, 0.5, L61(0x8A, 0x04, 0xD5, 0x0A, NOP, NOP), { ax: 0, bx: 0 }],
];
const INNER_POMIARY62 = [15, 16, 15, 15, 17, 18, 17, 12, 16];
const POMIARY63 = [
  ['T63 LOOP { STOSB, AAD, NOP x5 }', 3252.95, 0.5, L61(0xAA, 0xD5, 0x0A, NOP, NOP, NOP, NOP, NOP), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, AAD, NOP x6 }', 3373.66, 0.5, L61(0xAA, 0xD5, 0x0A, NOP, NOP, NOP, NOP, NOP, NOP), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, MUL BL, NOP x4 }', 3433.04, 0.5, L61(0xAA, 0xF6, 0xE3, NOP, NOP, NOP, NOP), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, AAD, CLC }', 2887.44, 0.5, L61(0xAA, 0xD5, 0x0A, 0xF8), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, AAD, CLC x2 }', 2891.29, 0.5, L61(0xAA, 0xD5, 0x0A, 0xF8, 0xF8), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, AAD, CLC x3 }', 3011.76, 0.5, L61(0xAA, 0xD5, 0x0A, 0xF8, 0xF8, 0xF8), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, AAD, SAHF x2 }', 3011.76, 0.5, L61(0xAA, 0xD5, 0x0A, 0x9E, 0x9E), { ax: 0, bx: 0 }],
  ['T63 LOOP { STOSB, CLC, AAD }', 2891.29, 0.5, L61(0xAA, 0xF8, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T63 LOOP { AAD, CLC x2 }', 2588.67, 0.5, L61(0xD5, 0x0A, 0xF8, 0xF8), { ax: 0, bx: 0 }],
];
const INNER_POMIARY63 = [15, 14, 14, 17, 17, 16, 16, 17, 19];

// TEMPO64 (2026-10-11/12): WYPELNIACZ ZA DOSTEPEM I AAM NA ROZNYCH DANYCH. Kontrole: piec kotwic,
// AAD x8 na 0558 po raz trzynasty, NOP x16 86,41.
//
// Wypelniacz miedzy STOSB a dlugim rozkazem: trzy hipotezy zapisane przed przebiegiem trafialy
// cztery stare wiersze tak samo - takt za wypelniacz (SFL), dopelnienie do 4 taktow (SFL4) i SFL
// zaczynany kazdym dostepem (SFLA). Sprzet: STOSB, SAHF, AAD bez doplaty, STOSB, CLC x2, AAD +4,
// STOSB, NOP x3, AAD +3 - SFL4; LODSB, NOP, AAD +1 - SFLA; (STOSB, NOP, AAD) x4 poza LOOP +1 na
// grupe. Polaczenie SFL4 i SFLA (FILLER_PAD) trafia piec blokow do jednej jednostki licznika.
//
// AAM: trzy hipotezy (77 + jedynki ilorazu + 2, gdy iloraz niezerowy / reszta niezerowa / bit 7
// dzielnej) - WSZYSTKIE OBALONE, kazda chybia dwa bloki z czterech o dwa takty. Sprzet: AL=07 77,
// AL=50 78, AL=0B 80, AL=A0 78. Po fakcie pasuja dwie reguly: +2 przy NIEPARZYSTYM ilorazie albo +2,
// gdy iloraz i reszta sa oba niezerowe; obie trafiaja tez cztery stare wiersze AAM. Do TEMPO65 -
// do tego czasu cztery wiersze ze znanym bledem.
const POMIARY64 = [
  ['T64 LOOP { STOSB, NOP x3, AAD }', 3130.43, 0.5, L61(0xAA, NOP, NOP, NOP, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T64 LOOP { STOSB, SAHF, AAD }', 2890.84, 0.5, L61(0xAA, 0x9E, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T64 LOOP { STOSB, CLC x2, AAD }', 3011.76, 0.5, L61(0xAA, 0xF8, 0xF8, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T64 LOOP { LODSB, NOP, AAD }', 2891.29, 0.5, L61(0xAC, NOP, 0xD5, 0x0A), { ax: 0, bx: 0 }],
  ['T64 MOV DI, (STOSB, NOP, AAD) x4', 339.68, 0.5, [...DI60, ...powtorz(4, 0xAA, NOP, 0xD5, 0x0A)], { ax: 0, bx: 0 }],
  ['T64 (MOV AL,07 + AAM) x4 (iloraz 0, reszta 7)', 352.73, 0.5, powtorz(4, 0xB0, 0x07, 0xD4, 0x0A)],
  ['T64 (MOV AL,50 + AAM) x4 (iloraz 8, reszta 0)', 356.79, 0.5, powtorz(4, 0xB0, 0x50, 0xD4, 0x0A)],
  ['T64 (MOV AL,0B + AAM) x4 (iloraz 1, reszta 1)', 364.70, 0.5, powtorz(4, 0xB0, 0x0B, 0xD4, 0x0A)],
  ['T64 (MOV AL,A0 + AAM) x4 (iloraz 16, reszta 0)', 356.79, 0.5, powtorz(4, 0xB0, 0xA0, 0xD4, 0x0A)],
];
const INNER_POMIARY64 = [16, 16, 16, 17, 150, 140, 140, 140, 140];

// TEMPO65 (2026-10-12): AAM I AAA/AAS. Kontrole: piec kotwic, AAD x8 na 0558 po raz czternasty,
// NOP x16 86,41.
//
// AAM: dwie reguly z TEMPO64 (po fakcie) rozdzielone przed przebiegiem - +2 przy NIEPARZYSTYM
// ilorazie (QO) albo gdy iloraz i reszta sa oba niezerowe (QR). QO cztery bloki z czterech co do
// jednostki, QR o dwa takty obok w kazdym; AL=1F (obie rowne) trafiony.
//
// AAA i AAS strumieniem x8, gdzie ich czas jest krytyczny: bez korekty (ADD AL,0 przy AL=05) takt
// wiecej niz z korekta (MOV AL,0A) - dla obu (KS, zapisane przed przebiegiem). Grupy Z KOREKTA
// model ma o dwa takty za drogie, a zaden calkowity koszt AAA ich nie trafia (7 za tani, 8 za
// drogi) - to nie koszt wlasny rozkazu; znany blad.
const POMIARY65 = [
  ['T65 (MOV AL,0A + AAM) x4 (iloraz 1)', 364.70, 0.5, powtorz(4, 0xB0, 0x0A, 0xD4, 0x0A)],
  ['T65 (MOV AL,15 + AAM) x4 (iloraz 2, reszta 1)', 356.79, 0.5, powtorz(4, 0xB0, 0x15, 0xD4, 0x0A)],
  ['T65 (MOV AL,1E + AAM) x4 (iloraz 3)', 368.79, 0.5, powtorz(4, 0xB0, 0x1E, 0xD4, 0x0A)],
  ['T65 (MOV AL,29 + AAM) x4 (iloraz 4, reszta 1)', 356.79, 0.5, powtorz(4, 0xB0, 0x29, 0xD4, 0x0A)],
  ['T65 (MOV AL,1F + AAM) x4 (iloraz 3, reszta 1)', 368.79, 0.5, powtorz(4, 0xB0, 0x1F, 0xD4, 0x0A)],
  ['T65 ADD AL,0 + AAA x8 (AL=05, bez korekty)', 101.49, 0.5, [0x04, 0x00, ...powtorz(8, 0x37)], { ax: 0x0005 }],
  ['T65 MOV AL,0A + AAA x8 (korekta)', 93.46, 0.5, [0xB0, 0x0A, ...powtorz(8, 0x37)], { ax: 0x000A }],
  ['T65 ADD AL,0 + AAS x8 (AL=05, bez korekty)', 101.49, 0.5, [0x04, 0x00, ...powtorz(8, 0x3F)], { ax: 0x0005 }],
  ['T65 MOV AL,0A + AAS x8 (korekta)', 93.46, 0.5, [0xB0, 0x0A, ...powtorz(8, 0x3F)], { ax: 0x000A }],
];
const INNER_POMIARY65 = [140, 140, 140, 140, 140, 520, 520, 520, 520];

// TEMPO66 (2026-10-12): KIEDY OBROT DEC BP / JNE ZAOKRAGLA SIE DO SIATKI SKOKU. Kontrole: piec
// kotwic, AAD x8 na 0558 po raz pietnasty, NOP x16 86,41, powtorka T65 MOV AL,0A + AAA x8 05ED.
//
// G (zapisane przed przebiegiem): siatka tylko w obrocie z dlugim rozkazem. AAA x4 i x6 z korekta,
// x5 bez korekty i powtorka T65 - cztery bloki co do jednostki, R o 20-47 obok. AAA x2, CWD x4
// wyszlo w polowie miedzy R a G (o takt od kazdej) - ale tam AAA z korekta podnosi AH o dwa na
// obrot, wiec znak AX, a z nim CWD, zmienia sie w trakcie pomiaru; znany blad.
//
// AQ (jalowy takt AAA po siatce) OBALONE: AAD, ADD AL,0, AAA bez korekty sprzet o takt TANSZY niz
// z korekta (95,48 wobec 96,45) - odwrotnie niz AAD, AAA z T59 - i tak samo w (AAD, ADD AL,0, AAA)
// x2 i MUL BL, ADD AL,0, AAA. Otwarte; znane bledy.
const POMIARY66 = [
  ['T66 MOV AL,0A + AAA x4 (korekta)', 61.29, 0.5, [0xB0, 0x0A, ...powtorz(4, 0x37)], { ax: 0x000A }],
  ['T66 MOV AL,0A + AAA x6 (korekta)', 77.37, 0.5, [0xB0, 0x0A, ...powtorz(6, 0x37)], { ax: 0x000A }],
  ['T66 ADD AL,0 + AAA x5 (AL=05, bez korekty)', 74.35, 0.5, [0x04, 0x00, ...powtorz(5, 0x37)], { ax: 0x0005 }],
  ['T66 MOV AL,0A + AAA x2, CWD x4', 66.33, 0.5, [0xB0, 0x0A, 0x37, 0x37, ...powtorz(4, 0x99)], { ax: 0x000A }],
  ['T66 AAD, ADD AL,0, AAA (bez korekty)', 95.48, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x37], { ax: 0x0005 }],
  ['T66 AAD, ADD AL,0, AAA (korekta)', 96.45, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x37], { ax: 0x000A }],
  ['T66 (AAD, ADD AL,0, AAA) x2 (bez korekty)', 169.83, 0.5, powtorz(2, 0xD5, 0x0A, 0x04, 0x00, 0x37), { ax: 0x0005 }],
  ['T66 MUL BL, ADD AL,0, AAA (bez korekty)', 105.49, 0.5, [0xF6, 0xE3, 0x04, 0x00, 0x37], { ax: 0x0000, bx: 0x00 }],
];
const INNER_POMIARY66 = [810, 640, 670, 740, 520, 520, 290, 480];

// TEMPO67-69 (2026-10-12): CWD, AAA ZA DLUGIM ROZKAZEM I STRUMIENIE JEDNOBAJTOWE PO SKOKU. Kontrole
// we wszystkich trzech: piec kotwic, AAD x8 na 0558 po raz 16., 17. i 18., NOP x16 86,41; powtorka
// CWD x8 z T67 w T69 znowu 0619.
//
// LAHF, SAHF i CBW w strumieniu po skoku - model co do jednostki. CWD NIE: na dodatnim AX x2 / x4 /
// x6 / x8 kosztuje 30,16 / 38,21 / 50,26 / 58,31 (model 31 / 41 / 51 / 61), na ujemnym nieregularnie
// drozej. Zaden calkowity koszt CWD tego nie trafia (5 chca stare wiersze za STOSB, strumienie mniej),
// nie trafia tez regula zalezna od kolejki - otwarte, znane bledy.
//
// AAA za AAD, ADD AL,0: bez korekty minus z korekta na sprzecie -1 (x1, T66), +4 (NOP, AAA - model
// to ma), 0 (NOP x2), +2 (x2), +3 (x3), 0 (x4). Regula "jalowy takt po siatce" trafia x2-x4,
// chybia reszte - otwarte, znane bledy tam, gdzie model chybia.
const POMIARY67 = [
  ['T67 CWD x8 (AX=0005)', 58.31, 0.5, powtorz(8, 0x99), { ax: 0x0005 }],
  ['T67 CWD x8 (AX=8005)', 67.27, 0.5, powtorz(8, 0x99), { ax: 0x8005 }],
  ['T67 MOV AX,000A + AAA x2 + CWD x4', 69.33, 0.5, [0xB8, 0x0A, 0x00, 0x37, 0x37, ...powtorz(4, 0x99)], { ax: 0x000A }],
  ['T67 AAD, ADD AL,0, NOP, AAA (bez korekty)', 100.45, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x90, 0x37], { ax: 0x0005 }],
  ['T67 AAD, ADD AL,0, NOP, AAA (korekta)', 96.5, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x90, 0x37], { ax: 0x000A }],
  ['T67 AAD, ADD AL,0, NOP x2, AAA (bez korekty)', 100.47, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x90, 0x90, 0x37], { ax: 0x0005 }],
  ['T67 AAD, ADD AL,0, NOP x2, AAA (korekta)', 100.47, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x90, 0x90, 0x37], { ax: 0x000A }],
  ['T67 AAD, ADD AL,0, AAA x3 (bez korekty)', 115.56, 0.5, [0xD5, 0x0A, 0x04, 0x00, ...powtorz(3, 0x37)], { ax: 0x0005 }],
  ['T67 AAD, ADD AL,0, AAA x3 (korekta)', 112.53, 0.5, [0xD5, 0x0A, 0x04, 0x00, ...powtorz(3, 0x37)], { ax: 0x000A }],
];
const INNER_POMIARY67 = [810, 810, 720, 500, 500, 485, 485, 440, 440];
const POMIARY68 = [
  ['T68 CWD x2 (AX=0005)', 30.16, 0.5, powtorz(2, 0x99), { ax: 0x0005 }],
  ['T68 CWD x2 (AX=8005)', 30.16, 0.5, powtorz(2, 0x99), { ax: 0x8005 }],
  ['T68 CWD x4 (AX=0005)', 38.21, 0.5, powtorz(4, 0x99), { ax: 0x0005 }],
  ['T68 CWD x4 (AX=8005)', 42.2, 0.5, powtorz(4, 0x99), { ax: 0x8005 }],
  ['T68 CWD x6 (AX=8005)', 57.24, 0.5, powtorz(6, 0x99), { ax: 0x8005 }],
  ['T68 AAD, ADD AL,0, AAA x2 (bez korekty)', 106.52, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x37, 0x37], { ax: 0x0005 }],
  ['T68 AAD, ADD AL,0, AAA x2 (korekta)', 104.49, 0.5, [0xD5, 0x0A, 0x04, 0x00, 0x37, 0x37], { ax: 0x000A }],
  ['T68 AAD, ADD AL,0, AAA x4 (bez korekty)', 124.62, 0.5, [0xD5, 0x0A, 0x04, 0x00, ...powtorz(4, 0x37)], { ax: 0x0005 }],
  ['T68 AAD, ADD AL,0, AAA x4 (korekta)', 120.63, 0.5, [0xD5, 0x0A, 0x04, 0x00, ...powtorz(4, 0x37)], { ax: 0x000A }],
];
const INNER_POMIARY68 = [1600, 1600, 1200, 1200, 970, 480, 480, 400, 400];
const POMIARY69 = [
  ['T69 LAHF x2', 30.16, 0.5, powtorz(2, 0x9F), { ax: 0x0005 }],
  ['T69 LAHF x4', 38.2, 0.5, powtorz(4, 0x9F), { ax: 0x0005 }],
  ['T69 LAHF x8', 54.31, 0.5, powtorz(8, 0x9F), { ax: 0x0005 }],
  ['T69 SAHF x4', 38.2, 0.5, powtorz(4, 0x9E), { ax: 0x0005 }],
  ['T69 SAHF x8', 54.28, 0.5, powtorz(8, 0x9E), { ax: 0x0005 }],
  ['T69 CBW x4', 38.2, 0.5, powtorz(4, 0x98), { ax: 0x0005 }],
  ['T69 CBW x8', 54.29, 0.5, powtorz(8, 0x98), { ax: 0x0005 }],
  ['T69 CWD x6 (AX=0005)', 50.26, 0.5, powtorz(6, 0x99), { ax: 0x0005 }],
];
const INNER_POMIARY69 = [1600, 1250, 850, 1250, 850, 1250, 900, 1000];

const WSZYSTKIE = [POMIARY, POMIARY3, POMIARY4, POMIARY5, POMIARY6, POMIARY7,
                   POMIARY8, POMIARY9, POMIARY10, POMIARY11, POMIARY12,
                   POMIARY13, POMIARY14, POMIARY15, POMIARY16, POMIARY17,
                   POMIARY18, POMIARY19, POMIARY20, POMIARY21, POMIARY22,
                   POMIARY23, POMIARY24, POMIARY25, POMIARY26, POMIARY27, POMIARY28,
                   POMIARY29, POMIARY30, POMIARY31, POMIARY32, POMIARY33, POMIARY34, POMIARY35, POMIARY36, POMIARY37, POMIARY38, POMIARY39, POMIARY40, POMIARY41, POMIARY42, POMIARY43, POMIARY44, POMIARY45, POMIARY46, POMIARY47, POMIARY48, POMIARY52, POMIARY53, POMIARY54, POMIARY55, POMIARY56, POMIARY57, POMIARY58, POMIARY59, POMIARY60, POMIARY61, POMIARY62, POMIARY63, POMIARY64, POMIARY65, POMIARY66, POMIARY67, POMIARY68, POMIARY69];
const WSZYSTKIE_INNER = [INNER_POMIARY, INNER_POMIARY3, INNER_POMIARY4,
                         INNER_POMIARY5, INNER_POMIARY6, INNER_POMIARY7,
                         INNER_POMIARY8, INNER_POMIARY9,
                         INNER_POMIARY10, INNER_POMIARY11, INNER_POMIARY12,
                         INNER_POMIARY13, INNER_POMIARY14, INNER_POMIARY15,
                         INNER_POMIARY16, INNER_POMIARY17,
                         INNER_POMIARY18, INNER_POMIARY19,
                         INNER_POMIARY20, INNER_POMIARY21,
                         INNER_POMIARY22, INNER_POMIARY23, INNER_POMIARY24,
                         INNER_POMIARY25, INNER_POMIARY26, INNER_POMIARY27,
                         INNER_POMIARY28, INNER_POMIARY29, INNER_POMIARY30,
                         INNER_POMIARY31, INNER_POMIARY32, INNER_POMIARY33, INNER_POMIARY34,
                         INNER_POMIARY35, INNER_POMIARY36, INNER_POMIARY37,
                         INNER_POMIARY38, INNER_POMIARY39, INNER_POMIARY40, INNER_POMIARY41,
                         INNER_POMIARY42, INNER_POMIARY43, INNER_POMIARY44,
                         INNER_POMIARY45, INNER_POMIARY46, INNER_POMIARY47, INNER_POMIARY48, INNER_POMIARY52, INNER_POMIARY53, INNER_POMIARY54, INNER_POMIARY55, INNER_POMIARY56, INNER_POMIARY57, INNER_POMIARY58, INNER_POMIARY59, INNER_POMIARY60, INNER_POMIARY61, INNER_POMIARY62, INNER_POMIARY63, INNER_POMIARY64, INNER_POMIARY65, INNER_POMIARY66, INNER_POMIARY67, INNER_POMIARY68, INNER_POMIARY69];
WSZYSTKIE.forEach((grupa, i) => {
  if (grupa.length !== WSZYSTKIE_INNER[i].length) {
    throw new Error(`grupa ${i}: ${grupa.length} bloków, ${WSZYSTKIE_INNER[i].length} INNER-ów`);
  }
});

const LIMIT_WIERSZA = 0.5;
console.log('blok                                sprzęt     model    różnica   limit');

let suma = 0, ile = 0;
for (const [g, grupa] of WSZYSTKIE.entries()) {
  for (const [k, [nazwa, cel, limit, cialo, opcje]] of grupa.entries()) {
    // Model biegnie gołą pętlą, sprzęt biegł w rusztowaniu — więc model dostaje
    // tę część rusztowania, która przypadała na jeden obieg.
    const got = obieg(cialo, { powtorzen: cel > 500 ? 60 : 400, ...opcje })
              + NARZUT / WSZYSTKIE_INNER[g][k];
    const blad = (got / cel - 1) * 100;
    // ZNANY BLAD: wiersz, ktorego model dzis NIE trafia, a pomiar jest pewny.
    // Pilnowany jest wtedy DRYF od zapamietanej liczby, a nie zgodnosc z zerem - wiec
    // limit zostaje ciasny, prawdziwy blad widac na ekranie, a kazda zmiana modelu,
    // ktora te wiersze ruszy, wywali kontrole i zmusi do zaktualizowania zapamietanych
    // liczb. To straznik regresji, nie amnestia. Patrz naglowek przy POMIARY52.
    const znany = opcje && opcje.znane !== undefined ? opcje.znane : null;
    // KAZDY WIERSZ MA LIMIT 0,5%. Limity zapisane przy wierszach (do 8,5%) byly
    // skrojone pod bledy dawnego modelu regul; rdzen przeniesiony z MartyPC trafia
    // 644 z 647 pomiarow w 0,5%, a pozostale trzy stoja jako znane bledy. Wezszy z dwoch
    // limitow, wiec nic sie tu nie luzuje.
    const lim = znany === null ? Math.min(limit, LIMIT_WIERSZA) : limit;
    suma += blad * blad; ile++;
    check(`${nazwa.padEnd(34)} ${cel.toFixed(2).padStart(8)}  ${got.toFixed(2).padStart(8)}  ` +
          `${(blad >= 0 ? '+' : '') + blad.toFixed(2)}%`.padStart(9) + `  ±${lim}%`,
      znany === null ? Math.abs(blad) <= lim : Math.abs(blad - znany) <= lim);
  }
}

console.log(`
RMS na ${ile} pomiarach ze sprzętu: ${Math.sqrt(suma / ile).toFixed(2)}%`);

// Osobno, bo to nie jest kształt kodu tylko własność samego licznika: dwa bloki
// „nic" w każdym programie muszą wyjść identycznie, i tak samo musi być tutaj.
{
  const a = obieg([]), b = obieg([]);
  check('ta sama pętla zmierzona dwa razy daje to samo', a === b, `${a} i ${b}`);
}

console.log(fails ? `\n${fails} kontroli nie przeszło` : '\nwszystkie kontrole przeszły');
process.exit(fails ? 1 : 0);
