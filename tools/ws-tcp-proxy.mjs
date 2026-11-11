// WebSocket -> TCP bridge for Portfoliator's virtual modem.
//
// The browser cannot open a raw TCP socket, so ATDT has to go through
// something. This is that something: a dependency-free Node server that accepts
// a WebSocket, opens a TCP connection to the requested host and port, and pipes
// bytes both ways.
//
//   node tools/ws-tcp-proxy.mjs --allow bbs.example.com:23,localhost:23
//
// Then in Portfoliator: Port szeregowy -> Wirtualny modem, template
//   ws://localhost:8081/?host={host}&port={port}
// and dial ATDT bbs.example.com:23 from terminal software on the Portfolio.
//
// Port 23 is telnet, not a raw byte pipe: the far end opens with IAC option
// negotiation (FF FB 03 ...) that a 1989 terminal program has never heard of
// and would print as garbage, and some boards wait for an answer before
// showing anything. So the bytes are run through an NVT filter by default;
// --telnet off turns it back into a dumb pipe for non-telnet services.
//
// SECURITY: a proxy that will connect anywhere is an open relay into whatever
// network it runs on - anyone who can reach it can reach your LAN, your
// localhost services and cloud metadata endpoints. There is therefore no
// "allow everything" default: without --allow nothing is reachable. Bind it to
// the loopback interface unless you have a reason not to.

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const PORT = Number(args.get('port') || 8081);
const HOST = args.get('bind') || '127.0.0.1';
const TELNET = (args.get('telnet') || 'on').toLowerCase() !== 'off';
const TERM = args.get('term') || 'ASCII';
const ASCII = (args.get('ascii') || 'on').toLowerCase() !== 'off';
const ALLOW = (args.get('allow') || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (ALLOW.length === 0) {
  console.error('Nie podano --allow, więc nic nie jest osiągalne.');
  console.error('Przykład: node tools/ws-tcp-proxy.mjs --allow localhost:23,bbs.example.com:23');
  process.exit(1);
}

const allowed = (host, port) =>
  ALLOW.includes(`${host.toLowerCase()}:${port}`) || ALLOW.includes(`${host.toLowerCase()}:*`);

// ---- minimal RFC 6455 -------------------------------------------------------

/** Frames a payload as a single unfragmented server-to-client message. */
function encodeFrame(payload, opcode = 0x02) {
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Pulls whole frames out of a growing buffer. Returns the frames found and the
 * bytes that did not make up a complete frame yet.
 */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  for (;;) {
    if (buffer.length - offset < 2) break;

    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0F;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7F;
    let cursor = offset + 2;

    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    let mask = null;
    if (masked) {
      if (buffer.length < cursor + 4) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (buffer.length < cursor + length) break;

    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

    frames.push({ opcode, payload });
    offset = cursor + length;
  }

  return { frames, rest: buffer.subarray(offset) };
}

// ---- telnet NVT -------------------------------------------------------------

const SE = 240, SB = 250, WILL = 251, WONT = 252, DO = 253, DONT = 254, IAC = 255;
const OPT_BINARY = 0, OPT_ECHO = 1, OPT_SGA = 3, OPT_TTYPE = 24, OPT_NAWS = 31;
const TTYPE_IS = 0, TTYPE_SEND = 1;

// What the Portfolio can honestly claim, and what it is happy for the far end
// to do. Character-at-a-time with remote echo is what every BBS expects, and it
// is also the only thing a dumb terminal program can cope with.
const WE_WILL = new Set([OPT_TTYPE, OPT_NAWS, OPT_SGA, OPT_BINARY]);
const THEY_MAY = new Set([OPT_ECHO, OPT_SGA, OPT_BINARY]);

// The Portfolio LCD, in the units NAWS speaks.
const COLS = 40, ROWS = 8;

/**
 * Speaks telnet on the Portfolio's behalf.
 *
 * Option negotiation is answered here and stripped from the stream, so the
 * terminal program on the other side of the modem only ever sees the text. The
 * agreed state of each option is remembered, because RFC 854 loop prevention is
 * exactly that: never answer with what you already said.
 */
class TelnetFilter {
  /** @param {(bytes:Buffer)=>void} reply sends bytes back to the telnet host */
  constructor(reply) {
    this.reply = reply;
    this.state = 'data';
    this.cmd = 0;
    this.sub = [];
    this.local = new Map();   // option -> did we say WILL
    this.remote = new Map();  // option -> did we say DO
  }

  /** Host -> Portfolio: returns the payload with all telnet chatter removed. */
  fromHost(chunk) {
    const out = [];

    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) this.state = 'iac';
          else out.push(byte);
          break;

        case 'iac':
          if (byte === IAC) { out.push(IAC); this.state = 'data'; }
          else if (byte >= WILL && byte <= DONT) { this.cmd = byte; this.state = 'option'; }
          else if (byte === SB) { this.sub = []; this.state = 'sub'; }
          else this.state = 'data';   // NOP, GA, DM and friends: nothing to say
          break;

        case 'option':
          this.negotiate(this.cmd, byte);
          this.state = 'data';
          break;

        case 'sub':
          if (byte === IAC) this.state = 'subiac';
          else if (this.sub.length < 64) this.sub.push(byte);
          break;

        case 'subiac':
          if (byte === SE) { this.subnegotiate(); this.state = 'data'; }
          else { if (byte === IAC) this.sub.push(IAC); this.state = 'sub'; }
          break;
      }
    }

    return Buffer.from(out);
  }

  /** Portfolio -> host: a literal FF has to be doubled to survive the wire. */
  toHost(chunk) {
    if (!chunk.includes(IAC)) return chunk;
    const out = [];
    for (const byte of chunk) {
      out.push(byte);
      if (byte === IAC) out.push(IAC);
    }
    return Buffer.from(out);
  }

  send(...bytes) { this.reply(Buffer.from(bytes)); }

  negotiate(cmd, option) {
    if (cmd === DO || cmd === DONT) {
      const agree = cmd === DO && WE_WILL.has(option);
      if (this.local.get(option) === agree) return;
      this.local.set(option, agree);
      this.send(IAC, agree ? WILL : WONT, option);
      // A window size is only useful once someone has asked for it.
      if (agree && option === OPT_NAWS) {
        this.send(IAC, SB, OPT_NAWS, 0, COLS, 0, ROWS, IAC, SE);
      }
      return;
    }

    const agree = cmd === WILL && THEY_MAY.has(option);
    if (this.remote.get(option) === agree) return;
    this.remote.set(option, agree);
    this.send(IAC, agree ? DO : DONT, option);
  }

  subnegotiate() {
    const [option, verb] = this.sub;
    if (option === OPT_TTYPE && verb === TTYPE_SEND) {
      this.reply(Buffer.concat([
        Buffer.from([IAC, SB, OPT_TTYPE, TTYPE_IS]),
        Buffer.from(TERM, 'latin1'),
        Buffer.from([IAC, SE]),
      ]));
    }
  }
}

// ---- ANSI stripping ---------------------------------------------------------

/**
 * Folds an ANSI stream down to plain text.
 *
 * Reporting ASCII as the terminal type does not help: both Mystic and
 * Synchronet ignore it and probe instead, parking the cursor at 255,255 and
 * asking where it landed (`ESC[s ESC[255B ESC[255C ESC[6n ESC[u`). ACOM never
 * answers, so a board that waits for the reply does fall back on its own - but
 * the pre-login screen has already gone out in full colour by then, and ACOM
 * prints the escapes literally, as `[0;1;40;36m` sprayed through the text.
 *
 * So the sequences are cut here instead. Bytes above 7Fh are left alone: the
 * Portfolio's character generator is CP437, so block and line-drawing
 * characters really do render - the art is only ever mangled by the 40-column
 * screen, which nothing at this end can fix.
 */
class AnsiFilter {
  constructor() { this.state = 'data'; this.run = 0; }

  filter(chunk) {
    if (this.state === 'data' && !chunk.includes(0x1B)) return chunk;

    const out = [];

    for (const byte of chunk) {
      // A sequence this long is not a sequence; something is out of step and
      // swallowing the rest of the stream would be worse than a stray glyph.
      if (this.state !== 'data' && ++this.run > 64) this.state = 'data';

      switch (this.state) {
        case 'data':
          if (byte === 0x1B) { this.state = 'esc'; this.run = 0; }
          else out.push(byte);
          break;

        case 'esc':
          if (byte === 0x5B) this.state = 'csi';                       // ESC [
          else if (byte === 0x5D) this.state = 'osc';                  // ESC ]
          else if (byte === 0x23 || (byte >= 0x28 && byte <= 0x2B)) this.state = 'skip1';
          else this.state = 'data';                                    // two-byte escape
          break;

        case 'csi':
          if (byte >= 0x40 && byte <= 0x7E) this.state = 'data';
          break;

        case 'osc':
          if (byte === 0x07) this.state = 'data';                       // BEL
          else if (byte === 0x1B) this.state = 'oscesc';
          break;

        case 'oscesc':
          this.state = byte === 0x5C ? 'data' : 'osc';                  // ESC \ = ST
          break;

        case 'skip1':
          this.state = 'data';
          break;
      }
    }

    return Buffer.from(out);
  }
}

// ---- server -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Portfoliator WebSocket->TCP proxy\nDozwolone cele: ${ALLOW.join(', ')}\n`);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host') || '';
  const port = Number(url.searchParams.get('port') || 23);
  const key = req.headers['sec-websocket-key'];

  const refuse = (why) => {
    console.log(`odmowa: ${host}:${port} - ${why}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  };

  if (!key) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
  if (!host || !Number.isInteger(port)) { refuse('brak celu'); return; }
  if (!allowed(host, port)) { refuse('cel spoza listy --allow'); return; }

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);

  console.log(`połączenie -> ${host}:${port}${TELNET ? ' (telnet)' : ' (raw)'}`);
  const remote = net.connect({ host, port });
  const telnet = TELNET ? new TelnetFilter((bytes) => remote.write(bytes)) : null;
  const ansi = ASCII ? new AnsiFilter() : null;
  let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;

  const shutdown = () => {
    if (closed) return;
    closed = true;
    remote.destroy();
    socket.destroy();
    console.log(`rozłączono ${host}:${port}`);
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = decodeFrames(buffer);
    buffer = rest;

    for (const frame of frames) {
      if (frame.opcode === 0x08) { shutdown(); return; }
      if (frame.opcode === 0x09) { socket.write(encodeFrame(frame.payload, 0x0A)); continue; }
      if (frame.opcode === 0x01 || frame.opcode === 0x02) {
        remote.write(telnet ? telnet.toHost(frame.payload) : frame.payload);
      }
    }
  });

  remote.on('data', (chunk) => {
    let payload = telnet ? telnet.fromHost(chunk) : chunk;
    if (ansi && payload.length) payload = ansi.filter(payload);
    // A chunk that was nothing but negotiation or colour leaves nothing to send.
    if (payload.length) socket.write(encodeFrame(payload));
  });
  remote.on('error', (err) => { console.log(`błąd TCP ${host}:${port}: ${err.message}`); shutdown(); });
  remote.on('close', shutdown);
  socket.on('error', shutdown);
  socket.on('close', shutdown);
});

server.listen(PORT, HOST, () => {
  console.log(`Proxy słucha na ws://${HOST}:${PORT}/`);
  console.log(`Dozwolone cele: ${ALLOW.join(', ')}`);
  console.log(TELNET ? `Telnet: włączony, terminal zgłaszany jako ${TERM}.` : 'Telnet: wyłączony (surowy TCP).');
  console.log(ASCII ? 'Tryb ASCII: sekwencje ANSI wycinane.' : 'Tryb ASCII: wyłączony, ANSI przepuszczane.');
});
