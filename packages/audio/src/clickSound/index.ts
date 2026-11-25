/** Sounds available to both the recording click and the playback metronome. */
export const CLICK_SOUNDS = ["tick", "woodblock", "beep"] as const;
export type ClickSound = (typeof CLICK_SOUNDS)[number];
export const DEFAULT_CLICK_SOUND: ClickSound = "tick";

/** Voices are ordered as accent, beat, and subdivision. */
export type ClickVoices = readonly [Float32Array, Float32Array, Float32Array];

export function isClickSound(value: unknown): value is ClickSound {
  return CLICK_SOUNDS.some((sound) => sound === value);
}

const GAINS = [0.9, 0.6, 0.3] as const;
const BEEP_SPECS = [
  [1760, 0.04],
  [880, 0.03],
  [660, 0.02],
] as const;

function beepVoice(sampleRate: number, level: number): Float32Array {
  const [frequency, duration] = BEEP_SPECS[level]!;
  const samples = new Float32Array(Math.max(1, Math.ceil(duration * sampleRate)));
  const decay = Math.log(1000) / samples.length;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = GAINS[level]! * Math.sin((2 * Math.PI * frequency * i) / sampleRate) * Math.exp(-decay * i);
  }
  return samples;
}

function percussiveVoice(sampleRate: number, sound: "tick" | "woodblock", level: number): Float32Array {
  const duration = sound === "tick" ? 0.02 : 0.045;
  const samples = new Float32Array(Math.max(1, Math.ceil(duration * sampleRate)));
  const fast = 1 - Math.exp((-2 * Math.PI * 6500) / sampleRate);
  const slow = 1 - Math.exp((-2 * Math.PI * 900) / sampleRate);
  const brightness = [1, 0.8, 0.65][level]!;
  let seed = 0x9e3779b9;
  let highBand = 0;
  let lowBand = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    highBand += fast * (noise - highBand);
    lowBand += slow * (highBand - lowBand);
    const attack = Math.min(1, time / 0.00025);
    const release = Math.min(1, (samples.length - 1 - i) / (0.002 * sampleRate));
    const transient = (highBand - lowBand) * brightness;
    const value =
      sound === "tick"
        ? transient * 0.8 * Math.exp(-time / 0.0035) +
          Math.sin(2 * Math.PI * 2200 * time) * 0.2 * Math.exp(-time / 0.0045) +
          Math.sin(2 * Math.PI * 3470 * time) * 0.08 * Math.exp(-time / 0.0025)
        : transient * 0.2 * Math.exp(-time / 0.0025) +
          Math.sin(2 * Math.PI * 1050 * time) * 0.55 * Math.exp(-time / 0.011) +
          Math.sin(2 * Math.PI * 1660 * time) * 0.3 * Math.exp(-time / 0.008) +
          Math.sin(2 * Math.PI * 2750 * time) * 0.15 * Math.exp(-time / 0.004);
    samples[i] = value * attack * release;
    peak = Math.max(peak, Math.abs(samples[i]!));
  }
  if (peak > 0) {
    const scale = GAINS[level]! / peak;
    for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * scale;
  }
  return samples;
}

/** Generate short, deterministic voices before any clicks are scheduled. */
export function synthesizeClickVoices(sampleRate: number, sound: ClickSound): ClickVoices {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError("Click sample rate must be positive");
  if (!isClickSound(sound)) throw new RangeError(`Unknown click sound: ${String(sound)}`);
  const voice = (level: number) =>
    sound === "beep" ? beepVoice(sampleRate, level) : percussiveVoice(sampleRate, sound, level);
  return [voice(0), voice(1), voice(2)];
}
