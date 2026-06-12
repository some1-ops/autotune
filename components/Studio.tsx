"use client";
// components/Studio.tsx — VocalBooth Auto-Tune Pro UI (matches reference design)

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type PitchInfo } from "@/lib/audio/AudioEngine";

// ── Constants ──────────────────────────────────────────────────────────────
const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const SCALE_INTERVALS: Record<string, number[]> = {
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  chromatic:  [0,1,2,3,4,5,6,7,8,9,10,11],
  pentatonic: [0,2,4,7,9],
  blues:      [0,3,5,6,7,10],
  dorian:     [0,2,3,5,7,9,10],
  mixolydian: [0,2,4,5,7,9,10],
};

const SCALE_KEYS = ["major","minor","chromatic","pentatonic","blues","dorian","mixolydian"];
const SCALE_LABELS = ["Major","Minor","Chromatic","Pentatonic","Blues","Dorian","Mixolydian"];

// ── Helpers ────────────────────────────────────────────────────────────────
const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function snapToScale(hz: number, keyIdx: number, scaleId: string): number {
  if (hz <= 0) return 0;
  const ivs = SCALE_INTERVALS[scaleId] ?? SCALE_INTERVALS.chromatic;
  const midi = hzToMidi(hz);
  let best = Math.round(midi), dist = Infinity;
  for (let o = -12; o <= 12; o++) {
    const c = Math.round(midi) + o;
    if (ivs.includes(((c - keyIdx) % 12 + 12) % 12)) {
      const d = Math.abs(c - midi);
      if (d < dist) { dist = d; best = c; }
    }
  }
  return midiToHz(best);
}

// ── Inline style helpers ───────────────────────────────────────────────────
const card: React.CSSProperties = {
  width: "100%", maxWidth: "480px",
  background: "#101018", border: "1px solid #22223a", borderRadius: "14px",
  padding: "16px",
};
const cardTitle: React.CSSProperties = {
  fontSize: "0.6rem", fontFamily: "'Space Mono', monospace",
  color: "#5a5a7a", letterSpacing: "0.12em", textTransform: "uppercase",
  marginBottom: "14px",
};
const mono: React.CSSProperties = { fontFamily: "'Space Mono', monospace" };

// ── Component ──────────────────────────────────────────────────────────────
export function Studio() {
  // ── Engine ────────────────────────────────────────────────────────────────
  const engineRef = useRef<AudioEngine | null>(null);
  const [isOn, setIsOn]   = useState(false);
  const [isRec, setIsRec] = useState(false);
  const [pitchInfo, setPitchInfo]   = useState<PitchInfo | null>(null);
  const [analyser, setAnalyser]     = useState<AnalyserNode | null>(null);
  const [recordings, setRecordings] = useState<{ blob: Blob; url: string; ts: number }[]>([]);

  // ── Status ────────────────────────────────────────────────────────────────
  const [statusMsg, setStatusMsg] = useState("Load a beat, then tap START");
  const [statusDot, setStatusDot] = useState<"off"|"on"|"rec"|"warn">("off");
  const [showHttps, setShowHttps] = useState(false);

  // ── Beat (HTMLAudioElement — plays independently through headphones/speaker) ─
  const beatRef     = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [beatLoaded, setBeatLoaded]           = useState(false);
  const [beatPlaying, setBeatPlaying]         = useState(false);
  const [beatLoop, setBeatLoop]               = useState(false);
  const [beatFilename, setBeatFilename]       = useState("");
  const [beatDuration, setBeatDuration]       = useState(0);
  const [beatCurrentTime, setBeatCurrentTime] = useState(0);
  const [beatVol, setBeatVol]                 = useState(80);
  const [dragOver, setDragOver]               = useState(false);

  // ── Controls ──────────────────────────────────────────────────────────────
  const [keyIdx, setKeyIdx]     = useState(0);
  const [scaleId, setScaleId]   = useState("minor");
  const [speed, setSpeed]       = useState(55);
  const [humanize, setHumanize] = useState(15);
  const [xpose, setXpose]       = useState(0);
  const [thresh, setThresh]     = useState(8);
  const [micGain, setMicGain]   = useState(100);
  const [tuneOn, setTuneOn]     = useState(true);
  const [vibratoOn, setVibratoOn] = useState(false);
  const [bypassOn, setBypassOn]   = useState(false);

  // ── Canvas / DOM refs (direct updates avoid React render at 60fps) ────────
  const wvCanvasRef  = useRef<HTMLCanvasElement>(null);
  const pgCanvasRef  = useRef<HTMLCanvasElement>(null);
  const wvAnimRef    = useRef<number>(0);
  const pgAnimRef    = useRef<number>(0);
  const trailRef     = useRef<number[]>([]);
  const vuMicRef     = useRef<HTMLDivElement>(null);
  const vuRecRef     = useRef<HTMLDivElement>(null);

  // Mutable refs for use inside animation loops (no stale closure)
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const isRecRef     = useRef(false);
  const keyIdxRef    = useRef(0);
  const scaleIdRef   = useRef("minor");
  const pitchInfoRef = useRef<PitchInfo | null>(null);

  // Pitch display DOM refs
  const inNoteRef  = useRef<HTMLDivElement>(null);
  const inHzRef    = useRef<HTMLDivElement>(null);
  const outNoteRef = useRef<HTMLDivElement>(null);
  const outHzRef   = useRef<HTMLDivElement>(null);
  const centsNumRef = useRef<HTMLDivElement>(null);
  const mbarRef    = useRef<HTMLDivElement>(null);

  // ── Sync refs ──────────────────────────────────────────────────────────────
  useEffect(() => { analyserRef.current = analyser; }, [analyser]);
  useEffect(() => { isRecRef.current    = isRec;     }, [isRec]);
  useEffect(() => { keyIdxRef.current   = keyIdx;    }, [keyIdx]);
  useEffect(() => { scaleIdRef.current  = scaleId;   }, [scaleId]);
  useEffect(() => { pitchInfoRef.current = pitchInfo; }, [pitchInfo]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = location.protocol === "https:" ||
      ["localhost","127.0.0.1"].includes(location.hostname);
    setShowHttps(!ok);
    beatRef.current = new Audio();
  }, []);

  // Beat audio events
  useEffect(() => {
    const b = beatRef.current;
    if (!b) return;
    const onTime = () => setBeatCurrentTime(b.currentTime);
    const onMeta = () => setBeatDuration(b.duration || 0);
    const onEnd  = () => setBeatPlaying(false);
    b.addEventListener("timeupdate", onTime);
    b.addEventListener("loadedmetadata", onMeta);
    b.addEventListener("ended", onEnd);
    return () => {
      b.removeEventListener("timeupdate", onTime);
      b.removeEventListener("loadedmetadata", onMeta);
      b.removeEventListener("ended", onEnd);
    };
  }, []);

  // ── Waveform + VU + pitch display (single 60fps loop) ─────────────────────
  useEffect(() => {
    const canvas = wvCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const an = analyserRef.current;
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = "#161622";
      ctx.fillRect(0, 0, w, h);

      if (an) {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);

        // Waveform
        ctx.beginPath();
        ctx.strokeStyle = "#a855f7";
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 5;
        for (let i = 0; i < buf.length; i++) {
          const x = (i / buf.length) * w;
          const y = h / 2 + buf[i] * h * 0.38;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // VU meters
        let rms = 0;
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);
        const vuPct = Math.min(rms * 350, 100).toFixed(1);
        if (vuMicRef.current) vuMicRef.current.style.width = `${vuPct}%`;
        if (vuRecRef.current) vuRecRef.current.style.width = isRecRef.current ? `${vuPct}%` : "0%";

        // Pitch display — direct DOM for zero-lag 60fps updates
        const pi = pitchInfoRef.current;
        if (pi && pi.hz > 0 && pi.confidence > 0.4) {
          if (inNoteRef.current)  inNoteRef.current.textContent  = pi.noteName;
          if (inHzRef.current)    inHzRef.current.textContent    = `${Math.round(pi.hz)} Hz`;
          const corrHz   = snapToScale(pi.hz, keyIdxRef.current, scaleIdRef.current);
          const corrMidi = hzToMidi(corrHz);
          const corrNote = NOTES[((Math.round(corrMidi) % 12) + 12) % 12];
          if (outNoteRef.current) outNoteRef.current.textContent = corrNote;
          if (outHzRef.current)   outHzRef.current.textContent   = `${Math.round(corrHz)} Hz`;
          const c = Math.max(-50, Math.min(50, pi.cents ?? 0));
          if (centsNumRef.current) centsNumRef.current.textContent = `${c > 0 ? "+" : ""}${c}¢`;
          if (mbarRef.current) {
            const pct = (Math.abs(c) / 50) * 50;
            const col = Math.abs(c) < 10 ? "#22d3a5" : Math.abs(c) < 25 ? "#fbbf24" : "#f43f5e";
            mbarRef.current.style.width      = `${pct}%`;
            mbarRef.current.style.left       = c >= 0 ? "50%" : `${50 - pct}%`;
            mbarRef.current.style.background = col;
            mbarRef.current.style.boxShadow  = `0 0 8px ${col}`;
          }
        } else {
          if (inNoteRef.current)   inNoteRef.current.textContent   = "—";
          if (inHzRef.current)     inHzRef.current.textContent     = "— Hz";
          if (outNoteRef.current)  outNoteRef.current.textContent  = "—";
          if (outHzRef.current)    outHzRef.current.textContent    = "— Hz";
          if (centsNumRef.current) centsNumRef.current.textContent = "0¢";
          if (mbarRef.current)     mbarRef.current.style.width     = "0";
        }
      }
      wvAnimRef.current = requestAnimationFrame(draw);
    };
    wvAnimRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(wvAnimRef.current);
  }, []); // empty — all live data via refs

  // ── Pitch history graph ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = pgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf: number;
    const draw = () => {
      const trail = trailRef.current;
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = "#161622";
      ctx.fillRect(0, 0, w, h);
      // Center dashed line
      ctx.strokeStyle = "#22223a";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      ctx.setLineDash([]);
      if (trail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = "#e879f9";
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "#e879f9";
        ctx.shadowBlur = 4;
        for (let i = 0; i < trail.length; i++) {
          const x = (i / 200) * w;
          const y = h / 2 - (trail[i] / 50) * (h / 2 - 2);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Update trail when pitch changes
  useEffect(() => {
    if (pitchInfo && pitchInfo.hz > 0 && pitchInfo.confidence > 0.5) {
      trailRef.current.push(pitchInfo.cents ?? 0);
      if (trailRef.current.length > 200) trailRef.current.shift();
    }
  }, [pitchInfo]);

  // ── Worklet param sync (live while session on) ─────────────────────────────
  useEffect(() => { if (isOn) engineRef.current?.setWorkletParam("retuneSpeed", speed); }, [speed, isOn]);
  useEffect(() => { if (isOn) engineRef.current?.setWorkletParam("humanize", humanize / 100); }, [humanize, isOn]);
  useEffect(() => { if (isOn) engineRef.current?.setWorkletParam("key", keyIdx); }, [keyIdx, isOn]);
  useEffect(() => {
    if (isOn) {
      const si = SCALE_KEYS.indexOf(scaleId);
      engineRef.current?.setWorkletParam("scale", si >= 0 ? si : 4);
    }
  }, [scaleId, isOn]);
  useEffect(() => {
    if (isOn) engineRef.current?.setWorkletParam("bypass", (!tuneOn || bypassOn) ? 1 : 0);
  }, [tuneOn, bypassOn, isOn]);
  useEffect(() => { if (isOn) engineRef.current?.setWorkletParam("inputGain", micGain / 100); }, [micGain, isOn]);
  useEffect(() => {
    if (beatRef.current) beatRef.current.volume = Math.min(beatVol / 100, 1);
  }, [beatVol]);

  // ── Beat handlers ──────────────────────────────────────────────────────────
  const loadBeatFile = useCallback((file: File) => {
    const b = beatRef.current;
    if (!b) return;
    if (b.src.startsWith("blob:")) URL.revokeObjectURL(b.src);
    b.src = URL.createObjectURL(file);
    b.volume = beatVol / 100;
    setBeatLoaded(true);
    setBeatFilename(file.name);
    setBeatPlaying(false);
    setBeatCurrentTime(0);
    setStatusMsg("Beat loaded — tap START then ▶ Play");
    setStatusDot("warn");
  }, [beatVol]);

  const togglePlay = useCallback(() => {
    const b = beatRef.current;
    if (!b || !beatLoaded) return;
    if (b.paused) { b.play(); setBeatPlaying(true); }
    else { b.pause(); setBeatPlaying(false); }
  }, [beatLoaded]);

  const toggleLoop = useCallback(() => {
    const b = beatRef.current;
    if (!b) return;
    const next = !beatLoop;
    b.loop = next;
    setBeatLoop(next);
  }, [beatLoop]);

  const restartTrack = useCallback(() => {
    const b = beatRef.current;
    if (!b) return;
    b.currentTime = 0;
    if (b.paused) { b.play(); setBeatPlaying(true); }
  }, []);

  const seekTrack = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const b = beatRef.current;
    if (!b || !beatLoaded || !beatDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    b.currentTime = ((e.clientX - rect.left) / rect.width) * beatDuration;
  }, [beatLoaded, beatDuration]);

  // ── Session handlers ───────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    try {
      setStatusMsg("Requesting mic access…");
      setStatusDot("warn");
      const engine = AudioEngine.getInstance();
      engineRef.current = engine;
      engine.onPitchUpdate = setPitchInfo;
      engine.onRecordingComplete = (blob) => {
        const url = URL.createObjectURL(blob);
        setRecordings(p => [{ blob, url, ts: Date.now() }, ...p]);
      };
      if (engine.state === "idle") await engine.init();
      await engine.startMic();
      setAnalyser(engine.analyserNode);
      // Push current control values into worklet
      engine.setWorkletParam("retuneSpeed", speed);
      engine.setWorkletParam("humanize", humanize / 100);
      engine.setWorkletParam("key", keyIdx);
      engine.setWorkletParam("scale", Math.max(0, SCALE_KEYS.indexOf(scaleId)));
      engine.setWorkletParam("bypass", (!tuneOn || bypassOn) ? 1 : 0);
      engine.setWorkletParam("inputGain", micGain / 100);
      setIsOn(true);
      setStatusMsg("Live — voice processed through Auto-Tune");
      setStatusDot("on");
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Mic access denied");
      setStatusDot("warn");
    }
  }, [speed, humanize, keyIdx, scaleId, tuneOn, bypassOn, micGain]);

  const stopSession = useCallback(() => {
    if (isRec) {
      engineRef.current?.stopRecording();
      setIsRec(false);
      isRecRef.current = false;
    }
    engineRef.current?.stopMic();
    setAnalyser(null);
    setIsOn(false);
    setPitchInfo(null);
    pitchInfoRef.current = null;
    trailRef.current = [];
    setStatusMsg("Session stopped");
    setStatusDot("off");
  }, [isRec]);

  const toggleRecord = useCallback(() => {
    if (!isOn) return;
    if (isRec) {
      engineRef.current?.stopRecording();
      setIsRec(false);
      isRecRef.current = false;
      setStatusDot("on");
      setStatusMsg("Recording saved — see below");
    } else {
      engineRef.current?.startRecording();
      setIsRec(true);
      isRecRef.current = true;
      setStatusDot("rec");
      setStatusMsg("Recording…");
    }
  }, [isOn, isRec]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const scaleIvs    = SCALE_INTERVALS[scaleId] ?? SCALE_INTERVALS.chromatic;
  const progressPct = beatDuration > 0 ? (beatCurrentTime / beatDuration) * 100 : 0;

  // Dot colors
  const dotColor = statusDot === "on" ? "#22d3a5" : statusDot === "rec" ? "#f43f5e" : statusDot === "warn" ? "#fbbf24" : "#5a5a7a";
  const dotShadow = statusDot !== "off" ? `0 0 8px ${dotColor}` : "none";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:"#080810", color:"#ededf5", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", padding:"14px 12px 40px", gap:"12px", fontFamily:"'Space Grotesk', sans-serif" }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <div style={{ width:"100%", maxWidth:"480px", display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:"10px", borderBottom:"1px solid #22223a" }}>
        <div style={{ ...mono, fontSize:"1.15rem", fontWeight:700, letterSpacing:"0.04em" }}>
          VOCAL<span style={{ color:"#e879f9" }}>BOOTH</span>
        </div>
        <div style={{ ...mono, fontSize:"0.6rem", background:"#7c3aed", color:"#fff", padding:"3px 9px", borderRadius:"20px", letterSpacing:"0.1em" }}>
          AUTO-TUNE PRO
        </div>
      </div>

      {/* ══ HTTPS WARNING ═══════════════════════════════════════════════════ */}
      {showHttps && (
        <div style={{ width:"100%", maxWidth:"480px", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.3)", borderRadius:"10px", padding:"12px 14px", fontSize:"0.75rem", color:"#fbbf24", lineHeight:1.5 }}>
          <strong style={{ display:"block", marginBottom:"4px" }}>⚠️ Microphone blocked</strong>
          Open via HTTPS to enable the mic. Run <code>npm run dev</code> on localhost or deploy to Vercel for a free HTTPS link.
        </div>
      )}

      {/* ══ STATUS ══════════════════════════════════════════════════════════ */}
      <div style={{ width:"100%", maxWidth:"480px", background:"#101018", border:"1px solid #22223a", borderRadius:"10px", padding:"9px 14px", display:"flex", alignItems:"center", gap:"10px", ...mono, fontSize:"0.7rem" }}>
        <div style={{ width:"7px", height:"7px", borderRadius:"50%", flexShrink:0, transition:"background 0.3s, box-shadow 0.3s", background:dotColor, boxShadow:dotShadow, animation: statusDot==="rec" ? "vb-blink 0.7s infinite" : "none" }} />
        <div style={{ flex:1, color:"#5a5a7a" }}>{statusMsg}</div>
      </div>

      {/* ══ PITCH DISPLAY ════════════════════════════════════════════════════ */}
      <div style={card}>
        <div style={cardTitle}>Live Pitch Monitor</div>
        <div style={{ display:"flex", alignItems:"center", width:"100%" }}>

          {/* Input note */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:"3px" }}>
            <div style={{ fontSize:"0.55rem", color:"#5a5a7a", letterSpacing:"0.1em", textTransform:"uppercase" }}>You&apos;re Singing</div>
            <div ref={inNoteRef} style={{ ...mono, fontSize:"2.4rem", fontWeight:700, lineHeight:1, color:"#e879f9", textShadow:"0 0 18px rgba(168,85,247,0.35)", minWidth:"72px", textAlign:"center", transition:"color 0.15s" }}>—</div>
            <div ref={inHzRef}   style={{ ...mono, fontSize:"0.65rem", color:"#5a5a7a" }}>— Hz</div>
          </div>

          {/* Divider */}
          <div style={{ width:"1px", height:"60px", background:"#22223a", flexShrink:0, margin:"0 10px" }} />

          {/* Cents meter + pitch graph */}
          <div style={{ flex:2 }}>
            <div style={{ fontSize:"0.55rem", color:"#5a5a7a", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"6px" }}>Pitch Deviation</div>
            {/* Meter bar */}
            <div style={{ position:"relative", height:"16px", background:"#161622", borderRadius:"8px", border:"1px solid #22223a", overflow:"hidden" }}>
              <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:"1px", background:"#22223a", zIndex:2 }} />
              <div ref={mbarRef} style={{ position:"absolute", top:"3px", bottom:"3px", borderRadius:"5px", transition:"left 0.04s, width 0.04s, background 0.15s", left:"50%", width:0, background:"#22d3a5" }} />
            </div>
            <div ref={centsNumRef} style={{ ...mono, fontSize:"0.65rem", color:"#5a5a7a", marginTop:"4px" }}>0¢</div>
            {/* Pitch graph */}
            <canvas ref={pgCanvasRef} width={220} height={52} style={{ width:"100%", height:"52px", display:"block", borderRadius:"6px", marginTop:"8px", background:"#161622" }} />
          </div>

          {/* Divider */}
          <div style={{ width:"1px", height:"60px", background:"#22223a", flexShrink:0, margin:"0 10px" }} />

          {/* Corrected note */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:"3px" }}>
            <div style={{ fontSize:"0.55rem", color:"#5a5a7a", letterSpacing:"0.1em", textTransform:"uppercase" }}>Corrected To</div>
            <div ref={outNoteRef} style={{ ...mono, fontSize:"2.4rem", fontWeight:700, lineHeight:1, color:"#22d3a5", minWidth:"72px", textAlign:"center", transition:"color 0.15s" }}>—</div>
            <div ref={outHzRef}   style={{ ...mono, fontSize:"0.65rem", color:"#5a5a7a" }}>— Hz</div>
          </div>
        </div>
      </div>

      {/* ══ BACKING TRACK ════════════════════════════════════════════════════ */}
      <div style={card}>
        <div style={cardTitle}>Backing Track</div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadBeatFile(f); }}
          onClick={() => fileInputRef.current?.click()}
          style={{ border:`1.5px dashed ${dragOver ? "#a855f7" : "#22223a"}`, borderRadius:"10px", padding:"18px", textAlign:"center", cursor:"pointer", transition:"border-color 0.2s, background 0.2s", background: dragOver ? "rgba(168,85,247,0.05)" : "transparent", position:"relative" }}
        >
          <input ref={fileInputRef} type="file" accept="audio/*" style={{ display:"none" }} onChange={e => { const f = e.target.files?.[0]; if (f) loadBeatFile(f); }} />
          <div style={{ fontSize:"1.6rem", marginBottom:"6px" }}>🎵</div>
          <div style={{ fontSize:"0.8rem", color:"#5a5a7a" }}>
            <strong style={{ color:"#ededf5" }}>Tap to load your beat</strong><br/>MP3, WAV, AAC supported
          </div>
        </div>

        {/* File info */}
        {beatLoaded && (
          <div style={{ display:"flex", alignItems:"center", gap:"12px", background:"#161622", borderRadius:"10px", padding:"12px", marginTop:"10px" }}>
            <div style={{ fontSize:"1.5rem" }}>🎧</div>
            <div style={{ flex:1, overflow:"hidden" }}>
              <div style={{ fontSize:"0.8rem", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{beatFilename}</div>
              <div style={{ ...mono, fontSize:"0.65rem", color:"#5a5a7a" }}>{fmtTime(beatDuration)}</div>
            </div>
          </div>
        )}

        {/* Controls */}
        {beatLoaded && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"10px" }}>
              {[
                { label: beatPlaying ? "⏸ Pause" : "▶ Play", action: togglePlay, active: beatPlaying },
                { label: "⟳ Loop",                           action: toggleLoop,  active: beatLoop },
                { label: "↺ Restart",                        action: restartTrack, active: false },
              ].map(b => (
                <button key={b.label} onClick={b.action} style={{ flex:1, background: b.active ? "#7c3aed" : "#161622", border:`1px solid ${b.active ? "#a855f7" : "#22223a"}`, color: b.active ? "#fff" : "#ededf5", borderRadius:"8px", padding:"8px 14px", fontSize:"0.8rem", cursor:"pointer", fontFamily:"'Space Grotesk', sans-serif", transition:"all 0.2s", textAlign:"center" }}>
                  {b.label}
                </button>
              ))}
            </div>

            {/* Progress bar */}
            <div onClick={seekTrack} style={{ position:"relative", height:"4px", background:"#22223a", borderRadius:"2px", marginTop:"10px", cursor:"pointer" }}>
              <div style={{ height:"100%", background:"linear-gradient(90deg,#7c3aed,#e879f9)", borderRadius:"2px", width:`${progressPct}%`, transition:"width 0.5s linear" }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:"4px" }}>
              <span style={{ ...mono, fontSize:"0.6rem", color:"#5a5a7a" }}>{fmtTime(beatCurrentTime)}</span>
              <span style={{ ...mono, fontSize:"0.6rem", color:"#5a5a7a" }}>{fmtTime(beatDuration)}</span>
            </div>

            {/* Volume */}
            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"8px" }}>
              <div style={{ fontSize:"0.7rem", color:"#5a5a7a", minWidth:"80px" }}>Beat Volume</div>
              <input type="range" className="vb-slider" min="0" max="150" value={beatVol} onChange={e => setBeatVol(Number(e.target.value))} style={{ flex:1 }} />
              <div style={{ ...mono, fontSize:"0.65rem", minWidth:"34px", textAlign:"right" }}>{beatVol}%</div>
            </div>
          </>
        )}
      </div>

      {/* ══ AUTO-TUNE SETTINGS ═══════════════════════════════════════════════ */}
      <div style={card}>
        <div style={cardTitle}>Auto-Tune Engine</div>

        {/* Key + Scale */}
        <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
          <select className="vb-select" value={keyIdx} onChange={e => setKeyIdx(Number(e.target.value))}>
            {NOTES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select className="vb-select" value={scaleId} onChange={e => setScaleId(e.target.value)}>
            {SCALE_KEYS.map((k, i) => <option key={k} value={k}>{SCALE_LABELS[i]}</option>)}
          </select>
        </div>

        {/* Scale dots */}
        <div style={{ display:"flex", gap:"4px", flexWrap:"wrap", marginBottom:"14px" }}>
          {NOTES.map((n, i) => {
            const lit = scaleIvs.includes(((i - keyIdx) % 12 + 12) % 12);
            return (
              <div key={n} style={{ width:"30px", height:"30px", borderRadius:"6px", background: lit ? "#7c3aed" : "#161622", border:`1px solid ${lit ? "#a855f7" : "#22223a"}`, display:"flex", alignItems:"center", justifyContent:"center", ...mono, fontSize:"0.55rem", color: lit ? "#fff" : "#5a5a7a", transition:"all 0.2s", boxShadow: lit ? "0 0 8px rgba(168,85,247,0.35)" : "none" }}>
                {n}
              </div>
            );
          })}
        </div>

        {/* Sliders */}
        {[
          { label:"Retune Speed",            value:speed,    set:setSpeed,    min:1,   max:100, suffix:"" },
          { label:"Humanize",                value:humanize, set:setHumanize, min:0,   max:100, suffix:"" },
          { label:"Transpose (semitones)",   value:xpose,    set:setXpose,    min:-12, max:12,  suffix:" st" },
          { label:"Correction Threshold",    value:thresh,   set:setThresh,   min:0,   max:50,  suffix:"¢" },
        ].map(s => (
          <div key={s.label} style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"10px" }}>
            <div style={{ fontSize:"0.72rem", color:"#5a5a7a", flex:1 }}>{s.label}</div>
            <input type="range" className="vb-slider" min={s.min} max={s.max} value={s.value}
              onChange={e => s.set(Number(e.target.value))} style={{ flex:2 }} />
            <div style={{ ...mono, fontSize:"0.65rem", minWidth:"38px", textAlign:"right" }}>{s.value}{s.suffix}</div>
          </div>
        ))}

        {/* Toggles */}
        <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap" }}>
          {[
            { label: tuneOn ? "Auto-Tune ON" : "Auto-Tune OFF", active:tuneOn,    action:() => setTuneOn(!tuneOn) },
            { label: "Vibrato",                                  active:vibratoOn, action:() => setVibratoOn(!vibratoOn) },
            { label: "Bypass",                                   active:bypassOn,  action:() => setBypassOn(!bypassOn) },
          ].map(t => (
            <button key={t.label} onClick={t.action} style={{ flex:1, padding:"8px", borderRadius:"8px", border:`1px solid ${t.active ? "#a855f7" : "#22223a"}`, background: t.active ? "#7c3aed" : "#161622", color: t.active ? "#fff" : "#5a5a7a", fontFamily:"'Space Grotesk', sans-serif", fontSize:"0.72rem", cursor:"pointer", transition:"all 0.2s", textAlign:"center", boxShadow: t.active ? "0 0 10px rgba(168,85,247,0.35)" : "none" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ WAVEFORM + VU ════════════════════════════════════════════════════ */}
      <div style={card}>
        <div style={cardTitle}>
          Mic Input Monitor{" "}
          <span style={{ textTransform:"none", opacity:0.6 }}>(your voice only — not in your ears)</span>
        </div>
        <canvas ref={wvCanvasRef} width={448} height={64} style={{ width:"100%", height:"64px", display:"block", borderRadius:"6px", background:"#161622" }} />

        {/* VU meters */}
        {[{ label:"MIC", ref:vuMicRef }, { label:"REC", ref:vuRecRef }].map(v => (
          <div key={v.label} style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"8px" }}>
            <div style={{ ...mono, fontSize:"0.6rem", color:"#5a5a7a", minWidth:"24px" }}>{v.label}</div>
            <div style={{ flex:1, height:"6px", background:"#161622", borderRadius:"3px", overflow:"hidden" }}>
              <div ref={v.ref} style={{ height:"100%", borderRadius:"3px", background:"linear-gradient(90deg,#22d3a5,#fbbf24,#f43f5e)", width:"0%", transition:"width 0.05s" }} />
            </div>
          </div>
        ))}

        {/* Mic gain */}
        <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"10px" }}>
          <div style={{ fontSize:"0.7rem", color:"#5a5a7a", minWidth:"80px" }}>Mic Input Gain</div>
          <input type="range" className="vb-slider" min="0" max="300" value={micGain}
            onChange={e => setMicGain(Number(e.target.value))} style={{ flex:1 }} />
          <div style={{ ...mono, fontSize:"0.65rem", minWidth:"34px", textAlign:"right" }}>{micGain}%</div>
        </div>
      </div>

      {/* ══ TRANSPORT BUTTONS ════════════════════════════════════════════════ */}
      <div style={{ width:"100%", maxWidth:"480px", display:"flex", gap:"10px" }}>
        {/* START */}
        <button
          id="start-btn"
          onClick={startSession}
          disabled={isOn}
          style={{ flex:1, padding:"15px 10px", borderRadius:"12px", border:"none", fontFamily:"'Space Grotesk', sans-serif", fontSize:"0.88rem", fontWeight:600, cursor: isOn ? "not-allowed" : "pointer", transition:"all 0.2s", letterSpacing:"0.02em", background:"linear-gradient(135deg,#7c3aed,#a855f7)", color:"#fff", boxShadow:"0 4px 20px rgba(168,85,247,0.35)", opacity: isOn ? 0.35 : 1, animation: !isOn ? "vb-startpulse 2s infinite" : "none" }}
        >▶ START</button>

        {/* REC */}
        <button
          id="rec-btn"
          onClick={toggleRecord}
          disabled={!isOn}
          style={{ flex:1, padding:"15px 10px", borderRadius:"12px", border:`1px solid ${isRec ? "#f43f5e" : "rgba(244,63,94,0.3)"}`, fontFamily:"'Space Grotesk', sans-serif", fontSize:"0.88rem", fontWeight:600, cursor: !isOn ? "not-allowed" : "pointer", transition:"all 0.2s", letterSpacing:"0.02em", background: isRec ? "rgba(244,63,94,0.15)" : "#101018", color:"#f43f5e", opacity: !isOn ? 0.3 : 1, animation: isRec ? "vb-recpulse 1s infinite" : "none" }}
        >⏺ REC</button>

        {/* STOP */}
        <button
          id="stop-btn"
          onClick={stopSession}
          disabled={!isOn}
          style={{ flex:1, padding:"15px 10px", borderRadius:"12px", border:"1px solid #22223a", fontFamily:"'Space Grotesk', sans-serif", fontSize:"0.88rem", fontWeight:600, cursor: !isOn ? "not-allowed" : "pointer", transition:"all 0.2s", letterSpacing:"0.02em", background:"#101018", color:"#ededf5", opacity: !isOn ? 0.3 : 1 }}
        >■ STOP</button>
      </div>

      {/* ══ RECORDINGS ═══════════════════════════════════════════════════════ */}
      {recordings.length > 0 && (
        <div style={{ width:"100%", maxWidth:"480px" }}>
          <div style={{ ...mono, fontSize:"0.6rem", color:"#5a5a7a", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"8px" }}>Recordings</div>
          {recordings.map(rec => (
            <div key={rec.ts} style={{ display:"flex", alignItems:"center", gap:"10px", background:"#101018", border:"1px solid #22223a", borderRadius:"10px", padding:"10px", marginBottom:"8px" }}>
              <audio controls src={rec.url} style={{ flex:1, height:"32px", accentColor:"#a855f7" }} />
              <button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = rec.url;
                  a.download = `vocal-${rec.ts}.webm`;
                  a.click();
                }}
                style={{ padding:"8px 12px", borderRadius:"8px", background:"rgba(168,85,247,0.15)", border:"1px solid rgba(168,85,247,0.3)", color:"#e879f9", fontSize:"0.75rem", cursor:"pointer", fontFamily:"'Space Grotesk', sans-serif", whiteSpace:"nowrap" }}
              >↓ Export</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
