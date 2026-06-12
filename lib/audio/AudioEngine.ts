// lib/audio/AudioEngine.ts
// Singleton class that owns the entire Web Audio graph.
// All DSP routing happens here. UI interacts only through public methods.

import type { VocalPreset } from "./presets";
import { generateReverbIR } from "./reverbImpulse";

export interface PitchInfo {
  hz: number;
  confidence: number;
  noteName: string;
  noteOctave: number;
  cents: number;
  pitchRatio: number;
}

export type AudioEngineState =
  | "idle"
  | "initializing"
  | "ready"
  | "recording"
  | "error";

export class AudioEngine {
  private static instance: AudioEngine | null = null;

  // Audio context + nodes
  private ctx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private inputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private beatSource: AudioBufferSourceNode | null = null;
  private beatGain: GainNode | null = null;
  private beatBuffer: AudioBuffer | null = null;
  private beatAnalyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  // State
  private _state: AudioEngineState = "idle";
  private _beatPlaying = false;

  // Callbacks
  public onPitchUpdate: ((info: PitchInfo) => void) | null = null;
  public onStateChange: ((state: AudioEngineState) => void) | null = null;
  public onRecordingComplete: ((blob: Blob) => void) | null = null;

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  get state() { return this._state; }
  get beatPlaying() { return this._beatPlaying; }
  get analyserNode() { return this.analyser; }
  get beatAnalyserNode() { return this.beatAnalyser; }

  private setState(s: AudioEngineState) {
    this._state = s;
    this.onStateChange?.(s);
  }

  // ── Initialization ────────────────────────────────────────────────────────
  async init(): Promise<void> {
    if (this._state !== "idle") return;
    this.setState("initializing");

    try {
      this.ctx = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });

      // Load the AudioWorklet processor
      await this.ctx.audioWorklet.addModule("/worklets/pitch-processor.js");

      this.setState("ready");
    } catch (err) {
      this.setState("error");
      throw err;
    }
  }

  // ── Microphone ────────────────────────────────────────────────────────────
  async startMic(): Promise<void> {
    if (!this.ctx) throw new Error("AudioEngine not initialized");
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 44100,
      },
    });

    this.micSource = this.ctx.createMediaStreamSource(this.micStream);

    // ── Build signal chain ──
    // Mic → InputGain → Worklet → EQ Low → EQ Mid → EQ High → Compressor → [Dry + Reverb] → Master → Analyser → Dest
    this.inputGain = this.ctx.createGain();
    this.inputGain.gain.value = 1.0;

    this.workletNode = new AudioWorkletNode(this.ctx, "pitch-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === "pitch") {
        this.onPitchUpdate?.(e.data as PitchInfo);
      }
    };

    // EQ chain
    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 120;
    this.eqLow.gain.value = 0;

    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 2000;
    this.eqMid.Q.value = 0.8;
    this.eqMid.gain.value = 0;

    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 8000;
    this.eqHigh.gain.value = 0;

    // Compressor
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.1;
    this.compressor.knee.value = 4;

    // Dry/Wet split
    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 0.7;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = generateReverbIR(this.ctx, 1.5, 0.3);

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.3;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.85;

    // Connect the chain
    this.micSource.connect(this.inputGain);
    this.inputGain.connect(this.workletNode);
    this.workletNode.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.compressor);

    // Dry path
    this.compressor.connect(this.dryGain);
    this.dryGain.connect(this.masterGain);

    // Wet (reverb) path
    this.compressor.connect(this.reverb);
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

    // Master → Analyser → Output
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  stopMic(): void {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.micStream = null;
    this.micSource = null;
  }

  // ── Beat Playback ─────────────────────────────────────────────────────────
  async loadBeat(file: File): Promise<void> {
    if (!this.ctx) throw new Error("AudioEngine not initialized");

    const arrayBuffer = await file.arrayBuffer();
    this.beatBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    if (!this.beatGain) {
      this.beatGain = this.ctx.createGain();
      this.beatGain.gain.value = 0.8;

      this.beatAnalyser = this.ctx.createAnalyser();
      this.beatAnalyser.fftSize = 2048;
      this.beatAnalyser.smoothingTimeConstant = 0.85;

      this.beatGain.connect(this.beatAnalyser);
      this.beatAnalyser.connect(this.ctx.destination);
    }
  }

  playBeat(): void {
    if (!this.ctx || !this.beatBuffer || !this.beatGain) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    this.beatSource?.stop();
    this.beatSource = this.ctx.createBufferSource();
    this.beatSource.buffer = this.beatBuffer;
    this.beatSource.loop = true;
    this.beatSource.connect(this.beatGain);
    this.beatSource.start();
    this._beatPlaying = true;
  }

  stopBeat(): void {
    this.beatSource?.stop();
    this.beatSource = null;
    this._beatPlaying = false;
  }

  setBeatVolume(vol: number): void {
    if (this.beatGain) {
      this.beatGain.gain.linearRampToValueAtTime(
        Math.max(0, Math.min(4, vol)),
        (this.ctx?.currentTime ?? 0) + 0.05
      );
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  startRecording(): void {
    if (!this.ctx || !this.masterGain) throw new Error("Mic not started");

    // Capture the master output as a MediaStream
    const dest = this.ctx.createMediaStreamDestination();
    this.masterGain.connect(dest);

    // Also capture beat if playing
    if (this.beatGain) {
      this.beatGain.connect(dest);
    }

    this.recordedChunks = [];
    this.recorder = new MediaRecorder(dest.stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };

    this.recorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: "audio/webm" });
      this.onRecordingComplete?.(blob);
    };

    this.recorder.start(100); // 100ms timeslice
    this.setState("recording");
  }

  stopRecording(): void {
    this.recorder?.stop();
    this.setState("ready");
  }

  // ── WAV Export ────────────────────────────────────────────────────────────
  exportAsWAV(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autotune-recording-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Parameter Control ─────────────────────────────────────────────────────
  setWorkletParam(name: string, value: number): void {
    if (!this.workletNode) return;
    const param = this.workletNode.parameters.get(name);
    if (param) {
      param.linearRampToValueAtTime(
        value,
        (this.ctx?.currentTime ?? 0) + 0.02
      );
    }
  }

  applyPreset(preset: VocalPreset): void {
    if (!this.ctx) return;

    // Worklet params
    this.setWorkletParam("retuneSpeed", preset.retuneSpeed);
    this.setWorkletParam("humanize", preset.humanize);
    this.setWorkletParam("key", preset.key);
    this.setWorkletParam("scale", preset.scale);
    this.setWorkletParam("inputGain", preset.inputGain);

    // Compressor
    if (this.compressor) {
      const t = this.ctx.currentTime + 0.05;
      this.compressor.threshold.linearRampToValueAtTime(preset.compThreshold, t);
      this.compressor.ratio.linearRampToValueAtTime(preset.compRatio, t);
      this.compressor.attack.linearRampToValueAtTime(preset.compAttack, t);
      this.compressor.release.linearRampToValueAtTime(preset.compRelease, t);
      this.compressor.knee.linearRampToValueAtTime(preset.compKnee, t);
    }

    // EQ
    if (this.eqLow) {
      this.eqLow.frequency.value = preset.eqLowFreq;
      this.eqLow.gain.linearRampToValueAtTime(preset.eqLowGain, this.ctx.currentTime + 0.05);
    }
    if (this.eqHigh) {
      this.eqHigh.frequency.value = preset.eqHighFreq;
      this.eqHigh.gain.linearRampToValueAtTime(preset.eqHighGain, this.ctx.currentTime + 0.05);
    }
    if (this.eqMid) {
      this.eqMid.gain.linearRampToValueAtTime(preset.eqMidGain, this.ctx.currentTime + 0.05);
    }

    // Reverb
    if (this.reverb && this.ctx) {
      this.reverb.buffer = generateReverbIR(this.ctx, preset.reverbDecay, preset.reverbWet);
    }
    if (this.reverbGain) {
      this.reverbGain.gain.linearRampToValueAtTime(preset.reverbWet, this.ctx.currentTime + 0.05);
    }
    if (this.dryGain) {
      this.dryGain.gain.linearRampToValueAtTime(1 - preset.reverbWet * 0.5, this.ctx.currentTime + 0.05);
    }
  }

  setBypass(on: boolean): void {
    this.setWorkletParam("bypass", on ? 1 : 0);
  }

  setKey(key: number): void {
    this.setWorkletParam("key", key);
  }

  setScale(scale: number): void {
    this.setWorkletParam("scale", scale);
  }

  setRetuneSpeed(ms: number): void {
    this.setWorkletParam("retuneSpeed", ms);
  }

  setHumanize(val: number): void {
    this.setWorkletParam("humanize", val);
  }

  setMasterVolume(vol: number): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.05);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  destroy(): void {
    this.stopMic();
    this.stopBeat();
    this.ctx?.close();
    this.ctx = null;
    AudioEngine.instance = null;
    this.setState("idle");
  }
}
