// Wierność układu LCD: jeden próg, dwa skutki.
//
// Prawdziwy HD61830 dzieli pamięć obrazu z odświeżaniem panelu i po zapisie
// danych potrzebuje chwili. Dostęp, który przyjdzie za wcześnie, jest źle
// obsłużony — a **co się wtedy stanie, zależy od tego, co przyszło**:
//
//   zapis danych za wcześnie       bajt przepada, licznik adresu stoi, więc
//                                  wiersz się urywa zamiast dziurawić
//   zapis instrukcji za wcześnie   łapie bajt jeszcze w locie i wciąga go do
//                                  rejestru **sterowania trybem**, gasząc te
//                                  jego bity, które bajt trzyma nisko; pamięć
//                                  obrazu zostaje nietknięta, i tak jest aż do
//                                  ponownego zaprogramowania układu
//
// Który to rejestr, ustalono dziesięcioma przeniesieniami na sprzęt, i przez
// pierwsze dziewięć było to opisane błędnie — jako przewrócenie liczby znaków
// w wierszu, zrekonstruowane z szerokości ocalałego skrawka. Przepisanie liczby
// znaków nie naprawia nic; przepisanie sterowania trybem naprawia od ręki.
// Z ośmiu bajtów trzymających nisko dokładnie jeden bit szkodzą tylko dwa:
// bit 1 (tryb graficzny — panel czyta pamięć jak kody znaków i robi się biały
// z pasem po prawej) i bit 5 (wyświetlanie — panel gaśnie). FFh nie trzyma
// nisko niczego i jest nieszkodliwy.
//
// Reguła jest jednostronna: liczy się wyłącznie to, co przychodzi PO zapisie
// danych. Dostęp wciśnięty tuż przed bajtem jest niegroźny — `GAPTEST` kładzie
// instrukcję 39 cykli przed każdym bajtem, czyli poniżej progu, i wraca czysty
// z czterech ekranów. Zapis danych jako jedyny sięga do zewnętrznego SRAM-u,
// więc tylko po nim jest z czego dochodzić do siebie.
//
// Próg 50 cykli jest zmierzony na sprzęcie: piąty ekran `STEPTEST` gubi bajty,
// szósty już nie, po sześć uruchomień w każdą stronę. Sama obserwacja nie
// drgnęła od początku; zmieniała się miarka, którą ją przeliczamy. Te dwa ekrany
// wypadały 43 i 49 cykli od siebie, kiedy tabela instrukcji szła bez poprawek,
// 51 i 59 po doliczeniu ośmiobitowej magistrali, 46 i 54, gdy kolejkę rozkazów
// zaczęto symulować, a 48 i 56 w dawnym modelu regułowym i w rdzeniu co do taktu
// (wyprowadzone od nowa przy jego wejściu). Stąd 50 — i stąd reguła: przy
// każdej zmianie modelu cykli próg trzeba wyprowadzić ze STEPTEST od nowa.

import { HD61830, RAM_ACCESS_CYCLES, SCREEN_W, SCREEN_H } from '../../js/emu/hd61830.js';

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  if (!ok) fails++;
};

// Świeży układ w trybie graficznym Portfolio, tak jak ustawia go każdy program.
function nowy({ threshold = false, seed = 0x2B7E } = {}) {
  const l = new HD61830(new Uint8Array(0x5C0), () => 0);
  const ustaw = (ir, v) => { l.controlWrite(ir, 0); l.dataWrite(v, 0); };
  ustaw(0x00, 0x12);
  ustaw(0x01, 0x07); ustaw(0x02, 0x1D); ustaw(0x03, 0x3F); ustaw(0x04, 0x07);
  ustaw(0x08, 0x00); ustaw(0x09, 0x00);
  ustaw(0x00, 0x32);
  l.setTiming({ threshold, seed });
  return l;
}

function ustawAdres(lcd, adres, now) {
  lcd.controlWrite(0x0A, now); lcd.dataWrite(adres & 0xFF, now);
  lcd.controlWrite(0x0B, now); lcd.dataWrite((adres >> 8) & 0x07, now);
  lcd.controlWrite(0x0C, now);
}

// Pisze `ile` bajtów co `odstep` cykli i zwraca, ile układ przyjął — licznik
// adresu rusza się wyłącznie po przyjętym zapisie, więc sam jest odpowiedzią.
function seria(lcd, ile, odstep, start = 100000) {
  ustawAdres(lcd, 0, start);
  let t = start;
  for (let i = 0; i < ile; i++) { lcd.dataWrite(0xFF, t); t += odstep; }
  return lcd.cac;
}

// --- 1. domyślnie nic się nie zmienia ---------------------------------------

{
  const lcd = nowy();
  check('świeży układ bierze wszystko, choćby co 5 cykli', seria(lcd, 30, 5) === 30,
        `przyjęte ${lcd.cac} z 30`);
}

// --- 2. próg: 51 cykli gubi, 59 nie -----------------------------------------

{
  const a = nowy({ threshold: true });
  const b = nowy({ threshold: true });
  const przy46 = seria(a, 30, 46);
  const przy54 = seria(b, 30, 54);
  check('co 46 cykli przechodzi co drugi bajt', przy46 === 15, `przyjęte ${przy46} z 30`);
  check('co 54 cykle przechodzi wszystko', przy54 === 30, `przyjęte ${przy54} z 30`);
  check('próg to zadeklarowane 50 cykli', RAM_ACCESS_CYCLES === 50, `${RAM_ACCESS_CYCLES}`);

  // Powyżej progu nie ginie nic, i to jest zmierzone, a nie założone.
  // `LOSS.COM` przepędził dziewięć odstępów od 54 do 419 cykli, po dwa przebiegi,
  // razem 34 560 bajtów — ani jednego ząbka. Wcześniejsza obserwacja mówiła
  // o gubieniu 0,6% także przy bezpiecznym odstępie i była w tym pliku zapisana
  // jako znana rozbieżność z emulatorem; nie potwierdziła się. Przy 0,6%
  // wypadłoby 207 ząbków. Reguła trzech daje górne ograniczenie 0,0087%,
  // czyli mniej niż jeden bajt na jedenaście tysięcy — o rząd wielkości mniej
  // niż to, czego emulatorowi brakowało.
  let zgubione = 0;
  for (const odstep of [54, 75, 99, 131, 171, 227, 291, 419]) {
    const lcd = nowy({ threshold: true });
    if (seria(lcd, 200, odstep) !== 200) zgubione++;
  }
  check('powyżej progu nie ginie nic, w całym zmierzonym zakresie odstępów',
        zgubione === 0, zgubione ? `${zgubione} z ośmiu odstępów gubi bajty` : '');
}

// --- 3. strata jest ogonem wiersza, nie sitem -------------------------------

{
  const lcd = nowy({ threshold: true });
  lcd.vram.fill(0x00);
  ustawAdres(lcd, 0, 100000);
  let t = 100000;
  for (let i = 0; i < 30; i++) { lcd.dataWrite(0xFF, t); t += 46; }
  const wzor = [...lcd.vram.subarray(0, 30)].map((b) => (b === 0xFF ? 1 : 0));
  const granica = wzor.indexOf(0);
  const zwarty = granica > 0 && wzor.slice(granica).every((b) => b === 0);
  check('to, co przeszło, leży zwartym ciągiem od lewej', zwarty,
        `granica na bajcie ${granica}, wzór ${wzor.join('')}`);
}

// --- 4. reguła jest jednostronna --------------------------------------------
// Instrukcja 39 cykli PRZED bajtem — jak w GAPTEST — nie szkodzi niczemu.

{
  const lcd = nowy({ threshold: true });
  ustawAdres(lcd, 0, 100000);
  let t = 100000;
  for (let i = 0; i < 30; i++) {
    lcd.controlWrite(0x0C, t);          // instrukcja
    lcd.dataWrite(0xFF, t + 39);        // bajt 39 cykli później
    t += 100;                           // następna instrukcja 61 cykli po bajcie
  }
  check('instrukcja tuż PRZED bajtem nie szkodzi', lcd.cac === 30 && lcd.hn === 30,
        `przyjęte ${lcd.cac} z 30, hn = ${lcd.hn}`);
}

// --- 5. instrukcja tuż PO bajcie wciąga bajt do sterowania trybem -----------
// Wartość bajtu decyduje, co zgaśnie — i czy cokolwiek zgaśnie.

function bombarduj(wartosc, seed = 0x1234, ile = 300) {
  const lcd = nowy({ threshold: true, seed });
  ustawAdres(lcd, 0, 100000);
  let t = 100000;
  for (let i = 0; i < ile; i++) {
    lcd.dataWrite(wartosc, t);
    lcd.controlWrite(0x0C, t + 35);     // 35 cykli po bajcie, jak DEMOCOPY
    t += 200;
  }
  return lcd;
}

{
  const a = bombarduj(0xFD);            // bit 1 nisko: tryb graficzny
  check('bajt z niskim bitem 1 gasi tryb graficzny',
        (a.mcr & 0x02) === 0 && (a.mcr & 0x20) !== 0, `mcr = ${a.mcr.toString(16)}`);

  const b = bombarduj(0xDF);            // bit 5 nisko: wyświetlanie
  check('bajt z niskim bitem 5 gasi wyświetlanie',
        (b.mcr & 0x20) === 0 && (b.mcr & 0x02) !== 0, `mcr = ${b.mcr.toString(16)}`);

  const c = bombarduj(0xFF);            // nic nie trzyma nisko
  check('bajt FFh nie gasi ani trybu, ani wyświetlania',
        (c.mcr & 0x22) === 0x22, `mcr = ${c.mcr.toString(16)}`);

  const d = bombarduj(0xFB);            // bit 2: kursor, niewidoczny w grafice
  check('bajty poza bitami 1 i 5 nie ruszają obrazu',
        (d.mcr & 0x22) === 0x22, `mcr = ${d.mcr.toString(16)}`);
}

// --- 6. pamięć obrazu zostaje nietknięta, a przeprogramowanie naprawia ------
// To jest dokładnie ekran 3 z REGTEST: ten sam pasek wraca cały i pełnej
// szerokości, gdy tylko tryb zostanie ustawiony od nowa.

{
  const lcd = nowy({ threshold: true });
  lcd.vram.fill(0xFF);
  ustawAdres(lcd, 0, 100000);
  let t = 100000;
  for (let i = 0; i < 30; i++) {        // pasek pisany bezpiecznie, co 102 cykle
    lcd.dataWrite(0x00, t); t += 102;
  }
  const przed = [...lcd.vram.subarray(0, 30)];
  for (let i = 0; i < 300; i++) {       // i naruszenia na koniec
    lcd.dataWrite(0xFD, t);
    lcd.controlWrite(0x0C, t + 20);
    t += 200;
  }
  const zepsute = lcd.mcr;
  const po = [...lcd.vram.subarray(0, 30)];
  check('naruszenie nie rusza pamięci obrazu',
        przed.every((b, i) => b === po[i]) && przed.every((b) => b === 0x00),
        `${przed.filter((b, i) => b !== po[i]).length} bajtów się różni`);

  // Kontrola negatywna: to, co model przewracał przez pół roku, nie leczy nic.
  lcd.controlWrite(0x02, t + 5000); lcd.dataWrite(0x1D, t + 5000);
  check('przepisanie liczby znaków w wierszu niczego nie naprawia',
        (lcd.mcr & 0x02) === 0, `mcr = ${lcd.mcr.toString(16)}`);

  lcd.controlWrite(0x00, t + 6000); lcd.dataWrite(0x32, t + 6000);
  check('przepisanie sterowania trybem naprawia', lcd.mcr === 0x32,
        `mcr: ${zepsute.toString(16)} przed naprawą, ${lcd.mcr.toString(16)} po`);
}

// --- 7. skrawek ląduje przy PRAWEJ krawędzi ---------------------------------
// Tak robi sprzęt: dane wsuwają się szeregowo w łańcuch sterowników kolumn,
// więc krótsza linia zatrzymuje się na dalekim końcu, a bliski zostaje pusty.

{
  const lcd = nowy();
  lcd.vram.fill(0xFF);
  lcd.hn = 6;                           // 48 z 240 pikseli
  const buf = new Uint8Array(SCREEN_W * SCREEN_H);
  lcd.render(buf);
  let lewo = 0, prawo = 0;
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W - 48; x++) if (buf[y * SCREEN_W + x]) lewo++;
    for (let x = SCREEN_W - 48; x < SCREEN_W; x++) if (buf[y * SCREEN_W + x]) prawo++;
  }
  check('krótka linia ląduje przy prawej krawędzi', lewo === 0 && prawo > 0,
        `zapalonych z lewej ${lewo}, z prawej ${prawo}`);
}

// --- 8. pełna linia rysuje się jak dotąd ------------------------------------
// hn=30 po 8 pikseli i hn=40 po 6 wypełniają 240 co do piksela, więc przesunięcie
// z punktu 7 nie może niczego ruszyć w normalnej pracy.

{
  const lcd = nowy();
  lcd.vram.fill(0xFF);
  const buf = new Uint8Array(SCREEN_W * SCREEN_H);
  lcd.render(buf);
  const zapalone = buf.reduce((a, b) => a + b, 0);
  check('tryb graficzny 30 x 8 wypełnia panel co do piksela',
        zapalone === SCREEN_W * SCREEN_H, `${zapalone} z ${SCREEN_W * SCREEN_H}`);
}

// --- 9. różne ziarno to różne uszkodzenie -----------------------------------

{
  // Za którym z kolei naruszeniem bajt wreszcie zostanie złapany.
  const kiedy = (seed) => {
    const lcd = nowy({ threshold: true, seed });
    ustawAdres(lcd, 0, 100000);
    let t = 100000;
    for (let i = 0; i < 1000; i++) {
      lcd.dataWrite(0xFD, t);
      lcd.controlWrite(0x0C, t + 20);
      if ((lcd.mcr & 0x02) === 0) return i;
      t += 200;
    }
    return -1;
  };
  const a = kiedy(0x1234), b = kiedy(0x7777);
  check('to samo ziarno daje ten sam wynik', kiedy(0x1234) === a, `za ${a} razem`);
  check('inne ziarno daje inny wynik', a !== b, `${a} wobec ${b}`);
  check('naruszenie nie jest pewne, tylko prawdopodobne', a > 0 && b > 0,
        `pierwsze trafienie za ${a} i ${b} razem, nie za pierwszym`);
}

// --- odsetek trafień wobec pomiaru na sprzęcie, 2026-08-26 ------------------
//
// `STRAY2.COM` puścił trzy dawki naruszeń po sześć przebiegów na każdą i policzył,
// ile razy panel zgasł: 2/6 przy ośmiu, 5/6 przy trzydziestu dwóch, 6/6 przy stu
// dwudziestu ośmiu. Dopasowanie daje szansę 0,053 na naruszenie, z przedziałem
// 0,024–0,108 — i to ten przedział, a nie sama liczba, jest tu wzorcem, bo sześć
// prób na dawkę nie daje trzeciej cyfry znaczącej.
//
// Widełki poniżej to obie krawędzie przedziału przeliczone na dawkę. Emulator ma
// się w nie zmieścić; wyjście poza nie znaczy, że `STRAY_ODDS` rozjechało się
// z jedynym pomiarem, jaki dla niego istnieje.

{
  const odsetek = (dawka, prob = 4000) => {
    let puste = 0;
    for (let i = 0; i < prob; i++) {
      const lcd = nowy({ threshold: true, seed: 1 + i });
      ustawAdres(lcd, 0, 100000);
      let t = 100000;
      for (let n = 0; n < dawka; n++) {
        lcd.dataWrite(0xDF, t);
        lcd.controlWrite(0x0C, t + 20);     // 20 cykli, czyli głęboko w oknie
        t += 200;
      }
      if ((lcd.mcr & 0x20) === 0) puste++;  // bit 5 zgaszony = panel pusty
    }
    return puste / prob;
  };

  // dawka, dolna i górna krawędź z przedziału ufności, obserwacja na sprzęcie
  const POMIAR = [
    [8, 0.17, 0.61, '2/6'],
    [32, 0.54, 0.98, '5/6'],
    [128, 0.95, 1.00, '6/6'],
  ];

  let zle = 0, opis = [];
  for (const [dawka, dol, gora, sprzet] of POMIAR) {
    const r = odsetek(dawka);
    opis.push(`${dawka}:${(r * 100).toFixed(0)}%(sprzęt ${sprzet})`);
    if (r < dol || r > gora) zle++;
  }
  check('odsetek trafień mieści się w widełkach z pomiaru', zle === 0, opis.join('  '));

  // I kontrola kształtu: odsetek ma rosnąć z dawką. To była ta właściwość, której
  // pierwszy przebieg na sprzęcie nie pokazał i przez którą trzeba było pytać
  // drugi raz — więc niech pilnuje jej test, a nie pamięć.
  const r8 = odsetek(8), r32 = odsetek(32), r128 = odsetek(128);
  check('odsetek trafień rośnie z liczbą naruszeń',
        r8 < r32 && r32 < r128,
        `${(r8 * 100).toFixed(0)}% < ${(r32 * 100).toFixed(0)}% < ${(r128 * 100).toFixed(0)}%`);
}

// --- gubienie bajtów przez naruszenie, zmierzone na sprzęcie 2026-08-26 -----
//
// `PRZEPLOT.COM` postawił trzy pasma na jednym ekranie, z identycznym odstępem
// między zapisami danych, różniące się wyłącznie tym, co leży między bajtami:
//
//   sam strumień danych               0 z 4800 bajtów
//   instrukcja 46 cykli po bajcie    82 z 4800  =  1,71%
//   instrukcja 106 cykli po bajcie    0 z 4800
//
// Odstępy podane w cyklach dzisiejszego modelu: w programie są takie, jakie są,
// a emulator liczył je kiedyś na 52 i 112, zanim doszła symulacja kolejki
// rozkazów. Przeliczono je, uruchamiając `PRZEPLOT.COM` od nowa i mierząc, ile
// cykli dzieli zapis danych od następującej po nim instrukcji.
//
// Rozstrzyga to dwie rzeczy naraz. Po pierwsze: **nie chodzi o przeplot**, bo
// pasmo przeplatające poza oknem nie zgubiło nic. Po drugie: ząbki liczone dawno
// temu i przypisane odstępowi były naruszeniami, a odstęp nie miał z nimi nic
// wspólnego — czego `LOSS.COM` dowiódł od drugiej strony, nie gubiąc niczego na
// 34 560 bajtach.
//
// Odtworzenie tamtego układu tutaj: te same trzy warunki, ten sam odstęp danych.

{
  const przebieg = (odlegloscInstrukcji, bajtow = 6000) => {
    const lcd = nowy({ threshold: true, seed: 0x51D0 });
    lcd.vram.fill(0x00);
    let t = 100000, zgubione = 0;
    for (let i = 0; i < bajtow; i++) {
      const adres = i & VRAM;
      // Komórka czyszczona przed każdym zapisem, tak jak program czyścił panel
      // przed przebiegiem. Bez tego, po pierwszym okrążeniu 2048 adresów, pod
      // spodem leżałoby już FFh — a wtedy „przywrócenie poprzedniej zawartości"
      // niczego nie zmienia i połowa strat staje się niewidoczna.
      lcd.vram[adres] = 0x00;
      ustawAdres(lcd, adres, t);
      t += 400;                                   // ustawienie adresu z dala od okna
      lcd.dataWrite(0xFF, t);
      if (odlegloscInstrukcji !== null) lcd.controlWrite(0x0C, t + odlegloscInstrukcji);
      t += 166;                                   // odstęp danych jak w programie
      if (lcd.vram[adres] !== 0xFF) zgubione++;
    }
    return zgubione / bajtow;
  };
  const VRAM = 0x7FF;

  const same = przebieg(null);
  const wOknie = przebieg(46);
  const pozaOknem = przebieg(106);

  check('sam strumień danych nie gubi nic', same === 0, `${(same * 100).toFixed(2)}%`);
  check('przeplot poza oknem nie gubi nic', pozaOknem === 0, `${(pozaOknem * 100).toFixed(2)}%`);
  check('naruszenie gubi bajty w tempie zmierzonym na sprzęcie',
        wOknie > 0.012 && wOknie < 0.023,
        `${(wOknie * 100).toFixed(2)}%  (sprzęt 1,71% ± 0,19)`);
}

// --- co zostaje w dziurze: poprzednia zawartość, nie zero --------------------
//
// Zmierzone na sprzęcie 2026-08-27 przez `GRANICA.COM`. Wcześniej każdy przebieg
// czyścił panel na biało i pisał czernią, więc dziura wychodziła biała — a tak
// samo wyglądałaby, gdyby układ zamiast tego zerował komórkę. Program postawił
// obok siebie dwa bloki pisane tym samym kodem i tym samym taktem, różniące się
// wyłącznie podkładem, a w środku czarnego wyciął trzy wiersze białego paseczka:
//
//   blok B, podkład biały         33 z 1680 = 1,96%
//   blok C, część czarna           0 z 1176
//   blok C, paseczek w środku     11 z  504 = 2,18%
//
// Ząbki w dolnym bloku wypadły wyłącznie w paseczku, w tym samym tempie co w
// górnym. Gdyby układ zerował komórkę, byłyby widoczne na całej wysokości bloku
// i wypadłoby ich trzydzieści trzy; P(≤11 | 33) = 9·10⁻⁶.

{
  const dziura = (podklad) => {
    const lcd = nowy({ threshold: true, seed: 0x51D0 });
    lcd.vram.fill(podklad);
    let t = 100000, zmienione = 0, prob = 4000;
    for (let i = 0; i < prob; i++) {
      const adres = i & 0x7FF;
      lcd.vram[adres] = podklad;
      ustawAdres(lcd, adres, t);
      t += 400;
      lcd.dataWrite(0xFF, t);
      lcd.controlWrite(0x0C, t + 46);
      t += 166;
      if (lcd.vram[adres] !== 0xFF) zmienione++;
      if (lcd.vram[adres] !== 0xFF && lcd.vram[adres] !== podklad) return { blad: adres };
    }
    return { zgubione: zmienione, prob };
  };

  const poBialym = dziura(0x00);
  const poCzarnym = dziura(0xFF);

  check('po białym podkładzie dziura jest widoczna',
        poBialym.zgubione > 0, `${poBialym.zgubione} z ${poBialym.prob}`);
  check('po czarnym podkładzie tej samej dziury nie widać',
        poCzarnym.zgubione === 0 && poCzarnym.blad === undefined,
        poCzarnym.blad !== undefined
          ? `pod adresem ${poCzarnym.blad} pojawiła się wartość spoza podkładu`
          : `${poCzarnym.zgubione} z ${poCzarnym.prob}`);
}

// --- rejestr trybu bit po bicie, zmierzony na sprzęcie 2026-08-26 ------------
//
// `MODEBITS.COM` zapisał rejestr trybu ośmioma wartościami **wprost, bez
// żadnego naruszenia czasów**, i porównał obraz. Rozstrzyga to luźną nitkę po
// przeglądzie ośmiu bajtów: bit 4, master, jest na tej płycie martwy. Wcześniej
// pasowały dwa wyjaśnienia — albo bit jest nieszkodliwy, albo naruszenie po
// prostu wtedy nie trafiło — a przy naruszeniu z natury losowym nie dało się ich
// rozdzielić. Bez naruszenia dają się rozdzielić natychmiast.
//
// Kontrole obu stron przebiegu na sprzęcie zadziałały: 12h zgasiło panel, 32h na
// końcu przywróciło obraz. Bez nich osiem razy „bez zmian" wyglądałoby tak samo
// jak zepsuty program.

{
  // Własny układ, z **niepustym generatorem znaków**. `nowy()` podstawia za
  // generator zaślepkę zwracającą zera, co dla wszystkiego powyżej jest bez
  // znaczenia — ale tryb znakowy rysowałby wtedy same spacje i wyszedłby pusty,
  // czyli nieodróżnialny od zgaszonego panelu. Prawdziwa maszyna ma tam glify;
  // 0xAA daje paski, i tak samo wygląda to na sprzęcie.
  const zeZnakami = () => {
    const cg = new Uint8Array(0x5C0).fill(0xAA);
    const lcd = new HD61830(cg, () => 0xAA);
    const ustaw = (ir, v) => { lcd.controlWrite(ir, 0); lcd.dataWrite(v, 0); };
    ustaw(0x00, 0x12);
    ustaw(0x01, 0x07); ustaw(0x02, 0x1D); ustaw(0x03, 0x3F); ustaw(0x04, 0x07);
    ustaw(0x08, 0x00); ustaw(0x09, 0x00);
    ustaw(0x00, 0x32);
    lcd.setTiming({ threshold: false, seed: 0x2B7E });
    return lcd;
  };

  const obraz = (mcr) => {
    const lcd = zeZnakami();
    // Wzorzec taki sam jak w programie: czarno, z pustym pasem przez środek.
    ustawAdres(lcd, 0, 100000);
    for (let i = 0; i < 30 * 64; i++) lcd.dataWrite(i >= 30 * 28 && i < 30 * 36 ? 0x00 : 0xFF, 100000);
    lcd.controlWrite(0x00, 200000); lcd.dataWrite(mcr, 200000);
    const buf = new Uint8Array(SCREEN_W * SCREEN_H);
    lcd.render(buf);
    let ciemnych = 0;
    for (const b of buf) if (b) ciemnych++;
    return { buf, ciemnych };
  };

  const wzorzec = obraz(0x32);
  const bezMastera = obraz(0x22);
  const bezWyswietlania = obraz(0x12);
  const bezGrafiki = obraz(0x30);

  const takiSam = (a, b) => a.buf.every((v, i) => v === b.buf[i]);

  check('wyczyszczenie bitu master nie zmienia niczego (zmierzone)',
        takiSam(wzorzec, bezMastera),
        takiSam(wzorzec, bezMastera) ? '' : `${wzorzec.ciemnych} wobec ${bezMastera.ciemnych} ciemnych pikseli`);

  // Kontrola pozytywna, ta sama co na sprzęcie: gdyby zapis rejestru nie
  // działał, poprzednia linia przechodziłaby zawsze i nie znaczyła nic.
  check('wyczyszczenie bitu wyświetlania gasi panel',
        bezWyswietlania.ciemnych === 0, `${bezWyswietlania.ciemnych} ciemnych pikseli`);

  check('wyczyszczenie bitu grafiki daje inny obraz, nie pusty',
        !takiSam(wzorzec, bezGrafiki) && bezGrafiki.ciemnych > 0,
        `${bezGrafiki.ciemnych} ciemnych pikseli`);

  // Wybór generatora znaków, kursor i miganie są w trybie graficznym niewidoczne
  // — tak mówi sprzęt dla 33h, 36h i 3Ah.
  let zle = 0;
  for (const mcr of [0x33, 0x36, 0x3A]) if (!takiSam(wzorzec, obraz(mcr))) zle++;
  check('generator znaków, kursor i miganie nic nie zmieniają w trybie graficznym',
        zle === 0, zle ? `${zle} z trzech różni się od wzorca` : '');
}

process.exit(fails ? 1 : 0);
