import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoTune Studio — Professional Browser Vocal Processing",
  description:
    "Professional-grade real-time autotune in the browser. UK Rap, Melodic Drill, and Trap vocal presets. Powered by Web Audio API AudioWorklet DSP.",
  keywords: ["autotune", "vocal processing", "web audio", "uk rap", "drill", "trap", "pitch correction"],
  openGraph: {
    title: "AutoTune Studio",
    description: "Professional browser-based vocal autotune with real-time pitch correction",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
