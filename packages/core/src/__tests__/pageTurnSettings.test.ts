import { describe, expect, it } from "vitest";
import { pageTurnConfigForLayout, resolvePageTurnSettings } from "../model/layout";

describe("page-turn settings", () => {
  it("resolves the documented 75% minimum-fill default", () => {
    const settings = resolvePageTurnSettings({ enabled: true });
    expect(settings.minFillFraction).toBe(0.75);
    expect(settings.verticalJustifyThreshold).toBe(0.65);
    expect(settings.targetFillFraction).toBe(0.9);
    expect(settings.allowPartialPages).toBe(true);
    expect(settings.weights.titlePage).toBe(0);
  });

  it("serializes every engine knob and weight", () => {
    expect(
      pageTurnConfigForLayout({
        enabled: true,
        comfortableSecs: 7,
        vsSecs: 4,
        minAcceptableSecs: 2,
        targetFillFraction: 0.92,
        minFillFraction: 0.78,
        verticalJustifyThreshold: 0.68,
        allowPartialPages: false,
        allowIntentionalBlanks: false,
        titlePage: "always",
        firstPageRecto: false,
        emitVsMarks: false,
        defaultBpm: 72,
        weights: {
          density: 2,
          turn: 3,
          sparse: 4,
          titlePage: 5,
          blankPage: 6,
          timeMarking: 7,
        },
      }),
    ).toEqual({
      enabled: true,
      comfortable_secs: 7,
      vs_secs: 4,
      min_acceptable_secs: 2,
      target_fill_fraction: 0.92,
      min_fill_fraction: 0.78,
      vertical_justify_threshold: 0.68,
      allow_partial_pages: false,
      allow_intentional_blanks: false,
      title_page: "always",
      first_page_recto: false,
      emit_vs_marks: false,
      default_bpm: 72,
      weights: {
        density: 2,
        turn: 3,
        sparse: 4,
        title_page: 5,
        blank_page: 6,
        time_marking: 7,
      },
    });
  });
});
