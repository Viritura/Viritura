import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotePreviewEngine, midiToFrequency, getNotePreviewEngine } from "../../hooks/NotePreviewEngine";

// ═══════════════════════════════════════════
// midiToFrequency tests
// ═══════════════════════════════════════════

describe("midiToFrequency", () => {
  it("converts A4 (MIDI 69) to 440 Hz", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 2);
  });

  it("converts C4 (MIDI 60) to ~261.63 Hz", () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it("converts C5 (MIDI 72) to ~523.25 Hz (one octave above C4)", () => {
    expect(midiToFrequency(72)).toBeCloseTo(523.25, 1);
  });

  it("converts C3 (MIDI 48) to ~130.81 Hz", () => {
    expect(midiToFrequency(48)).toBeCloseTo(130.81, 1);
  });

  it("doubles frequency per octave", () => {
    const f60 = midiToFrequency(60);
    const f72 = midiToFrequency(72);
    expect(f72 / f60).toBeCloseTo(2.0, 5);
  });
});

// ═══════════════════════════════════════════
// NotePreviewEngine tests (with mocked Web Audio)
// ═══════════════════════════════════════════

function createMockAudioContext() {
  const oscillators: Array<{
    type: string;
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }> = [];

  const gains: Array<{
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  const mockCtx = {
    currentTime: 0,
    state: "running" as string,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => {
      const osc = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const g = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(g);
      return g;
    }),
  };

  return { mockCtx, oscillators, gains };
}

describe("NotePreviewEngine", () => {
  let originalAudioContext: typeof globalThis.AudioContext;

  beforeEach(() => {
    originalAudioContext = globalThis.AudioContext;
  });

  afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
  });

  it("creates oscillator with triangle wave on playNote", () => {
    const { mockCtx, oscillators } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playNote(60); // C4

    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]!.type).toBe("triangle");
    expect(oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(261.63, 0), 0);
    expect(oscillators[0]!.start).toHaveBeenCalled();
    expect(oscillators[0]!.stop).toHaveBeenCalled();

    engine.dispose();
  });

  it("plays multiple oscillators for playChord", () => {
    const { mockCtx, oscillators } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playChord([60, 64, 67]); // C major chord

    expect(oscillators).toHaveLength(3);
    engine.dispose();
  });

  it("does nothing when disabled", () => {
    const { mockCtx, oscillators } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.enabled = false;
    engine.playNote(60);

    expect(oscillators).toHaveLength(0);
    engine.dispose();
  });

  it("sets correct ADSR envelope", () => {
    const { mockCtx, gains } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playNote(69, 500, 0.3);

    expect(gains).toHaveLength(1);
    const gainParam = gains[0]!.gain;

    // Initial value = 0
    expect(gainParam.setValueAtTime).toHaveBeenCalledWith(0, 0);
    // Attack ramp to velocity
    expect(gainParam.linearRampToValueAtTime).toHaveBeenCalledWith(0.3, 0.01);
    // Decay to sustain level
    expect(gainParam.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.21, 1), // 0.3 * 0.7
      expect.closeTo(0.06, 1), // 0.01 + 0.05
    );

    engine.dispose();
  });

  it("stops all active oscillators on stopAll", () => {
    const { mockCtx, oscillators } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playNote(60);
    engine.playNote(64);

    expect(oscillators).toHaveLength(2);
    engine.stopAll();

    // stopAll calls stop() on each active oscillator
    // The oscillators already had stop() called once during playNote,
    // so we expect it to be called a second time by stopAll
    for (const osc of oscillators) {
      expect(osc.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
    }

    engine.dispose();
  });

  it("resumes suspended AudioContext", () => {
    const { mockCtx } = createMockAudioContext();
    mockCtx.state = "suspended";
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playNote(60);

    expect(mockCtx.resume).toHaveBeenCalled();
    engine.dispose();
  });

  it("closes AudioContext on dispose", () => {
    const { mockCtx } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playNote(60); // triggers context creation
    engine.dispose();

    expect(mockCtx.close).toHaveBeenCalled();
  });

  it("reduces velocity for larger chords", () => {
    const { mockCtx, gains } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playChord([60, 64, 67, 72]); // 4-note chord

    // Each note in a 4-note chord gets velocity = 0.3 / sqrt(4) = 0.15
    expect(gains).toHaveLength(4);
    for (const g of gains) {
      expect(g.gain.linearRampToValueAtTime).toHaveBeenCalledWith(expect.closeTo(0.15, 1), expect.any(Number));
    }

    engine.dispose();
  });

  it("skips empty chord array", () => {
    const { mockCtx, oscillators } = createMockAudioContext();
    globalThis.AudioContext = vi.fn(function () {
      return mockCtx;
    }) as unknown as typeof AudioContext;

    const engine = new NotePreviewEngine();
    engine.playChord([]);

    expect(oscillators).toHaveLength(0);
    engine.dispose();
  });
});

describe("getNotePreviewEngine", () => {
  it("returns the same singleton instance", () => {
    const a = getNotePreviewEngine();
    const b = getNotePreviewEngine();
    expect(a).toBe(b);
  });
});
