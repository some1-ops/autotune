/**
 * pitch-processor.js — Professional AudioWorklet DSP Engine
 *
 * Implements:
 *  - YIN pitch detection algorithm
 *  - Dual-path pitch shifter:
 *    - OLA (Overlap-Add) fast path for robotic/drill sound (< 15ms retune)
 *    - Phase Vocoder for melodic/smooth correction (>= 15ms retune)
 *  - Musical key/scale snapping
 *  - Humanize: random pitch drift for natural feel
 *  - Bypass mode
 *
 * Runs on the dedicated audio rendering thread — NO main thread access.
 * All parameters via AudioParam or MessagePort.
 */

const BLOCK_SIZE = 128; // Web Audio standard block size

// ─── Musical Constants ─────────────────────────────────────────────────────
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Scale masks: 1 = note active in scale
const SCALES = {
  0: [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], // Major
  1: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0], // Natural Minor
  2: [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0], // Major Pentatonic
  3: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0], // Minor Pentatonic
  4: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // Chromatic
  5: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1], // Dorian
};

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
function snapPitch(hz, key, scaleId, humanize) {
  if (hz <= 0) return hz;
  const midi = hzToMidi(hz);
  const scale = SCALES[scaleId] || SCALES[4];

  // Find nearest scale note within ±6 semitones
  let bestMidi = Math.round(midi);
  let bestDist = Infinity;

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

  // Apply humanize: random drift in cents
  const driftCents = humanize * (Math.random() * 2 - 1) * 30; // ±30 cents max
  const targetMidi = bestMidi + driftCents / 100;
  return midiToHz(targetMidi);
}

// ─── YIN Pitch Detector ────────────────────────────────────────────────────
const YIN_THRESHOLD = 0.15;
const YIN_BUFFER_SIZE = 2048;

class YINDetector {
  constructor() {
    this.buffer = new Float32Array(YIN_BUFFER_SIZE);
    this.yinBuffer = new Float32Array(YIN_BUFFER_SIZE / 2);
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

  detect(sampleRate) {
    if (!this.filled && this.writePos < YIN_BUFFER_SIZE) return { hz: 0, confidence: 0 };

    const buf = this.buffer;
    const yinBuf = this.yinBuffer;
    const halfSize = yinBuf.length;

    // Step 1: Difference function
    yinBuf[0] = 1;
    let runningSum = 0;

    for (let tau = 1; tau < halfSize; tau++) {
      let sum = 0;
      for (let i = 0; i < halfSize; i++) {
        const delta = buf[i] - buf[i + tau];
        sum += delta * delta;
      }
      yinBuf[tau] = sum;

      // Step 2: Cumulative mean normalized difference
      runningSum += sum;
      yinBuf[tau] *= tau / runningSum;
    }

    // Step 3: Absolute threshold — find first dip below threshold
    let tau = 2;
    while (tau < halfSize) {
      if (yinBuf[tau] < YIN_THRESHOLD) {
        // Step 4: Parabolic interpolation for sub-sample accuracy
        while (tau + 1 < halfSize && yinBuf[tau + 1] < yinBuf[tau]) tau++;
        const betterTau = tau;

        if (betterTau > 0 && betterTau < halfSize - 1) {
          const s0 = yinBuf[betterTau - 1];
          const s1 = yinBuf[betterTau];
          const s2 = yinBuf[betterTau + 1];
          const refinedTau = betterTau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
          return {
            hz: sampleRate / refinedTau,
            confidence: 1 - yinBuf[betterTau],
          };
        }
        return { hz: sampleRate / betterTau, confidence: 1 - yinBuf[betterTau] };
      }
      tau++;
    }

    return { hz: 0, confidence: 0 };
  }
}

// ─── OLA Fast Pitch Shifter (Robotic / Drill) ──────────────────────────────
const OLA_WINDOW = 512;
const OLA_HOP = 128;
const OLA_OVERLAP = OLA_WINDOW - OLA_HOP;

class OLAPitchShifter {
  constructor() {
    this.inputBuffer = new Float32Array(OLA_WINDOW * 4);
    this.outputBuffer = new Float32Array(OLA_WINDOW * 4);
    this.overlapAdd = new Float32Array(OLA_WINDOW);
    this.inputWrite = 0;
    this.outputRead = 0;
    this.outputWrite = 0;
    this.window = this._hanningWindow(OLA_WINDOW);
  }

  _hanningWindow(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }

  process(input, ratio) {
    // Write input
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWrite++ % this.inputBuffer.length] = input[i];
    }

    // Process complete windows
    while (this.inputWrite - this.outputWrite >= OLA_WINDOW) {
      const frame = new Float32Array(OLA_WINDOW);
      for (let i = 0; i < OLA_WINDOW; i++) {
        frame[i] = this.inputBuffer[(this.outputWrite + i) % this.inputBuffer.length] * this.window[i];
      }

      // Resample frame for pitch shift
      const shiftedLen = Math.round(OLA_WINDOW * ratio);
      const shifted = new Float32Array(OLA_WINDOW);
      for (let i = 0; i < OLA_WINDOW; i++) {
        const srcIdx = (i / OLA_WINDOW) * shiftedLen;
        const idx0 = Math.floor(srcIdx) % OLA_WINDOW;
        const idx1 = (idx0 + 1) % OLA_WINDOW;
        const frac = srcIdx - Math.floor(srcIdx);
        shifted[i] = frame[idx0] * (1 - frac) + frame[idx1] * frac;
      }

      // Overlap-add to output
      for (let i = 0; i < OLA_WINDOW; i++) {
        const pos = (this.outputWrite + i) % this.outputBuffer.length;
        this.outputBuffer[pos] = (this.outputBuffer[pos] || 0) + shifted[i];
      }

      this.outputWrite += OLA_HOP;
    }

    // Read output
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = this.outputBuffer[this.outputRead++ % this.outputBuffer.length];
    }
    return out;
  }
}

// ─── Phase Vocoder Pitch Shifter (Melodic / Smooth) ───────────────────────
const PV_FFT_SIZE = 2048;
const PV_HOP_A = 512; // analysis hop

class PhaseVocoderShifter {
  constructor() {
    this.fftSize = PV_FFT_SIZE;
    this.hopSize = PV_HOP_A;
    this.inputBuffer = new Float32Array(this.fftSize * 4);
    this.outputBuffer = new Float32Array(this.fftSize * 4);
    this.phaseAcc = new Float32Array(this.fftSize / 2 + 1);
    this.lastPhase = new Float32Array(this.fftSize / 2 + 1);
    this.window = this._hanningWindow(this.fftSize);
    this.inputWrite = 0;
    this.outputRead = 0;
    this.outputWrite = 0;
  }

  _hanningWindow(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }

  // Minimal real FFT via Cooley-Tukey (in-place)
  _fft(real, imag) {
    const n = real.length;
    // Bit reversal
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    // Butterfly
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wReal = Math.cos(ang);
      const wImag = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curReal = 1, curImag = 0;
        for (let j = 0; j < len / 2; j++) {
          const uR = real[i + j], uI = imag[i + j];
          const vR = real[i + j + len / 2] * curReal - imag[i + j + len / 2] * curImag;
          const vI = real[i + j + len / 2] * curImag + imag[i + j + len / 2] * curReal;
          real[i + j] = uR + vR; imag[i + j] = uI + vI;
          real[i + j + len / 2] = uR - vR; imag[i + j + len / 2] = uI - vI;
          const newReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = newReal;
        }
      }
    }
  }

  _ifft(real, imag) {
    // Conjugate, FFT, conjugate, scale
    for (let i = 0; i < imag.length; i++) imag[i] = -imag[i];
    this._fft(real, imag);
    const n = real.length;
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] = -imag[i] / n;
    }
  }

  process(input, ratio) {
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWrite++ % this.inputBuffer.length] = input[i];
    }

    const synthHop = Math.round(this.hopSize * ratio);

    while (this.inputWrite - this.outputWrite >= this.fftSize) {
      const real = new Float32Array(this.fftSize);
      const imag = new Float32Array(this.fftSize);

      for (let i = 0; i < this.fftSize; i++) {
        real[i] = this.inputBuffer[(this.outputWrite + i) % this.inputBuffer.length] * this.window[i];
      }

      this._fft(real, imag);

      const halfSize = this.fftSize / 2 + 1;
      const outReal = new Float32Array(this.fftSize);
      const outImag = new Float32Array(this.fftSize);

      for (let k = 0; k < halfSize; k++) {
        const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
        const phase = Math.atan2(imag[k], real[k]);

        // Phase difference
        const expectedPhase = (2 * Math.PI * k * this.hopSize) / this.fftSize;
        let phaseDiff = phase - this.lastPhase[k] - expectedPhase;

        // Wrap to [-π, π]
        phaseDiff = phaseDiff - 2 * Math.PI * Math.round(phaseDiff / (2 * Math.PI));

        // True frequency
        const trueFreq = (2 * Math.PI * k) / this.fftSize + phaseDiff / this.hopSize;

        this.phaseAcc[k] += synthHop * trueFreq;
        this.lastPhase[k] = phase;

        const newPhase = this.phaseAcc[k];
        outReal[k] = mag * Math.cos(newPhase);
        outImag[k] = mag * Math.sin(newPhase);

        // Mirror for real IFFT
        if (k > 0 && k < halfSize - 1) {
          outReal[this.fftSize - k] = outReal[k];
          outImag[this.fftSize - k] = -outImag[k];
        }
      }

      this._ifft(outReal, outImag);

      for (let i = 0; i < this.fftSize; i++) {
        const pos = (this.outputWrite + i) % this.outputBuffer.length;
        this.outputBuffer[pos] = (this.outputBuffer[pos] || 0) + outReal[i] * this.window[i];
      }

      this.outputWrite += this.hopSize;
    }

    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = this.outputBuffer[this.outputRead++ % this.outputBuffer.length];
    }
    return out;
  }
}

// ─── Main Processor ────────────────────────────────────────────────────────
class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "retuneSpeed", defaultValue: 50, minValue: 0, maxValue: 500, automationRate: "k-rate" },
      { name: "humanize",    defaultValue: 0,  minValue: 0, maxValue: 1,   automationRate: "k-rate" },
      { name: "key",         defaultValue: 0,  minValue: 0, maxValue: 11,  automationRate: "k-rate" },
      { name: "scale",       defaultValue: 0,  minValue: 0, maxValue: 5,   automationRate: "k-rate" },
      { name: "bypass",      defaultValue: 0,  minValue: 0, maxValue: 1,   automationRate: "k-rate" },
      { name: "inputGain",   defaultValue: 1,  minValue: 0, maxValue: 4,   automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.yin = new YINDetector();
    this.olaShifter = new OLAPitchShifter();
    this.pvShifter = new PhaseVocoderShifter();

    this.currentPitchRatio = 1.0;
    this.targetPitchRatio = 1.0;
    this.smoothedHz = 0;

    // Pitch reporting throttle
    this.reportCounter = 0;
    this.reportInterval = 10; // every ~10 blocks = ~15ms
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || input[0].length === 0) return true;

    const inputCh = input[0];
    const retuneSpeed = parameters.retuneSpeed[0];
    const humanize = parameters.humanize[0];
    const key = Math.round(parameters.key[0]);
    const scaleId = Math.round(parameters.scale[0]);
    const bypass = parameters.bypass[0] > 0.5;
    const inputGain = parameters.inputGain[0];

    // Apply input gain
    const gained = new Float32Array(inputCh.length);
    for (let i = 0; i < inputCh.length; i++) {
      gained[i] = inputCh[i] * inputGain;
    }

    if (bypass) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].set(gained);
      }
      return true;
    }

    // ── Pitch Detection ──
    this.yin.write(gained);
    const { hz, confidence } = this.yin.detect(sampleRate);

    let processedOutput;

    if (hz > 60 && hz < 1200 && confidence > 0.5) {
      const targetHz = snapPitch(hz, key, scaleId, humanize);
      this.targetPitchRatio = targetHz / hz;

      // Smooth pitch ratio transition based on retuneSpeed
      // retuneSpeed 0 = instant snap, 500 = very slow
      const smoothFactor = retuneSpeed <= 0 ? 1.0 : Math.exp(-BLOCK_SIZE / (sampleRate * retuneSpeed / 1000));
      this.currentPitchRatio = this.currentPitchRatio * smoothFactor + this.targetPitchRatio * (1 - smoothFactor);
    } else {
      // No pitch detected — pass through
      this.currentPitchRatio = 1.0;
    }

    // ── Pitch Shifting — dual path ──
    // Fast OLA path for robotic drill (<15ms), phase vocoder for melodic (>=15ms)
    if (retuneSpeed < 15) {
      processedOutput = this.olaShifter.process(gained, this.currentPitchRatio);
    } else {
      processedOutput = this.pvShifter.process(gained, this.currentPitchRatio);
    }

    // Write to all output channels (mono processing → broadcast)
    for (let ch = 0; ch < output.length; ch++) {
      for (let i = 0; i < output[ch].length; i++) {
        output[ch][i] = processedOutput[i] || 0;
      }
    }

    // ── Report detected pitch to main thread (throttled) ──
    if (++this.reportCounter >= this.reportInterval) {
      this.reportCounter = 0;
      this.port.postMessage({
        type: "pitch",
        hz: hz,
        confidence: confidence,
        pitchRatio: this.currentPitchRatio,
        noteName: hz > 0 ? NOTE_NAMES[((Math.round(hzToMidi(hz)) % 12) + 12) % 12] : "--",
        noteOctave: hz > 0 ? Math.floor(Math.round(hzToMidi(hz)) / 12) - 1 : 0,
        cents: hz > 0 ? Math.round((hzToMidi(hz) - Math.round(hzToMidi(hz))) * 100) : 0,
      });
    }

    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
