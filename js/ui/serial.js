// Host side of the HPC-102 serial port.
//
// The emulated UART lives in the worker; everything here is about what sits at
// the other end of the cable. Four ends are offered:
//
//   terminal    a text console in the page - you type, the Portfolio sees it
//   webserial   navigator.serial, i.e. a real RS-232 port on this machine
//   modem       an AT-command modem that dials WebSocket endpoints
//   peer        another browser tab running its own Portfolio
//
// Whatever the backend, every byte in both directions is also fed to a monitor
// so the terminal view doubles as a line sniffer.

import { t } from './i18n.js';

const encoder = new TextEncoder();

// How long the virtual modem waits for a WebSocket to come up before reporting
// NO CARRIER, in the spirit of a real modem's S7 register.
const DIAL_TIMEOUT_MS = 20000;

/** Minimal terminal buffer: enough for DOS output and plain-text BBS traffic. */
export class TextScreen {
  constructor(maxLines = 600) {
    this.maxLines = maxLines;
    this.lines = [''];
    this.col = 0;
    this.esc = '';           // partial escape sequence carried between chunks
  }

  clear() { this.lines = ['']; this.col = 0; this.esc = ''; }

  write(bytes) {
    for (const byte of bytes) {
      const ch = String.fromCharCode(byte);

      // Swallow ANSI/VT sequences rather than printing their bracket soup.
      if (this.esc) {
        this.esc += ch;
        // CSI runs until a byte in the 0x40-0x7E range; anything else is a
        // two-character sequence.
        if (this.esc.length === 2 && ch !== '[') this.esc = '';
        else if (this.esc.length > 2 && byte >= 0x40 && byte <= 0x7E) this.esc = '';
        else if (this.esc.length > 32) this.esc = '';
        continue;
      }

      switch (byte) {
        case 0x1B: this.esc = '\x1B'; break;
        case 0x0A: this.newline(); break;
        case 0x0D: this.col = 0; break;
        case 0x08: if (this.col > 0) this.col--; break;
        case 0x09: this.put(' '.repeat(8 - (this.col % 8))); break;
        case 0x07: break;                                    // bell
        case 0x00: break;
        default:
          this.put(byte < 32 || byte === 0x7F ? '·' : ch);
      }
    }
  }

  put(text) {
    const line = this.lines[this.lines.length - 1];
    const padded = line.length < this.col ? line + ' '.repeat(this.col - line.length) : line;
    this.lines[this.lines.length - 1] =
      padded.slice(0, this.col) + text + padded.slice(this.col + text.length);
    this.col += text.length;
  }

  newline() {
    this.lines.push('');
    this.col = 0;
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }

  toString() { return this.lines.join('\n'); }
}

/**
 * True when the byte at `i` closes a line: LF, or a CR that is followed by
 * something other than LF. A CR sitting at the end of what we can see does not
 * count - the LF completing the pair may still be on its way, and charging the
 * line pause for both halves would double it.
 */
function endsLine(bytes, i) {
  if (bytes[i] === 0x0A) return true;
  return bytes[i] === 0x0D && i + 1 < bytes.length && bytes[i + 1] !== 0x0A;
}

// ---- backends ---------------------------------------------------------------

class Backend {
  constructor(hub) { this.hub = hub; }
  async open() {}
  async close() {}
  /** Bytes the Portfolio put on the line. */
  write() {}
}

/** Nothing on the far end but the terminal view itself. */
class TerminalBackend extends Backend {
  async open() { this.hub.status(() => t('Terminal podłączony. Pisz w polu poniżej — znaki idą do Portfolio.')); }
}

/**
 * A real serial port on the host machine. The API is window-only in Chrome, so
 * the port is opened here and bytes are relayed to the worker by message.
 */
class WebSerialBackend extends Backend {
  static get available() { return typeof navigator !== 'undefined' && 'serial' in navigator; }

  async open(opts) {
    if (!WebSerialBackend.available) {
      throw new Error(t('Ta przeglądarka nie ma Web Serial API (potrzebny Chrome lub Edge, przez HTTPS albo localhost).'));
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: opts.baudRate || 9600,
      dataBits: opts.dataBits || 8,
      stopBits: opts.stopBits || 1,
      parity: opts.parity || 'none',
      flowControl: 'none',
    });

    this.writer = this.port.writable.getWriter();
    this.openedBaud = opts.baudRate;
    this.reading = this.readLoop();

    const info = this.port.getInfo ? this.port.getInfo() : {};
    const id = (info.usbVendorId !== undefined)
      ? ` (USB ${info.usbVendorId.toString(16)}:${info.usbProductId.toString(16)})`
      : '';
    this.hub.status(() => t('Port sprzętowy otwarty{0}, {1} baud.', id, opts.baudRate), 'ok');
  }

  async readLoop() {
    this.reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length) this.hub.toPortfolio(value);
      }
    } catch (err) {
      this.hub.status(() => t('Port sprzętowy: {0}', err.message), 'warn');
    } finally {
      try { this.reader.releaseLock(); } catch { /* already gone */ }
    }
  }

  async close() {
    try { if (this.reader) await this.reader.cancel(); } catch { /* ignore */ }
    try { if (this.writer) this.writer.releaseLock(); } catch { /* ignore */ }
    try { if (this.port) await this.port.close(); } catch { /* ignore */ }
    this.port = this.writer = this.reader = null;
  }

  write(bytes) {
    if (this.writer) this.writer.write(bytes).catch((err) => this.hub.status(() => t('Zapis: {0}', err.message), 'warn'));
  }
}

/**
 * A Hayes-style modem. Commands are answered locally; ATD opens a WebSocket and
 * from then on the line is transparent until +++ or a dropped connection.
 *
 * The dial string is substituted into a template, so `ATDT bbs.example.com:23`
 * becomes whatever proxy URL the user configured. A dial string that already
 * looks like a URL is used as-is.
 */
class ModemBackend extends Backend {
  async open(opts) {
    this.template = opts.dialTemplate || 'ws://localhost:8081/?host={host}&port={port}';
    this.line = '';
    this.online = false;
    this.echo = true;
    this.verbose = true;
    this.socket = null;
    this.plusCount = 0;
    this.lastByteAt = 0;
    this.hub.status(() => t('Wirtualny modem gotowy. W Portfolio uruchom terminal i wpisz np. ATDT host:port.'));
    this.reply('');
  }

  async close() {
    this.hangup(false);
  }

  // ---- towards the Portfolio ----------------------------------------------

  reply(text) {
    if (!text) return;
    this.hub.toPortfolio(encoder.encode('\r\n' + text + '\r\n'));
  }

  ok() { this.reply(this.verbose ? 'OK' : '0'); }
  error() { this.reply(this.verbose ? 'ERROR' : '4'); }

  // ---- from the Portfolio --------------------------------------------------

  write(bytes) {
    if (this.online) { this.dataMode(bytes); return; }

    for (const byte of bytes) {
      if (this.echo) this.hub.toPortfolio(Uint8Array.of(byte));

      if (byte === 0x0D) {
        const cmd = this.line.trim();
        this.line = '';
        if (cmd) this.command(cmd);
        continue;
      }
      if (byte === 0x08) { this.line = this.line.slice(0, -1); continue; }
      if (byte >= 32 && byte < 127) this.line += String.fromCharCode(byte);
      if (this.line.length > 120) this.line = '';
    }
  }

  /** In data mode everything passes through, except the +++ escape. */
  dataMode(bytes) {
    const now = performance.now();
    for (const byte of bytes) {
      if (byte === 0x2B && now - this.lastByteAt > 400) {
        this.plusCount++;
        if (this.plusCount === 3) {
          this.online = false;
          this.plusCount = 0;
          this.reply(this.verbose ? 'OK' : '0');
          this.hub.status(() => t('Modem: powrót do trybu komend (połączenie trzymane).'));
          return;
        }
      } else {
        this.plusCount = 0;
      }
    }
    this.lastByteAt = now;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(bytes);
  }

  command(text) {
    const upper = text.toUpperCase();
    if (!upper.startsWith('AT')) { this.error(); return; }

    const body = text.slice(2);
    const upperBody = upper.slice(2);

    if (upperBody === '') { this.ok(); return; }
    if (upperBody === 'Z' || upperBody === '&F') { this.echo = true; this.verbose = true; this.ok(); return; }
    if (upperBody === 'I' || upperBody === 'I0') { this.reply('Portfoliator virtual modem'); this.ok(); return; }
    if (upperBody === 'E0') { this.echo = false; this.ok(); return; }
    if (upperBody === 'E1' || upperBody === 'E') { this.echo = true; this.ok(); return; }
    if (upperBody === 'V0') { this.verbose = false; this.ok(); return; }
    if (upperBody === 'V1' || upperBody === 'V') { this.verbose = true; this.ok(); return; }
    if (upperBody === 'H' || upperBody === 'H0') { this.hangup(true); return; }
    if (upperBody === 'O' || upperBody === 'O0') {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) { this.online = true; this.reply('CONNECT'); }
      else this.reply(this.verbose ? 'NO CARRIER' : '3');
      return;
    }
    if (upperBody[0] === 'D') {
      // ATD, ATDT, ATDP - the dial modifier is noise here.
      this.dial(body.slice(1).replace(/^[TPtp]/, '').trim());
      return;
    }
    // Everything else (ATS0=1, AT&C1, ATX4...) is accepted and ignored, which
    // is what terminal software expects from a modem it does not know.
    this.ok();
  }

  dial(target) {
    if (!target) { this.error(); return; }
    this.hangup(false);

    let url;
    if (/^wss?:\/\//i.test(target)) {
      url = target;
    } else {
      const [host, port = '23'] = target.split(':');
      url = this.template.replace('{host}', encodeURIComponent(host)).replace('{port}', encodeURIComponent(port));
    }

    this.hub.status(() => t('Modem dzwoni: {0}', url));

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      this.reply(this.verbose ? 'NO CARRIER' : '3');
      this.hub.status(() => t('Modem: {0}', err.message), 'warn');
      return;
    }

    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    // NO CARRIER has to be reported exactly once, and every way a WebSocket can
    // end has to lead here. A refused handshake fires only `error` in some
    // runtimes and only `close` in others, and one that is quietly dropped fires
    // neither - hence the timeout as well. Real modems give up too (register S7).
    let settled = false;
    const noCarrier = (why) => {
      if (settled || this.socket !== socket) return;
      settled = true;
      clearTimeout(giveUp);
      this.socket = null;
      this.online = false;
      try { socket.close(); } catch { /* already gone */ }
      this.hub.setModem({ dcd: false });
      this.reply(this.verbose ? 'NO CARRIER' : '3');
      this.hub.status(() => t('Modem: {0}', why), 'warn');
    };

    const giveUp = setTimeout(() => noCarrier('brak odpowiedzi z drugiej strony.'), DIAL_TIMEOUT_MS);

    socket.onopen = () => {
      clearTimeout(giveUp);
      this.online = true;
      this.hub.setModem({ dcd: true });
      this.reply(this.verbose ? 'CONNECT 9600' : '1');
      this.hub.status(() => t('Modem: połączony.'), 'ok');
    };

    socket.onmessage = (e) => {
      const data = typeof e.data === 'string' ? encoder.encode(e.data) : new Uint8Array(e.data);
      this.hub.toPortfolio(data);
    };

    socket.onerror = () => noCarrier(t('nie udało się zestawić połączenia.'));
    socket.onclose = () => noCarrier(t('rozłączony.'));
  }

  hangup(announce) {
    const socket = this.socket;
    this.socket = null;
    this.online = false;
    if (socket) { socket.onclose = null; socket.close(); }
    this.hub.setModem({ dcd: false });
    if (announce) this.ok();
  }
}

/**
 * A null-modem cable between two browser tabs. Both ends run their own
 * Portfolio; whatever one transmits, the other receives.
 */
class PeerBackend extends Backend {
  async open(opts) {
    this.channel = new BroadcastChannel(opts.channel || 'portfoliator-serial');
    this.id = Math.random().toString(36).slice(2, 8);
    this.peers = new Set();

    this.channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.from === this.id) return;

      if (msg.kind === 'hello') {
        this.peers.add(msg.from);
        this.channel.postMessage({ kind: 'here', from: this.id });
        this.announce();
      } else if (msg.kind === 'here') {
        this.peers.add(msg.from);
        this.announce();
      } else if (msg.kind === 'bye') {
        this.peers.delete(msg.from);
        this.announce();
      } else if (msg.kind === 'data') {
        this.hub.toPortfolio(new Uint8Array(msg.data));
      }
    };

    this.channel.postMessage({ kind: 'hello', from: this.id });
    this.announce();
  }

  announce() {
    this.hub.status(this.peers.size
      ? () => t('Kabel null-modem: {0} drugi koniec podłączony (ta karta: {1}).', this.peers.size, this.id)
      : () => t('Kabel null-modem: czekam na drugą kartę na kanale (ta karta: {0}).', this.id),
      this.peers.size ? 'ok' : '');
  }

  async close() {
    if (!this.channel) return;
    this.channel.postMessage({ kind: 'bye', from: this.id });
    this.channel.close();
    this.channel = null;
  }

  write(bytes) {
    if (this.channel) this.channel.postMessage({ kind: 'data', from: this.id, data: bytes });
  }
}

const BACKENDS = {
  terminal: TerminalBackend,
  webserial: WebSerialBackend,
  modem: ModemBackend,
  peer: PeerBackend,
};

// ---- the hub ----------------------------------------------------------------

export class SerialHub {
  /**
   * @param {object} io
   * @param {(bytes:Uint8Array)=>void} io.send        hand bytes to the emulated UART
   * @param {(lines:object)=>void}     io.setModem    drive CTS/DSR/DCD/RI
   * @param {()=>void}                 io.onUpdate    the screen or status changed
   */
  constructor(io) {
    this.io = io;
    this.screen = new TextScreen();
    this.backend = null;
    this.kind = 'terminal';
    this.statusText = () => t('Rozłączony.');
    this.statusKind = '';
    this.capture = [];
    this.capturing = false;
    this.rxBytes = 0;
    this.txBytes = 0;
    this.txDelayChar = 0;
    this.txDelayLine = 0;
    this.outQueue = null;
    this.outTimer = 0;
    this.job = null;
  }

  static get webSerialAvailable() { return WebSerialBackend.available; }

  /**
   * Reports the state of the line.
   *
   * The message is a function rather than a finished string, because the page
   * can change language under it: the host redraws the status bar from whatever
   * is stored here, and a string frozen in the old language would survive the
   * switch untouched. Plain strings are still accepted for anything that is not
   * translated - a device name the browser handed us, say.
   *
   * @param {(() => string)|string} text
   */
  status(text, kind = '') {
    this.statusText = text;
    this.statusKind = kind;
    this.io.onUpdate();
  }

  /** The message as it should read right now. */
  get statusLine() {
    return typeof this.statusText === 'function' ? this.statusText() : this.statusText;
  }

  setModem(lines) { this.io.setModem(lines); }

  /** Bytes going to the Portfolio's receiver. */
  toPortfolio(bytes) {
    if (!bytes || !bytes.length) return;
    this.txBytes += bytes.length;
    this.io.send(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
    this.io.onUpdate();
  }

  /** Bytes the Portfolio transmitted. */
  fromPortfolio(bytes) {
    if (!bytes || !bytes.length) return;
    this.rxBytes += bytes.length;
    this.screen.write(bytes);
    if (this.capturing) for (const b of bytes) this.capture.push(b);
    this.writeOut(bytes);
    this.io.onUpdate();
  }

  /**
   * Bytes put straight onto the cable, without the local Portfolio's involvement.
   * Needed whenever the far end is what has to be fed - a real Portfolio sitting
   * in COPY AUX has no button of its own to press.
   */
  sendToLine(bytes) {
    if (!bytes || !bytes.length) return false;
    if (!this.backend) { this.status(() => t('Najpierw podłącz drugi koniec kabla.'), 'warn'); return false; }
    this.writeOut(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
    this.io.onUpdate();
    return true;
  }

  // ---- outbound pacing ------------------------------------------------------

  /**
   * How slowly to feed the far end, in milliseconds. Real hardware needs this:
   * the 82C50A on the HPC-102 holds one byte and DIP-DOS polls it by hand, so a
   * gapless stream at full line rate overruns it while it is busy writing to
   * disk. Both zero - the default - means no queue and no timers at all.
   */
  setTxDelay(perChar, perLine) {
    this.txDelayChar = Math.max(0, perChar | 0);
    this.txDelayLine = Math.max(0, perLine | 0);
    if (!this.txDelayChar && !this.txDelayLine) this.flushOut();
    this.io.onUpdate();
  }

  /** Bytes still waiting for their turn on the wire. */
  get pendingBytes() { return this.outQueue ? this.outQueue.length : 0; }

  /**
   * Queues a block and tracks how much of it has actually reached the backend,
   * so the caller can draw a progress bar. The queue length alone cannot answer
   * that: the emulated Portfolio keeps pushing its own bytes in behind ours
   * while the send runs, and a send can start on a queue that is not empty.
   *
   * @param {(done:number, total:number)=>void} onProgress called on every step
   */
  sendJob(bytes, onProgress) {
    if (!this.backend) { this.status(() => t('Najpierw podłącz drugi koniec kabla.'), 'warn'); return false; }
    if (this.job) { this.status(() => t('Poprzednia wysyłka jeszcze trwa.'), 'warn'); return false; }

    this.job = { total: bytes.length, left: bytes.length, ahead: this.pendingBytes, onProgress };
    this.writeOut(bytes);
    this.io.onUpdate();
    return true;
  }

  /** Drops what is left of the running send. Returns the bytes thrown away. */
  cancelJob() {
    const job = this.job;
    this.job = null;
    if (!job) return 0;

    const dropped = this.outQueue ? this.outQueue.splice(job.ahead, job.left).length : 0;
    this.io.onUpdate();
    return dropped;
  }

  /** Books `n` bytes that just left, against the running send if there is one. */
  creditJob(n) {
    const job = this.job;
    if (!job) return;

    const skip = Math.min(n, job.ahead);
    job.ahead -= skip;

    const moved = n - skip;
    if (!moved) return;      // still draining what was already queued ahead of us

    job.left = Math.max(0, job.left - moved);
    if (!job.left) this.job = null;
    job.onProgress(job.total - job.left, job.total);
  }

  /** Everything the far end is meant to receive passes through here. */
  writeOut(bytes) {
    if (!this.backend) return;

    if (!this.txDelayChar && !this.txDelayLine) {
      this.backend.write(bytes);
      this.creditJob(bytes.length);
      return;
    }

    if (!this.outQueue) this.outQueue = [];
    for (const b of bytes) this.outQueue.push(b);
    if (!this.outTimer) this.pump();
  }

  /**
   * One step of the queue: a single byte when there is a per-character delay,
   * otherwise the whole run up to the next line ending. A CR LF pair must not be
   * charged the line pause twice, so it hangs off the LF, or off a CR standing
   * on its own.
   */
  pump() {
    this.outTimer = 0;
    if (!this.backend || !this.outQueue || !this.outQueue.length) return this.flushOut();

    let taken;
    if (this.txDelayChar) {
      taken = this.outQueue.splice(0, 1);
    } else {
      let n = 0;
      while (n < this.outQueue.length && !endsLine(this.outQueue, n)) n++;
      taken = this.outQueue.splice(0, Math.min(n + 1, this.outQueue.length));
    }

    this.backend.write(Uint8Array.from(taken));
    this.creditJob(taken.length);

    const last = taken.length - 1;
    const wait = this.txDelayChar + (endsLine(taken, last) ? this.txDelayLine : 0);
    this.outTimer = setTimeout(() => this.pump(), Math.max(wait, 1));
    this.io.onUpdate();
  }

  /** Drops the queue and its timer: disconnecting, or pacing switched off. */
  flushOut() {
    if (this.outTimer) { clearTimeout(this.outTimer); this.outTimer = 0; }
    const rest = this.outQueue;
    this.outQueue = null;
    // Bytes already accepted are still owed to the far end, so hand over
    // whatever is left rather than dropping it on the floor.
    if (rest && rest.length && this.backend) {
      this.backend.write(Uint8Array.from(rest));
      this.creditJob(rest.length);
    }
    this.io.onUpdate();
  }

  /** Baud the host port was actually opened at, when there is a real port. */
  get openedBaud() { return this.backend ? this.backend.openedBaud : undefined; }

  async select(kind, opts = {}) {
    await this.disconnect();

    const Klass = BACKENDS[kind];
    if (!Klass) throw new Error(`Nieznany tryb: ${kind}`);

    this.kind = kind;
    const backend = new Klass(this);
    // Only publish the backend once open() succeeds - a failed Web Serial
    // permission prompt must not leave a half-open port collecting bytes.
    await backend.open(opts);
    this.backend = backend;
    this.io.onUpdate();
  }

  async disconnect() {
    if (!this.backend) return;
    const backend = this.backend;
    this.backend = null;      // cleared first, so the queue is dropped, not sent
    this.flushOut();
    this.cancelJob();         // a send in flight has nowhere to go now
    await backend.close();
    this.status(() => t('Rozłączony.'));
  }

  startCapture() { this.capture = []; this.capturing = true; this.io.onUpdate(); }

  stopCapture() {
    this.capturing = false;
    const out = Uint8Array.from(this.capture);
    this.capture = [];
    this.io.onUpdate();
    return out;
  }
}
