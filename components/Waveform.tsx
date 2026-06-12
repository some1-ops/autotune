"use client";
// components/Waveform.tsx — Dual-channel canvas waveform + beat visualizer

import { useEffect, useRef } from "react";

interface WaveformProps {
  analyser: AnalyserNode | null;
  beatAnalyser: AnalyserNode | null;
  isRecording: boolean;
}

export function Waveform({ analyser, beatAnalyser, isRecording }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vocBuf = analyser ? new Float32Array(analyser.fftSize) : null;
    const beatBuf = beatAnalyser ? new Float32Array(beatAnalyser.fftSize) : null;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Dark fade trail
      ctx.fillStyle = "rgba(8, 8, 20, 0.4)";
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = "#1a1a3a";
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Recording pulse dot
      if (isRecording) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
        ctx.fillStyle = `rgba(239, 68, 68, ${pulse})`;
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 12 * pulse;
        ctx.beginPath();
        ctx.arc(w - 20, 16, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Beat waveform (bottom half, subtle teal)
      if (beatAnalyser && beatBuf) {
        beatAnalyser.getFloatTimeDomainData(beatBuf);
        ctx.beginPath();
        ctx.strokeStyle = "#0891b240";
        ctx.lineWidth = 1.5;
        const sliceW = w / beatBuf.length;
        for (let i = 0; i < beatBuf.length; i++) {
          const y = h * 0.75 + (beatBuf[i] * h * 0.2);
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * sliceW, y);
        }
        ctx.stroke();
      }

      // Vocal waveform (top half, purple glow)
      if (analyser && vocBuf) {
        analyser.getFloatTimeDomainData(vocBuf);

        // Glow pass
        ctx.beginPath();
        ctx.strokeStyle = "#a855f760";
        ctx.lineWidth = 4;
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 16;
        const sliceW = w / vocBuf.length;
        for (let i = 0; i < vocBuf.length; i++) {
          const y = h * 0.25 + (vocBuf[i] * h * 0.22);
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * sliceW, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Sharp line pass
        ctx.beginPath();
        ctx.strokeStyle = "#c084fc";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < vocBuf.length; i++) {
          const y = h * 0.25 + (vocBuf[i] * h * 0.22);
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * sliceW, y);
        }
        ctx.stroke();
      }

      // Divider line
      ctx.strokeStyle = "#1a1a3a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Labels
      ctx.fillStyle = "#4a4a6a";
      ctx.font = "10px monospace";
      ctx.fillText("VOCAL", 8, 16);
      ctx.fillText("BEAT", 8, h / 2 + 16);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [analyser, beatAnalyser, isRecording]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-[#1a1a3a] bg-[#080814]">
      <canvas
        ref={canvasRef}
        width={800}
        height={160}
        className="w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
