// Web Audio output for the PCD3311.
//
// The chip is a telephone tone generator, and its data sheet describes the
// output as low distortion, filtered on-chip to meet CEPT recommendations - so
// what leaves the pin is close to a sine, not the square wave MAME synthesises.
// MAME's square is a deliberate simplification (see the toggle in its
// sound_stream_update); reproducing it literally is what makes the emulated
// Portfolio sound shrill compared to the real one.
//
// So the signal path models the whole chain rather than just the chip:
//
//   oscillators -> bus -> speaker filters -> master -> out
//
// The oscillators run a near-sine with a few percent of low harmonics, standing
// in for the residual distortion of both the chip and the transducer. The
// filters are the part that actually removes the shrillness: a tiny piezo disc
// in a plastic case cannot move air below a few hundred hertz and damps the top
// end, which lands the result in roughly the same 300-3400 Hz band a telephone
// works in - the family this chip was designed for.
//
// Timbre is a judgement call, so the raw square path is kept and selectable.

const LOOKAHEAD = 0.06;    // how far ahead of the context we aim to schedule
const MIN_LEAD = 0.015;    // below this we have fallen behind and must resync
const MAX_LEAD = 0.25;     // above this latency is audible, so pull back
const RAMP = 0.0015;       // gate smoothing, in seconds
const CLICK_GAP = 0.0008;  // merges the two edges of one key click into one hit

// Telephone passband. The low corner is what a small transducer physically
// cannot deliver; the high corner is where the case and the chip's own filter
// take the edge off.
const SPEAKER_LOW = 300;
const SPEAKER_HIGH = 3000;

// Fundamental plus a little low-order distortion, about 4% in total - enough to
// stop it sounding like a laboratory sine, low enough to stay in the "low
// distortion" class the chip is specified for.
const TONE_HARMONICS = [0, 1, 0.02, 0.03, 0.012, 0.015];

// The transducer's own resonance. Kept low and gentle on purpose: a peak up at
// 2 kHz lands on the third harmonic of the low DTMF group and on the band the
// ear finds shrillest, which is the opposite of what this is for.
const BODY_FREQ = 1400;
const BODY_GAIN = 2.0;

export class AudioOutput {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bus = null;
    this.filters = [];
    this.voices = [];
    this.clickBuffer = null;
    this.tap = null;             // recording branch, see captureStream()
    this.lastClick = -1;
    this.audioClock = 0;
    this.volume = 0.25;
    this.muted = false;
    this.timbre = 'speaker';     // 'speaker' = filtered near-sine, 'raw' = square
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture; browsers block audio otherwise. */
  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;

      this.ctx = new Ctx();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);

      // Everything the Portfolio makes a sound with leaves through one
      // transducer, so tones and clicks share the bus and its filtering.
      this.bus = this.ctx.createGain();
      this.bus.gain.value = 1;

      const highpass = this.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = SPEAKER_LOW;
      highpass.Q.value = 0.7;

      // The disc's own resonance, giving the tones a little body.
      const body = this.ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = BODY_FREQ;
      body.Q.value = 0.9;
      body.gain.value = BODY_GAIN;

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = SPEAKER_HIGH;
      lowpass.Q.value = 0.7;

      this.filters = [highpass, body, lowpass];

      this.toneWave = this.ctx.createPeriodicWave(
        new Float32Array(TONE_HARMONICS.length),
        Float32Array.from(TONE_HARMONICS),
        { disableNormalization: false });

      for (let i = 0; i < 2; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0;
        osc.connect(gain).connect(this.bus);
        osc.start();
        this.voices.push({ osc, gain });
      }

      this.clickBuffer = this.makeClickBuffer();
      this.applyTimbre();
      this.audioClock = this.ctx.currentTime + LOOKAHEAD;
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.running;
  }

  /** 'speaker' for the filtered near-sine, 'raw' for MAME's bare square wave. */
  setTimbre(mode) {
    this.timbre = mode === 'raw' ? 'raw' : 'speaker';
    if (this.ctx) this.applyTimbre();
  }

  applyTimbre() {
    const speaker = this.timbre === 'speaker';

    for (const { osc } of this.voices) {
      if (speaker) osc.setPeriodicWave(this.toneWave);
      else osc.type = 'square';
    }

    this.bus.disconnect();
    for (const f of this.filters) f.disconnect();

    if (speaker) {
      // A sine carries about 3 dB less power than a square of the same
      // amplitude, and the filters take more off the top, so make it back up
      // here rather than leaving the filtered setting noticeably quieter.
      this.bus.gain.value = 1.7;
      let node = this.bus;
      for (const f of this.filters) { node.connect(f); node = f; }
      node.connect(this.master);
    } else {
      this.bus.gain.value = 1;
      this.bus.connect(this.master);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, RAMP);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, RAMP);
    }
  }

  /**
   * @param {{t:number, f0:number, f1:number}[]} events offsets within the slice
   * @param {number} duration real-time length of the slice, in seconds
   */
  schedule(events, duration) {
    if (!this.running) return;

    const now = this.ctx.currentTime;
    if (this.audioClock < now + MIN_LEAD || this.audioClock > now + MAX_LEAD) {
      this.audioClock = now + LOOKAHEAD;
    }

    for (const ev of events) {
      const when = this.audioClock + ev.t;
      if (ev.kind === 'click') {
        this.playClick(when);
      } else {
        this.setVoice(0, ev.f0, when);
        this.setVoice(1, ev.f1, when);
      }
    }

    this.audioClock += duration;
  }

  /**
   * A ~100 us pulse through a piezo disc does not produce a tone, it produces a
   * click: a broadband impulse that rings briefly at the disc's own resonance.
   * This is a damped sine standing in for that mechanical response - the pulse
   * timing is exact, the timbre is an approximation. It is pitched inside the
   * passband so the speaker filtering shapes it instead of swallowing it.
   */
  makeClickBuffer() {
    const rate = this.ctx.sampleRate;
    const length = Math.ceil(rate * 0.006);
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / rate;
      data[i] = Math.sin(2 * Math.PI * 2900 * t) * Math.exp(-t * 750);
    }
    return buffer;
  }

  playClick(when) {
    // Both edges of a single key click arrive ~102 us apart; collapse them.
    if (when - this.lastClick < CLICK_GAP) return;
    this.lastClick = when;

    const src = this.ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    src.connect(this.bus);
    src.start(Math.max(when, this.ctx.currentTime));
  }

  setVoice(i, freq, when) {
    const { osc, gain } = this.voices[i];
    if (freq > 0) {
      osc.frequency.setValueAtTime(freq, when);
      gain.gain.setTargetAtTime(1, when, RAMP);
    } else {
      gain.gain.setTargetAtTime(0, when, RAMP);
    }
  }

  /**
   * The output as a MediaStream, for a recording. Taken after the master gain,
   * so the file carries what the speakers play: the volume and the mute switch
   * apply to it as well. Needs a started context.
   */
  captureStream() {
    if (!this.ctx) return null;
    if (!this.tap) this.tap = this.ctx.createMediaStreamDestination();
    this.master.connect(this.tap);
    return this.tap.stream;
  }

  /** Takes the recording branch off the output again. */
  releaseStream() {
    if (this.tap) this.master.disconnect(this.tap);
  }

  /** Cuts everything off immediately, e.g. on reset. */
  silence() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const { gain } of this.voices) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
    }
    this.audioClock = now + LOOKAHEAD;
  }
}
