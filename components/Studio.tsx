"use client";
// components/Studio.tsx — Master studio layout, wires everything together

import { useCallback, useRef, useState } from "react";
import { AudioEngine, type PitchInfo } from "@/lib/audio/AudioEngine";
import { PRESETS, KEY_NAMES, SCALE_NAMES, type VocalPreset } from "@/lib/audio/presets";
import { Knob } from "@/components/Knob";
import { PitchMeter } from "@/components/PitchMeter";
import { Waveform } from "@/components/Waveform";
import { PresetSelector } from "@/components/PresetSelector";

type AppState = "idle" | "ready" | "recording" | "error";

export function Studio() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [appState, setAppState] = useState<AppState>("idle");
  const [micActive, setMicActive] = useState(false);
  const [pitchInfo, setPitchInfo] = useState<PitchInfo | null>(null);
  const [currentPreset, setCurrentPreset] = useState<VocalPreset>(PRESETS[0]);
  const [bypass, setBypass] = useState(false);
  const [beatLoaded, setBeatLoaded] = useState(false);
  const [beatPlaying, setBeatPlaying] = useState(false);
  const [beatFilename, setBeatFilename] = useState<string>("");
  const [recordings, setRecordings] = useState<{ blob: Blob; url: string; ts: number }[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [beatAnalyser, setBeatAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const beatInputRef = useRef<HTMLInputElement>(null);

  // Knob state (display only — AudioEngine holds truth)
  const [retuneSpeed, setRetuneSpeed] = useState(currentPreset.retuneSpeed);
  const [humanize, setHumanize] = useState(currentPreset.humanize);
  const [reverbWet, setReverbWet] = useState(currentPreset.reverbWet);
  const [compThreshold, setCompThreshold] = useState(currentPreset.compThreshold);
  const [selectedKey, setSelectedKey] = useState(currentPreset.key);
  const [selectedScale, setSelectedScale] = useState(currentPreset.scale);
  const [masterVol, setMasterVol] = useState(1.0);
  const [beatVol, setBeatVol] = useState(0.8);

  // ── Engine init ──────────────────────────────────────────────────────────
  const initEngine = useCallback(async () => {
    try {
      const engine = AudioEngine.getInstance();
      engineRef.current = engine;
      engine.onPitchUpdate = setPitchInfo;
      engine.onStateChange = (s) => {
        if (s === "error") setAppState("error");
        else if (s === "recording") setAppState("recording");
        else if (s === "ready") setAppState("ready");
      };
      engine.onRecordingComplete = (blob) => {
        const url = URL.createObjectURL(blob);
        setRecordings((prev) => [{ blob, url, ts: Date.now() }, ...prev]);
      };

      await engine.init();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Init failed");
      setAppState("error");
    }
  }, []);

  // ── Mic control ──────────────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (!micActive) {
      try {
        await engine.startMic();
        setAnalyser(engine.analyserNode);
        engine.applyPreset(currentPreset);
        setMicActive(true);
        setAppState("ready");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Mic access denied");
        setAppState("error");
      }
    } else {
      engine.stopMic();
      setMicActive(false);
      setAnalyser(null);
      setPitchInfo(null);
    }
  }, [micActive, currentPreset]);

  // ── Preset application ───────────────────────────────────────────────────
  const applyPreset = useCallback((preset: VocalPreset) => {
    setCurrentPreset(preset);
    setRetuneSpeed(preset.retuneSpeed);
    setHumanize(preset.humanize);
    setReverbWet(preset.reverbWet);
    setCompThreshold(preset.compThreshold);
    setSelectedKey(preset.key);
    setSelectedScale(preset.scale);
    engineRef.current?.applyPreset(preset);
  }, []);

  // ── Beat loading ─────────────────────────────────────────────────────────
  const handleBeatFile = useCallback(async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    await engine.loadBeat(file);
    setBeatLoaded(true);
    setBeatFilename(file.name);
    setBeatAnalyser(engine.beatAnalyserNode);
  }, []);

  const toggleBeat = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !beatLoaded) return;
    if (beatPlaying) {
      engine.stopBeat();
      setBeatPlaying(false);
    } else {
      engine.playBeat();
      setBeatPlaying(true);
    }
  }, [beatPlaying, beatLoaded]);

  // ── Recording ────────────────────────────────────────────────────────────
  const toggleRecord = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !micActive) return;
    if (appState === "recording") {
      engine.stopRecording();
    } else {
      engine.startRecording();
    }
  }, [appState, micActive]);

  // ── Knob handlers ────────────────────────────────────────────────────────
  const handleRetuneSpeed = useCallback((v: number) => {
    setRetuneSpeed(v);
    engineRef.current?.setRetuneSpeed(v);
  }, []);
  const handleHumanize = useCallback((v: number) => {
    setHumanize(v);
    engineRef.current?.setHumanize(v);
  }, []);
  const handleMasterVol = useCallback((v: number) => {
    setMasterVol(v);
    engineRef.current?.setMasterVolume(v);
  }, []);
  const handleBeatVol = useCallback((v: number) => {
    setBeatVol(v);
    engineRef.current?.setBeatVolume(v);
  }, []);

  // ── Drag and drop ─────────────────────────────────────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.type.startsWith("audio/") || file.name.match(/\.(mp3|wav|ogg|flac|aac)$/i))) {
        handleBeatFile(file);
      }
    },
    [handleBeatFile]
  );

  return (
    <div className="min-h-screen bg-[#06060f] text-white font-sans flex flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a3a]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              AutoTune Studio
            </h1>
            <p className="text-[10px] text-slate-500 -mt-0.5">Professional Vocal Processing</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-all ${
            appState === "recording"
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : micActive
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-slate-800/50 border-slate-700 text-slate-500"
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${
              appState === "recording" ? "bg-red-500 animate-pulse" :
              micActive ? "bg-green-500" : "bg-slate-600"
            }`} />
            {appState === "recording" ? "RECORDING" : micActive ? "LIVE" : "OFFLINE"}
          </div>

          {/* Bypass toggle */}
          <button
            id="bypass-btn"
            onClick={() => { setBypass(!bypass); engineRef.current?.setBypass(!bypass); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              bypass
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-slate-800/50 border-slate-700 text-slate-500 hover:text-slate-300"
            }`}
          >
            {bypass ? "BYPASSED" : "BYPASS"}
          </button>
        </div>
      </header>

      {/* ── Error Banner ── */}
      {appState === "error" && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          ⚠️ {errorMsg || "An audio error occurred."}
        </div>
      )}

      <main className="flex-1 grid grid-cols-[280px_1fr_260px] gap-0 overflow-hidden">
        {/* ═══ LEFT PANEL — Controls ═══ */}
        <aside className="border-r border-[#1a1a3a] p-5 flex flex-col gap-5 overflow-y-auto">
          {/* Preset selector */}
          <PresetSelector onSelect={applyPreset} currentPreset={currentPreset} />

          {/* Key / Scale */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-4 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Key & Scale</span>
            <div className="grid grid-cols-4 gap-1">
              {KEY_NAMES.map((k, i) => (
                <button
                  key={k}
                  id={`key-${k}`}
                  onClick={() => { setSelectedKey(i); engineRef.current?.setKey(i); }}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedKey === i
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-900/50"
                      : "bg-[#1a1a2e] text-slate-400 hover:bg-[#2a2a4e] hover:text-white"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {SCALE_NAMES.map((s, i) => (
                <button
                  key={s}
                  id={`scale-${i}`}
                  onClick={() => { setSelectedScale(i); engineRef.current?.setScale(i); }}
                  className={`py-1.5 px-3 rounded-lg text-xs text-left transition-all ${
                    selectedScale === i
                      ? "bg-purple-600/20 text-purple-300 border border-purple-500/30"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Pitch controls */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-4 flex flex-col gap-4">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Autotune</span>
            <div className="flex justify-around">
              <Knob value={retuneSpeed} min={0} max={200} step={1} label="Retune" unit="ms" onChange={handleRetuneSpeed} color="#a855f7" />
              <Knob value={humanize} min={0} max={1} step={0.01} label="Humanize" onChange={handleHumanize} color="#ec4899" />
            </div>
            {/* Retune speed visual feedback */}
            <div className="text-center">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                retuneSpeed < 5 ? "bg-red-500/20 text-red-400" :
                retuneSpeed < 30 ? "bg-orange-500/20 text-orange-400" :
                retuneSpeed < 80 ? "bg-yellow-500/20 text-yellow-400" :
                "bg-green-500/20 text-green-400"
              }`}>
                {retuneSpeed < 5 ? "🎯 Robotic (Drill)" :
                 retuneSpeed < 30 ? "⚡ Tight (Trap)" :
                 retuneSpeed < 80 ? "🎵 Musical" : "🌿 Natural"}
              </span>
            </div>
          </div>
        </aside>

        {/* ═══ CENTER PANEL — Main Stage ═══ */}
        <section className="flex flex-col gap-0 overflow-hidden">
          {/* Waveform */}
          <div className="p-5 pb-3">
            <Waveform analyser={analyser} beatAnalyser={beatAnalyser} isRecording={appState === "recording"} />
          </div>

          {/* Pitch meter */}
          <div className="px-5 pb-3">
            <PitchMeter pitchInfo={pitchInfo} />
          </div>

          {/* Transport controls */}
          <div className="px-5 pb-5 flex items-center justify-center gap-4">
            {/* Init / Mic button */}
            {appState === "idle" ? (
              <button
                id="init-btn"
                onClick={initEngine}
                className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-semibold text-sm hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg shadow-purple-900/50 hover:shadow-purple-900/80 hover:scale-105 active:scale-95"
              >
                Launch Studio
              </button>
            ) : (
              <>
                {/* Mic */}
                <button
                  id="mic-btn"
                  onClick={toggleMic}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
                    micActive
                      ? "bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30"
                      : "bg-[#1a1a3a] border border-[#2a2a5a] text-slate-300 hover:border-purple-500/40 hover:text-purple-300"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  {micActive ? "Mic On" : "Start Mic"}
                </button>

                {/* Beat play/stop */}
                <button
                  id="beat-play-btn"
                  onClick={toggleBeat}
                  disabled={!beatLoaded}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    beatPlaying
                      ? "bg-cyan-600/20 border border-cyan-500/40 text-cyan-300"
                      : "bg-[#1a1a3a] border border-[#2a2a5a] text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300"
                  }`}
                >
                  {beatPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                  {beatPlaying ? "Stop Beat" : "Play Beat"}
                </button>

                {/* Record */}
                <button
                  id="record-btn"
                  onClick={toggleRecord}
                  disabled={!micActive}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    appState === "recording"
                      ? "bg-red-600 text-white shadow-lg shadow-red-900/60 animate-pulse"
                      : "bg-[#1a1a3a] border border-[#2a2a5a] text-slate-300 hover:border-red-500/40 hover:text-red-400"
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${appState === "recording" ? "bg-white" : "bg-red-500"}`} />
                  {appState === "recording" ? "Stop REC" : "Record"}
                </button>
              </>
            )}
          </div>

          {/* Beat upload zone */}
          <div
            className="mx-5 mb-5 border border-dashed border-[#2a2a4a] rounded-xl p-4 text-center cursor-pointer hover:border-cyan-500/40 transition-all group"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => beatInputRef.current?.click()}
          >
            <input
              ref={beatInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBeatFile(f); }}
            />
            {beatLoaded ? (
              <div className="flex items-center justify-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm text-cyan-300 font-medium">{beatFilename}</p>
                  <p className="text-[10px] text-slate-500">Beat loaded — click Play Beat to start</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg className="w-8 h-8 text-slate-600 group-hover:text-cyan-500/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-slate-500 group-hover:text-slate-400 transition-colors">Drop a beat here or click to browse</p>
                <p className="text-[10px] text-slate-600">MP3, WAV, OGG, FLAC</p>
              </div>
            )}
          </div>

          {/* Recordings list */}
          {recordings.length > 0 && (
            <div className="mx-5 mb-5 flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Recordings</span>
              {recordings.map((rec) => (
                <div key={rec.ts} className="flex items-center gap-3 bg-[#0a0a18] border border-[#1a1a3a] rounded-lg px-3 py-2">
                  <audio controls src={rec.url} className="flex-1 h-8" style={{ accentColor: "#a855f7" }} />
                  <button
                    onClick={() => engineRef.current?.exportAsWAV(rec.blob)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 text-xs hover:bg-purple-600/30 transition-colors border border-purple-500/30"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ═══ RIGHT PANEL — Mixer ═══ */}
        <aside className="border-l border-[#1a1a3a] p-5 flex flex-col gap-5 overflow-y-auto">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Mixer</span>

          {/* Volume knobs */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-4">
            <div className="flex justify-around">
              <Knob value={masterVol} min={0} max={2} step={0.01} label="Vocal" onChange={handleMasterVol} color="#a855f7" size={56} />
              <Knob value={beatVol} min={0} max={2} step={0.01} label="Beat" onChange={handleBeatVol} color="#06b6d4" size={56} />
            </div>
          </div>

          {/* Compressor */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-4 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Compressor</span>
            <div className="flex justify-around flex-wrap gap-3">
              <Knob
                value={compThreshold}
                min={-60} max={0} step={1}
                label="Thresh" unit="dB"
                onChange={(v) => setCompThreshold(v)}
                color="#f97316" size={52}
              />
              <Knob
                value={currentPreset.compRatio}
                min={1} max={20} step={0.5}
                label="Ratio"
                onChange={() => {}}
                color="#f97316" size={52}
              />
            </div>
          </div>

          {/* Reverb */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-4 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Reverb</span>
            <div className="flex justify-around">
              <Knob
                value={reverbWet}
                min={0} max={1} step={0.01}
                label="Wet"
                onChange={(v) => { setReverbWet(v); }}
                color="#22c55e" size={52}
              />
              <Knob
                value={currentPreset.reverbDecay}
                min={0.1} max={6} step={0.1}
                label="Decay" unit="s"
                onChange={() => {}}
                color="#22c55e" size={52}
              />
            </div>
          </div>

          {/* EQ strip */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-4 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">EQ</span>
            <div className="flex justify-around flex-wrap gap-2">
              <Knob value={currentPreset.eqLowGain} min={-12} max={12} step={0.5} label="Low" unit="dB" onChange={() => {}} color="#eab308" size={48} />
              <Knob value={currentPreset.eqMidGain} min={-12} max={12} step={0.5} label="Mid" unit="dB" onChange={() => {}} color="#eab308" size={48} />
              <Knob value={currentPreset.eqHighGain} min={-12} max={12} step={0.5} label="High" unit="dB" onChange={() => {}} color="#eab308" size={48} />
            </div>
          </div>

          {/* DSP info */}
          <div className="bg-[#0a0a18] border border-[#1a1a3a] rounded-xl p-3 text-[9px] text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span>Engine</span>
              <span className="text-slate-500">
                {retuneSpeed < 15 ? "OLA Fast Path" : "Phase Vocoder"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Latency</span>
              <span className="text-slate-500">{retuneSpeed < 15 ? "~5ms" : "~23ms"}</span>
            </div>
            <div className="flex justify-between">
              <span>Sample Rate</span>
              <span className="text-slate-500">44.1 kHz</span>
            </div>
            <div className="flex justify-between">
              <span>Block Size</span>
              <span className="text-slate-500">128 samples</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
