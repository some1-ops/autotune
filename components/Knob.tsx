"use client";
// components/Knob.tsx — SVG rotary knob with mouse/touch drag

import { useCallback, useEffect, useRef, useState } from "react";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  unit?: string;
  size?: number;
  color?: string;
  onChange: (val: number) => void;
}

export function Knob({
  value,
  min,
  max,
  step = 0.01,
  label,
  unit = "",
  size = 64,
  color = "#a855f7",
  onChange,
}: KnobProps) {
  const startY = useRef<number | null>(null);
  const startValue = useRef<number>(value);
  const [isDragging, setIsDragging] = useState(false);

  // Map value to rotation angle [-135°, 135°]
  const normalised = (value - min) / (max - min);
  const angle = -135 + normalised * 270;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startY.current = e.clientY;
      startValue.current = value;
      setIsDragging(true);
    },
    [value]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (startY.current === null) return;
      const delta = (startY.current - e.clientY) / 200; // pixels → normalized
      const range = max - min;
      const newValue = Math.min(max, Math.max(min, startValue.current + delta * range));
      const stepped = Math.round(newValue / step) * step;
      onChange(parseFloat(stepped.toFixed(6)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      startY.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, min, max, step, onChange]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const trackR = r;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Arc path
  const startAngle = -135;
  const endAngle = angle;
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  const sx = cx + trackR * Math.cos(toRad(startAngle - 90));
  const sy = cy + trackR * Math.sin(toRad(startAngle - 90));
  const ex = cx + trackR * Math.cos(toRad(endAngle - 90));
  const ey = cy + trackR * Math.sin(toRad(endAngle - 90));

  // Indicator dot
  const dotX = cx + (r - 6) * Math.cos(toRad(angle - 90));
  const dotY = cy + (r - 6) * Math.sin(toRad(angle - 90));

  const displayValue =
    max >= 100
      ? Math.round(value).toString()
      : value < 1
      ? value.toFixed(2)
      : value.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        width={size}
        height={size}
        onMouseDown={handleMouseDown}
        className={`cursor-ns-resize transition-transform ${isDragging ? "scale-105" : "hover:scale-105"}`}
        style={{ filter: isDragging ? `drop-shadow(0 0 8px ${color})` : undefined }}
      >
        {/* Background circle */}
        <circle cx={cx} cy={cy} r={r + 4} fill="#1a1a2e" stroke="#2a2a4a" strokeWidth="1" />

        {/* Track */}
        <circle cx={cx} cy={cy} r={trackR} fill="none" stroke="#2a2a4a" strokeWidth="4"
          strokeDasharray={`${0.75 * 2 * Math.PI * trackR} ${0.25 * 2 * Math.PI * trackR}`}
          strokeDashoffset={0.375 * 2 * Math.PI * trackR}
          strokeLinecap="round" />

        {/* Active arc */}
        {endAngle > startAngle && (
          <path
            d={`M ${sx} ${sy} A ${trackR} ${trackR} 0 ${largeArc} 1 ${ex} ${ey}`}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
          />
        )}

        {/* Indicator */}
        <circle cx={dotX} cy={dotY} r="3" fill={color} />
        <circle cx={cx} cy={cy} r={r * 0.45} fill="#0f0f1a" />
      </svg>

      <span className="text-xs font-mono text-purple-300 leading-none">
        {displayValue}{unit}
      </span>
      <span className="text-[10px] text-slate-500 leading-none uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
