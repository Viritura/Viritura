import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import type { DocumentStore } from "../../../../../store/documentStore";
import { useViewStateStore } from "../../../../../store/viewStateStore";
import { BarNumbersPanel } from "./BarNumbersPanel";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ id: "p", name: "Piano", measures: [{ sequences: [] }] }],
  scores: [{ name: "Score" }, { name: "Part" }, { name: "Alternative" }],
};

function Harness({ score, onStore }: { score: Score; onStore: (store: DocumentStore) => void }) {
  const store = useDocumentStoreApi();
  const loaded = useDocumentStore((state) => state.score !== null);
  useEffect(() => {
    store.getState().loadScore(score);
    onStore(store);
  }, [score, store, onStore]);
  return loaded ? <BarNumbersPanel /> : null;
}

function renderPanel(score = SCORE) {
  let store: DocumentStore;
  useViewStateStore.setState({ selectedScoreIndex: 1 });
  render(
    <TooltipPrimitives.Provider>
      <DocumentProvider>
        <Harness
          score={score}
          onStore={(value) => {
            store = value;
          }}
        />
      </DocumentProvider>
    </TooltipPrimitives.Provider>,
  );
  return () => store.getState().workingScore;
}

afterEach(() => {
  cleanup();
  useViewStateStore.setState({ selectedScoreIndex: 0 });
  vi.restoreAllMocks();
});

it("keeps layout edits partial and resets them without changing the house style or other views", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel();
  await user.click(await screen.findByRole("combobox", { name: "Frequency" }));
  await user.click(screen.getByRole("option", { name: "Every bar" }));
  await user.click(screen.getByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  await user.click(screen.getByRole("combobox", { name: "Enclosure" }));
  await user.click(screen.getByRole("option", { name: "Circle" }));
  await user.click(screen.getByRole("checkbox", { name: "Bold" }));
  expect(getScore()?.barNumbers).toEqual({ frequency: "everyBar" });
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ enclosure: "circle", bold: true });
  expect(getScore()?.scores?.[2]?.barNumbers).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Reset layout overrides" }));
  expect(getScore()?.scores?.[1]?.barNumbers).toBeUndefined();
  expect(getScore()?.barNumbers).toEqual({ frequency: "everyBar" });
});

it("rejects out-of-range font sizes without saving an invalid setting", async () => {
  const user = userEvent.setup();
  const error = vi.spyOn(toast, "error");
  const getScore = renderPanel();
  const size = await screen.findByRole("spinbutton", { name: "Size (staff spaces)" });
  await user.clear(size);
  await user.type(size, "9");
  await user.tab();
  expect(error).toHaveBeenCalledWith("Bar number size must be between 0.5 and 8 staff spaces.");
  expect(getScore()?.barNumbers).toBeUndefined();
  expect(size).toHaveProperty("value", "2");
  await user.clear(size);
  await user.type(size, "1.25");
  await user.tab();
  expect(getScore()?.barNumbers).toEqual({ size: 1.25 });
});

it("discards an uncommitted size draft when the selected layout changes", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({
    ...SCORE,
    scores: SCORE.scores?.map((view, index) => (index === 1 ? { ...view, barNumbers: { size: 1.5 } } : view)),
  });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  const size = screen.getByRole("spinbutton", { name: "Size (staff spaces)" });
  await user.clear(size);
  await user.type(size, "4");
  act(() => useViewStateStore.setState({ selectedScoreIndex: 2 }));
  expect(screen.getByRole("spinbutton", { name: "Size (staff spaces)" })).toHaveProperty("value", "2");
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ size: 1.5 });
  expect(getScore()?.scores?.[2]?.barNumbers).toBeUndefined();
});

it("offers only house-style edits when the score has no editable layout definition", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({ ...SCORE, scores: undefined });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["House style (all layouts)"]);
  await user.click(screen.getByRole("option", { name: "House style (all layouts)" }));
  await user.click(screen.getByRole("combobox", { name: "Frequency" }));
  await user.click(screen.getByRole("option", { name: "Every bar" }));
  expect(getScore()?.barNumbers).toEqual({ frequency: "everyBar" });
  expect(getScore()?.scores).toBeUndefined();
});

it("stores alignment, staff style and validated spacing as partial layout overrides", async () => {
  const user = userEvent.setup();
  const error = vi.spyOn(toast, "error");
  const getScore = renderPanel({ ...SCORE, barNumbers: { distance: 3, horizontalAlignment: "center", onStaff: true } });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  expect(screen.getByRole("spinbutton", { name: "Distance from staff (staff spaces)" })).toHaveProperty("value", "3");
  await user.click(screen.getByRole("checkbox", { name: "Single-line bar number staff" }));
  await user.click(screen.getByRole("combobox", { name: "Horizontal alignment" }));
  await user.click(screen.getByRole("option", { name: "Aligned with barline" }));
  const distance = screen.getByRole("spinbutton", { name: "Distance from staff (staff spaces)" });
  await user.clear(distance);
  await user.type(distance, "-1");
  await user.tab();
  expect(error).toHaveBeenCalledWith("Bar number distance must be a finite, non-negative number of staff spaces.");
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ onStaff: false, horizontalAlignment: "barline" });
  await user.clear(distance);
  await user.type(distance, "0");
  await user.tab();
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ onStaff: false, horizontalAlignment: "barline", distance: 0 });
  expect(getScore()?.barNumbers).toEqual({ distance: 3, horizontalAlignment: "center", onStaff: true });
});
