# Historia zmian

*(English is the primary version of this document: [CHANGELOG.md](CHANGELOG.md).)*

Format według [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/). Wpis oznaczają
numer wersji, data trafienia zmiany do gałęzi głównej oraz skrócony identyfikator
commita. Hash pojawia się z jednym wpisem opóźnienia, bo commit nie zna własnego.

## 1.02 — 2026-11-20

### Dodane

- **Nagrywanie.** Nowy przycisk **Nagrywanie** na pasku zapisuje obraz i dźwięk emulatora
  do pliku wideo prosto ze strony, bez programu do przechwytywania ekranu. Kadr to ekran
  z obudową albo sam ekran, w rozdzielczości panelu, z siatką punktów, kontrastem
  i bezwładnością dokładnie takimi jak na stronie, bez kursora i bez reszty strony. W trakcie
  nagrywania przycisk pokazuje upływający czas, a kliknięcie go kończy nagranie i pobiera
  plik: WebM w Chrome, Edge i Firefoksie, MP4 w Safari. Dźwięk nagrywa się taki, jaki
  słychać, i można go włączyć w połowie. Na czas nagrania skala obrazu jest zablokowana.

### Poprawione

- **Zegar Portfolio to NMI, a alarmy terminarza dzwonią.** Tik zegara szedł jako
  przerwanie maskowalne z wektorem `08h`, tak jak w MAME; na Portfolio to przerwanie
  niemaskowalne. Obsługa NMI w ROM-ie sama woła `INT 08h`, a potem robi to, czego
  `INT 08h` nie robi: dzwoni należnym alarmem, odlicza czas do samoczynnego wyłączenia
  i woła `INT 1Ch`. Wszystko to było pomijane, więc alarm z terminarza (Diary) nigdy nie
  zadzwonił — a że BIOS tamto przerwanie maskowalne zostawia wyłączone, godzina przy
  znaku zachęty przeważnie stała: pięć minut w `TIME` wychodziło jako trzy, a na stronie,
  gdzie pole zegara startowało w dodatku odznaczone, czas prawie w ogóle nie płynął. Teraz czas
  idzie w krok z maszyną, a alarm ustawiony w terminarzu dzwoni, pokazuje okno z treścią
  wpisu i robi to nawet przy wyłączonej maszynie — włącza ją sam, jak na sprzęcie.
  W wolnym trybie zegara alarm dzwoni przy takcie, który zastanie go w ciągu najbliższych
  70 sekund, do minuty przed czasem albo po nim; to arytmetyka samego ROM-u. Dziękuję
  użytkownikowi forum, który to wskazał, razem z trzema kolejnymi punktami.
- **Porty `8040h` i `8041h`.** `8040h` oddaje liczbę taktów 2 Hz od ostatniego NMI
  zegara, którą BIOS dodaje do czasu trzymanego w pamięci; `8041h` ma dwa bity, mówiące,
  czy maszyna włączyła się od klawisza, czy od zegara, a jego odczyt potwierdza NMI.
  Wcześniej oba czytały się jak jeden szesnastobitowy licznik.
- **W trybie OFF zegar idzie dalej.** Co 128 sekund budzi BIOS na kilka milisekund,
  żeby przesunąć czas i sprawdzić alarm, po czym maszyna znów się wyłącza; strona przez
  cały ten czas pozostaje ciemna. Do 1.00 przy wyłączonej maszynie czas stał.
- **Wyjęcie karty w trakcie odczytu zgłasza `INT 15h`.** Wyjęcie karty ze slotu `A:`,
  kiedy BIOS ją czyta, kończy teraz odczyt komunikatem `Data error reading drive A:`,
  przez obsługę w samym ROM-ie, zamiast czytać dalej z karty, której już nie ma. Przy
  znaku zachęty nic się nie dzieje, jak dotąd. Slot `B:` tego przerwania nie zgłasza.
- **Dziennika portów w Inspektorze nie dało się zobaczyć w działaniu.** Przy otwartym
  oknie żaden klawisz nie docierał do Portfolio, a maszyna czekająca przy znaku zachęty
  nie dotyka żadnego portu, więc dziennik mówił tylko, że dostępów nie było. Teraz
  klawisze trafiają do Portfolio także przy otwartym Inspektorze, chyba że kursor stoi
  w którymś z jego pól tekstowych; `Esc` zamyka okno. Pierwszy wiersz dziennika nie
  pokazuje już ujemnej liczby cykli.
- **Surowe obrazy ROM krótsze od karty.** Rozszerzenie ROM w rodzaju tego z podręcznika
  technicznego Atari ma kilkaset bajtów. Wgrane przez *Wgraj obraz…* powtarzało się w oknie
  karty co kilkaset bajtów, więc program czytający za swoim końcem trafiał znowu na własny
  początek. Teraz taki obraz jest dopełniany bajtami `FFh` do układu, w który zostałby
  wypalony (32, 64, 128 albo 256 KB) — tak czyta się niezapisane miejsce w EPROM-ie. Krótka
  karta zapamiętana już w przeglądarce dopełnia się przy wczytaniu strony. Okno karty nazywa
  taką kartę rozszerzeniem ROM ze słowem rozpoznawczym, zamiast zgłaszać nierozpoznany format.

### Zmienione

- **Samoczynne wyłączanie należy do BIOS-u.** Było odwzorowane jako licznik w układzie
  ASIC; w rzeczywistości odliczanie siedzi w obsłudze NMI w ROM-ie i kończy się trybem
  OFF, tym samym co po poleceniu `OFF`. Z zewnątrz nic się nie zmienia — ekran gaśnie po
  128–256 sekundach bez klawisza, a dowolny klawisz przywraca sesję — ale ustawienie
  nazywa się teraz **System → Samoczynne wyłączanie**, dłuższe opcje mają poprawnie
  podane czasy (ok. 6–9 i 15–17 minut), a przy wyłączonej maszynie zegar chodzi dalej.
  **System → Zegar Portfolio**, dawniej *Przerwanie zegara systemowego*, zatrzymuje
  cały zegar, razem z godziną i alarmami. Teraz jest domyślnie zaznaczony.

### Uwaga dla użytkowników

- Pole zegara startowało dawniej odznaczone i większość zapisanych ustawień niesie to
  bez niczyjego wyboru, więc wcześniejszy wybór nie przechodzi: zegar startuje
  zaznaczony. Odznacz go ponownie, jeśli naprawdę chcesz, żeby czas stał.
- Zrzut stanu zapisany w 1.00 wczytuje się jak dotąd. Maszyna zapisana
  w czasie uśpienia wraca obudzona, przy znaku zachęty. Ustawienia zegara i wyłączania
  obowiązują te, które strona ma teraz, a nie te zapisane w zrzucie.

## 1.00 — 2026-11-11 — `9d72f4f`

Pierwsze wydanie publiczne.

### Dodane

- **Atari Portfolio w przeglądarce.** Czysty JavaScript i moduły ES, bez kroku budowania
  i bez kodu po stronie serwera: oryginalny ROM uruchamia się do promptu DIP-DOS 2.11,
  z wbudowanymi aplikacjami, klawiaturą, autorepetycją, dźwiękiem i zarządzaniem energią
  (uśpienie, polecenie OFF, zimny start). Pliki ROM są Twoje; czyta je Twój komputer,
  a przeglądarka je zapamiętuje.
- **Procesor liczony co do taktu.** Rdzeń 8088 jest przeniesieniem rdzenia z MartyPC,
  sprawdzonym wobec nagrań SingleStepTests i wobec kilkuset czasów zmierzonych na
  prawdziwym Portfolio, które zestaw testów trzyma jako wzorce.
- **Ekran taki, jak pokazuje go panel.** Sterownik HD61830 z jego czasami, rejestr
  kontrastu, bezwładność panelu z wyborem czterech kształtów narastania, siatka punktów
  i grafika obudowy w czterech powiększeniach.
- **Karty pamięci.** Karty w slocie A: — tworzone, wgrywane, pobierane i edytowane plik po
  pliku ze strony — oraz drugi slot B: z rozszerzeniem pamięci HPC-104. Karta może być
  rozszerzeniem ROM albo uruchamiać maszynę.
- **Strona karty EPROM** (`eprom.html`), która z plików i katalogów składa obraz od 128 KB
  do 1 MB dla programatora, po jednym banku 128 KB na dysk, w układzie konwertera
  z Atari ST, którym robiono te karty.
- **Port rozszerzeń.** Interfejs równoległy HPC-101 z drukowaniem do pliku i protokołem
  przesyłania plików Portfolio oraz interfejs szeregowy HPC-102 — terminal, prawdziwy
  port RS-232 przez Web Serial, wirtualny modem z wybieraniem tonowym i połączenie
  null-modem między dwiema kartami przeglądarki.
- **Stan maszyny.** Trzy gniazda zrzutów w przeglądarce i plik `.pofostate`, niosące całą
  maszynę — procesor w połowie rozkazu, ekran, karty, wpięty sprzęt — podczas gdy pamięć
  podtrzymywana bateryjnie z dyskiem C: zapisuje się sama.
- **Inspektor** z rejestrami, deasemblerem, pamięcią, dziennikiem portów, pułapkami na
  adresy i porty oraz krokowaniem; do tego podgląd `PERMDATA.DAT`, czyli tego, co
  Portfolio pamięta o sobie.
- **Polski i angielski**, przełączane w locie, z pytaniami i komunikatami w oknie strony,
  datami zawsze w zapisie RRRR-MM-DD i liczbami zawsze z kropką dziesiętną.
- **Zestaw testów** uruchamiany z Node (`node tools/run-tests.mjs`), z rdzeniem emulatora
  dostępnym bez przeglądarki w `tools/pofo-headless.mjs`.
