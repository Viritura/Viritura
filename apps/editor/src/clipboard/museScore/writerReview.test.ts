import { describe, expect, it, vi } from "vitest";
import type { SequenceContent } from "@viritura/core";
import type { ClipboardSelection } from "../../commands/clipboardCommands";
import type { CapturedChordSymbol, CapturedDynamic, ClipboardTrack } from "../ClipboardFragment";
import { readMuseScoreClipboard, writeMuseScoreStaffList } from ".";
import * as harmony from "./harmony";

function notes(): SequenceContent[] {
  return [
    {
      type: "event",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
    },
  ];
}

function track(partOffset = 0, staffOffset = 0, voiceIndex = 0): ClipboardTrack {
  return { partOffset, staffOffset, voiceIndex, content: notes() };
}

function selection(overrides: Partial<ClipboardSelection> = {}): ClipboardSelection {
  return {
    events: notes(),
    timeSignature: { count: 4, unit: 4 },
    keySignature: { fifths: 0 },
    partIndex: 0,
    measureIndex: 0,
    sequenceIndex: 0,
    eventIndex: 0,
    ...overrides,
  };
}

function mf(): CapturedDynamic {
  return {
    measureOffset: 0,
    offset: [0, 1],
    dynamic: {
      id: "one-mf",
      type: "immediate",
      value: "mf",
      playbackVelocity: 96,
      position: { fraction: [0, 1] },
    },
  };
}

function cm(displayStaff?: number, partOffset = 0): CapturedChordSymbol {
  return {
    partOffset,
    measureOffset: 0,
    offset: [0, 1],
    chordSymbol: {
      position: { fraction: [0, 1] },
      root: { step: "C" },
      quality: "minor",
      ...(displayStaff === undefined ? {} : { displayStaff }),
    },
  };
}

function exported(selection: ClipboardSelection): Document {
  const result = writeMuseScoreStaffList(selection);
  expect(result.warning).toBeUndefined();
  expect(result.xml).not.toBeNull();
  return new DOMParser().parseFromString(result.xml!, "application/xml");
}

describe("MuseScore writer annotation review", () => {
  it("does not move an uncopied upper-staff harmony onto selected lower-staff notes", () => {
    const result = writeMuseScoreStaffList(
      selection({
        tracks: [{ ...track(), sourceStaff: 2 }],
        chordSymbols: [{ ...cm(), staffOffset: -1 }],
      }),
    );
    expect(result).toMatchObject({ xml: null, warning: expect.stringContaining("staff") });
  });

  it("uses explicit source staff metadata when annotation offsets are absent", () => {
    const result = writeMuseScoreStaffList(
      selection({
        tracks: [{ ...track(), sourceStaff: 2 }],
        chordSymbols: [cm()],
      }),
    );
    expect(result).toMatchObject({ xml: null, warning: expect.stringContaining("staff") });
  });

  it.each([
    { name: "both physical staves of one part", tracks: [track(), track(0, 1)] },
    { name: "an adjacent staff belonging to another part", tracks: [track(), track(1, 1)] },
    { name: "only the lower staff, normalized to offset zero", tracks: [track()] },
    { name: "no physical staff metadata", tracks: undefined },
  ])("rejects Cm on source staff 2 with $name rather than guessing its staff", ({ tracks }) => {
    const source = selection({ tracks, chordSymbols: [cm(2)] });
    const before = structuredClone(source);
    expect(writeMuseScoreStaffList(source)).toMatchObject({
      xml: null,
      warning: expect.stringContaining("staff"),
    });
    expect(source).toEqual(before);
  });

  it.each(["sourceStaff", "staffOffset"] as const)("routes secondary harmony using %s metadata", (metadata) => {
    const harmony = cm(2);
    if (metadata === "staffOffset") harmony.staffOffset = 1;
    const copied = selection({
      tracks: [
        { ...track(), sourceStaff: 1 },
        { ...track(0, 1), sourceStaff: 2 },
        { ...track(0, 1, 1), sourceStaff: 2 },
      ],
      chordSymbols: [harmony],
    });
    const document = exported(copied);
    expect(document.querySelectorAll("Harmony")).toHaveLength(1);
    expect(document.querySelector('Staff[id="0"] Harmony')).toBeNull();
    expect(document.querySelector('Staff[id="1"] Harmony root')?.textContent).toBe("14");
    const parsed = readMuseScoreClipboard(new XMLSerializer().serializeToString(document));
    expect(parsed.chordSymbols?.[0]?.staffOffset).toBe(1);
  });

  it("emits primary-staff Cm once, on the correct part's physical staff", () => {
    const document = exported(
      selection({
        tracks: [track(1, 2, 1), track(0, 1), track(1, 2), track()],
        chordSymbols: [cm(1, 1)],
      }),
    );
    expect(document.querySelectorAll("Harmony")).toHaveLength(1);
    expect(document.querySelector('Staff[id="0"] Harmony')).toBeNull();
    expect(document.querySelector('Staff[id="1"] Harmony')).toBeNull();
    expect(document.querySelector('Staff[id="2"] Harmony name')?.textContent).toBe("m");
    expect(document.querySelector('Staff[id="2"] Harmony root')?.textContent).toBe("14");
  });

  it.each([true, false])("emits two voices' captured mf once (selection mirror: %s)", (mirror) => {
    const document = exported(
      selection({
        tracks: [
          { ...track(0, 0, 1), dynamics: [mf()] },
          { ...track(), dynamics: [mf()] },
        ],
        ...(mirror ? { dynamics: [mf()] } : {}),
      }),
    );
    expect(document.querySelectorAll("Chord")).toHaveLength(2);
    expect(document.querySelectorAll("Dynamic")).toHaveLength(1);
    expect(document.querySelector("Dynamic subtype")?.textContent).toBe("mf");
    expect(document.querySelector("Dynamic velocity")?.textContent).toBe("96");
  });

  it("does not repeat a part-wide mf on its second physical staff", () => {
    const document = exported(
      selection({
        tracks: [
          { ...track(0, 1), dynamics: [mf()] },
          { ...track(), dynamics: [mf()] },
        ],
      }),
    );
    expect(document.querySelectorAll("Dynamic")).toHaveLength(1);
    expect(document.querySelector('Staff[id="0"] Dynamic')).not.toBeNull();
    expect(document.querySelector('Staff[id="1"] Dynamic')).toBeNull();
  });

  it("collects dynamics captured only on a non-primary voice without duplicating them", () => {
    const document = exported(
      selection({
        tracks: [track(), { ...track(0, 0, 1), dynamics: [mf()] }, { ...track(0, 0, 2), dynamics: [mf()] }],
      }),
    );
    expect(document.querySelectorAll("Dynamic")).toHaveLength(1);
  });

  it("deduplicates within each part, not across different parts with the same dynamic id", () => {
    const document = exported(
      selection({
        tracks: [
          { ...track(), dynamics: [mf()] },
          { ...track(0, 0, 1), dynamics: [mf()] },
          { ...track(0, 1), dynamics: [mf()] },
          { ...track(1, 2), dynamics: [mf()] },
          { ...track(1, 2, 1), dynamics: [mf()] },
        ],
        dynamics: [mf()],
      }),
    );
    expect(document.querySelectorAll("Dynamic")).toHaveLength(2);
    expect(document.querySelectorAll('Staff[id="0"] Dynamic')).toHaveLength(1);
    expect(document.querySelectorAll('Staff[id="1"] Dynamic')).toHaveLength(0);
    expect(document.querySelectorAll('Staff[id="2"] Dynamic')).toHaveLength(1);
  });

  it("routes part-relative dynamics to physical staves rather than treating part offsets as staves", () => {
    const document = exported(
      selection({
        tracks: [track(), track(0, 1), track(1, 2), track(1, 2, 1)],
        dynamics: [mf(), { ...mf(), partOffset: 1 }],
      }),
    );
    expect(document.querySelectorAll("Dynamic")).toHaveLength(2);
    expect(document.querySelector('Staff[id="1"] Dynamic')).toBeNull();
    expect(document.querySelector('Staff[id="2"] Dynamic')).not.toBeNull();
  });

  it("preserves separate occurrences while recognizing equivalent captured offsets", () => {
    const first = mf();
    const equivalent: CapturedDynamic = { ...mf(), offset: [0, 4] };
    const later: CapturedDynamic = { ...mf(), offset: [1, 4] };
    const document = exported(
      selection({
        tracks: [
          { ...track(), dynamics: [first, later] },
          { ...track(0, 0, 1), dynamics: [equivalent, later] },
        ],
        dynamics: [first],
      }),
    );
    expect(document.querySelectorAll("Dynamic")).toHaveLength(2);
  });

  it("preserves a dynamic's onset inside another voice's sustained note", () => {
    const firstVoice = track();
    firstVoice.content = [{ type: "event", duration: { base: "half" }, rest: {} }];
    const secondVoice = { ...track(0, 0, 1), content: [...notes(), ...notes()] };
    const document = exported(
      selection({
        tracks: [firstVoice, { ...secondVoice, dynamics: [{ ...mf(), offset: [1, 4] }] }],
      }),
    );
    expect(document.documentElement.getAttribute("len")).toBe("1/2");
    expect(document.querySelectorAll("Dynamic")).toHaveLength(1);
    const parsed = readMuseScoreClipboard(new XMLSerializer().serializeToString(document));
    expect(parsed.dynamics).toHaveLength(1);
    expect(parsed.dynamics?.[0]?.offset).toEqual([1, 4]);
    expect(parsed.tracks?.map((item) => item.content.length)).toEqual([1, 2]);
  });

  it("preserves a dynamic that precedes the first voice's lead-in", () => {
    const document = exported(
      selection({
        tracks: [
          { ...track(), leadIn: [1, 4] },
          { ...track(0, 0, 1), dynamics: [mf()] },
        ],
      }),
    );
    expect(document.documentElement.getAttribute("len")).toBe("1/2");
    expect(document.querySelectorAll("Dynamic")).toHaveLength(1);
    const parsed = readMuseScoreClipboard(new XMLSerializer().serializeToString(document));
    expect(parsed.dynamics?.[0]?.offset).toEqual([0, 1]);
    expect(parsed.tracks?.[0]?.leadIn).toEqual([1, 4]);
  });

  it("rejects conflicting mirrored dynamics instead of silently picking one", () => {
    const conflicting = mf();
    conflicting.dynamic.playbackVelocity = 80;
    expect(
      writeMuseScoreStaffList(
        selection({
          tracks: [
            { ...track(), dynamics: [mf()] },
            { ...track(0, 0, 1), dynamics: [conflicting] },
          ],
        }),
      ),
    ).toMatchObject({ xml: null, warning: expect.stringContaining("conflicting") });
  });

  it("rejects annotations before the copied range", () => {
    expect(writeMuseScoreStaffList(selection({ dynamics: [{ ...mf(), offset: [-1, 4] }] }))).toMatchObject({
      xml: null,
      warning: expect.stringContaining("before the copied range"),
    });
  });

  it.each(["selection", "track"] as const)(
    "routes explicit secondary-staff dynamics captured on the %s without voice duplication",
    (source) => {
      const dynamic = mf();
      dynamic.dynamic.staff = 2;
      const upper = { ...track(), sourceStaff: 1 };
      const lower = { ...track(0, 1), sourceStaff: 2 };
      const lowerVoice = { ...track(0, 1, 1), sourceStaff: 2, dynamics: [dynamic] };
      const copied = selection({
        tracks:
          source === "track" ? [{ ...upper, dynamics: [dynamic] }, lower, lowerVoice] : [upper, lower, lowerVoice],
        ...(source === "selection" ? { dynamics: [dynamic] } : {}),
      });
      const document = exported(copied);
      expect(document.querySelectorAll("Dynamic")).toHaveLength(1);
      expect(document.querySelector('Staff[id="0"] Dynamic')).toBeNull();
      expect(document.querySelector('Staff[id="1"] Dynamic velocity')?.textContent).toBe("96");
    },
  );

  it("rejects secondary dynamics without a source staff coordinate instead of guessing", () => {
    const dynamic = mf();
    dynamic.dynamic.staff = 2;
    expect(writeMuseScoreStaffList(selection({ tracks: [track(), track(0, 1)], dynamics: [dynamic] }))).toMatchObject({
      xml: null,
      warning: expect.stringContaining("staff"),
    });
  });

  it("warns instead of dropping annotations whose part has no copied track", () => {
    expect(writeMuseScoreStaffList(selection({ chordSymbols: [cm(1, 1)] }))).toMatchObject({
      xml: null,
      warning: expect.stringContaining("part"),
    });
  });

  it("turns unexpected export failures into warnings without blocking native clipboard data", () => {
    const serializer = vi.spyOn(harmony, "serializeHarmony").mockImplementationOnce(() => {
      throw new Error("unexpected serializer failure");
    });
    try {
      expect(writeMuseScoreStaffList(selection({ chordSymbols: [cm()] }))).toMatchObject({
        xml: null,
        warning: expect.stringContaining("MuseScore clipboard"),
      });
    } finally {
      serializer.mockRestore();
    }
  });
});
