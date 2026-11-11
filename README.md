# Portfoliator

A browser-only emulator for the Atari Portfolio (Atari PC Folio, 1989). Plain
JavaScript, ES modules, **no build step** — copy the files to any web server and
open the page.

**Try it online: [portfoliator.atari.org.pl](https://portfoliator.atari.org.pl).**
All you need is your own ROM dump (see [Required ROM files](#required-rom-files)).

*(Polska wersja: [README-PL.MD](README-PL.MD).)*

Status: **boots the original ROM to the DIP-DOS 2.11 v1.072 prompt**, and supports
the keyboard, screen, memory cards, and printing to a file. Recent changes are in
[CHANGELOG.md](CHANGELOG.md).

## Running it

Portfoliator is a static site: no build step, no server-side code. Copy the whole
directory to any web server you control and open it in a browser.

The emulator **must** be served over HTTP(S) — ES modules and the Web Worker don't
work from `file://`. Any server that can serve static files works: Apache, nginx,
Caddy, `python -m http.server`, whatever you already run.

### Required ROM files

These are not part of this project — the ROM and DIP-DOS belong to Atari Corp.
and DIP Ltd. You have to supply your own dump, either way:

- **through the browser** — on first run the emulator asks you to pick the files
  (dropping them on the dialog works too) and remembers them in local storage,
  in IndexedDB. The files are read on your own machine; nothing is uploaded
  anywhere. The next visit boots straight away;
- **through the `rom/` directory** — handier for local work and private
  deployments; the emulator picks them up and remembers them just the same.

| File | Size | Role |
|---|---|---|
| `c101782-007.u4` | 131,072 B | application ROM → `C0000h–DFFFFh` (banked) |
| `c101781-007.u3` | 131,072 B | BIOS + DIP-DOS → `E0000h–FFFFFh` (fixed) |
| `c101783-001a-01.u3` | 32,768 B | external LCD character generator |
| `hd61830.bin` | 1,472 B | internal HD61830 character generator |

Filenames only matter for the `rom/` directory. Files picked through the browser
are identified by content, so the misleading `u3`/`u4` order cannot bite — the
reset vector (`EAh` = `JMP FAR`) at `FFFF0h` is what marks the BIOS half.
A combined dump of both system ROMs (262,144 B) is also accepted and split
automatically.

Stored images can be reviewed, replaced and deleted under **System → ROM files…**.

#### Tested revisions

The emulator has been tested **only** against these dumps (DIP-DOS 2.11,
ROM v1.072):

| File | CRC32 | SHA-256 |
|---|---|---|
| `c101782-007.u4` | `C9852766` | `82ceb9b0a3541191525d87c04c2fe832905fad71bffd162f960b59c0dfb649e6` |
| `c101781-007.u3` | `B8FB730D` | `3fd92628ca0f8960149b20700f486c4109eb4a9c0ae7d5a857eb13e9f440c223` |
| `c101783-001a-01.u3` | `61FDAFF1` | `60a971516b85b160fb343141b12811af4e627423b8e4e1dc33ef16f19e542cd9` |
| `hd61830.bin` | `06A934DA` | `8738511c6a2f02b0ef1be2cde90898458b4517151cb473ff28ae212dbd1c1737` |

Other ROM revisions are **not blocked** — if the size and structure check out,
the emulator will run them and mark them as unknown. There is no guarantee they
work: **use them at your own risk.** Bug reports from untested revisions are
welcome with the SHA-256 in the description — without it there is no telling an
emulator bug from a different ROM revision.

## First boot

1. DIP copyright screen → any key.
2. Keyboard layout choice → `E` (English/QWERTY).
3. `New date (mm-dd-yy):` → a date, or Enter.
4. `New time:` → a time, or Enter.
5. The `c>` prompt.

## Where the state lives

A real Portfolio kept everything in battery-backed RAM. Here that job belongs to
**IndexedDB**, the browser's built-in data store. Nothing reaches the server — it
all stays on the user's machine and goes away with the site's data.

| What | When it is written | Scope |
|---|---|---|
| NVRAM — the `C:` drive with files and DOS settings | every 5 s and when the tab is hidden | tab |
| Card images in slots `A:` and `B:` | on every change, including DOS's own writes | tab |
| The HPC-104 expansion's 256 KB | as above | tab |
| Fitted hardware (HPC-104, parallel, serial) | when the setting changes | tab |
| ROM files | once, when first supplied | shared |
| Machine state snapshots — three slots | only on request | tab |

"Tab" means a browser tab: a second one gets its own independent set of keys
(`js/ui/storage.js`, arbitrated through Web Locks) so that two emulators never
overwrite each other's `C:` drive. ROM files are shared across all tabs, being the
identity of the machine rather than its state.

**The browser must support IndexedDB.** Without it the emulator still starts and
runs, but everything is lost when the tab closes. In practice every browser able to
run this emulator at all supports it, because the emulator needs something newer —
ES modules inside a Web Worker. The real floor is **Chrome/Edge 80+** (and
derivatives: Opera, Brave, Vivaldi), **Safari 15+** (iOS included) and
**Firefox 114+**. IndexedDB has been there far longer and is not the constraint.

Stored data can still disappear regardless of support:

- **private / incognito mode** — data is dropped when the window closes, and
  sometimes cannot be written at all;
- **blocking site data**, in settings or in an extension, disables IndexedDB along
  with cookies;
- **clearing history and browsing data** takes it with everything else;
- **Safari** deletes site data after 7 days without a visit — that is its privacy
  protection (ITP), not a fault;
- **low disk space** lets the browser evict data belonging to less-used sites. The
  emulator calls `navigator.storage.persist()`, which usually prevents that, but
  granting it is the browser's decision.

The only dependable backup is a file on disk: **Memory card → Download image**,
downloading individual files from the card listing, or **Machine state → Save to a file**,
which takes everything at once — including whatever the machine happened to have in memory
and on screen.

State snapshots are the one row in that table which does **not** save itself, and that is
deliberate. The other rows stand in for what the batteries held in a real Portfolio, so
they are meant to be invisible; a snapshot is the user's decision about where they want to
be able to return to, and writing one in the background would take that decision away.

## Built-in applications

The Atari key (`` ` ``) is a **modifier** — pressed alone it does nothing. You have
to **hold it** and then press a letter:

| Chord | Application |
|---|---|
| Atari + A | Address Book (`C:UNNAMED.ADR`) |
| Atari + C | Calculator |
| Atari + D | Diary (calendar) |
| Atari + E | Editor (`C:UNNAMED.TXT`) |
| Atari + S | Setup |
| Atari + W | Worksheet (`C:UNNAMED.WKS`) |

The same menu is available from the `APP` command at the prompt. Application names
are **not** DOS commands — `EDIT` returns `Bad command or program not found`.

**Inside an application**, the same Atari key, pressed and released *by itself*,
opens the program's menu bar. At the DOS prompt it does nothing — only
applications have a menu.

Atari also doubles as a numeric-pad overlay, since the Portfolio has no dedicated
numeric keyboard (e.g. Atari+M gives `0`). That's why chords outside the table
above type characters instead of launching anything.

Other useful commands: `VER`, `DIR`, `CLS`, `FORMAT A:`.

### What the Portfolio remembers about itself (`PERMDATA.DAT`)

Every setting the built-in applications hold — everything entered in **Setup**
included — lives in one file on drive `C:`: `C:\SYSTEM\PERMDATA.DAT`, exactly 730
bytes, laid out byte by byte in DIP's technical reference (pages 3-35 and 3-36). The
emulator reads it straight out of the machine's memory and shows it under
**Applications → Read the settings**: the serial line's speed and framing, the printer
destination and margins, the calculator's memories and format, the cursor position in
the editor, and the file each application had open last.

Drive `C:` is a RAM disk inside NVRAM — **ordinary FAT12, only with 128-byte
sectors** — 256 sectors (32 KB) with "DIP 2.0" as its OEM name. That is why the same
code that reads memory cards reads it unchanged; the volume is located by its
signature, because the BIOS lays memory out at boot and the address is not fixed.

Two things are worth knowing before trusting it. **The file is written when the user
leaves the applications** — on <kbd>Esc</kbd> at the top level menu — and not before;
until then every change lives in RAM, so a machine sitting inside the Editor still
shows the previous session's values. And a machine that has never been in an
application has **no such file at all**, which the emulator says in as many words.

The four trailing bytes (baud, parity, data bits, stop bits) were confirmed by
experiment rather than taken on trust from a table the OCR had shredded: a machine
showing `9600 / None / 8 / 1` in Setup reads back here as `07h / 00h / 01h / 00h`.

## Architecture

```
index.html
eprom.html              tool: an EPROM card image with banks of 128 KB
css/app.css
js/main.js              main thread: ROMs, canvas, keyboard, IndexedDB
js/ui/storage.js        NVRAM and card image persistence
js/ui/roms.js           ROM file identification, verification and persistence
js/emu/worker.js        Web Worker: emulation loop paced to real time
js/emu/cpu8088.js       8088 core counted clock by clock (ported from MartyPC)
js/emu/cpu8088-decode.js instruction decode table, generated from MartyPC's source
js/emu/machine.js       memory map, ASIC, I/O ports
js/emu/hd61830.js       LCD controller
js/emu/disasm.js        8088 disassembler, for the inspector
js/emu/keyboard.js      keyboard matrix + browser key mapping
js/emu/pcd3311.js       tone generator
js/emu/hpc101.js        parallel interface (82C55A + Centronics)
js/emu/pofo-link.js     file transfer protocol host
js/emu/hpc102.js        serial interface (82C50A + vector register)
js/emu/hpc104.js        RAM expansion with a second card slot (drive B:) and pass-through
js/emu/ins8250.js       UART
js/ui/lcdgrid.js        dot-grid geometry for the panel, and the painter
js/ui/lcdramp.js        the panel palette: what the contrast register does to the colours
js/ui/serial.js         the other end of the cable: terminal, Web Serial, modem, null-modem
js/ui/fat12.js          reading and writing FAT12 card images
js/eprom/epr.js         EPROM card banks in the Atari ST converter's layout
js/eprom/app.js         the EPROM card page: files, banks, downloads
js/ui/audio.js          Web Audio output
js/ui/permdata.js       reads C:\SYSTEM\PERMDATA.DAT out of machine memory
js/ui/i18n.js           language switching and translation lookup
js/ui/format.js         dates (YYYY-MM-DD) and numbers (decimal point) as the page shows them
js/ui/confirm.js        questions and notices in the page's own dialog
js/ui/dict-en.js        dictionary: Polish source text -> English
tools/ws-tcp-proxy.mjs  WebSocket→TCP bridge for the virtual modem
tools/pofo-headless.mjs the emulator core driven from Node, with no browser
tools/run-tests.mjs     test suite runner
tools/i18n-check.mjs    completeness check for the translation dictionary
tools/tests/            test suites (CPU, LCD, inspector, interface, serial port, power)
tools/pdftext.mjs       text extraction from scanned PDFs with an OCR layer
tools/build-auxwait.mjs AUXWAIT.COM generator (source listing in comments)
tools/auxwait.com       DOS program raising the AUX silence timeout
```

The core lives in a Web Worker and talks to the main thread over `postMessage`.
`SharedArrayBuffer` isn't needed: a frame is 15,360 bytes at 72 Hz, and the emulation
takes little — next to nothing at rest, while the Portfolio waits for a key, and about a
sixth of one core with the CPU busy all the time (measured in Node) — so copying is
cheaper than the COOP/COEP headers SAB would require.

## Interface language

The interface speaks Polish and English. **Which one it starts in comes from the
browser**: anything other than Polish gets the English version. A manual choice —
the `PL`/`EN` switch in the corner of the header — is remembered in
`localStorage` and takes precedence from then on.

The translation layer is dictionary-based and **the key is the Polish source
text**. There is no separate namespace of identifiers like `ui.button.save`: the
page stays readable, and a string with no dictionary entry simply stays Polish
instead of turning into a broken identifier on screen.

The price is that the key has to match to the character, and the key is **what
the DOM returns**, not what the HTML source spells. `data-i18n` reads
`textContent`, where entities are already decoded (`&gt;` is a plain `>`);
`data-i18n-html` reads `innerHTML`, which serialises them back (`&amp;`, `&lt;`,
`&gt;` and `&nbsp;` stay entities). Both are then whitespace-collapsed, so the
indentation that makes the HTML readable never reaches the dictionary. Hence one
oddity in the source: boolean attributes are written `download=""`, because that
is exactly how a browser serialises them.

Strings that only come into being at runtime go through `t('…', arg)` with
`{0}`, `{1}` slots. The worker and the file transfer protocol report in Polish —
they have no DOM and no notion of a language — and the page translates them where
it prints them.

Completeness is enforced by `node tools/i18n-check.mjs` (and the `i18n` test
suite): it rebuilds every key the way the DOM will, and reports strings with no
translation, empty translations, entries left behind by strings that are gone,
and argument slots that disagree between the two sides. Label tables that reach
`t()` as a variable are marked in the code with a `/* i18n-keys */` comment.

## Inspector

A look inside the machine while it runs, in the **Inspector** window. Four panes, refreshed
four times a second, with emulation carrying on throughout — until it is stopped, because
the machine can also be halted here, stepped, and caught in a trap.

- **CPU** — every register, the flags, and the cycle count since reset.
- **Code** — twelve instructions disassembled from `CS:IP`, or from an address typed in.
- **Memory** — 256 bytes from any `segment:offset`, in hex and as characters.
- **Port log** — every read and write in a chosen range, each entry carrying **how many
  cycles passed since the one before it**.

That last column is why the window exists. Everything this project has established about
the LCD controller's timing came down to "how many cycles were there between those two
writes", and every time the answer came from a throwaway script written from scratch. Now
it comes from a window.

The log records **reads as well as writes**, and that is not padding either: the fault that
left the contrast keys useless lived in a **read** that returned nothing. The writes looked
perfectly fine at the time - they simply always carried the same number.

The disassembler (`js/emu/disasm.js`) covers the whole one-byte 8088 map including the
group opcodes, the prefixes and both string blocks; the undocumented opcodes the emulator
implements on purpose - `82h`, `SALC`, `POP CS` - are decoded and marked. Anything not in
the map comes back as `db XXh`, one byte long, so walking forwards never desynchronises.
`tools/tests/disasm.mjs` keeps it honest: besides a handful of hand-checked sequences it
runs a differential check, where across **sixty thousand instructions of a real boot** the
length the disassembler computes must match the number of bytes the CPU actually fetched.

### Breakpoints and stepping

The panes show the machine running; this is the part of the window that **stops** it. Three
ways, all of them on the worker's side — the emulation loop stops turning cycles over, not
merely stops displaying them:

- **Stop / Resume** — by hand, at any moment.
- **Address breakpoints** — several at once, separated by commas or spaces; a bare offset
  means segment `E000`, the ROM. The machine stops **before** the instruction at that
  address runs, so the registers show what that instruction is about to see.
- **Port traps** — a range of ports and a direction: writes, reads, or both. Here the
  machine stops **after** the instruction that touched the port — stopping halfway through
  one would mean unwinding the CPU — so the code pane already shows the next instruction,
  while the state line says which port and which byte it was.

**Step** runs one instruction and refreshes every pane along with the screen; if the machine
was running, it stops it first. A reset on a stopped machine **does not start it running**,
so the boot can be stepped through from the ROM's very first instruction.

A stopped machine turns no cycles, but the pacing loop keeps ticking: the status bar gets
its report every second, at a speed of zero. Closing the window **clears the traps and
resumes the machine** — otherwise it could be left stopped with nothing to start it again.

With no traps set, the emulation loop looks exactly as it did: the address check hides
behind `if (brkAddrs.size)`, and the port trap sits in the hooks that already wrap
`machine.out8`.

`tools/tests/inspector.mjs` keeps it honest — the real worker with `self` substituted, the
same messages the page sends. **The breakpoint address is not written into it**: the suite
steps through the start of the boot, records the trace along with the cycle counter, and
picks from it an instruction that occurs exactly once. Then it starts the machine over —
a cold start is repeatable to the cycle — and checks that the breakpoint lands in the same
place at the same moment. The negative control sits right beside it: with no breakpoint,
that same address has to be passed without stopping. The suite itself was checked with
**nine mutations** in the worker — a breakpoint that never fires, one that fires an
instruction too late, a resume falling straight back into the breakpoint it just left,
a port direction ignored, a step covering two instructions — and every one was caught by
the check meant to catch it.

Port logging costs something only while it is switched on, and closing the window switches
it off.

## Tests

The emulator core touches no DOM, so `Machine` and `CPU8088` can be driven straight
from Node — **about 40× faster than real time** with the CPU busy, and three times
faster again when the machine sits at the prompt sleeping through clocks in `HLT`.
Fifteen minutes of machine time costs some twenty seconds of waiting, which is what
makes questions like "does it ever power down on its own" answerable at all.

```bash
node tools/run-tests.mjs            # everything
node tools/run-tests.mjs standby    # only suites matching the pattern
```

There is no test framework here and there will not be one: the project has no build step
and no dependencies, so neither do its tests. Each suite is a plain module printing
`PASS`/`FAIL` lines that exits non-zero if anything failed.

Suites needing the ROMs **skip themselves** when `rom/` is empty, so the whole thing runs
on a fresh clone without the files the project may not ship. Suites needing a card image
skip themselves the same way: `standby-running-program` and `demos` want
`cards/nucleus.img`, and `demos` picks up further programs from the description in
`software/demos.local.json`, if that file is on disk. The `demos` regression digests the
panel and the controller's line width at fixed seconds into a run, so it catches a change
in CPU timing that would shift what ends up on screen.

### The golden run

`demos` covers the graphical demos, but it needs card images from outside the repository,
so on a fresh clone it **skips itself entirely**. `golden` takes what needs only the ROMs,
which means it runs for everybody: a cold boot, two DOS commands and all six built-in
applications — fifteen measuring points, half a second.

The baselines live in `tools/tests/golden-screens.txt` as **readable text**, and that is
the most important decision in the suite:

```
### aplikacja/kalkulator
~C9~CD*26 Gen M:1 #0 ~BB
~BA                                      ~BA
~BA~C4*38~BA
~BA                                 0    ~BA
~C8 Tue 01 Jan 80 00:00  NUM ~CD*7 INS ~BC
```

Bytes outside ASCII are written as values and runs are collapsed (`~CD*26`), so nothing is
lost and the box drawing does not turn into a wall of noise. A bitmap digest would say
"`a1b2` ≠ `c3d4`"; here the failure names the line and shows both versions side by side,
and an intentional change simply reads in `git diff`. That is not cosmetics — a golden run
nobody can assess quickly ends up as a reflexive "re-record it", and then it guards
nothing at all.

Timing gets **its own checks**, from measurement rather than intuition. The start-up screen
shows a clock to hundredths of a second, which is about 49,000 cycles — a change to one
instruction's cost hides in it without a trace. So the clock is masked out of the screens
and sits beside them as its own check, together with the **number of instructions executed
to reach the prompt**: `run()` spends a fixed cycle budget, so any instruction getting
cheaper immediately changes how many of them fit inside it. Measured: raising the cost of a
taken conditional jump by one cycle moves the counter from 938,823 to 938,235, while the
clock still matches its baseline.

The limit is worth knowing too. A change to an instruction whose cost the bus decides
anyway shows up nowhere — checked the same way: raising `NOP` from 3 to 4 does not move
the counter by one, because NOP is a single byte and fetching a byte takes four clocks,
which is what sets the pace. That is not a gap in the suite but the prefetch queue
behaving faithfully — on a real 8088 the same change would have no effect either.

The boot runs **cold, with no shortcuts**, because that is the one path there is no
skipping. The other points start from a state snapshot taken at the prompt — the snapshot
lives inside that single run, so nothing needs regenerating when the state format changes,
and it saves eight boots.


The harness can boot the machine to its prompt, read the screen out of the MDA text
buffer, inject keys including chords (Atari+S opens Setup), insert card images, hook
probes onto ports, memory and executed addresses, and — through `callInterrupt` — call a
ROM service the way a program would: a two-byte `INT n` followed by `HLT` is planted in
spare video RAM and the CPU is pointed at it, so the vector, the flags and the `IRET`
behave exactly as they do for real code.

It is how the power-down question was settled, how the tone tables were verified, how the
tick-rate register turned up (`INT 61h` `1Eh` writes `8040h`), and what the ROM demands
before it will come up after the `OFF` command.

### Wiring the interface up

Every other suite runs the emulator **without a DOM**, so none of them will notice the
cheapest mistake there is: an `id` renamed or dropped. Nothing shows in the code — it is
the browser where `document.getElementById` hands back `null` and the first
`addEventListener` takes the page down. With a little bad luck not the whole page, just
one dialog nobody happened to open.

`ui-wiring` reads `index.html`, `js/main.js`, `js/boot.js` and `css/app.css` as text —
the project has no build step, so there is nothing to inject into — and checks that they
agree with each other:

| Check | What it catches |
|---|---|
| every `id` the code reaches for exists in the HTML | an element renamed or removed |
| no `id` appears twice | two elements, one of them unreachable |
| `data-modal` points at a `<dialog class="modal">` | a window that will not open, or not close |
| `data-state-save/load/drop` cover `STATE_SLOTS` | a state-slot button that does nothing |
| `#serial-mode` options, `serial-opt-*` panels and the switching loop | a mode with no settings, a panel that cannot be shown |
| both card slots have the full set of controls | slot B wired up halfway |
| `.checked` only on checkboxes, `.value` only on things that have one | a checkbox turned into a dropdown |
| no `id` in the HTML is dead | leftovers from an old change, dictionary entry and all |

The lists the suite compares — state slots, port modes, reset buttons, slot controls —
are **pulled out of the source** rather than written into the test file. A copied list
would only ever check itself.

The control-type check earns a sentence of its own, because the fault it catches is
entirely silent. Turning an `<input type="checkbox">` into a `<select>` changes nothing
visible in the code: `.checked` on a dropdown is `undefined`, an option switched off for
good, with nothing in the console to say so. The suite walks the `els` and `insp` tables,
looks at how each element is used, and compares that against the tag in the HTML — 46
uses of `.checked` and 39 of `.value`, across twenty-eight distinct controls.

The suite itself was checked by **mutation**: thirteen faults introduced on purpose, one
per check — a renamed `id`, a duplicated `id`, a `<dialog>` turned into a `<div>`, a
window missing its `modal` class, a state slot with no button, a port mode with no panel,
a checkbox turned into a dropdown, a slot-B control taken out of the table, an element
nothing points at. All thirteen were caught, each by the check meant to catch it.

### The CPU against a reference model

The core is the foundation under everything this project has measured. The LCD
controller's timing, the 50-cycle threshold, the prefetch queue model — each of those
results assumes the instructions execute correctly. So the arithmetic is not checked by
"it boots and it works", but **differentially, against a model computed a different way**.

A genuinely different way. Where the core loops a bit at a time, the model uses powers of
two; where the core keeps the half-carry in a flag, the model derives it from arithmetic
on nibbles. A shared mistake then has no way to cancel itself out. Flags the architecture
leaves undefined are not compared at all — each group in each suite lists which.

| Suite | What it covers |
|---|---|
| `cpu-alu` | eight ALU operations on bytes — all 65,536 pairs, signed and unsigned multiply, shifts, divide |
| `cpu-alu16` | the same at word width, over the product of the boundary values; both shift-count forms |
| `cpu-decimal` | AAA, AAS, DAA, DAS, AAM, AAD |
| `cpu-muldiv` | 16-bit multiply and divide, signed divide, NEG, NOT, INC, DEC, CBW, CWD |
| `cpu-string` | the five string instructions, both directions, segment prefixes, three repeat forms |
| `cpu-undoc` | 82h, 60h–6Fh, SALC, POP CS, F1h — and instruction lengths across the **whole** opcode map |
| `cpu-cycles` | cycle counts against the 8088 tables |
| `cpu-sst` | three million instructions recorded on a real 8088 (SingleStepTests): state, memory and the bus on every clock — data kept outside the repository, see [CPU timing](#cpu-timing) |

Two of those are worth singling out.

The decimal adjusts are checked **from what they are for**, not by restating the manual's
pseudocode. For every pair of two-digit numbers, `ADD AL,BL / DAA` must produce the BCD of
the sum, with carry out exactly when the sum passed 99. That check shares no source with
the implementation — a restated pseudocode would only confirm it had been copied twice the
same way. Arguments outside BCD are compared with what a real 8088 does, as
recorded by SingleStepTests, rather than with the manual's pseudocode — and they differ
from it: the second adjustment of `DAA`/`DAS` is thresholded at 9Fh when AF was set. `/6`
in the shift group was settled the same way: it is not an alias of `SHL` but SETMO, which
sets every bit of the result.

The last check in `cpu-undoc` is broader than the rest, and it is what keeps the inspector
honest: across **all 65,536 (opcode, second byte) pairs**, the length the disassembler
computes must match the number of bytes the CPU fetched. `disasm` does the same thing, but
only over instructions the Portfolio ROM actually executes — and the ROM never lands in the
undocumented corner of the map. That gap is how it went unnoticed that the core executes
60h–6Fh as conditional jumps (the 8086 decodes them from five bits, so they land on the
same conditions as 70h–7Fh) while the disassembler showed `db 60h`, one byte long. The
inspector window drifted from there to the bottom — and had no way to report it, because
it looked perfectly reasonable.

## Machine state

A snapshot freezes the whole machine where it stands, and loading one puts it straight
back there — no boot, the same picture on the display. Three slots in the browser's
database, plus a `.pofostate` file for carrying it elsewhere.

This is a different thing from the battery-backed memory that saves itself. That one
holds drive `C:` and survives being switched off, but the Portfolio still starts from
scratch when it comes back on, because that is exactly what the hardware did. A snapshot
holds the **run**: the CPU midway through an instruction, what is on the screen, the cycle
count, the keyboard queue, both standby countdowns.

A snapshot also carries the **fitted hardware**, and that is not decoration: a state saved
with the memory expansion in place has to come back with it, or drive `B:` disappears
along with its contents. Loading therefore rebuilds the board chain before restoring the
state, and tells the page what ended up fitted — so the switches in the interface do not
describe hardware the machine no longer has.

The same goes for the **cards**. The snapshot holds the card in `A:`, and the one in `B:`
when the expansion was fitted; after loading, the machine runs on those, so the slots on
the page take them over too — the file list, the browser's storage and the download all
show the card the machine actually has. A slot whose card would change asks first, so the
card in it can be downloaded before it is replaced; a snapshot holding the very same card
loads without the question.

### Why this is not a list of fields

An incomplete snapshot does not break straight away. The restored machine runs, looks
right, and falls over some seconds later, somewhere with no visible connection to whatever
was missing. There is a measure of that in the tests: with **one byte** of memory
deliberately corrupted, the divergence took **175,631 instructions** to surface.

So `tools/tests/state.mjs` does not check fields one at a time. It checks two things at
once:

- **a parallel run** — the snapshot is taken mid-work, restored into a machine built from
  scratch, and the two then run side by side **step for step across 200,000 instructions**.
  After every step the registers, flags and cycle count are compared; at the end, all of
  memory, the controller's display memory and its registers;
- **field coverage** — the suite walks the live objects field by field and demands that
  each one either appear in the snapshot or stand on a list of deliberate omissions **with
  a reason**. There is no third category. Adding a field to a device and forgetting it
  fails the test immediately, rather than waiting until it matters.

Separately, `state-worker.mjs` puts the same thing through the real worker, along the same
message path the page uses, and `state-file.mjs` closes the loop through a file: a real
machine's snapshot goes through the encoder and back, and must return byte for byte **and
with the same array types** — a byte array restored as a plain array of numbers compares
identically and hands the core something it cannot use.

The file format is deliberately boring: JSON with the byte arrays in base64. It is not the
tightest possible — a full state with a card and the expansion runs to about 690 KB — but
it has **no field layout of its own**: the encoder walks the object recursively, so adding
a field to any device needs no change to `js/ui/statefile.js`. A format that must be
updated alongside every device eventually stops being updated.

## Case artwork

The screen is overlaid on case artwork from `gfx/`. Each zoom level has its own
file, because the artwork is drawn separately rather than scaled — the heights
are 180 / 358 / 537 / 715, and the offsets aren't clean multiples of each other:

| Level | File | Size | Picture left | Glass top | Picture starts at |
|---|---|---|---|---|---|
| 1× | `portfoliator.png` | 407×180 | 109 | 55 | 63 |
| 2× | `portfoliator-2x.png` | 814×358 | 217 | 110 | 126 |
| 3× | `portfoliator-3x.png` | 1221×537 | 326 | 165 | 189 |
| 4× | `portfoliator-4x.png` | 1628×715 | 436 | 220 | 252 |

**The glass is taller than the picture.** On a real Portfolio one character row
of dots sits above the driven area and one below it — they belong to the panel
and carry the same lattice, they are simply never lit. The controller drives 64
rows; the glass shows **80**. Those two rows are painted by the emulator rather
than by the artwork, so that they get the same dot grid, the same contrast ramp
and the same panel inertia as the rest of the screen; anything else would show
a seam the moment the contrast register moved.

So the two coordinates mean different things: **`x` is the left edge of the
picture** (there are no blank columns, only blank rows), while **`y` is the top
of the glass**, eight rows (times the zoom) above the picture. The canvas starts
at the top of the glass, so the picture lands in the right place on its own.

**The glass in the artwork is painted in the emulator's own background colour,**
`rgb(142, 193, 172)` — `LCD_OFF` in [`js/ui/lcdramp.js`](js/ui/lcdramp.js). It is a
little larger than the canvas, the way a real panel has a margin of glass round its
dots: one pixel at the sides at 1×, up to seven at 4×, and a row below at 3×. In any
other shade that margin shows as a band where the canvas stops, so artwork exported
anew has to keep its glass in exactly this colour, anti-aliased edges included.

Every level has artwork of its own — 4× included, where a doubled 2× used to
stand in — so nothing is scaled and every level stays crisp. The geometry lives
in the `SHELLS` table in [`js/main.js`](js/main.js) — swapping the artwork is a
one-line change.

## CPU timing

How long an instruction takes cannot be read off a table — and that is a conclusion from
measurement, not an assumption. The tables give the execution unit's work and quietly
assume the instruction's bytes are already inside the chip. On an 8088 they are not: the
bus fetches **one byte per four clocks**, the same bus carries every memory access and
every port write, and so execution and fetching **compete for it**.

What settled it is a measurement no table can explain. Take the loop the *trainfolio* demo
draws with, and remove from it either the port write or the four-byte memory read. Those
are entirely different instructions — but each removal takes exactly **one bus cycle** out
of the loop, and on a real Portfolio each one saved exactly the same **5.99 clocks**. What
the machine charges for is bus cycles, not instructions.

### A core counted clock by clock

The CPU (`js/emu/cpu8088.js`) is a port of the 8088 core of Daniel Balsom's
[MartyPC](https://github.com/dbalsom/martypc) (MIT licence), made function for function.
It is not a model with rules but a simulation of the chip:

- one call to `cycle()` is one clock. The bus unit steps through T1–T4 and through the
  pipelined address cycle that lets it set up the next bus cycle before the current one
  ends;
- the instruction queue holds four bytes. Fetching holds off when three are in it; the bus
  unit decides on the next fetch at the end of T2, and an execution-unit request that lands
  on a fetch already scheduled pays two clocks for aborting it;
- every instruction is straight-line code that spends clocks where the 8088's microcode
  spends them. Multiply and divide run the CORX and CORD loops bit by bit, so their time
  depends on the data exactly as on the chip.

There is not one constant in the core fitted to measurements from the Portfolio. It was
checked two independent ways.

**Against a real 8088.** [SingleStepTests 8088](https://github.com/SingleStepTests/8088) is
3,007,000 single instructions recorded on an NMOS 8088 (AMD D8088): the state before and
after, and the bus and queue status on every clock in between. Registers, all flags —
including the ones the documentation leaves undefined — and memory agree in **every** case;
the clock count and the bus status on each clock agree in **2,931,155**, or 97.5%. The
differences sit in fifteen files and are all inherited from MartyPC:

- entering a far procedure or an interrupt (`CALL FAR`, `INT`, the divide exception) writes
  CS to the stack a clock later than the chip, but ends on the same clock;
- `TEST register, immediate` from a full queue takes the immediate byte a clock early, with
  the same total;
- the one case where a whole instruction's time changes: `MOV byte [BX+SI], immediate` and
  `[BP+DI]` (no displacement or an 8-bit one, no prefix) from a full queue comes out a clock
  short — in 307 cases of 10,000.

`tools/tests/cpu-sst.mjs` keeps watch over this. The test data (761 MB) is not in the
repository, so the suite runs once `SST_8088` points at its directory and skips itself
otherwise.

**Against the Portfolio.** The 647 measurements the `TEMPO` programs took on a real
Portfolio (more on them below) the core lands with a **mean error of 0.17%**. **568** of
them are within 0.06%, which means the emulator prints the same whole counter the Portfolio
printed, and 644 within 0.5%. The earlier rule-based model had 1.31% and 285 within 0.06%
on the same measurements. All twenty-two known errors of that model — runs of `CWD`, `AAA`
without the adjustment behind a long instruction, shifts by `CL` interleaved with a store —
the new core lands without anyone having tuned it for them. The conclusion goes beyond the
numbers: **the Portfolio's 80C88 counts clocks exactly like an NMOS 8088**, and what the
rule-based model could not do was ordinary bus work.

| shape | Portfolio | core |
|---|---:|---:|
| `DEC BP` + `JNE` (empty loop) | 22.13 | 22.13 |
| `MOV AX,BX` × 8 | 86.29 | 86.33 |
| `MOV AL,[BX]` × 8 | 136.37 | 136.48 |
| `OUT DX,AL` × 8 | 88.28 | 88.33 |
| (`MOV DI` + `CX`=8 + `REP STOSB`) × 4 | 468.65 | 468.94 |
| (`MOV AL,FF` + `MUL BL`) × 4, BL=FF | 353.59 | 353.83 |
| (`MOV AL,FF` + `AAM 02`) × 4 | 388.93 | 389.23 |
| `CWD` × 8 with a negative `AX` | 67.27 | 67.33 |
| `SCASB`, `NOP` × 3, `MOV AL,[SI]` in a `LOOP` | 1692.56 | 1692.83 |
| the tunnel loop from *trainfolio* | 416.23 | 416.28 |
| *trainfolio*'s drawing loop | 1902.17 | 1902.62 |
| *Nucleus*'s loop at 366:1609 | 8856.22 | 8860.99 |

Clocks per turn of the block, with the measuring scaffold described below. The earlier rule-based
model gave 61.33 in the `CWD` row and 1815.83 in the `SCASB` row.

Three measurements the core misses, and they stand in the suite as **known errors**: eight
`LODSB` in a row (−3.71%), the *Nucleus* drawing column without a displacement (−1.75%), and
(`SHL CL` + `OR AL,[BX+DI+d16]` × 2) × 4 (−0.82%). MartyPC run as a program gives the same
numbers on them, so it is either a difference between the 80C88 and the NMOS 8088 or
something in those three measurements — undecided.

A whole demo, timed with a stopwatch: *Nucleus* from launch to the prompt takes 362.95 s on
the Portfolio, and the earlier rule-based model gave 362.21 s. The clock-exact core runs it
1.55 s longer than that model, so about 363.8 s (+0.2%) — an estimate, not a measurement, because the
stopwatch and the emulator end the run in slightly different places.

Counting clock by clock is slower than the rule-based model was, but with room to spare: a
Portfolio boot runs in Node at about 28 million clocks a second, and real time needs 4.9
million.

### How the Portfolio was measured

The reference values come from programs run on a real Portfolio (`TEMPO1` to `TEMPO69`).
Each turns the block under test in a loop and counts the outer loop's turns over fifteen
seconds of the ASIC counter, with blocks that measure nothing at the start and the end —
they come out identical in every run, so nothing drifted. Anchors repeated across
programs, weeks and sessions land on the same whole number; all of it fits within 0.25%,
which is what the method is worth.

The counter the program prints measures turns of the **whole** outer loop, and that loop
does more than turn the block INNER times: it bumps the counter, reads the ASIC port and
asks whether fifteen seconds have passed. That scaffold is byte for byte the same in every
program and costs 264.94 clocks a turn — 0.13 of a clock at INNER 2000 and 10.60 at INNER
25. The suite adds it to every row the same way, which is why the empty loop stands at 22.13
in the table and not at the 22.00 `TEMPO7` measured directly.

This is guarded by `tools/tests/cpu-sprzet.mjs`, the one suite in the project whose
reference values are hardware measurements rather than a record of the emulator's state.
Every row has a 0.5% limit unless it is a recorded known error, in which case
the drift from the recorded figure is what is guarded. When a value stops matching it
**must not be re-recorded**: it means the core has started lying about that particular
shape of code.

### The earlier rule-based model

Before the clock-exact core went in, timing came from a rule-based model: execution-unit costs from the tables, an
approximated queue and a few dozen rules fitted to successive `TEMPO` programs — from the
`max(table, 4 × bytes)` approximation at 10.3% error down to 1.13% on 621 measurements.
The measurements it was built on are still in the suite, where they now check the new core.

## LCD controller fidelity

The HD61830 has no display memory of its own — it uses 2 KB of external SRAM on the
display board and shares it with the panel refresh. After every data write it needs a
moment before it will take the next access. One that arrives sooner is mishandled, and
**what happens depends on what arrived**:

- **another data write** is lost. The address counter does not move either, so the bytes
  written afterwards land where the lost one was headed: the row does not come out
  speckled but **cut short**, its far end keeping whatever was there before;
- **an instruction write** catches the byte still in flight and pulls it into the **mode
  control register**, clearing whichever of its bits that byte holds low. Display memory
  is left **untouched** underneath — this is a correct picture being scanned out wrongly —
  and it stays that way until the program sets the chip up again.

Two of the eight bits matter. With **bit 1** low, graphic mode is lost: the controller
reads display memory as character codes and the panel goes white with a band against its
right edge. With **bit 5** low, the display is switched off and the panel goes blank. The
rest — character-generator select, cursor, blink and the two unused bits — have nothing to
spoil in graphic mode. The byte `FFh` holds nothing low and is entirely harmless.

Established on a real Portfolio across ten test programs, and settled by a pair of
repairs: with the picture wrecked, **rewriting mode control alone restores it outright**,
while rewriting the character count repairs nothing. The emulator used to assume the
character count — a reconstruction from the width of the surviving strip, because the
Portfolio cannot read the controller's registers back. The reconstruction was wrong.

**How often** a late write catches a byte has been known since 2026-08-26: about one
violation in twenty. Measured as a dose-response curve — three doses of violations, six
runs at each, counting how often the panel went blank: 33% at eight violations, 83% at
thirty-two, always at a hundred and twenty-eight. The fit gives 0.053 with a 95% interval
of 0.024 to 0.108, and the emulator's constant is 0.05, which sits inside it — so it
stayed where it was. For months it had been the softest number in that file, guessed from
the look of one demo; it turned out to be right.

The shape of the curve matters as much as the number. A rate that rises with the dose is
what an independent per-violation chance looks like, and it was not a foregone conclusion:
an earlier run with one sample per dose came back non-monotone — four violations blanked
the panel, sixty-four did not — leaving it open whether this was a coin at all. Six
samples per dose settled it.

### The notches, and what they actually were

A note stood here for months saying the real machine drops about 0.6% of bytes even at
twice the safe spacing, and that the emulator does not reproduce it — written down as a
known divergence on the strength of notches counted across a few screens. Two measurements
on 2026-08-26 settled it from both ends.

**Spacing has nothing to do with it.** Nine spacings from 59 to 419 cycles, two runs each,
**34,560 bytes written and not one notch** — at 0.6% there would have been two hundred and
seven. The upper bound fell to 0.0087%.

**The notches are real all the same — they are violations, not spacing.** What settled it
was a program putting three bands on one screen, with the gap between data writes held
identical and only what sat between the bytes allowed to differ:

| band | between the bytes | lost |
|---|---|---|
| top | nothing, data alone | 0 of 4800 |
| middle | instruction **52 cycles** after the byte, inside the window | **82 of 4800 = 1.71%** |
| bottom | instruction 112 cycles after the byte, outside it | 0 of 4800 |

So it is not the interleaving: the band that interleaves **outside** the window lost
nothing at all. It is whether the instruction falls inside the recovery window. The notches
counted long ago and filed under spacing were violations from the start.

A late instruction write therefore has two outcomes, both measured and both modelled: about
one time in twenty it pulls the byte into the mode control register, and about one time in
sixty the byte never reaches display memory at all. The byte is not corrupted but simply
never stored — what shows through is whatever was underneath.

**That the old content shows through has been measured since 2026-08-27.** Every earlier run
cleared the panel to white and wrote in black, so a hole came out white and looked exactly as
it would if the chip cleared the cell instead. `GRANICA.COM` put two blocks side by side,
written by the same code at the same timing and differing only in the bed beneath them, with
three rows of white cut through the middle of the black one:

| block | bed | notches |
|---|---|---|
| B | white | 33 of 1680 = 1.96% |
| C, the black part | black | 0 of 1176 |
| C, the stripe through it | white | 11 of 504 = 2.18% |

The notches in the lower block fell **only inside the stripe**, at the same rate as in the
upper one. Had the chip cleared the cell, they would have shown across the block's full
height and there would have been thirty-three of them rather than eleven; P(≤11 | 33) = 9e-6.

The same program closed an older doubt along the way: whether the notches seen "on the
boundary between bands" were bytes landing at the wrong address. They were not — they are the
violating band's own first row, hard against a narrow gap. `GRANICA.COM`'s control block, with
ten blank rows on either side of it, never showed a notch, and the data-only control across
every run now stands at **43,840 bytes with no losses**, an upper bound of 0.0068%.

**Bit 4 stopped being a puzzle on 2026-08-26.** It was the loose thread from that sweep:
the third of the bits the Portfolio sets, and the only one whose loss left no mark. Two
explanations fitted equally well — either clearing it is harmless, or the violation simply
had not fired that run. Writing the register **directly, with no violation anywhere near
it**, settles it: mode `22h`, master cleared and everything else as the Portfolio sets it,
draws exactly what `32h` draws. The bit is inert on this board, so the sweep's clean result
was the truth rather than a miss.

The same run confirmed the rest of the register bit by bit: `12h` blanks the panel, `30h`
drops it into character mode, and the character-generator select, cursor and blink bits are
all invisible in graphic mode. The character-mode picture matched this emulation down to
its shape — regular vertical stripes with an empty band where display memory holds zeros —
and that was the first time that path had been checked against hardware at all.

The rule is one-sided: only what arrives **after** a data write counts. An access wedged
in just before one is harmless, because the data write is the only access that reaches the
external SRAM, so it is the only one there is anything to recover from.

No program can find this out. **The Portfolio's LCD interface is write-only**: reading
port `8010h` gives back `10h` and `8011h` gives `11h` — the low byte of the port address,
left on the bus because nothing drives data in return. Measured on real hardware over
65 536 reads, every one identical, the busy bit never once set; reading display memory
through instruction `0Dh` returns the same. Neither the BIOS nor any demo can check
whether a byte arrived. They all write blind, because nothing else is on offer.

### Where 50 cycles comes from

From measurement, not from a datasheet. `STEPTEST` painted the screen black and then wrote
it white at eight fixed rates, one per screenful: **the fifth screenful left an unwritten
band down the right-hand edge, the sixth came out clean** — six runs each way.

The observation itself has never moved; the ruler has. Those two screenfuls were 43 and 49
cycles apart when the instruction tables were taken at face value, 51 and 59 once the
eight-bit bus was charged for; 46 and 54 once the prefetch queue began to be simulated
rather than approximated; and 48 and 56 in the earlier rule-based model and in the
clock-exact core, derived again when it went in. Hence 50 — and hence the rule worth keeping in sight: **this
threshold is exactly as good as the cycle model beneath it, and every change to that model
means deriving it from STEPTEST again.**

How much of a row survives is then decided by the arithmetic of rejection rather than by
any average rate, because the timestamp only moves on an **accepted** write: at a spacing
of `s` the chip takes one write in `ceil(50/s)`. At 48 cycles that is every second byte,
so half a row.

### The switch

**System → LCD controller fidelity** has two settings:

- **As on the original hardware** (the default) — the controller gets its 50 cycles, so a
  program that ignores them sees what it would see on a real Portfolio;
- **Takes everything — unrealistic** — every write accepted at once, however fast; the
  screen stays clean, but no such chip ever existed.

The second setting stays purely as a diagnostic. When a picture looks wrong, flipping it
settles in one click whether access timing is to blame or something else entirely. Without
it, every such doubt would have to be taken apart in the code.

Ordinary use is unaffected either way. The BIOS respects the controller's timing — it has
to, since real hardware works — so booting, DOS and the built-in applications look
identical under both settings, character for character.

## Contrast

**Atari and the up arrow**, and **Atari and down**, move the contrast, exactly as they do
on a real Portfolio. The value lives in the register at `8060h`: sixty-four steps of four,
from zero to `FCh`, with a cold start leaving it at `80h`, in the middle.

That register has to be **readable**, because it is the only place the current level is
kept - there is no copy anywhere in memory. The ROM moves the contrast at `E000:1BA0` like
this:

```
mov dx, 8060h / in al, dx / cmp al, 0FCh / jnb on / add al, 4 / out dx, al
```

While reading that port returned zero, the ROM saw zero every time, added four and wrote
four - so the keys moved the picture exactly once and then stuck. `tools/tests/contrast.mjs`
keeps watch on it now.

What the individual steps **look like** is reconstructed rather than measured: the
technical reference gives the register one sentence and no characteristic at all. Below the
middle the lit dots fade towards the background; above it the background itself darkens
towards the ink and the panel closes up.

**Both ends go all the way**, because on the hardware they do: wound down the panel goes
blank with no trace of the characters left, wound up it closes into one dark field with no
dots to be picked out of it. They used to stop short of it - 15% of the span left at the
bottom, 60% at the top - so the scale ran out before the picture did. The travel between
them is spread evenly, one visible step per keypress, because nothing says where it ought
to bunch up.

`tools/tests/lcd-ramp.mjs` keeps watch: that either end gives a panel of **one** colour,
that the span grows towards `80h` and shrinks past it without doubling back, that all
sixty-four steps give sixty-four different pictures - a dead step looks like a broken key -
and that at `80h` the palette is exactly what it was before, channel for channel.

## Panel inertia

The HD61830 switches a pixel at once; a 1989 liquid crystal does not. A dot takes
tens to hundreds of milliseconds to reach its new state, and that is where the
smear behind scrolling text and the soft blink of the cursor come from — neither
of which falls out of emulating the controller alone.

So the main thread keeps a second array beside the worker's bitmap — one float per
pixel, `0` = clear, `1` = fully dark — and on every frame eases it towards the bits
the emulation sent:

```
level += (target − level) · (1 − exp(−dt / τ))
```

Rise and fall have separate time constants: relaxing back to rest takes a liquid
crystal longer than being driven by a voltage, so the fall `τ` is 60% longer
(`INERTIA_FALL_RATIO` in [`js/main.js`](js/main.js)). The step is computed from the
real interval between frames, capped at 100 ms, so a hidden tab or a stalled machine
does not look like a second of smearing.

The colour comes from a 256-step ramp between `rgb(142, 193, 172)` and
`rgb(67, 71, 151)`, packed once at startup. A pixel that comes within half a ramp step
of its target is snapped to it — without that the exponential tail would never end.
Working all 15,360 levels forward, with every one of them in flight, costs about
**0.065 ms**; the painter described below is on top of that.

A panel where nothing moved and nothing settled is not repainted at all — and a still
screen is what a Portfolio shows most of the time.

The **System → Screen inertia** slider sets the rise `τ` over 0–300 ms and is
remembered with the rest of the settings. `0` disables the model entirely and returns
to plain bit blitting — a crisp image, as in MAME. The 50 ms default is judged by
eye, not measured off a particular unit; STN panels depend heavily on temperature
anyway, which is why the slider reaches up to a distinctly cold screen.

The single exponential described above is only one of four **rise shapes** to choose from
in **System → Rise shape**. The slider stays the time scale for all of them; only the
path the dot takes changes, and it is two independent choices crossed:

| | no slow finish | long slow finish |
|---|---|---|
| **hard start** | **0** — one exponential, the default | **1** |
| **soft start** (S-curve) | **2** | **3** |

A soft start is two exponentials in cascade: the second chases the first, so for a moment
nothing happens and then the dot picks up speed. A long slow finish hands 45% of the way
to a component four times slower (`RISE_SLOW`, `W_FAST`, `W_SLOW` in
[`js/main.js`](js/main.js)): the dot shows at once but pale, and full saturation comes
much later. The fast part is the same curve in both columns. At 50 ms the first frame
gives 28%, 19%, 8% and 8% black respectively, and the dot reaches full black after 316,
1250, 416 and 1250 ms; in all four, clearing takes 60% longer than going dark.

The shapes began as a trial for testers with a real Portfolio, meant to show which of the
two effects is really there. The testers decided to leave the choice to users, so the
switch stays and is remembered with the rest of the settings. The default, **0**,
is the model the emulator had before there was any choice.

## The dot grid

A dot on the panel does not touch its neighbour: each has an electrode of its own, with
an unpowered gap between them showing nothing but the backing of the panel. That is
where the lattice visible on the glass comes from — and where the decision came from
that reworked how the picture is drawn at all: **an emulated pixel stopped being
a square of one colour**.

The canvas backing store is now measured in **device pixels** rather than emulated
ones. There is one reason and it admits no argument: at 125% system zoom a dot gets 2.5
screen pixels. A lattice laid out in whole pixels would fall every two, then every
three; the two rhythms would drift apart and a band would walk across the panel. So the
gap is drawn by **coverage**: for every device pixel,
[`js/ui/lcdgrid.js`](js/ui/lcdgrid.js) works out how much of it the dot really covers,
and the painter darkens it by that much. An edge falling halfway across a pixel gives
a pixel half dark — which is what the glass shows.

The weights depend on geometry alone, so they are computed once per change of scale
rather than once per frame. Horizontally an output pixel takes at most two dots (a pixel
one device pixel wide cannot reach across three while a cell is wider than it is), and
vertically the same — so a row of levels is spread across once and then two such rows
are mixed for every output row. Inside a dot that mixture does not change, so most rows
are copies of the row above and are copied rather than computed: at 4x on a doubled
display it is five rows in eight, and it halves the frame.

The cost, with all 15,360 dots in flight (inertia plus painter; the frame budget is
13.9 ms at 72 Hz):

| scale / zoom | backing store | total | of budget |
|---|---|---|---|
| 2x / 100% | 480×128 | 0.27 ms | 2.0% |
| 2x / 125% | 600×160 | 0.48 ms | 3.4% |
| 3x / 100% | 720×192 | 0.58 ms | 4.2% |
| 4x / 100% | 960×256 | 0.70 ms | 5.1% |
| 3x / 200% | 1440×384 | 1.11 ms | 8.0% |
| 4x / 200% | 1920×512 | 1.43 ms | 10.3% |

The **System → Pixel grid** slider sets the gap as a share of the pitch, 0–30%, and is
remembered with the rest of the settings. **The figure is not measured from hardware** —
the documentation gives no dimensions for the panel, and without them any number would
be invented; the 10% default is judged by eye against a real Portfolio, offered for
comparison against a photograph of your own unit. A wider gap is not neutral for
brightness: the background shows through the lattice, so the wider it is, the paler all
the text looks. `0` butts the dots together and, at
a whole number of pixels per dot, produces a buffer **identical pixel for pixel** to
what the emulator drew before — a check of its own in
[`tools/tests/lcd-grid.mjs`](tools/tests/lcd-grid.mjs) sees to that, because the mere
possibility of drawing a lattice has no business shifting the picture for anyone who
does not want one.

It also disposes of an older unevenness that had nothing to give it away: at fractional
zoom `image-rendering: pixelated` rounded dots onto whole screen pixels, so some came
out wider than others. The width is now spread evenly and the leftover fraction is
carried by half-shades.

`tools/tests/lcd-grid.mjs` checks the coverage arithmetic (how much ink each dot gets,
across ten pitches and five gaps), agreement with the old dot-for-dot copying, and the
row-copying shortcut itself — that last one against a painter that computes every pixel
separately, because a mistake in the shortcut does not slow the program down, it quietly
spoils the picture. The suite was checked with **ten mutations** in
[`js/ui/lcdgrid.js`](js/ui/lcdgrid.js) — a gap never drawn, one twice too wide, one on
a single side of the dot, coverage taken without clipping to the pixel, a row copy
recognised by indices alone — and every one was caught. There are now thirty-two test
suites.

## Memory map

| Range | Contents |
|---|---|
| `00000h–1EFFFh` | RAM (128 KB minus a 4 KB screen buffer) |
| `1F000h–AFFFFh` | unmapped, reads as 0 |
| `B0000h–BFFFFh` | top 4 KB of RAM, mirrored every 4 KB — MDA-compatible text buffer |
| `C0000h–DFFFFh` | window switched by the ROM_B selector (port `8051h`) |
| `E0000h–FFFFFh` | BIOS/DOS ROM |

ROM_B selector: `0` = application ROM, `2` = external ROM, `3` = internal card
(A:), `7` = card on the expansion port.

The whole 128 KB of RAM is battery-backed — here it's flushed to IndexedDB every
5 seconds and whenever the browser tab is hidden. A "cold start" clears it, the
equivalent of pulling the battery: **it wipes every file on drive C:**.

## I/O map

Only `80xxh` (decoded on bits 7:4) and `0061h` are decoded.

| Port | Read | Write |
|---|---|---|
| `8000h` | key code | — |
| `8010h` / `8011h` | LCD data / status | LCD data / instruction |
| `8020h` | — | PCD3311T DTMF generator (not emulated) |
| `8030h` | — | power management (bit 1 = power off) |
| `8040h` | counter, low byte (2 Hz) | clock tick rate (bit 0: 1 = 1 s, 0 = 128 s) |
| `8041h` | counter, high byte + wake-up source | counter reload, high byte |
| `8050h` | interrupt pending (IP) | interrupt enable (IE) |
| `8051h` | battery status / PDET / ROM_B, bit 7 = power-up | ROM_B bus selector |
| `8060h` | — | LCD contrast |
| `8070h–807Fh` | expansion port (BCOM) | expansion port (BCOM) |

### Open bus and Portfolio detection

Reading an I/O port outside the `80xxh` range returns **the low byte of the
port number**. This isn't a trick, it's 8088 physics: lines AD0–AD7 are
multiplexed between address and data, so when no device drives the bus on a
read, the last low address byte that was put on it stays there — and that's
what comes back to the CPU.

Software on the Portfolio uses this to detect the machine. FoliDash does:

```asm
MOV DX, 0060h
IN  AL, DX
CMP AL, DL        ; DL = 60h
JZ  ok
                  ; otherwise: "Fatal error: Atari Portfolio not detected!"
```

MAME hardcodes only the one case it happened to hit — port `0061h` returning
`61h`, commented *"Magic port to detect the Pofo"*. That's the same rule
observed once; here it's generalized, so `0061h` falls out of it on its own.
**This is a deliberate departure from the MAME model.**

Inside the `80xxh` window, unrecognized sub-addresses return zero, same as
MAME — there's no evidence to suggest otherwise.

### Peripheral identifiers (PID)

A peripheral terminating the bus announces itself with a byte read from `807Fh`.
DIP carved up the range like this (technical reference, page 2-20):

| PID | Peripheral |
|---|---|
| `00h` | communication card |
| `01h` | serial port — **emulated** (HPC-102) |
| `02h` | parallel port — **emulated** (HPC-101) |
| `03h` | printer |
| `04h` | modem |
| `05h`–`3Fh` | reserved for DIP |
| `40h`–`7Fh` | third-party peripherals, allocated by Atari |
| `80h` | file-transfer interface |
| `81h`–`FFh` | reserved |

The emulator implements the two in the middle. The rest is recorded so that adding
another peripheral does not mean guessing a number — or taking one out of a
reserved range.

For peripherals that imitate the serial or parallel board, the BIOS has a separate
door: `INT 61h` `1Bh` (*Set Peripheral ID byte*) tells it to treat a foreign
identifier as one of those two.

## Interrupts

There's no 8259. The ASIC has 4-bit IP (pending) and IE (enable) registers;
the CPU's INT0 line is active whenever `IP & IE ≠ 0`. On interrupt
acknowledge, the ASIC returns the vector of the first set bit and clears it:

| Bit | Source | Vector |
|---|---|---|
| 0 | system tick | `08h` |
| 1 | keyboard | `09h` |
| 2 | error | `00h` |
| 3 | external (expansion port) | from the peripheral |

The system tick interrupt runs **at the rate the machine asks for**. There is **no
128 Hz mode**, contrary to what this file used to say: DIP's documentation gives two
rates — **once per second** or **once every 128 seconds** — selected with `INT 61h`
subfunction `1Eh` (*Get/Set Clock tick speed*, pages 3-14 and 3-31 of the technical
reference). The register behind that call is the **write to `8040h`**: `01h` picks
one tick a second, `00h` one every 128 seconds. It was found by logging port writes
across the call, and over a boot, a handful of DOS commands and twenty seconds of
idling it is written exactly once — the `00h` the BIOS sends from `E000:0322` to
choose the slow, battery-saving rate. Nothing else uses the port, which is why the
low half is read as a rate selector rather than as the counter's low byte.

Knowing the rate is what let the tick **follow the rate a program asks for**. It used to be off,
because ticking every second for a program that had asked for the slow rate would
have been 128 times too often; now the emulator simply follows the selection. The
toggle in the UI silences it entirely, for anyone who wants that.

## Power management

A real Portfolio cuts its own power after a few minutes without a key press. **That is
the ASIC, not the ROM** — established by disassembling the BIOS wait loop at
`E000:143F`:

```asm
143F: STI
1440: MOV  DX, 8030h      ; power control register
1443: MOV  AL, 0
1445: OUT  DX, AL         ; enter standby
1446: HLT                 ; stop the CPU until an interrupt
1447: NOP
1448: TEST byte [0125], 80h
144D: JZ   143F           ; spin until bit 7 comes up
```

Bit 7 of `0040:0125` is set by **exactly one place in the whole BIOS** (`E000:1553`),
and that is the keyboard path: zero executions in 30 seconds of idling, two on a key
press. There is **no countdown in this loop at all** — if the power-down were the ROM's
doing, this is where it would have to live.

The emulation therefore models the chip's timer rather than any code: a write to
`8030h` with bit 1 clear arms standby, keyboard activity restarts the count, and
crossing the configured number of 128 s boundaries cuts power. The boundary comes off
the same 2 Hz counter as the other timers (256 counts = 128 s), so the real delay
depends on phase — with two periods it lands **between 128 and 256 s**, exactly as DIP
documents it. The author's unit measures about 230 s; the emulator typically gives 251 s.

Once asleep the **CPU stops and the screen goes dark** — this is a power cut, not a
pause. **Any key wakes it**: the CPU was never stopped mid-instruction, it is waiting on
the `HLT` inside that loop, so resuming it plus the keyboard interrupt is enough for the
session to carry on from the same place.

The count only advances **while the CPU is actually halted**, because that is what
standby is. A program doing work is in RUN mode and out of reach of the timer: a demo
running for minutes without waiting on a key reaches its end untouched, and the count
only starts once the prompt is back. Verified against Nucleus — it plays for 321 s with
the CPU never once halted, returns to `a>`, and only 182 s after that does the machine
go dark. This also reproduces a quirk DIP calls out separately: a program that polls the
keyboard in a loop instead of waiting on `INT 16h` will **never** let the machine sleep.

The choice is the user's — **System → Power down when idle** — because fidelity
has a price here: an emulator left in an open tab does go dark while you read. It is set
the way a real Portfolio behaves by default.

The `OFF` command is a separate route, and a deeper sleep. DIP's guide keeps the two
states apart in section 2.5.1: in standby everything stays powered and only the `CCLK`
clock is halted, while in OFF mode the supply reaches nothing but the ASIC and the RAM.
There is no CPU left to resume, so the way back is an `MRST` pulse — a hardware warm
boot — and that is what the emulator does. The session comes back whole: RAM keeps its
power throughout, so drive `C:` and the screen you left behind both survive.

## What a cold start leaves in RAM

A real Portfolio wakes up with memory full of leftovers. The cells hold their charge
for a while after the batteries come out, so what a program finds there is neither
zeros nor the same twice — and a program that reads memory before writing anything to
it therefore behaves differently on hardware than on an emulator handing out a tidy
field of zeros. The difference stays invisible until it is not.

**System → Cold start with random RAM** fills main memory and the panel's own
SRAM from the platform's generator instead, so two cold starts differ. It takes effect
from the next cold start, not the moment it is switched on: refilling memory under a
running program would reproduce nothing, it would only topple it. The RAM on the
expansion board — drive B: — is left alone, exactly as an ordinary cold start leaves it.
On by default, because the machine should behave like the hardware.

What it does **not** do is fix anything. It is a way of reproducing faults, not curing
them, and the fault that prompted it turned out not to be one of them. The program it
was written for was measured across a full 560-second run, sampling the panel every two
seconds, and all 280 samples come out byte-identical whether memory starts zeroed or
random. Whatever it does differently on real hardware, it does not depend on what was in
RAM beforehand.

## Keyboard

A 63-key 8×8 matrix. The ASIC hands the BIOS a **physical** code of
`row × 8 + column`, with bit 7 marking key release; only INT 09h translates it
into a PC scan code. That's why programs reading port `60h` don't work on the
Portfolio.

Events are queued and issued at 600 Hz, the same rate the real chip scans at.
The mapping is positional; exceptions:

| Portfolio | PC |
|---|---|
| Atari | `` ` `` |
| Fn | `F1` |
| Lock | `Caps Lock` |
| Del/Ins | `Delete` or `Insert` |

Like a laptop, the Portfolio carries an embedded numeric keypad printed in small
type on `U I O`, `J K L` and their neighbours. **Atari + Lock** toggles it — in the
emulator that is `` ` `` + `Caps Lock`. Worth knowing before it catches you out:
switched on by accident, the letter keys start typing digits and nothing on the
machine says why. There is no Num Lock key in the matrix; the whole latch lives in
the ROM's INT 09h handler, so the emulator only passes the combination through.

### When the browser does not report a modifier

Since what goes to the ROM are **scan codes** and not characters, the emulator identifies a
key by `e.code` - by where it sits, not by what comes out of it. The colon is therefore not
assembled by the browser but by the Portfolio: it is handed the Shift code and the
semicolon code, and does the rest itself.

The assumption that every key arrives as an event turned out to be too strong, though.
**LibreWolf** (Firefox 154 with `resistFingerprinting` on by default) sends neither
`keydown` nor `keyup` for Shift - while still setting `shiftKey` on every other key. Code
27 never went out, `Shift`+`;` reached DIP-DOS as a bare semicolon, and the drive could not
be changed.

So the truth is taken from the **flag, not the key**: before each key goes out,
`js/ui/hostkeys.js` compares `shiftKey`, `ctrlKey` and `altKey` against what the matrix is
holding and makes up the difference with a stand-in press - necessarily *before* the key
itself, because the ROM reads scan codes in order. Browsers that do report the modifier
never reach that path. `tools/tests/hostkeys.mjs` guards it, replaying real events from
both browsers.

### Auto-repeat

Auto-repeat lives in the ASIC model rather than in the browser layer, and that follows from
measuring the ROM itself. The Portfolio's BIOS has **no typematic of its own**: fed bare
make codes every 100 ms it prints exactly ten characters a second, and fed one make code
and silence it prints one character however long the key is held. A character comes from a
code, not from a key's state - so the repeat has to come from below the BIOS.

Putting it there has a second benefit: the rate does not depend on the user's operating
system settings, so the emulation behaves the same everywhere and can be tested without a
browser. Only the most recently pressed key repeats; modifiers, locks and the Atari key do
not repeat at all, none of them producing a character.

**The rate is not measured.** Half a second of delay and ten repeats a second are the IBM
PC defaults, put there so the behaviour exists at all - nobody has timed a real Portfolio.
Both numbers are marked as provisional in the header of `js/emu/keyboard.js`, and
`tools/tests/key-repeat.mjs` guards the **mechanism**, not the rate: that the repeat starts
after the delay, runs evenly, listens to the release, moves to a newly pressed key and
survives a state save.

## Memory cards

A card is removable storage, seen as drive **A:** (and **B:** with the HPC-104).
DIP-DOS formats one so that the volume always has 256 sectors, growing the
**sector size** rather than their number:

| card | sector | sectors | root entries | FAT sectors | capacity |
|---|---|---|---|---|---|
| 32 KB | 128 B | 256 | 32 | 3 | 31 232 B |
| 64 KB | 256 B | 256 | 64 | 2 | 62 720 B |
| 128 KB | 512 B | 256 | 128 | 1 | 125 952 B |
| 256 KB | 512 B | 511 | 128 | 2 | 256 000 B |

The last row breaks the pattern twice over. **The card window in the CPU map is
128 KB and does not grow** — a larger card is made of 128 KB pages, selected by
writing the page number to offset `000Ah` of the window (DIP's guide, section
2.3.5, which is why it insists that *no* software may use that byte). On a card
that fits the window there is no such latch and the byte is ordinary storage,
holding the trailing space of the OEM name "DIP 2.0 ".

The second oddity: **the volume is not laid out flat across the pages**. Measured
against an image the ROM itself wrote — a file whose directory entry gives
cluster 386, sector 395 by the BPB, has its data in sector 397. A kilobyte, two
sectors, falls out of the volume at every boundary, and *which* two was read off
the ROM as it reads a file across one: it takes volume sector 254 from page 0 at
`1FC00h` and then goes straight to page 1 at `200h`. So the pair left out is the
**last** sector of a page together with the **first** of the next — not the first
two of the next, as was assumed until a demo turned up that noticed. A freshly
formatted card leaves both untouched. The last cluster the BPB still counts falls
past the end of the card and is never allocated.

Both directions are covered by the `cards` suite: whether the machine reads an
image built here, and whether our reader lands where the ROM wrote — for every
image in `cards/` and for a 256 KB card with a file beyond the page boundary.


A card is banked into the `C0000h–DFFFFh` window in place of the application
ROM. The emulation is **at the hardware level**, so INT 13h is handled by the
original driver in ROM — plain card images work, with no hooks whatsoever.
Cards smaller than 128 KB are mirrored across the window, same as on real
hardware.

A RAM card is writable; ROM/OTPROM cards should be marked read-only. The image
is kept in IndexedDB and can be downloaded with a button.

The geometry is not an invention of ours: it was read off images the original ROM's own
`FORMAT A:` produced — the 256 KB row included, page-boundary shift and all. That is
exactly what `js/ui/fat12.js` writes.

### A card can be a ROM extension

The first 128 bytes of a ROM card may hold code that **the BIOS executes at boot** —
DIP's extension mechanism. The word at offset 0 decides:

| Word | When it runs |
|---|---|
| `AA55h` | after BIOS initialization |
| `55AAh` | after DOS initialization |
| `5555h` | repeatedly: before and after both BIOS and DOS, before the command processor, and on power-down and power-up |

Jump vectors follow, laid out so they do not collide with the BIOS parameter block —
a card can therefore be an extension and an ordinary disk at once. Extensions are
looked for on A:, then in the peripheral's ROM, then on B:.

The emulator need do nothing about this: the original ROM runs the code. It is worth
knowing when building card images, though — **a card whose first word happens to match
one of those three values will be executed as a program**. Images from `fat12.js` are
built from a genuine DIP-DOS boot sector, so cards formatted here are not affected.

One more thing to leave alone: the byte at offset `0Ah` of the boot sector is reserved
for the page register of cards larger than 128 KB.

### Booting from a card

An `AUTOEXEC.BAT` on a card takes precedence over the one on `C:`, and **B: wins over
A:** when both carry one. To run the one on `C:` anyway, end the card's batch file with
`C:AUTOEXEC`. `CONFIG.SYS` is read **only ever** from `C:` and cannot be overridden.

### Loading your own software

The card panel has a built-in FAT12 file manager, so there's no need to format
anything from DOS:

1. **Create and format** a card (32, 64, or 128 KB).
2. **Add files…** — pick files from disk; they land in the card's root
   directory.
3. **Reset** — DOS caches the FAT in memory, so after changing the card's
   contents from the host side it has to be reloaded.
4. In the emulator: `A:` to switch to the card, or `COPY A:\*.* C:\` to copy
   files onto the internal disk.

Files on the card can also be downloaded back to the host (a "download" button
next to each entry), and the whole image can be saved with the "Download
image" button.

Names are converted to 8.3 uppercase; disallowed characters become `_`. The
root directory holds 32 / 64 / 128 entries depending on card size.

`formatCard()` in [`js/ui/fat12.js`](js/ui/fat12.js) reproduces, **byte for
byte**, the exact format that `FORMAT A:` from ROM writes — verified for all
three sizes. `FORMAT A:` from DOS naturally works too.

### EPROM card

The page [`eprom.html`](eprom.html) prepares an image to burn into the EPROM of a
Portfolio card. The card window is 128 KB, so a larger chip — 27C020, 27C040, 27C080 — is
divided into **banks** of 128 KB: each is a volume with files of its own, and the card
chooses which one the Portfolio sees. The page puts the banks together into one `.epr`
file for the programmer, in place of the old `copy /b bank1.epr + bank2.epr + … eprom.epr`.

The bank layout is not invented here. It reproduces **DISK zu EPROM Konverter** (SWB
1992, Harun Scheutzow for tri tec) on the Atari ST, which copied an ST floppy onto the
EPROM sector by sector and changed only what the Portfolio requires — its messages say so
outright: one FAT, the true number of sectors on the medium ("sonst spinnt der PF"), and
8 sectors per track on 2 sides ("anderes erkennt der PF nicht"). Hence:

| | |
|---|---|
| boot sector | an ST floppy header (`E9 00`, `NNNNNN`, serial number), BPB: 512 B, 256 sectors, media `F9h` |
| cluster | 2 sectors, 1 KB — 126 clusters to a bank |
| root directory | cut down to what it holds: 15 entries, then 47, 79, 111; each step costs 1 KB |
| data | contiguous, in directory order: a directory, then what is in it |
| last sector | a copy of the boot sector, outside every cluster |

This was checked against three banks the ST converter made from real folders: rebuilt
here from the same files, they have the same boot sector, the same copy at the end, the
same FAT and the same directory entries down to the cluster. They differ only in what the
ST left behind by accident: rubbish in the tails of clusters and deleted entries (`E5h`)
in the root directory. DIP-DOS in the emulator reads them like any card and runs programs
from them.

**Load a folder as the bank** does what preparing a floppy on the ST did: the folder's
contents land in the root of the bank, and its name becomes the label. Folders dropped on
a bank become subdirectories. Long names are cut down to 8.3 (`~1` on a clash), dates
come from the files. A finished `.epr` image — one made on the ST and glued together
with `copy /b` too — can be opened again to swap one bank. Every bank can also be
downloaded on its own and loaded into the emulator as card A: before it goes to the EPROM.

The logic lives in [`js/eprom/epr.js`](js/eprom/epr.js), with no DOM, and
`tools/tests/eprom.mjs` keeps watch over it: the BPB fields, the order of clusters,
capacity and its limits, 8.3 names, reading DIP-DOS cards, DIR in the emulator — and, if
banks from the ST converter lie in `epr/` (a folder outside the repository), agreement
with them as well.

### A note on space on C:

The internal `C:` drive is a RAM disk carved out of the same 128 KB of memory
— about **31 KB** is left on it. Larger programs need to run straight from the
card (`A:`) rather than being copied to `C:`.

## Parallel interface (HPC-101)

82C55A + Centronics on the expansion port:

| Port | Role |
|---|---|
| `8078h` | port A — data lines |
| `8079h` | port B — control: `~STROBE`, `~AUTOFD`, `~INIT`, `~SELECT_IN` |
| `807Ah` | port C — status: `PERROR`, `SELECT`, `~FAULT`, `BUSY`, `~ACK` |
| `807Bh` | 8255 control register |
| `807Fh` | peripheral ID — returns `02h` (parallel port) |

Every byte latched on the falling edge of `~STROBE` goes into a buffer; the
"Finish print job" button turns it into a `Blob` and downloads it as a file.
The `BUSY`/`~ACK` handshake is emulated so the polling loops in the BIOS don't
hang.

Tested: `DIR > PRN` from DIP-DOS.

## File transfer

The same cable does double duty: moving files onto a **running** system,
without a reset and without rebuilding the card image. The ROM switches the
82C55A port directions depending on the job — `89h` for printing, `92h` for
transfer.

On the Portfolio: hold Atari and press <kbd>S</kbd> → **File transfer** →
**Server**. `Waiting for connection` appears. Then in the *Parallel port*
panel choose **Send files…**.

### Protocol

Two lines in each direction, bit-by-bit transmission, **MSB first**, one bit
per **clock edge**:

| Line | Direction | Role |
|---|---|---|
| port A bit 0 | host → Portfolio | data |
| port A bit 1 | host → Portfolio | clock |
| port C bit 0 | Portfolio → host | clock |
| port C bit 1 | Portfolio → host | data |

A block: the host waits for `5Ah` (ready), sends `A5h`, length LSB/MSB, data,
and a checksum that's the two's complement of the sum of length and data; the
Portfolio echoes the same checksum as an acknowledgment. Commands: `03h` send
file, `02h` receive file, `06h` directory listing. Responses: `21h` = file not
found (a success when sending), `20h` = file exists.

Two things are critical for this to work: a **50 µs gap before every byte**,
and **50 ms after the ready signal** before sending `A5h`. The wait loops in
ROM have a timeout of about 10 ms, so longer pauses in the middle of a block
break it.

One correction to the published documentation: it describes the idle signal
as the sequence `5A 69 A5 96`. Measuring port C writes showed the Portfolio
actually transmits **plain `5Ah`, repeatedly** — the other three values are
the same `5Ah` read at a shifted phase.

## Serial interface (HPC-102)

An 82C50A on the expansion port. Since both boards answer the same identifier
query, only one can be plugged in at a time — in the emulator, just like on
the desk.

| Port | Role |
|---|---|
| `8070h`–`8077h` | UART registers (offset `& 7`) |
| `807Fh` | read: peripheral ID, `01h` = serial port; write: interrupt vector register |

The peripheral has no fixed vector — the driver itself writes to `807Fh` the
number the ASIC should hand the CPU on `EINT` acknowledge. That vector register
(SIVR) is **write-only**; reading the same address returns the peripheral ID.

The connector is a **9-pin D-Sub wired as DTE** — the same as a PC's COM port
(technical reference, page 4-1):

| Pin | Signal | | Pin | Signal |
|---|---|---|---|---|
| 1 | CD — carrier detect | | 6 | DSR — data set ready |
| 2 | RD — receive data | | 7 | RTS — request to send |
| 3 | TD — transmit data | | 8 | CTS — clear to send |
| 4 | DTR — data terminal ready | | 9 | RI — ring indicator |
| 5 | GND — signal ground | | | |

The practical consequence: talking to a PC needs a **null-modem cable**, because two
DTE connectors joined by a straight cable transmit into each other's inputs. The
minimum is `2↔3`, `3↔2`, `5↔5`; crossing `7↔8` and `4↔6` as well is worth doing.
The baud rate is divided down from a **1.8432 MHz** clock.

Measured on the original ROM:

- after boot the line sits at **2400 8N1**, with DTR and RTS raised;
- `ECHO something > AUX`, `DIR > AUX`, and `COPY AUX FILE.TXT` work without
  any driver — `AUX` is handled by the BIOS;
- Setup → **RS-232 port** lets you pick 9600/4800/2400/1200…, but the change
  only reaches the chip after **Initialize!** (choosing 4800 → divisor 24);
- `CTTY AUX` **doesn't work**: DIP-DOS 2.11 has no such internal command, so
  you can't get a console on the serial line from ROM alone;
- `COPY FILE.TXT AUX` **doesn't append** `1Ah` at the end, and this version of
  COPY doesn't know the `/A` switch — the receiving end has to be closed with
  an end-of-file mark from outside (the "Finish receiving" button);
- `COPY AUX …` aborts with `Not ready error` after **about 4.25 s of
  silence** — the same whether it's before the first byte or in the middle of
  a stream (3 s gaps pass, 4 s doesn't). The limit lives in byte `0040:007C`,
  the COM1 slot in the standard RS-232 timeout table in the BIOS data area,
  and it scales linearly: `01h` (default) → 4.25 s, `02h` → 8.5 s, `08h` →
  34 s. The BIOS resets it to `01h` on every boot, so the *Serial port* panel
  keeps re-applying the chosen value instead of setting it once. A single
  write is plenty, though, and it holds until reboot — that's what
  `tools/auxwait.com` rests on (76 bytes, `AUXWAIT 14` → about a minute),
  which also works on real hardware.

### Pacing the outbound stream

The 82C50A receiver holds **one byte** — a FIFO only arrived with the 16550 — and
DIP-DOS polls it by hand, in a loop. At 9600 a character takes 1.04 ms and that is
all the time there is to collect it; while the system is busy appending to a file,
the next byte overwrites the previous one and is gone. The emulator never sees this
from its own side, because in front of that single-byte register it keeps an
unbounded software queue (`rxQueue` in [`js/emu/ins8250.js`](js/emu/ins8250.js)) — a
burst that chokes the real machine is absorbed here without a trace. Only a real
Portfolio on the far end of Web Serial shows the difference.

So the *Serial port* panel carries a **transmit delay** in milliseconds per character
and per line — the same control Tera Term offers. The queue lives in `SerialHub`
([`js/ui/serial.js`](js/ui/serial.js)) and covers both sources at once: what you send
onto the line by hand, and what the emulated Portfolio transmits through `AUX`. The
rules:

- **0 and 0 disables everything** — bytes reach the backend on the same call as
  before, with no queue and no timers at all;
- with a per-character delay the queue releases **one byte per step**; with that at
  zero and a per-line delay set, **a whole line per write**;
- the line pause is charged **once per CRLF**, not twice: it hangs off the LF, or off
  a CR that is not followed by one;
- it does **not** hold the emulated machine back — that finishes its `COPY` long
  before the bytes leave the queue, which is why the panel shows a **`w kolejce`**
  (queued) figure beside the counters;
- disconnecting **drops** the queue, and zeroing the delays hands the rest over at once.

The setting proven in practice is **15 ms per character and 15 ms per line**.

Sending a file onto the line gets a window of its own: a progress bar, a percentage
and an estimate of the time left — read from what has really left the queue, so
changing the delays mid-transfer does not throw it off. The window cannot be
dismissed by accident while it runs; **Przerwij** ends it and drops the rest, and a
connection lost underneath is reported separately. `SerialHub.sendJob()` keeps the
count, because only the queue knows what actually went out: bytes sitting in it
**ahead** of the send do not count towards its progress, and bytes pushed in
**behind** it by the emulated Portfolio do not inflate it.

### The other end of the cable

The host keeps the UART in the worker; what sits at the other end is chosen in
the *Serial port* panel ([`js/ui/serial.js`](js/ui/serial.js)):

| Mode | What it does |
|---|---|
| Terminal | a text console on the page; traffic monitoring also works in every other mode |
| Web Serial | a real RS-232 port on the host machine via `navigator.serial` (Chrome/Edge, over HTTPS or on `localhost`) |
| Modem | an AT-command modem that opens a WebSocket instead of dialing |
| Null-modem | another browser tab over `BroadcastChannel` — two emulated Portfolios wired together |

The modem understands `ATZ`, `ATE0/1`, `ATV0/1`, `ATH`, `ATO`, `ATI`,
`ATDT host:port`, the `+++` escape, and reports `CONNECT` / `NO CARRIER`,
driving the DCD line accordingly; every other `AT…` command gets an `OK`, the
same way a real modem answers commands its terminal software doesn't
recognize.

Since a browser can't open a raw TCP socket, `tools/ws-tcp-proxy.mjs` is a
dependency-free WebSocket→TCP bridge:

```
node tools/ws-tcp-proxy.mjs --allow bbs.example.com:23
```

Without `--allow` nothing is reachable, and that's deliberate: a proxy that
connects anywhere is an open relay into whatever network it runs on.

Port 23 isn't a raw byte stream — it's telnet: the far end opens with option
negotiation (`FF FB 03 FF FB 01 …`) that a terminal program from 1989 would
print as garbage, and some BBSes wait for a reply before showing their
banner. So the proxy runs traffic through an NVT filter and answers on the
Portfolio's behalf:

| Option | Response |
|---|---|
| `TTYPE` | `WILL`, reports `ASCII` in subnegotiation (`--term`) |
| `NAWS` | `WILL` + size `40×8`, exactly what the LCD has |
| `SGA`, `BINARY` | `WILL` / `DO` — character-at-a-time, no line mode |
| `ECHO` | `DO`, the host does the echoing |
| everything else | `WONT` / `DONT` |

The agreed state of every option is remembered, because that's the whole
point of RFC 854's loop protection: never answer with what's already been
said. A `FFh` byte coming from the Portfolio is doubled. `--telnet off` turns
off this whole layer and leaves a raw pipe, needed for services that aren't
telnet.

### ASCII mode

By default the proxy strips ANSI sequences from the stream; `--ascii off`
leaves them in.

Reporting a terminal type buys nothing here, and this was measured:
Synchronet accepts `TTYPE IS "ASCII"` in subnegotiation and still sends back
**exactly the same** stream as with `ANSI`, byte for byte. Both engines
ignore `TTYPE` and probe the terminal instead — they park the cursor at
255,255 and ask where it landed:

```
ESC[s  ESC[255B  ESC[255C  ESC[6n  ESC[u
```

ACOM never answers, so a board that waits for a reply does fall back to
ASCII on its own — except the welcome screen has already gone out in colour,
and ACOM doesn't interpret escapes, printing them literally as `[0;1;40;36m`
scattered through the text. So the stripping happens in the proxy instead.
Measured on `vert.synchro.net:23`: 237 B and 12 escapes before the filter,
184 B and zero after. `--term` remains as an escape hatch for boards that do
read `TTYPE`.

Bytes above `7Fh` pass through untouched, because the Portfolio's character
generator is CP437 — box-drawing and block characters really do render. The
only thing that mangles them is the 40-character width, and that can't be
fixed from this end of the cable.

Verified end-to-end on live BBSes: Level 29 (`bbs.fozztexx.com:23`), Black
Flag on Mystic 1.12 (`blackflag.acid.org:23`), and Vertrauen on Synchronet
(`vert.synchro.net:23`) — not a single `FFh` byte reaches the Portfolio.

The null-modem cable passed its own test too: two emulated Portfolios in one
process, `COPY LIST.TXT AUX` on one side and `COPY AUX RECEIVED.TXT` on the
other — the file went through intact.

### The bridge and hosting

The proxy is not part of the page and nothing serves it — it's a separate
process that the browser connects to. So the web server stays purely static
and doesn't need Node; only the machine the bridge actually runs on does.
Without it, the "modem" mode answers `NO CARRIER` and the rest of the
emulator works unchanged.

The constraint is fundamentally the browser's, not the project's: a page
can't open TCP sockets, so telnet always needs a go-between on a side that
can. That leaves three arrangements:

| Where the bridge runs | Consequence |
|---|---|
| On the visitor's machine | they need to download `tools/ws-tcp-proxy.mjs` (it lives in the served directory) and have Node; the *Serial port* panel walks them through it |
| Publicly, next to the site | nobody needs anything locally, but it's your traffic and your `--allow` list to maintain |
| Nowhere | the modem stays inactive, everything else works — reasonable for a plain emulator demo |

If the page is served over HTTPS and the bridge runs on `localhost`, it's
worth checking the target browser's behaviour: `ws://localhost` passes the
mixed-content check, because `localhost` counts as a potentially trustworthy
origin, but Chrome separately gates a public page reaching into the local
network. Over plain HTTP there's no issue. A public bridge has to be served
over `wss://`, or a page on HTTPS won't call it at all.

## Sound (PCD3311T)

The Portfolio's only sound output is a Philips PCD3311T tone generator on
port `8020h`, driven in parallel:

| Bits | Meaning |
|---|---|
| 0–5 | tone select (D5:D4 = bank, D3:D0 = position) |
| 6 | STROBE — **falling** edge latches D0–D5 |
| 7 | drives VDD, MODE, and A0 all at once |

Banks: `00h` single DTMF tones, `10h` DTMF pairs, `20h` modem tones, `30h`
musical tones (16 pitches, 622.5–1768.5 Hz).

The frequency tables come from the chip datasheet by way of MAME, but they can be
checked **independently**: the technical reference lists 25 tone codes for `INT 61h`
`16h` together with their notes and frequencies (page 3-11). All 25 agree — the
**largest deviation is 0.75%** and the average under 0.3%, which is what you would
expect from a chip that synthesises tones by division rather than landing exactly on
equal temperament. Notably the ROM does not stay inside the musical bank: nine of the
notes (`29h` = D6, `0Eh` = F#6, `04h` = A#6 among them) come from the DTMF and modem
banks — and those match too.

The output is two Web Audio oscillators gain-gated — no PCM streaming. The
worker timestamps every tone change with the **CPU cycle counter**, and the
main thread schedules it in Web Audio ahead of time; that way the melody
isn't quantized to the emulation loop's step.

### Timbre

MAME synthesizes a **square** wave (visible in `sound_stream_update`: the
accumulator flips the signal between `+1.0` and `-1.0`). That's a
simplification, not a description of the chip — the datasheet describes the
PCD3311 as having *"low output distortion with on-chip filtering conforming
to CEPT recommendations"*, meaning the output is close to a sine wave.
Reproducing a square wave literally gives a characteristic shrillness the
real Portfolio doesn't have.

So the whole signal path is emulated, not just the chip:

| Stage | Setting |
|---|---|
| waveform | sine + about 4% low harmonics |
| high-pass filter | 300 Hz — a small transducer doesn't move air below that |
| transducer resonance | +2 dB at 1400 Hz, Q 0.9 |
| low-pass filter | 3000 Hz — the case and the chip's own filter roll off the top |

That lands inside the telephone band, exactly where this chip was designed
to work. The computed response of the chain is flat across the range of
tones in use (6.4–7.9 dB for every bank, a 1.5 dB difference between the
DTMF low and high groups), and the harmonics roll off monotonically: the 5th
by 0.7 dB, the 7th by 7.2 dB, the 9th by 12.6 dB.

The resonance sits low on purpose. The first attempt placed it at 2100 Hz,
which **boosted the third harmonic of the DTMF low group by 5 dB above the
fundamental** — right in the band where the ear hears harshness, so it
worked against the goal.

The raw square wave stays available in the System panel as a second timbre
option.

Browsers block audio until the first interaction — you have to click
**Enable** in the System panel.

The frequencies come from `pcd3311.cpp` in MAME and are **approximate
values** — the exact divisors live in the chip's own undumped internal ROM,
which MAME notes as an open item. So the pitches may drift slightly from
real hardware.

### Key click — an extension beyond the MAME model

The key click is **not a tone**. The BIOS leaves D0–D5 at zero, never pulses
STROBE, and instead toggles bit 7 for about **102 µs**:

```
out 8020h, 00h    ; bit7 = 0
     ... 102 us ...
out 8020h, 80h    ; bit7 = 1
```

Bit 7 powers the chip (VDD), so this pulse simply jolts the piezo element.
The PCD3311 model in MAME keeps that line as a plain register the generator
never reads — which is why **in MAME the key click doesn't work at all**.

Here, every edge on that line fires a pulse. The two edges of one click are
102 µs apart, so the audio layer merges anything closer than 0.8 ms into a
single hit — the result is exactly one click per keypress. The timbre (a
damped 4 kHz sine) is an approximation of the piezo's mechanical response;
the pulse's **timing** is reproduced exactly.

The settings in Setup → Sounds (Key Click, Alarms, Buzzer) work — they're
handled by the BIOS, not the emulator. Key Click is on by default.

### Dialing numbers by tone (DTMF)

The Address Book can dial a phone number by tone — you'd hold the Portfolio
up to a handset's mouthpiece. It's the only use of the DTMF-pair bank
(`10h`).

The number must be **on the card's first line, after the name** (that's
what the built-in help requires — Atari → Help… → Dialing):

| Notation | Meaning |
|---|---|
| `,` `;` | separates multiple numbers |
| `( )` | area code, e.g. `(0483)` — appears as a separate menu entry |
| `[ ]` | comment, e.g. `[ext 3212]` — not dialed |
| `-` space `.` | a pause while dialing |
| `/` | ending variant: `301555/6` gives `301555` and `301556` |

Example from the help text: `DIP (0483)301555, 815629 [h.]`

Verified: card `smith 5551234` → Atari → `Dial…` → dialing the number
produces 7 DTMF pairs, ~102 ms tone and ~102 ms gap, decoding back to
`5551234`.

## Memory expansion (HPC-104)

The board does three things at once: it adds a **second card slot** (drive
`B:`), **256 KB of its own RAM** mapped straight into the address space, and
it has a **pass-through**, so a printer or serial port keeps working plugged
in behind it. That's why in the emulator HPC-104 doesn't claim the expansion
port exclusively — it sits at the front of it, and the chosen peripheral
plugs in behind it.

| Range | Role |
|---|---|
| `1F000h`–`5EFFFh` | board RAM, unit 1 (switch position) |
| `5F000h`–`9EFFFh` | board RAM, unit 2 |
| `807Ch` | write, bit 0: NCC1 — card slot gate |

Measured on the original ROM:

- `CHKDSK` reports **126,976 B** without the board and **389,120 B** with
  it, exactly `+256 KB` — DOS counts the entire added memory. A card in slot
  B has nothing to do with it: the result is identical with an empty slot;
- the RAM disk `C:` grows along with memory, since the system carves it out
  of the same pool: capacity `31,232 B → 94,208 B`, free `31,104 B →
  93,696 B`;
- **unit 2 doesn't grow memory** (still `126,976 B`): it leaves a gap
  between `1F000h` and `5F000h`, and the BIOS stops counting at the first
  gap. This switch position only makes sense as a second board next to a
  first one;
- `DIR B:` lists files, `COPY A:*.* B:` works both ways, and a printer
  plugged in behind the pass-through still catches bytes;
- without the board, `DIR B:` gives `Insert disk for drive B:` — DOS's
  phantom second drive on a single-drive machine, not a real slot.

One deliberate departure from MAME: `hpc104.cpp` leaves `nmd1()` at the
interface's default value (1), and at 1 the ROM **doesn't mount `B:` at
all**. Measuring on real ROM shows that only asserting NMD1 produces a
working `B:` drive — with a card it lists files, without one it reports a
read error instead of a phantom. So this device asserts NMD1.

## What's not here

- **8087** — ESC instructions are decoded and skipped; the Portfolio never
  had a coprocessor anyway.
- **Portfolio 2** (`pofo2`, F82C425, 640×200).
- **The second wake-up source after `OFF`.** Coming up from the `MRST` pulse, the ROM
  asks the ASIC why it was switched on, and recognises two answers — bits 0 and 1 of
  the read at `8041h`. Bit 0 is the keyboard and only that one is modelled; the other
  bit leads into a separate routine in the ROM, and what asserts it on real hardware
  was never established. Nothing here ever raises it.

## Author

Written by dely / blowjobb / ng. Development used an LLM throughout — from the
reverse-engineering measurements against MAME to the code itself.

## Thanks

The emulator was tested by the following people:
**Peri Noid**, **spkr/sfmx**, **MKM/Lamers**, **Cosi** and **tr1x/Agenda**. Their tests,
reports and comparisons against an original Portfolio pointed at things I would
certainly never have found on my own. Thank you very much for helping this
program along.

## Sources

The hardware model was reconstructed from MAME source files marked
`license:BSD-3-Clause`, and from the *Atari Portfolio Technical Reference
Guide*, 1st ed., September 1989.

The guide circulates as a **scan with an OCR layer**, not as text. `tools/pdftext.mjs`
reads it — a dependency-free extractor written for the occasion, because such files
carry three traps at once: `ToUnicode` maps are often stored uncompressed, the word
`endstream` ends in `stream`, and image data contains text operators by chance. Line
breaks are reconstructed from the text matrix; without that every word lands on a line
of its own and the register tables turn to confetti. The scan itself stays out of the
repository — it belongs to DIP Ltd.

| MAME file | What came from it |
|---|---|
| `src/mame/atari/pofo.cpp` | memory map, I/O map, ASIC interrupt controller, ROM_B selector, battery register |
| `src/devices/video/hd61830.cpp`, `.h` | LCD controller model, text- and graphics-mode drawing algorithm |
| `src/mame/atari/pofo_kbd.cpp` | 8×8 keyboard matrix and physical scan code layout |
| `src/devices/sound/pcd3311.cpp`, `.h` | DTMF, modem, and musical tone tables, STROBE behaviour |
| `src/devices/bus/pofo/ccm.cpp`, `exp.cpp`, `hpc101.cpp`, `hpc102.cpp`, `hpc104.cpp` | card slot, expansion port protocol, 82C55A parallel interface, HPC-104 RAM mapping and NCC1 gate |
| `src/devices/machine/ins8250.cpp` | 8250 UART (registers, interrupts) — authors: smf, Carl |

The file transfer protocol was reconstructed from two independent write-ups:

| Source | License |
|---|---|
| [Transfolio](https://github.com/skudi/transfolio), Klaus Peichl, 2018 | **no license** — code unused, only the protocol knowledge was used |
| [PofoManager](https://github.com/codaris/PofoManager), `Documentation/protocol.md` and `Arduino/Portfolio.ino` | Apache-2.0 |

The original protocol write-up was authored by Klaus Peichl (2006) and
published on [PofoWiki](http://www.pofowiki.de/). The implementation in this
project is original — both sources contributed an understanding of the
behaviour, not code.

The code is **reimplemented, not copied** — but the algorithms, constant
tables, and register layouts come from the files above, so the license
applies and is reproduced below. The full text is also available from
within the app: Help → Sources and credits → BSD-3-Clause.

MAME is a registered trademark of Gregory Ember. The name is used here
solely to identify the origin of the reconstructed work; this project is
not affiliated with or endorsed by the MAME project.

## License

The whole project is under **BSD-3-Clause** — the full text, along with
third-party components and notes on what's *not* part of this repository,
is in [LICENSE](LICENSE).

This is the most permissive license compatible with the code used. Clauses 1
and 2 of BSD-3-Clause require keeping the notice, the list of conditions,
and the disclaimer, so attribution-free licenses (MIT-0, 0BSD, CC0,
Unlicense, public domain) are ruled out for this project as a whole.

### Copyright notices

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

These files' headers give the rights holders without years. The MAME
project as a whole carries the notice `Copyright (c) 1997-2026 MAMEDev and
contributors`.

The CPU core (`js/emu/cpu8088.js`, `js/emu/cpu8088-decode.js`) is a port of the 808x core
of [MartyPC](https://github.com/dbalsom/martypc), under the MIT licence, which is
compatible with BSD-3-Clause; the full MIT text is in [LICENSE](LICENSE).

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
