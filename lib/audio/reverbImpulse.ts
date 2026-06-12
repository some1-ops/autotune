// lib/audio/reverbImpulse.ts
// Programmatic impulse response generation — no external IR file needed.
// Uses exponential decay noise for a convincing room/studio reverb.

export function generateReverbIR(
  audioCtx: AudioContext | OfflineAudioContext,
  decaySeconds: number,
  wet: number
): AudioBuffer {
  if (wet <= 0) {
    // Return a silent 1-sample buffer when reverb is off
    const silent = audioCtx.createBuffer(2, 1, audioCtx.sampleRate);
    return silent;
  }

  const sampleRate = audioCtx.sampleRate;
  const length = Math.round(sampleRate * decaySeconds);
  const buffer = audioCtx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      // Exponential decay noise
      const decay = Math.pow(1 - i / length, 3);
      // Add slight early reflections in first 50ms
      const earlyReflection = i < sampleRate * 0.05 ? Math.random() * 0.3 : 0;
      channelData[i] = (Math.random() * 2 - 1) * decay * wet + earlyReflection;
    }
    // Normalize
    let max = 0;
    for (let i = 0; i < length; i++) max = Math.max(max, Math.abs(channelData[i]));
    if (max > 0) {
      for (let i = 0; i < length; i++) channelData[i] /= max;
    }
    // Apply wet level
    for (let i = 0; i < length; i++) channelData[i] *= wet;
  }

  return buffer;
}
