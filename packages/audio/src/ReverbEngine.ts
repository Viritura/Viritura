/**
 * ReverbEngine — convolution reverb using impulse response recordings.
 *
 * Uses a ConvolverNode with real room/hall impulse responses for
 * realistic acoustic space simulation.
 *
 * Architecture:
 *   per-instrument output → reverbSendGain → ConvolverNode → wetGain → destination
 *                         → (dry signal goes directly to destination via PannerNode)
 *
 * Each instrument has a "send level" controlling how much signal goes to reverb.
 * The wet/dry balance is controlled by the wetGain node.
 *
 * IR recordings from Voxengo Free Impulse Responses:
 * https://www.voxengo.com/free/impulseresponses/
 * Licensed for free use in any project.
 */

/** Available reverb presets. */
export interface ReverbPreset {
  /** Unique ID. */
  id: string;
  /** Display name. */
  name: string;
  /** URL to the impulse response WAV file. */
  url: string;
  /** Description of the space. */
  description: string;
}

/** Built-in reverb presets.
 *
 * `url` is stored relative (no leading slash) so that callers can resolve it
 * against the app's Vite `BASE_URL` (e.g. `/` in dev, `/app/` on the
 * deployed site). See {@link ReverbEngine.loadPreset} for the join.
 */
export const REVERB_PRESETS: ReverbPreset[] = [
  {
    id: "musikvereinsaal",
    name: "Vienna Musikverein",
    url: "sounds/ir/musikvereinsaal.wav",
    description: "One of the world's finest concert halls. Rich, warm orchestral reverb.",
  },
  {
    id: "scala-milan",
    name: "La Scala, Milan",
    url: "sounds/ir/scala-milan-opera.wav",
    description: "Historic Italian opera house. Bright, clear reverb.",
  },
  {
    id: "french-salon",
    name: "French 18th Century Salon",
    url: "sounds/ir/french-salon.wav",
    description: "Elegant chamber music venue. Intimate, refined reverb.",
  },
  {
    id: "masonic-lodge",
    name: "Masonic Lodge",
    url: "sounds/ir/masonic-lodge.wav",
    description: "Medium room with warm acoustics. Good for smaller ensembles.",
  },
  {
    id: "st-nicolaes",
    name: "St. Nicolaes Church",
    url: "sounds/ir/st-nicolaes-church.wav",
    description: "Large church with very long reverb. Best for choral and organ works.",
  },
  {
    id: "none",
    name: "No Reverb",
    url: "",
    description: "Dry signal only — no room simulation.",
  },
];

export class ReverbEngine {
  private readonly ctx: AudioContext;
  private readonly wetGain: GainNode;
  private readonly reverbHPF: BiquadFilterNode;
  private readonly inputNode: GainNode;
  private convolver: ConvolverNode | null = null;
  private currentPresetId = "__unloaded__";
  private cachedIRBuffers = new Map<string, AudioBuffer>();
  private _wetLevel = 0.25;

  constructor(ctx: AudioContext, destination?: AudioNode) {
    this.ctx = ctx;
    const dest = destination ?? ctx.destination;

    // Input mixer — all reverb sends connect here.
    // Gain of 4.0 so the slider at ~25% gives a natural reverb level.
    this.inputNode = ctx.createGain();
    this.inputNode.gain.value = 4;

    // Reverb return HPF — removes sub-200 Hz content from the wet signal
    // to prevent low-frequency mud buildup (standard orchestral mixing practice).
    this.reverbHPF = ctx.createBiquadFilter();
    this.reverbHPF.type = "highpass";
    this.reverbHPF.frequency.value = 200;
    this.reverbHPF.Q.value = 0.707; // Butterworth (no resonant peak)
    this.reverbHPF.connect(dest);

    // Wet output — controls reverb return volume (additive on top of dry).
    // Safe because ConvolverNode.normalize = true keeps IR energy at unity.
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = this._wetLevel;
    this.wetGain.connect(this.reverbHPF);
  }

  /** The input node that reverb sends should connect to. */
  get input(): GainNode {
    return this.inputNode;
  }

  /** Current preset ID. */
  get presetId(): string {
    return this.currentPresetId;
  }

  /** Set the reverb wet volume (0 = no reverb, 1 = full reverb return). */
  setWetLevel(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    this._wetLevel = clamped;
    this.wetGain.gain.setValueAtTime(clamped, this.ctx.currentTime);
  }

  /** Get current wet level. */
  get wetLevel(): number {
    return this._wetLevel;
  }

  /** Load a reverb preset by fetching its impulse response. */
  async loadPreset(preset: ReverbPreset): Promise<void> {
    this.currentPresetId = preset.id;

    if (preset.id === "none") {
      // Disconnect any active convolver
      if (this.convolver) {
        try {
          this.inputNode.disconnect(this.convolver);
        } catch {
          /* ok */
        }
        try {
          this.convolver.disconnect();
        } catch {
          /* ok */
        }
        this.convolver = null;
      }
      this.setWetLevel(0);
      return;
    }

    if (!preset.url) {
      console.warn(`[Reverb] No IR URL for preset "${preset.name}"`);
      return;
    }

    // Set wet/dry ratio from preset defaults
    const wet = PRESET_WET_LEVELS[preset.id] ?? 0.1;
    this.setWetLevel(wet);

    // Fetch and decode the impulse response. The preset URL is stored
    // base-relative (no leading slash) so we resolve it against Vite's
    // BASE_URL to support both dev ("/") and the deployed site ("/app/").
    let audioBuffer = this.cachedIRBuffers.get(preset.id);
    if (!audioBuffer) {
      const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
      const url = `${baseUrl}${preset.url}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`[Reverb] HTTP ${response.status} fetching ${url}`);
      const arrayBuf = await response.arrayBuffer();
      audioBuffer = await this.ctx.decodeAudioData(arrayBuf);
      this.cachedIRBuffers.set(preset.id, audioBuffer);
    }

    // Disconnect old convolver
    if (this.convolver) {
      try {
        this.inputNode.disconnect(this.convolver);
      } catch {
        /* ok */
      }
      try {
        this.convolver.disconnect();
      } catch {
        /* ok */
      }
    }

    // Wire new convolver
    const conv = this.ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = audioBuffer;
    this.inputNode.connect(conv);
    conv.connect(this.wetGain);
    this.convolver = conv;

    console.log(
      `[Reverb] IR loaded: ${preset.name} (${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz)`,
    );
  }

  /** Create a send GainNode for an instrument to route signal to reverb. */
  createSend(sendLevel = 0.5): GainNode {
    const send = this.ctx.createGain();
    send.gain.value = sendLevel;
    send.connect(this.inputNode);
    return send;
  }

  /** Disconnect and clean up. */
  dispose(): void {
    try {
      this.inputNode.disconnect();
      this.wetGain.disconnect();
      this.reverbHPF.disconnect();
      if (this.convolver) this.convolver.disconnect();
    } catch {
      /* ok */
    }
  }
}

/** Default wet levels per IR preset (slider 0–1, input gain 4×). */
const PRESET_WET_LEVELS: Record<string, number> = {
  musikvereinsaal: 0.25,
  "scala-milan": 0.22,
  "french-salon": 0.18,
  "masonic-lodge": 0.2,
  "st-nicolaes": 0.28,
};
