export function applyMasterVolume(masterOutput: GainNode | null, volume: number): number {
  const clamped = Math.max(0, Math.min(1, volume));
  if (masterOutput) {
    const now = masterOutput.context.currentTime;
    masterOutput.gain.cancelScheduledValues(now);
    masterOutput.gain.setValueAtTime(clamped, now);
  }
  return clamped;
}
