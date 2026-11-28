import { describe, expect, it } from "vitest";
import { DEFAULT_PART_PAGE_SETUP, resolveScorePageSetup, type Score } from "@viritura/core";
import {
  PAGE_FIELDS,
  applyHouseStylePreset,
  assignLayoutProfile,
  clearDownstream,
  clearLayoutOverrides,
  copyPageFields,
  createLayoutProfile,
  deleteLayoutProfile,
  downstreamOverrides,
  layoutOverrides,
  promoteField,
  resetField,
  setLayoutRole,
  setPageValues,
  updatePageTurns,
} from "./index";

const staffSize = PAGE_FIELDS.find((field) => field.id === "staffSize")!;
const topMargin = PAGE_FIELDS.find((field) => field.id === "marginTop")!;

function project(): Score {
  return {
    parts: [],
    scores: [
      { name: "Full score", pageSetupRole: "score" },
      { name: "Violin I", pageSetupRole: "part" },
      { name: "Cello", pageSetupRole: "part" },
    ],
  } as unknown as Score;
}

describe("engrave style cascade", () => {
  it("propagates a profile change to every layout that does not override the field", () => {
    let score = setPageValues(project(), { kind: "layout", index: 2 }, { spatiumMm: 2 });
    score = setPageValues(score, { kind: "profile", role: "part" }, { spatiumMm: 1.5 });

    expect(resolveScorePageSetup(score, 1).spatiumMm).toBe(1.5);
    expect(resolveScorePageSetup(score, 2).spatiumMm).toBe(2);
    expect(resolveScorePageSetup(score, 0).spatiumMm).not.toBe(1.5);
    expect(downstreamOverrides(score, { kind: "profile", role: "part" }, staffSize)).toEqual([2]);
  });

  it("keeps sibling margins when one side is set and reset", () => {
    const scope = { kind: "layout", index: 1 } as const;
    let score = setPageValues(project(), scope, { margins: { top: 30 } });
    score = setPageValues(score, scope, { margins: { left: 5 } });
    expect(score.scores![1]!.pageSetup).toEqual({ margins: { top: 30, left: 5 } });

    score = resetField(score, scope, topMargin);
    expect(score.scores![1]!.pageSetup).toEqual({ margins: { left: 5 } });
    expect(resolveScorePageSetup(score, 1).margins.top).toBe(DEFAULT_PART_PAGE_SETUP.margins.top);
  });

  it("moves a layout value to its profile and clears the layout copy", () => {
    let score = setPageValues(project(), { kind: "layout", index: 1 }, { spatiumMm: 1.75 });
    score = promoteField(score, { kind: "layout", index: 1 }, staffSize);

    expect(score.scores![1]!.pageSetup).toBeUndefined();
    expect(score.pageSetupDefaults?.part).toEqual({ spatiumMm: 1.75 });
    expect(resolveScorePageSetup(score, 2).spatiumMm).toBe(1.75);
  });

  it("clears downstream overrides only for layouts using the profile", () => {
    let score = setPageValues(project(), { kind: "layout", index: 0 }, { spatiumMm: 2 });
    score = setPageValues(score, { kind: "layout", index: 1 }, { spatiumMm: 2 });
    score = clearDownstream(score, { kind: "profile", role: "part" }, staffSize);

    expect(score.scores![0]!.pageSetup).toEqual({ spatiumMm: 2 });
    expect(score.scores![1]!.pageSetup).toBeUndefined();
  });

  it("creates, assigns, and deletes named profiles without losing layout overrides", () => {
    const created = createLayoutProfile(project(), "part", "Large print");
    let score = setPageValues(created.score, created.profile, { spatiumMm: 2 });
    score = assignLayoutProfile(score, 1, created.profile);
    score = setPageValues(score, { kind: "layout", index: 1 }, { margins: { top: 40 } });
    expect(resolveScorePageSetup(score, 1).spatiumMm).toBe(2);
    expect(resolveScorePageSetup(score, 2).spatiumMm).toBe(DEFAULT_PART_PAGE_SETUP.spatiumMm);

    score = deleteLayoutProfile(score, created.profile.id!);
    expect(score.layoutProfiles).toBeUndefined();
    expect(score.scores![1]!.layoutProfile).toBeUndefined();
    expect(resolveScorePageSetup(score, 1)).toMatchObject({
      spatiumMm: DEFAULT_PART_PAGE_SETUP.spatiumMm,
      margins: { top: 40 },
    });
  });

  it("resets the profile when a layout changes type", () => {
    const created = createLayoutProfile(project(), "part", "Large print");
    let score = assignLayoutProfile(created.score, 1, created.profile);
    score = setLayoutRole(score, 1, "score");

    expect(score.scores![1]).toMatchObject({ pageSetupRole: "score" });
    expect(score.scores![1]!.layoutProfile).toBeUndefined();
  });

  it("summarizes, copies, and clears layout overrides", () => {
    let score = setPageValues(project(), { kind: "layout", index: 1 }, { spatiumMm: 2, margins: { top: 9 } });
    score = {
      ...score,
      scores: score.scores!.map((view, i) => (i === 1 ? { ...view, barNumbers: { frequency: "everyBar" } } : view)),
    };
    expect(layoutOverrides(score, 1)).toMatchObject({ page: ["Staff size", "Top margin"], barNumbers: 1, total: 3 });

    score = copyPageFields(score, { kind: "layout", index: 1 }, [2], [staffSize]);
    expect(score.scores![2]!.pageSetup).toEqual({ spatiumMm: 2 });

    score = clearLayoutOverrides(score, 1);
    expect(layoutOverrides(score, 1).total).toBe(0);
  });

  it("applies house presets without touching layout overrides", () => {
    const score = setPageValues(project(), { kind: "layout", index: 1 }, { spatiumMm: 2 });
    const film = applyHouseStylePreset(score, "film", 0);

    expect(film.pageSetupDefaults?.score?.orientation).toBe("portrait");
    expect(film.barNumbers?.frequency).toBe("everyBar");
    expect(film.scores![1]!.pageSetup).toEqual({ spatiumMm: 2 });

    const classical = applyHouseStylePreset(film, "classical", 0);
    expect(classical.pageSetupDefaults).toBeUndefined();
    expect(classical.timeSignatures).toBeUndefined();
  });
});

describe("page turn layers", () => {
  it("stores only changed page-turn values so the rest keeps following the profile", () => {
    let score = setPageValues(
      project(),
      { kind: "profile", role: "part" },
      {
        pageTurns: { enabled: true, comfortableSecs: 6 },
      },
    );
    score = updatePageTurns(score, { kind: "layout", index: 2 }, (current) => ({
      ...current,
      minAcceptableSecs: current.minAcceptableSecs + 1,
      weights: { ...current.weights, turn: current.weights.turn + 1 },
    }));
    const stored = score.scores?.[2]?.pageSetup?.pageTurns;
    expect(Object.keys(stored ?? {}).sort()).toEqual(["enabled", "minAcceptableSecs", "weights"]);
    expect(Object.keys(stored?.weights ?? {})).toEqual(["turn"]);

    score = setPageValues(
      score,
      { kind: "profile", role: "part" },
      {
        pageTurns: { enabled: true, comfortableSecs: 9 },
      },
    );
    expect(resolveScorePageSetup(score, 2).pageTurns?.comfortableSecs).toBe(9);
    expect(updatePageTurns(score, { kind: "layout", index: 1 }, (current) => current)).toBe(score);
  });
});
