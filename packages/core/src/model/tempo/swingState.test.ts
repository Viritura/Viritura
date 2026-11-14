import { describe, expect, it } from "vitest";
import { resolveTempoSwing, withTempoSwing, withTempoText } from "./swingState";
import type { GlobalMeasure, Swing, Tempo } from "../measure";

const swing: Swing = { mode: "swing", subdivision: "16th", ratio: [3, 2] };
const tempo: Tempo = { bpm: 90, value: { base: "quarter" }, text: [{ text: "Keep moving" }] };

describe("tempo swing state", () => {
  it("shares swing state between legacy tempos and music-anchored system instructions", () => {
    const measures: GlobalMeasure[] = [
      { systemText: [{ id: "swing", text: [{ text: "Swing" }], position: { fraction: [0, 1] }, tempo: { swing } }] },
      {
        tempos: [tempo],
        systemText: [
          {
            id: "straight",
            text: [{ text: "Straight" }],
            position: { fraction: [1, 2] },
            tempo: { swing: { mode: "straight" } },
          },
        ],
      },
    ];
    expect(resolveTempoSwing(measures, 1, 0)).toEqual({ swing, source: { measureIndex: 0, tempoIndex: 0 } });
    expect(resolveTempoSwing(measures, 1, 1)).toEqual({
      swing: { mode: "straight" },
      source: { measureIndex: 1, tempoIndex: 1 },
    });
  });

  it("defaults to straight and inherits without resetting at a BPM instruction", () => {
    const measures: GlobalMeasure[] = [
      { tempos: [tempo, { swing, location: { fraction: [1, 4] } }] },
      { tempos: [tempo] },
    ];
    expect(resolveTempoSwing(measures, 0, 0)).toEqual({ swing: { mode: "straight" } });
    expect(resolveTempoSwing(measures, 1, 0)).toEqual({ swing, source: { measureIndex: 0, tempoIndex: 1 } });
  });

  it("resolves source-position order and coincident instruction precedence", () => {
    const measures: GlobalMeasure[] = [
      {
        tempos: [
          { swing, location: { fraction: [1, 2] } },
          { ...tempo, location: { fraction: [1, 4] } },
          { swing: { mode: "straight" }, location: { fraction: [1, 2] } },
        ],
      },
    ];
    expect(resolveTempoSwing(measures, 0, 1).swing).toEqual({ mode: "straight" });
    expect(resolveTempoSwing(measures, 0, 2)).toEqual({
      swing: { mode: "straight" },
      source: { measureIndex: 0, tempoIndex: 2 },
    });
    expect(() => resolveTempoSwing(measures, 2, 0)).toThrow(/missing/);
  });

  it("preserves text when returning a swing-only anchor to inherit", () => {
    const source: Tempo = { swing, text: [{ text: "Keep moving" }] };
    expect(withTempoSwing(source, undefined)).toEqual({ text: source.text, swing: undefined });
    expect(withTempoText(withTempoSwing(source, undefined)!, [])).toBeNull();
    expect(withTempoSwing({ swing }, undefined)).toBeNull();
    expect(withTempoSwing(tempo, swing)?.text).toEqual(tempo.text);
  });

  it("rejects invalid ratio input explicitly", () => {
    expect(() => withTempoSwing(tempo, { mode: "swing", subdivision: "16th", ratio: [0, 1] })).toThrow(/positive/);
  });
});
