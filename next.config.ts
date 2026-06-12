import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for AudioWorklet + SharedArrayBuffer cross-origin isolation
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  // Worklet processors are plain JS in /public — no webpack bundling needed
  turbopack: {},
};

export default nextConfig;
