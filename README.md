# 🎙️ AutoTune Studio

A professional-grade, browser-based vocal autotune application built with **Next.js 16**, **TypeScript**, **Tailwind CSS**, and the **Web Audio API AudioWorklet** for real-time DSP.

![AutoTune Studio](./public/preview.png)

---

## ✨ Features

- **Real-time pitch correction** — YIN pitch detection + dual-path pitch shifting running on a dedicated audio thread (`AudioWorklet`)
- **Dual DSP engine:**
  - **OLA fast path** (< 15ms retune) — robotic, locked-in sound for Drill & Trap
  - **Phase Vocoder** (≥ 15ms) — smooth, melodic correction for storytelling rap
- **7 genre presets** — Central Cee, Nemzzz, Dave Melodic, UK Drill, Trap Smoke, Melodic Drill, Natural
- **Full vocal chain** — EQ (Low / Mid / High) + DynamicsCompressor + Reverb (programmatic IR)
- **Beat import** — drag-and-drop MP3/WAV/OGG/FLAC over your instrumental
- **Record & export** — record processed vocals over a beat, export as WebM audio
- **Live pitch meter** — real-time note name, octave, Hz, and cents display
- **Waveform visualizer** — dual-channel oscilloscope (vocal + beat)
- **Supabase ready** — scaffolded for auth + cloud recording storage

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (optional — for Supabase)

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your Supabase project URL and anon key. The studio works fully offline without Supabase — credentials are only needed for cloud session storage.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** The browser requires microphone permission. The app uses COOP/COEP headers (required for AudioWorklet cross-origin isolation) — these are set automatically in development and production.

---

## 🎛️ Usage

1. Click **Launch Studio** to initialize the Web Audio context and load the DSP worklet
2. Click **Start Mic** to request microphone access — processing starts immediately
3. Select a **vocal preset** from the dropdown (e.g. "Central Cee" for robotic drill snap)
4. Choose your **Key** (C–B) and **Scale** (Major, Minor, Pentatonic, etc.)
5. Drop a **beat file** into the upload zone, then click **Play Beat**
6. Click **Record** to capture your performance → **Stop REC** when done
7. Play back the recording in the recordings section → **Export** to download

---

## 🏗️ Architecture

### Signal Chain

```
Mic (getUserMedia)
  → GainNode (input gain)
  → AudioWorkletNode ← pitch-processor.js (YIN + OLA/Phase Vocoder)
  → BiquadFilter ×3 (Low/Mid/High EQ)
  → DynamicsCompressor
  ┌─ GainNode (dry) ──────────────────────┐
  └─ ConvolverNode (reverb) → GainNode ──→ MasterGain → AnalyserNode → Destination
```

### DSP Engine (`public/worklets/pitch-processor.js`)

| Algorithm | Mode | Latency |
|-----------|------|---------|
| OLA (Overlap-Add) | Retune Speed < 15ms | ~5ms |
| Phase Vocoder (FFT) | Retune Speed ≥ 15ms | ~23ms |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Audio | Web Audio API + AudioWorklet |
| Backend | Supabase (optional) |
| Deployment | Vercel |

---

## 📁 Project Structure

```
├── public/worklets/
│   └── pitch-processor.js     # DSP engine (plain JS — required for AudioWorklet)
├── lib/audio/
│   ├── AudioEngine.ts          # Web Audio graph singleton
│   ├── presets.ts              # Genre vocal presets
│   └── reverbImpulse.ts        # Programmatic reverb IR generator
├── lib/supabase/
│   └── client.ts               # Supabase SSR client
├── components/
│   ├── Studio.tsx              # Master layout + state
│   ├── Knob.tsx                # SVG rotary knob
│   ├── PitchMeter.tsx          # Real-time pitch display
│   ├── Waveform.tsx            # Canvas oscilloscope
│   └── PresetSelector.tsx      # Preset dropdown
└── app/
    ├── page.tsx
    ├── layout.tsx
    └── globals.css
```

---

## 🌐 Deploy to Vercel

```bash
npx vercel
```

The `vercel.json` is pre-configured with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers required for AudioWorklet in production.

---

## 📄 License

MIT
