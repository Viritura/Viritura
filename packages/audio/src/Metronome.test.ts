import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Metronome } from "./Metronome";
import type { MetronomeBeat } from "./Metronome";

// ─── Mock Web Audio API ──────────────────────────────────────────────

function createMockGainNode(): GainNode {
  const gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  return {
    gain,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode;
}

function createMockOscillatorNode(): OscillatorNode {
  return {
    type: "sine",
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as OscillatorNode;
}

interface MockAudioContext {
  destination: AudioNode;
  currentTime: number;
  createGain: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  gainNodes: GainNode[];
  oscillatorNodes: OscillatorNode[];
}

function createMockAudioContext(): MockAudioContext {
  const gainNodes: GainNode[] = [];
  const oscillatorNodes: OscillatorNode[] = [];

  const ctx: MockAudioContext = {
    destination: {} as AudioNode,
    currentTime: 0,
    gainNodes,
    oscillatorNodes,
    createGain: vi.fn(() => {
      const node = createMockGainNode();
      gainNodes.push(node);
      return node;
    }),
    createOscillator: vi.fn(() => {
      const node = createMockOscillatorNode();
      oscillatorNodes.push(node);
      return node;
    }),
  };

  return ctx;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Metronome", () => {
  let ctx: MockAudioContext;
  let metronome: Metronome;

  beforeEach(() => {
    ctx = createMockAudioContext();
    metronome = new Metronome({
      audioContext: ctx as unknown as AudioContext,
    });
  });

  afterEach(() => {
    metronome.dispose();
  });

  // ─── Construction ──────────────────────────────────────────────

  describe("constructor", () => {
    it("creates a master gain node connected to destination", () => {
      // One gain node created for master gain
      expect(ctx.createGain).toHaveBeenCalledTimes(1);
      const masterGain = ctx.gainNodes[0]!;
      expect(masterGain.connect).toHaveBeenCalledWith(ctx.destination);
      expect(masterGain.gain.value).toBe(1);
    });

    it("connects to custom destination if provided", () => {
      const customDest = {} as AudioNode;
      const ctx2 = createMockAudioContext();
      const m = new Metronome({
        audioContext: ctx2 as unknown as AudioContext,
        destination: customDest,
      });
      const masterGain = ctx2.gainNodes[0]!;
      expect(masterGain.connect).toHaveBeenCalledWith(customDest);
      m.dispose();
    });
  });

  // ─── scheduleClick ─────────────────────────────────────────────

  describe("scheduleClick", () => {
    it("creates oscillator + envelope for accented click", () => {
      metronome.scheduleClick(1.0, true);

      // One oscillator and one envelope gain (plus master gain = 2 total)
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      expect(ctx.createGain).toHaveBeenCalledTimes(2); // master + envelope

      const osc = ctx.oscillatorNodes[0]!;
      expect(osc.type).toBe("sine");
      expect(osc.frequency.value).toBe(Metronome.ACCENT_FREQUENCY);
      expect(osc.start).toHaveBeenCalledWith(1.0);
      expect(osc.stop).toHaveBeenCalledWith(1.0 + Metronome.ACCENT_DURATION);
    });

    it("uses correct parameters for normal (non-accented) click", () => {
      metronome.scheduleClick(2.0, false);

      const osc = ctx.oscillatorNodes[0]!;
      expect(osc.frequency.value).toBe(Metronome.NORMAL_FREQUENCY);
      expect(osc.start).toHaveBeenCalledWith(2.0);
      expect(osc.stop).toHaveBeenCalledWith(2.0 + Metronome.NORMAL_DURATION);
    });

    it("sets up gain envelope with exponential decay", () => {
      metronome.scheduleClick(1.0, true);

      // Second gain node is the envelope (first is master)
      const envelope = ctx.gainNodes[1]!;
      expect(envelope.gain.setValueAtTime).toHaveBeenCalledWith(Metronome.ACCENT_GAIN, 1.0);
      expect(envelope.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 1.0 + Metronome.ACCENT_DURATION);
    });

    it("connects oscillator → envelope → master gain", () => {
      metronome.scheduleClick(1.0, true);

      const osc = ctx.oscillatorNodes[0]!;
      const envelope = ctx.gainNodes[1]!;
      const masterGain = ctx.gainNodes[0]!;

      expect(osc.connect).toHaveBeenCalledWith(envelope);
      expect(envelope.connect).toHaveBeenCalledWith(masterGain);
    });

    it("is a no-op when disabled", () => {
      metronome.setEnabled(false);
      metronome.scheduleClick(1.0, true);

      expect(ctx.createOscillator).not.toHaveBeenCalled();
    });

    it("resumes scheduling after re-enabling", () => {
      metronome.setEnabled(false);
      metronome.setEnabled(true);
      metronome.scheduleClick(1.0, true);

      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Enable / Disable ─────────────────────────────────────────

  describe("enable/disable", () => {
    it("starts enabled by default", () => {
      expect(metronome.isEnabled()).toBe(true);
    });

    it("can be disabled and re-enabled", () => {
      metronome.setEnabled(false);
      expect(metronome.isEnabled()).toBe(false);

      metronome.setEnabled(true);
      expect(metronome.isEnabled()).toBe(true);
    });
  });

  // ─── Volume control ────────────────────────────────────────────

  describe("volume", () => {
    it("defaults to 1.0", () => {
      expect(metronome.getVolume()).toBe(1.0);
    });

    it("sets volume on master gain node", () => {
      metronome.setVolume(0.5);
      expect(metronome.getVolume()).toBe(0.5);
      expect(ctx.gainNodes[0]!.gain.value).toBe(0.5);
    });

    it("clamps volume to 0–1 range", () => {
      metronome.setVolume(-0.5);
      expect(metronome.getVolume()).toBe(0);

      metronome.setVolume(1.5);
      expect(metronome.getVolume()).toBe(1);
    });
  });

  // ─── dispose ──────────────────────────────────────────────────

  describe("dispose", () => {
    it("disconnects master gain node", () => {
      metronome.dispose();
      expect(ctx.gainNodes[0]!.disconnect).toHaveBeenCalled();
    });
  });
});

// ─── Static helpers ──────────────────────────────────────────────────

describe("Metronome.isCompoundMeter", () => {
  it("identifies 6/8 as compound", () => {
    expect(Metronome.isCompoundMeter(6, 8)).toBe(true);
  });

  it("identifies 9/8 as compound", () => {
    expect(Metronome.isCompoundMeter(9, 8)).toBe(true);
  });

  it("identifies 12/8 as compound", () => {
    expect(Metronome.isCompoundMeter(12, 8)).toBe(true);
  });

  it("identifies 6/16 as compound", () => {
    expect(Metronome.isCompoundMeter(6, 16)).toBe(true);
  });

  it("does not treat 3/8 as compound (simple triple)", () => {
    expect(Metronome.isCompoundMeter(3, 8)).toBe(false);
  });

  it("does not treat 4/4 as compound", () => {
    expect(Metronome.isCompoundMeter(4, 4)).toBe(false);
  });

  it("does not treat 3/4 as compound", () => {
    expect(Metronome.isCompoundMeter(3, 4)).toBe(false);
  });

  it("does not treat 2/4 as compound", () => {
    expect(Metronome.isCompoundMeter(2, 4)).toBe(false);
  });

  it("does not treat 5/8 as compound (irregular)", () => {
    expect(Metronome.isCompoundMeter(5, 8)).toBe(false);
  });

  it("does not treat 7/8 as compound (irregular)", () => {
    expect(Metronome.isCompoundMeter(7, 8)).toBe(false);
  });
});

describe("Metronome.getBeatsForMeasure", () => {
  function positions(beats: MetronomeBeat[]): number[] {
    return beats.map((b) => b.position);
  }

  function accentedPositions(beats: MetronomeBeat[]): number[] {
    return beats.filter((b) => b.accented).map((b) => b.position);
  }

  // ─── Simple meters ─────────────────────────────────────────────

  it("4/4: four beats, accent on beat 1", () => {
    const beats = Metronome.getBeatsForMeasure(4, 4);
    expect(positions(beats)).toEqual([0, 1, 2, 3]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("3/4: three beats, accent on beat 1", () => {
    const beats = Metronome.getBeatsForMeasure(3, 4);
    expect(positions(beats)).toEqual([0, 1, 2]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("2/4: two beats, accent on beat 1", () => {
    const beats = Metronome.getBeatsForMeasure(2, 4);
    expect(positions(beats)).toEqual([0, 1]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("2/2 (cut time): two beats, accent on beat 1", () => {
    const beats = Metronome.getBeatsForMeasure(2, 2);
    expect(positions(beats)).toEqual([0, 1]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("3/8 (simple triple): three beats", () => {
    const beats = Metronome.getBeatsForMeasure(3, 8);
    expect(positions(beats)).toEqual([0, 1, 2]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("5/8 (irregular): five beats", () => {
    const beats = Metronome.getBeatsForMeasure(5, 8);
    expect(positions(beats)).toEqual([0, 1, 2, 3, 4]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("7/8 (irregular): seven beats", () => {
    const beats = Metronome.getBeatsForMeasure(7, 8);
    expect(positions(beats)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  // ─── Compound meters ──────────────────────────────────────────

  it("6/8: two groups of 3, accent on group 1", () => {
    const beats = Metronome.getBeatsForMeasure(6, 8);
    expect(positions(beats)).toEqual([0, 3]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("9/8: three groups of 3, accent on group 1", () => {
    const beats = Metronome.getBeatsForMeasure(9, 8);
    expect(positions(beats)).toEqual([0, 3, 6]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("12/8: four groups of 3, accent on group 1", () => {
    const beats = Metronome.getBeatsForMeasure(12, 8);
    expect(positions(beats)).toEqual([0, 3, 6, 9]);
    expect(accentedPositions(beats)).toEqual([0]);
  });

  it("6/16: two groups of 3 sixteenths", () => {
    const beats = Metronome.getBeatsForMeasure(6, 16);
    expect(positions(beats)).toEqual([0, 3]);
    expect(accentedPositions(beats)).toEqual([0]);
  });
});

describe("Metronome.beatPositionToSeconds", () => {
  it("converts quarter-note position at 120 BPM in 4/4", () => {
    // At 120 BPM, each quarter note = 0.5s
    expect(Metronome.beatPositionToSeconds(0, 120, 4)).toBeCloseTo(0);
    expect(Metronome.beatPositionToSeconds(1, 120, 4)).toBeCloseTo(0.5);
    expect(Metronome.beatPositionToSeconds(2, 120, 4)).toBeCloseTo(1.0);
    expect(Metronome.beatPositionToSeconds(3, 120, 4)).toBeCloseTo(1.5);
  });

  it("converts eighth-note position at 120 BPM in 6/8", () => {
    // At 120 BPM (quarter = 120), each eighth = 0.25s
    // Position 3 (second group start) = 3 * 0.25 = 0.75s
    expect(Metronome.beatPositionToSeconds(0, 120, 8)).toBeCloseTo(0);
    expect(Metronome.beatPositionToSeconds(3, 120, 8)).toBeCloseTo(0.75);
  });

  it("converts half-note position at 60 BPM in 2/2", () => {
    // At 60 BPM (quarter = 60), each half note = 2s
    expect(Metronome.beatPositionToSeconds(0, 60, 2)).toBeCloseTo(0);
    expect(Metronome.beatPositionToSeconds(1, 60, 2)).toBeCloseTo(2.0);
  });
});

describe("Metronome.measureDurationSeconds", () => {
  it("4/4 at 120 BPM = 2 seconds", () => {
    expect(Metronome.measureDurationSeconds(4, 4, 120)).toBeCloseTo(2.0);
  });

  it("3/4 at 120 BPM = 1.5 seconds", () => {
    expect(Metronome.measureDurationSeconds(3, 4, 120)).toBeCloseTo(1.5);
  });

  it("6/8 at 120 BPM = 1.5 seconds", () => {
    // 6 eighth notes, each 0.25s at 120 BPM
    expect(Metronome.measureDurationSeconds(6, 8, 120)).toBeCloseTo(1.5);
  });

  it("2/2 at 60 BPM = 4 seconds", () => {
    expect(Metronome.measureDurationSeconds(2, 2, 60)).toBeCloseTo(4.0);
  });
});

// ─── Click spec constants ────────────────────────────────────────────

describe("Metronome click specifications", () => {
  it("accent click: 880 Hz, 50 ms, gain 0.8", () => {
    expect(Metronome.ACCENT_FREQUENCY).toBe(880);
    expect(Metronome.ACCENT_DURATION).toBe(0.05);
    expect(Metronome.ACCENT_GAIN).toBe(0.8);
  });

  it("normal click: 440 Hz, 30 ms, gain 0.4", () => {
    expect(Metronome.NORMAL_FREQUENCY).toBe(440);
    expect(Metronome.NORMAL_DURATION).toBe(0.03);
    expect(Metronome.NORMAL_GAIN).toBe(0.4);
  });
});
