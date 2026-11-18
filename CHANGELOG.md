# Changelog

*(Polish version: [CHANGELOG-PL.MD](CHANGELOG-PL.MD).)*

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). An entry
is marked by a version number, by the date the change reached the main branch, and
by the short commit hash. The hash arrives one entry late, because a commit cannot
know its own.

## 1.02 — 2026-11-20

### Added

- **Recording.** A new **Recording** button on the toolbar saves the emulator's picture
  and sound to a video file straight from the page, with no screen-capture software. The
  frame is either the screen in its case or the screen alone, at the panel's own
  resolution with the dot grid, contrast and inertia exactly as shown, and without the
  cursor or any of the page around it. While recording, the button shows the elapsed time
  and a click on it ends the recording and downloads the file: WebM in Chrome, Edge and
  Firefox, MP4 in Safari. Sound is recorded as heard, and can be switched on halfway
  through. The zoom is locked while a recording runs.

### Fixed

- **The Portfolio's clock is the NMI, and the Diary's alarms ring.** The clock tick was
  raised as a maskable interrupt with vector `08h`, as in MAME; on a Portfolio it is the
  non-maskable one. The ROM's NMI handler calls `INT 08h` itself and then does what
  `INT 08h` does not: it rings a due alarm, counts down to the automatic power-off and
  calls `INT 1Ch`. All of that used to be skipped, so a Diary alarm never sounded — and
  since the BIOS leaves that maskable interrupt disabled, the time at the prompt mostly
  stood still: five minutes of `TIME` came out as three, and in the page, where the clock
  box also started cleared, the time barely moved at all. Now the time keeps step with
  the machine, and an alarm set in the Diary rings, shows its window with the entry, and
  does so even with the machine switched off — it switches itself on, as the hardware
  does. At the slow clock rate an alarm rings at the tick that finds it within the next
  70 seconds, up to a minute early or late; that is the ROM's own arithmetic. Thanks to
  the forum user who pointed this out, along with the next three items.
- **Ports `8040h` and `8041h`.** `8040h` reads the number of 2 Hz ticks since the last
  clock NMI, which the BIOS adds to the time it keeps in memory; `8041h` has two bits,
  saying whether the machine came on for a key or for the clock, and reading it
  acknowledges the NMI. Both used to be read as one 16-bit counter.
- **The clock keeps going in OFF mode.** Every 128 seconds it wakes the BIOS for a few
  milliseconds to move the time on and look at the alarm, then the machine goes back
  off; the page stays dark throughout. Up to 1.00 the time stopped while the machine
  was off.
- **Pulling a card out mid-read raises `INT 15h`.** Taking the card out of slot `A:`
  while the BIOS is reading it now ends the read with `Data error reading drive A:`,
  through the ROM's own handler, instead of the read carrying on from a card that is
  no longer there. At the prompt nothing happens, as before. Slot `B:` does not raise it.
- **The Inspector's port log could not be seen working.** With the window open no key
  reached the Portfolio, and a machine waiting at the prompt touches no port, so the log
  only ever said that there had been no accesses. Keys now go to the Portfolio with the
  Inspector open, except while the cursor stands in one of its text fields; `Esc` closes
  the window. The first line of the log no longer shows a negative number of cycles.
- **Raw ROM images shorter than a card.** A ROM extension like the one in the Atari
  technical handbook is a few hundred bytes. Loaded through *Load image…*, it used to
  repeat every few hundred bytes across the card window, so a program reading past its end
  found its own start again. Such an image is now padded with `FFh` up to the chip it would
  be burnt into (32, 64, 128 or 256 KB), which is what unprogrammed EPROM space reads as. A
  short card already stored in the browser is padded when the page loads. The card dialog
  now names such a card as a ROM extension with its signature word, instead of reporting an
  unrecognised format.

### Changed

- **The automatic power-off is the BIOS's.** It used to be modelled as a timer in the
  ASIC; the countdown is in fact in the ROM's NMI handler, and it ends in OFF mode, the
  same one the `OFF` command enters. Nothing changes in how it looks — the screen goes
  dark after 128–256 seconds without a key and any key brings the session back — but
  the setting is now called **System → Automatic power-off**, its longer options are
  stated correctly (about 6–9 and 15–17 minutes), and the clock goes on running while
  the machine is off. **System → Portfolio clock**, formerly *System clock tick*, stops
  the whole clock, the time and the alarms included. It is now ticked by default.

### Note for users

- The clock box used to start cleared, and most saved settings carry that without anyone
  having chosen it, so the earlier choice is not carried over: the clock starts ticked.
  Clear it again if you really want the time to stand still.
- A state snapshot saved with 1.00 loads as before. A machine saved while it
  was asleep comes back awake, at the prompt. The clock and power-off settings are the
  page's current ones, not those saved in the snapshot.

## 1.00 — 2026-11-11 — `9d72f4f`

The first public release.

### Added

- **An Atari Portfolio in the browser.** Plain JavaScript and ES modules, no build step
  and no server-side code: the original ROM boots to the DIP-DOS 2.11 prompt, with the
  built-in applications, the keyboard, auto-repeat, sound and power management (standby,
  the OFF command, a cold start). The ROM files are your own; they are read on your
  machine and remembered in the browser.
- **A CPU counted clock by clock.** The 8088 core is a port of the one in MartyPC, checked
  against SingleStepTests recordings and against several hundred timings measured on a real
  Portfolio, which the test suite holds as references.
- **The screen as the panel shows it.** The HD61830 controller with its timing, the
  contrast register, the panel's inertia with a choice of four rise shapes, the dot grid,
  and case artwork at four zoom levels.
- **Memory cards.** Cards in slot A: - created, loaded, downloaded and edited file by file
  from the page - and a second slot B: with the HPC-104 memory expansion. A card can be a
  ROM extension or boot the machine.
- **An EPROM card page** (`eprom.html`), which builds a 128 KB to 1 MB image for the
  programmer from files and folders, one bank of 128 KB per drive, in the layout of the
  Atari ST converter the cards were made with.
- **The expansion port.** The HPC-101 parallel interface with printing to a file and the
  Portfolio's file transfer protocol, and the HPC-102 serial interface - a terminal, a real
  RS-232 port through Web Serial, a virtual modem with tone dialling, and a null-modem link
  between two browser tabs.
- **Machine state.** Three snapshot slots in the browser and a `.pofostate` file, carrying
  the whole machine - the CPU midway through an instruction, the screen, the cards, the
  fitted hardware - while the battery-backed memory with drive C: saves itself.
- **An inspector** with registers, disassembly, memory, a port log, breakpoints on
  addresses and ports, and stepping; and a view of `PERMDATA.DAT`, what the Portfolio
  remembers about itself.
- **Polish and English**, switched live, with questions and notices in the page's own
  dialog, dates always written YYYY-MM-DD and numbers always with a decimal point.
- **A test suite** run from Node (`node tools/run-tests.mjs`), with the emulator core
  available headless in `tools/pofo-headless.mjs`.
