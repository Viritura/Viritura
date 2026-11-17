import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PART_PAGE_SETUP, resolveScorePageSetup, type Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { TooltipPrimitives } from "@viritura/ui";
import { DocumentProvider, useDocumentStore, useDocumentStoreApi } from "../../../../store/DocumentContext";
import type { DocumentStore } from "../../../../store/documentStore";
import { TitlePageControl } from "./TitlePageControl";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [{ id: "p", name: "Flute", measures: [{ sequences: [] }] }],
  scores: [
    { name: "Full score", pageSetupRole: "score" },
    { name: "Flute 1", pageSetupRole: "part" },
    { name: "Flute 2", pageSetupRole: "part" },
  ],
  pageSetupDefaults: {
    part: {
      ...DEFAULT_PART_PAGE_SETUP,
      width: 215.9,
      height: 279.4,
      margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
      pageTurns: { enabled: true, preset: "professional" },
    },
  },
};

function Harness({
  score,
  scoreIndex,
  onStore,
}: {
  score: Score;
  scoreIndex: number;
  onStore: (store: DocumentStore) => void;
}) {
  const store = useDocumentStoreApi();
  const loaded = useDocumentStore((state) => state.score !== null);
  useEffect(() => {
    store.getState().loadScore(score);
    onStore(store);
  }, [score, store, onStore]);
  return loaded ? <TitlePageControl scoreIndex={scoreIndex} /> : null;
}

function renderControl(score = SCORE, scoreIndex = 1) {
  let store: DocumentStore;
  const onStore = (value: DocumentStore) => {
    store = value;
  };
  const ui = (index: number) => (
    <TooltipPrimitives.Provider>
      <DocumentProvider>
        <Harness score={score} scoreIndex={index} onStore={onStore} />
      </DocumentProvider>
    </TooltipPrimitives.Provider>
  );
  const result = render(ui(scoreIndex));
  return {
    getScore: () => store.getState().workingScore!,
    switchPart: (index: number) => result.rerender(ui(index)),
  };
}

afterEach(cleanup);

describe("part title-page control", () => {
  it("persists each policy only for the selected part without geometry or break overrides", async () => {
    const user = userEvent.setup();
    const { getScore, switchPart } = renderControl();
    for (const [label, policy] of [
      ["Off", "never"],
      ["On", "always"],
      ["Automatic", "auto"],
    ]) {
      await user.click(await screen.findByRole("combobox", { name: "Title page for this part" }));
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Automatic", "On", "Off"]);
      await user.click(screen.getByRole("option", { name: label }));
      const current = getScore();
      expect(current.scores?.[1]?.pageSetup).toEqual({ pageTurns: { enabled: true, titlePage: policy } });
      expect(current.scores?.[1]?.layoutBreaks).toBeUndefined();
      expect(current.scores?.[2]?.pageSetup).toBeUndefined();
      expect(current.pageSetupDefaults).toEqual(SCORE.pageSetupDefaults);
      const reopened = parseMnx(serializeMnx(current));
      expect(resolveScorePageSetup(reopened, 1)).toEqual({
        ...SCORE.pageSetupDefaults!.part,
        pageTurns: { ...SCORE.pageSetupDefaults!.part!.pageTurns, titlePage: policy },
      });
    }
    act(() => switchPart(2));
    expect(await screen.findByRole("combobox", { name: "Title page for this part" })).toHaveProperty(
      "textContent",
      "Title: Auto",
    );
    act(() => switchPart(1));
    expect(await screen.findByRole("combobox", { name: "Title page for this part" })).toHaveProperty(
      "textContent",
      "Title: Auto",
    );
  });

  it("explicitly selects automatic without clearing other settings or inheriting a forced project policy", async () => {
    const user = userEvent.setup();
    const custom: Score = {
      ...SCORE,
      pageSetupDefaults: {
        part: { ...SCORE.pageSetupDefaults!.part!, pageTurns: { enabled: true, titlePage: "always" } },
      },
      scores: SCORE.scores?.map((definition, index) =>
        index === 1
          ? {
              ...definition,
              pageSetup: { width: 250, pageTurns: { enabled: true, titlePage: "never", comfortableSecs: 8 } },
            }
          : definition,
      ),
    };
    const { getScore } = renderControl(custom);
    await user.click(await screen.findByRole("combobox", { name: "Title page for this part" }));
    await user.click(screen.getByRole("option", { name: "Automatic" }));
    expect(getScore().scores?.[1]?.pageSetup).toEqual({
      width: 250,
      pageTurns: { enabled: true, titlePage: "auto", comfortableSecs: 8 },
    });
    expect(resolveScorePageSetup(getScore(), 1).pageTurns).toMatchObject({
      titlePage: "auto",
      comfortableSecs: 8,
    });
  });

  it("hides the control for full scores and disables it for authored pagination or disabled planning", async () => {
    const { switchPart } = renderControl(SCORE, 0);
    expect(screen.queryByRole("combobox")).toBeNull();
    act(() => switchPart(1));
    expect(await screen.findByRole("combobox")).toHaveProperty("disabled", false);
    cleanup();
    renderControl(
      {
        ...SCORE,
        scores: [{ pageSetupRole: "part", layoutBreaks: [{ measure: "m2", kind: "system" }] }],
      },
      0,
    );
    expect(await screen.findByRole("combobox")).toHaveProperty("disabled", true);
    cleanup();
    renderControl(
      {
        ...SCORE,
        scores: [{ pageSetupRole: "part", pageSetup: { pageTurns: { enabled: false } } }],
      },
      0,
    );
    expect(await screen.findByRole("combobox")).toHaveProperty("disabled", true);
  });
});
