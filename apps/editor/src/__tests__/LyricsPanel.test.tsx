import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { Button, TooltipPrimitives } from "@viritura/ui";
import { useMnxChangeReporter } from "../app/useMnxChangeReporter";
import { LyricsPanel } from "../components/lyrics/LyricsPanel";
import { DocumentProvider, useDocumentActions, useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";
import { HistoryProvider } from "../store/HistoryContext";
import { useHistoryStore } from "../store/historyStore";
import { resetSelectionStore, useSelectionActions } from "../store/selectionStore";
import { useOverlayStore } from "../store/overlayStore";
import { resetNoteInputStore, toggleNoteInputMode, useNoteInputStore } from "../store/noteInputStore";

afterEach(() => {
  cleanup();
  resetSelectionStore();
  useOverlayStore.setState({ lyricMode: false, lyricState: null, activeLyricLineId: "1" });
  resetNoteInputStore();
});

function lyricScore(): Score {
  return parseMnx({
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
      lyrics: {
        lineMetadata: {
          "line-a": { label: "Solo", lang: "en" },
          "line-b": { label: "Translation" },
        },
        lineOrder: ["line-a", "line-b"],
      },
    },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    id: "event-1",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    lyrics: { lines: { "line-a": { text: "Hello" }, "line-b": { text: "Bonjour" } } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

function HarnessContent() {
  const { loadScore } = useDocumentActions();
  const score = useDocumentStore((state) => state.score);
  const mnxJson = useDocumentStore((state) => state.mnxJson);
  const store = useDocumentStoreApi();
  const pushState = useHistoryStore((state) => state.pushState);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const canUndo = useHistoryStore((state) => state.canUndo);
  const canRedo = useHistoryStore((state) => state.canRedo);
  const { selectElement } = useSelectionActions();
  useMnxChangeReporter({ store, pushState });

  useEffect(() => {
    loadScore(lyricScore(), "lyrics.mnx");
    selectElement("p0/m0/s0/event-1/n0");
  }, [loadScore, selectElement]);

  if (!score) return null;
  return (
    <>
      <LyricsPanel />
      <output data-testid="score">{JSON.stringify(score)}</output>
      <output data-testid="mnx">{mnxJson}</output>
      <Button disabled={!canUndo} onClick={undo} label="Undo lyric settings" />
      <Button disabled={!canRedo} onClick={redo} label="Redo lyric settings" />
    </>
  );
}

function Harness() {
  const store = useDocumentStoreApi();
  const initialJson = JSON.stringify(serializeMnx(lyricScore()));
  return (
    <HistoryProvider
      initialMnxJson={initialJson}
      onRestore={(json) => store.getState().loadScore(parseMnx(JSON.parse(json)), "lyrics.mnx", json)}
    >
      <HarnessContent />
    </HistoryProvider>
  );
}

function renderPanel() {
  render(
    <TooltipPrimitives.Provider delayDuration={0}>
      <DocumentProvider>
        <Harness />
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
}

function currentScore(): Score {
  return JSON.parse(screen.getByTestId("score").textContent ?? "null") as Score;
}

describe("Lyrics palette controls", () => {
  it("starts lyric entry on the selected note", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Start lyric entry" }));

    expect(useOverlayStore.getState().lyricMode).toBe(true);
    expect(useOverlayStore.getState().lyricState).toEqual({
      elementId: "p0/m0/s0/event-1",
      lineId: "line-a",
    });
  });

  it("turns off note input when entry starts from the palette", async () => {
    const user = userEvent.setup();
    renderPanel();
    toggleNoteInputMode();
    expect(useNoteInputStore.getState().active).toBe(true);

    await user.click(await screen.findByRole("button", { name: "Start lyric entry" }));

    expect(useNoteInputStore.getState().active).toBe(false);
    expect(useOverlayStore.getState().lyricMode).toBe(true);
  });

  it("edits accessible metadata fields and serializes explicit order", async () => {
    const user = userEvent.setup();
    renderPanel();

    const label = await screen.findByRole("textbox", { name: "Active lyric line label" });
    await user.clear(label);
    await user.type(label, "Lead");
    await user.tab();
    await user.click(screen.getByRole("combobox", { name: "Active line" }));
    await user.click(await screen.findByRole("option", { name: "Translation" }));
    const language = screen.getByRole("textbox", { name: "Active lyric line language" });
    await user.type(language, "qaa-Qaaa-QM-x-studio");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Manage lines" }));
    await user.click(screen.getByRole("button", { name: "Move Translation up" }));

    await waitFor(() => {
      expect(currentScore().global.lyrics).toEqual({
        lineMetadata: {
          "line-a": { label: "Lead", lang: "en" },
          "line-b": { label: "Translation", lang: "qaa-Qaaa-QM-x-studio" },
        },
        lineOrder: ["line-b", "line-a"],
      });
    });
    const serialized = JSON.parse(screen.getByTestId("mnx").textContent ?? "null") as {
      global: Score["global"];
    };
    expect(serialized.global.lyrics?.lineOrder).toEqual(["line-b", "line-a"]);
  });

  it("rejects malformed language tags without rewriting valid private-use tags", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("combobox", { name: "Active line" }));
    await user.click(await screen.findByRole("option", { name: "Translation" }));
    const language = screen.getByRole("textbox", { name: "Active lyric line language" });

    await user.type(language, "en_US");
    await user.tab();
    expect(language.getAttribute("aria-invalid")).toBe("true");
    const describedBy = language.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toContain(" ");
    expect(document.getElementById(describedBy ?? "")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("BCP 47");
    expect(currentScore().global.lyrics?.lineMetadata?.["line-b"]?.lang).toBeUndefined();

    await user.clear(language);
    await user.type(language, "x-viritura");
    await user.tab();
    await waitFor(() => expect(currentScore().global.lyrics?.lineMetadata?.["line-b"]?.lang).toBe("x-viritura"));
  });

  it("round-trips metadata edits through undo and redo", async () => {
    const user = userEvent.setup();
    renderPanel();
    const label = await screen.findByRole("textbox", { name: "Active lyric line label" });

    await user.clear(label);
    await user.type(label, "Chorus");
    await user.tab();
    const undo = screen.getByRole("button", { name: "Undo lyric settings" });
    await waitFor(() => expect(undo.hasAttribute("disabled")).toBe(false));
    expect(currentScore().global.lyrics?.lineMetadata?.["line-a"]?.label).toBe("Chorus");

    await user.click(undo);
    await waitFor(() => expect(currentScore().global.lyrics?.lineMetadata?.["line-a"]?.label).toBe("Solo"));
    await user.click(screen.getByRole("button", { name: "Redo lyric settings" }));
    await waitFor(() => expect(currentScore().global.lyrics?.lineMetadata?.["line-a"]?.label).toBe("Chorus"));
  });
});
