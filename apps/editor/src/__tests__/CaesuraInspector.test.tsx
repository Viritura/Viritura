// @vitest-environment happy-dom
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { NotationInspector } from "../components/NotationInspector";
import { DocumentProvider, useDocument, useDocumentActions, useDocumentStoreApi } from "../store/DocumentContext";
import { HistoryProvider } from "../store/HistoryContext";
import { useHistoryStore } from "../store/historyStore";
import { useMnxChangeReporter } from "../app/useMnxChangeReporter";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";

function initialScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ caesura: { id: "pause", _c: "keep" } }] },
    parts: [
      {
        id: "piano",
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "note",
                    duration: { base: "whole" },
                    rest: {},
                    markings: { caesura: { style: "short" } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function Inner({ elementId }: { elementId: string }) {
  const { score } = useDocument();
  const { loadScore } = useDocumentActions();
  const store = useDocumentStoreApi();
  const { selectElement } = useSelectionActions();
  const pushState = useHistoryStore((state) => state.pushState);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const canUndo = useHistoryStore((state) => state.canUndo);
  useMnxChangeReporter({ store, pushState });
  useEffect(() => {
    loadScore(initialScore(), "caesura.mnx");
    selectElement(elementId);
  }, [loadScore, selectElement, elementId]);
  return (
    <>
      <NotationInspector />
      <output data-testid="score">{JSON.stringify(score)}</output>
      <Button disabled={!canUndo} onClick={undo}>
        Undo
      </Button>
      <Button onClick={redo}>Redo</Button>
    </>
  );
}

function Harness({ elementId }: { elementId: string }) {
  const store = useDocumentStoreApi();
  return (
    <HistoryProvider
      initialMnxJson={JSON.stringify(serializeMnx(initialScore()))}
      onRestore={(json) => store.getState().loadScore(parseMnx(JSON.parse(json)), "caesura.mnx", json)}
    >
      <Inner elementId={elementId} />
    </HistoryProvider>
  );
}

function mount(elementId: string) {
  return render(
    <TooltipPrimitives.Provider>
      <DocumentProvider>
        <Harness elementId={elementId} />
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
}

function snapshot(): Score {
  return JSON.parse(screen.getByTestId("score").textContent!) as Score;
}

afterEach(() => {
  cleanup();
  resetSelectionStore();
});

describe("attachment-aware caesura inspector", () => {
  it("edits shape/strokes, removes the shared marking and undoes the removal", async () => {
    mount("m0/caesura");
    await screen.findByText("Global ending barline — all staves");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("notation-caesura-shape"));
    await user.click(screen.getByRole("option", { name: "Curved" }));
    expect(snapshot().global.measures[0]!.caesura).toEqual({ id: "pause", _c: "keep", style: "curved" });
    await user.click(screen.getByTestId("notation-caesura-marks"));
    await user.click(screen.getByRole("option", { name: "1", exact: true }));
    expect(snapshot().global.measures[0]!.caesura!.marks).toBe(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo", exact: true })).toHaveProperty("disabled", false),
    );
    await user.click(screen.getByRole("button", { name: "Remove caesura" }));
    expect(snapshot().global.measures[0]!.caesura).toBeUndefined();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo", exact: true })).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    await waitFor(() => expect(snapshot().global.measures[0]!.caesura).toMatchObject({ style: "curved", marks: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
    await waitFor(() => expect(snapshot().global.measures[0]!.caesura).toBeUndefined());
  });

  it("keeps event editing independent from the global hold", async () => {
    mount("p0/m0/s0/note/caesura");
    await screen.findByText("Event marking");
    await userEvent.click(screen.getByRole("button", { name: "Remove caesura" }));
    expect(snapshot().global.measures[0]!.caesura).toEqual({ id: "pause", _c: "keep" });
    expect(snapshot().parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("markings.caesura");
  });
});
