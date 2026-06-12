// lib/audio/presets.ts — Vocal chain presets for UK Rap / Drill / Trap

export interface VocalPreset {
  name: string;
  genre: string;
  description: string;
  retuneSpeed: number;   // ms — 0 = robotic, 200 = natural
  humanize: number;      // 0–1
  key: number;           // 0=C, 1=C#, ... 11=B
  scale: number;         // 0=Major, 1=Minor, 2=MajPent, 3=MinPent, 4=Chromatic, 5=Dorian
  inputGain: number;     // 0–4
  // Effects chain
  compThreshold: number; // dB, -60 to 0
  compRatio: number;     // 1–20
  compAttack: number;    // seconds
  compRelease: number;   // seconds
  compKnee: number;      // dB
  reverbWet: number;     // 0–1
  reverbDecay: number;   // seconds
  eqLowGain: number;     // dB
  eqMidGain: number;     // dB
  eqHighGain: number;    // dB
  eqLowFreq: number;     // Hz
  eqHighFreq: number;    // Hz
}

export const PRESETS: VocalPreset[] = [
  {
    name: "Central Cee",
    genre: "UK Rap",
    description: "Tight, robotic snap — zero-latency retune, heavy compression",
    retuneSpeed: 0,
    humanize: 0,
    key: 0,
    scale: 1, // Minor
    inputGain: 1.2,
    compThreshold: -24,
    compRatio: 12,
    compAttack: 0.003,
    compRelease: 0.1,
    compKnee: 4,
    reverbWet: 0.08,
    reverbDecay: 0.8,
    eqLowGain: -4,
    eqMidGain: 2,
    eqHighGain: 3,
    eqLowFreq: 120,
    eqHighFreq: 8000,
  },
  {
    name: "Nemzzz",
    genre: "UK Rap",
    description: "Crisp autotune — ultra-fast snap with slight air on top",
    retuneSpeed: 5,
    humanize: 0.05,
    key: 0,
    scale: 1,
    inputGain: 1.1,
    compThreshold: -22,
    compRatio: 10,
    compAttack: 0.002,
    compRelease: 0.08,
    compKnee: 3,
    reverbWet: 0.12,
    reverbDecay: 1.0,
    eqLowGain: -3,
    eqMidGain: 1.5,
    eqHighGain: 4,
    eqLowFreq: 100,
    eqHighFreq: 9000,
  },
  {
    name: "Dave Melodic",
    genre: "Melodic Rap",
    description: "Smooth, emotional correction — natural feel for storytelling",
    retuneSpeed: 80,
    humanize: 0.35,
    key: 0,
    scale: 0, // Major
    inputGain: 1.0,
    compThreshold: -18,
    compRatio: 5,
    compAttack: 0.01,
    compRelease: 0.25,
    compKnee: 6,
    reverbWet: 0.35,
    reverbDecay: 2.2,
    eqLowGain: -2,
    eqMidGain: 0.5,
    eqHighGain: 2,
    eqLowFreq: 80,
    eqHighFreq: 10000,
  },
  {
    name: "UK Drill",
    genre: "Drill",
    description: "Aggressive, locked-in pitch — no mercy on retune speed",
    retuneSpeed: 2,
    humanize: 0,
    key: 0,
    scale: 3, // Minor Pentatonic
    inputGain: 1.3,
    compThreshold: -26,
    compRatio: 14,
    compAttack: 0.001,
    compRelease: 0.05,
    compKnee: 2,
    reverbWet: 0.05,
    reverbDecay: 0.6,
    eqLowGain: -6,
    eqMidGain: 3,
    eqHighGain: 2,
    eqLowFreq: 150,
    eqHighFreq: 7500,
  },
  {
    name: "Trap Smoke",
    genre: "Trap",
    description: "808-friendly — medium snap with dreamy reverb tail",
    retuneSpeed: 10,
    humanize: 0.1,
    key: 0,
    scale: 3,
    inputGain: 1.1,
    compThreshold: -20,
    compRatio: 8,
    compAttack: 0.005,
    compRelease: 0.15,
    compKnee: 5,
    reverbWet: 0.45,
    reverbDecay: 2.8,
    eqLowGain: -3,
    eqMidGain: 1,
    eqHighGain: 3,
    eqLowFreq: 100,
    eqHighFreq: 8500,
  },
  {
    name: "Melodic Drill",
    genre: "Drill",
    description: "The Headie One pocket — balanced between snap and melody",
    retuneSpeed: 25,
    humanize: 0.15,
    key: 0,
    scale: 1,
    inputGain: 1.15,
    compThreshold: -21,
    compRatio: 9,
    compAttack: 0.004,
    compRelease: 0.12,
    compKnee: 4,
    reverbWet: 0.2,
    reverbDecay: 1.4,
    eqLowGain: -4,
    eqMidGain: 2,
    eqHighGain: 2.5,
    eqLowFreq: 130,
    eqHighFreq: 8000,
  },
  {
    name: "Natural",
    genre: "General",
    description: "Gentle correction — transparent, barely-there processing",
    retuneSpeed: 140,
    humanize: 0.6,
    key: 0,
    scale: 4, // Chromatic
    inputGain: 1.0,
    compThreshold: -16,
    compRatio: 3,
    compAttack: 0.015,
    compRelease: 0.35,
    compKnee: 8,
    reverbWet: 0.18,
    reverbDecay: 1.6,
    eqLowGain: -1,
    eqMidGain: 0,
    eqHighGain: 1,
    eqLowFreq: 80,
    eqHighFreq: 12000,
  },
];

export const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const SCALE_NAMES = ["Major", "Minor", "Maj. Pent.", "Min. Pent.", "Chromatic", "Dorian"];

export const DEFAULT_PRESET = PRESETS[0];
