// Polish source text -> English. The key is what the DOM returns, whitespace
// collapsed - see the note at the top of i18n.js, and check completeness with
// `node tools/i18n-check.mjs` rather than by eye.
//
// Entries whose English is identical to the Polish are still listed. They cost
// a line and they keep the check honest: a key with no entry at all is a string
// somebody forgot, and that has to stay distinguishable from one deliberately
// left alone.

export const EN_DICT = {
  'Zimny start z losową pamięcią RAM <em>Prawdziwe Portfolio budzi się z pamięcią pełną <b>resztek</b> — komórki trzymają ładunek jeszcze chwilę po wyjęciu baterii, a to, co przetrwa, nie jest ani zerami, ani dwa razy takie samo. Emulator domyślnie daje równiutkie zera, więc program, który czyta pamięć, zanim cokolwiek do niej zapisze, zachowuje się tu inaczej niż na sprzęcie — i różnicy nie widać, dopóki nie zaboli. Włącz, żeby <b>zimny start</b> wypełniał pamięć losowo: dwa uruchomienia przestaną być identyczne, a błąd zależny od śmieci w pamięci dostaje szansę ujawnić się również tutaj. Działa od <b>następnego zimnego startu</b> — przesypywanie pamięci pod działającym programem niczego by nie odtworzyło, tylko go wywróciło. Pamięci rozszerzenia (dysk B:) opcja nie rusza, tak samo jak zwykły zimny start.</em>':
    'Cold start with random RAM <em>A real Portfolio wakes up with memory full of <b>leftovers</b> — the cells hold their charge for a while after the batteries come out, and what survives is neither zeros nor the same twice. This emulator hands out a tidy field of zeros by default, so a program that reads memory before writing anything to it behaves differently here than on hardware — and the difference stays invisible until it hurts. Switch this on to have a <b>cold start</b> fill memory at random: two runs stop being identical, and a fault that depends on rubbish in memory gets a chance to show up here as well. It takes effect from the <b>next cold start</b> — refilling memory under a running program would reproduce nothing, it would just topple it. The RAM on the expansion board (drive B:) is left alone, exactly as an ordinary cold start leaves it.</em>',
  'Wierność układu LCD':
    'LCD controller fidelity',
  'Bierze wszystko — nierealistyczne':
    'Takes everything — unrealistic',
  'Zgodne z oryginalnym sprzętem':
    'As on the original hardware',
  'Kontroler HD61830 dzieli pamięć obrazu z odświeżaniem panelu i po zapisie danych <b>potrzebuje chwili</b>. Dostęp, który przyjdzie wcześniej niż po 50 cyklach, jest źle obsłużony — a co się wtedy stanie, zależy od tego, co przyszło. Kolejny <b>zapis danych</b> przepada, a że licznik adresu wtedy stoi, wiersz nie robi się dziurawy, tylko urywa. <b>Zapis instrukcji</b> łapie bajt jeszcze w locie i wciąga go do rejestru <b>sterowania trybem</b>: gaśnie tryb graficzny i panel czyta pamięć jak kody znaków, albo gaśnie samo wyświetlanie i panel pustoszeje. Pamięć obrazu zostaje przy tym nietknięta, i tak jest aż do ponownego zaprogramowania układu. Rzadziej — mniej więcej raz na sześćdziesiąt — spóźniona instrukcja nie przewraca rejestru, tylko gubi sam bajt, i w wierszu zostaje <b>ośmiopikselowy ząbek</b> z tym, co w komórce było wcześniej. Tak właśnie wyglądają <b>śmieci</b>, które prawdziwe Portfolio pokazuje przy programie piszącym za szybko. Próg jest <b>zmierzony na sprzęcie</b>: zapis co 46 cykli gubi bajty, co 54 już nie — po sześć uruchomień w każdą stronę. Ominąć się tego nie da, bo <b>interfejs jest tylko do zapisu</b> — odczyt obu portów zwraca młodszy bajt adresu, <code>10h</code> i <code>11h</code>, więc żaden program nie sprawdzi, czy bajt dotarł. <b>Zgodne z oryginalnym sprzętem</b> trzyma się tej reguły i pokazuje skutki jej łamania — dokładnie to, co zobaczyłbyś na prawdziwym Portfolio. <b>Bierze wszystko</b> przyjmuje każdy zapis natychmiast: ekran zostaje czysty, ale takiego układu nigdy nie było. Zostaje do diagnostyki — gdy obraz wygląda źle, przełączenie od razu mówi, czy winne są czasy.':
    'The HD61830 controller shares display memory with the panel refresh, and after a data write it <b>needs a moment</b>. An access arriving sooner than 50 cycles is mishandled — and what happens then depends on what arrived. Another <b>data write</b> is simply lost, and since the address counter does not move either, the row does not come out speckled but cut short. An <b>instruction write</b> catches the byte still in flight and pulls it into the <b>mode control register</b>: either graphic mode goes and the panel reads memory as character codes, or the display itself goes and the panel blanks. Display memory is untouched underneath, and it stays that way until the program sets the chip up again. Less often — about one time in sixty — a late instruction write knocks over nothing and simply loses the byte, leaving an <b>eight-pixel notch</b> in the row with whatever the cell held before. That is exactly the <b>rubbish</b> a real Portfolio shows when a program writes too fast. The threshold is <b>measured on hardware</b>: a write every 46 cycles loses bytes, every 54 does not — six runs each way. There is no way around it, because <b>the interface is write-only</b> — reading either port returns the low byte of the port address, <code>10h</code> and <code>11h</code>, so no program can check whether a byte arrived. <b>As on the original hardware</b> keeps to that rule and shows what breaking it does — exactly what a real Portfolio would show you. <b>Takes everything</b> accepts every write at once: the screen stays clean, but no such chip ever existed. It stays for diagnosis — when a picture looks wrong, flipping this says at once whether timing is to blame.',
  // ---- page furniture -----------------------------------------------------
  'Portfoliator': 'Portfoliator',
  'Emulator Atari Portfolio (80C88 @ 4.9152 MHz, DIP DOS 2.11)':
    'An Atari Portfolio emulator (80C88 @ 4.9152 MHz, DIP DOS 2.11)',
  'System': 'System',
  'Karta pamięci': 'Memory card',
  'Port równoległy': 'Parallel port',
  'Port szeregowy': 'Serial port',
  'Klawiatura': 'Keyboard',
  'Aplikacje': 'Applications',
  'Instrukcja': 'Manual',
  'Stan:': 'Status:',
  'inicjalizacja…': 'starting up…',
  'Szybkość:': 'Speed:',
  'Bufor wydruku:': 'Print buffer:',
  'Zamknij': 'Close',

  // ---- System -------------------------------------------------------------
  'Reset (ciepły)': 'Reset (warm)',
  'Zimny start': 'Cold start',
  'Pliki ROM…': 'ROM files…',
  'Skala obrazu': 'Screen scale',
  'Bezwładność ekranu': 'Screen inertia',
  '50 ms': '50 ms',
  'Matryca Portfolio to ciekły kryształ z 1989 roku — punkt nie zapala się i nie gaśnie natychmiast, tylko dochodzi do nowego stanu przez kilkadziesiąt–kilkaset milisekund. Dlatego przewijany tekst zostawia na prawdziwym urządzeniu smugę, a kursor nie mruga ostro, tylko faluje. Suwak ustawia stałą czasową zapalania punktu (po tym czasie punkt jest ciemny w ok.&nbsp;63%); gaszenie trwa o&nbsp;60% dłużej, bo powrót ciekłego kryształu do stanu spoczynku jest wolniejszy niż wysterowanie go napięciem. <b>0</b> wyłącza efekt i&nbsp;daje ostry obraz, jak w&nbsp;emulatorze MAME. Wartości są dobrane „na oko”, nie z pomiaru konkretnego egzemplarza — ustaw to, co wygląda jak Twoje Portfolio: im wyżej, tym bardziej wyziębiony i&nbsp;rozmazany ekran.':
    'The Portfolio panel is 1989 liquid crystal: a dot neither lights nor goes dark at once, but takes tens to hundreds of milliseconds to reach its new state. That is why scrolling text smears on the real device and the cursor does not blink sharply but swells and fades. The slider sets the time constant for a dot going dark (after which it is about&nbsp;63% of the way there); clearing takes&nbsp;60% longer, because liquid crystal relaxes more slowly than it is driven. <b>0</b> turns the model off and gives the sharp picture MAME produces. The values are judged by eye rather than measured off a particular unit — set whatever looks like your Portfolio: the higher it goes, the colder and more smeared the screen.',
  'Kształt narastania': 'Rise shape',
  '0 — twardy start, bez dociągania': '0 — hard start, no slow finish',
  '1 — twardy start + długie dociąganie': '1 — hard start + long slow finish',
  '2 — miękki start (krzywa S), bez dociągania':
    '2 — soft start (S-curve), no slow finish',
  '3 — miękki start + długie dociąganie': '3 — soft start + long slow finish',
  'Jak punkt dochodzi do nowego stanu; tempo nadaje suwak powyżej, a tu wybiera się kształt drogi. <b>Start:</b> twardy znaczy, że punkt rusza najszybciej w chwili zapalenia; miękki — że przez moment nie dzieje się nic, a dopiero potem punkt nabiera rozpędu. <b>Dociąganie:</b> bez niego punkt dochodzi do pełnej czerni jednym ruchem; z długim dociąganiem 45% drogi bierze na siebie składowa cztery razy wolniejsza, więc punkt widać od razu, ale blady, a pełne nasycenie przychodzi dużo później. Przy suwaku 50&nbsp;ms pierwsza klatka daje kolejno 28%, 19%, 8% i&nbsp;8% czerni, a pełną czerń punkt osiąga po 316, 1250, 416 i&nbsp;1250&nbsp;ms. Gaszenie w&nbsp;każdym wariancie trwa o&nbsp;60% dłużej niż zapalanie. Kształt, tak jak tempo, jest dobrany na oko, a nie zmierzony — wybierz ten, który wygląda jak Twoje Portfolio.':
    'How a dot reaches its new state; the slider above sets the pace, and this picks the shape of the way. <b>Start:</b> hard means the dot moves fastest at the instant it is switched on; soft means that for a moment nothing happens, and only then does the dot pick up speed. <b>Finish:</b> without a slow finish the dot reaches full black in one movement; with a long one, 45% of the way is carried by a component four times slower, so the dot shows at once but pale, and full saturation comes much later. At 50&nbsp;ms on the slider the first frame gives 28%, 19%, 8% and&nbsp;8% black respectively, and the dot reaches full black after 316, 1250, 416 and&nbsp;1250&nbsp;ms. In every variant clearing takes 60% longer than going dark. The shape, like the pace, is judged by eye rather than measured — pick the one that looks like your Portfolio.',
  'Siatka pikseli':
    'Pixel grid',
  '10%': '10%',
  'Punkt na matrycy Portfolio nie styka się z sąsiadem — każdy ma własną elektrodę, a między nimi biegnie <b>niesterowana przerwa</b>, przez którą widać samo podłoże panelu. Dlatego obraz na szkle ma widoczną <b>kratkę</b>, i to niezależnie od tego, co akurat wyświetla. Suwak ustawia szerokość tej przerwy jako <b>udział w podziałce</b>: <b>0</b> zestawia punkty ze sobą, czyli daje jednolitą płachtę, jaką emulator pokazywał wcześniej. Wartość nie jest zmierzona na sprzęcie — dokumentacja nie podaje wymiarów matrycy, a bez nich każda liczba byłaby zmyślona; ustaw to, co zgadza się ze zdjęciem Twojego egzemplarza. Przerwa rysowana jest <b>pokryciem</b>, a nie całymi pikselami ekranu: gdy krawędź punktu wypada w połowie piksela, piksel wychodzi w połowie ciemny. Dzięki temu kratka zostaje równa także przy powiększeniu systemowym 125% czy 150%, gdzie na jeden punkt przypada <b>ułamek piksela</b> i podział na całe piksele dawałby falujące prążki. Ubocznie znika przy tym stara nierówność: bez siatki punkty też bywały szersze i&nbsp;węższe, tyle że nie było tego po czym poznać.':
    'A dot on the Portfolio panel does not touch its neighbour — each has an electrode of its own, and between them runs an <b>unpowered gap</b> showing nothing but the backing of the panel. That is why the picture on the glass carries a visible <b>lattice</b>, whatever it happens to be displaying. The slider sets the width of that gap as a <b>share of the pitch</b>: <b>0</b> butts the dots together and gives back the uniform sheet the emulator used to show. The figure is not measured from hardware — the documentation gives no dimensions for the panel, and without them any number would be invented; set whatever agrees with a photograph of your own machine. The gap is drawn by <b>coverage</b> rather than in whole screen pixels: where the edge of a dot falls halfway across a pixel, the pixel comes out half dark. That keeps the lattice even at 125% or 150% system zoom, where a dot gets a <b>fraction of a pixel</b> and dividing into whole ones would leave rippling bands. It also disposes of an older unevenness: without a grid the dots too came out wider and narrower, only with nothing to notice it by.',
  'Dźwięk (PCD3311T)': 'Sound (PCD3311T)',
  'Głośność': 'Volume',
  'Barwa': 'Timbre',
  'Jak w Portfolio (miękka, telefoniczna)': 'As in the Portfolio (soft, telephone-like)',
  'Surowa fala prostokątna': 'Raw square wave',
  'PCD3311T to układ do generowania tonów telefonicznych i ma wbudowany filtr — jego wyjście jest bliskie sinusowi, a nie ostrej fali prostokątnej. Do tego mały głośniczek w plastikowej obudowie obcina i dół, i górę pasma. Pierwsza opcja odtwarza cały ten łańcuch i brzmi tak, jak prawdziwy Portfolio; druga to surowy prostokąt, bez filtrowania — ostrzejszy i bardziej piskliwy, za to identyczny z tym, co generuje emulator MAME.':
    'The PCD3311T is a telephone tone generator with a filter built in — what leaves the pin is close to a sine, not a hard square wave. On top of that, a small transducer in a plastic case cuts away both the bottom and the top of the band. The first option models that whole chain and sounds like a real Portfolio; the second is the raw square, unfiltered — harsher and shriller, but identical to what MAME synthesises.',
  'Przeglądarka blokuje dźwięk do pierwszej interakcji — przestaw przełącznik.':
    'Browsers block audio until you interact with the page — flip the switch.',
  'Przerwanie zegara systemowego <em>Wektor <code>08h</code>, ten sam co IRQ0 w PC. Prędkość <b>ustawia maszyna, nie Ty</b>: Portfolio ma dokładnie dwie — raz na sekundę albo raz na 128 sekund — i przełącza się między nimi funkcją <code>INT&nbsp;61h</code> <code>1Eh</code>, zapisem do portu <code>8040h</code>. BIOS przy każdym starcie wybiera tryb <b>wolny</b>, oszczędzający baterie; program, który poprosi o tik co sekundę, dostanie go co sekundę. Odznacz, jeśli chcesz przerwanie zegara wyciszyć zupełnie — wtedy nie nadejdzie <b>w ogóle</b>, bo poza tym nic w emulatorze go nie generuje.</em>':
    'System clock tick <em>Vector <code>08h</code>, the same one IRQ0 uses on a PC. The rate is <b>the machine\'s choice, not yours</b>: the Portfolio has exactly two — once a second or once every 128 seconds — and switches between them through <code>INT&nbsp;61h</code> <code>1Eh</code>, by writing to port <code>8040h</code>. The BIOS picks the <b>slow</b>, battery-saving rate on every boot; a program that asks for a tick every second gets one every second. Clear the box to silence the tick entirely — then it never arrives <b>at all</b>, because nothing else in the emulator generates it.</em>',
  'Zasypianie po bezczynności': 'Power down when idle',
  'Nigdy — emulator czeka w nieskończoność': 'Never — the emulator waits forever',
  'Jak prawdziwe Portfolio (128–256 s)': 'Like a real Portfolio (128–256 s)',
  'Dłużej — ok. 4–9 min': 'Longer — about 4–9 min',
  'Dużo dłużej — ok. 9–18 min': 'Much longer — about 9–18 min',
  'Prawdziwe Portfolio samo odcina zasilanie, kiedy przez kilka minut nikt nie naciśnie klawisza — i <b>nie robi tego ROM, tylko układ ASIC</b>. BIOS, czekając na klawisz, wchodzi w stan czuwania zapisem do portu <code>8030h</code> i zatrzymuje procesor; odliczanie prowadzi sprzęt, licznikiem o ziarnistości 128&nbsp;sekund. Stąd zapis w dokumentacji DIP-a „zawsze między 128 a 256 sekund” — wychodzi jeden albo dwa pełne okresy, zależnie od tego, kiedy padło ostatnie stuknięcie. Na egzemplarzu autora zmierzono ok. 230&nbsp;s.':
    'A real Portfolio cuts its own power when nobody presses a key for a few minutes — and <b>that is the ASIC doing it, not the ROM</b>. Waiting for a key, the BIOS enters standby by writing to port <code>8030h</code> and halts the processor; the countdown is run by the hardware, on a counter with 128-second granularity. Hence DIP\'s wording, "always between 128 and 256 seconds" — it comes out as one or two full periods, depending on where in the period the last keystroke fell. On the author\'s unit it measured about 230&nbsp;s.',
  '<b>Ekran gaśnie, a maszyna staje</b> — dokładnie jak po odcięciu zasilania. <b>Budzi ją dowolny klawisz</b> i sesja toczy się dalej od tego samego miejsca, bez restartu. Domyślnie wyłączone, żeby emulator zostawiony w otwartej karcie nie gasł w trakcie czytania; włącz, jeśli chcesz zachowania zgodnego ze sprzętem. Polecenie <code>OFF</code> to osobna droga — gasi maszynę głębiej, ale klawisz budzi i z niej.':
    '<b>The screen goes dark and the machine stops</b> — exactly as it would with the power cut. <b>Any key brings it back</b> and the session carries on from where it stood, with no restart. Off by default, so that an emulator left in an open tab does not go dark while you read; turn it on if you want the hardware\'s behaviour. The <code>OFF</code> command is a separate route — it powers the machine down further, but a key wakes it from that too.',

  // ---- ROM files ----------------------------------------------------------
  'Pliki ROM': 'ROM files',
  '<b>ROM Portfolio oraz DIP-DOS są własnością Atari Corp. i DIP&nbsp;Ltd. i nie wchodzą w skład tego projektu.</b> Żeby uruchomić emulator, trzeba dostarczyć własny zrzut — z posiadanego egzemplarza albo z innego źródła, do którego masz prawo. Ten projekt nie rozpowszechnia tych plików i nie podpowiada, skąd je wziąć.':
    '<b>The Portfolio ROM and DIP-DOS belong to Atari Corp. and DIP&nbsp;Ltd. and are not part of this project.</b> To run the emulator you have to supply your own dump — from a unit you own, or from another source you have the right to use. This project neither distributes those files nor points you at them.',
  'Pliki są odczytywane <b>wyłącznie w Twojej przeglądarce</b> i zostają zapamiętane w jej magazynie lokalnym (IndexedDB), razem z dyskiem <code>C:</code> i kartami. Nic nie jest nigdzie wysyłane — ta strona nie ma dokąd tego wysłać. Przy kolejnej wizycie emulator wystartuje od razu, bez ponownego pytania; jeśli jednak przeglądarka blokuje dane witryn albo działa w trybie prywatnym, zapyta znowu. Szczegóły w <b>Instrukcji</b>, w sekcji „Gdzie zapisuje się stan".':
    'The files are read <b>in your browser and nowhere else</b>, and are kept in its local storage (IndexedDB) along with drive <code>C:</code> and the cards. Nothing is uploaded anywhere — this page has nowhere to upload it to. On your next visit the emulator starts straight away without asking again; if the browser blocks site data or is in private mode, it will ask again. The details are in the <b>Manual</b>, under "Where the state is kept".',
  'Wskaż pliki…': 'Choose files…',
  'albo upuść je tutaj — można wszystkie naraz': 'or drop them here — all at once is fine',
  'Co najmniej jeden plik pochodzi z nietestowanej rewizji ROM-u. Emulator go uruchomi, ale działanie nie jest gwarantowane — <b>na własną odpowiedzialność</b>.':
    'At least one file comes from an untested ROM revision. The emulator will run it, but nothing is guaranteed — <b>at your own risk</b>.',
  'Uruchom': 'Start',
  'Wczytaj z katalogu <code>rom/</code>': 'Load from the <code>rom/</code> directory',
  'Usuń zapamiętane': 'Forget stored files',
  'Nazwy plików nie mają znaczenia — emulator rozpoznaje je po zawartości, więc myląca kolejność <code>u3</code>/<code>u4</code> nie ma jak zaszkodzić. Sklejony zrzut obu ROM-ów systemowych (262&nbsp;144&nbsp;B) też zostanie przyjęty i podzielony automatycznie.':
    'File names do not matter — the emulator recognises files by their contents, so a misleading <code>u3</code>/<code>u4</code> ordering can do no harm. A single dump with both system ROMs joined together (262&nbsp;144&nbsp;B) is accepted too, and split automatically.',
  'Emulator testowano wyłącznie z rewizją DIP-DOS 2.11 / ROM v1.072. Inne rewizje uruchomi, ale bez gwarancji działania — na własną odpowiedzialność.':
    'The emulator has only been tested against DIP-DOS 2.11 / ROM v1.072. It will run other revisions, but with no guarantee — at your own risk.',
  'Sumy kontrolne testowanych plików →': 'Checksums of the tested files →',

  // ---- ROM checksums ------------------------------------------------------
  'Testowane rewizje ROM-u': 'Tested ROM revisions',
  'To jedyne zrzuty, z którymi ten emulator był sprawdzany — DIP-DOS 2.11, ROM v1.072. Każdy inny plik o właściwym rozmiarze i strukturze również zostanie uruchomiony, ale <b>bez żadnej gwarancji działania, na własną odpowiedzialność</b>. Jeśli zgłaszasz błąd, dopisz w opisie sumę SHA-256 swoich plików — bez tego nie da się odróżnić błędu emulatora od innej rewizji ROM-u.':
    'These are the only dumps this emulator has been checked against — DIP-DOS 2.11, ROM v1.072. Any other file of the right size and shape will run as well, but <b>with no guarantee whatsoever, at your own risk</b>. If you report a bug, include the SHA-256 of your files — without it there is no telling an emulator bug from a different ROM revision.',
  'CRC32 podano dlatego, że w tym formacie romsety opisują katalogi MAME — porównanie nie wymaga wtedy liczenia czegokolwiek. Emulator rozstrzyga po SHA-256; CRC32 służy mu za zapasowe kryterium tam, gdzie przeglądarka nie udostępnia <code>crypto.subtle</code> (połączenie inne niż HTTPS albo <code>localhost</code>).':
    'CRC32 is given because that is how MAME catalogues describe romsets — comparing then takes no computing at all. The emulator decides on SHA-256; CRC32 is its fallback where the browser withholds <code>crypto.subtle</code> (any connection that is neither HTTPS nor <code>localhost</code>).',

  // ---- memory card --------------------------------------------------------
  'Karta pamięci (napęd A:)': 'Memory card (drive A:)',
  'Karta pamięci to wymienny nośnik widoczny w Portfolio jako napęd <b>A:</b> — osobny od wbudowanego dysku C:. Tutaj można stworzyć nową, pustą kartę i od razu ją sformatować; wgrać gotowy obraz karty, np. pobrany wcześniej albo przygotowany przez kogoś innego; dorzucić na kartę pliki prosto z dysku swojego komputera, bez dotykania klawiatury Portfolio; oraz pobrać aktualną zawartość jako plik — żeby zrobić kopię zapasową albo przenieść kartę na inny komputer. Tak przygotowana karta jest w pełni zgodna z tym, czego oczekuje oryginalny system Portfolio — da się ją też w każdej chwili wysunąć i włożyć ponownie, jak prawdziwą.':
    'A memory card is removable storage, which the Portfolio sees as drive <b>A:</b> — separate from the built-in drive C:. Here you can create a new, empty card and format it on the spot; load a ready-made card image, downloaded earlier or prepared by somebody else; add files to the card straight from your own computer without touching the Portfolio keyboard; and download the current contents as a file, to keep a backup or move the card to another machine. A card prepared this way is exactly what the original Portfolio system expects — and it can be ejected and re-inserted at any time, like a real one.',
  'Nowa karta': 'New card',
  '32 KB': '32 KB',
  '64 KB': '64 KB',
  '128 KB': '128 KB',
  '256 KB': '256 KB',
  'Utwórz i sformatuj': 'Create and format',
  'Wgraj obraz…': 'Load image…',
  'Dodaj pliki…': 'Add files…',
  'Pobierz obraz': 'Download image',
  'Wysuń': 'Eject',
  'Karta zapisywalna <em>Włączone domyślnie — Portfolio może na niej zapisywać, kasować i formatować pliki, tak jak na zwykłej karcie RAM. Odznacz tylko wtedy, gdy chcesz sprawdzić, jak zachowa się oprogramowanie na karcie tylko do odczytu (ROM/OTPROM) — Portfolio zobaczy wtedy próby zapisu jako błąd, dokładnie jak przy prawdziwej karcie tego typu.</em>':
    'Card is writable <em>On by default — the Portfolio can write, delete and format on it, as on an ordinary RAM card. Clear the box only to see how software behaves on a read-only card (ROM/OTPROM) — the Portfolio will then see writes fail, exactly as it would with a real card of that kind.</em>',
  'Brak karty.': 'No card.',
  'Zawartość karty zmieniona z poziomu hosta — zrób <b>Reset</b>, żeby DOS nie użył starej kopii FAT.':
    'The card was changed from the host — do a <b>Reset</b>, so DOS does not go on using its old copy of the FAT.',
  'Rozszerzenie HPC-104 (drugi slot, napęd B:)': 'HPC-104 expansion (second slot, drive B:)',
  'HPC-104 to oryginalne rozszerzenie, które dokładało Portfolio <b>drugi slot na kartę</b> — widoczny w systemie jako napęd <b>B:</b> — oraz <b>256&nbsp;KB dodatkowej pamięci</b>. Dzięki niemu można mieć dwie karty naraz i kopiować pliki prosto z jednej na drugą, poleceniem <code>COPY&nbsp;A:*.*&nbsp;B:</code>. Rozszerzenie ma przelotkę, więc drukarka albo port szeregowy nadal działają podłączone za nim.':
    'The HPC-104 is the original expansion that gave the Portfolio <b>a second card slot</b> — drive <b>B:</b> to the system — and <b>256&nbsp;KB of extra memory</b>. With it you can hold two cards at once and copy files straight from one to the other with <code>COPY&nbsp;A:*.*&nbsp;B:</code>. The expansion passes the bus through, so a printer or a serial port still works plugged in behind it.',
  'Podłącz rozszerzenie HPC-104 <em>Daje drugi slot (napęd B:) oraz 256&nbsp;KB dodatkowej pamięci — ta druga działa niezależnie od karty, także przy pustym slocie. Obie rzeczy wymagają restartu, ale <b>innego</b>; szczegóły w ramce poniżej.</em>':
    'Fit the HPC-104 expansion <em>Gives you a second slot (drive B:) and 256&nbsp;KB of extra memory — the memory works independently of the card, empty slot included. Both need a restart, but <b>different ones</b>; the details are in the box below.</em>',
  '<b>Dwie rzeczy, dwa różne restarty.</b> Napęd <code>B:</code> pojawia się już po zwykłym <b>Resecie</b> — bez niego <code>DIR B:</code> pokaże tylko <code>Insert disk for drive B:</code>. Natomiast dodatkowe 256&nbsp;KB pamięci liczone jest wyłącznie przy <b>Zimnym starcie</b>: ciepły Reset zostawia starą wartość, więc <code>CHKDSK</code> dalej pokaże 126&nbsp;976&nbsp;B zamiast 389&nbsp;120&nbsp;B. Zimny start <b>kasuje zawartość dysku C:</b>, więc wcześniej zgraj z niego, co chcesz zachować. Karty w slotach A: i B: przetrwają go bez zmian.':
    '<b>Two things, two different restarts.</b> Drive <code>B:</code> appears after an ordinary <b>Reset</b> — without one, <code>DIR B:</code> only says <code>Insert disk for drive B:</code>. The extra 256&nbsp;KB, on the other hand, is counted only on a <b>Cold start</b>: a warm Reset leaves the old figure, so <code>CHKDSK</code> goes on reporting 126&nbsp;976&nbsp;B instead of 389&nbsp;120&nbsp;B. A cold start <b>wipes drive C:</b>, so take off it whatever you want to keep first. Cards in slots A: and B: come through untouched.',
  'Zimny start (przelicz pamięć)': 'Cold start (recount the memory)',
  'Reset (podłącz napęd B:)': 'Reset (attach drive B:)',
  'Nowa karta w slocie B:': 'New card in slot B:',
  'Karta zapisywalna <em>Tak samo jak w slocie A: odznacz, żeby udawać kartę tylko do odczytu.</em>':
    'Card is writable <em>As in slot A:, clear the box to play a read-only card.</em>',

  // ---- parallel port ------------------------------------------------------
  'Port równoległy (HPC-101)': 'Parallel port (HPC-101)',
  'Ten sam kabel łączy dwie zupełnie różne funkcje. Portfolio może przez niego <b>drukować</b>, tak jakby po drugiej stronie stała prawdziwa drukarka, albo <b>wymieniać pliki</b> z działającym systemem. Nie trzeba niczego przełączać ręcznie — Portfolio samo rozpoznaje, do czego akurat używasz portu, po tym, jakie polecenie wydasz.':
    'One cable carries two entirely different jobs. The Portfolio can <b>print</b> through it, as though a real printer stood at the other end, or <b>exchange files</b> with a running system. There is nothing to switch by hand — the Portfolio works out which one you are doing from the command you give.',
  'Podłącz interfejs równoległy <em>Portfolio sprawdza, co jest podłączone do gniazda rozszerzeń, tylko raz — przy starcie systemu. Jeśli zmienisz to ustawienie w trakcie pracy, zrób Reset, żeby Portfolio zauważyło urządzenie.</em>':
    'Fit the parallel interface <em>The Portfolio looks at what is in the expansion socket exactly once — when the system starts. If you change this setting while it runs, do a Reset so the Portfolio notices the device.</em>',
  'Reset (wykryj interfejs)': 'Reset (detect the interface)',
  'Drukowanie do pliku': 'Printing to a file',
  'Wszystko, co w Portfolio wysłałbyś normalnie do drukarki, trafia tutaj do bufora zamiast na papier. W dowolnym momencie możesz zamknąć wydruk i ściągnąć jego treść jako zwykły plik tekstowy. W systemie Portfolio wystarczy np. <code>DIR &gt; PRN</code> albo <code>COPY PLIK.TXT PRN</code>.':
    'Anything the Portfolio would normally send to a printer lands in a buffer here instead of on paper. At any point you can close the print job and download it as a plain text file. On the Portfolio side, <code>DIR &gt; PRN</code> or <code>COPY FILE.TXT PRN</code> is all it takes.',
  'Zakończ wydruk i pobierz plik': 'Close the print job and download it',
  'Transfer plików': 'File transfer',
  'Pozwala przenosić pliki między komputerem a działającym Portfolio bez restartu i bez podmieniania karty pamięci. Zanim zaczniesz, przełącz Portfolio w tryb odbioru: przytrzymaj <kbd>`</kbd>, wciśnij <kbd>S</kbd>, a potem wybierz <b>File transfer</b> → <b>Server</b>. Gdy na ekranie Portfolio pojawi się <code>Waiting for connection</code>, urządzenie czeka gotowe na plik.':
    'This moves files between your computer and a running Portfolio, with no restart and no swapping of memory cards. Before you start, put the Portfolio into receive mode: hold <kbd>`</kbd>, press <kbd>S</kbd>, then choose <b>File transfer</b> → <b>Server</b>. Once the Portfolio shows <code>Waiting for connection</code>, it is ready for a file.',
  'Wyślij pliki…': 'Send files…',
  'Pokaż pliki na Portfolio': 'List the files on the Portfolio',
  'Katalog docelowy / maska': 'Destination directory / mask',
  'To pole ma dwie role. Przy wysyłaniu mówi, do jakiego katalogu na Portfolio mają trafić pliki (domyślnie <code>C:\\</code>). Przy podglądzie — czyli po kliknięciu „Pokaż pliki na Portfolio” — można wpisać też maskę, np. <code>C:\\*.TXT</code>, <code>A:\\*.*</code> albo <code>C:\\SYSTEM\\*.*</code>, żeby zobaczyć tylko wybrane pliki; sam katalog bez maski dostaje automatycznie <code>*.*</code>. Jedno ograniczenie: Portfolio potrafi w ten sposób podać <b>wyłącznie same nazwy plików</b> — bez rozmiarów, dat i bez zawartości podkatalogów.':
    'This field has two jobs. When sending, it says which directory on the Portfolio the files should land in (<code>C:\\</code> by default). When listing — after "List the files on the Portfolio" — it also takes a mask, such as <code>C:\\*.TXT</code>, <code>A:\\*.*</code> or <code>C:\\SYSTEM\\*.*</code>, to see only some of them; a bare directory gets <code>*.*</code> appended automatically. One limitation: all the Portfolio can report this way is <b>the file names themselves</b> — no sizes, no dates and nothing from subdirectories.',
  'Gotowe.': 'Ready.',

  // ---- keyboard -----------------------------------------------------------
  'Klawiatura Portfolio nie jest identyczna z klawiaturą PC — kilku klawiszy po prostu na niej nie ma, a niektóre nazywają się inaczej. Emulator odwzorowuje układ tak wiernie, jak się da, więc większość klawiszy robi to, czego można się spodziewać po ich położeniu, ale te kilka różnic warto znać:':
    'The Portfolio keyboard is not the same as a PC keyboard — a few keys simply are not there, and some go by other names. The emulator maps the layout as faithfully as it can, so most keys do what their position suggests, but the handful of differences is worth knowing:',
  'Klawisz Portfolio': 'Portfolio key',
  'Klawisz PC': 'PC key',
  'Atari': 'Atari',
  '<kbd>`</kbd> (tylda, na lewo od <kbd>1</kbd>)': '<kbd>`</kbd> (backtick, left of <kbd>1</kbd>)',
  'Fn': 'Fn',
  'Lock': 'Lock',
  '<kbd>Caps&nbsp;Lock</kbd>': '<kbd>Caps&nbsp;Lock</kbd>',
  'Del / Ins': 'Del / Ins',
  '<kbd>Delete</kbd> lub <kbd>Insert</kbd>': '<kbd>Delete</kbd> or <kbd>Insert</kbd>',
  'Pozostałe': 'Everything else',
  'w tych samych miejscach co na PC': 'in the same places as on a PC',
  'Portfolio nie ma osobnej klawiatury numerycznej — cyfry i podstawowe działania matematyczne są dostępne jako nakładka pod klawiszem Atari, np. <kbd>`</kbd>+<kbd>M</kbd> daje <code>0</code>. Pełny układ tej nakładki znajdziesz w oryginalnej instrukcji Portfolio.':
    'The Portfolio has no separate numeric keypad — digits and the basic arithmetic keys live on an overlay under the Atari key, so <kbd>`</kbd>+<kbd>M</kbd> gives <code>0</code>. The full overlay is in the original Portfolio manual.',
  'Dla dociekliwych: to odwzorowanie działa na poziomie sprzętowym — dokładnie tak, jak zrobiłby to prawdziwy Portfolio — a nie przez podmianę napisów na klawiszach. Dlatego stare programy, które próbowałyby czytać klawiaturę bezpośrednio, tak jak robi się to na PC, i tak nie zadziałają: to inny sprzęt, mimo że efekt wygląda znajomo.':
    'For the curious: the mapping happens at the hardware level — exactly the way a real Portfolio would do it — not by relabelling keys. Which is why old programs that read the keyboard directly, the way one does on a PC, still will not work: this is different hardware, however familiar the result looks.',

  // ---- sending a file over the line ---------------------------------------
  'Wysyłanie pliku na linię': 'Sending a file onto the line',
  'Plik:': 'File:',
  'Bajty schodzą z kolejki w tempie ustawionym w polu „Opóźnienie nadawania”. Przerwanie porzuca resztę — prawdziwe Portfolio dostanie wtedy plik ucięty w tym miejscu.':
    'Bytes leave the queue at the rate set under "Transmit delay". Aborting drops the rest — a real Portfolio then ends up with the file cut off at that point.',
  'Przerwij': 'Abort',

  // ---- built-in applications ----------------------------------------------
  'Wbudowane aplikacje': 'Built-in applications',
  'Klawisz z symbolem Atari działa jak <kbd>Ctrl</kbd> czy <kbd>Alt</kbd> na PC — sam, naciśnięty w prompcie DOS-u, nic nie robi. Trzeba go <b>przytrzymać</b> i dopiero wcisnąć literę, żeby otworzyć jedną z sześciu wbudowanych aplikacji.':
    'The key with the Atari symbol works like <kbd>Ctrl</kbd> or <kbd>Alt</kbd> on a PC — on its own, at the DOS prompt, it does nothing. You have to <b>hold</b> it and then press a letter to open one of the six built-in applications.',
  'Skrót': 'Shortcut',
  'Aplikacja': 'Application',
  'Co to jest': 'What it is',
  'Address Book': 'Address Book',
  'Książka adresowa — kontakty i numery telefonów, z możliwością wybierania numeru tonami wprost z Portfolio.':
    'Contacts and phone numbers, with the Portfolio able to dial a number in tones itself.',
  'Calculator': 'Calculator',
  'Kalkulator z pamięcią i podglądem ostatnich działań.':
    'A calculator with memories and a view of the last few operations.',
  'Diary': 'Diary',
  'Kalendarz i terminarz spotkań.': 'A calendar and appointment book.',
  'Editor': 'Editor',
  'Prosty edytor tekstu, do zwykłych plików <code>.TXT</code>.':
    'A plain text editor, for ordinary <code>.TXT</code> files.',
  'Setup': 'Setup',
  'Ustawienia systemu: ekran, dźwięk, data i godzina, port szeregowy i drukarka.':
    'System settings: display, sound, date and time, serial port and printer.',
  'Worksheet': 'Worksheet',
  'Arkusz kalkulacyjny zgodny z plikami Lotus 1-2-3 — da się nim otwierać i zapisywać te same pliki, co na komputerze biurowym z tamtej epoki.':
    'A spreadsheet that speaks Lotus 1-2-3 — it opens and saves the same files an office machine of the day would.',
  'To samo menu otwiera też polecenie <code>APP</code> wpisane w prompcie. Same nazwy aplikacji nie są jednak poleceniami DOS-u — wpisanie wprost <code>EDIT</code> zwróci <code>Bad command or program not found</code>, trzeba skorzystać ze skrótu klawiszowego albo z <code>APP</code>.':
    'The <code>APP</code> command at the prompt opens the same menu. The application names are not DOS commands, though — typing <code>EDIT</code> gets you <code>Bad command or program not found</code>, so it is either the shortcut or <code>APP</code>.',
  'Będąc już <b>wewnątrz</b> uruchomionej aplikacji, ten sam klawisz Atari — tym razem naciśnięty i puszczony <em>sam</em>, bez żadnej litery — otwiera pasek menu programu.':
    'Once you are <b>inside</b> a running application, that same Atari key — pressed and released <em>on its own</em> this time, with no letter — opens the program\'s menu bar.',
  'Co Portfolio o sobie pamięta': 'What the Portfolio remembers about itself',
  'Wszystkie ustawienia wbudowanych aplikacji — łącznie z tym, co wpisałeś w <b>Setupie</b> — leżą w jednym pliku na dysku <code>C:</code>: <code>C:\\SYSTEM\\PERMDATA.DAT</code>, równo 730 bajtów, rozpisanych w dokumentacji DIP-a co do bajta. Emulator czyta go wprost z pamięci maszyny.':
    'Every setting the built-in applications hold — everything you entered in <b>Setup</b> included — sits in one file on drive <code>C:</code>: <code>C:\\SYSTEM\\PERMDATA.DAT</code>, exactly 730 bytes, laid out byte by byte in DIP\'s documentation. The emulator reads it straight out of the machine\'s memory.',
  '<b>Plik powstaje dopiero przy wyjściu z aplikacji</b> — dokładnie wtedy, gdy wciśniesz <kbd>Esc</kbd> w menu najwyższego poziomu. Do tej chwili zmiany żyją wyłącznie w pamięci, więc maszyna siedząca w Edytorze pokaże tu jeszcze wartości z poprzedniego wyjścia, a maszyna, która ani razu nie była w aplikacji, nie ma tego pliku w ogóle.':
    '<b>The file is written only when you leave the applications</b> — precisely when you press <kbd>Esc</kbd> at the top level menu. Until then every change lives in memory alone, so a machine sitting in the Editor still shows the values from the last time it left, and a machine that has never been in an application has no such file at all.',
  'Odczytaj ustawienia': 'Read the settings',
  'Ustawienia zapamiętane przez Portfolio': 'The settings the Portfolio remembers',
  'Odczytane z pliku <code>C:\\SYSTEM\\PERMDATA.DAT</code> — 730 bajtów na dysku <code>C:</code> emulowanej maszyny, w układzie rozpisanym w dokumentacji DIP-a co do bajta. Zakładki odpowiadają sekcjom, na jakie dzieli te ustawienia sam Portfolio.':
    'Read from <code>C:\\SYSTEM\\PERMDATA.DAT</code> — 730 bytes on the emulated machine\'s drive <code>C:</code>, in the layout DIP\'s documentation gives byte by byte. The tabs follow the sections the Portfolio itself divides these settings into.',
  'Adresy': 'Addresses',
  'Schowek': 'Clipboard',
  'Odczytaj ponownie': 'Read again',
  'Nie odczytano jeszcze niczego.': 'Nothing read yet.',

  // ---- serial port --------------------------------------------------------
  'Port szeregowy (HPC-102)': 'Serial port (HPC-102)',
  'To druga droga, którą Portfolio może rozmawiać ze światem zewnętrznym — kablem RS-232 zamiast równoległym. System Portfolio widzi go jako urządzenie <code>AUX</code>, więc polecenia w rodzaju <code>ECHO&nbsp;coś&nbsp;&gt;&nbsp;AUX</code> działają od razu po Resecie, bez żadnej dodatkowej konfiguracji. Domyślna prędkość to 2400 bodów — jeśli zmienisz ją w Portfolio, dopasuj też ustawienia po drugiej stronie kabla.':
    'This is the Portfolio\'s other way of talking to the outside world — an RS-232 cable instead of the parallel one. The Portfolio system sees it as the <code>AUX</code> device, so commands like <code>ECHO&nbsp;something&nbsp;&gt;&nbsp;AUX</code> work straight after a Reset, with nothing to configure. The default speed is 2400 baud — if you change it on the Portfolio, match the other end of the cable too.',
  'Podłącz interfejs szeregowy <em>Portfolio sprawdza, co jest podłączone do gniazda rozszerzeń, tylko raz — przy starcie systemu, więc po zmianie tej opcji zrób Reset. Uwaga: port szeregowy i równoległy dzielą to samo gniazdo, więc mogą działać tylko pojedynczo — włączenie tego wyłącza tamten.</em>':
    'Fit the serial interface <em>The Portfolio looks at what is in the expansion socket exactly once — when the system starts — so do a Reset after changing this. Note that the serial and parallel ports share the one socket and only one of them can be fitted: turning this on turns the other off.</em>',
  'Drugi koniec kabla': 'The other end of the cable',
  'Terminal w przeglądarce': 'A terminal in the browser',
  'Prawdziwy port RS-232 (Web Serial)': 'A real RS-232 port (Web Serial)',
  'Wirtualny modem AT → WebSocket': 'A virtual AT modem → WebSocket',
  'Druga karta przeglądarki (null-modem)': 'Another browser tab (null modem)',
  'Podłącz': 'Connect',
  'Rozłącz': 'Disconnect',
  'Wybierz, z czym port szeregowy ma faktycznie rozmawiać po drugiej stronie kabla — poniżej pojawi się krótkie wyjaśnienie wybranej opcji.':
    'Choose what the serial port actually talks to at the far end of the cable — a short explanation of your choice appears below.',
  'Najprostsza opcja i dobra na start. To, co wpiszesz w polu tekstowym niżej, trafia do Portfolio tak, jakby ktoś pisał po drugiej stronie kabla; to, co Portfolio samo wyśle, pojawia się w oknie terminala. Nie wymaga żadnego dodatkowego sprzętu.':
    'The simplest option and a good place to start. What you type in the field below reaches the Portfolio as though somebody were typing at the other end of the cable; whatever the Portfolio sends appears in the terminal window. No extra hardware needed.',
  'Łączy z prawdziwym portem szeregowym w Twoim komputerze — np. przejściówką USB→RS-232 podłączoną do prawdziwego Portfolio albo innego urządzenia. Przeglądarka zapyta, który port systemowy udostępnić. Wymaga Chrome albo Edge oraz strony otwartej przez <code>https://</code> lub <code>localhost</code>. Prędkość dobierana jest automatycznie z tego, co akurat ma zaprogramowane Portfolio — jeśli druga strona kabla ma inną, zmień ją w Portfolio przez <kbd>`</kbd>+<kbd>S</kbd> → <b>Serial port</b>.':
    'Connects to a real serial port on your computer — a USB-to-RS-232 adapter wired to an actual Portfolio, say, or to any other device. The browser will ask which system port to hand over. Needs Chrome or Edge, and the page served over <code>https://</code> or <code>localhost</code>. The speed follows whatever the Portfolio currently has programmed — if the far end differs, change it on the Portfolio under <kbd>`</kbd>+<kbd>S</kbd> → <b>Serial port</b>.',
  'Szablon połączenia': 'Connection template',
  'Udaje staroświecki modem: rozumie komendy w rodzaju <code>ATZ</code> i <code>ATDT&nbsp;numer</code>, odpowiada <code>OK</code>/<code>CONNECT</code> tak jak zrobiłby to prawdziwy modem — tylko zamiast dzwonić linią telefoniczną, łączy się przez WebSocket. Numer, który wybierzesz w Portfolio, wstawiany jest w miejsce <code>{host}</code> i <code>{port}</code> w szablonie połączenia; adres zaczynający się od <code>ws://</code> idzie wprost, bez szablonu. Trzy znaki <code>+</code> wracają do trybu komend, <code>ATH</code> rozłącza.':
    'Plays an old-fashioned modem: it understands commands like <code>ATZ</code> and <code>ATDT&nbsp;number</code> and answers <code>OK</code>/<code>CONNECT</code> the way a real modem would — only instead of dialling a telephone line it opens a WebSocket. Whatever number you dial on the Portfolio is substituted for <code>{host}</code> and <code>{port}</code> in the connection template; an address beginning with <code>ws://</code> is used as it stands. Three <code>+</code> characters return to command mode and <code>ATH</code> hangs up.',
  '<b>Ten przekaźnik musisz uruchomić u siebie.</b> Przeglądarka z zasady nie otwiera gniazd TCP, więc telnet zawsze potrzebuje pośrednika po stronie, która to potrafi — i nie da się go dołożyć do samej strony. Gotowy leży obok: <a href="tools/ws-tcp-proxy.mjs" download="">ws-tcp-proxy.mjs</a>, jeden plik, bez zależności, potrzebny tylko <a href="https://nodejs.org/" target="_blank" rel="noopener">Node.js</a>. Pobierz go i uruchom <i>w terminalu</i>, nie w przeglądarce:':
    '<b>You have to run this relay yourself.</b> A browser does not open TCP sockets as a matter of principle, so telnet always needs a go-between on the side that can — and no amount of work on this page can supply one. There is one right here: <a href="tools/ws-tcp-proxy.mjs" download="">ws-tcp-proxy.mjs</a>, a single file with no dependencies, needing only <a href="https://nodejs.org/" target="_blank" rel="noopener">Node.js</a>. Download it and run it <i>in a terminal</i>, not in the browser:',
  'Potem wróć tutaj, wybierz <b>Podłącz</b> i w Portfolio wpisz <code>ATDT&nbsp;bbs.fozztexx.com:23</code>. Przekaźnik prowadzi rozmowę telnetu za Portfolio, więc do terminala trafia sam tekst. Cele spoza <code>--allow</code> są odrzucane — bez tej listy nic nie jest osiągalne, bo proxy łączące się gdziekolwiek jest otwartą przekaźnią do Twojej sieci lokalnej.':
    'Then come back here, press <b>Connect</b>, and type <code>ATDT&nbsp;bbs.fozztexx.com:23</code> on the Portfolio. The relay carries the telnet conversation on the Portfolio\'s behalf, so only text reaches the terminal. Targets outside <code>--allow</code> are refused — without that list nothing is reachable at all, because a proxy that connects anywhere is an open relay into your local network.',
  'Adresy sprawdzone jako działające: <code>bbs.fozztexx.com:23</code> (Level 29), <code>bbs.retrocampus.com:23</code>, <code>vert.synchro.net:23</code>, <code>bbs.hispamsx.org:23</code>, <code>telehack.com:23</code>. Przekaźnik domyślnie wycina sekwencje ANSI, bo ACOM ich nie interpretuje i wypisałby je dosłownie (<code>--ascii off</code> je zostawia). Ekran ma za to tylko 40 znaków szerokości, więc grafika z 80-kolumnowych boardów i tak się łamie — <code>bbs.fozztexx.com</code> i <code>bbs.retrocampus.com</code> witają się czystym tekstem i są pod Portfolio najznośniejsze.':
    'Addresses confirmed to work: <code>bbs.fozztexx.com:23</code> (Level 29), <code>bbs.retrocampus.com:23</code>, <code>vert.synchro.net:23</code>, <code>bbs.hispamsx.org:23</code>, <code>telehack.com:23</code>. The relay strips ANSI sequences by default, because ACOM does not interpret them and would print them literally (<code>--ascii off</code> leaves them in). The screen is only 40 characters wide anyway, so artwork from 80-column boards breaks up regardless — <code>bbs.fozztexx.com</code> and <code>bbs.retrocampus.com</code> greet you in plain text and are the easiest to live with on a Portfolio.',
  'Kanał': 'Channel',
  'Spina dwie działające obok siebie kopie Portfoliator, tak jakby dwa prawdziwe Portfolio połączono kablem null-modem. Otwórz Portfoliator w drugiej karcie przeglądarki, włącz tam port szeregowy w tym samym trybie i wpisz ten sam kanał — obie kopie odnajdą się nawzajem.':
    'Ties two running copies of Portfoliator together, as though two real Portfolios were joined by a null-modem cable. Open Portfoliator in a second browser tab, fit its serial port in the same mode and enter the same channel — the two will find each other.',
  'Opóźnienie nadawania': 'Transmit delay',
  'ms/znak': 'ms/char',
  'ms/linia': 'ms/line',
  'Dławi to, co emulator wypuszcza <b>na kabel</b> — odpowiednik <i>Transmit delay</i> z Tera Term. Potrzebne wyłącznie wtedy, gdy po drugiej stronie jest <b>prawdziwe Portfolio</b>: układ 82C50A trzyma jeden bajt, a DIP-DOS odpytuje go programowo, więc strumień bez przerw gubi znaki, kiedy system akurat dopisuje dane do pliku. Objaw jest charakterystyczny — <b>losowo</b> brakujące znaki, za każdym razem w innym miejscu. Sprawdzone ustawienie to <b>15 ms/znak i 15 ms/linia</b>; przy zerach dławienie jest całkowicie wyłączone i nie powstaje żadna kolejka.':
    'This throttles what the emulator puts <b>onto the cable</b> — the equivalent of Tera Term\'s <i>Transmit delay</i>. It is needed only when a <b>real Portfolio</b> is at the far end: the 82C50A holds a single byte and DIP-DOS polls it in software, so an unbroken stream loses characters whenever the system stops to append to a file. The symptom is distinctive — characters missing <b>at random</b>, in a different place every time. The settings known to work are <b>15 ms/char and 15 ms/line</b>; at zero the throttle is off entirely and no queue is formed.',
  'Dotyczy obu źródeł naraz: i tego, co wysyłasz stąd „na linię”, i tego, co nadaje emulowane Portfolio przez <code>AUX</code>. Emulowanej maszyny to nie zatrzymuje — ona skończy swoje <code>COPY</code> dużo wcześniej, niż bajty zejdą z kolejki, więc licznik <b>w kolejce</b> obok jest jedyną oznaką, że transfer jeszcze trwa. Rozłączenie kolejkę porzuca.':
    'It applies to both sources at once: what you send from here "onto the line", and what the emulated Portfolio sends through <code>AUX</code>. It does not hold the emulated machine up — it will finish its <code>COPY</code> long before the bytes have left the queue, so the <b>queued</b> counter beside it is the only sign that the transfer is still running. Disconnecting abandons the queue.',
  'Limit ciszy na linii': 'Silence timeout on the line',
  'domyślny z BIOS-u (~4 s)': 'the BIOS default (~4 s)',
  '~1 min': '~1 min',
  '~3 min': '~3 min',
  '~18 min': '~18 min',
  'Kiedy przez chwilę nic nie płynie po kablu, DIP-DOS w końcu się poddaje — pokazuje <code>Not ready error</code> i pyta <code>Abort, Retry, Ignore?</code>. To ustawienie mówi, jak długo ma czekać, zanim to zrobi. Podnieś je, jeśli przesyłasz coś ręcznie przez <code>COPY CON AUX</code> i zwyczajnie nie nadążasz pisać. Wybrana wartość zostaje też po Resecie — mimo że system Portfolio przy każdym starcie próbuje wrócić do wartości domyślnej.':
    'When nothing flows down the cable for a while, DIP-DOS eventually gives up — it shows <code>Not ready error</code> and asks <code>Abort, Retry, Ignore?</code>. This setting says how long it waits first. Raise it if you are sending something by hand through <code>COPY CON AUX</code> and simply cannot type fast enough. The value also survives a Reset — even though the Portfolio system tries to restore its default on every start.',
  'Na <b>prawdziwym</b> Portfolio ten przełącznik oczywiście nic nie zmieni — to ustawienie trzeba tam wprowadzić bezpośrednio w systemie. Służy do tego gotowy programik <a href="tools/auxwait.com" download="">AUXWAIT.COM</a> (76 bajtów): <code>AUXWAIT&nbsp;14</code> wydłuża limit do około minuty, samo <code>AUXWAIT</code> przywraca wartość domyślną. Wystarczy uruchomić go raz po starcie — najwygodniej dopisując do <code>AUTOEXEC.BAT</code> — bo trzyma się aż do kolejnego restartu. Możesz go najpierw wypróbować tutaj, w emulatorze.':
    'On a <b>real</b> Portfolio this control naturally changes nothing — there the setting has to be made on the machine itself. There is a small program for it: <a href="tools/auxwait.com" download="">AUXWAIT.COM</a> (76 bytes). <code>AUXWAIT&nbsp;14</code> stretches the timeout to about a minute, and <code>AUXWAIT</code> on its own restores the default. Running it once after startup is enough — most conveniently from <code>AUTOEXEC.BAT</code> — because it holds until the next restart. You can try it here in the emulator first.',
  'Rozłączony.': 'Disconnected.',
  'Linia:': 'Line:',
  '· odebrano': '· received',
  'B · wysłano': 'B · sent',
  'Terminal': 'Terminal',
  'Na żywo pokazuje wszystko, co Portfolio wysyła przez ten port — niezależnie od wybranego trybu połączenia. Nawet gdy rozmawiasz z prawdziwym sprzętem albo modemem, tutaj zobaczysz podgląd całej rozmowy.':
    'Shows everything the Portfolio sends through this port as it happens, whichever connection mode is selected. Even when you are talking to real hardware or to a modem, the whole conversation is previewed here.',
  'Wysyłaj': 'Send to',
  'do emulowanego Portfolio': 'the emulated Portfolio',
  'na linię, do drugiego urządzenia': 'the line, to the other device',
  'Dotyczy trzech rzeczy poniżej: pola tekstowego, „Wyślij plik” i znaku końca pliku. Zostaw „do emulowanego Portfolio”, gdy to ta strona ma udawać drugi koniec kabla — tak jest we wszystkich przykładach niżej. Przełącz na „na linię” tylko wtedy, gdy po drugiej stronie jest coś innego, do czego naprawdę chcesz coś wysłać — np. prawdziwe Portfolio podłączone przez Web Serial.':
    'This governs the three things below it: the text field, "Send file" and the end-of-file character. Leave it on "the emulated Portfolio" when this page is the one playing the far end of the cable — which is the case in every example below. Switch to "the line" only when something else is out there that you genuinely want to send to, such as a real Portfolio on Web Serial.',
  'tekst do wysłania': 'text to send',
  'Wyślij + CR': 'Send + CR',
  'Wyczyść': 'Clear',
  'Zapisuj do pliku': 'Capture to a file',
  'Wyślij plik…': 'Send file…',
  'Znak końca pliku (Ctrl+Z)': 'End-of-file character (Ctrl+Z)',
  'Jak przenieść plik': 'How to move a file',
  '<b>Z komputera do Portfolio:</b> w Portfolio wpisz <code>COPY AUX PLIK.TXT</code>, żeby było gotowe na odbiór, tutaj kliknij „Wyślij plik…”, a na koniec „Znak końca pliku”. Przy wysyłce <b>na linię</b> otwiera się osobne okno z paskiem postępu i przyciskiem „Przerwij” — przy włączonym opóźnieniu nadawania transfer trwa minuty, więc widać, ile jeszcze zostało. Bez tego ostatniego kroku Portfolio będzie czekało na więcej danych, aż w końcu się podda i zgłosi <code>Not ready error</code> — system Portfolio nie ma innego sposobu, żeby poznać koniec pliku przychodzącego z urządzenia.':
    '<b>From the computer to the Portfolio:</b> type <code>COPY AUX FILE.TXT</code> on the Portfolio so it is ready to receive, press "Send file…" here, and finish with "End-of-file character". Sending <b>onto the line</b> opens a separate window with a progress bar and an "Abort" button — with the transmit delay on, a transfer runs for minutes, so it helps to see how much is left. Without that last step the Portfolio waits for more data until it gives up and reports <code>Not ready error</code> — the Portfolio system has no other way of learning where a file from a device ends.',
  '<b>Z Portfolio do komputera:</b> włącz „Zapisuj do pliku”, w Portfolio wykonaj <code>COPY PLIK.TXT AUX</code>, a na koniec kliknij „Zakończ zapis i pobierz”.':
    '<b>From the Portfolio to the computer:</b> turn on "Capture to a file", run <code>COPY FILE.TXT AUX</code> on the Portfolio, and finish with "Close the capture and download".',
  '<b>Między dwiema kartami przeglądarki:</b> wybierz tryb null-modem po obu stronach, na odbierającej wpisz w Portfolio <code>COPY AUX PLIK.TXT</code>, na wysyłającej <code>COPY PLIK.TXT AUX</code>, a na koniec na <b>odbierającej</b> karcie kliknij „Znak końca pliku” — dokładnie tak samo, jak w pierwszym przykładzie wyżej.':
    '<b>Between two browser tabs:</b> choose null-modem mode on both sides, type <code>COPY AUX FILE.TXT</code> on the receiving Portfolio and <code>COPY FILE.TXT AUX</code> on the sending one, then press "End-of-file character" in the <b>receiving</b> tab — exactly as in the first example above.',

  // ---- manual: getting started --------------------------------------------
  'Pierwsze uruchomienie': 'Starting up for the first time',
  'Ekran copyright DIP-a → dowolny klawisz.': 'DIP\'s copyright screen → any key.',
  'Wybór układu klawiatury → <kbd>E</kbd> (English / QWERTY).':
    'Keyboard layout → <kbd>E</kbd> (English / QWERTY).',
  '<code>New date (mm-dd-yy):</code> → data albo <kbd>Enter</kbd>.':
    '<code>New date (mm-dd-yy):</code> → a date, or <kbd>Enter</kbd>.',
  '<code>New time:</code> → godzina albo <kbd>Enter</kbd>.':
    '<code>New time:</code> → a time, or <kbd>Enter</kbd>.',
  'Prompt <code>c&gt;</code>.': 'The <code>c&gt;</code> prompt.',
  'Przydatne polecenia: <code>APP</code>, <code>VER</code>, <code>DIR</code>, <code>CLS</code>, <code>FORMAT A:</code>.':
    'Useful commands: <code>APP</code>, <code>VER</code>, <code>DIR</code>, <code>CLS</code>, <code>FORMAT A:</code>.',
  'Własne oprogramowanie na karcie': 'Your own software on a card',
  'Karta pamięci → wybierz rozmiar → <b>Utwórz i sformatuj</b>.':
    'Memory card → pick a size → <b>Create and format</b>.',
  '<b>Dodaj pliki…</b> — trafią do katalogu głównego karty.':
    '<b>Add files…</b> — they land in the card\'s root directory.',
  '<b>Reset</b> — DOS trzyma FAT w pamięci podręcznej i bez tego zobaczy starą zawartość.':
    '<b>Reset</b> — DOS caches the FAT and without one it goes on seeing the old contents.',
  'W emulatorze: <code>A:</code> żeby przejść na kartę, albo <code>COPY A:\\*.* C:\\</code>.':
    'In the emulator: <code>A:</code> to switch to the card, or <code>COPY A:\\*.* C:\\</code>.',
  'Dysk <code>C:</code> to RAM-dysk w tej samej pamięci 128&nbsp;KB — zostaje na nim około <b>31&nbsp;KB</b>. Większe programy uruchamiaj wprost z karty.':
    'Drive <code>C:</code> is a RAM disk in that same 128&nbsp;KB of memory — about <b>31&nbsp;KB</b> of it is left free. Run anything larger straight off the card.',

  // ---- manual: where the state is kept ------------------------------------
  'Gdzie zapisuje się stan': 'Where the state is kept',
  'Prawdziwe Portfolio trzymało wszystko w pamięci podtrzymywanej bateryjnie. Tutaj tę rolę pełni <b>IndexedDB</b> — magazyn danych wbudowany w przeglądarkę. <b>Nic nie trafia na serwer</b>: wszystko poniżej zostaje na Twoim komputerze i znika razem z danymi tej witryny.':
    'A real Portfolio kept everything in battery-backed memory. That job falls here to <b>IndexedDB</b>, the data store built into the browser. <b>Nothing goes to a server</b>: everything below stays on your computer and disappears together with this site\'s data.',
  'Co': 'What',
  'Kiedy jest zapisywane': 'When it is written',
  'Pamięć NVRAM — dysk <code>C:</code> z plikami i ustawieniami DOS-u':
    'NVRAM — drive <code>C:</code> with its files and DOS settings',
  'co 5 sekund oraz przy przełączeniu karty przeglądarki':
    'every 5 seconds, and when you switch browser tabs',
  'Obrazy kart w slotach <code>A:</code> i <code>B:</code>':
    'Card images in slots <code>A:</code> and <code>B:</code>',
  'przy każdej zmianie zawartości, także tej z poziomu DOS-u':
    'on every change of contents, DOS\'s own writes included',
  '256 KB pamięci rozszerzenia HPC-104': 'The HPC-104\'s 256 KB of memory',
  'jak wyżej': 'as above',
  'Podłączony sprzęt (HPC-104, port równoległy, port szeregowy)':
    'Fitted hardware (HPC-104, parallel port, serial port)',
  'przy zmianie ustawienia': 'when the setting changes',
  'Pliki ROM': 'ROM files',
  'raz, przy pierwszym wskazaniu': 'once, when first supplied',
  'Pierwsze cztery pozycje należą do <b>tej karty przeglądarki</b> — druga otwarta karta dostaje własny, niezależny komplet, żeby dwa emulatory nie nadpisywały sobie dysku <code>C:</code>. Pliki ROM są wspólne dla wszystkich, bo to tożsamość maszyny, a nie jej stan.':
    'The first four belong to <b>this browser tab</b> — a second open tab gets its own independent set, so that two emulators do not overwrite each other\'s drive <code>C:</code>. The ROM files are shared by all of them, being the machine\'s identity rather than its state.',
  '<b>Przeglądarka musi obsługiwać IndexedDB</b> — bez tego emulator uruchomi się i będzie działał, ale po zamknięciu karty przepadnie wszystko: dysk <code>C:</code>, karty i wskazane pliki ROM. W praktyce obsługują je <b>wszystkie</b> przeglądarki zdolne w ogóle uruchomić ten emulator, bo wymaga on rzeczy nowszych — modułów ES w Web Workerze. Realny próg to <b>Chrome / Edge 80+</b> (i pochodne: Opera, Brave, Vivaldi), <b>Safari 15+</b> (także na iOS) oraz <b>Firefox 114+</b>. IndexedDB samo w sobie działa w nich od dawna i nie ono jest tu ograniczeniem.':
    '<b>The browser has to support IndexedDB</b> — without it the emulator starts and runs, but closing the tab loses everything: drive <code>C:</code>, the cards and the ROM files you supplied. In practice <b>every</b> browser able to run this emulator at all supports it, because the emulator needs newer things — ES modules inside a Web Worker. The real floor is <b>Chrome / Edge 80+</b> (and their relatives: Opera, Brave, Vivaldi), <b>Safari 15+</b> (on iOS too) and <b>Firefox 114+</b>. IndexedDB itself has worked in all of them for years and is not the constraint here.',
  'Zapis potrafi jednak zniknąć niezależnie od obsługi — warto o tym wiedzieć, zanim spędzisz godzinę nad plikiem na dysku <code>C:</code>:':
    'Saved data can still disappear whatever the browser supports — worth knowing before you spend an hour on a file on drive <code>C:</code>:',
  '<b>Tryb prywatny / incognito</b> — dane kasują się przy zamknięciu okna, a bywa, że zapis nie działa wcale.':
    '<b>Private / incognito mode</b> — the data is cleared when the window closes, and sometimes writing does not work at all.',
  '<b>Blokada danych witryn</b> w ustawieniach przeglądarki lub w rozszerzeniu wyłącza IndexedDB razem z ciasteczkami.':
    '<b>Blocking site data</b>, in the browser settings or in an extension, disables IndexedDB along with cookies.',
  '<b>Czyszczenie historii i danych przeglądania</b> zabiera to razem z resztą.':
    '<b>Clearing history and browsing data</b> takes this with everything else.',
  '<b>Safari</b> kasuje dane witryn, na które nie zaglądasz przez 7 dni — to mechanizm ochrony prywatności (ITP), nie usterka.':
    '<b>Safari</b> deletes data for sites you have not visited in 7 days — that is its privacy mechanism (ITP), not a fault.',
  '<b>Brak miejsca na dysku</b> pozwala przeglądarce usunąć dane rzadziej używanych stron. Emulator prosi o oznaczenie swoich danych jako trwałe, co zwykle przed tym chroni, ale zgoda zależy od przeglądarki.':
    '<b>Running out of disk space</b> lets the browser evict data belonging to sites you use less. The emulator asks for its data to be marked persistent, which usually protects it, but granting that is the browser\'s decision.',
  'Jedyna pewna kopia zapasowa to plik na Twoim dysku: w oknie <b>Karta pamięci</b> jest przycisk <b>Pobierz obraz</b>, a pojedyncze pliki da się pobrać z listy zawartości karty. Przed dłuższą przerwą warto z tego skorzystać.':
    'The only certain backup is a file on your own disk: the <b>Memory card</b> window has a <b>Download image</b> button, and individual files can be downloaded from the card listing. Worth doing before a longer break.',

  // ---- manual: tone dialling ----------------------------------------------
  'Wybieranie numerów tonami (DTMF)': 'Tone dialling (DTMF)',
  'Address Book potrafi wybierać numer tonami — Portfolio przykładało się do mikrofonu słuchawki. Numer musi być <b>w pierwszej linii karty, za nazwą</b>:':
    'The Address Book can dial a number in tones — you held the Portfolio to the handset\'s microphone. The number has to be <b>on the first line of the card, after the name</b>:',
  'Zapis': 'Notation',
  'Znaczenie': 'Meaning',
  'rozdziela kilka numerów': 'separates several numbers',
  'kod kierunkowy, np. <code>(0483)</code>': 'an area code, e.g. <code>(0483)</code>',
  'komentarz, nie jest wybierany': 'a comment; not dialled',
  '<code>-</code> spacja <code>.</code>': '<code>-</code> space <code>.</code>',
  'pauza': 'a pause',
  'wariant końcówki: <code>301555/6</code>': 'an alternative ending: <code>301555/6</code>',
  'Przykład: <code>Kowalski 5551234</code>, potem Atari → <code>Dial…</code> → wybór numeru.':
    'For example <code>Smith 5551234</code>, then Atari → <code>Dial…</code> → pick the number.',

  // ---- manual: the serial port, step by step ------------------------------
  'Port szeregowy krok po kroku': 'The serial port, step by step',
  '<b>Port szeregowy</b> → zaznacz <b>Podłącz interfejs szeregowy</b> (odłączy to port równoległy — złącze przyjmuje jedno urządzenie).':
    '<b>Serial port</b> → tick <b>Fit the serial interface</b> (this unfits the parallel port — the socket takes one device).',
  '<b>Reset</b>.': '<b>Reset</b>.',
  'Wybierz drugi koniec kabla i kliknij <b>Podłącz</b>.':
    'Choose the other end of the cable and press <b>Connect</b>.',
  'W Portfolio linia to urządzenie <code>AUX</code>: <code>ECHO&nbsp;test&nbsp;&gt;&nbsp;AUX</code>, <code>DIR&nbsp;&gt;&nbsp;AUX</code>, <code>COPY&nbsp;AUX&nbsp;PLIK.TXT</code>.':
    'On the Portfolio the line is the <code>AUX</code> device: <code>ECHO&nbsp;test&nbsp;&gt;&nbsp;AUX</code>, <code>DIR&nbsp;&gt;&nbsp;AUX</code>, <code>COPY&nbsp;AUX&nbsp;FILE.TXT</code>.',
  'Prędkość ustawia ROM: po starcie 2400 8N1. Zmienia się ją w <kbd>`</kbd>+<kbd>S</kbd> → <b>RS-232 port</b>, i dopiero pozycja <b>Initialize!</b> przenosi ustawienie do układu — sprawdzone: wybór 4800 zmienia dzielnik dopiero po niej.':
    'The ROM sets the speed: 2400 8N1 after startup. You change it under <kbd>`</kbd>+<kbd>S</kbd> → <b>RS-232 port</b>, and only the <b>Initialize!</b> entry carries the setting into the chip — confirmed: choosing 4800 changes the divisor only after it.',
  'Terminala w ROM-ie <b>nie ma</b>, więc wirtualny modem przyda się dopiero z zewnętrznym programem terminalowym wgranym na kartę. <code>CTTY&nbsp;AUX</code> też nie zadziała — DIP-DOS 2.11 nie zna tego polecenia (odpowiada <code>Bad command or program not found</code>).':
    'There is <b>no terminal in the ROM</b>, so the virtual modem is of use only with an external terminal program loaded from a card. <code>CTTY&nbsp;AUX</code> will not do either — DIP-DOS 2.11 does not know the command (it answers <code>Bad command or program not found</code>).',

  // ---- manual: what is not here -------------------------------------------
  'Czego nie ma': 'What is not here',
  '<b>8087</b> — instrukcje ESC są dekodowane i pomijane; Portfolio i tak nie miało koprocesora.':
    '<b>8087</b> — ESC instructions are decoded and skipped; the Portfolio had no coprocessor anyway.',
  '<b>Portfolio 2</b> (<code>pofo2</code>, F82C425, 640×200).':
    '<b>Portfolio 2</b> (<code>pofo2</code>, F82C425, 640×200).',
  '<b>Drugie źródło wybudzenia.</b> Wracając po poleceniu <code>OFF</code>, ROM pyta ASIC, co go obudziło, i rozpoznaje dwa źródła. Modelujemy klawiaturę; czym jest to drugie — nie wiadomo, i nic w emulatorze go nie wystawia.':
    '<b>The second wake-up source.</b> Coming back from the <code>OFF</code> command, the ROM asks the ASIC what woke it and recognises two sources. The keyboard is modelled; what the other one is nobody has established, and nothing in the emulator ever raises it.',

  // ---- manual: sources and credits ----------------------------------------
  'Źródła i autorzy': 'Sources and credits',
  'Źródło': 'Source',
  'Co z niego pochodzi': 'What came from it',
  'Autorzy / licencja': 'Authors / licence',
  '<code>mame/src/mame/atari/pofo.cpp</code>': '<code>mame/src/mame/atari/pofo.cpp</code>',
  'mapa pamięci, mapa I/O, kontroler przerwań ASIC, selektor magistrali ROM_B, rejestr baterii, port wykrywania <code>0061h</code>':
    'the memory map, the I/O map, the ASIC interrupt controller, the ROM_B bus selector, the battery register, the <code>0061h</code> detection port',
  'Curt Coder —': 'Curt Coder —',
  'BSD-3-Clause': 'BSD-3-Clause',
  '<code>mame/src/devices/video/hd61830.cpp</code>': '<code>mame/src/devices/video/hd61830.cpp</code>',
  'model kontrolera LCD i algorytm rysowania trybu tekstowego oraz graficznego':
    'the LCD controller model and the drawing algorithm for text and graphics modes',
  '<code>mame/src/mame/atari/pofo_kbd.cpp</code>': '<code>mame/src/mame/atari/pofo_kbd.cpp</code>',
  'matryca klawiatury 8×8 i schemat kodów fizycznych (wiersz × 8 + kolumna, bit 7 = zwolnienie)':
    'the 8×8 keyboard matrix and the physical code scheme (row × 8 + column, bit 7 = release)',
  'Curt Coder, Jaen Saul —': 'Curt Coder, Jaen Saul —',
  '<code>mame/src/devices/sound/pcd3311.cpp</code>': '<code>mame/src/devices/sound/pcd3311.cpp</code>',
  'tablice tonów DTMF, modemowych i muzycznych oraz zachowanie linii STROBE':
    'the DTMF, modem and musical tone tables, and the behaviour of the STROBE line',
  '<code>mame/src/devices/bus/pofo/</code><br> <code>ccm.cpp</code>, <code>exp.cpp</code>, <code>hpc101.cpp</code>, <code>hpc102.cpp</code>, <code>hpc104.cpp</code>':
    '<code>mame/src/devices/bus/pofo/</code><br> <code>ccm.cpp</code>, <code>exp.cpp</code>, <code>hpc101.cpp</code>, <code>hpc102.cpp</code>, <code>hpc104.cpp</code>',
  'slot karty pamięci, protokół portu rozszerzeń (BCOM, PDET, ~NMD1, PID), interfejs równoległy 82C55A i szeregowy 82C50A wraz z rejestrem wektora przerwania, oraz rozszerzenie HPC-104: mapowanie 256&nbsp;KB RAM-u, bramka NCC1 pod <code>807Ch</code> i przelotka na kolejne urządzenie':
    'the memory card slot, the expansion port protocol (BCOM, PDET, ~NMD1, PID), the 82C55A parallel and 82C50A serial interfaces together with the interrupt vector register, and the HPC-104 expansion: mapping its 256&nbsp;KB of RAM, the NCC1 gate at <code>807Ch</code> and the pass-through to the next device',
  '<code>mame/src/devices/machine/ins8250.cpp</code>': '<code>mame/src/devices/machine/ins8250.cpp</code>',
  'układ rejestrów UART-u 8250, priorytety przerwań oraz semantyka IIR / LSR / MSR':
    'the 8250 UART register layout, the interrupt priorities and the semantics of IIR / LSR / MSR',
  'smf, Carl —': 'smf, Carl —',
  'Emulator jest napisany w JavaScripcie i stoi na cudzej pracy: model sprzętu odtworzono na podstawie MAME i dokumentacji, a rdzeń procesora przeniesiono z MartyPC. Należą się za nią podziękowania:':
    'The emulator is written in JavaScript and stands on other people\'s work: the hardware model was reconstructed from MAME and the documentation, and the CPU core was ported from MartyPC. Thanks are owed for it:',
  '<a href="https://github.com/dbalsom/martypc" target="_blank" rel="noopener">MartyPC</a><br> <code>crates/lib/marty_core/src/cpu_808x/</code>':
    '<a href="https://github.com/dbalsom/martypc" target="_blank" rel="noopener">MartyPC</a><br> <code>crates/lib/marty_core/src/cpu_808x/</code>',
  'rdzeń procesora 8088 liczony co do taktu, przeniesiony funkcja po funkcji (<code>js/emu/cpu8088.js</code>), oraz tablica dekodera rozkazów wygenerowana z jego <code>decode.rs</code>':
    'the clock-exact 8088 CPU core, ported function for function (<code>js/emu/cpu8088.js</code>), and the instruction decoder table generated from its <code>decode.rs</code>',
  'Daniel Balsom —': 'Daniel Balsom —',
  'MIT': 'MIT',
  '<a href="https://github.com/SingleStepTests/8088" target="_blank" rel="noopener">SingleStepTests 8088</a>':
    '<a href="https://github.com/SingleStepTests/8088" target="_blank" rel="noopener">SingleStepTests 8088</a>',
  'trzy miliony rozkazów nagranych na prawdziwym 8088, takt po takcie — wzorzec, wobec którego sprawdzono rdzeń procesora; same dane nie są częścią projektu':
    'three million instructions recorded on a real 8088, clock by clock — the reference the CPU core was checked against; the data itself is not part of the project',
  'projekt SingleStepTests — MIT': 'the SingleStepTests project — MIT',
  'Pełna treść licencji i noty o prawach autorskich →':
    'Full licence texts and copyright notices →',
  'Rdzeń procesora jest natomiast przeniesieniem kodu MartyPC, więc jego nota o prawach autorskich i licencja MIT jadą razem z nim — w nagłówku pliku rdzenia, w pliku LICENSE i w oknie licencji.':
    'The CPU core, on the other hand, is a port of MartyPC\'s code, so its copyright notice and MIT licence travel with it — in the header of the core\'s file, in the LICENSE file and in the licence window.',
  'Licencje i noty o prawach autorskich': 'Licences and copyright notices',
  'MAME — BSD-3-Clause': 'MAME — BSD-3-Clause',
  'MartyPC — MIT': 'MartyPC — MIT',
  'Rdzeń procesora (<code>js/emu/cpu8088.js</code>) i tablica dekodera rozkazów (<code>js/emu/cpu8088-decode.js</code>) to przeniesienie rdzenia 808x z emulatora MartyPC, zrobione funkcja po funkcji. Licencja MIT wymaga, żeby nota o prawach autorskich i treść licencji towarzyszyły każdej kopii — poniżej dosłownie.':
    'The CPU core (<code>js/emu/cpu8088.js</code>) and the instruction decoder table (<code>js/emu/cpu8088-decode.js</code>) are a port of the 808x core of the MartyPC emulator, made function for function. The MIT licence requires the copyright notice and the licence text to go with every copy — verbatim below.',
  '<em>Atari Portfolio Technical Reference Guide</em>, wyd.&nbsp;1, wrzesień&nbsp;1989':
    '<em>Atari Portfolio Technical Reference Guide</em>, 1st&nbsp;ed., September&nbsp;1989',
  'opis systemu, kart pamięci, portu rozszerzeń, przydział bajtów PID':
    'the system, memory cards and expansion port described, and the PID byte assignments',
  'Distributed Information Processing (DIP) Ltd. / Atari Corp.':
    'Distributed Information Processing (DIP) Ltd. / Atari Corp.',
  '<a href="https://github.com/codaris/PofoManager" target="_blank" rel="noopener">PofoManager</a><br> <code>Documentation/protocol.md</code>, <code>Arduino/Portfolio.ino</code>':
    '<a href="https://github.com/codaris/PofoManager" target="_blank" rel="noopener">PofoManager</a><br> <code>Documentation/protocol.md</code>, <code>Arduino/Portfolio.ino</code>',
  'opis protokołu transferu plików przez port równoległy — ramkowanie bloków, sumy kontrolne, kody komend i wymagane opóźnienia':
    'the parallel-port file transfer protocol — block framing, checksums, command codes and the delays it requires',
  'Apache-2.0. Protokół opisał pierwotnie Klaus Peichl (2006) na PofoWiki; implementacja tutaj jest własna':
    'Apache-2.0. The protocol was first described by Klaus Peichl (2006) on the PofoWiki; the implementation here is our own',
  '<a href="https://www.gust.org.pl/projects/e-foundry/tex-gyre/schola" target="_blank" rel="noopener">TeX Gyre Schola</a> (Italic)<br> <code>fonts/century-schoolbook-italic.*</code>':
    '<a href="https://www.gust.org.pl/projects/e-foundry/tex-gyre/schola" target="_blank" rel="noopener">TeX Gyre Schola</a> (Italic)<br> <code>fonts/century-schoolbook-italic.*</code>',
  'krój nagłówka, dobrany pod logo z obudowy — wolny klon Century Schoolbook (Morris Fuller Benton, 1919)':
    'the heading typeface, chosen to match the logo on the case — a free clone of Century Schoolbook (Morris Fuller Benton, 1919)',
  'GUST e-foundry. GUST Font Licence — prawnie tożsama z LaTeX Project Public License 1.3c, pełny tekst w <code>fonts/GUST-FONT-LICENSE.txt</code>':
    'GUST e-foundry. GUST Font Licence — legally identical to the LaTeX Project Public License 1.3c; full text in <code>fonts/GUST-FONT-LICENSE.txt</code>',
  'Projekt MAME:': 'The MAME project:',
  'mamedev.org': 'mamedev.org',
  '. Kod MAME jest tu': '. MAME\'s code is',
  'reimplementowany': 'reimplemented',
  ', a nie kopiowany — ale algorytmy, tablice stałych i układy rejestrów pochodzą z powyższych plików, więc licencja obowiązuje.':
    ' here rather than copied — but the algorithms, the constant tables and the register layouts come from the files above, so the licence applies.',
  'Format FAT12 kart nie pochodzi z żadnego źródła zewnętrznego: został zdjęty z obrazów, które wyprodukowało polecenie <code>FORMAT A:</code> z oryginalnego ROM-u, i odtworzony bajt w bajt.':
    'The cards\' FAT12 format comes from no outside source: it was taken off images produced by the original ROM\'s own <code>FORMAT A:</code> command, and reproduced byte for byte.',
  'Pliki ROM oraz DIP-DOS są własnością Atari Corp. i DIP Ltd. i nie wchodzą w skład tego projektu.':
    'The ROM files and DIP-DOS belong to Atari Corp. and DIP Ltd. and are not part of this project.',
  'Trzeba dostarczyć własny zrzut — emulator poprosi o niego przy pierwszym uruchomieniu i zapamięta go w pamięci przeglądarki; pliki nie są nigdzie wysyłane. Alternatywnie można je położyć w katalogu':
    'You have to supply your own dump — the emulator asks for one on first run and keeps it in the browser\'s storage; the files are not uploaded anywhere. Alternatively you can put them in the directory',
  'rom/': 'rom/',
  'na serwerze. Testowano wyłącznie z rewizją DIP-DOS 2.11 / ROM v1.072; inne rewizje emulator uruchomi, ale bez gwarancji działania — na własną odpowiedzialność.':
    'on the server. Only DIP-DOS 2.11 / ROM v1.072 has been tested; the emulator will run other revisions, but with no guarantee — at your own risk.',

  // ---- licence ------------------------------------------------------------
  'Model sprzętu w tym emulatorze odtworzono na podstawie plików źródłowych MAME oznaczonych <code>license:BSD-3-Clause</code>. Punkt 2 tej licencji wymaga, aby dystrybucja w postaci wykonywalnej reprodukowała notę o prawach autorskich, listę warunków i zrzeczenie się odpowiedzialności — a aplikacja WWW wysyłająca kod do przeglądarki jest właśnie taką dystrybucją. Poniżej pełna, dosłowna treść.':
    'The hardware model in this emulator was reconstructed from MAME source files marked <code>license:BSD-3-Clause</code>. Clause 2 of that licence requires distribution in binary form to reproduce the copyright notice, the list of conditions and the disclaimer — and a web application that ships code to a browser is exactly such a distribution. The full text follows, verbatim.',
  'Noty o prawach autorskich': 'Copyright notices',
  'Nagłówki tych plików podają posiadaczy praw bez podania lat. Projekt MAME jako całość podaje notę <code>Copyright (c) 1997-2026 MAMEDev and contributors</code>.':
    'The headers of those files name the copyright holders without giving years. The MAME project as a whole carries the notice <code>Copyright (c) 1997-2026 MAMEDev and contributors</code>.',
  'Warunki licencji i zrzeczenie się odpowiedzialności': 'Licence conditions and disclaimer',
  'Znak towarowy': 'Trademark',
  'MAME jest zastrzeżonym znakiem towarowym Gregory’ego Embera. Nazwa użyta jest tu wyłącznie w celu wskazania pochodzenia odtworzonej pracy. Ten projekt nie jest powiązany z projektem MAME ani przez niego firmowany.':
    'MAME is a registered trademark of Gregory Ember. The name is used here solely to identify where the reconstructed work came from. This project is neither affiliated with nor endorsed by the MAME project.',
  'Warunek 3 zakazuje używania nazwisk posiadaczy praw do promocji prac pochodnych — w tym projekcie nazwiska pojawiają się wyłącznie w tej licencji i w tabeli źródeł, jako wskazanie autorstwa.':
    'Clause 3 forbids using the holders\' names to promote derived work — in this project the names appear only in this licence and in the table of sources, as attribution.',
  'Inne licencje w tym projekcie': 'Other licences in this project',
  'Krój nagłówka (TeX Gyre Schola, GUST Font Licence) i dokumentacja protokołu transferu plików (PofoManager, Apache-2.0) mają własne, odrębne licencje — patrz tabela źródeł wyżej. Pełny tekst wszystkiego, łącznie z tą licencją, jest też w pliku <code>LICENSE</code> w katalogu głównym projektu.':
    'The heading typeface (TeX Gyre Schola, GUST Font Licence) and the file transfer protocol documentation (PofoManager, Apache-2.0) carry their own separate licences — see the table of sources above. The full text of all of them, this licence included, is also in the <code>LICENSE</code> file at the root of the project.',

  // ========================================================================
  // Strings the emulator produces while running. These never appear in the
  // HTML, so they are looked up through t() and carry {0}-style slots that are
  // filled after the lookup. The numbers may be reordered in English, but none
  // may be dropped or invented - the check refuses either.
  // ========================================================================

  // ---- page title ---------------------------------------------------------
  'Portfoliator — emulator Atari Portfolio': 'Portfoliator — an Atari Portfolio emulator',

  // ---- ROM images ---------------------------------------------------------
  'zgodny z testowaną rewizją — {0}': 'matches a tested revision — {0}',
  'nieznana rewizja — rozmiar i struktura się zgadzają, uruchomi się bez gwarancji — {0}':
    'unknown revision — the size and shape are right, it will run without any guarantee — {0}',
  'Nie rozpoznano: {0}. Sprawdź, czy to na pewno zrzut ROM-u Portfolio — decyduje zawartość, nie nazwa pliku.':
    'Not recognised: {0}. Check that this really is a Portfolio ROM dump — the contents decide, not the file name.',
  'Komplet plików. Można uruchomić.': 'A complete set. Ready to start.',
  'Przyjęto. Brakuje jeszcze pozostałych plików.': 'Accepted. The remaining files are still missing.',
  'Nie da się złożyć ROM-u systemowego: {0}': 'The system ROM cannot be assembled: {0}',
  'Pliki ROM przyjęte, ale nie udało się ich zapamiętać — przeglądarka nie udostępnia pamięci lokalnej (np. tryb prywatny). Emulator uruchomi się teraz normalnie, ale przy następnej wizycie trzeba będzie wskazać je ponownie.':
    'The ROM files were accepted but could not be stored — the browser offers no local storage (private mode, for instance). The emulator will run now as usual, but you will have to supply them again on your next visit.',
  'Wskaż pliki ROM, żeby uruchomić emulator.': 'Supply the ROM files to start the emulator.',
  'Wskazanie nowego pliku zastąpi ten, który jest teraz w użyciu.':
    'Supplying a new file replaces the one currently in use.',
  'Szukam plików w katalogu rom/…': 'Looking for files in the rom/ directory…',
  'W katalogu rom/ nie ma kompletu plików pod oczekiwanymi nazwami.':
    'The rom/ directory does not hold a complete set under the expected names.',
  'Usunięto. Wskaż pliki albo odśwież stronę.': 'Forgotten. Supply the files or reload the page.',
  'brak plików ROM': 'no ROM files',
  'Zapamiętane pliki ROM nie dają się złożyć — wskaż je ponownie.':
    'The stored ROM files will not assemble — supply them again.',
  'ładowanie ROM…': 'loading the ROM…',
  'błąd ROM: {0}': 'ROM error: {0}',
  'ROM aplikacji': 'Application ROM',
  'wbudowane aplikacje, bankowane w C0000h–DFFFFh':
    'the built-in applications, banked at C0000h–DFFFFh',
  'BIOS + DIP-DOS': 'BIOS + DIP-DOS',
  'system, na stałe w E0000h–FFFFFh': 'the system, fixed at E0000h–FFFFFh',
  'Generator znaków LCD': 'LCD character generator',
  'zewnętrzna tablica znaków ekranu': 'the external screen character table',
  'Generator znaków HD61830': 'HD61830 character generator',
  'tablica wewnętrzna sterownika LCD': 'the LCD controller\'s internal table',
  '{0} (część 1)': '{0} (part 1)',
  '{0} (część 2)': '{0} (part 2)',

  // ---- status bar ---------------------------------------------------------
  'uruchomiony': 'running',
  'wyłączony (soft power off)': 'switched off (soft power off)',
  'wyłączona': 'off',
  'błąd workera: {0}': 'worker error: {0}',
  'instancja #{0} — własny, osobny stan zapisu': 'instance #{0} — its own separate saved state',
  '— niedostępne w tej przeglądarce': ' — not available in this browser',

  // ---- memory cards -------------------------------------------------------
  'Karta {0} KB — {1} plik(ów), wolne {2} z {3} B':
    '{0} KB card — {1} file(s), {2} of {3} B free',
  'Karta {0} KB — nierozpoznany format ({1})': '{0} KB card — format not recognised ({1})',
  'usuń': 'delete',
  'Usunąć {0} z karty {1}?': 'Delete {0} from card {1}?',
  'Najpierw utwórz albo wgraj kartę w slocie {0}.':
    'Create or load a card in slot {0} first.',
  'Nie udało się dodać "{0}": {1}': 'Could not add "{0}": {1}',
  'Zastąpić kartę w slocie {0} nową, pustą?': 'Replace the card in slot {0} with a new, empty one?',
  'To nie wygląda na sformatowaną kartę (uszkodzony BPB).':
    'This does not look like a formatted card (damaged BPB).',
  'Nieobsługiwany rozmiar karty: {0} B. Dozwolone: 32, 64, 128, 256 KB.':
    'Unsupported card size: {0} B. Allowed: 32, 64, 128, 256 KB.',
  'Za mało miejsca na "{0}": potrzeba {1} klastrów, wolnych {2}.':
    'Not enough room for "{0}": {1} clusters needed, {2} free.',
  'Katalog główny jest pełny (limit {0} pozycji).':
    'The root directory is full (the limit is {0} entries).',

  // ---- parallel port and file transfer ------------------------------------
  'Wysyłanie {0} ({1} B), w kolejce jeszcze {2}…': 'Sending {0} ({1} B), {2} still queued…',
  'Wysyłanie {0} ({1} B)…': 'Sending {0} ({1} B)…',
  'Najpierw podłącz interfejs równoległy i zrób Reset.':
    'Fit the parallel interface and do a Reset first.',
  'Nie udało się wysłać {0}: {1}': 'Could not send {0}: {1}',
  'Wysłano {0}.': 'Sent {0}.',
  'Błąd: {0}': 'Error: {0}',
  'Odczytano {0} plik(ów).': 'Read {0} file(s).',
  'Brak pasujących plików.': 'No matching files.',
  'Interfejs równoległy nie jest podłączony.': 'The parallel interface is not fitted.',
  'Trwa już inna operacja.': 'Another operation is already running.',
  'Brak odpowiedzi. Czy Portfolio jest w Setup → File transfer → Server?':
    'No answer. Is the Portfolio in Setup → File transfer → Server?',
  'nie udało się zsynchronizować z Portfolio': 'could not synchronise with the Portfolio',
  'Portfolio nie zgłosiło gotowości': 'the Portfolio never reported ready',
  'plik już istnieje, nadpisanie odrzucone': 'the file already exists; overwriting was refused',
  'zapis nie powiódł się (brak miejsca lub katalogu)':
    'the write failed (no room, or no such directory)',

  // ---- serial port --------------------------------------------------------
  'Zakończ zapis i pobierz': 'Close the capture and download',
  '· zostało ok. {0} min': ' · about {0} min left',
  '· zostało ok. {0} s': ' · about {0} s left',
  'Wysłane w całości. Jeśli po drugiej stronie czeka COPY AUX, zamknij plik przyciskiem „Znak końca pliku (Ctrl+Z)” — bez tego Portfolio będzie czekało na dalsze dane i zgłosi Not ready error.':
    'Sent in full. If a COPY AUX is waiting at the other end, close the file with the "End-of-file character (Ctrl+Z)" button — without it the Portfolio waits for more data and reports Not ready error.',
  'Połączenie zostało zerwane w trakcie. Plik po drugiej stronie jest ucięty.':
    'The connection dropped part-way through. The file at the other end is cut short.',
  'Przerwane. Plik po drugiej stronie jest ucięty w tym miejscu.':
    'Aborted. The file at the other end is cut off at this point.',
  '{0} → na linię ({1} B).': '{0} → onto the line ({1} B).',
  '{0} → do emulowanego Portfolio ({1} B).': '{0} → to the emulated Portfolio ({1} B).',
  'Port sprzętowy otwarty na {0} baud, a Portfolio nadaje {1}. Rozłącz i podłącz ponownie, żeby zrównać prędkości.':
    'The hardware port is open at {0} baud while the Portfolio transmits at {1}. Disconnect and connect again to match them.',
  'Nie wybrano portu.': 'No port was chosen.',
  'Nie udało się podłączyć: {0}': 'Could not connect: {0}',
  'Nic nie przyszło na linię.': 'Nothing arrived on the line.',
  'Znak końca pliku': 'End-of-file character',
  'Limit ciszy na linii: domyślny z BIOS-u (ok. 4 s).':
    'Silence timeout on the line: the BIOS default (about 4 s).',
  'Interfejs podłączony. Zrób Reset, żeby BIOS go wykrył.':
    'Interface fitted. Do a Reset so the BIOS detects it.',
  'Interfejs odłączony.': 'Interface removed.',
  'Terminal podłączony. Pisz w polu poniżej — znaki idą do Portfolio.':
    'Terminal connected. Type in the field below — the characters go to the Portfolio.',
  'Ta przeglądarka nie ma Web Serial API (potrzebny Chrome lub Edge, przez HTTPS albo localhost).':
    'This browser has no Web Serial API (Chrome or Edge is needed, over HTTPS or localhost).',
  'Port sprzętowy otwarty{0}, {1} baud.': 'Hardware port open{0}, {1} baud.',
  'Port sprzętowy: {0}': 'Hardware port: {0}',
  'Modem: powrót do trybu komend (połączenie trzymane).':
    'Modem: back in command mode (the connection is held).',
  'Modem: połączony.': 'Modem: connected.',
  'nie udało się zestawić połączenia.': 'the connection could not be established.',
  'rozłączony.': 'disconnected.',
  'Kabel null-modem: {0} drugi koniec podłączony (ta karta: {1}).':
    'Null-modem cable: {0} far end connected (this tab: {1}).',
  'Kabel null-modem: czekam na drugą kartę na kanale (ta karta: {0}).':
    'Null-modem cable: waiting for another tab on the channel (this tab: {0}).',
  'Najpierw podłącz drugi koniec kabla.': 'Connect the other end of the cable first.',
  'Poprzednia wysyłka jeszcze trwa.': 'The previous transfer is still running.',

  // ---- sound --------------------------------------------------------------
  'Dźwięk włączony — surowa fala prostokątna, tak jak syntezuje ją MAME.':
    'Sound on — the raw square wave, as MAME synthesises it.',
  'Dźwięk włączony — dwa tony przez filtr głośnika Portfolio, w paśmie telefonicznym.':
    'Sound on — two tones through the Portfolio\'s speaker filter, in the telephone band.',
  'Dźwięk wyciszony.': 'Sound muted.',
  'Ta przeglądarka nie udostępnia Web Audio.': 'This browser offers no Web Audio.',

  // ---- resets -------------------------------------------------------------

  // ---- PERMDATA.DAT -------------------------------------------------------
  'Odczytywanie…': 'Reading…',
  'Odczytano z dysku C: emulowanej maszyny.': 'Read from the emulated machine\'s drive C:.',
  'Brak zrzutu pamięci — poczekaj chwilę i spróbuj ponownie.':
    'No memory snapshot yet — wait a moment and try again.',
  'Nie znaleziono dysku C: w pamięci maszyny.':
    'No drive C: was found in the machine\'s memory.',
  'Portfolio nie zapisało jeszcze tego pliku. Powstaje przy wyjściu z wbudowanych aplikacji — wejdź w dowolną z nich i wróć klawiszem Esc.':
    'The Portfolio has not written this file yet. It appears when you leave the built-in applications — go into any of them and come back with Esc.',
  'Plik ma {0} B zamiast {1} — nie rozpoznaję tego układu.':
    'The file is {0} B instead of {1} — this layout is not one I know.',
  'nieznane ({0})': 'unknown ({0})',
  'tak': 'yes',
  'nie': 'no',
  'brak': 'none',
  'nieparzysta': 'odd',
  'parzysta': 'even',
  'port równoległy': 'parallel port',
  'port szeregowy': 'serial port',
  'plik': 'file',
  'ogólny': 'general',
  'stały': 'fixed',
  'naukowy': 'scientific',
  'inżynierski': 'engineering',

  // ---- PERMDATA.DAT, the row labels ---------------------------------------
  'Prędkość': 'Speed',
  'Parzystość': 'Parity',
  'Bity danych': 'Data bits',
  'Bity stopu': 'Stop bits',
  'Drukarka': 'Printer',
  'Cel wydruku': 'Print destination',
  'Plik docelowy': 'Destination file',
  'Linii na stronę': 'Lines per page',
  'Koniec linii': 'End of line',
  'Margines górny': 'Top margin',
  'Margines dolny': 'Bottom margin',
  'Wcięcie od lewej': 'Left indent',
  'Długość kodów sterujących': 'Length of the setup codes',
  'Edytor': 'Editor',
  'Ostatni plik': 'Last file',
  'Linia kursora': 'Cursor line',
  'Kolumna kursora': 'Cursor column',
  'Górna linia ekranu': 'Top line on screen',
  'Prawy margines': 'Right margin',
  'Zawijanie słów': 'Word wrap',
  'Ramka przy wejściu': 'Frame on entry',
  'Arkusz': 'Worksheet',
  'Wczytuj ostatni': 'Load the last one',
  'Symbol waluty': 'Currency symbol',
  'Separator dziesiętny': 'Decimal separator',
  'Szerokość papieru': 'Paper width',
  'Terminarz': 'Diary',
  'Prefiks wybierania': 'Dial prefix',
  'Kalkulator': 'Calculator',
  'Format liczb': 'Number format',
  'Miejsca po przecinku': 'Decimal places',
  'Separatory tysięcy': 'Thousands separators',
  'Przecinek dziesiętny': 'Decimal comma',
  'Schowek włączony': 'Clipboard enabled',
  'Schowek zapisywany': 'Clipboard saved',
  'Bufor undelete włączony': 'Undelete buffer enabled',
  'Bufor zapisywany': 'Buffer saved',

  // ---- found by the sweep, not by looking for Polish diacritics -----------
  // "Brak karty." and "Przerwij" have no accented letter in them, which is
  // exactly why a search for those missed them the first time round.
  'brak pliku': 'no file',
  'pobierz': 'download',
  'Pliki na Portfolio ({0})': 'Files on the Portfolio ({0})',
  'Bufor wydruku jest pusty.': 'The print buffer is empty.',
  'Limit ciszy na linii: ok. {0} s.': 'Silence timeout on the line: about {0} s.',
  'Zapis: {0}': 'Write: {0}',
  'Wirtualny modem gotowy. W Portfolio uruchom terminal i wpisz np. ATDT host:port.':
    'The virtual modem is ready. Start a terminal on the Portfolio and type something like ATDT host:port.',
  'Modem dzwoni: {0}': 'Modem dialling: {0}',
  'Modem: {0}': 'Modem: {0}',
  'suma kontrolna: oczekiwano 0x{0}, dostano 0x{1}': 'checksum: expected 0x{0}, got 0x{1}',
  'oczekiwano 0xA5, dostano 0x{0}': 'expected 0xA5, got 0x{0}',

  // --- inspektor ---
  'Inspektor':
    'Inspector',
  'Podgląd maszyny w czasie jej pracy: rejestry procesora, kod pod <code>CS:IP</code>, dowolne okno pamięci i <b>dziennik dostępów do portów</b>. Ten ostatni pokazuje przy każdym wpisie, ile <b>cykli</b> minęło od poprzedniego — a to jest liczba, która rozstrzyga większość pytań o czasy układu LCD. Okno odświeża się cztery razy na sekundę; maszyna chodzi dalej — chyba że ją zatrzymasz, bo maszynę da się tu również <b>zatrzymać, przejść krokiem</b> i złapać w <b>pułapkę na adres albo na port</b>.':
    'A look inside the machine while it runs: the CPU registers, the code at <code>CS:IP</code>, any window of memory, and a <b>log of port accesses</b>. That last one shows, on every entry, how many <b>cycles</b> passed since the one before it — and that number settles most questions about the LCD controller’s timing. The window refreshes four times a second and the machine keeps running — unless you stop it, because here it can also be <b>stopped and single-stepped</b>, and caught by an <b>address or port trap</b>.',
  'Bieg maszyny':
    'Running and stopping',
  'Zatrzymaj':
    'Stop',
  'Wznów':
    'Resume',
  'Krok':
    'Step',
  'Pułapki na adres':
    'Breakpoints',
  'Pułapka na port':
    'Port trap',
  'zapis':
    'writes',
  'odczyt':
    'reads',
  'zapis i odczyt':
    'writes and reads',
  'Maszyna chodzi.':
    'The machine is running.',
  '<b>Pułapka na adres</b> zatrzymuje maszynę <b>przed</b> wykonaniem instrukcji spod tego adresu — rejestry pokazują więc to, co ta instrukcja dopiero zobaczy. Adresów może być kilka, po przecinku albo po spacji; sam offset oznacza segment <code>E000</code>, czyli ROM. <b>Pułapka na port</b> zatrzymuje maszynę dopiero po instrukcji, która dotknęła portu — zatrzymywanie się w jej połowie wymagałoby cofania procesora i nic tu nie jest tego warte — więc w oknie kodu stoi już <b>następna</b> instrukcja, a powód zatrzymania mówi, o który port i o jaki bajt chodziło. <b>Krok</b> wykonuje jedną instrukcję i odświeża wszystkie panele razem z ekranem; maszyna zatrzymuje się przy tym sama, jeśli akurat chodziła. Zamknięcie okna <b>zdejmuje pułapki i puszcza maszynę w bieg</b> — inaczej dałoby się ją zostawić zatrzymaną bez niczego, czym można by ją ruszyć.':
    '<b>An address breakpoint</b> stops the machine <b>before</b> the instruction at that address runs, so the registers show what that instruction is about to see. Several addresses may be given, separated by commas or spaces; a bare offset means segment <code>E000</code>, the ROM. <b>A port trap</b> stops the machine only once the instruction that touched the port has finished — stopping halfway through one would mean unwinding the CPU, and nothing here is worth that — so the code pane already shows the <b>next</b> instruction, while the reason line says which port and which byte it was. <b>Step</b> runs one instruction and refreshes every pane along with the screen; it stops the machine first if it happened to be running. Closing the window <b>clears the traps and lets the machine go</b> — otherwise it could be left stopped with nothing on screen to start it again.',
  'Procesor':
    'CPU',
  'Kod':
    'Code',
  'Idź za CS:IP':
    'Follow CS:IP',
  'Adres':
    'Address',
  'Pamięć':
    'Memory',
  'Dziennik portów':
    'Port log',
  'Śledź dostępy do portów':
    'Log port accesses',
  'Od':
    'From',
  'Do':
    'To',
  'postój po HLT':
    'halted after HLT',
  'cykli od resetu':
    'cycles since reset',
  'Śledzenie wyłączone.':
    'Logging is off.',
  'Brak dostępów w tym zakresie.':
    'No accesses in that range.',
  '… pominięto {0} wpisów':
    '… {0} entries dropped',
  'port / kierunek / bajt / cykli od poprzedniego':
    'port / direction / byte / cycles since previous',
  'zatrzymany w inspektorze':
    'stopped in the inspector',
  'Maszyna zatrzymana.':
    'The machine is stopped.',
  'Zatrzymana na pułapce {0}':
    'Stopped at breakpoint {0}',
  'Zatrzymana po odczycie portu {0}, bajt {1}':
    'Stopped after a read of port {0}, byte {1}',
  'Zatrzymana po zapisie do portu {0}, bajt {1}':
    'Stopped after a write to port {0}, byte {1}',
  'Krok: {0} wykonane w {1} cyklach':
    'Step: {0} ran in {1} cycles',
  'Maszyna jest wyłączona — nie ma czego krokować.':
    'The machine is switched off — there is nothing to step.',
  'pułapek na adres: {0}':
    'breakpoints: {0}',
  'pułapka na port włączona':
    'port trap on',
  'nieczytelne: {0}':
    'not understood: {0}',

  // --- stan maszyny ---
  'Stan maszyny':
    'Machine state',
  'Zrzut stanu zamraża <b>całą maszynę</b> w tej chwili, w której jest: procesor w połowie programu, zawartość ekranu, pamięć, karta, licznik czasu, kolejka klawiatury. Wczytanie stawia ją z powrotem dokładnie tam — bez rozruchu, bez czekania, z tym samym obrazem na wyświetlaczu. To nie to samo, co pamięć podtrzymywana bateryjnie, która zapisuje się sama: tamta przechowuje <b>dysk C:</b> i przeżywa wyłączenie, ale po włączeniu Portfolio startuje od nowa.':
    'A snapshot freezes the <b>whole machine</b> exactly where it stands: the CPU midway through a program, what is on the screen, memory, the card, the clock, the keyboard queue. Loading one puts it straight back there — no boot, no waiting, the same picture on the display. This is not the same thing as the battery-backed memory that saves itself: that one holds <b>drive C:</b> and survives being switched off, but the Portfolio still starts from scratch when it comes back on.',
  'Przydaje się wszędzie tam, gdzie liczy się powrót do tego samego miejsca: przed czymś, co może się nie udać, w połowie długiego arkusza, albo żeby odłożyć pracę na jutro. <em>Uwaga: stan zapisany z wpiętym rozszerzeniem pamięci albo z inną płytą w porcie wraca razem z nią — wczytanie przestawia sprzęt tak, jak był w chwili zapisu.</em>':
    'It earns its keep anywhere getting back to the same place matters: before something that might go wrong, halfway through a long spreadsheet, or to put the work down until tomorrow. <em>Note: a state saved with the memory expansion fitted, or with a different board in the port, comes back with it — loading rearranges the hardware to match the moment it was saved.</em>',
  'Gniazdo 1':
    'Slot 1',
  'Gniazdo 2':
    'Slot 2',
  'Gniazdo 3':
    'Slot 3',
  'puste':
    'empty',
  'Zapisz':
    'Save',
  'Wczytaj':
    'Load',
  'Usuń':
    'Delete',
  'Plik':
    'File',
  'Gniazda żyją w pamięci przeglądarki i znikają razem z jej danymi. Plik przenosi stan na inny komputer i nadaje się na kopię zapasową.':
    'The slots live in the browser’s storage and go when its data goes. A file carries the state to another computer and makes a proper backup.',
  'Zapisz do pliku':
    'Save to a file',
  'Wczytaj z pliku…':
    'Load from a file…',
  'To gniazdo jest puste.':
    'That slot is empty.',
  'Wczytywanie…':
    'Loading…',
  'Zapisywanie…':
    'Saving…',
  'Gniazdo opróżnione.':
    'Slot emptied.',
  'Przygotowywanie pliku…':
    'Preparing the file…',
  'Maszyna nie jest jeszcze uruchomiona.':
    'The machine is not running yet.',
  'Stan zapisany do pliku.':
    'State saved to a file.',
  'Stan zapisany w gnieździe {0}.':
    'State saved in slot {0}.',
  'Nie udało się zapisać w gnieździe {0}: {1}':
    'Could not save in slot {0}: {1}',
  'Stan wczytany.':
    'State loaded.',
  'Zrzuty stanu maszyny — trzy gniazda w oknie <b>Stan maszyny</b>':
    'Machine state snapshots — three slots in the <b>Machine state</b> window',
  'tylko wtedy, gdy sam je zapiszesz':
    'only when you save one yourself',
  'Ostatnia pozycja jest innego rodzaju niż reszta i warto to rozróżnić. Pamięć NVRAM odpowiada temu, co w prawdziwym Portfolio trzymały baterie: dysk <code>C:</code> przeżywa wyłączenie, ale maszyna po włączeniu startuje od nowa. <b>Zrzut stanu</b> zamraża natomiast całą maszynę w połowie pracy — procesor, ekran, pamięć, licznik czasu — i wczytanie stawia ją z powrotem dokładnie tam, bez rozruchu. Zrzut da się też zapisać do pliku i przenieść na inny komputer.':
    'That last row is a different kind of thing from the rest, and the difference is worth drawing. The NVRAM matches what the batteries held in a real Portfolio: drive <code>C:</code> survives being switched off, but the machine starts from scratch when it comes back on. A <b>state snapshot</b>, by contrast, freezes the whole machine mid-work — the CPU, the screen, memory, the clock — and loading one puts it straight back there, with no boot. A snapshot can also be saved to a file and carried to another computer.',
  // EPROM card page (eprom.html, js/eprom/).
  'Portfoliator — obraz karty EPROM': 'Portfoliator — EPROM card image',
  'Karta EPROM': 'EPROM card',
  'Obraz do wypalenia w&nbsp;EPROM-ie karty Atari Portfolio · <a href="index.html">emulator</a>':
    'An image to burn into the EPROM of an Atari Portfolio card · <a href="index.html">emulator</a>',
  'Karta pokazuje Portfolio zawsze 128&nbsp;KB naraz, więc większy EPROM dzielony jest na <b>banki</b> po 128&nbsp;KB — każdy to osobny dysk z&nbsp;własnymi plikami, a który z&nbsp;nich widać, wybiera karta. Narzędzie składa banki w&nbsp;jeden plik <code>.epr</code> gotowy dla programatora, w&nbsp;tym samym układzie, w&nbsp;jakim robił to program <i>DISK zu EPROM Konverter</i> z&nbsp;Atari ST. Pliki nie opuszczają przeglądarki.':
    'The card always shows the Portfolio 128&nbsp;KB at a time, so a larger EPROM is divided into <b>banks</b> of 128&nbsp;KB — each one a separate drive with files of its own, and the card chooses which one is seen. This tool puts the banks together into one <code>.epr</code> file ready for the programmer, in the same layout the Atari ST program <i>DISK zu EPROM Konverter</i> used. Your files never leave the browser.',
  'Układ EPROM': 'EPROM chip',
  '27C010 — 128 KB, 1 bank': '27C010 — 128 KB, 1 bank',
  '27C020 — 256 KB, 2 banki': '27C020 — 256 KB, 2 banks',
  '27C040 — 512 KB, 4 banki': '27C040 — 512 KB, 4 banks',
  '27C080 — 1 MB, 8 banków': '27C080 — 1 MB, 8 banks',
  'Wczytaj obraz .epr…': 'Open an .epr image…',
  'Pobierz obraz EPROM': 'Download EPROM image',
  'Etykieta': 'Label',
  'Upuść tu pliki albo katalogi': 'Drop files or folders here',
  'Wczytaj katalog jako bank…': 'Load a folder as the bank…',
  'Bank jest pusty — wypali się jako pusty dysk.':
    'This bank is empty — it will be burned as an empty drive.',
  'Pobierz bank (.epr)': 'Download bank (.epr)',
  'Jak to działa': 'How it works',
  '<b>Wczytaj katalog jako bank</b> robi to, co dawniej przygotowanie dyskietki na ST: zawartość katalogu trafia do korzenia banku, a&nbsp;jego nazwa zostaje etykietą. Katalogi upuszczone na pole stają się podkatalogami, pliki lądują w&nbsp;korzeniu. Długie nazwy skracane są do formatu 8.3 — skrócona nazwa stoi w&nbsp;tabeli obok oryginału. Pozycje leżą alfabetycznie i&nbsp;w&nbsp;tej kolejności pokaże je <code>DIR</code>.':
    '<b>Load a folder as the bank</b> does what preparing a floppy on the ST used to: the folder\'s contents go to the root of the bank, and its name becomes the label. Folders dropped on the box become subdirectories, files land in the root. Long names are cut down to 8.3 — the short name stands in the table next to the original. Entries are kept in alphabetical order, and <code>DIR</code> will list them in that order.',
  'Każdy bank to system plików FAT12 z&nbsp;klastrami po 1&nbsp;KB, więc mieści 126&nbsp;KB, a&nbsp;każdy plik zajmuje pełne kilobajty. Katalog główny rośnie z&nbsp;zawartością: 15 pozycji, potem 47, 79 i&nbsp;111, za cenę 1&nbsp;KB miejsca na każdy krok. Bank sprawdzisz przed wypaleniem: <b>Pobierz bank</b> daje plik 128&nbsp;KB, który emulator przyjmie w&nbsp;oknie <b>Karta pamięci</b> jako zwykłą kartę.':
    'Each bank is a FAT12 file system with 1&nbsp;KB clusters, so it holds 126&nbsp;KB and every file takes whole kilobytes. The root directory grows with what it holds: 15 entries, then 47, 79 and&nbsp;111, at a cost of 1&nbsp;KB of space per step. You can check a bank before burning it: <b>Download bank</b> gives a 128&nbsp;KB file that the emulator accepts in the <b>Memory card</b> window as an ordinary card.',
  '<katalog>': '<dir>',
  'Usuń katalog z zawartością': 'Remove the folder and everything in it',
  'Usuń plik': 'Remove the file',
  'Bank {0}': 'Bank {0}',
  'Zajęte {0} z {1} KB · katalog główny: {2} z {3} pozycji':
    '{0} of {1} KB used · root directory: {2} of {3} entries',
  'nie zmieści się, usuń coś z tego banku.': 'it will not fit, remove something from this bank.',
  'za dużo pozycji w katalogu głównym, przenieś część do podkatalogu.':
    'too many entries in the root directory, move some into a subdirectory.',
  'Bank {0} nie jest pusty. Zastąpić jego zawartość katalogiem {1}?':
    'Bank {0} is not empty. Replace its contents with the folder {1}?',
  'Usunąć wszystkie pliki z banku {0}?': 'Remove all files from bank {0}?',
  'Bank {0} pobrany — 128 KB.': 'Bank {0} downloaded — 128 KB.',
  'Bank {0}: {1}': 'Bank {0}: {1}',
  'Bank {0}: dodano plików: {1}.': 'Bank {0}: files added: {1}.',
  'Mniejszy układ nie pomieści banków {0}–{1}. Usunąć ich zawartość?':
    'A smaller chip cannot hold banks {0}–{1}. Discard their contents?',
  'Obraz {0} pobrany. Puste banki ({1}) wypalą się jako puste dyski.':
    '{0} image downloaded. Empty banks ({1}) will be burned as empty drives.',
  'Obraz {0} pobrany.': '{0} image downloaded.',
  'Plik ma {0} KB, a żaden obsługiwany układ nie ma takiej pojemności.':
    'The file is {0} KB, and none of the supported chips has that capacity.',
  'Wczytano {0}: {1} — banków bez systemu plików: {2}, zostały puste.':
    'Opened {0}: {1} — banks with no file system: {2}, left empty.',
  'Wczytano {0}: {1}.': 'Opened {0}: {1}.',
  'Anuluj': 'Cancel',
  'Zastąpić bank?': 'Replace the bank?',
  'Zastąp': 'Replace',
  'Wyczyścić bank?': 'Clear the bank?',
  'Zmienić układ?': 'Change the chip?',
  'Zmień układ': 'Change chip',
  'Wczytać obraz?': 'Open the image?',
  'Wczytanie obrazu {0} zastąpi wszystkie banki.': 'Opening {0} will replace all banks.',
  'Za dużo podobnych nazw w jednym katalogu: {0}': 'Too many similar names in one folder: {0}',
  'Za dużo pozycji w katalogu głównym: {0}, mieści się {1}.':
    'Too many entries in the root directory: {0}, it holds {1}.',
  'Pliki zajmują {0} KB, a bank mieści {1} KB.': 'The files take {0} KB, and a bank holds {1} KB.',
  'Ten bank nie zawiera systemu plików FAT12.': 'This bank holds no FAT12 file system.',
  'Plik {0} jest w obrazie urwany.': 'The file {0} is cut short in the image.',
  'Plik ma {0} B, a obraz EPROM to wielokrotność 128 KB.':
    'The file is {0} bytes, and an EPROM image is a multiple of 128 KB.',
  'Obraz dla karty z&nbsp;EPROM-em, z&nbsp;kilkoma bankami po 128&nbsp;KB, przygotujesz na stronie <a href="eprom.html">Karta EPROM</a>; każdy bank wgrasz tu jak zwykłą kartę.':
    'An image for an EPROM card, with several banks of 128&nbsp;KB, is prepared on the <a href="eprom.html">EPROM card</a> page; each bank loads here like an ordinary card.',
  // ---- questions and notices in the page's own dialog, table headers ------
  'Rozmiar': 'Size',
  'Stan': 'Status',
  'Data': 'Date',
  'Pliki ROM niezapamiętane': 'ROM files not stored',
  'Wczytano z katalogu rom/.': 'Loaded from the rom/ directory.',
  'Usunąć zapamiętane pliki ROM?': 'Forget the stored ROM files?',
  'Przy następnym uruchomieniu trzeba będzie wskazać je ponownie.':
    'You will have to supply them again next time.',
  'Tego nie da się cofnąć.': 'This cannot be undone.',
  'Brak karty': 'No card',
  'Brak karty w slocie {0}.': 'No card in slot {0}.',
  'Nie dodano pliku': 'File not added',
  'Pliki z obecnej karty przepadną, chyba że najpierw ją pobierzesz.':
    'The files on the current card will be lost unless you download it first.',
  '· w kolejce {0} B': ' · {0} B queued',
  'nieskonfigurowana': 'not configured',
  'Tekst': 'Text',
  'Plik {0}': 'File {0}',
  'Odczytywanie listy: {0}…': 'Reading the list: {0}…',
  'Zapis z linii': 'Line capture',
  'Wydruk': 'Printout',
  'Zimny start?': 'Cold start?',
  'Zimny start kasuje całą pamięć NVRAM (wszystkie pliki na C:).':
    'A cold start wipes all of NVRAM (every file on C:).',
  'Zimny start przeliczy pamięć, ale skasuje zawartość dysku C:. Karty w slotach A: i B: zostaną nienaruszone.':
    'A cold start recounts the memory but wipes drive C:. Cards in slots A: and B: are left untouched.',
  'Maszyna nie jest uruchomiona.': 'The machine is not running.',
  'Plik nie zawiera stanu maszyny.': 'The file holds no machine state.',
  'To nie jest plik ze stanem maszyny.': 'This is not a machine state file.',
  'Stan w formacie {0}, a ten emulator czyta {1}.':
    'The state is in format {0}, and this emulator reads {1}.',
  'Wczytać stan?': 'Load the state?',
  'Zapisany stan ma własną kartę pamięci, więc karta w slocie {0} zostanie zastąpiona tą z zapisu. Jeśli chcesz zachować obecną, najpierw ją pobierz.':
    'The saved state carries its own memory card, so the card in slot {0} will be replaced by the one from the save. To keep the current one, download it first.',
  'Usunąć zapis z gniazda {0}?': 'Delete the save in slot {0}?',
  'Stan zapisany {0} zniknie z pamięci przeglądarki. Tego nie da się cofnąć.':
    'The state saved {0} will be gone from the browser’s storage. This cannot be undone.',
  'brak wektora reset (JMP FAR) pod FFFF0h — pliki systemowe zamienione miejscami?':
    'no reset vector (JMP FAR) at FFFF0h — are the system files swapped?',
};
