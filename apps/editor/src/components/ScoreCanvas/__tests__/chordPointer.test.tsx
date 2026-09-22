import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freeze } from "immer";
import type { Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { getGlobalPerfTracker, type DisplayList } from "@viritura/renderer";
import { DocumentProvider, useDocumentStoreApi } from "../../../store/DocumentContext";
import type { DocumentStore } from "../../../store/documentStore";
import { useSelectionStore } from "../../../store/selectionStore";
import { useNotePreview } from "../../../hooks/useNotePreview";
import { ScoreCanvas } from "../ScoreCanvas";
import { computeDisplayListImpl } from "../computeDisplayList";
import type { initWasmAndFont } from "../initWasmAndFont";

const { previewChord, previewNote } = vi.hoisted(() => ({
  previewChord: vi.fn().mockResolvedValue(undefined),
  previewNote: vi.fn(),
}));

vi.mock("@viritura/playback", async (original) => ({
  ...(await original<typeof import("@viritura/playback")>()),
  usePlaybackActions: () => ({ previewChord, previewNote }),
}));
vi.mock("../initWasmAndFont", () => ({
  initWasmAndFont: (args: Parameters<typeof initWasmAndFont>[0]) => {
    args.backendRef.current = {
      hasRetainedScore: () => false,
      getScoreInfo: async () => ({
        measureCount: 1,
        partCount: 2,
        partNames: ["Hidden", "Clarinet"],
        scoreCount: 1,
        scoreNames: [],
      }),
    } as unknown as NonNullable<typeof args.backendRef.current>;
    args.setWasmReady(true);
    return () => {};
  },
}));
vi.mock("../computeDisplayList", () => ({
  computeDisplayListImpl: vi.fn(),
  prewarmPatchChain: async () => {},
}));
vi.mock("../paintScoreFrame", () => ({ paintScoreFrame: () => {} }));
vi.mock("../../InputCursor", () => ({ InputCursor: () => null }));
vi.mock("../../../hooks/useViewport", async () => {
  const { useRef } = await import("react");
  return {
    useViewport: () => ({
      viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
      containerRef: useRef(null),
      dragLockRef: useRef(false),
      isDragging: false,
      resetViewport: vi.fn(),
      setZoom: vi.fn(),
      setScroll: vi.fn(),
    }),
  };
});

function sourceScore(): Score {
  return freeze(
    {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            chordSymbols: [
              { position: { fraction: [0, 1] }, root: { step: "C" }, bass: { step: "E" } },
              { position: { fraction: [1, 2] }, root: { step: "G" } },
            ],
          },
        ],
      },
      parts: [
        { id: "hidden", measures: [], chordSymbolVisibility: "hide" },
        {
          id: "clarinet",
          chordSymbolVisibility: "show",
          transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "note",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layouts: [
        {
          id: "collapsed",
          content: [
            {
              type: "staff",
              sources: [{ part: "hidden" }, { part: "clarinet" }],
            },
          ],
        },
      ],
      scores: [{ layout: "collapsed", useWritten: true }],
    } satisfies Score,
    true,
  );
}

function frame(id: string): DisplayList {
  return {
    width: 800,
    height: 300,
    commands: [
      {
        type: "DrawText",
        text: "D/F♯",
        x: 100,
        y: 40,
        font: "serif",
        size: 20,
        color: "#000",
        align: "left",
        baseline: "alphabetic",
      },
    ],
    elementIds: [id],
    elementBboxes: [
      { elementId: id, bbox: { x: 100, y: 20, width: 60, height: 20 } },
      { elementId: "p1/m0/s0/note/n0", bbox: { x: 200, y: 65, width: 12, height: 10 } },
    ],
    measureBounds: [
      {
        index: 0,
        partIndex: 1,
        staffIndex: 0,
        sourcePartIndices: [0, 1],
        x: 0,
        y: 50,
        width: 400,
        height: 40,
        prefixWidth: 0,
        totalBeats: 4,
        beatAnchors: [],
      },
    ],
  };
}

let store: DocumentStore;
function PreviewBridge() {
  const documentStore = useDocumentStoreApi();
  useEffect(() => {
    store = documentStore;
  }, [documentStore]);
  useNotePreview();
  return null;
}

async function mount(id = "m0/chord0/p0/staff0", mode: "write" | "engrave" = "write") {
  const score = sourceScore();
  vi.mocked(computeDisplayListImpl).mockResolvedValue(frame(id));
  const ui = () => (
    <DocumentProvider>
      <PreviewBridge />
      <ScoreCanvas viewMode="horizon" initialZoom={1} interactionMode={mode} />
    </DocumentProvider>
  );
  const view = render(ui());
  await act(async () =>
    store.setState({
      score,
      workingScore: score,
      mnxJson: JSON.stringify(serializeMnx(score)),
    }),
  );
  await waitFor(() => expect(view.container.textContent).not.toContain("Loading score"));
  await waitFor(() => expect(computeDisplayListImpl).toHaveBeenCalled());
  const canvas = screen.getByRole("application");
  return { ...view, ui, canvas, score };
}

const pointer = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 110, clientY: 30 };
function click(canvas: HTMLElement, point = pointer) {
  fireEvent.pointerDown(canvas, point);
  fireEvent.mouseDown(canvas, point);
  fireEvent.pointerUp(canvas, point);
  fireEvent.mouseUp(canvas, point);
  fireEvent.click(canvas, point);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSelectionStore.setState(useSelectionStore.getInitialState());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSelectionStore.setState(useSelectionStore.getInitialState());
});

describe("ScoreCanvas chord pointer routing", () => {
  it.each(["write", "engrave"] as const)(
    "auditions repeated %s clicks exactly once, never layout/rerender",
    async (mode) => {
      const { canvas, score, ui, rerender } = await mount("m0/chord0/p0/staff0", mode);
      for (let i = 0; i < 3; i++) {
        click(canvas);
        expect(previewChord).toHaveBeenCalledTimes(i + 1);
        expect(previewChord.mock.calls[i]![0]).toBe(score.global.measures[0]!.chordSymbols![0]);
        expect(useSelectionStore.getState().selection).toMatchObject({
          kind: "single",
          elementId: "m0/chord0/p0/staff0",
          elementType: "chord-symbol",
          measureAnchor: { partIndex: 1, staffIndex: 0 },
        });
      }
      rerender(ui());
      await act(async () => {
        await getGlobalPerfTracker().fastLayoutCallback?.(store.getState().mnxJson);
      });
      expect(previewChord).toHaveBeenCalledTimes(3);
      expect(previewNote).not.toHaveBeenCalled();
    },
  );

  it("keeps the selected chord and canvas through mouseup, auditioning only the subsequent click", async () => {
    const { canvas } = await mount();
    click(canvas);
    const selected = useSelectionStore.getState().selection;
    fireEvent.pointerDown(canvas, pointer);
    fireEvent.mouseDown(canvas, pointer);
    fireEvent.pointerMove(canvas, { ...pointer, clientX: 112 });
    fireEvent.pointerUp(canvas, { ...pointer, clientX: 112 });
    fireEvent.mouseUp(canvas, { ...pointer, clientX: 112 });
    expect(screen.getByRole("application")).toBe(canvas);
    expect(useSelectionStore.getState().selection).toBe(selected);
    expect(previewChord).toHaveBeenCalledOnce();
    fireEvent.click(canvas, { ...pointer, clientX: 112 });
    expect(previewChord).toHaveBeenCalledTimes(2);
    expect(previewNote).not.toHaveBeenCalled();
  });

  it("passes the immutable working snapshot, not the lagging published score, to playback", async () => {
    const { canvas, score, ui, rerender } = await mount();
    const working = freeze(
      {
        ...score,
        global: {
          ...score.global,
          measures: [
            {
              ...score.global.measures[0],
              chordSymbols: [{ position: { fraction: [0, 1] }, root: { step: "F" }, bass: { step: "A" } }],
            },
          ],
        },
      } satisfies Score,
      true,
    );
    act(() => store.setState({ workingScore: working }));
    rerender(ui());
    expect(previewChord).not.toHaveBeenCalled();
    click(canvas);
    expect(previewChord).toHaveBeenCalledExactlyOnceWith(working.global.measures[0]!.chordSymbols![0], working);
    expect(store.getState().score).toBe(score);
    expect(score.global.measures[0]!.chordSymbols![0]!.root!.step).toBe("C");
    act(() => store.setState({ score: working }));
    expect(previewChord).toHaveBeenCalledOnce();
  });

  it.each(["away", "return", "cancel"] as const)(
    "does not audition a %s drag, and the next deliberate click works",
    async (gesture) => {
      const { canvas } = await mount();
      fireEvent.pointerDown(canvas, pointer);
      fireEvent.pointerMove(canvas, { ...pointer, clientX: 130 });
      if (gesture === "return") fireEvent.pointerMove(canvas, pointer);
      if (gesture === "cancel") fireEvent.pointerCancel(canvas, pointer);
      else fireEvent.pointerUp(canvas, gesture === "away" ? { ...pointer, clientX: 130 } : pointer);
      fireEvent.click(canvas, pointer);
      expect(previewChord).not.toHaveBeenCalled();
      click(canvas);
      expect(previewChord).toHaveBeenCalledOnce();
    },
  );

  it("routes notes exclusively through selection preview and leaves chords out of note preview", async () => {
    const { canvas, ui, rerender } = await mount();
    click(canvas, { ...pointer, clientX: 205, clientY: 70 });
    expect(previewNote).toHaveBeenCalledExactlyOnceWith(62, 1, 80, 400);
    expect(previewChord).not.toHaveBeenCalled();
    rerender(ui());
    await act(async () => {
      await getGlobalPerfTracker().fastLayoutCallback?.(store.getState().mnxJson);
    });
    expect(previewNote).toHaveBeenCalledOnce();
    click(canvas);
    expect(previewChord).toHaveBeenCalledOnce();
    expect(previewNote).toHaveBeenCalledOnce();
  });

  it("resolves an explicit nonzero source chord index in a collapsed display copy", async () => {
    const { canvas, score } = await mount("m0/chord1/p0/staff0");
    click(canvas);
    expect(previewChord.mock.calls[0]![0]).toBe(score.global.measures[0]!.chordSymbols![1]);
    expect(previewChord).toHaveBeenCalledOnce();
  });
});
