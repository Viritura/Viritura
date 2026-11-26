/** Sounds available to both the recording click and the playback metronome. */
export const CLICK_SOUNDS = ["oscillator", "tick", "woodblock"] as const;
export type ClickSound = (typeof CLICK_SOUNDS)[number];
export const DEFAULT_CLICK_SOUND: ClickSound = "oscillator";

/** Voices are ordered as accent, beat, and subdivision. */
export type ClickVoices = readonly [Float32Array, Float32Array, Float32Array];

export function isClickSound(value: unknown): value is ClickSound {
  return CLICK_SOUNDS.some((sound) => sound === value);
}

const GAINS = [0.9, 0.6, 0.3] as const;
const OSCILLATOR_SPECS = [
  [880, 0.05, 0.8],
  [440, 0.03, 0.4],
  [440, 0.03, 0.2],
] as const;

function sineVoice(sampleRate: number, level: number): Float32Array {
  const [frequency, duration, gain] = OSCILLATOR_SPECS[level]!;
  const samples = new Float32Array(Math.max(1, Math.ceil(duration * sampleRate)));
  const decay = Math.log(gain / 0.001) / (duration * sampleRate);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = gain * Math.sin((2 * Math.PI * frequency * i) / sampleRate) * Math.exp(-decay * i);
  }
  return samples;
}

interface PercussiveSpec {
  /** Resonant pitch of the voice; accent sits a fifth above the beat and subdivision a fourth below it. */
  readonly pitch: number;
  readonly duration: number;
  /** Multiplies every decay constant so lower levels are drier as well as quieter. */
  readonly ring: number;
  readonly brightness: number;
}

const PERCUSSIVE_SPECS: Record<"tick" | "woodblock", readonly [PercussiveSpec, PercussiveSpec, PercussiveSpec]> = {
  tick: [
    { pitch: 3300, duration: 0.024, ring: 1.4, brightness: 1 },
    { pitch: 2200, duration: 0.02, ring: 1, brightness: 0.75 },
    { pitch: 1650, duration: 0.012, ring: 0.6, brightness: 0.35 },
  ],
  woodblock: [
    { pitch: 1575, duration: 0.05, ring: 1.3, brightness: 1 },
    { pitch: 1050, duration: 0.045, ring: 1, brightness: 0.7 },
    { pitch: 790, duration: 0.025, ring: 0.55, brightness: 0.3 },
  ],
};

function percussiveVoice(sampleRate: number, sound: "tick" | "woodblock", level: number): Float32Array {
  const { pitch, duration, ring, brightness } = PERCUSSIVE_SPECS[sound][level]!;
  const samples = new Float32Array(Math.max(1, Math.ceil(duration * sampleRate)));
  const fast = 1 - Math.exp((-2 * Math.PI * 6500) / sampleRate);
  const slow = 1 - Math.exp((-2 * Math.PI * 900) / sampleRate);
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
        ? transient * 0.8 * Math.exp(-time / (0.0035 * ring)) +
          Math.sin(2 * Math.PI * pitch * time) * 0.3 * Math.exp(-time / (0.0045 * ring)) +
          Math.sin(2 * Math.PI * pitch * 1.577 * time) * 0.08 * Math.exp(-time / (0.0025 * ring))
        : transient * 0.2 * Math.exp(-time / 0.0025) +
          Math.sin(2 * Math.PI * pitch * time) * 0.55 * Math.exp(-time / (0.011 * ring)) +
          Math.sin(2 * Math.PI * pitch * 1.581 * time) * 0.3 * Math.exp(-time / (0.008 * ring)) +
          Math.sin(2 * Math.PI * pitch * 2.619 * time) * 0.15 * Math.exp(-time / (0.004 * ring));
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
    sound === "oscillator" ? sineVoice(sampleRate, level) : percussiveVoice(sampleRate, sound, level);
  return [voice(0), voice(1), voice(2)];
}
