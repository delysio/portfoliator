# Portfoliator

*(English is the primary version of this document: [README.md](README.md).)*

Emulator Atari Portfolio (Atari PC Folio, 1989) działający wyłącznie w przeglądarce.
Czysty JavaScript, moduły ES, **bez kroku budowania** — wystarczy skopiować pliki na
dowolny serwer WWW i otworzyć stronę.

**Wypróbuj w sieci: [portfoliator.atari.org.pl](https://portfoliator.atari.org.pl).**
Potrzebny jest tylko własny zrzut ROM-u (patrz [Wymagane pliki ROM](#wymagane-pliki-rom)).

Stan: **uruchamia oryginalny ROM do promptu DIP-DOS 2.11 v1.072**, obsługuje
klawiaturę, ekran, karty pamięci i wydruk do pliku. Ostatnie zmiany opisuje
[CHANGELOG-PL.MD](CHANGELOG-PL.MD).

## Uruchomienie

Portfoliator to strona statyczna: bez kroku budowania, bez kodu po stronie serwera.
Skopiuj cały katalog na dowolny serwer WWW, którym zarządzasz, i otwórz go
w przeglądarce.

Emulator **musi** być serwowany po HTTP(S) — moduły ES i Web Worker nie działają
z `file://`. Wystarczy dowolny serwer plików statycznych: Apache, nginx, Caddy,
`python -m http.server` albo cokolwiek, co już masz uruchomione.

### Wymagane pliki ROM

Nie wchodzą w skład projektu — ROM oraz DIP-DOS są własnością Atari Corp.
i DIP Ltd. Zrzut trzeba dostarczyć samodzielnie, na dwa sposoby:

- **przez przeglądarkę** — przy pierwszym uruchomieniu emulator poprosi
  o wskazanie plików (można je też upuścić na okno) i zapamięta je w pamięci
  lokalnej, w IndexedDB. Pliki są odczytywane wyłącznie na Twoim komputerze,
  nic nie jest nigdzie wysyłane. Kolejna wizyta startuje od razu;
- **przez katalog `rom/`** — wygodniejsze przy pracy lokalnej i przy wdrożeniu
  prywatnym; emulator sam je stamtąd weźmie i również zapamięta.

| Plik | Rozmiar | Rola |
|---|---|---|
| `c101782-007.u4` | 131 072 B | ROM aplikacji → `C0000h–DFFFFh` (bankowany) |
| `c101781-007.u3` | 131 072 B | BIOS + DIP-DOS → `E0000h–FFFFFh` (na stałe) |
| `c101783-001a-01.u3` | 32 768 B | zewnętrzny generator znaków LCD |
| `hd61830.bin` | 1 472 B | wewnętrzny generator znaków HD61830 |

Nazwy mają znaczenie tylko dla katalogu `rom/`. Pliki wskazane przez przeglądarkę
emulator rozpoznaje po zawartości, więc myląca kolejność `u3`/`u4` nie ma jak
zaszkodzić — decyduje wektor reset (`EAh` = `JMP FAR`) pod `FFFF0h`, po którym
poznać połówkę z BIOS-em. Sklejony zrzut obu ROM-ów systemowych (262 144 B) też
zostanie przyjęty i podzielony automatycznie.

Zapamiętane pliki obejrzysz, wymienisz i skasujesz w oknie **System → Pliki ROM**.

#### Testowane rewizje

Emulator sprawdzono **wyłącznie** z poniższymi zrzutami (DIP-DOS 2.11,
ROM v1.072):

| Plik | CRC32 | SHA-256 |
|---|---|---|
| `c101782-007.u4` | `C9852766` | `82ceb9b0a3541191525d87c04c2fe832905fad71bffd162f960b59c0dfb649e6` |
| `c101781-007.u3` | `B8FB730D` | `3fd92628ca0f8960149b20700f486c4109eb4a9c0ae7d5a857eb13e9f440c223` |
| `c101783-001a-01.u3` | `61FDAFF1` | `60a971516b85b160fb343141b12811af4e627423b8e4e1dc33ef16f19e542cd9` |
| `hd61830.bin` | `06A934DA` | `8738511c6a2f02b0ef1be2cde90898458b4517151cb473ff28ae212dbd1c1737` |

Inne rewizje ROM-u **nie są blokowane** — jeśli rozmiar i struktura się zgadzają,
emulator je uruchomi i oznaczy jako nieznane. Nie ma jednak żadnej gwarancji, że
zadziałają: **korzystasz z nich na własną odpowiedzialność**. Zgłoszenia błędów
z nietestowanych rewizji przyjmuję z sumą SHA-256 w opisie — bez niej nie da się
odróżnić błędu emulatora od innej rewizji ROM-u.

## Pierwsze uruchomienie

1. Ekran copyright DIP-a → dowolny klawisz.
2. Wybór układu klawiatury → `E` (English/QWERTY).
3. `New date (mm-dd-yy):` → data albo Enter.
4. `New time:` → godzina albo Enter.
5. Prompt `c>`.

## Trwałość danych

Prawdziwe Portfolio trzymało wszystko w pamięci podtrzymywanej bateryjnie. Tutaj tę
rolę pełni **IndexedDB**, magazyn danych wbudowany w przeglądarkę. Nic nie trafia na
serwer — całość zostaje na komputerze użytkownika i znika razem z danymi witryny.

| Co | Kiedy jest zapisywane | Zakres |
|---|---|---|
| NVRAM — dysk `C:` z plikami i ustawieniami DOS-u | co 5 s oraz przy ukryciu karty przeglądarki | karta |
| Obrazy kart w slotach `A:` i `B:` | przy każdej zmianie, także tej z poziomu DOS-u | karta |
| 256 KB pamięci rozszerzenia HPC-104 | jak wyżej | karta |
| Podłączony sprzęt (HPC-104, port równoległy, szeregowy) | przy zmianie ustawienia | karta |
| Pliki ROM | raz, przy pierwszym wskazaniu | wspólne |
| Zrzuty stanu maszyny — trzy gniazda | tylko na żądanie | karta |

„Karta" oznacza kartę przeglądarki: druga otwarta dostaje własny, niezależny komplet
kluczy (`js/ui/storage.js`, arbitraż przez Web Locks), żeby dwa emulatory nie
nadpisywały sobie dysku `C:`. Pliki ROM są wspólne dla wszystkich kart, bo to
tożsamość maszyny, a nie jej stan.

**Przeglądarka musi obsługiwać IndexedDB.** Bez tego emulator uruchomi się i będzie
działał, ale po zamknięciu karty przepadnie wszystko. W praktyce obsługują je
wszystkie przeglądarki zdolne w ogóle uruchomić ten emulator, bo wymaga on rzeczy
nowszych — modułów ES w Web Workerze. Realny próg to **Chrome/Edge 80+** (oraz
pochodne: Opera, Brave, Vivaldi), **Safari 15+** (także iOS) i **Firefox 114+**.
IndexedDB działa w nich znacznie dłużej i nie ono jest ograniczeniem.

Zapis potrafi zniknąć niezależnie od obsługi:

- **tryb prywatny / incognito** — dane kasują się przy zamknięciu okna, a bywa, że
  zapis nie działa wcale;
- **blokada danych witryn** w ustawieniach albo w rozszerzeniu wyłącza IndexedDB
  razem z ciasteczkami;
- **czyszczenie historii i danych przeglądania** zabiera to razem z resztą;
- **Safari** kasuje dane witryn nieodwiedzanych przez 7 dni — to mechanizm ochrony
  prywatności (ITP), nie usterka;
- **brak miejsca na dysku** pozwala przeglądarce usunąć dane rzadziej używanych
  stron. Emulator wywołuje `navigator.storage.persist()`, co zwykle przed tym
  chroni, ale zgoda zależy od przeglądarki.

Jedyna pewna kopia zapasowa to plik na dysku: **Karta pamięci → Pobierz obraz**,
pobranie pojedynczych plików z listy zawartości karty, albo **Stan maszyny → Zapisz do
pliku**, który zabiera wszystko naraz — razem z tym, co maszyna miała akurat w pamięci
i na ekranie.

Zrzuty stanu są w tej tabeli jedyną pozycją, która **nie zapisuje się sama**, i to jest
zamierzone. Pozostałe wiersze odpowiadają temu, co w prawdziwym Portfolio trzymały
baterie, więc mają być niewidoczne; zrzut jest decyzją użytkownika o tym, dokąd chce móc
wrócić, i zapisywanie go w tle odbierałoby mu tę decyzję.

## Wbudowane aplikacje

Klawisz Atari (`` ` ``) jest **modyfikatorem** — naciśnięty sam nic nie robi. Trzeba go
**przytrzymać** i dopiero wcisnąć literę:

| Akord | Aplikacja |
|---|---|
| Atari + A | Address Book (`C:UNNAMED.ADR`) |
| Atari + C | Calculator |
| Atari + D | Diary (kalendarz) |
| Atari + E | Editor (`C:UNNAMED.TXT`) |
| Atari + S | Setup |
| Atari + W | Worksheet (`C:UNNAMED.WKS`) |

To samo menu daje polecenie `APP` w prompcie. Nazwy aplikacji **nie są** poleceniami
DOS-u — `EDIT` zwróci `Bad command or program not found`.

**Wewnątrz aplikacji** ten sam klawisz Atari, naciśnięty i puszczony *sam*, otwiera
pasek menu programu. W prompcie DOS-u nie robi nic — menu ma tylko aplikacja.

Atari pełni dodatkowo rolę nakładki numerycznej, bo Portfolio nie ma wydzielonej
klawiatury numerycznej (np. Atari+M daje `0`). Dlatego akordy spoza powyższej tabeli
wpisują znaki, zamiast cokolwiek uruchamiać.

Inne przydatne polecenia: `VER`, `DIR`, `CLS`, `FORMAT A:`.

### Co Portfolio o sobie pamięta (`PERMDATA.DAT`)

Wszystkie ustawienia wbudowanych aplikacji — łącznie z tym, co wpisano w **Setupie** —
leżą w jednym pliku na dysku `C:`: `C:\SYSTEM\PERMDATA.DAT`, równo 730 bajtów,
rozpisanych w przewodniku technicznym DIP-a co do bajta (str. 3-35 i 3-36). Emulator
czyta go wprost z pamięci maszyny i pokazuje w oknie **Aplikacje → Odczytaj
ustawienia**: prędkość i format portu szeregowego, cel wydruku i marginesy drukarki,
pamięci i format kalkulatora, pozycję kursora w edytorze oraz plik, nad którym każda
aplikacja pracowała ostatnio.

Dysk `C:` to RAM-dysk mieszkający w NVRAM-ie — **zwykły FAT12, tyle że o sektorze
128-bajtowym**, z 256 sektorami (32 KB) i nagłówkiem OEM „DIP 2.0". Dlatego czyta go
ten sam kod, co karty pamięci; wolumin wyszukiwany jest po sygnaturze, bo BIOS układa
pamięć przy starcie i jego adres nie jest stały.

Dwie rzeczy warto wiedzieć, zanim się temu zaufa. **Plik powstaje przy wyjściu
z aplikacji** — dokładnie wtedy, gdy użytkownik naciśnie <kbd>Esc</kbd> w menu
najwyższego poziomu; do tej chwili zmiany żyją tylko w RAM-ie, więc maszyna siedząca
w Edytorze pokaże jeszcze wartości z poprzedniego wyjścia. A maszyna, która ani razu
nie była w aplikacji, **nie ma tego pliku w ogóle** i emulator mówi to wprost.

Przypisanie czterech ostatnich bajtów (prędkość, parzystość, bity danych, bity stopu)
zostało sprawdzone doświadczalnie, a nie przyjęte na wiarę z pociętej przez OCR tabeli:
maszyna pokazująca w Setupie `9600 / None / 8 / 1` odczytuje się tu jako
`07h / 00h / 01h / 00h`.

## Architektura

```
index.html
eprom.html              narzędzie: obraz karty EPROM z bankami po 128 KB
css/app.css
js/main.js              wątek główny: ROM-y, canvas, klawiatura, IndexedDB
js/ui/storage.js        trwałość NVRAM i obrazów kart
js/ui/roms.js           rozpoznawanie, weryfikacja i zapamiętywanie plików ROM
js/emu/worker.js        Web Worker: pętla emulacji z pacingiem do czasu rzeczywistego
js/emu/cpu8088.js       rdzeń 8088 liczony co do taktu (przeniesiony z MartyPC)
js/emu/cpu8088-decode.js tablica dekodera rozkazów, wygenerowana ze źródeł MartyPC
js/emu/machine.js       mapa pamięci, ASIC, porty I/O
js/emu/hd61830.js       kontroler LCD
js/emu/disasm.js        deasembler 8088 dla inspektora
js/emu/keyboard.js      matryca klawiatury + mapowanie klawiszy przeglądarki
js/emu/pcd3311.js       generator tonów
js/emu/hpc101.js        interfejs równoległy (82C55A + Centronics)
js/emu/pofo-link.js     host protokołu transferu plików
js/emu/hpc102.js        interfejs szeregowy (82C50A + rejestr wektora)
js/emu/hpc104.js        rozszerzenie RAM z drugim slotem (napęd B:) i przelotką
js/emu/ins8250.js       UART
js/ui/lcdgrid.js        geometria siatki punktów panelu i malarz obrazu
js/ui/lcdramp.js        paleta panelu: co rejestr kontrastu robi z kolorami
js/ui/serial.js         drugi koniec kabla: terminal, Web Serial, modem, null-modem
js/ui/fat12.js          czytanie i zapis obrazów kart FAT12
js/eprom/epr.js         banki karty EPROM w układzie konwertera z Atari ST
js/eprom/app.js         strona karty EPROM: pliki, banki, pobieranie
js/ui/audio.js          wyjście Web Audio
js/ui/permdata.js       odczyt C:\SYSTEM\PERMDATA.DAT z pamięci maszyny
js/ui/i18n.js           przełączanie języka i podstawianie tłumaczeń
js/ui/format.js         daty (RRRR-MM-DD) i liczby (kropka dziesiętna) tak, jak pokazuje je strona
js/ui/confirm.js        pytania i komunikaty w oknie strony
js/ui/dict-en.js        słownik: polski tekst źródłowy -> angielski
tools/pofo-headless.mjs rdzeń emulatora uruchamiany w Node, bez przeglądarki
tools/run-tests.mjs     uruchamiacz zestawów testowych
tools/i18n-check.mjs    kontrola kompletności słownika tłumaczeń
tools/tests/            zestawy testowe (procesor, LCD, inspektor, interfejs, port szeregowy, energia)
tools/pdftext.mjs       wyciąganie tekstu ze skanów PDF z warstwą OCR
tools/ws-tcp-proxy.mjs  mostek WebSocket→TCP dla wirtualnego modemu
tools/build-auxwait.mjs generator AUXWAIT.COM (listing źródłowy w komentarzach)
tools/auxwait.com       program DOS-owy podnoszący limit ciszy na AUX
```

Rdzeń siedzi w Web Workerze i komunikuje się z wątkiem głównym przez `postMessage`.
`SharedArrayBuffer` nie jest potrzebny: klatka to 15 360 bajtów przy 72 Hz, a emulacja
zajmuje niewiele — w spoczynku, kiedy Portfolio czeka na klawisz, prawie nic, a przy
procesorze zajętym bez przerwy około jednej szóstej jednego rdzenia (pomiar w Node) —
więc kopiowanie jest tańsze niż nagłówki COOP/COEP, których wymagałby SAB.

## Język interfejsu

Interfejs mówi po polsku i po angielsku. Wybór **startowy bierze się z ustawień
przeglądarki**: język inny niż polski dostaje wersję angielską. Wybór ręczny —
przełącznik `PL`/`EN` w rogu nagłówka — zapamiętuje się w `localStorage` i od tej
chwili ma pierwszeństwo przed przeglądarką.

Warstwa tłumaczeń jest słownikowa i **kluczem jest polski tekst źródłowy**. Nie ma
osobnej przestrzeni nazw w rodzaju `ui.button.save`: strona pozostaje czytelna,
a napis bez wpisu w słowniku zostaje po polsku, zamiast zamienić się na ekranie
w połamany identyfikator.

Cena tego rozwiązania: klucz musi zgadzać się co do znaku, a jest nim **to, co
zwraca DOM**, nie to, co widnieje w źródle HTML. Przy `data-i18n` czytany jest
`textContent`, więc encje są już rozkodowane (`&gt;` to `>`); przy
`data-i18n-html` czytany jest `innerHTML`, który serializuje je z powrotem
(`&amp;`, `&lt;`, `&gt;`, `&nbsp;` zostają encjami). Oba warianty przechodzą
jeszcze zwijanie białych znaków, żeby wcięcia z HTML-a nie trafiały do słownika.
Stąd drobiazg w źródle: atrybuty logiczne zapisane są jako `download=""`, bo
dokładnie tak serializuje je przeglądarka.

Napisy, które powstają dopiero w trakcie działania, idą przez `t('…', arg)`
z miejscami `{0}`, `{1}`. Worker i protokół transferu plików meldują po polsku —
nie mają DOM-u ani pojęcia o języku — a tłumaczy je strona, w miejscu wypisania.

Kompletności pilnuje `node tools/i18n-check.mjs` (i zestaw `i18n` w testach):
odtwarza każdy klucz tak, jak zrobi to DOM, i zgłasza napisy bez tłumaczenia,
tłumaczenia puste, wpisy pozostałe po usuniętych napisach oraz miejsca na
argumenty, które nie zgadzają się po obu stronach. Tabele etykiet, które trafiają
do `t()` jako zmienna, oznacza się w kodzie komentarzem `/* i18n-keys */`.

## Inspektor

Podgląd maszyny w czasie jej pracy, w oknie **Inspektor**. Cztery panele, odświeżane cztery
razy na sekundę; emulacja chodzi przez ten czas dalej — dopóki się jej nie zatrzyma, bo
maszynę da się tu również zatrzymać, przejść krokiem i złapać w pułapkę.

- **Procesor** — wszystkie rejestry, znaczniki i licznik cykli od resetu.
- **Kod** — dwanaście instrukcji zdeasemblowanych od `CS:IP` albo od adresu wpisanego ręcznie.
- **Pamięć** — 256 bajtów spod dowolnego `segment:offset`, szesnastkowo i jako znaki.
- **Dziennik portów** — każdy odczyt i zapis w zadanym zakresie, a przy każdym wpisie
  **ile cykli minęło od poprzedniego**.

Ta ostatnia kolumna jest powodem, dla którego okno powstało. Wszystko, co ten projekt
ustalił o czasach kontrolera LCD, sprowadzało się do pytania „ile cykli było między tymi
dwoma zapisami" — i za każdym razem odpowiadał na nie doraźny skrypt pisany od nowa. Teraz
odpowiada okno.

Dziennik notuje **odczyty razem z zapisami**, i to też nie jest ozdoba: usterka, przez
którą klawisze kontrastu nie działały, siedziała w **odczycie**, który nic nie zwracał.
Zapisy wyglądały wtedy poprawnie — po prostu zawsze niosły tę samą liczbę.

Deasembler (`js/emu/disasm.js`) obsługuje całą jednobajtową mapę 8088 razem z grupami,
przedrostkami i blokami łańcuchowymi; opkody nieudokumentowane, które emulator realizuje
świadomie — `82h`, `SALC`, `POP CS` — są rozpoznawane i oznaczane. To, czego nie ma
w mapie, wychodzi jako `db XXh` o długości jednego bajtu, więc chodzenie po kolejnych
instrukcjach nigdy nie traci synchronizacji. Pilnuje tego `tools/tests/disasm.mjs`:
poza garścią ręcznie sprawdzonych ciągów robi sprawdzenie różnicowe — na **sześćdziesięciu
tysiącach instrukcji prawdziwego rozruchu** długość policzona przez deasembler musi zgadzać
się z liczbą bajtów, które faktycznie pobrał procesor.

### Pułapki i krokowanie

Panele pokazują maszynę w biegu; to jest ta część okna, która ją **zatrzymuje**. Trzy
sposoby, wszystkie po stronie workera — pętla emulacji przestaje wtedy przerabiać cykle,
a nie tylko przestaje je pokazywać:

- **Zatrzymaj / Wznów** — ręcznie, w dowolnej chwili.
- **Pułapka na adres** — kilka adresów naraz, po przecinku albo po spacji; sam offset
  oznacza segment `E000`, czyli ROM. Maszyna staje **przed** wykonaniem instrukcji spod
  tego adresu, więc rejestry pokazują to, co ta instrukcja dopiero zobaczy.
- **Pułapka na port** — zakres portów i kierunek: zapis, odczyt albo oba. Tu maszyna staje
  **po** instrukcji, która portu dotknęła — zatrzymanie w jej połowie wymagałoby cofania
  procesora — więc w oknie kodu stoi już następna instrukcja, a linijka stanu mówi, o który
  port i o jaki bajt chodziło.

**Krok** wykonuje jedną instrukcję i odświeża wszystkie panele razem z ekranem; jeśli
maszyna akurat chodziła, najpierw ją zatrzymuje. Reset przy zatrzymanej maszynie **nie
puszcza jej w bieg**, więc da się przejść krokiem rozruch od pierwszej instrukcji ROM-u.

Zatrzymana maszyna nie liczy cykli, ale pętla odmierzająca czas chodzi dalej: pasek stanu
dostaje swoje sprawozdanie co sekundę, tyle że z szybkością zero. Zamknięcie okna
**zdejmuje pułapki i wznawia maszynę** — inaczej dałoby się ją zostawić zatrzymaną bez
niczego, czym można by ją ruszyć.

Bez pułapek pętla emulacji wygląda dokładnie tak, jak wyglądała: sprawdzenie adresu chowa
się za `if (brkAddrs.size)`, a pułapka na port siedzi w uchwytach, które i tak już opasują
`machine.out8`.

Pilnuje tego `tools/tests/inspector.mjs` — prawdziwy worker z podstawionym `self`, te same
wiadomości, które wysyła strona. **Adres pułapki nie jest w nim wpisany**: zestaw przechodzi
krokiem początek rozruchu, spisuje ślad razem z licznikiem cykli i wybiera z niego
instrukcję, która pada tam raz jeden. Potem zaczyna maszynę od nowa — zimny start jest
powtarzalny co do cyklu — i sprawdza, czy pułapka trafia w to samo miejsce i w tej samej
chwili. Kontrola negatywna jest tuż obok: bez pułapki ten sam adres ma zostać minięty bez
zatrzymania. Sam zestaw sprawdzono **dziewięcioma mutacjami** w workerze — pułapka, która
nie strzela, pułapka strzelająca o instrukcję za późno, wznowienie wpadające z powrotem
w tę samą pułapkę, pominięty kierunek portu, krok o dwie instrukcje — i każda została
złapana przez to sprawdzenie, które miało ją złapać.

Śledzenie portów kosztuje coś tylko wtedy, gdy jest włączone, a zamknięcie okna wyłącza je
samo.

## Testy

Rdzeń emulatora nie dotyka DOM-u, więc `Machine` i `CPU8088` da się uruchomić wprost
w Node — **około 40× szybciej niż w czasie rzeczywistym** przy zajętym procesorze
i trzykrotnie szybciej, kiedy maszyna stoi na promptcie i przesypia takty w `HLT`.
Piętnaście minut pracy maszyny kosztuje wtedy około dwudziestu sekund czekania, co
dopiero czyni pytania w rodzaju „czy to się kiedykolwiek samo wyłączy" możliwymi do
sprawdzenia.

```bash
node tools/run-tests.mjs            # wszystko
node tools/run-tests.mjs standby    # tylko zestawy pasujące do wzorca
```

Frameworka testowego tu nie ma i nie będzie: projekt nie ma kroku budowania ani
zależności, więc jego testy też nie mają. Każdy zestaw to zwykły moduł, który wypisuje
linie `PASS`/`FAIL` i kończy się kodem różnym od zera, jeśli coś nie przeszło.

Zestawy wymagające ROM-ów **pomijają się same**, kiedy katalog `rom/` jest pusty, więc
całość przechodzi na świeżym klonie — bez plików, których projektowi nie wolno
rozpowszechniać. Tak samo pomijają się zestawy potrzebujące obrazu karty:
`standby-running-program` i `demos` chcą `cards/nucleus.img`, a `demos` dobiera
dodatkowe programy z opisu w `software/demos.local.json`, jeśli taki plik leży na dysku.
Regresja `demos` liczy skrót obrazu panelu i szerokość linii kontrolera w ustalonych
sekundach przebiegu, więc wyłapuje zmianę w czasach procesora, która przesunęłaby to, co
widać na ekranie.

### Złoty przebieg

`demos` pilnuje dem graficznych, ale potrzebuje obrazów kart spoza repozytorium, więc na
świeżym klonie **pomija się w całości**. `golden` bierze to, co potrzebuje wyłącznie
ROM-ów, czyli działa u każdego: rozruch na zimno, dwa polecenia DOS-u i wszystkie sześć
wbudowanych aplikacji — piętnaście punktów pomiarowych, pół sekundy.

Wzorce leżą w `tools/tests/golden-screens.txt` jako **czytelny tekst**, i to jest w tym
zestawie decyzja najważniejsza:

```
### aplikacja/kalkulator
~C9~CD*26 Gen M:1 #0 ~BB
~BA                                      ~BA
~BA~C4*38~BA
~BA                                 0    ~BA
~C8 Tue 01 Jan 80 00:00  NUM ~CD*7 INS ~BC
```

Bajty spoza ASCII zapisane są wartością, powtórzenia zwinięte (`~CD*26`), więc nic nie
ginie, a ramka nie zamienia się w ścianę szumu. Skrót bitmapy mówiłby „`a1b2` ≠ `c3d4`";
tutaj komunikat wskazuje wiersz i pokazuje oba warianty obok siebie, a `git diff` przy
zamierzonej zmianie daje się po prostu przeczytać. To nie jest kosmetyka — złoty przebieg,
którego nie da się szybko ocenić, kończy jako odruchowe „no to przenagrywam", a wtedy nie
pilnuje już niczego.

Czas ma **osobne kontrole**, i to z pomiaru, nie z przeczucia. Ekran startowy pokazuje
zegar z rozdzielczością setnych sekundy, czyli około 49 000 cykli — zmiana kosztu
pojedynczej instrukcji chowa się w nim bez śladu. Dlatego z ekranu jest maskowany, a obok
niego stoi **liczba instrukcji wykonanych do promptu**: `run()` wydaje stały budżet cykli,
więc każde potanienie instrukcji natychmiast zmienia to, ile ich się w tym budżecie
zmieściło. Zmierzone: podniesienie kosztu wykonanego skoku warunkowego o jeden cykl
przesuwa licznik z 938 823 na 938 235, przy zegarze nadal zgodnym ze wzorcem.

Granicę też warto znać. Zmiana kosztu instrukcji, o której i tak decyduje magistrala, nie
wyjdzie nigdzie — sprawdzone tą samą metodą: podniesienie `NOP` z 3 na 4 nie rusza
licznikiem ani o jeden, bo NOP zajmuje jeden bajt, a pobranie bajtu trwa cztery takty
i to ono wyznacza tempo. To nie luka w zestawie, tylko wierne zachowanie kolejki
rozkazów — na prawdziwym 8088 taka zmiana również nie miałaby skutku.

Rozruch idzie **na zimno, bez skrótów**, bo to jest ta jedna ścieżka, której nie wolno
omijać. Reszta punktów startuje ze zrzutu stanu zrobionego na promptcie — zrzut żyje
w tym jednym przebiegu, więc niczego nie trzeba odtwarzać przy zmianie formatu stanu,
a oszczędza osiem rozruchów.


Stanowisko potrafi wystartować maszynę do promptu, czytać ekran z bufora tekstowego MDA,
wstrzykiwać klawisze razem z akordami (Atari+S otwiera Setup), wkładać obrazy kart,
podpinać sondy na porty, pamięć i wykonywane adresy, a przez `callInterrupt` — wywołać
usługę ROM-u tak, jak zrobiłby to program: dwubajtowy `INT n` z `HLT` ląduje w zapasowych
bajtach pamięci obrazu, a procesor dostaje go do wykonania, więc wektor, flagi i `IRET`
zachowują się jak dla prawdziwego kodu.

Tą drogą ustalono, dlaczego emulator nie zasypiał, zweryfikowano tablice tonów, znaleziono
rejestr prędkości tiku (`INT 61h` `1Eh` zapisuje `8040h`) oraz wyjaśniono, czego ROM żąda,
żeby wstać po poleceniu `OFF`.

### Okablowanie interfejsu

Wszystkie pozostałe zestawy uruchamiają emulator **bez DOM-u**, więc żaden z nich nie
zauważy pomyłki najtańszej z możliwych: przemianowanego albo usuniętego `id`. W kodzie
nie widać po niej nic — dopiero w przeglądarce `document.getElementById` oddaje `null`,
a pierwsze `addEventListener` wywala stronę. Przy odrobinie pecha nie całą, tylko jedno
okno dialogowe, do którego akurat nikt nie zajrzał.

`ui-wiring` czyta `index.html`, `js/main.js`, `js/boot.js` i `css/app.css` jako tekst —
projekt nie ma kroku budowania, więc nie ma też czego wstrzykiwać — i sprawdza, czy
zgadzają się ze sobą:

| Sprawdzenie | Co łapie |
|---|---|
| każde `id`, po które sięga kod, istnieje w HTML-u | przemianowany albo usunięty element |
| żadne `id` się nie powtarza | dwa elementy, z których jeden jest nieosiągalny |
| `data-modal` celuje w `<dialog class="modal">` | okno, które się nie otworzy albo nie zamknie |
| `data-state-save/load/drop` pokrywają `STATE_SLOTS` | przycisk gniazda stanu, który nic nie robi |
| opcje `#serial-mode`, panele `serial-opt-*` i pętla przełączająca | tryb bez ustawień, panel nie do pokazania |
| oba sloty kart mają komplet kontrolek | slot B dopisany w połowie |
| `.checked` tylko na polach wyboru, `.value` tylko na polach z wartością | pole wyboru zamienione na listę rozwijaną |
| żadne `id` w HTML-u nie jest martwe | ślad po dawnej zmianie, wraz z wpisem w słowniku |

Listy, które zestaw porównuje — gniazda stanu, tryby portu, przyciski resetu, kontrolki
slotów — **wyciągane są ze źródła**, a nie wpisane w plik testu. Przepisana lista
sprawdzałaby wyłącznie samą siebie.

Kontrola typu kontrolki zasługuje na osobne zdanie, bo łapie usterkę zupełnie cichą.
Zamiana `<input type="checkbox">` na `<select>` nie zmienia w kodzie niczego, co dałoby
się zauważyć: `.checked` na liście rozwijanej to `undefined`, czyli opcja na stałe
wyłączona, bez śladu w konsoli. Zestaw obchodzi tabele `els` i `insp`, patrzy, jak każdy
element jest używany, i porównuje to ze znacznikiem w HTML-u — 46 użyć `.checked` i 39
użyć `.value`, dwadzieścia osiem różnych kontrolek.

Sam zestaw sprawdzono **mutacjami**: trzynaście celowo wprowadzonych usterek, po jednej
na sprawdzenie — przemianowane `id`, `id` powtórzone, `<dialog>` zamieniony na `<div>`,
okno bez klasy `modal`, gniazdo stanu bez przycisku, tryb portu bez panelu, pole wyboru
zamienione na listę, kontrolka slotu B wyjęta z tabeli, element bez odsyłacza. Wszystkie
trzynaście zostało złapane, każda przez to sprawdzenie, które miało ją złapać.

### Procesor wobec modelu odniesienia

Rdzeń jest podstawą wszystkiego, co ten projekt zmierzył. Czasy kontrolera LCD, próg
50 cykli, model kolejki rozkazów — każdy z tych wyników zakłada, że instrukcje wykonują
się poprawnie. Dlatego arytmetyka nie jest sprawdzana przez „uruchamia się i działa",
tylko **różnicowo, wobec modelu policzonego inaczej**.

Inaczej znaczy naprawdę inaczej. Tam, gdzie rdzeń kręci pętlą bit po bicie, model liczy
potęgami dwójki; tam, gdzie rdzeń trzyma przeniesienie połówkowe w znaczniku, model
wyprowadza je z arytmetyki na nibblach. Wspólna pomyłka nie ma się wtedy jak skasować.
Znaczniki, których architektura nie określa, nie są porównywane wcale — spis przy każdej
grupie w pliku zestawu.

| Zestaw | Co bierze |
|---|---|
| `cpu-alu` | osiem operacji ALU na bajtach — wszystkie 65 536 par, mnożenie ze znakiem i bez, przesunięcia, dzielenie |
| `cpu-alu16` | to samo w szerokości słowa, na iloczynie wartości granicznych; obie postacie licznika przesunięcia |
| `cpu-decimal` | AAA, AAS, DAA, DAS, AAM, AAD |
| `cpu-muldiv` | mnożenie i dzielenie szesnastobitowe, dzielenie ze znakiem, NEG, NOT, INC, DEC, CBW, CWD |
| `cpu-string` | pięć instrukcji łańcuchowych, oba kierunki, przedrostki segmentu, trzy postacie powtarzania |
| `cpu-undoc` | 82h, 60h–6Fh, SALC, POP CS, F1h — oraz długości na **całej** mapie opkodów |
| `cpu-cycles` | liczby cykli wobec tablic 8088 |
| `cpu-sst` | trzy miliony rozkazów nagranych na prawdziwym 8088 (SingleStepTests): stan, pamięć i magistrala w każdym takcie — dane spoza repozytorium, patrz [Czasy procesora](#czasy-procesora) |

Dwie rzeczy z tego zestawienia warto wyróżnić.

Korekty dziesiętne sprawdzane są **od strony przeznaczenia**, a nie przez powtórzenie
pseudokodu z podręcznika. Dla wszystkich par liczb dwucyfrowych ciąg `ADD AL,BL / DAA`
musi dać zapis BCD sumy, a przeniesienie wyjść wtedy i tylko wtedy, gdy suma przekroczyła
99. Taka kontrola nie ma wspólnego źródła z implementacją — powtórzony pseudokod
sprawdzałby wyłącznie, czy przepisano go dwa razy tak samo. Argumenty spoza BCD
porównywane są z zachowaniem prawdziwego 8088 nagranym przez SingleStepTests, a nie
z pseudokodem podręcznika — i różnią się od niego: druga korekta `DAA`/`DAS` progowana
jest na 9Fh, gdy AF był ustawiony. Tak samo rozstrzygnęło się `/6` w grupie przesunięć:
to nie alias `SHL`, tylko SETMO, które ustawia wszystkie bity wyniku.

Ostatnia kontrola w `cpu-undoc` jest ogólniejsza niż reszta i to ona pilnuje inspektora:
dla **wszystkich 65 536 par (opkod, drugi bajt)** długość policzona przez deasembler musi
zgadzać się z liczbą bajtów, którą pobrał procesor. `disasm` robi to samo, ale tylko na
instrukcjach wykonywanych przez ROM Portfolio — a ROM nigdy nie trafia w nieudokumentowany
róg mapy. Tamtą dziurą przeszło niezauważone, że rdzeń wykonuje 60h–6Fh jako skoki
warunkowe (8086 dekoduje je z pięciu bitów, więc lądują na tych samych warunkach co
70h–7Fh), a deasembler pokazywał w tym miejscu `db 60h` o długości jednego bajtu. Okno
inspektora rozjeżdżało się od tego miejsca do końca — i nie miało jak tego zgłosić, bo
wyglądało sensownie.

## Stan maszyny

Zrzut stanu zamraża całą maszynę w chwili, w której jest, i wczytanie stawia ją z powrotem
dokładnie tam — bez rozruchu, z tym samym obrazem na wyświetlaczu. Trzy gniazda w bazie
przeglądarki, plus plik `.pofostate` do przeniesienia gdzie indziej.

To jest coś innego niż pamięć podtrzymywana bateryjnie, która zapisuje się sama. Tamta
przechowuje dysk `C:` i przeżywa wyłączenie, ale po włączeniu Portfolio startuje od nowa —
bo dokładnie tak zachowywał się sprzęt. Zrzut przechowuje **przebieg**: procesor w połowie
instrukcji, zawartość ekranu, licznik cykli, kolejkę klawiatury, obie odliczanki uśpienia.

Zrzut niesie też **konfigurację sprzętu**, i to nie jest ozdoba: stan zapisany z wpiętym
rozszerzeniem pamięci musi wrócić z tym rozszerzeniem, inaczej dysk `B:` znika razem
z danymi. Wczytanie przebudowuje więc łańcuch płyt, zanim odtworzy stan, i odsyła stronie,
co ostatecznie ma wpięte — żeby przełączniki w interfejsie nie pokazywały konfiguracji,
której maszyna już nie ma.

To samo dotyczy **kart**. Zrzut niesie kartę z gniazda `A:`, a przy wpiętym rozszerzeniu
także z `B:`; po wczytaniu maszyna chodzi na nich, więc sloty na stronie też je przejmują —
lista plików, pamięć przeglądarki i pobieranie pokazują kartę, którą maszyna naprawdę ma.
Slot, w którym karta by się zmieniła, najpierw o to pyta, żeby obecną dało się pobrać,
zanim zostanie zastąpiona; zrzut z tą samą kartą wczytuje się bez pytania.

### Dlaczego to nie jest lista pól

Zrzut niepełny nie psuje się od razu. Maszyna po odtworzeniu chodzi, wygląda dobrze,
a wywraca się kilka sekund później, w miejscu bez widocznego związku z tym, czego
zabrakło. Miara tego jest w testach: przy celowo przekręconym **jednym bajcie** pamięci
rozjazd ujawnił się dopiero po **175 631 instrukcjach**.

Dlatego `tools/tests/state.mjs` nie sprawdza pól z osobna, tylko dwie rzeczy naraz:

- **bieg równoległy** — zrzut robiony jest w środku pracy, odtwarzany w maszynie
  zbudowanej od zera, po czym obie chodzą obok siebie **krok w krok przez 200 000
  instrukcji**. Po każdym kroku porównywane są rejestry, znaczniki i licznik cykli, a na
  końcu cała pamięć, pamięć obrazu kontrolera i jego rejestry;
- **pokrycie pól** — zestaw obchodzi żywe obiekty pole po polu i żąda, żeby każde albo
  znalazło się w zrzucie, albo stało na liście świadomie pominiętych, **z powodem**.
  Trzeciej możliwości nie ma. Dopisanie pola do urządzenia i zapomnienie o nim wywraca
  test natychmiast, zamiast czekać, aż wyjdzie z użycia.

Osobno `state-worker.mjs` przepuszcza to samo przez prawdziwego workera, tą samą drogą
wiadomości, którą idzie strona, a `state-file.mjs` domyka obieg przez plik: zrzut
prawdziwej maszyny przechodzi przez koder i dekoder, musi wrócić co do bajtu i **z tymi
samymi typami tablic** — tablica bajtów odtworzona jako zwykła tablica liczb wygląda
w porównaniu identycznie, a rdzeniowi podaje coś, czego nie umie użyć.

Format pliku jest celowo nudny: JSON, w którym tablice bajtów siedzą w base64. Nie jest
najciaśniejszy — pełny stan z kartą i rozszerzeniem waży około 690 KB — ale **nie ma
własnego układu pól**: koder chodzi po obiekcie rekurencyjnie, więc dołożenie pola do
dowolnego urządzenia nie wymaga tknięcia `js/ui/statefile.js`. Format, który trzeba
aktualizować razem z każdym urządzeniem, prędzej czy później przestaje być aktualizowany.

## Obudowa

Ekran jest nakładany na grafikę obudowy z `gfx/`. Każdy poziom powiększenia ma własny
plik, bo grafiki są rysowane osobno, a nie skalowane — wysokości to 180 / 358 / 537 / 715,
a odsunięcia nie są czystymi wielokrotnościami:

| Poziom | Plik | Rozmiar | Lewa krawędź obrazu | Góra szkła | Obraz zaczyna się na |
|---|---|---|---|---|---|
| 1× | `portfoliator.png` | 407×180 | 109 | 55 | 63 |
| 2× | `portfoliator-2x.png` | 814×358 | 217 | 110 | 126 |
| 3× | `portfoliator-3x.png` | 1221×537 | 326 | 165 | 189 |
| 4× | `portfoliator-4x.png` | 1628×715 | 436 | 220 | 252 |

**Szkło jest wyższe niż obraz.** W prawdziwym Portfolio jeden wiersz znakowy punktów
stoi nad obszarem sterowanym i jeden pod nim — należą do panelu i mają tę samą siatkę,
tyle że nigdy się nie zapalają. Sterownik prowadzi 64 wiersze, a szkło pokazuje **80**.
Te dwa wiersze rysuje emulator, a nie grafika, żeby dostały tę samą siatkę punktów,
tę samą rampę kontrastu i tę samą bezwładność panelu; inaczej przy każdym ruchu
rejestru kontrastu widać byłoby szew.

Dlatego obie współrzędne w tabeli znaczą co innego: **`x` to lewa krawędź obrazu**
(pustych kolumn nie ma, tylko wiersze), a **`y` to góra szkła**, czyli osiem wierszy
(razy powiększenie) nad obrazem. Canvas zaczyna się od górnej krawędzi szkła, więc
obraz ląduje we właściwym miejscu sam.

**Szkło w grafice ma kolor tła samego emulatora,** `rgb(142, 193, 172)` — `LCD_OFF`
w [`js/ui/lcdramp.js`](js/ui/lcdramp.js). Jest trochę większe niż canvas, tak jak
prawdziwy panel ma margines szkła wokół punktów: po bokach jeden piksel przy 1×, do
siedmiu przy 4×, a przy 3× jeszcze wiersz u dołu. W każdym innym odcieniu ten margines
widać jako pas tam, gdzie kończy się canvas, więc grafika eksportowana na nowo musi
mieć szkło dokładnie w tym kolorze, razem z wygładzonymi brzegami.

Każdy poziom ma własną grafikę — 4× też, zamiast wcześniejszej podwojonej 2×, więc
żaden nie jest skalowany i wszystkie zostają ostre. Geometria siedzi w tablicy `SHELLS`
w [`js/main.js`](js/main.js) — podmiana grafiki to zmiana jednego wiersza.

## Czasy procesora

Ile taktów zajmuje instrukcja, nie da się wyczytać z tabeli — i to jest wniosek
z pomiaru, a nie założenie. Tabele podają pracę jednostki wykonawczej i milcząco
przyjmują, że bajty instrukcji są już w procesorze. Na 8088 nie są: magistrala pobiera
**jeden bajt na cztery takty**, tą samą magistralą idzie każdy dostęp do pamięci i każdy
zapis do portu, więc wykonywanie i pobieranie **konkurują o nią**.

Rozstrzygnął to pomiar, którego żadna tabela nie wytłumaczy. Bierzemy pętlę, którą
rysuje demo *trainfolio*, i usuwamy z niej raz zapis do portu, a raz czterobajtowy odczyt
z pamięci. To zupełnie różne instrukcje — ale każde z tych usunięć zabiera pętli dokładnie
**jeden cykl magistrali**, i na prawdziwym Portfolio każde zaoszczędziło dokładnie tyle
samo: **5,99 taktu**. Maszyna liczy sobie cykle magistrali, a nie instrukcje.

### Rdzeń liczony co do taktu

Procesor (`js/emu/cpu8088.js`) jest przeniesieniem rdzenia 8088 z emulatora
[MartyPC](https://github.com/dbalsom/martypc) Daniela Balsoma (licencja MIT), zrobionym
funkcja po funkcji. To nie jest model z regułami, tylko symulacja układu:

- jedno wywołanie `cycle()` to jeden takt zegara. Jednostka magistrali przechodzi przez
  stany T1–T4 i przez potokowy cykl adresu, który pozwala jej przygotować następny cykl,
  zanim skończy bieżący;
- kolejka rozkazów ma cztery bajty. Pobieranie wstrzymuje się, kiedy są w niej trzy;
  o następnym pobraniu jednostka magistrali decyduje pod koniec T2, a żądanie jednostki
  wykonawczej, które trafi na pobranie już zaplanowane, płaci dwa takty kary;
- każdy rozkaz jest liniowym kodem, który wydaje takty tam, gdzie wydaje je mikrokod 8088.
  Mnożenie i dzielenie przechodzą pętle CORX i CORD bit po bicie, więc ich czas zależy od
  danych dokładnie tak, jak w układzie.

W rdzeniu nie ma ani jednej stałej dopasowanej do pomiarów z Portfolio. Sprawdzono go dwiema
niezależnymi drogami.

**Wobec prawdziwego 8088.** [SingleStepTests 8088](https://github.com/SingleStepTests/8088)
to 3 007 000 pojedynczych rozkazów nagranych na NMOS 8088 (AMD D8088): stan przed i po
oraz stan magistrali i kolejki w każdym takcie pomiędzy. Rejestry, wszystkie znaczniki —
także te, których dokumentacja nie określa — i pamięć zgadzają się we **wszystkich**
przypadkach; liczba taktów i stan magistrali w każdym z nich w **2 931 155**, czyli 97,5%.
Rozjazdy siedzą w piętnastu plikach i wszystkie są odziedziczone po MartyPC:

- wejście do procedury dalekiej i do przerwania (`CALL FAR`, `INT`, wyjątek dzielenia)
  zapisuje CS na stos takt później niż układ, ale kończy się w tym samym takcie;
- `TEST rejestr, dana` z pełnej kolejki zdejmuje bajt danej takt wcześniej, przy tym
  samym czasie całości;
- jedyny przypadek, w którym zmienia się czas całego rozkazu: `MOV bajt [BX+SI], dana`
  i `[BP+DI]` (bez przemieszczenia albo z ośmiobitowym, bez przedrostka) z pełnej kolejki
  wychodzi takt za krótko — w 307 przypadkach na 10 000.

Tego pilnuje `tools/tests/cpu-sst.mjs`. Danych testowych (761 MB) nie ma w repozytorium,
więc zestaw działa po wskazaniu katalogu zmienną `SST_8088`, a bez niej się pomija.

**Wobec Portfolio.** 647 pomiarów zebranych na prawdziwym Portfolio przez programy `TEMPO`
(o nich niżej) rdzeń trafia ze **średnim błędem 0,17%**. **568** z nich mieści się w 0,06%,
czyli emulator wypisuje ten sam całkowity licznik co Portfolio, a 644 w 0,5%. Dawny model
regułowy miał na tych samych pomiarach 1,31% i 285 trafień w 0,06%. Wszystkie
dwadzieścia dwa znane błędy tamtego modelu — ciągi `CWD`, `AAA` bez korekty za długim
rozkazem, przesunięcia o `CL` przeplatane zapisem — nowy rdzeń trafia, choć nikt go do nich
nie stroił. Wniosek wykracza poza liczby: **80C88 w Portfolio liczy takty dokładnie tak jak
NMOS 8088**, a to, czego nie umiał model regułowy, było zwykłą pracą magistrali.

| kształt | Portfolio | rdzeń |
|---|---:|---:|
| `DEC BP` + `JNE` (pusta pętla) | 22,13 | 22,13 |
| `MOV AX,BX` × 8 | 86,29 | 86,33 |
| `MOV AL,[BX]` × 8 | 136,37 | 136,48 |
| `OUT DX,AL` × 8 | 88,28 | 88,33 |
| (`MOV DI` + `CX`=8 + `REP STOSB`) × 4 | 468,65 | 468,94 |
| (`MOV AL,FF` + `MUL BL`) × 4, BL=FF | 353,59 | 353,83 |
| (`MOV AL,FF` + `AAM 02`) × 4 | 388,93 | 389,23 |
| `CWD` × 8 przy ujemnym `AX` | 67,27 | 67,33 |
| `SCASB`, `NOP` × 3, `MOV AL,[SI]` w pętli `LOOP` | 1692,56 | 1692,83 |
| pętla tunelu z *trainfolio* | 416,23 | 416,28 |
| pętla rysująca *trainfolio* | 1902,17 | 1902,62 |
| pętla *Nucleusa* spod 366:1609 | 8856,22 | 8860,99 |

Takty na obrót bloku, razem z rusztowaniem pomiaru opisanym niżej. Dawny model regułowy
dawał w wierszu `CWD` 61,33, a w wierszu `SCASB` 1815,83.

Trzy pomiary rdzeń chybia i stoją w zestawie jako **znane błędy**: osiem `LODSB` pod rząd
(−3,71%), kolumna rysująca *Nucleusa* bez przemieszczenia (−1,75%) i
(`SHL CL` + `OR AL,[BX+DI+d16]` × 2) × 4 (−0,82%). MartyPC uruchomiony jako program daje na
nich te same liczby, więc to albo różnica między 80C88 a NMOS 8088, albo coś w tych trzech
pomiarach — nierozstrzygnięte.

Całe demo, mierzone stoperem: *Nucleus* od uruchomienia do znaku zachęty trwa na Portfolio
362,95 s, a dawny model regułowy dawał 362,21 s. Rdzeń liczony co do taktu przechodzi
go o 1,55 s dłużej niż tamten model, czyli około 363,8 s (+0,2%) — to szacunek, a nie pomiar, bo stoper i emulator
kończą przebieg w trochę innych miejscach.

Rdzeń liczony takt po takcie jest wolniejszy od modelu regułowego, ale z zapasem: rozruch
Portfolio idzie w Node z prędkością około 28 milionów taktów na sekundę, a czas rzeczywisty
wymaga 4,9 miliona.

### Jak mierzono Portfolio

Wzorce pochodzą z programów puszczonych na prawdziwym Portfolio (`TEMPO1` do `TEMPO69`).
Każdy obraca badany blok w pętli i liczy obroty pętli zewnętrznej w piętnastu sekundach
licznika ASIC-a, a na początku i na końcu ma bloki, które nic nie mierzą — w każdym
przebiegu wychodzą identyczne, więc widać, że nic się nie rozjechało. Kotwice powtarzane
w kolejnych programach, przez tygodnie i w różnych sesjach, trafiają w tę samą liczbę
całkowitą; całość mieści się w 0,25% — tyle ta metoda jest warta.

Licznik, który program drukuje, mierzy obroty **całej** pętli zewnętrznej, a ta robi więcej
niż przekręcenie bloku INNER razy: podbija licznik, czyta port ASIC-a i pyta, czy minęło
piętnaście sekund. To rusztowanie jest identyczne co do bajtu we wszystkich programach
i kosztuje 264,94 taktu na obrót, czyli 0,13 taktu przy INNER 2000 i 10,60 przy INNER 25.
Zestaw dolicza je do każdego wiersza tak samo, dlatego pusta pętla stoi w tabeli na 22,13,
a nie na 22,00, które `TEMPO7` zmierzył wprost.

Pilnuje tego `tools/tests/cpu-sprzet.mjs` — jedyny zestaw w projekcie, którego wzorce są
pomiarem ze sprzętu, a nie zapisem stanu emulatora. Każdy jego wiersz ma limit
0,5%, chyba że jest zapisanym znanym błędem; wtedy pilnowany jest dryf od zapisanej liczby.
Kiedy któryś wzorzec przestanie pasować, **nie wolno go przenagrać**: to znaczy, że rdzeń
zaczął kłamać o tym konkretnym kształcie kodu.

### Dawny model regułowy

Zanim wszedł rdzeń liczony co do taktu, czasy liczył model regułowy: koszty jednostki
wykonawczej z tablic,
przybliżona kolejka i kilkadziesiąt reguł dopasowywanych do kolejnych programów `TEMPO` —
od przybliżenia `max(tabela, 4 × bajty)` z błędem 10,3% do 1,13% na 621 pomiarach.
Pomiary, na których powstał, zostały w zestawie i to one sprawdzają dziś nowy rdzeń.

## Wierność układu LCD

Kontroler HD61830 nie ma własnej pamięci obrazu — korzysta z 2 KB zewnętrznego SRAM-u na
płytce wyświetlacza i dzieli go z odświeżaniem panelu. Po każdym zapisie danych potrzebuje
chwili, zanim przyjmie następny dostęp. Ten, który przyjdzie wcześniej, jest obsłużony
źle, a **skutek zależy od tego, co przyszło**:

- **kolejny zapis danych** przepada. Licznik adresu nie rusza się wtedy z miejsca, więc
  bajty zapisane później lądują tam, gdzie miał trafić zgubiony — wiersz nie robi się
  dziurawy, tylko **urywa**, a jego koniec zostaje z tym, co było wcześniej;
- **zapis instrukcji** łapie bajt jeszcze w locie i wciąga go do **rejestru sterowania
  trybem**, gasząc te jego bity, które bajt trzyma nisko. Pamięć obrazu pozostaje przy tym
  **nietknięta** — to poprawny obraz wyświetlany źle — i tak jest aż do ponownego
  zaprogramowania układu.

Liczą się dwa bity z ośmiu. Kiedy nisko jest **bit 1**, gaśnie tryb graficzny: kontroler
czyta pamięć obrazu jak kody znaków i panel robi się biały z pasem przy prawej krawędzi.
Kiedy nisko jest **bit 5**, gaśnie wyświetlanie i panel pustoszeje. Reszta — wybór
generatora znaków, kursor, miganie i dwa bity nieużywane — w trybie graficznym nie ma
czego popsuć. Bajt `FFh` nie trzyma nisko niczego i jest zupełnie nieszkodliwy.

Ustalone na prawdziwym Portfolio, dziesięcioma programami testowymi, i rozstrzygnięte parą
napraw: po zepsuciu obrazu **przepisanie samego sterowania trybem przywraca go w całości**,
a przepisanie liczby znaków w wierszu nie naprawia niczego. Wcześniej model emulatora
zakładał właśnie liczbę znaków — rekonstrukcję z szerokości ocalałego skrawka, bo
rejestrów kontrolera na Portfolio odczytać się nie da. Rekonstrukcja była błędna.

**Jak często** spóźniony zapis łapie bajt, wiadomo od 2026-08-26: mniej więcej raz na
dwadzieścia. Zmierzone krzywą dawka–odpowiedź — trzy dawki naruszeń, po sześć przebiegów
na każdą, liczone, ile razy panel zgasł: przy 8 naruszeniach 33%, przy 32 już 83%, przy
128 zawsze. Dopasowanie daje 0,053 z przedziałem 0,024–0,108, a stała w emulatorze wynosi
0,05 i mieści się w nim — została więc tam, gdzie była. Przez wiele miesięcy była
najmiększą liczbą w tym pliku, zgadniętą z wyglądu jednej demówki; okazała się trafna.

Kształt krzywej znaczy tu tyle samo co liczba. Odsetek rosnący z dawką to właśnie wygląda
niezależna szansa na każde naruszenie — a wcale nie było to przesądzone: wcześniejszy
przebieg z jedną próbą na dawkę wyszedł niemonotoniczny (cztery naruszenia zgasiły panel,
sześćdziesiąt cztery nie), więc zostawało otwarte, czy to w ogóle jest moneta. Sześć prób
na dawkę to rozstrzygnęło.

### Ząbki: co nimi naprawdę było

Stała tu przez miesiące uwaga, że prawdziwy sprzęt gubi ok. 0,6% bajtów także przy
odstępach dwukrotnie bezpiecznych, i że emulator tego nie odtwarza — wpisana jako znana
rozbieżność, na podstawie ząbków policzonych na kilku ekranach. Dwa pomiary z 2026-08-26
rozstrzygnęły to z obu stron.

**Odstęp nie ma z tym nic wspólnego.** Dziewięć odstępów od 59 do 419 cykli, po dwa
przebiegi, **34 560 zapisanych bajtów i ani jednego ząbka** — przy 0,6% wypadłoby ich
dwieście siedem. Górne ograniczenie spadło do 0,0087%.

**Ząbki są jednak prawdziwe — to naruszenie czasów, nie odstęp.** Rozstrzygnął to program
stawiający trzy pasma na jednym ekranie, z identyczną odległością między zapisami danych,
różniące się wyłącznie tym, co leży między bajtami:

| pasmo | co między bajtami | zgubione |
|---|---|---|
| górne | nic, sam strumień danych | 0 z 4800 |
| środkowe | instrukcja **52 cykle** po bajcie, w oknie | **82 z 4800 = 1,71%** |
| dolne | instrukcja 112 cykli po bajcie, poza oknem | 0 z 4800 |

Nie chodzi więc o przeplot: pasmo przeplatające **poza** oknem nie zgubiło ani jednego
bajtu. Chodzi o to, czy instrukcja mieści się w oknie odzysku. Ząbki liczone dawno temu
i przypisane odstępowi były naruszeniami od początku.

Spóźniona instrukcja ma zatem dwa skutki, oba zmierzone i oba modelowane: mniej więcej raz
na dwadzieścia wciąga bajt do rejestru sterowania trybem, a mniej więcej raz na sześćdziesiąt
sprawia, że bajt w ogóle nie ląduje w pamięci obrazu. Bajt nie jest przekłamany, tylko nigdy
nie zapisany — pod spodem zostaje to, co było.

**Że pod spodem zostaje to, co było, jest zmierzone od 2026-08-27.** Wcześniej każdy przebieg
czyścił panel na biało i pisał czernią, więc dziura wychodziła biała i wyglądała dokładnie tak,
jak gdyby układ zamiast tego zerował komórkę. `GRANICA.COM` postawił obok siebie dwa bloki
pisane tym samym kodem i tym samym taktem, różniące się wyłącznie podkładem, a w środku
czarnego wyciął trzy wiersze białego paseczka:

| blok | podkład | ząbki |
|---|---|---|
| B | biały | 33 z 1680 = 1,96% |
| C, część czarna | czarny | 0 z 1176 |
| C, paseczek w środku | biały | 11 z 504 = 2,18% |

Ząbki w dolnym bloku wypadły **wyłącznie w paseczku**, w tym samym tempie co w górnym. Gdyby
układ zerował komórkę, byłyby widoczne na całej wysokości bloku i wypadłoby ich trzydzieści
trzy zamiast jedenastu; P(≤11 | 33) = 9·10⁻⁶.

Ten sam program zamknął przy okazji starszą wątpliwość: czy ząbki widywane „na granicy pasm"
nie są bajtami lądującymi pod złym adresem. Nie są — to pierwszy wiersz pasma naruszającego,
przylegający do wąskiej przerwy. Blok kontrolny `GRANICA.COM`, oddzielony dziesięcioma pustymi
wierszami z każdej strony, nie pokazał ząbka ani razu, a kontrola „same dane" ze wszystkich
przebiegów razem ma dziś **43 840 bajtów i zero strat**, czyli górne ograniczenie 0,0068%.

**Bit 4 przestał być zagadką 2026-08-26.** Był luźną nitką po tamtym przeglądzie: trzeci
bit z tych, które Portfolio ustawia, a jedyny, którego utrata nie zostawiała śladu. Dwa
wyjaśnienia pasowały równie dobrze — albo wyczyszczenie go jest nieszkodliwe, albo
naruszenie po prostu wtedy nie trafiło. Rozstrzyga zapis rejestru **wprost, bez żadnego
naruszenia w pobliżu**: tryb `22h`, czyli master wyczyszczony i reszta jak zwykle, rysuje
dokładnie to samo co `32h`. Bit jest na tej płycie martwy, więc czysty wynik przeglądu był
prawdą, a nie pudłem.

Ten sam przebieg potwierdził resztę rejestru bit po bicie: `12h` gasi panel, `30h` wrzuca
go w tryb znakowy, a wybór generatora znaków, kursor i miganie są w trybie graficznym
niewidoczne. Obraz w trybie znakowym zgodził się z emulatorem co do kształtu — regularne
pionowe paski z pustym pasem tam, gdzie w pamięci obrazu są zera — a była to pierwsza
w ogóle konfrontacja tej ścieżki ze sprzętem.

Reguła jest jednostronna: liczy się wyłącznie to, co przychodzi **po** zapisie danych.
Dostęp wciśnięty tuż przed bajtem jest niegroźny, bo zapis danych jako jedyny sięga do
zewnętrznego SRAM-u i tylko po nim jest z czego dochodzić do siebie.

Program nie ma jak się o tym dowiedzieć. **Interfejs LCD w Portfolio jest tylko do
zapisu**: odczyt portu `8010h` zwraca `10h`, a `8011h` — `11h`, czyli młodszy bajt adresu
portu, który zostaje na magistrali, gdy nikt nie wystawia danych. Zmierzone na prawdziwym
urządzeniu przez 65 536 odczytów, wszystkie identyczne, bit zajętości ani razu ustawiony;
odczyt pamięci obrazu instrukcją `0Dh` zwraca to samo. Ani BIOS, ani żadne demo nie
sprawdzi, czy bajt dotarł — piszą na ślepo, bo nic innego nie mają do dyspozycji.

### Skąd 50 cykli

Z pomiaru, nie z noty katalogowej. `STEPTEST` zamalowywał ekran na czarno, a potem
zapisywał go na biało w ośmiu stałych tempach, po jednym na ekran: **piąty ekran zostawiał
niezapisany pas przy prawej krawędzi, szósty wychodził czysty** — po sześć uruchomień
w każdą stronę.

Sama obserwacja nie drgnęła od tamtej pory; zmieniała się **miarka**. Te dwa ekrany
wypadały 43 i 49 cykli od siebie, kiedy tabela instrukcji szła bez poprawek; 51 i 59 po
doliczeniu ośmiobitowej magistrali; 46 i 54, gdy kolejkę rozkazów zaczęto symulować
zamiast przybliżać; a 48 i 56 w dawnym modelu regułowym i w rdzeniu liczonym co do taktu,
wyprowadzone od nowa przy jego wejściu. Stąd 50 — i stąd reguła, którą warto trzymać na widoku: **ten próg
jest dokładnie tak dobry, jak model cykli pod nim, i przy każdej jego zmianie trzeba go
wyprowadzić ze STEPTEST od nowa.**

Ile z wiersza ocaleje, rozstrzyga potem arytmetyka odrzuceń, a nie średnie tempo, bo
znacznik czasu przesuwa się wyłącznie po **przyjętym** zapisie: przy odstępie `s` układ
bierze jeden zapis na `ceil(50/s)`. Przy 48 cyklach to co drugi bajt, czyli pół wiersza.

### Przełącznik

**System → Wierność układu LCD** ma dwie pozycje:

- **Zgodne z oryginalnym sprzętem** (domyślnie) — kontroler dostaje swoje 50 cykli, więc
  program, który je łamie, widzi to, co zobaczyłby na prawdziwym Portfolio;
- **Bierze wszystko — nierealistyczne** — każdy zapis przyjęty natychmiast, niezależnie od
  tempa; ekran zostaje czysty, ale takiego układu nigdy nie było.

Druga pozycja zostaje wyłącznie jako narzędzie diagnostyczne: gdy obraz wygląda źle,
przełączenie rozstrzyga w jednym kliknięciu, czy winne są czasy dostępu, czy coś zupełnie
innego. Bez niej każdą taką wątpliwość trzeba by rozbierać w kodzie.

Zwykłej pracy przełącznik nie dotyczy. BIOS respektuje czasy kontrolera — musi, skoro
prawdziwe urządzenie działa — więc rozruch, DOS i wbudowane aplikacje wyglądają w obu
ustawieniach identycznie, co do znaku.

## Kontrast

**Atari + strzałka w górę** i **Atari + w dół** przestawiają kontrast, tak jak na
prawdziwym Portfolio. Wartość siedzi w rejestrze pod `8060h`: sześćdziesiąt cztery
stopnie po cztery, od zera do `FCh`, a zimny start ustawia `80h`, czyli środek.

Rejestru trzeba umieć **odczytać**, bo tylko on pamięta bieżący poziom — w pamięci nie ma
żadnej kopii. ROM zmienia kontrast pod adresem `E000:1BA0` tak:

```
mov dx, 8060h / in al, dx / cmp al, 0FCh / jnb dalej / add al, 4 / out dx, al
```

Dopóki odczyt tego portu zwracał zero, ROM za każdym razem widział zero, dodawał cztery
i zapisywał cztery — więc klawisze ruszały obrazem dokładnie raz i potem stawały. Pilnuje
tego teraz `tools/tests/contrast.mjs`.

Jak poszczególne stopnie **wyglądają**, jest odtworzone, a nie zmierzone: przewodnik
techniczny poświęca temu rejestrowi jedno zdanie i żadnej charakterystyki. Poniżej środka
zapalone punkty bledną w stronę tła; powyżej środka samo tło ciemnieje w stronę atramentu
i panel się zamyka.

**Oba końce dochodzą do końca**, bo na sprzęcie dochodzą: na minimum panel gaśnie i po
znakach nie zostaje ślad, na maksimum zamyka się w jedno ciemne pole, z którego punktów
już nie da się wyłuskać. Wcześniej zatrzymywały się przed metą — z dołu zostawało 15%
rozpiętości, z góry 60% — więc skala kończyła się, zanim skończył się obraz. Reszta drogi
rozłożona jest równo, po jednym widocznym stopniu na naciśnięcie, bo nic nie wskazuje,
w którym miejscu miałaby się zagęszczać.

Pilnuje tego `tools/tests/lcd-ramp.mjs`: że oba końce dają panel o **jednym** kolorze, że
rozpiętość rośnie do `80h` i maleje za nim bez zawracania, że wszystkie sześćdziesiąt
cztery stopnie dają sześćdziesiąt cztery różne obrazy — martwy stopień wygląda jak zepsuty
klawisz — i że przy `80h` paleta jest dokładnie ta co przedtem, co do składowej.

## Bezwładność matrycy

Kontroler HD61830 przełącza piksel natychmiast, ale ciekły kryształ z 1989 roku — nie.
Punkt dochodzi do nowego stanu przez kilkadziesiąt do kilkuset milisekund i to stąd
biorą się smugi za przewijanym tekstem oraz miękkie mruganie kursora, których emulacja
samego kontrolera nie odtwarza.

Wątek główny trzyma więc obok bitmapy z workera drugą tablicę — po jednej liczbie
zmiennoprzecinkowej na piksel, `0` = zgaszony, `1` = w pełni ciemny — i przy każdej
klatce dosuwa ją wykładniczo do bitów przysłanych przez emulację:

```
poziom += (docelowy − poziom) · (1 − exp(−dt / τ))
```

Zapalanie i gaszenie mają osobne stałe czasowe: powrót ciekłego kryształu do stanu
spoczynku jest wolniejszy niż wysterowanie go napięciem, więc `τ` gaszenia jest o 60%
dłuższe (`INERTIA_FALL_RATIO` w [`js/main.js`](js/main.js)). Krok liczy się z realnego
odstępu między klatkami, ograniczonego do 100 ms, żeby ukryta karta przeglądarki albo
zadyszka maszyny nie wyglądały jak sekunda smużenia.

Kolor bierze się z 256-stopniowej rampy między `rgb(142, 193, 172)` a `rgb(67, 71, 151)`,
spakowanej raz przy starcie. Piksel, który zbliży się do celu na mniej niż pół stopnia
rampy, jest do niego przyciągany — bez tego wykładniczy ogon liczyłby się
w nieskończoność. Przeliczenie wszystkich 15 360 poziomów, przy każdym w ruchu,
kosztuje ok. **0,065 ms**; osobno dochodzi malarz opisany niżej.

Panel, na którym nic się nie ruszyło i nic nie doszło do celu, nie jest przemalowywany
w ogóle — a nieruchomy ekran to stan, w którym Portfolio spędza większość czasu.

Suwak **System → Bezwładność ekranu** ustawia `τ` zapalania w zakresie 0–300 ms
i zapamiętuje wybór razem z resztą ustawień. Wartość `0` wyłącza cały model i wraca do
zwykłego przepisywania bitów — obraz jest wtedy ostry, tak jak w MAME. Domyślne 50 ms
jest dobrane na oko, a nie zmierzone na konkretnym egzemplarzu; matryce STN mocno
zależą zresztą od temperatury, więc suwak sięga wyżej, do wyraźnie wyziębionego ekranu.

Opisana wyżej pojedyncza wykładnicza to tylko jeden z czterech **kształtów narastania**
do wyboru w **System → Kształt narastania**. Suwak zostaje miarą czasu dla wszystkich,
a zmienia się sama droga punktu — dwa niezależne wybory skrzyżowane:

| | bez dociągania | z długim dociąganiem |
|---|---|---|
| **twardy start** | **0** — jedna wykładnicza, domyślny | **1** |
| **miękki start** (krzywa S) | **2** | **3** |

Miękki start to dwie wykładnicze w kaskadzie: druga goni pierwszą, więc przez moment nic
się nie dzieje, a potem punkt nabiera rozpędu. Długie dociąganie oddaje 45% drogi
składowej cztery razy wolniejszej (`RISE_SLOW`, `W_FAST`, `W_SLOW` w
[`js/main.js`](js/main.js)): punkt widać od razu, ale blady, a pełne nasycenie przychodzi
dużo później. Szybka część jest w obu kolumnach tą samą krzywą. Przy 50 ms pierwsza klatka
daje kolejno 28%, 19%, 8% i 8% czerni, a pełną czerń punkt osiąga po 316, 1250, 416
i 1250 ms; gaszenie we wszystkich czterech trwa o 60% dłużej niż zapalanie.

Kształty powstały jako próba dla testerów z prawdziwym Portfolio: miało wyjść, który
z dwóch efektów widać naprawdę. Testerzy zdecydowali, żeby wybór zostawić użytkownikom,
więc przełącznik zostaje i zapamiętuje się z resztą ustawień. Domyślne **0** to
model, który emulator miał, zanim był jakiś wybór.

## Siatka punktów

Punkt na matrycy nie styka się z sąsiadem: każdy ma własną elektrodę, a między nimi
biegnie niesterowana przerwa, przez którą widać samo podłoże panelu. Stąd widoczna na
szkle kratka — i stąd też decyzja, która przeorała rysowanie obrazu: **emulowany piksel
przestał być kwadratem jednego koloru**.

Płótno ma teraz bufor wymierzony w **pikselach urządzenia**, a nie w emulowanych.
Powód jest jeden i nie ma z nim dyskusji: przy powiększeniu systemowym 125% na jeden
punkt przypada 2,5 piksela ekranu. Kratka rozłożona na całe piksele wypadałaby raz co
dwa, raz co trzy, oba rytmy by się rozjeżdżały i przez panel przechodziłby prążek.
Dlatego przerwa rysowana jest **pokryciem**: dla każdego piksela urządzenia
[`js/ui/lcdgrid.js`](js/ui/lcdgrid.js) liczy, jaką jego część punkt naprawdę zakrywa,
a malarz przyciemnia go o tyle. Krawędź punktu wypadająca w połowie piksela daje piksel
w połowie ciemny — czyli to, co widać na szkle.

Wagi zależą wyłącznie od geometrii, więc liczą się raz na zmianę skali, a nie co klatkę.
Poziomo jeden piksel wyjściowy bierze najwyżej dwa punkty (piksel szerokości jednego
piksela nie zmieści się nad trzema, dopóki podziałka jest szersza niż on), pionowo tak
samo — więc rząd poziomów rozsypuje się wszerz raz, a potem dwa takie rzędy mieszają się
na każdy wiersz wyjściowy. Wewnątrz punktu ta mieszanka się nie zmienia, więc większość
wierszy to kopia poprzedniego i przepisuje się je zamiast liczyć: przy 4× na ekranie
o podwojonej gęstości pięć wierszy na osiem, co skraca klatkę o połowę.

Koszt, przy każdym z 15 360 punktów w ruchu (bezwładność + malarz, budżet klatki to
13,9 ms przy 72 Hz):

| skala / powiększenie | bufor | razem | budżetu |
|---|---|---|---|
| 2× / 100% | 480×128 | 0,27 ms | 2,0% |
| 2× / 125% | 600×160 | 0,48 ms | 3,4% |
| 3× / 100% | 720×192 | 0,58 ms | 4,2% |
| 4× / 100% | 960×256 | 0,70 ms | 5,1% |
| 3× / 200% | 1440×384 | 1,11 ms | 8,0% |
| 4× / 200% | 1920×512 | 1,43 ms | 10,3% |

Suwak **System → Siatka pikseli** ustawia szerokość przerwy jako udział w podziałce,
0–30%, i zapamiętuje wybór z resztą ustawień. **Wartość nie jest zmierzona na sprzęcie** —
dokumentacja nie podaje wymiarów matrycy, a bez nich każda liczba byłaby zmyślona;
domyślne 10% jest dobrane na oko wobec prawdziwego Portfolio, do porównania ze zdjęciem
własnego egzemplarza. Szersza przerwa nie jest obojętna dla jasności: przez kratkę
prześwituje tło, więc im jest szersza, tym bledszy wydaje się cały tekst. `0` zestawia punkty ze sobą i przy całkowitej liczbie pikseli na
punkt daje bufor **co do piksela taki**, jaki emulator rysował wcześniej — pilnuje tego
osobna kontrola w [`tools/tests/lcd-grid.mjs`](tools/tests/lcd-grid.mjs), bo sama
możliwość rysowania kratki nie ma prawa przestawić obrazu nikomu, kto jej nie chce.

Ubocznie znika przy tym starsza nierówność, której nie było po czym poznać: przy
ułamkowym powiększeniu `image-rendering: pixelated` zaokrąglało punkty do całych pikseli
ekranu, więc jedne wychodziły szersze od drugich. Teraz szerokość rozkłada się równo,
a resztki ułamka biorą na siebie półcienie.

Zestaw `tools/tests/lcd-grid.mjs` sprawdza rachunek pokrycia (ile atramentu dostaje
każdy punkt, przy dziesięciu podziałkach i pięciu przerwach), zgodność z dawnym
powielaniem punkt w punkt oraz sam skrót z przepisywaniem wierszy — ten ostatni przez
porównanie z malarzem liczącym każdy piksel osobno, bo pomyłka w skrócie nie zwalnia
programu, tylko cicho psuje obraz. Zestaw sprawdzono **dziesięcioma mutacjami**
w [`js/ui/lcdgrid.js`](js/ui/lcdgrid.js) — przerwa nierysowana, dwa razy za szeroka,
tylko z jednej strony punktu, pokrycie bez przycięcia do piksela, kopia wiersza
rozpoznawana po samych indeksach — i każda została złapana. Zestawów testowych jest
teraz trzydzieści dwa.

## Mapa pamięci

| Zakres | Zawartość |
|---|---|
| `00000h–1EFFFh` | RAM (128 KB minus 4 KB bufora ekranu) |
| `1F000h–AFFFFh` | niezamapowane, czyta się jako 0 |
| `B0000h–BFFFFh` | górne 4 KB RAM-u, powielone co 4 KB — bufor tekstowy zgodny z MDA |
| `C0000h–DFFFFh` | okno przełączane selektorem ROM_B (port `8051h`) |
| `E0000h–FFFFFh` | ROM BIOS/DOS |

Selektor ROM_B: `0` = ROM aplikacji, `2` = ROM zewnętrzny, `3` = karta wewnętrzna
(A:), `7` = karta na porcie rozszerzeń.

Cała 128-kilobajtowa RAM jest podtrzymywana bateryjnie — u nas trafia do IndexedDB
co 5 sekund oraz przy ukryciu karty przeglądarki. „Zimny start" czyści ją, co jest
odpowiednikiem wyjęcia baterii: **kasuje wszystkie pliki z dysku C:**.

## Mapa I/O

Dekodowane jest wyłącznie `80xxh` (po bitach 7:4) oraz `0061h`.

| Port | Odczyt | Zapis |
|---|---|---|
| `8000h` | kod klawisza | — |
| `8010h` / `8011h` | dane / status LCD | dane / instrukcja LCD |
| `8020h` | — | generator DTMF PCD3311T (nieemulowany) |
| `8030h` | — | zarządzanie zasilaniem (bit 1 = wyłącz) |
| `8040h` | licznik, młodszy bajt (2 Hz) | prędkość tiku (bit 0: 1 = 1 s, 0 = 128 s) |
| `8041h` | licznik, starszy bajt + źródło wybudzenia | ustawienie licznika, starszy bajt |
| `8050h` | stan przerwań (IP) | maska przerwań (IE) |
| `8051h` | stan baterii / PDET / ROM_B, bit 7 = włączanie | selektor magistrali ROM_B |
| `8060h` | — | kontrast LCD |
| `8070h–807Fh` | port rozszerzeń (BCOM) | port rozszerzeń (BCOM) |

### Otwarta magistrala i wykrywanie Portfolio

Odczyt portu I/O spoza zakresu `80xxh` zwraca **młodszy bajt numeru portu**.
To nie jest sztuczka, tylko fizyka 8088: linie AD0–AD7 są multipleksowane między
adres a dane, więc gdy przy odczycie żadne urządzenie nie steruje szyną, zostaje
na niej ostatnio wystawiony młodszy bajt adresu — i to on wraca do procesora.

Oprogramowanie na Portfolio wykorzystuje to do wykrywania maszyny. FoliDash robi:

```asm
MOV DX, 0060h
IN  AL, DX
CMP AL, DL        ; DL = 60h
JZ  ok
                  ; inaczej: "Fatal error: Atari Portfolio not detected!"
```

MAME koduje na sztywno tylko jeden przypadek, na który trafił — port `0061h`
zwracający `61h`, z komentarzem *„Magic port to detect the Pofo"*. To ta sama
reguła zaobserwowana raz; tutaj jest uogólniona, więc `0061h` wychodzi z niej
sam z siebie. **To świadome odejście od modelu MAME.**

Wewnątrz okna `80xxh` nierozpoznane podadresy zwracają zero, tak jak w MAME —
brak przesłanek, żeby było inaczej.

### Identyfikatory peryferiów (PID)

Peryferium kończące magistralę zgłasza się bajtem czytanym spod `807Fh`. DIP
rozpisał pulę tak (przewodnik techniczny, str. 2-20):

| PID | Peryferium |
|---|---|
| `00h` | karta komunikacyjna |
| `01h` | port szeregowy — **emulowany** (HPC-102) |
| `02h` | port równoległy — **emulowany** (HPC-101) |
| `03h` | drukarka |
| `04h` | modem |
| `05h`–`3Fh` | zarezerwowane dla DIP-a |
| `40h`–`7Fh` | peryferia obce, do przydziału przez Atari |
| `80h` | interfejs transferu plików |
| `81h`–`FFh` | zarezerwowane |

Emulator implementuje dwa środkowe. Reszta jest tu po to, żeby przy dokładaniu
kolejnych peryferiów nie zgadywać numeru — i żeby nie wziąć wartości z zakresu
zastrzeżonego.

Do peryferiów udających port szeregowy albo równoległy BIOS ma osobną furtkę:
`INT 61h` `1Bh` (*Set Peripheral ID byte*) każe mu traktować cudzy identyfikator
jak jeden z tych dwóch.

## Przerwania

Nie ma 8259. ASIC ma czterobitowe rejestry IP (pending) i IE (enable); linia INT0
procesora jest aktywna, gdy `IP & IE ≠ 0`. Przy potwierdzeniu przerwania ASIC
zwraca wektor pierwszego ustawionego bitu i go kasuje:

| Bit | Źródło | Wektor |
|---|---|---|
| 0 | tick systemowy | `08h` |
| 1 | klawiatura | `09h` |
| 2 | błąd | `00h` |
| 3 | zewnętrzne (port rozszerzeń) | z peryferium |

Przerwanie ticku systemowego chodzi **z prędkością, o którą prosi maszyna**. Wbrew
temu, co pisaliśmy tu wcześniej, **nie ma trybu 128 Hz**: dokumentacja DIP-a podaje
dwie prędkości — **raz na sekundę** albo **raz na 128 sekund** — i wybiera się je
funkcją `INT 61h`, podfunkcją `1Eh` (*Get/Set Clock tick speed*, str. 3-14 i 3-31
przewodnika technicznego). Rejestrem, który za tym stoi, jest **zapis do `8040h`**:
`01h` wybiera tik co sekundę, `00h` — co 128 sekund. Namierzono go, logując zapisy
do portów w trakcie tego wywołania; przez cały rozruch, kilka poleceń DOS-u i 20 s
bezczynności port dostaje dokładnie jeden zapis — `00h` wysyłane przez BIOS spod
`E000:0322`, czyli wybór trybu wolnego, oszczędzającego baterie. Nic innego z tego
portu nie korzysta i dlatego młodsza połówka czytana jest jako wybór prędkości,
a nie jako młodszy bajt licznika.

Dopiero znajomość prędkości pozwoliła **oprzeć tik o wybraną prędkość**. Wcześniej był
wyłączony, bo tykanie co sekundę programowi, który poprosił o tryb wolny, byłoby
128 razy za częste; teraz emulator po prostu podąża za wyborem maszyny. Przełącznik
w interfejsie wycisza przerwanie zupełnie, dla tych, którzy tego chcą.

## Zarządzanie energią

Prawdziwe Portfolio samo odcina zasilanie po kilku minutach bez naciśnięcia klawisza.
**Nie robi tego ROM, tylko układ ASIC** — ustalone dezasemblacją pętli oczekiwania
BIOS-u pod `E000:143F`:

```asm
143F: STI
1440: MOV  DX, 8030h      ; rejestr sterowania zasilaniem
1443: MOV  AL, 0
1445: OUT  DX, AL         ; wejście w stan czuwania
1446: HLT                 ; zatrzymanie procesora do przerwania
1447: NOP
1448: TEST byte [0125], 80h
144D: JZ   143F           ; kręć się, dopóki bit 7 nie zapłonie
```

Bit 7 bajtu `0040:0125` ustawia **dokładnie jedno miejsce w całym BIOS-ie**
(`E000:1553`) i jest to ścieżka klawiatury: przez 30 sekund bezczynności wykonuje się
zero razy, po naciśnięciu klawisza dwa razy. W tej pętli **nie ma żadnego odliczania
czasu** — gdyby wyłączenie zależało od ROM-u, musiałoby być właśnie tutaj.

Emulacja odwzorowuje więc licznik układu, a nie kod: zapis do `8030h` z wyzerowanym
bitem 1 uzbraja czuwanie, aktywność klawiatury kasuje odliczanie, a po przekroczeniu
zadanej liczby granic 128-sekundowych maszyna gaśnie. Granica bierze się z tego samego
licznika 2 Hz co reszta czasomierzy (256 zliczeń = 128 s), więc realny czas do uśpienia
zależy od fazy — przy dwóch okresach wypada **między 128 a 256 s**, dokładnie jak
opisuje to dokumentacja DIP-a. Na egzemplarzu autora zmierzono ok. 230 s, w emulatorze
wychodzi typowo 251 s.

Po uśpieniu **procesor stoi, a ekran gaśnie** — to jest odcięcie zasilania, nie pauza.
**Budzi dowolny klawisz**: procesor nie został zatrzymany w połowie instrukcji, tylko
czeka na `HLT` wewnątrz tamtej pętli, więc wznowienie plus przerwanie klawiatury
wystarczą, żeby sesja potoczyła się dalej od tego samego miejsca.

Odliczanie biegnie **wyłącznie wtedy, gdy procesor faktycznie stoi** — bo tym właśnie
jest czuwanie. Program, który liczy, jest w trybie RUN i nie podlega wyłączeniu:
demo grające kilka minut bez czekania na klawisz dochodzi do końca nietknięte,
a odliczanie rusza dopiero, gdy wróci prompt. Sprawdzone na Nucleusie — gra 321 s
z procesorem ani razu niezatrzymanym, wraca do `a>`, i dopiero 182 s później maszyna
gaśnie. Przy okazji odtwarza to zachowanie, które DIP opisuje osobno: program
odpytujący klawiaturę w pętli zamiast czekać na `INT 16h` **nigdy** nie pozwoli
maszynie zasnąć.

Wybór należy do użytkownika — **System → Zasypianie po bezczynności** — bo wierność ma
tu cenę: emulator zostawiony w otwartej karcie gaśnie w trakcie czytania. Domyślnie
ustawione tak jak w prawdziwym Portfolio.

Polecenie `OFF` to osobna droga i głębszy sen. Przewodnik DIP-a rozdziela te dwa stany
w sekcji 2.5.1: w czuwaniu wszystko jest zasilane, a wstrzymany zostaje tylko zegar
`CCLK`, natomiast w trybie OFF napięcie ma już wyłącznie układ ASIC i pamięć RAM.
Procesora nie ma więc czego wznawiać — powrót idzie przez impuls `MRST`, czyli sprzętowy
ciepły restart, i tak też robi to emulator. Sesja wraca w całości: RAM jest przez cały
czas podtrzymywany, więc dysk `C:` i to, co było na ekranie, przeżywają wyłączenie.

## Co zimny start zostawia w pamięci

Prawdziwe Portfolio budzi się z pamięcią pełną resztek. Komórki trzymają ładunek
jeszcze chwilę po wyjęciu baterii, więc to, co program tam zastaje, nie jest ani
zerami, ani dwa razy takie samo — a program, który czyta pamięć, zanim cokolwiek do
niej zapisze, zachowuje się przez to na sprzęcie inaczej niż w emulatorze dającym
równiutkie zera. Różnicy nie widać, dopóki nie zaboli.

**System → Zimny start z losową pamięcią RAM** wypełnia pamięć główną i własną pamięć
matrycy z generatora systemowego, więc dwa zimne starty przestają być identyczne.
Działa od następnego zimnego startu, a nie od chwili przestawienia: przesypywanie
pamięci pod działającym programem niczego by nie odtworzyło, tylko by go wywróciło.
Pamięci rozszerzenia — dysku B: — opcja nie rusza, tak samo jak zwykły zimny start.
Domyślnie włączone, bo maszyna ma zachowywać się jak sprzęt.

Czego ta opcja **nie** robi, to niczego nie naprawia. To narzędzie do odtwarzania
usterek, nie do ich leczenia — a usterka, dla której powstała, akurat do nich nie
należy. Program, dla którego opcja powstała, zmierzono na pełnym, 560-sekundowym
przebiegu, próbkując matrycę co dwie sekundy, i wszystkie 280 próbek wychodzi bit w bit
tak samo przy pamięci wyzerowanej i losowej. Cokolwiek robi on inaczej na prawdziwym
sprzęcie, nie zależy to od tego, co było wcześniej w pamięci.

## Klawiatura

63-klawiszowa matryca 8×8. ASIC podaje BIOS-owi **fizyczny** kod
`wiersz × 8 + kolumna`, z bitem 7 oznaczającym zwolnienie klawisza; dopiero INT 09h
tłumaczy go na kod PC. Dlatego programy czytające port `60h` na Portfolio nie działają.

Zdarzenia są kolejkowane i wydawane w tempie 600 Hz, tak jak skanuje prawdziwy układ.
Mapowanie jest pozycyjne; wyjątki:

| Portfolio | PC |
|---|---|
| Atari | `` ` `` |
| Fn | `F1` |
| Lock | `Caps Lock` |
| Del/Ins | `Delete` lub `Insert` |

Portfolio ma — jak laptop — nakładkę klawiatury numerycznej, nadrukowaną małym drukiem
na `U I O`, `J K L` i sąsiednich klawiszach. Przełącza ją **Atari + Lock**, czyli
w emulatorze `` ` `` + `Caps Lock`. Warto to wiedzieć, zanim się przyda: włączona
przypadkiem sprawia, że litery zaczynają wypisywać cyfry, a maszyna nie daje po sobie
poznać dlaczego. Osobnego klawisza Num Lock w matrycy nie ma — cały zatrzask siedzi
w obsłudze `INT 09h` w ROM-ie, a emulator tylko przepuszcza kombinację.

### Kiedy przeglądarka nie zgłasza modyfikatora

Skoro do ROM-u idą **kody**, a nie znaki, emulator rozpoznaje klawisz po `e.code`, czyli
po położeniu, a nie po tym, jaki znak z niego wychodzi. Dwukropka nie składa więc
przeglądarka, tylko Portfolio: dostaje kod Shiftu i kod średnika, i resztę robi samo.

Założenie, że każdy klawisz przychodzi jako zdarzenie, okazało się jednak za mocne.
**LibreWolf** (Firefox 154 z domyślnie włączonym `resistFingerprinting`) nie wysyła dla
Shiftu ani `keydown`, ani `keyup` — za to ustawia `shiftKey` przy każdym innym klawiszu.
Kod 27 nigdy nie wychodził, `Shift`+`;` docierał do DIP-DOS-u jako goły średnik i nie
dawało się zmienić napędu.

Dlatego źródłem prawdy jest **flaga, nie klawisz**: przed wysłaniem każdego klawisza
`js/ui/hostkeys.js` porównuje `shiftKey`, `ctrlKey` i `altKey` z tym, co trzyma matryca,
i różnicę uzupełnia zastępczym naciśnięciem — koniecznie *przed* właściwym klawiszem, bo
ROM czyta kody po kolei. Przeglądarki, które modyfikator zgłaszają, na tę ścieżkę nigdy
nie trafiają. Pilnuje tego `tools/tests/hostkeys.mjs`, odtwarzając prawdziwe zdarzenia
z obu przeglądarek.

### Powtarzanie trzymanego klawisza

Powtarzanie siedzi w modelu ASIC-a, a nie w warstwie przeglądarki, i wynika to z pomiaru
na samym ROM-ie. BIOS Portfolio **nie ma własnego powtarzania**: karmiony samymi kodami
naciśnięcia co 100 ms wypisuje równo dziesięć znaków na sekundę, a karmiony jednym kodem
i ciszą wypisuje jeden znak, choćby klawisz był trzymany bez końca. Znak powstaje z kodu,
nie ze stanu klawisza — więc powtarzanie musi powstawać poniżej BIOS-u.

Umieszczenie go tam ma jeszcze jedną zaletę: tempo nie zależy od ustawień systemu
użytkownika, więc emulacja chodzi wszędzie tak samo i daje się przetestować bez
przeglądarki. Powtarza się tylko klawisz naciśnięty jako ostatni; modyfikatory, blokady
i klawisz Atari nie powtarzają się wcale, bo żaden z nich nie daje znaku.

**Tempo nie jest zmierzone.** Pół sekundy zwłoki i dziesięć powtórzeń na sekundę to
domyślne wartości IBM PC, wstawione po to, żeby zachowanie w ogóle istniało — nikt nie
mierzył ich na prawdziwym Portfolio. Obie liczby są opisane jako tymczasowe w nagłówku
`js/emu/keyboard.js`, a `tools/tests/key-repeat.mjs` pilnuje **mechanizmu**, nie tempa:
że powtarzanie zaczyna się po zwłoce, idzie równo, słucha zwolnienia, przechodzi na nowo
naciśnięty klawisz i przeżywa zapis stanu.

## Karty pamięci

Karta to nośnik wymienny, widoczny jako napęd **A:** (i **B:** z rozszerzeniem
HPC-104). DIP-DOS formatuje ją tak, że wolumin ma zawsze 256 sektorów, a rośnie
**rozmiar sektora**, nie ich liczba:

| karta | sektor | sektorów | wpisów w katalogu | sektorów FAT | pojemność |
|---|---|---|---|---|---|
| 32 KB | 128 B | 256 | 32 | 3 | 31 232 B |
| 64 KB | 256 B | 256 | 64 | 2 | 62 720 B |
| 128 KB | 512 B | 256 | 128 | 1 | 125 952 B |
| 256 KB | 512 B | 511 | 128 | 2 | 256 000 B |

Ostatni wiersz wyłamuje się dwa razy. **Okno karty w mapie procesora ma 128 KB
i nie rośnie** — większa karta składa się ze stron po 128 KB, przełączanych
zapisem numeru strony pod offset `000Ah` okna (przewodnik DIP-a, sekcja 2.3.5;
stąd jego ostrzeżenie, że *żadne* oprogramowanie nie może używać tego bajta).
Na karcie mieszczącej się w oknie żadnego zatrzasku nie ma i bajt jest zwykłą
pamięcią — trzyma tam spację z nazwy OEM „DIP 2.0 ".

Druga osobliwość: **wolumin nie leży na stronach płasko**. Zmierzone na obrazie
zapisanym przez sam ROM — plik, którego wpis katalogowy wskazuje klaster 386,
czyli sektor 395 według BPB, leży fizycznie w sektorze 397. Na każdej granicy
z woluminu wypada kilobajt, czyli dwa sektory, a *które* dwa — odczytano z ROM-u,
patrząc, po jakich adresach chodzi, czytając plik przez granicę: sektor woluminu
254 bierze ze strony 0 spod `1FC00h` i przechodzi od razu na stronę 1 pod
`200h`. Wypada więc sektor **ostatni** strony razem z **pierwszym** strony
następnej — nie dwa pierwsze strony następnej, jak przyjmowano, dopóki nie
trafiło się demo, które to zauważyło. Świeżo sformatowana karta zostawia oba
nietknięte. Ostatni klaster, który BPB jeszcze zlicza, wypada już poza kartę
i nie jest przydzielany.

Obie strony tego są sprawdzane zestawem `cards`: czy maszyna czyta obraz zbudowany
tutaj i czy nasz czytnik trafia w to, co zapisał ROM — dla wszystkich obrazów
z katalogu `cards/` oraz dla karty 256 KB z plikiem po drugiej stronie granicy.


Karta jest bankowana w okno `C0000h–DFFFFh` w miejsce ROM-u aplikacji. Emulacja jest
**na poziomie sprzętu**, więc INT 13h obsługuje oryginalny sterownik z ROM-u — działają
zwykłe obrazy kart, bez żadnych hooków. Karty mniejsze niż 128 KB są powielane w oknie,
tak jak na prawdziwym sprzęcie.

Karta RAM jest zapisywalna, karty ROM/OTPROM należy oznaczyć jako tylko do odczytu.
Obraz jest trzymany w IndexedDB i można go pobrać przyciskiem.

Geometria nie jest naszym wymysłem: została zdjęta z obrazów, które wyprodukowało
`FORMAT A:` z oryginalnego ROM-u — także ta dla 256 KB, razem z przesunięciem na granicy
stron. Tak formatuje `js/ui/fat12.js`.

### Karta może być rozszerzeniem ROM-u

Pierwsze 128 bajtów karty ROM może zawierać kod, który **BIOS wykona przy starcie** —
mechanizm rozszerzeń DIP-a. Decyduje o tym słowo pod offsetem 0:

| Słowo | Kiedy uruchamiany |
|---|---|
| `AA55h` | po inicjalizacji BIOS-u |
| `55AAh` | po inicjalizacji DOS-u |
| `5555h` | wielokrotnie: przed i po BIOS-ie i DOS-ie, przed procesorem poleceń oraz przy zasypianiu i budzeniu |

Dalej idą wektory skoków, ułożone tak, żeby nie kolidowały z blokiem parametrów BIOS
(BPB) — karta może być więc jednocześnie rozszerzeniem i zwykłym dyskiem. Rozszerzeń
szuka się kolejno na A:, potem w ROM-ie peryferium, potem na B:.

Emulator nie musi nic z tym robić — kod wykonuje oryginalny ROM. Warto natomiast
wiedzieć o tym przy budowaniu obrazów kart: **karta, której pierwsze słowo przypadkiem
trafi w jedną z tych trzech wartości, zostanie uruchomiona jako program**. Obrazy
z `fat12.js` powstają z prawdziwego sektora rozruchowego DIP-DOS-u, więc problem
nie dotyczy kart formatowanych tutaj.

Drugi drobiazg do zapamiętania: bajt pod offsetem `0Ah` sektora rozruchowego jest
zarezerwowany na rejestr stron dla kart większych niż 128 KB. Nic tam nie wolno pisać.

### Autostart z karty

`AUTOEXEC.BAT` z karty ma pierwszeństwo przed tym z dysku `C:`, a **B: wygrywa z A:**,
jeśli plik jest na obu. Żeby mimo karty wykonał się ten z `C:`, kończy się plik na
karcie poleceniem `C:AUTOEXEC`. `CONFIG.SYS` czyta się **zawsze i wyłącznie** z `C:`
i nie da się tego nadpisać.

### Wgrywanie własnego oprogramowania

Panel karty ma wbudowany menedżer plików FAT12, więc nie trzeba niczego formatować
z poziomu DOS-u:

1. **Utwórz i sformatuj** kartę (32, 64 albo 128 KB).
2. **Dodaj pliki…** — wybierz pliki z dysku; trafiają do katalogu głównego karty.
3. **Reset** — DOS trzyma FAT w pamięci podręcznej, więc po zmianie zawartości
   karty z poziomu hosta trzeba go przeładować.
4. W emulatorze: `A:` żeby przejść na kartę, albo `COPY A:\*.* C:\` żeby przegrać
   pliki na dysk wewnętrzny.

Pliki z karty można też pobrać z powrotem na host (przycisk „pobierz" przy każdej
pozycji) oraz zapisać cały obraz przyciskiem „Pobierz obraz".

Nazwy są konwertowane na 8.3 wielkimi literami; niedozwolone znaki zamieniane na `_`.
Katalog główny mieści 32 / 64 / 128 pozycji zależnie od rozmiaru karty.

`formatCard()` w [`js/ui/fat12.js`](js/ui/fat12.js) odtwarza format **bajt w bajt**
identyczny z tym, co zapisuje `FORMAT A:` z ROM-u — sprawdzone dla wszystkich trzech
rozmiarów. `FORMAT A:` z poziomu DOS-u też oczywiście działa.

### Karta EPROM

Strona [`eprom.html`](eprom.html) przygotowuje obraz do wypalenia w EPROM-ie karty
Portfolio. Okno karty ma 128 KB, więc większy układ — 27C020, 27C040, 27C080 — dzieli się
na **banki** po 128 KB: każdy to osobny wolumin z własnymi plikami, a który z nich widzi
Portfolio, wybiera karta. Strona składa banki w jeden plik `.epr` dla programatora,
w miejsce dawnego `copy /b bank1.epr + bank2.epr + … eprom.epr`.

Układ banku nie jest wymyślony tutaj. Odtwarza program **DISK zu EPROM Konverter**
(SWB 1992, Harun Scheutzow dla tri tec) z Atari ST, który przepisywał na EPROM dyskietkę
ST sektor po sektorze i poprawiał tylko to, czego wymaga Portfolio — jego komunikaty
mówią to wprost: jedna FAT, prawdziwa liczba sektorów na nośniku („sonst spinnt der PF”)
oraz 8 sektorów na ścieżkę i 2 strony („anderes erkennt der PF nicht”). Stąd:

| | |
|---|---|
| sektor rozruchowy | nagłówek dyskietki ST (`E9 00`, `NNNNNN`, numer seryjny), BPB: 512 B, 256 sektorów, media `F9h` |
| klaster | 2 sektory, 1 KB — 126 klastrów na bank |
| katalog główny | przycięty do zawartości: 15 pozycji, potem 47, 79, 111; każdy krok kosztuje 1 KB |
| dane | ciągiem, w kolejności katalogów: katalog, potem jego zawartość |
| ostatni sektor | kopia sektora rozruchowego, poza wszystkimi klastrami |

Zgodność sprawdzono na trzech bankach, które konwerter z ST zrobił z prawdziwych
katalogów: zbudowane tu od nowa z tych samych plików mają ten sam sektor rozruchowy, tę
samą kopię na końcu, tę samą FAT i te same wpisy katalogów co do klastra. Różnią się
tylko tym, co ST zostawiał przypadkiem: śmieciami w końcówkach klastrów i usuniętymi
wpisami (`E5h`) w katalogu głównym. DIP-DOS w emulatorze czyta je jak zwykłą kartę
i uruchamia z nich programy.

**Wczytaj katalog jako bank** robi to, co przygotowanie dyskietki na ST: zawartość
katalogu ląduje w korzeniu banku, a nazwa katalogu zostaje etykietą. Katalogi upuszczone
na pole banku stają się podkatalogami. Długie nazwy skracane są do 8.3 (`~1` przy
kolizji), daty idą z plików. Gotowy obraz `.epr` — także zrobiony dawniej na ST
i sklejony `copy /b` — da się wczytać z powrotem i podmienić jeden bank. Każdy bank
można też pobrać osobno i wgrać w emulatorze jako kartę A:, zanim trafi do EPROM-u.

Logika siedzi w [`js/eprom/epr.js`](js/eprom/epr.js), bez DOM-u, i pilnuje jej
`tools/tests/eprom.mjs`: pola BPB, kolejność klastrów, pojemność i jej granice, nazwy
8.3, odczyt kart DIP-DOS, DIR w emulatorze — a jeśli w `epr/` leżą banki z konwertera
ST (katalog poza repozytorium), także zgodność z nimi.

### Uwaga o miejscu na C:

Dysk wewnętrzny `C:` to RAM-dysk w tej samej 128-kilobajtowej pamięci — zostaje na nim
około **31 KB**. Większe programy trzeba uruchamiać wprost z karty (`A:`), a nie
przegrywać na `C:`.

## Interfejs równoległy (HPC-101)

82C55A + Centronics na porcie rozszerzeń:

| Port | Rola |
|---|---|
| `8078h` | port A — linie danych |
| `8079h` | port B — sterowanie: `~STROBE`, `~AUTOFD`, `~INIT`, `~SELECT_IN` |
| `807Ah` | port C — status: `PERROR`, `SELECT`, `~FAULT`, `BUSY`, `~ACK` |
| `807Bh` | rejestr sterujący 8255 |
| `807Fh` | ID peryferium — zwraca `02h` (port równoległy) |

Każdy bajt zatrzaśnięty opadającym zboczem `~STROBE` trafia do bufora; przycisk
„Zakończ wydruk" zamienia go w `Blob` i pobiera jako plik. Handshake `BUSY`/`~ACK`
jest emulowany, żeby pętle odpytujące w BIOS-ie się nie zawieszały.

Przetestowane: `DIR > PRN` z poziomu DIP-DOS-u.

## Transfer plików

Ten sam kabel obsługuje drugie zadanie: przenoszenie plików do **działającego**
systemu, bez resetu i bez przebudowywania obrazu karty. ROM przełącza kierunki
portów 82C55A zależnie od zadania — `89h` przy drukowaniu, `92h` przy transferze.

W Portfolio: przytrzymaj Atari i wciśnij <kbd>S</kbd> → **File transfer** →
**Server**. Pojawi się `Waiting for connection`. Potem w panelu *Port równoległy*
wybierz **Wyślij pliki…**.

### Protokół

Dwie linie w każdą stronę, transmisja bit po bicie, **od najstarszego bitu**,
po jednym bicie na **każde zbocze** zegara:

| Linia | Kierunek | Rola |
|---|---|---|
| port A bit 0 | host → Portfolio | dane |
| port A bit 1 | host → Portfolio | zegar |
| port C bit 0 | Portfolio → host | zegar |
| port C bit 1 | Portfolio → host | dane |

Blok: host czeka na `5Ah` (gotowość), wysyła `A5h`, długość LSB/MSB, dane i sumę
kontrolną będącą dopełnieniem do dwóch sumy długości i danych; Portfolio odsyła tę
samą sumę jako potwierdzenie. Komendy: `03h` wyślij plik, `02h` pobierz plik,
`06h` lista katalogu. Odpowiedzi: `21h` = pliku nie ma (przy wysyłaniu to sukces),
`20h` = plik istnieje.

Dwie rzeczy krytyczne dla działania: **50 µs przerwy przed każdym bajtem** oraz
**50 ms po odebraniu sygnału gotowości**, zanim wyśle się `A5h`. Pętle oczekiwania
w ROM-ie mają timeout około 10 ms, więc dłuższe pauzy w środku bloku go rozbijają.

Jedna korekta wobec publikowanej dokumentacji: opisuje ona sygnał bezczynności jako
sekwencję `5A 69 A5 96`. Pomiar zapisów portu C pokazał, że Portfolio nadaje
**samo `5Ah` w kółko** — pozostałe trzy wartości to to samo `5Ah` odczytane przy
przesuniętej fazie.

## Interfejs szeregowy (HPC-102)

82C50A na porcie rozszerzeń. Ponieważ obie płytki odpowiadają na to samo zapytanie
o identyfikator, w emulatorze — jak i na biurku — można mieć podłączoną tylko jedną
naraz.

| Port | Rola |
|---|---|
| `8070h`–`8077h` | rejestry UART-u (offset `& 7`) |
| `807Fh` | odczyt: ID peryferium, `01h` = port szeregowy; zapis: rejestr wektora przerwania |

Peryferium nie ma stałego wektora — sterownik sam wpisuje pod `807Fh` numer, który
ASIC ma podać procesorowi przy potwierdzeniu `EINT`. Rejestr wektora (SIVR) jest
**tylko do zapisu**; ten sam adres odczytany zwraca identyfikator peryferium.

Złącze to **9-pinowe D-Sub, okablowane jak DTE** — czyli tak samo jak port COM
w pececie (przewodnik techniczny, str. 4-1):

| Pin | Sygnał | | Pin | Sygnał |
|---|---|---|---|---|
| 1 | CD — wykrycie nośnej | | 6 | DSR — gotowość urządzenia |
| 2 | RD — odbiór danych | | 7 | RTS — żądanie nadawania |
| 3 | TD — nadawanie danych | | 8 | CTS — gotowość do nadawania |
| 4 | DTR — gotowość terminala | | 9 | RI — sygnał dzwonienia |
| 5 | GND — masa | | | |

Praktyczny wniosek: **do peceta potrzebny jest kabel null-modem**, bo dwa złącza DTE
połączone kablem prostym nadają sobie nawzajem na wejścia. Minimum to `2↔3`, `3↔2`,
`5↔5`; warto skrzyżować też `7↔8` i `4↔6`. Prędkość transmisji dzieli się z zegara
**1,8432 MHz**.

Zmierzone na oryginalnym ROM-ie:

- po starcie linia stoi na **2400 8N1**, z podniesionymi DTR i RTS;
- `ECHO coś > AUX`, `DIR > AUX` i `COPY AUX PLIK.TXT` działają bez żadnego
  sterownika — `AUX` obsługuje BIOS;
- Setup → **RS-232 port** pozwala wybrać 9600/4800/2400/1200…, ale zmiana trafia do
  układu dopiero po pozycji **Initialize!** (wybór 4800 → dzielnik 24);
- `CTTY AUX` **nie działa**: DIP-DOS 2.11 nie ma tego polecenia wewnętrznego, więc
  konsoli na linii szeregowej nie da się dostać z samego ROM-u;
- `COPY PLIK.TXT AUX` **nie dopisuje** `1Ah` na końcu, a przełącznika `/A` ta wersja
  COPY nie zna — odbierający koniec trzeba domknąć znakiem końca pliku z zewnątrz
  (przycisk „Zakończ odbiór”);
- `COPY AUX …` przerywa się komunikatem `Not ready error` po **ok. 4,25 s ciszy** —
  tak samo przed pierwszym bajtem, jak i w środku strumienia (przerwy 3 s przechodzą,
  4 s już nie). Limit stoi w bajcie `0040:007C`, czyli na pozycji COM1
  w standardowej tablicy timeoutów RS-232 obszaru danych BIOS-u, i skaluje się
  liniowo: `01h` (domyślnie) → 4,25 s, `02h` → 8,5 s, `08h` → 34 s. BIOS przywraca
  tam `01h` przy każdym starcie, więc panel *Port szeregowy* utrzymuje wybraną
  wartość, zamiast wpisać ją raz. Pojedynczy zapis wystarcza jednak w zupełności
  i trzyma się do restartu — na tym stoi `tools/auxwait.com` (76 bajtów,
  `AUXWAIT 14` → ok. minuta), który działa również na prawdziwym sprzęcie.

### Dławienie wysyłki

Odbiornik 82C50A trzyma **jeden bajt** — kolejki FIFO doczekał się dopiero 16550 —
a DIP-DOS odpytuje go programowo, w pętli. Przy 9600 na znak przypada 1,04 ms i tyle
zostaje na jego odebranie; kiedy system akurat dopisuje dane do pliku, następny bajt
nadpisuje poprzedni i przepada bez śladu. Emulator tego nie widzi po swojej stronie,
bo przed jednobajtowym rejestrem ma nieograniczoną kolejkę programową
(`rxQueue` w [`js/emu/ins8250.js`](js/emu/ins8250.js)) — paczka, która zatyka prawdziwą
maszynę, wchodzi tu bez śladu. Dopiero prawdziwe Portfolio na drugim końcu Web Serial
pokazuje różnicę.

Panel *Port szeregowy* ma więc **opóźnienie nadawania** w milisekundach na znak i na
linię — odpowiednik *Transmit delay* z Tera Term. Kolejka siedzi w `SerialHub`
([`js/ui/serial.js`](js/ui/serial.js)) i obejmuje oba źródła naraz: to, co wysyłasz
ręcznie „na linię”, i to, co nadaje emulowane Portfolio przez `AUX`. Zasady:

- **0 i 0 wyłącza wszystko** — bajty idą do backendu tym samym wywołaniem co dotąd,
  bez kolejki i bez ani jednego licznika czasu;
- przy niezerowym opóźnieniu na znak z kolejki schodzi **jeden bajt na krok**; przy
  zerowym, a niezerowym opóźnieniu na linię — **cała linia jednym zapisem**;
- pauza za koniec linii przypada **raz na CRLF**, nie dwa razy: nalicza ją LF albo CR,
  po którym nie idzie LF;
- emulowanej maszyny to **nie zatrzymuje** — ona kończy swoje `COPY` dużo wcześniej,
  niż bajty zejdą z kolejki, więc panel pokazuje obok liczników **`w kolejce`**;
- rozłączenie kolejkę **porzuca**, a wyzerowanie opóźnień dosyła resztę od razu.

Sprawdzone w praktyce ustawienie to **15 ms/znak i 15 ms/linia**.

Wysyłka pliku „na linię” dostaje własne okno: pasek postępu, procent i szacowany czas
do końca — liczony z tego, co naprawdę zeszło z kolejki, więc zmiana opóźnień w trakcie
transferu go nie psuje. Okna nie da się w trakcie zamknąć przypadkiem; kończy je
**Przerwij**, porzucając resztę, a zerwanie połączenia jest zgłaszane osobno. Postęp
prowadzi `SerialHub.sendJob()`, bo tylko kolejka wie, co faktycznie poszło na kabel:
bajty stojące w niej **przed** wysyłką nie liczą się do jej postępu, a dorzucone **za**
nią przez emulowane Portfolio go nie zawyżają.

### Drugi koniec kabla

Host trzyma UART w workerze, a to, co jest po drugiej stronie, wybiera się w panelu
*Port szeregowy* (`js/ui/serial.js`):

| Tryb | Co robi |
|---|---|
| Terminal | konsola tekstowa w stronie; podgląd ruchu działa też w pozostałych trybach |
| Web Serial | prawdziwy port RS-232 hosta przez `navigator.serial` (Chrome/Edge, HTTPS albo localhost) |
| Modem | modem AT, który zamiast dzwonić otwiera WebSocket |
| Null-modem | druga karta przeglądarki przez `BroadcastChannel` — dwa emulowane Portfolio połączone kablem |

Modem rozumie `ATZ`, `ATE0/1`, `ATV0/1`, `ATH`, `ATO`, `ATI`, `ATDT host:port`,
escape `+++` i zgłasza `CONNECT` / `NO CARRIER`, sterując przy tym linią DCD;
pozostałe komendy `AT…` kwituje `OK`, tak jak robi to modem, którego oprogramowanie
terminalowe nie zna.

Ponieważ przeglądarka nie otworzy gniazda TCP, w `tools/ws-tcp-proxy.mjs` jest
bezzależnościowy mostek WebSocket→TCP:

```
node tools/ws-tcp-proxy.mjs --allow bbs.example.com:23
```

Bez `--allow` nic nie jest osiągalne i to jest celowe: proxy, które łączy się
gdziekolwiek, jest otwartą przekaźnią do sieci, w której stoi.

Port 23 to nie surowy strumień bajtów, tylko telnet: druga strona wita się
negocjacją opcji (`FF FB 03 FF FB 01 …`), którą program terminalowy z 1989 roku
wypisałby jako śmieci, a część BBS-ów czeka z powitaniem na odpowiedź. Proxy
prowadzi więc ruch przez filtr NVT i odpowiada za Portfolio:

| Opcja | Odpowiedź |
|---|---|
| `TTYPE` | `WILL`, w podnegocjacji zgłasza `ASCII` (`--term`) |
| `NAWS` | `WILL` + rozmiar `40×8`, czyli tyle, ile ma LCD |
| `SGA`, `BINARY` | `WILL` / `DO` — znak po znaku, bez trybu liniowego |
| `ECHO` | `DO`, echo robi host |
| pozostałe | `WONT` / `DONT` |

Uzgodniony stan każdej opcji jest zapamiętywany, bo na tym polega ochrona przed
pętlą negocjacji z RFC 854: nigdy nie odpowiadać tym, co się już powiedziało.
Bajt `FFh` idący od Portfolio jest podwajany. `--telnet off` wyłącza całą warstwę
i zostawia surową rurę, potrzebną przy usługach, które telnetem nie są.

### Tryb ASCII

Domyślnie proxy wycina ze strumienia sekwencje ANSI; `--ascii off` je zostawia.

Zgłoszony typ terminala nic tu nie daje i zostało to zmierzone: Synchronet
przyjmuje `TTYPE IS "ASCII"` w podnegocjacji i mimo to odsyła **dokładnie ten
sam** strumień co przy `ANSI`, co do bajta. Oba silniki ignorują `TTYPE`
i zamiast tego sondują terminal — parkują kursor na 255,255 i pytają, gdzie
wylądował:

```
ESC[s  ESC[255B  ESC[255C  ESC[6n  ESC[u
```

ACOM nigdy nie odpowiada, więc board czekający na odpowiedź sam schodzi do
ASCII — tyle że ekran powitalny poszedł już w kolorze, a ACOM nie interpretuje
escape'ów i wypisuje je dosłownie, jako `[0;1;40;36m` rozsiane po tekście.
Dlatego cięcie odbywa się w proxy. Zmierzone na `vert.synchro.net:23`: 237 B
i 12 escape'ów przed filtrem, 184 B i zero po. `--term` zostaje jako furtka na
boardy, które jednak `TTYPE` czytają.

Bajty powyżej `7Fh` przechodzą nietknięte, bo generator znaków Portfolio to
CP437 — ramki i bloki naprawdę się rysują. Psuje je wyłącznie szerokość 40
znaków i tego z tej strony kabla naprawić się nie da.

Sprawdzone end-to-end na żywych BBS-ach: Level 29 (`bbs.fozztexx.com:23`),
Black Flag na Mystic 1.12 (`blackflag.acid.org:23`) i Vertrauen na Synchronecie
(`vert.synchro.net:23`) — do Portfolio nie przechodzi ani jeden bajt `FFh`.

Kabel null-modem też przeszedł test: dwa emulowane Portfolio w jednym procesie,
`COPY LIST.TXT AUX` po jednej stronie i `COPY AUX ODEBRANE.TXT` po drugiej —
plik przeszedł w całości.

### Przekaźnik a hosting

Proxy **nie jest częścią strony i nic go nie serwuje** — to osobny proces, z
którym łączy się przeglądarka. Serwer WWW pozostaje więc czysto statyczny i nie
potrzebuje Node'a; wymaga go tylko maszyna, na której przekaźnik faktycznie
stoi. Bez niego tryb „modem” odpowiada `NO CARRIER`, a reszta emulatora działa
bez zmian.

Ograniczenie jest z gruntu przeglądarkowe, nie projektowe: strona nie otwiera
gniazd TCP, więc telnet zawsze potrzebuje pośrednika po stronie, która to
potrafi. Zostają trzy układy:

| Gdzie stoi przekaźnik | Konsekwencja |
|---|---|
| U odwiedzającego | musi pobrać `tools/ws-tcp-proxy.mjs` (leży w serwowanym katalogu) i mieć Node'a; panel *Port szeregowy* prowadzi go przez to |
| Publicznie, obok strony | nikt lokalnie nie potrzebuje niczego, ale to Twój ruch i Twoja lista `--allow` |
| Nigdzie | modem nieczynny, cała reszta działa — sensowne dla zwykłego pokazu emulatora |

Przy stronie serwowanej po HTTPS i przekaźniku na `localhost` warto sprawdzić
zachowanie docelowej przeglądarki: `ws://localhost` przechodzi kontrolę mixed
content, bo localhost liczy się jako origin potencjalnie zaufany, ale Chrome
osobno bramkuje sięganie ze strony publicznej do sieci lokalnej. Po HTTP
problemu nie ma. Publiczny przekaźnik trzeba wystawić po `wss://`, inaczej
strona z HTTPS go nie zawoła.

## Dźwięk (PCD3311T)

Jedyne wyjście dźwięku Portfolio to generator tonów Philips PCD3311T na porcie
`8020h`, sterowany równolegle:

| Bity | Znaczenie |
|---|---|
| 0–5 | wybór tonu (D5:D4 = bank, D3:D0 = pozycja) |
| 6 | STROBE — **opadające** zbocze zatrzaskuje D0–D5 |
| 7 | steruje jednocześnie VDD, MODE i A0 |

Banki: `00h` pojedyncze tony DTMF, `10h` pary DTMF, `20h` tony modemowe,
`30h` tony muzyczne (16 wysokości, 622,5–1768,5 Hz).

Tablice częstotliwości pochodzą z noty katalogowej układu (przez MAME), ale dają się
sprawdzić **niezależnie**: przewodnik techniczny wypisuje dla funkcji `INT 61h` `16h`
25 kodów tonów wraz z nutami i częstotliwościami (str. 3-11). Porównanie wypada
zgodnie co do wszystkich 25 — **największa różnica to 0,75%**, a przeciętna poniżej
0,3%, co odpowiada temu, że układ syntezuje tony przez dzielenie i nie trafia
w równomiernie temperowany strój idealnie. Co ciekawe, ROM sięga przy tym nie tylko
do banku muzycznego: dziewięć nut (m.in. `29h` = D6, `0Eh` = F#6, `04h` = A#6) bierze
z banków DTMF i modemowego — i te też się zgadzają.

Wyjściem są dwa oscylatory Web Audio bramkowane wzmocnieniem — bez strumieniowania
PCM. Worker znakuje każdą zmianę tonu **licznikiem cykli CPU**, a wątek główny planuje
ją w Web Audio z wyprzedzeniem; dzięki temu melodia nie jest kwantowana do kroku pętli
emulacji.

### Barwa

MAME syntezuje falę **prostokątną** (widać to w `sound_stream_update`: akumulator
przerzuca sygnał między `+1.0` a `-1.0`). To uproszczenie, nie opis układu —
datasheet określa PCD3311 jako mający *„low output distortion with on-chip filtering
conforming to CEPT recommendations"*, czyli na wyjściu jest przebieg bliski sinusowi.
Odtworzenie prostokąta dosłownie daje charakterystyczną piskliwość, której prawdziwy
Portfolio nie ma.

Emulowany jest więc cały tor, a nie sam układ:

| Element | Ustawienie |
|---|---|
| przebieg | sinus + ok. 4% niskich harmonicznych |
| filtr górnoprzepustowy | 300 Hz — mały przetwornik nie porusza powietrza niżej |
| rezonans przetwornika | +2 dB przy 1400 Hz, Q 0,9 |
| filtr dolnoprzepustowy | 3000 Hz — obudowa i filtr układu ścinają górę |

Wypada to w paśmie telefonicznym, czyli tam, gdzie ten układ z założenia pracował.
Policzona odpowiedź toru jest płaska w zakresie tonów użytkowych (6,4–7,9 dB dla
wszystkich banków, różnica dolna/górna grupa DTMF 1,5 dB), a harmoniczne opadają
monotonicznie: 5. o 0,7 dB, 7. o 7,2 dB, 9. o 12,6 dB.

Rezonans celowo siedzi nisko. Pierwsze podejście miało go przy 2100 Hz, co
**podbijało trzecią harmoniczną dolnej grupy DTMF o 5 dB ponad podstawową** — dokładnie
w paśmie, w którym ucho słyszy ostrość, więc działało przeciwko celowi.

Surowy prostokąt zostaje dostępny w panelu System jako druga opcja barwy.

Przeglądarki blokują dźwięk do pierwszej interakcji — trzeba kliknąć **Włącz**
w panelu System.

Częstotliwości pochodzą z `pcd3311.cpp` w MAME i są **wartościami przybliżonymi** —
dokładne dzielniki siedzą w niezrzuconym ROM-ie wewnętrznym układu, co MAME odnotowuje
jako otwarte zadanie. Wysokości mogą więc minimalnie odbiegać od prawdziwego sprzętu.

### Klik klawiszy — rozszerzenie ponad model MAME

Klik klawisza **nie jest tonem**. BIOS zostawia D0–D5 wyzerowane, nigdy nie pulsuje
STROBE, a zamiast tego przełącza bit 7 na ok. **102 µs**:

```
out 8020h, 00h    ; bit7 = 0
     ... 102 us ...
out 8020h, 80h    ; bit7 = 1
```

Bit 7 zasila układ (VDD), więc ten impuls po prostu szarpie piezoelektrykiem.
Model PCD3311 w MAME trzyma tę linię jako zwykły rejestr, którego generator nigdy
nie czyta — dlatego **w MAME klik klawiszy nie działa wcale**.

Tutaj każde zbocze tej linii wywołuje impuls. Dwa zbocza jednego kliku dzieli 102 µs,
więc warstwa audio scala wszystko, co bliższe niż 0,8 ms, w jedno uderzenie — wychodzi
dokładnie jedno kliknięcie na klawisz. Barwa (tłumiony sinus 4 kHz) to przybliżenie
odpowiedzi mechanicznej piezo; **moment** impulsu jest odtworzony dokładnie.

Ustawienia w Setup → Sounds (Key Click, Alarms, Buzzer) działają — obsługuje je BIOS,
nie emulator. Key Click jest domyślnie włączony.

### Wybieranie numerów tonami (DTMF)

Address Book potrafi wybierać numer telefonu tonami — Portfolio przykładało się do
mikrofonu słuchawki. To jedyne zastosowanie banku par DTMF (`10h`).

Numer musi być **w pierwszej linii karty, za nazwą** (tak wymaga wbudowana pomoc,
Atari → Help… → Dialing):

| Zapis | Znaczenie |
|---|---|
| `,` `;` | rozdziela kilka numerów |
| `( )` | kod kierunkowy, np. `(0483)` — pojawi się jako osobna pozycja w menu |
| `[ ]` | komentarz, np. `[ext 3212]` — nie jest wybierany |
| `-` spacja `.` | pauza w wybieraniu |
| `/` | wariant końcówki: `301555/6` daje `301555` i `301556` |

Przykład z pomocy: `DIP (0483)301555, 815629 [h.]`

Zweryfikowane: karta `kowalski 5551234` → Atari → `Dial…` → wybór numeru daje 7 par
DTMF, ~102 ms ton i ~102 ms przerwa, dekodujące się z powrotem na `5551234`.

## Rozszerzenie pamięci (HPC-104)

Płyta robi trzy rzeczy naraz: dokłada **drugi slot na kartę** (napęd `B:`),
**256 KB własnego RAM-u** mapowanego wprost w przestrzeń adresową i ma
**przelotkę**, więc drukarka albo port szeregowy działają podłączone za nią.
Dlatego w emulatorze HPC-104 nie zajmuje portu rozszerzeń na wyłączność, tylko
staje na jego początku, a wybrane peryferium wpina się za nią.

| Zakres | Rola |
|---|---|
| `1F000h`–`5EFFFh` | RAM płyty, unit 1 (pozycja przełącznika) |
| `5F000h`–`9EFFFh` | RAM płyty, unit 2 |
| `807Ch` | zapis, bit 0: NCC1 — bramka slotu karty |

Zmierzone na oryginalnym ROM-ie:

- `CHKDSK` pokazuje **126 976 B** bez płyty i **389 120 B** z nią, czyli dokładnie
  +256 KB — DOS liczy całą dołożoną pamięć. Karta w slocie B nie ma z tym nic
  wspólnego: z pustym slotem wynik jest identyczny;
- razem z pamięcią rośnie **RAM-dysk `C:`**, bo system wydziela go z tej samej
  puli: pojemność 31 232 B → **94 208 B**, wolne 31 104 B → 93 696 B;
- **unit 2 nie powiększa pamięci** (dalej 126 976 B): zostawia dziurę między
  `1F000h` a `5F000h`, a BIOS przestaje liczyć na pierwszej dziurze. Ta pozycja
  przełącznika ma sens dopiero jako druga płyta obok pierwszej;
- `DIR B:` listuje pliki, `COPY A:*.* B:` przechodzi w obie strony, a drukarka
  wpięta za przelotką dalej łapie bajty;
- bez płyty `DIR B:` daje `Insert disk for drive B:`, czyli DOS-owy fantom
  drugiego napędu na maszynie jednonapędowej — nie prawdziwy slot.

Jedno rozejście z MAME, świadome: `hpc104.cpp` zostawia `nmd1()` na domyślnej
wartości interfejsu (1), a przy 1 ROM **w ogóle nie montuje `B:`**. Pomiar na
prawdziwym ROM-ie pokazuje, że dopiero wystawienie NMD1 daje działający napęd
`B:` — z kartą listuje pliki, bez karty zgłasza błąd odczytu zamiast fantomu.
Dlatego to urządzenie NMD1 wystawia.

## Czego nie ma

- **8087** — instrukcje ESC są dekodowane i pomijane; Portfolio i tak nie miał
  koprocesora.
- **Portfolio 2** (`pofo2`, F82C425, 640×200).
- **Drugie źródło wybudzenia po `OFF`.** Wstając po impulsie `MRST`, ROM pyta ASIC
  o powód włączenia i rozpoznaje dwa — bity 0 i 1 odczytu spod `8041h`. Bit 0 to
  klawiatura i tylko ona jest modelowana; ścieżka drugiego bitu prowadzi w ROM-ie do
  osobnej procedury, a co ją na sprzęcie wyzwala, nie zostało ustalone. Nic w
  emulatorze tego bitu nie podaje.

## Autor

Napisał dely / blowjobb / ng. Przy pracy na każdym etapie wykorzystywano LLM —
od pomiarów rozbieżności z MAME po sam kod.

## Podziękowania

Emulator był testowany przez następujące osoby:
**Peri Noid**, **spkr/sfmx**, **MKM/Lamers**, **Cosi** i **tr1x/Agenda**. Ich testy,
zgłoszenia i porównania z oryginalnym Portfolio wskazały miejsca, których
sam bym z pewnością nie znalazł. Bardzo dziękuję za wsparcie w rozwoju tego programu.

## Źródła

Model sprzętu odtworzono na podstawie plików źródłowych MAME oznaczonych
`license:BSD-3-Clause` oraz *Atari Portfolio Technical Reference Guide*,
wyd. 1, wrzesień 1989.

Przewodnik krąży jako **skan z warstwą OCR**, nie jako tekst. Czyta go
`tools/pdftext.mjs` — bezzależnościowy ekstraktor napisany na tę okazję, bo takie pliki
mają trzy pułapki naraz: mapy `ToUnicode` bywają nieskompresowane, słowo `endstream`
kończy się na `stream`, a dane obrazów zawierają przypadkiem operatory tekstu. Łamanie
wierszy odtwarza z macierzy tekstu — inaczej każde słowo ląduje w osobnej linii i tabele
rejestrów zamieniają się w sieczkę. Sam skan zostaje poza repozytorium; prawa do niego
należą do DIP Ltd.

| Plik MAME | Co z niego pochodzi |
|---|---|
| `src/mame/atari/pofo.cpp` | mapa pamięci, mapa I/O, kontroler przerwań ASIC, selektor ROM_B, rejestr baterii |
| `src/devices/video/hd61830.cpp`, `.h` | model kontrolera LCD, algorytm rysowania trybu tekstowego i graficznego |
| `src/mame/atari/pofo_kbd.cpp` | matryca klawiatury 8×8 i schemat kodów fizycznych |
| `src/devices/sound/pcd3311.cpp`, `.h` | tablice tonów DTMF, modemowych i muzycznych, zachowanie STROBE |
| `src/devices/bus/pofo/ccm.cpp`, `exp.cpp`, `hpc101.cpp`, `hpc102.cpp`, `hpc104.cpp` | slot karty, protokół portu rozszerzeń, interfejs równoległy 82C55A, mapowanie RAM-u i bramka NCC1 rozszerzenia HPC-104 |
| `src/devices/machine/ins8250.cpp` | UART 8250 (rejestry, przerwania) — autorzy: smf, Carl |

Protokół transferu plików odtworzony na podstawie dwóch niezależnych opisów:

| Źródło | Licencja |
|---|---|
| [Transfolio](https://github.com/skudi/transfolio), Klaus Peichl, 2018 | **brak licencji** — kod nieużyty, wykorzystano wyłącznie wiedzę o protokole |
| [PofoManager](https://github.com/codaris/PofoManager), `Documentation/protocol.md` i `Arduino/Portfolio.ino` | Apache-2.0 |

Oryginalny opis protokołu napisał Klaus Peichl (2006) i opublikował na
[PofoWiki](http://www.pofowiki.de/). Implementacja w tym projekcie jest własna —
z obu źródeł zaczerpnięto opis działania, a nie kod.

Kod jest **reimplementowany**, a nie kopiowany — ale algorytmy, tablice stałych
i układy rejestrów pochodzą z powyższych plików, więc licencja obowiązuje i jest
reprodukowana poniżej. Pełna treść jest też dostępna z poziomu aplikacji:
Instrukcja → Źródła i autorzy → BSD-3-Clause.

MAME jest zastrzeżonym znakiem towarowym Gregory'ego Embera. Nazwa użyta jest tu
wyłącznie w celu wskazania pochodzenia odtworzonej pracy; projekt nie jest
powiązany z projektem MAME ani przez niego firmowany.

## Licencja

Cały projekt jest na **BSD-3-Clause** — pełna treść wraz ze składnikami osób
trzecich i uwagami o tym, co *nie* wchodzi w skład repozytorium, jest w pliku
[LICENSE](LICENSE).

To najbardziej permisywna licencja zgodna z wykorzystanym kodem. Punkty 1 i 2
BSD-3-Clause wymagają zachowania noty, listy warunków i zrzeczenia się
odpowiedzialności, więc licencje bez atrybucji (MIT-0, 0BSD, CC0, Unlicense,
domena publiczna) dla tego projektu jako całości odpadają.

### Noty o prawach autorskich

```
Copyright (c) Curt Coder
    src/mame/atari/pofo.cpp
    src/devices/video/hd61830.cpp, hd61830.h
    src/devices/sound/pcd3311.cpp, pcd3311.h
    src/devices/bus/pofo/ccm.cpp, exp.cpp, hpc101.cpp, hpc102.cpp, hpc104.cpp

Copyright (c) Curt Coder, Jaen Saul
    src/mame/atari/pofo_kbd.cpp

Copyright (c) smf, Carl
    src/devices/machine/ins8250.cpp, ins8250.h
```

Nagłówki tych plików podają posiadaczy praw bez lat. Projekt MAME jako całość
podaje notę `Copyright (c) 1997-2026 MAMEDev and contributors`.

Rdzeń procesora (`js/emu/cpu8088.js`, `js/emu/cpu8088-decode.js`) jest przeniesieniem
rdzenia 808x z [MartyPC](https://github.com/dbalsom/martypc) na licencji MIT, zgodnej
z BSD-3-Clause; pełna treść licencji MIT jest w [LICENSE](LICENSE).

```
Copyright 2022-2026 Daniel Balsom
    crates/lib/marty_core/src/cpu_808x
```

### BSD-3-Clause

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
