import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { moveNoteInputCursor } from "../keyboard/noteInputHandlers";
import type { KeyboardHandlerContext } from "../keyboard/types";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures: [{ sequences: [{ content: [] }] }],
      },
    ],
  };
}

function makeContext(
  staffIndex: number,
  beatPosition = 1,
): { ctx: KeyboardHandlerContext; setCursor: ReturnType<typeof vi.fn> } {
  const setCursor = vi.fn();
  const ctx = {
    getScore: () => makeScore(),
    getNoteInput: () => ({
      active: true,
      currentVoice: 1,
      currentDuration: "quarter",
      dotCount: 0,
      currentAccidental: null,
      isRest: false,
      currentGraceType: null,
      lastPitch: null,
      cursorPosition: { measureIndex: 0, beatPosition, partIndex: 0, staffIndex },
      slurActive: false,
      slurStartEventId: null,
      chordLock: false,
      condensingRouting: null,
    }),
    setCursor,
    setLastPitch: vi.fn(),
  } as unknown as KeyboardHandlerContext;
  return { ctx, setCursor };
}

describe("moveNoteInputCursor", () => {
  it("moves horizontally by the selected note duration", () => {
    const { ctx, setCursor } = makeContext(0);

    moveNoteInputCursor("right", ctx);
    moveNoteInputCursor("left", ctx);

    expect(setCursor).toHaveBeenNthCalledWith(1, { measureIndex: 0, beatPosition: 2, partIndex: 0, staffIndex: 0 });
    expect(setCursor).toHaveBeenNthCalledWith(2, { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 });
  });

  it("moves vertically between staves", () => {
    const down = makeContext(0);
    const up = makeContext(1);

    moveNoteInputCursor("down", down.ctx);
    moveNoteInputCursor("up", up.ctx);

    expect(down.setCursor).toHaveBeenCalledWith({ measureIndex: 0, beatPosition: 1, partIndex: 0, staffIndex: 1 });
    expect(up.setCursor).toHaveBeenCalledWith({ measureIndex: 0, beatPosition: 1, partIndex: 0, staffIndex: 0 });
  });
});
