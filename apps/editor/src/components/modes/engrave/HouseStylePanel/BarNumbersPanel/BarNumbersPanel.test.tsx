import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { staffSpacesToPoints, type Score } from "@viritura/core";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { TooltipPrimitives } from "@viritura/ui";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import type { DocumentStore } from "../../../../../store/documentStore";
import { useViewStateStore } from "../../../../../store/viewStateStore";
import { BarNumbersPanel } from "./BarNumbersPanel";
import { bracketPlacements } from "./bracketPlacements";
import { applyBarNumberPreset } from "./barNumberPresets";

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

it("labels unnamed brackets by their first instrument in layout order, including nested and condensed staves", () => {
  const score: Score = {
    ...SCORE,
    parts: [
      { id: "a", name: "Cello", measures: [] },
      { id: "z", name: "Violin I", measures: [] },
      { id: "v", name: "Violin II", measures: [] },
    ],
    layouts: [
      {
        id: "L",
        content: [
          {
            type: "group",
            symbol: "bracket",
            content: [
              { type: "group", symbol: "square", content: [] },
              {
                type: "group",
                symbol: "square",
                content: [{ type: "staff", sources: [{ part: "z" }, { part: "v" }] }],
              },
              { type: "staff", sources: [{ part: "a" }] },
            ],
          },
        ],
      },
    ],
    scores: [{ layout: "L" }],
  };
  expect(bracketPlacements(score, 0)).toEqual([{ parts: ["a", "v", "z"], label: "Violin I" }]);
  const group = score.layouts?.[0]?.content[0];
  if (!group || group.type !== "group") throw new Error("Expected bracket fixture");
  group.label = "Strings";
  expect(bracketPlacements(score, 0)).toEqual([{ parts: ["a", "v", "z"], label: "Strings" }]);
});

it("falls back to the first instrument ID when its name is unavailable", () => {
  expect(
    bracketPlacements(
      {
        ...SCORE,
        parts: [{ id: "z", name: "", measures: [] }],
        layouts: [
          {
            id: "L",
            content: [
              {
                type: "group",
                symbol: "bracket",
                label: "",
                content: [{ type: "staff", sources: [{ part: "z" }, { part: "missing" }] }],
              },
              {
                type: "group",
                symbol: "bracket",
                content: [{ type: "staff", sources: [{ part: "missing" }] }],
              },
            ],
          },
        ],
        scores: [{ layout: "L" }],
      },
      0,
    ),
  ).toEqual([
    { parts: ["missing", "z"], label: "z" },
    { parts: ["missing"], label: "missing" },
  ]);
});

it("keeps layout edits partial and resets them without changing the house style or other views", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel();
  await user.click(await screen.findByRole("radio", { name: "Every bar" }));
  await user.click(screen.getByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  await user.click(screen.getByRole("radio", { name: "Circle" }));
  await user.click(screen.getByRole("button", { name: "Bold" }));
  expect(getScore()?.barNumbers).toEqual({ frequency: "everyBar" });
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ enclosure: "circle", style: { bold: true } });
  expect(getScore()?.scores?.[2]?.barNumbers).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Reset layout overrides" }));
  expect(getScore()?.scores?.[1]?.barNumbers).toBeUndefined();
  expect(getScore()?.barNumbers).toEqual({ frequency: "everyBar" });
});

it("rejects out-of-range font sizes without saving an invalid setting", async () => {
  const user = userEvent.setup();
  const error = vi.spyOn(toast, "error");
  const getScore = renderPanel({
    ...SCORE,
    scores: SCORE.scores?.map((view, index) => (index === 1 ? { ...view, pageSetup: { spatiumMm: 1.5 } } : view)),
  });
  const size = await screen.findByRole("spinbutton", { name: "Size in points" });
  expect(size).toHaveProperty("value", "8.5");
  expect(screen.queryByText("2 sp")).toBeNull();
  expect(size.getAttribute("min")).toBe("2.2");
  expect(size.getAttribute("step")).toBe("0.1");
  await user.clear(size);
  await user.type(size, "35");
  await user.tab();
  expect(error).toHaveBeenCalledWith("Bar number size must be between 2.2 and 34 pt.");
  expect(getScore()?.barNumbers).toBeUndefined();
  expect(size).toHaveProperty("value", "8.5");
  await user.clear(size);
  await user.type(size, "10");
  await user.tab();
  expect(getScore()?.textStyles?.barNumber?.size).toBeCloseTo(10 / (1.5 * (72 / 25.4)));
});

it("discards an uncommitted size draft when the selected layout changes", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({
    ...SCORE,
    scores: SCORE.scores?.map((view, index) => (index === 1 ? { ...view, barNumbers: { size: 1.5 } } : view)),
  });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  const size = screen.getByRole("spinbutton", { name: "Size in points" });
  await user.clear(size);
  await user.type(size, "4");
  act(() => useViewStateStore.setState({ selectedScoreIndex: 2 }));
  expect(screen.getByRole("spinbutton", { name: "Size in points" })).toHaveProperty("value", "7.1");
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ size: 1.5 });
  expect(getScore()?.scores?.[2]?.barNumbers).toBeUndefined();
});

it("offers only house-style edits when the score has no editable layout definition", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({ ...SCORE, scores: undefined });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["House style (all layouts)"]);
  await user.click(screen.getByRole("option", { name: "House style (all layouts)" }));
  await user.click(screen.getByRole("radio", { name: "Every bar" }));
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
  await user.click(screen.getByRole("radio", { name: "Follow musical content" }));
  await user.click(screen.getByRole("radio", { name: "At barline" }));
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

it("combines system placements with layout-specific outer brackets and hides only the row line", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({
    ...SCORE,
    barNumbers: { placement: "aboveSystem", onStaff: true },
    layouts: [
      {
        id: "L",
        content: [
          {
            type: "group",
            symbol: "bracket",
            label: "Strings",
            content: [
              {
                type: "group",
                symbol: "bracket",
                label: "Inner",
                content: [{ type: "staff", sources: [{ part: "p" }] }],
              },
            ],
          },
        ],
      },
    ],
    scores: SCORE.scores?.map((view) => ({ ...view, layout: "L" })),
  });
  await user.click(screen.getByRole("button", { name: "Placement" }));
  expect(screen.queryByRole("checkbox", { name: "Above Strings bracket" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Below the whole system" }));
  expect(getScore()?.barNumbers?.placements).toEqual(["aboveSystem", "belowSystem"]);
  await user.click(screen.getByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  await user.click(screen.getByRole("button", { name: "Placement" }));
  expect(screen.queryByRole("checkbox", { name: "Above Inner bracket" })).toBeNull();
  await user.click(screen.getByRole("checkbox", { name: "Above Strings bracket" }));
  await user.click(screen.getByRole("checkbox", { name: "Show staff line" }));
  expect(getScore()?.scores?.[1]?.barNumbers).toEqual({ aboveGroups: [["p"]], showStaffLine: false });
  expect(getScore()?.scores?.[2]?.barNumbers).toBeUndefined();
  expect(getScore()?.barNumbers?.onStaff).toBe(true);
});

it("keeps the placement picker keyboard accessible with the shared select trigger", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel();
  const trigger = await screen.findByRole("button", { name: "Placement" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("dialog", { name: "Placement" })).toBeDefined();
  expect(screen.queryByRole("checkbox", { name: "Below the top instrument" })).toBeNull();
  expect(trigger.textContent).toContain("Below the whole system");
  const option = screen.getByRole("checkbox", { name: "Above the whole system" });
  option.focus();
  await user.keyboard(" ");
  expect(option).toHaveProperty("checked", true);
  expect(getScore()?.barNumbers?.placements).toEqual(["belowSystem", "aboveSystem"]);
  expect(trigger.textContent).toContain("Below the whole system (+1)");
  expect(screen.getByRole("dialog", { name: "Placement" })).toBeDefined();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Placement" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("keeps overlapping bracket selections independent", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({
    ...SCORE,
    parts: [
      { id: "p", name: "Piano", staves: 2, measures: [{ sequences: [] }] },
      { id: "v", name: "Violin", measures: [{ sequences: [] }] },
    ],
    layouts: [
      {
        id: "L",
        content: [
          {
            type: "group",
            symbol: "bracket",
            label: "Piano",
            content: [{ type: "staff", sources: [{ part: "p", staff: 1 }] }],
          },
          {
            type: "group",
            symbol: "bracket",
            label: "Combined",
            content: [
              { type: "staff", sources: [{ part: "p", staff: 2 }] },
              { type: "staff", sources: [{ part: "v" }] },
            ],
          },
        ],
      },
    ],
    scores: SCORE.scores?.map((view) => ({ ...view, layout: "L" })),
  });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  await user.click(screen.getByRole("button", { name: "Placement" }));
  const piano = screen.getByRole("checkbox", { name: "Above Piano bracket" });
  const combined = screen.getByRole("checkbox", { name: "Above Combined bracket" });
  await user.click(combined);
  expect(piano).toHaveProperty("checked", false);
  await user.click(piano);
  expect(getScore()?.scores?.[1]?.barNumbers?.aboveGroups).toEqual([["p", "v"], ["p"]]);
  await user.click(combined);
  expect(piano).toHaveProperty("checked", true);
  expect(getScore()?.scores?.[1]?.barNumbers?.aboveGroups).toEqual([["p"]]);
});

it("keeps rapid placement edits while a layout is pending", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({
    ...SCORE,
    barNumbers: { placements: [] },
    parts: [...SCORE.parts, { id: "v", name: "Violin", measures: [{ sequences: [] }] }],
    layouts: [
      {
        id: "L",
        content: [
          { type: "group", symbol: "bracket", label: "Piano", content: [{ type: "staff", sources: [{ part: "p" }] }] },
          {
            type: "group",
            symbol: "bracket",
            label: "Strings",
            content: [{ type: "staff", sources: [{ part: "v" }] }],
          },
        ],
      },
    ],
    scores: SCORE.scores?.map((view) => ({ ...view, layout: "L" })),
  });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  await user.click(screen.getByRole("button", { name: "Placement" }));
  const perf = getGlobalPerfTracker();
  const previous = perf.fastLayoutCallback;
  const completions: Array<() => void> = [];
  perf.fastLayoutCallback = () => new Promise<void>((resolve) => completions.push(resolve));
  try {
    await user.click(screen.getByRole("checkbox", { name: "Above the whole system" }));
    await user.click(screen.getByRole("checkbox", { name: "Below the whole system" }));
    await user.click(screen.getByRole("checkbox", { name: "Above Piano bracket" }));
    await user.click(screen.getByRole("checkbox", { name: "Above Strings bracket" }));
    expect(getScore()?.scores?.[1]?.barNumbers).toEqual({
      placements: ["aboveSystem", "belowSystem"],
      aboveGroups: [["p"], ["v"]],
    });
    expect(screen.getByRole("checkbox", { name: "Above the whole system" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "Below the whole system" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "Above Piano bracket" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "Above Strings bracket" })).toHaveProperty("checked", true);
  } finally {
    perf.fastLayoutCallback = previous;
    await act(async () => completions.forEach((complete) => complete()));
  }
});

it("shows vertical-alignment help on hover instead of an inline paragraph", async () => {
  const user = userEvent.setup();
  renderPanel();
  const help = await screen.findByRole("button", { name: "About bar number vertical alignment" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  await user.hover(help);
  expect((await screen.findByRole("tooltip")).textContent).toContain("creates a staff-like row");
});

it("applies Film score to the current layout with an 8 pt boxed style above its string bracket", async () => {
  const user = userEvent.setup();
  const getScore = renderPanel({
    ...SCORE,
    parts: [{ id: "p", name: "Violin", _x: { viritura: { family: "strings" } }, measures: [] }],
    layouts: [
      {
        id: "strings",
        content: [{ type: "group", symbol: "bracket", content: [{ type: "staff", sources: [{ part: "p" }] }] }],
      },
    ],
    scores: SCORE.scores?.map((view) => ({ ...view, layout: "strings", pageSetup: { spatiumMm: 1.5 } })),
  });
  await user.click(await screen.findByRole("combobox", { name: "Apply to" }));
  await user.click(screen.getByRole("option", { name: "Current layout: Part" }));
  await user.click(screen.getByRole("button", { name: "Film score" }));
  const settings = getScore()?.scores?.[1]?.barNumbers;
  expect(settings).toMatchObject({
    frequency: "everyBar",
    showFirst: true,
    onStaff: true,
    showStaffLine: true,
    horizontalAlignment: "center",
    enclosure: "box",
    placements: [],
    aboveGroups: [["p"]],
    style: { bold: true, italic: false },
  });
  expect(staffSpacesToPoints(settings!.style!.size!, 1.5)).toBeCloseTo(8);
  expect(screen.getByRole("spinbutton", { name: "Size in points" })).toHaveProperty("value", "8.0");
  expect(screen.getByRole("checkbox", { name: "Show on first bar" })).toHaveProperty("checked", true);
  expect(screen.getByRole("checkbox", { name: "Show staff line" })).toHaveProperty("checked", true);
  expect(getScore()?.scores?.[2]?.barNumbers).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Classical" }));
  expect(getScore()?.scores?.[1]?.barNumbers).toMatchObject({
    frequency: "systemStarts",
    placements: ["belowSystem"],
    aboveGroups: [],
    onStaff: false,
    showFirst: false,
    enclosure: "none",
    style: { bold: false, italic: true },
  });
});

it("preserves house-style layout overrides and uses the system bottom when no strings bracket exists", () => {
  const score: Score = {
    ...SCORE,
    parts: [...SCORE.parts, { id: "v", name: "Violins", measures: [] }],
    layouts: [
      {
        id: "L",
        content: [
          {
            type: "group",
            symbol: "bracket",
            label: "Strings",
            content: [{ type: "staff", sources: [{ part: "v" }] }],
          },
        ],
      },
    ],
    scores: [
      { name: "Default" },
      {
        name: "Custom",
        barNumbers: {
          frequency: "hidden",
          placements: ["aboveSystem"],
          style: { italic: true },
        },
      },
      { name: "Strings", layout: "L", barNumbers: { distance: 3 } },
    ],
  };
  const next = applyBarNumberPreset(score, 0, "document", "film");
  expect(next.barNumbers).toMatchObject({ frequency: "everyBar", placements: ["belowSystem"], onStaff: true });
  expect(next.scores?.[0]?.barNumbers).toBeUndefined();
  expect(next.scores?.[1]).toEqual(score.scores?.[1]);
  expect(next.scores?.[2]?.barNumbers).toEqual({ distance: 3, placements: [], aboveGroups: [["v"]] });
  expect(next.textStyles?.barNumber).toMatchObject({ bold: true, italic: false });
  expect(score.barNumbers).toBeUndefined();
});
