/**
 * LayoutBinding — base vs. per-system structure editing.
 *
 * These tests pin the seam that lets one structure editor serve Setup (the
 * score's default layout) and, later, Engrave (a per-system override). The
 * load-bearing guarantee is that a system-scoped edit never mutates the base.
 */
import { describe, expect, it } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";
import { createBaseLayoutBinding, createSystemLayoutBinding } from "../score/layoutBinding";

const BASE_ID = "L-full";
const SYSTEM_MEASURE = "m1";

function staff(part: string): LayoutContent {
  return { type: "staff", sources: [{ part }] };
}

function group(label: string, symbol: string, content: LayoutContent[]): LayoutContent {
  return { type: "group", label, symbol, content } as LayoutContent;
}

/** Two-staff score with one paginated system, so a system binding has an anchor. */
function makeScore(): Score {
  return {
    global: { measures: [{}] },
    parts: [{ id: "P1" }, { id: "P2" }],
    layouts: [{ id: BASE_ID, content: [staff("P1"), staff("P2")] }],
    scores: [
      {
        name: "Full Score",
        layout: BASE_ID,
        pages: [{ systems: [{ measure: SYSTEM_MEASURE }] }],
      },
    ],
  } as unknown as Score;
}

function layoutById(score: Score, id: string) {
  return score.layouts?.find((l) => l.id === id);
}

function systemLayoutId(score: Score): string | undefined {
  return score.scores?.[0]?.pages?.[0]?.systems?.[0]?.layout;
}

describe("createBaseLayoutBinding", () => {
  it("exposes the score's default layout content", () => {
    const binding = createBaseLayoutBinding(makeScore(), 0)!;
    expect(binding.scope.kind).toBe("base");
    expect(binding.content).toHaveLength(2);
  });

  it("writes edits straight through to the base layout", () => {
    const score = makeScore();
    const binding = createBaseLayoutBinding(score, 0)!;

    const next = binding.applyEdit([group("Winds", "bracket", [staff("P1"), staff("P2")])]);

    expect(layoutById(next, BASE_ID)!.content).toHaveLength(1);
    // No derived layout is minted — the base itself changed.
    expect(next.layouts).toHaveLength(1);
  });

  it("never reports overrides — the base has nothing to inherit from", () => {
    const binding = createBaseLayoutBinding(makeScore(), 0)!;
    expect(binding.hasOverrides).toBe(false);
    expect(binding.isOverridden([0])).toBe(false);
  });

  it("returns null when the score has no layout", () => {
    const score = { ...makeScore(), scores: [{ name: "X" }] } as unknown as Score;
    expect(createBaseLayoutBinding(score, 0)).toBeNull();
  });
});

describe("createSystemLayoutBinding", () => {
  it("falls back to the base layout when the system has no override", () => {
    const binding = createSystemLayoutBinding(makeScore(), 0, SYSTEM_MEASURE, "System 1")!;
    expect(binding.hasOverrides).toBe(false);
    expect(binding.content).toHaveLength(2);
  });

  it("derives a new layout and leaves the base untouched", () => {
    const score = makeScore();
    const binding = createSystemLayoutBinding(score, 0, SYSTEM_MEASURE, "System 1")!;

    const next = binding.applyEdit([group("Winds", "bracket", [staff("P1"), staff("P2")])]);

    // The base is byte-for-byte what it was.
    expect(layoutById(next, BASE_ID)!.content).toEqual([staff("P1"), staff("P2")]);
    // The system now points at a *different*, derived layout.
    const derivedId = systemLayoutId(next);
    expect(derivedId).toBeDefined();
    expect(derivedId).not.toBe(BASE_ID);
    expect(layoutById(next, derivedId!)!._x?.viritura?.derived).toBe(true);
  });

  it("reports the overridden node once a system edit exists", () => {
    const score = makeScore();
    const edited = createSystemLayoutBinding(score, 0, SYSTEM_MEASURE, "System 1")!.applyEdit([
      group("Winds", "bracket", [staff("P1"), staff("P2")]),
    ]);

    const rebound = createSystemLayoutBinding(edited, 0, SYSTEM_MEASURE, "System 1")!;
    expect(rebound.hasOverrides).toBe(true);
    expect(rebound.isOverridden([0])).toBe(true);
  });

  it("reverting restores the base and garbage-collects the derived layout", () => {
    const score = makeScore();
    const edited = createSystemLayoutBinding(score, 0, SYSTEM_MEASURE, "System 1")!.applyEdit([
      group("Winds", "bracket", [staff("P1"), staff("P2")]),
    ]);
    expect(edited.layouts).toHaveLength(2);

    const reverted = createSystemLayoutBinding(edited, 0, SYSTEM_MEASURE, "System 1")!.revert!();

    expect(systemLayoutId(reverted)).toBe(BASE_ID);
    // The orphaned derived layout is collected; the user-authored base stays.
    expect(reverted.layouts).toHaveLength(1);
    expect(reverted.layouts![0]!.id).toBe(BASE_ID);
  });

  it("dedups structurally — two systems with the same shape share one layout", () => {
    const score = makeScore();
    // Give the score a second system to override.
    const twoSystems = {
      ...score,
      scores: [{ ...score.scores![0]!, pages: [{ systems: [{ measure: "m1" }, { measure: "m2" }] }] }],
    } as unknown as Score;

    const shape = [group("Winds", "bracket", [staff("P1"), staff("P2")])];
    const afterFirst = createSystemLayoutBinding(twoSystems, 0, "m1", "System 1")!.applyEdit(shape);
    const afterSecond = createSystemLayoutBinding(afterFirst, 0, "m2", "System 2")!.applyEdit(shape);

    // One base + exactly one derived layout, referenced by both systems.
    expect(afterSecond.layouts).toHaveLength(2);
    const systems = afterSecond.scores![0]!.pages![0]!.systems;
    expect(systems[0]!.layout).toBe(systems[1]!.layout);
  });
});
