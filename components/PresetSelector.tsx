"use client";
// components/PresetSelector.tsx — Genre preset dropdown with one-click apply

import { useState } from "react";
import { PRESETS, type VocalPreset } from "@/lib/audio/presets";

interface PresetSelectorProps {
  onSelect: (preset: VocalPreset) => void;
  currentPreset: VocalPreset | null;
}

const GENRE_COLORS: Record<string, string> = {
  "UK Rap": "#a855f7",
  "Drill": "#ef4444",
  "Melodic Rap": "#22c55e",
  "Trap": "#f97316",
  "General": "#64748b",
};

export function PresetSelector({ onSelect, currentPreset }: PresetSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        id="preset-selector-btn"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#0f0f1f] border border-[#2a2a4a] rounded-xl hover:border-purple-500/50 transition-all group"
      >
        <div className="flex flex-col items-start">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Vocal Preset</span>
          <span className="text-sm font-semibold text-white">
            {currentPreset?.name ?? "Select Preset"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {currentPreset && (
            <span
              className="text-[9px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
              style={{
                color: GENRE_COLORS[currentPreset.genre] ?? "#64748b",
                backgroundColor: `${GENRE_COLORS[currentPreset.genre] ?? "#64748b"}20`,
                border: `1px solid ${GENRE_COLORS[currentPreset.genre] ?? "#64748b"}40`,
              }}
            >
              {currentPreset.genre}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-[#0d0d1f] border border-[#2a2a4a] rounded-xl overflow-hidden shadow-2xl shadow-black/60">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              id={`preset-${preset.name.replace(/\s+/g, "-").toLowerCase()}`}
              onClick={() => {
                onSelect(preset);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-[#1a1a3a] transition-colors border-b border-[#1a1a2e] last:border-0 ${currentPreset?.name === preset.name ? "bg-[#1a1a3a]" : ""}`}
            >
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{preset.name}</span>
                  {currentPreset?.name === preset.name && (
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-0.5">{preset.description}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium uppercase"
                  style={{
                    color: GENRE_COLORS[preset.genre] ?? "#64748b",
                    backgroundColor: `${GENRE_COLORS[preset.genre] ?? "#64748b"}15`,
                  }}
                >
                  {preset.genre}
                </span>
                <span className="text-[9px] text-slate-600">
                  {preset.retuneSpeed === 0 ? "Robotic" : preset.retuneSpeed < 20 ? "Tight" : preset.retuneSpeed < 60 ? "Musical" : "Natural"}
                  {" · "}
                  {preset.reverbWet > 0.3 ? "Wet" : preset.reverbWet > 0.15 ? "Room" : "Dry"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
