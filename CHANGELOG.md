# Changelog

*(Polish version: [CHANGELOG-PL.MD](CHANGELOG-PL.MD).)*

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). An entry
is marked by a version number, by the date the change reached the main branch, and
by the short commit hash. The hash arrives one entry late, because a commit cannot
know its own.

## 1.00 — 2026-11-11

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
