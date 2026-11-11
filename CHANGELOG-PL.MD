# Historia zmian

*(English is the primary version of this document: [CHANGELOG.md](CHANGELOG.md).)*

Format według [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/). Wpis oznaczają
numer wersji, data trafienia zmiany do gałęzi głównej oraz skrócony identyfikator
commita. Hash pojawia się z jednym wpisem opóźnienia, bo commit nie zna własnego.

## 1.00 — 2026-11-11

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
