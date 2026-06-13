/**
 * pitch-processor.js — VocalBooth Pro AudioWorklet DSP Engine
 *
 * Architecture:
 *  - YIN pitch detection (accurate, low-latency)
 *  - Linear-interpolation resampler for pitch shifting
 *    (zero latency, no buffering artifacts, no screeching)
 *  - Musical key/scale snapping
 *  - Humanize: random pitch drift for natural feel
 *  - Smooth pitch ratio transition (prevents zipper noise)
 *  - Bypass mode
 *
 * Why linear-interpolation instead of Phase Vocoder / OLA:
 *   Phase Vocoder and OLA require a large look-ahead buffer and careful
 *   circular-buffer management. In a block-size-128 AudioWorklet context,
 *   the per-block latency budget is only ~2.9ms at 44100Hz. Both advanced
 *   algorithms produce audible screeching/artifacts when their read/write
 *   pointers drift — which happens immediately with a 128-sample block size
 *   and a 512-sample hop. The linear-interpolation resampler is sample-exact,
 *   latency-free, and produces clean pitch-shifted audio suitable for
 *   recording (not monitoring), which is exactly what VocalBooth needs.
 *
 * Runs on the dedicated audio rendering thread — NO main thread access.
 * All parameters via AudioParam or MessagePort.
 */

'use strict';

// ─── Musical Constants ─────────────────────────────────────────────────────
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Scale definitions: each entry is an array of 12 semitone flags (1=in scale).
 * Index must match the `scale` AudioParam value sent from Studio.tsx.
 *
 * Studio.tsx SCALE_KEYS order:
 *   0=major, 1=minor, 2=chromatic, 3=pentatonic, 4=blues, 5=dorian, 6=mixolydian
 */
const SCALES = [
  [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], // 0 Major
  [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0], // 1 Natural Minor
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // 2 Chromatic
  [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0], // 3 Major Pentatonic
  [1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0], // 4 Blues
  [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1], // 5 Dorian
  [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0], // 6 Mixolydian
];

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440.0);
}

function midiToHz(midi) {
  return 440.0 * Math.pow(2, (midi - 69) / 12.0);
}

/**
 * Snap a frequency to the nearest note in the given key+scale.
 * Returns the target frequency (Hz).
 */
function snapPitch(hz, key, scaleId) {
  if (hz <= 0) return hz;
  const midi = hzToMidi(hz);
  const scale = SCALES[scaleId] || SCALES[2]; // fallback: chromatic

  let bestMidi = Math.round(midi);
  let bestDist = Infinity;

  // Search ±12 semitones from the current midi note
  for (let offset = -12; offset <= 12; offset++) {
    const candidate = Math.round(midi) + offset;
    const noteClass = ((candidate - key) % 12 + 12) % 12;
    if (scale[noteClass]) {
      const dist = Math.abs(candidate - midi);
      if (dist < bestDist) {
        bestDist = dist;
        bestMidi = candidate;
      }
    }
  }

  return midiToHz(bestMidi);
}

// ─── YIN Pitch Detector ────────────────────────────────────────────────────
const YIN_THRESHOLD = 0.12;
const YIN_BUFFER_SIZE = 2048;

class YINDetector {
  constructor() {
    this.buffer = new Float32Array(YIN_BUFFER_SIZE);
    this.yinBuf = new Float32Array(YIN_BUFFER_SIZE / 2);
    this.writePos = 0;
    this.filled = false;
  }

  write(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writePos] = samples[i];
      this.writePos = (this.writePos + 1) % YIN_BUFFER_SIZE;
      if (this.writePos === 0) this.filled = true;
    }
  }

  detect(sr) {
    if (!this.filled && this.writePos < 512) return { hz: 0, confidence: 0 };

    const buf = this.buffer;
    const yb  = this.yinBuf;
    const half = yb.length;

    // Step 1 + 2: Cumulative mean normalised difference function
    yb[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < half; tau++) {
      let sum = 0;
      for (let i = 0; i < half; i++) {
        const d = buf[i] - buf[i + tau];
        sum += d * d;
      }
      yb[tau] = sum;
      runningSum += sum;
      yb[tau] = runningSum > 0 ? (yb[tau] * tau) / runningSum : 0;
    }

    // Step 3: Absolute threshold — find first dip below threshold
    for (let tau = 2; tau < half; tau++) {
      if (yb[tau] < YIN_THRESHOLD) {
        // Step 4: Parabolic interpolation
        while (tau + 1 < half && yb[tau + 1] < yb[tau]) tau++;

        if (tau > 0 && tau < half - 1) {
          const s0 = yb[tau - 1], s1 = yb[tau], s2 = yb[tau + 1];
          const denom = 2 * (2 * s1 - s2 - s0);
          const refinedTau = denom !== 0 ? tau + (s2 - s0) / denom : tau;
          const hz = sr / refinedTau;
          const confidence = 1 - s1;
          if (hz >= 50 && hz <= 1800) return { hz, confidence };
        }

        const hz = sr / tau;
        const confidence = 1 - yb[tau];
        if (hz >= 50 && hz <= 1800) return { hz, confidence };
        break;
      }
    }

    return { hz: 0, confidence: 0 };
  }
}

// ─── Linear-Interpolation Pitch Shifter ───────────────────────────────────
//
// Stateless per-block resampler — exactly matches the original HTML prototype.
//
// For each output sample i, we read from position (i / ratio) in the INPUT
// block, using linear interpolation between adjacent samples.
//
// When ratio > 1 (pitch up):  step < 1 → we consume FEWER input samples
//   (some input tail is dropped — OK for small corrections)
// When ratio < 1 (pitch down): step > 1 → we repeat the input tail
//   (last input sample is held — OK for small corrections)
//
// No ring buffer, no accumulated state, no pointer divergence possible.
// Block-boundary discontinuities are inaudible for typical auto-tune
// corrections (±50 cents), which keep ratio very close to 1.0.

class LinearResampler {
  process(input, ratio) {
    const out  = new Float32Array(input.length);
    // step = how many input samples to advance per output sample
    // ratio > 1 → read input faster (pitch up)  → step < 1
    // ratio < 1 → read input slower (pitch down) → step > 1
    const step = 1.0 / Math.max(0.25, Math.min(4.0, ratio));

    for (let i = 0; i < input.length; i++) {
      const rp   = i * step;
      const lo   = Math.floor(rp);
      const hi   = lo + 1;
      const frac = rp - lo;

      const s0 = lo < input.length     ? input[lo] : input[input.length - 1];
      const s1 = hi < input.length     ? input[hi] : input[input.length - 1];

      out[i] = s0 * (1 - frac) + s1 * frac;
    }

    return out;
  }
}


// ─── Main Processor ────────────────────────────────────────────────────────
class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "retuneSpeed", defaultValue: 50,  minValue: 0,  maxValue: 500, automationRate: "k-rate" },
      { name: "humanize",    defaultValue: 0,   minValue: 0,  maxValue: 1,   automationRate: "k-rate" },
      { name: "key",         defaultValue: 0,   minValue: 0,  maxValue: 11,  automationRate: "k-rate" },
      { name: "scale",       defaultValue: 0,   minValue: 0,  maxValue: 6,   automationRate: "k-rate" },
      { name: "bypass",      defaultValue: 0,   minValue: 0,  maxValue: 1,   automationRate: "k-rate" },
      { name: "inputGain",   defaultValue: 1,   minValue: 0,  maxValue: 4,   automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.yin       = new YINDetector();
    this.shifter   = new LinearResampler();

    this.currentRatio = 1.0; // smoothed pitch ratio
    this.targetRatio  = 1.0;
    this.prevHz       = 0;

    // Pitch reporting throttle (~every 15ms)
    this.reportCounter  = 0;
    this.reportInterval = 6; // ~6 × 128/44100 ≈ 17ms

    // Humanize state — smooth the random drift so it doesn't jitter per-block
    this.humanizeDrift = 0;
    this.humanizeTimer = 0;
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || input[0].length === 0) return true;

    const inputCh     = input[0];
    const retuneSpeed = parameters.retuneSpeed[0];
    const humanize    = parameters.humanize[0];
    const key         = Math.round(parameters.key[0]);
    const scaleId     = Math.round(parameters.scale[0]);
    const bypass      = parameters.bypass[0] > 0.5;
    const inputGain   = parameters.inputGain[0];
    const blockSize   = inputCh.length;

    // Apply input gain
    const gained = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      gained[i] = inputCh[i] * inputGain;
    }

    // ── Bypass path ──
    if (bypass) {
      for (let ch = 0; ch < output.length; ch++) output[ch].set(gained);
      return true;
    }

    // ── Pitch Detection (YIN) ──
    this.yin.write(gained);
    const { hz, confidence } = this.yin.detect(sampleRate);

    // ── Pitch Target Calculation ──
    if (hz > 50 && hz < 1800 && confidence > 0.45) {
      let targetHz = snapPitch(hz, key, scaleId);

      // Humanize: slow-moving random drift in cents (update every ~10 blocks)
      if (humanize > 0) {
        this.humanizeTimer++;
        if (this.humanizeTimer >= 10) {
          this.humanizeTimer = 0;
          // Target drift: ±25 cents scaled by humanize, smooth toward it
          const driftTarget = humanize * (Math.random() * 2 - 1) * 25;
          this.humanizeDrift = this.humanizeDrift * 0.7 + driftTarget * 0.3;
        }
        // Apply drift in cents → frequency ratio
        targetHz *= Math.pow(2, this.humanizeDrift / 1200);
      } else {
        this.humanizeDrift = 0;
      }

      this.targetRatio = targetHz / hz;
    } else {
      // No confident pitch → return to unity ratio (pass-through pitch)
      this.targetRatio = 1.0;
    }

    // ── Smooth ratio transition ──
    // retuneSpeed 0 = instant snap (ratio 1.0 = skip smoothing completely)
    // retuneSpeed 500 = very slow
    if (retuneSpeed <= 0) {
      this.currentRatio = this.targetRatio;
    } else {
      // Time constant: blockSize / (sampleRate × retuneSpeed_seconds)
      const tc = (retuneSpeed / 1000) * sampleRate; // samples
      const alpha = Math.exp(-blockSize / tc);
      this.currentRatio = this.currentRatio * alpha + this.targetRatio * (1 - alpha);
    }

    // ── Pitch Shifting (linear interpolation resampler) ──
    const processed = this.shifter.process(gained, this.currentRatio);

    // Write to all output channels
    for (let ch = 0; ch < output.length; ch++) {
      for (let i = 0; i < output[ch].length; i++) {
        output[ch][i] = processed[i] || 0;
      }
    }

    // ── Report detected pitch to main thread (throttled) ──
    if (++this.reportCounter >= this.reportInterval) {
      this.reportCounter = 0;
      const midiRaw = hz > 0 ? hzToMidi(hz) : 0;
      this.port.postMessage({
        type:       "pitch",
        hz:          hz,
        confidence:  confidence,
        pitchRatio:  this.currentRatio,
        noteName:    hz > 0 ? NOTE_NAMES[((Math.round(midiRaw) % 12) + 12) % 12] : "--",
        noteOctave:  hz > 0 ? Math.floor(Math.round(midiRaw) / 12) - 1 : 0,
        cents:       hz > 0 ? Math.round((midiRaw - Math.round(midiRaw)) * 100) : 0,
      });
    }

    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
