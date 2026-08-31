import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { applyCut, cutToClipboard } from "../commands/clipboardCommands";

function score(): Score {
  const part = (index: number) => ({
    id: `part-${index}`,
    name: `Flute ${index + 1}`,
    measures: [
      {
        sequences: [
          {
            content: [
              {
                type: "event" as const,
                id: `part-${index}-a`,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "C" as const, octave: 5 as const } }],
              },
              {
                type: "event" as const,
                id: `part-${index}-b`,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "D" as const, octave: 5 as const } }],
              },
            ],
          },
        ],
      },
    ],
  });
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [part(0), part(1)],
    layouts: [
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "part-0" }, { part: "part-1" }] }],
      },
    ],
    scores: [{ name: "Condensed", layout: "condensed" }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("condensed clipboard cut", () => {
  it("captures and removes every routed source event in a condensed range", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
    const source = score();
    const selection = {
      kind: "range" as const,
      startElementId: "p0/m0/s0/part-0-a",
      endElementId: "p0/m0/s0/part-0-b",
    };
    const clipboard = buildClipboardSelection(source, selection, 0)!;
    const cut = await cutToClipboard(clipboard);
    const result = applyCut(source, cut!);

    expect(clipboard.tracks).toHaveLength(2);
    expect(clipboard.cutLocations).toHaveLength(4);
    for (const part of result.parts) {
      expect(part.measures[0]!.sequences[0]!.content.every((event) => event.type === "event" && !!event.rest)).toBe(
        true,
      );
    }
  });

  it("still produces a cut mutation when browser clipboard permission is denied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    const clipboard = buildClipboardSelection(
      score(),
      { kind: "single", elementId: "p0/m0/s0/part-0-a", elementType: "event" },
      0,
    )!;

    expect(await cutToClipboard(clipboard)).not.toBeNull();
  });

  it("keeps every routed A2 source as a pasteable track for a single visual note", () => {
    const clipboard = buildClipboardSelection(
      score(),
      { kind: "single", elementId: "p0/m0/s0/part-0-a", elementType: "event" },
      0,
    )!;

    expect(clipboard.tracks).toHaveLength(2);
    expect(clipboard.cutLocations).toHaveLength(2);
  });

  it("cuts a selected note and dynamic together", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
    const source = score();
    source.parts[0]!.measures[0]!.dynamics = [
      {
        id: "dynamic-p",
        type: "immediate",
        position: { fraction: [0, 1] },
        value: "p",
      },
    ];
    const clipboard = buildClipboardSelection(
      source,
      {
        kind: "multi",
        elementIds: ["p0/m0/s0/part-0-a", "p0/m0/dyndynamic-p"],
      },
      0,
    )!;
    const result = applyCut(source, (await cutToClipboard(clipboard))!);

    expect(clipboard.dynamics).toHaveLength(1);
    expect(clipboard.cutAnnotationLocations).toHaveLength(1);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({ rest: {} });
    expect(result.parts[0]!.measures[0]!.dynamics).toBeUndefined();
  });

  it("cuts a note-to-sf range selection atomically", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
    const source = score();
    source.parts[0]!.measures[0]!.dynamics = [
      {
        id: "dynamic-sf",
        type: "accent",
        position: { fraction: [0, 1] },
        value: "f",
      },
    ];
    const clipboard = buildClipboardSelection(
      source,
      {
        kind: "range",
        startElementId: "p0/m0/s0/part-0-a",
        endElementId: "p0/m0/dyndynamic-sf",
      },
      0,
    );

    expect(clipboard).not.toBeNull();
    const result = applyCut(source, (await cutToClipboard(clipboard!))!);
    expect(result.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({ rest: {} });
    expect(result.parts[0]!.measures[0]!.dynamics).toBeUndefined();
  });
});
