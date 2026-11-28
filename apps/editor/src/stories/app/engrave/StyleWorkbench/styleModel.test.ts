import { describe, expect, it } from "vitest";
import {
  adoptStyle,
  changeField,
  clearCategory,
  copyCategory,
  deleteProfile,
  duplicateProfile,
  findLayout,
  initialProject,
  PRESETS,
  promoteOverride,
  resolveLayout,
  type Project,
} from "./styleModel";
import { pageGeometry } from "./pageGeometry";

const part = { kind: "profile", id: "part" } as const;
const value = (project: Project, id: string, field: Parameters<typeof resolveLayout>[2]) =>
  resolveLayout(project, findLayout(project, id), field);

describe("style workbench house style", () => {
  it("propagates a profile edit to every layout on that profile, except protected overrides", () => {
    const project = changeField(changeField(initialProject(), part, "staff", "6 mm"), part, "marginInner", "10 mm");
    expect(value(project, "violin", "staff")).toBe("6 mm");
    expect(value(project, "flute", "marginInner")).toBe("10 mm");
    expect(value(project, "cello", "marginInner")).toBe("20 mm");
    expect(value(project, "horn", "staff")).toBe("8 mm");
    expect(value(project, "full", "staff")).toBe("5 mm");
  });

  it("lets a profile setting shadow the shared layer, and a pinned layout value survive later edits", () => {
    const shared = changeField(initialProject(), { kind: "common" }, "size", "10 pt");
    expect(value(shared, "violin", "size")).toBe("10 pt");
    expect(value(shared, "horn", "size")).toBe("12 pt");
    const pinned = changeField(shared, { kind: "layout", id: "violin" }, "size", "10 pt");
    const later = changeField(pinned, { kind: "common" }, "size", "9 pt");
    expect(value(later, "violin", "size")).toBe("10 pt");
  });

  it("feeds print settings into page geometry", () => {
    const initial = initialProject();
    const larger = changeField(initial, part, "staff", "8 mm");
    expect(pageGeometry(initial, findLayout(initial, "violin")).width).toBe(216);
    expect(pageGeometry(larger, findLayout(larger, "violin")).pages).toBeGreaterThan(
      pageGeometry(initial, findLayout(initial, "violin")).pages,
    );
    const landscape = changeField(initial, part, "orientation", "Landscape");
    expect(pageGeometry(landscape, findLayout(landscape, "violin")).width).toBe(279);
  });

  it("promotes a layout override into its profile for every layout using it", () => {
    const project = promoteOverride(initialProject(), "cello", "marginInner");
    expect(findLayout(project, "cello").overrides.marginInner).toBeUndefined();
    expect(value(project, "violin", "marginInner")).toBe("20 mm");
  });

  it("creates and deletes profiles without orphaning layouts or removing a role's last profile", () => {
    const { project, id } = duplicateProfile(initialProject(), "score", "Study score");
    expect(value({ ...project, layouts: project.layouts.map((l) => ({ ...l, profileId: id })) }, "full", "paper")).toBe(
      "9 x 12 in",
    );
    expect(deleteProfile(project, "score").style.profiles.some((profile) => profile.id === "score")).toBe(false);
    const removed = deleteProfile(initialProject(), "large-part");
    expect(findLayout(removed, "horn").profileId).toBe("part");
    expect(deleteProfile(initialProject(), "score").style.profiles).toHaveLength(3);
  });

  it("applies a preset while preserving overrides and remapping missing profiles", () => {
    const initial = initialProject();
    const adopted = adoptStyle(initial, PRESETS[1]);
    expect(findLayout(adopted, "horn").profileId).toBe("part");
    expect(adopted.layouts.map((layout) => layout.overrides)).toEqual(
      initial.layouts.map((layout) => layout.overrides),
    );
    expect(value(adopted, "full", "orientation")).toBe("Landscape");
    expect(value(adopted, "cello", "frequency")).toBe("Every bar");
  });

  it("copies one category as explicit overrides and resets it without clearing manual decisions", () => {
    const copied = copyCategory(initialProject(), "full", ["cello"], "numbers");
    expect(findLayout(copied, "cello").overrides).toMatchObject({ marginInner: "20 mm", size: "10 pt" });
    const reset = clearCategory(copied, { kind: "layout", id: "cello" }, "numbers");
    expect(findLayout(reset, "cello").overrides).toEqual({ marginInner: "20 mm" });
    expect(findLayout(reset, "cello").manualBreaks).toBe(1);
  });
});
