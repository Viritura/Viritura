import { describe, expect, it } from "vitest";
import {
  adoptPreset,
  changeField,
  clearCategory,
  copyCategory,
  initialProject,
  PRESETS,
  resolveField,
} from "./styleModel";

describe("style workbench inheritance", () => {
  it("propagates role defaults per field without changing another role or a protected override", () => {
    const project = changeField(initialProject(), "part", "full", "frequency", "Hidden");
    const [full, violin, cello] = project.layouts;
    expect(resolveField(project, "layout", violin, "frequency").value).toBe("Hidden");
    expect(resolveField(project, "layout", cello, "frequency").value).toBe("Every bar");
    expect(resolveField(project, "layout", full, "frequency").value).toBe("System starts");
    const reset = changeField(project, "layout", "cello", "frequency");
    expect(resolveField(reset, "layout", reset.layouts[2], "frequency").value).toBe("Hidden");
    expect(reset.layouts[2].overrides.margin).toBe("20 mm");
  });

  it("preserves a pinned value equal to its parent until an explicit reset", () => {
    const pinned = changeField(initialProject(), "layout", "violin", "size", "9 pt");
    const changed = changeField(pinned, "common", "full", "size", "12 pt");
    expect(resolveField(changed, "layout", changed.layouts[1], "size")).toEqual({
      value: "9 pt",
      source: "This layout",
    });
  });

  it("adopts a library snapshot while preserving layout overrides and manual decisions", () => {
    const customized = changeField(initialProject(), "part", "full", "paper", "A4");
    const adopted = adoptPreset(customized, PRESETS[1], true);
    expect(adopted.layouts).toEqual(customized.layouts);
    expect(resolveField(adopted, "layout", adopted.layouts[1], "paper").value).toBe("A4");
    const replaced = adoptPreset(customized, PRESETS[1], false);
    expect(resolveField(replaced, "layout", replaced.layouts[1], "paper").value).toBe("Letter");
    expect(replaced.layouts).toEqual(customized.layouts);
  });

  it("copies only the selected category as explicit overrides and resets it without clearing manual decisions", () => {
    const initial = initialProject();
    const copied = copyCategory(initial, "full", ["cello"], "numbers");
    expect(copied.layouts[2].overrides).toMatchObject({ margin: "20 mm", frequency: "System starts", size: "10 pt" });
    const reset = clearCategory(copied, "layout", "cello", "numbers");
    expect(reset.layouts[2].overrides).toEqual({ margin: "20 mm" });
    expect(reset.layouts[2].manualBreaks).toBe(1);
    expect(initial.layouts[2].overrides.frequency).toBe("Every bar");
  });
});
