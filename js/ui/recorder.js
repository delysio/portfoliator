// Video recording of the emulator's screen, with or without the case around it.
//
// The LCD canvas already holds everything the page shows - the dot grid, the
// contrast ramp, the panel's inertia - in device pixels. Recording it directly
// would be the shortest path, but the case artwork is a CSS background and not
// part of any canvas, and the LCD canvas changes size whenever the zoom or the
// monitor's scaling does. So the recording gets a canvas of its own, sized once
// when it starts, and every repaint of the panel is composited into it: the
// artwork (when asked for) and the panel at the position the page puts it.
//
// Frames are pushed rather than sampled. captureStream() with no rate takes
// a frame whenever the canvas is drawn, so a still picture costs nothing and a
// moving one is captured at the rate the emulator paints it. A slow keepalive
// redraws the last picture now and then, because a stream that stops producing
// frames ends the file at its last change instead of at the Stop button.

/** What a recording frames: the panel in its case, or the panel alone. */
export const FRAMES = ['case', 'screen'];

// First supported wins. WebM is what Chrome, Edge and Firefox record; Safari
// records MP4 only.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
];

// Bits per pixel per second. Sharp-edged pixel art falls apart at the low
// default rates browsers pick, so the rate follows the frame size, with a floor
// for small frames and a ceiling for the big ones.
const BITS_PER_PIXEL = 6;
const MIN_BITRATE = 2_000_000;
const MAX_BITRATE = 12_000_000;

// How often a still picture is drawn again, and how old the last frame has to
// be before it is. Well below a second, so the end of the file lands within
// a fraction of a second of the Stop button.
const KEEPALIVE_MS = 250;

// How often the recorder hands over what it has encoded so far. Small pieces
// keep memory flat; the file is assembled from them at the end.
const SLICE_MS = 1000;

/** Video encoders want even dimensions; one row or column more costs nothing. */
const even = (n) => n + (n & 1);

/**
 * @param {(type: string) => boolean} isSupported MediaRecorder.isTypeSupported
 * @returns {string} the first container and codec the browser can record, or ''
 */
export function pickMimeType(isSupported) {
  for (const type of MIME_CANDIDATES) {
    if (isSupported(type)) return type;
  }
  return '';
}

/** The file extension for a recorded type: mp4 for Safari, webm for the rest. */
export function extensionFor(mime) {
  return /^video\/mp4/.test(mime) ? 'mp4' : 'webm';
}

/** A bit rate that keeps the dots sharp at a given frame size. */
export function bitrateFor(width, height) {
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, Math.round(width * height * BITS_PER_PIXEL)));
}

/** Elapsed recording time as m:ss - minutes are not padded, seconds are. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Where everything goes in the recorded frame.
 *
 * The case is placed in device pixels, the way the browser lays it out on the
 * screen, so the panel's backing store lands on it one to one - which is what
 * keeps the dot grid as sharp in the file as on the page.
 *
 * @param {{frame: string, shell: {w:number,h:number,x:number,y:number,mul:number},
 *          dpr: number, screenW: number, screenH: number}} p
 *   screenW, screenH: the LCD canvas's backing store, in device pixels
 */
export function recordingLayout({ frame, shell, dpr, screenW, screenH }) {
  if (frame === 'screen') {
    return {
      width: even(screenW), height: even(screenH),
      shell: null,
      screen: { x: 0, y: 0, w: screenW, h: screenH },
    };
  }
  const m = shell.mul;
  const w = Math.round(shell.w * m * dpr);
  const h = Math.round(shell.h * m * dpr);
  return {
    width: even(w), height: even(h),
    shell: { x: 0, y: 0, w, h },
    screen: { x: Math.round(shell.x * m * dpr), y: Math.round(shell.y * m * dpr), w: screenW, h: screenH },
  };
}

/** Whether this browser can record a canvas at all. */
export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickMimeType((type) => MediaRecorder.isTypeSupported(type)) !== '';
}

export class ScreenRecorder {
  /** @param {HTMLCanvasElement} source the LCD canvas */
  constructor(source) {
    this.source = source;
    this.canvas = null;
    this.ctx = null;
    this.layout = null;
    this.shellImage = null;
    this.background = '#000';
    this.recorder = null;
    this.chunks = [];
    this.mime = '';
    this.startedAt = 0;
    this.lastFrameAt = 0;
    this.keepalive = 0;
  }

  get active() {
    return this.recorder !== null;
  }

  /** Milliseconds since the recording started; 0 when there is none. */
  get elapsed() {
    return this.active ? performance.now() - this.startedAt : 0;
  }

  /**
   * @param {{layout: object, shellImage: HTMLImageElement|null, background: string,
   *          audioStream: MediaStream|null}} p
   */
  start({ layout, shellImage, background, audioStream }) {
    if (this.active) return;

    this.layout = layout;
    this.shellImage = shellImage;
    this.background = background;

    this.canvas = document.createElement('canvas');
    this.canvas.width = layout.width;
    this.canvas.height = layout.height;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    // The case artwork is pixel art, and the page shows it that way.
    this.ctx.imageSmoothingEnabled = false;

    // Drawn before the stream exists, so the first frame is a picture rather
    // than an empty canvas.
    this.frame();

    const video = this.canvas.captureStream();
    const tracks = [...video.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const stream = new MediaStream(tracks);

    this.mime = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mime,
      videoBitsPerSecond: bitrateFor(layout.width, layout.height),
      audioBitsPerSecond: 128_000,
    });
    this.recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    });
    this.recorder.start(SLICE_MS);
    this.startedAt = performance.now();

    this.keepalive = setInterval(() => {
      if (performance.now() - this.lastFrameAt >= KEEPALIVE_MS) this.frame();
    }, KEEPALIVE_MS);
  }

  /** Composites the panel as it stands into the recorded frame. */
  frame() {
    if (!this.ctx) return;
    const { ctx, layout } = this;

    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
    if (layout.shell && this.shellImage) {
      const r = layout.shell;
      ctx.drawImage(this.shellImage, r.x, r.y, r.w, r.h);
    }
    // Scaled into the rectangle fixed at the start: the backing store can be
    // re-cut under a running recording when the window moves to a monitor with
    // different scaling, and the file keeps one size regardless.
    const s = layout.screen;
    ctx.drawImage(this.source, s.x, s.y, s.w, s.h);

    this.lastFrameAt = performance.now();
  }

  /** Ends the recording. @returns {Promise<{blob: Blob, extension: string}>} */
  stop() {
    if (!this.active) return Promise.reject(new Error('not recording'));
    const recorder = this.recorder;
    clearInterval(this.keepalive);
    // One last frame, so the file runs right up to this moment.
    this.frame();

    return new Promise((resolve) => {
      recorder.addEventListener('stop', () => {
        for (const track of recorder.stream.getVideoTracks()) track.stop();
        const type = this.mime.split(';')[0] || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        const extension = extensionFor(this.mime);
        this.chunks = [];
        this.recorder = null;
        this.canvas = null;
        this.ctx = null;
        resolve({ blob, extension });
      }, { once: true });
      recorder.stop();
    });
  }
}
