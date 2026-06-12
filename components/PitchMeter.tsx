"use client";
// components/PitchMeter.tsx — Real-time pitch display with cents indicator

import { useEffect, useRef } from "react";
import type { PitchInfo } from "@/lib/audio/AudioEngine";

interface PitchMeterProps {
  pitchInfo: PitchInfo | null;
}

const NOTE_COLORS: Record<string, string> = {
  "C":  "#ef4444",
  "C#": "#f97316",
  "D":  "#eab308",
  "D#": "#84cc16",
  "E":  "#22c55e",
  "F":  "#06b6d4",
  "F#": "#3b82f6",
  "G":  "#6366f1",
  "G#": "#8b5cf6",
  "A":  "#a855f7",
  "A#": "#ec4899",
  "B":  "#f43f5e",
};

export function PitchMeter({ pitchInfo }: PitchMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const centsRef = useRef<number>(0);

  useEffect(() => {
    if (pitchInfo) {
      centsRef.current = pitchInfo.cents ?? 0;
    }
  }, [pitchInfo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "#0a0a14";
      ctx.fillRect(0, 0, w, h);

      // Center line
      const cx = w / 2;
      ctx.strokeStyle = "#2a2a4a";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, 4);
      ctx.lineTo(cx, h - 4);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tick marks: -50, -25, 0, +25, +50 cents
      for (const tick of [-50, -25, 0, 25, 50]) {
        const x = cx + (tick / 50) * (cx - 16);
        ctx.fillStyle = tick === 0 ? "#4a4a7a" : "#2a2a4a";
        ctx.fillRect(x - 0.5, h - 10, 1, 8);
      }

      // Cents bar
      const cents = centsRef.current;
      const barW = Math.abs((cents / 50) * (cx - 16));
      const barX = cents >= 0 ? cx : cx - barW;
      const hue = Math.abs(cents) < 10 ? "#22c55e" : Math.abs(cents) < 25 ? "#eab308" : "#ef4444";

      ctx.fillStyle = hue;
      ctx.shadowColor = hue;
      ctx.shadowBlur = 8;
      ctx.fillRect(barX, h / 2 - 3, barW, 6);
      ctx.shadowBlur = 0;

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const noteColor = pitchInfo?.noteName ? NOTE_COLORS[pitchInfo.noteName] ?? "#a855f7" : "#4a4a7a";
  const noteName = pitchInfo?.noteName ?? "--";
  const noteOctave = pitchInfo?.noteOctave ?? "";
  const hz = pitchInfo?.hz ? `${Math.round(pitchInfo.hz)} Hz` : "-- Hz";
  const confidence = pitchInfo?.confidence ?? 0;

  return (
    <div className="flex flex-col gap-2 bg-[#0a0a14] border border-[#1a1a3a] rounded-xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-slate-500">Detected Pitch</span>
        <div className="flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full transition-all duration-100"
            style={{ backgroundColor: confidence > 0.5 ? "#22c55e" : "#2a2a4a", boxShadow: confidence > 0.5 ? "0 0 6px #22c55e" : "none" }}
          />
          <span className="text-[10px] text-slate-600">{confidence > 0.5 ? "DETECTED" : "SILENT"}</span>
        </div>
      </div>

      {/* Big note display */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-5xl font-black leading-none transition-colors duration-100"
          style={{ color: noteColor, textShadow: `0 0 20px ${noteColor}60` }}
        >
          {noteName}
        </span>
        <span className="text-2xl font-light text-slate-400">{noteOctave}</span>
        <span className="text-sm text-slate-500 ml-auto">{hz}</span>
      </div>

      {/* Cents meter */}
      <canvas ref={canvasRef} width={280} height={32} className="w-full rounded" style={{ imageRendering: "pixelated" }} />
      <div className="flex justify-between text-[9px] text-slate-600">
        <span>♭ flat</span>
        <span>in tune</span>
        <span>sharp ♯</span>
      </div>
    </div>
  );
}
