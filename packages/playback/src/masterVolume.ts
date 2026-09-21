export function applyMasterVolume(masterOutput: GainNode | null, volume: number): number {
  const clamped = Math.max(0, Math.min(1, volume));
  if (masterOutput) {
    const now = masterOutput.context.currentTime;
    if (
      typeof masterOutput.gain.cancelScheduledValues === "function" &&
      typeof masterOutput.gain.setValueAtTime === "function"
    ) {
      masterOutput.gain.cancelScheduledValues(now);
      masterOutput.gain.setValueAtTime(clamped, now);
    } else {
      masterOutput.gain.value = clamped;
    }
  }
  return clamped;
}
