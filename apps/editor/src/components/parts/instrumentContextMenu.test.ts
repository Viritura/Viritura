import { describe, expect, it, vi } from "vitest";
import { buildInstrumentContextMenuItems } from "./instrumentContextMenu";

describe("buildInstrumentContextMenuItems", () => {
  it("offers percussion-specific and removal commands when available", () => {
    const onChangeInstrument = vi.fn();
    const onEditDrumKit = vi.fn();
    const onRemove = vi.fn();
    const items = buildInstrumentContextMenuItems({
      partId: "drums",
      isPercussion: true,
      canRemove: true,
      onChangeInstrument,
      onEditDrumKit,
      onRemove,
    });

    expect(items.map((item) => item.label ?? "separator")).toEqual([
      "Change instrument",
      "Edit percussion map",
      "separator",
      "Remove instrument",
    ]);
    items[0]?.action?.();
    items[1]?.action?.();
    items[3]?.action?.();
    expect(onChangeInstrument).toHaveBeenCalledWith("drums");
    expect(onEditDrumKit).toHaveBeenCalledWith("drums");
    expect(onRemove).toHaveBeenCalledWith("drums");
  });

  it("omits percussion and removal commands when they do not apply", () => {
    const items = buildInstrumentContextMenuItems({
      partId: "flute",
      isPercussion: false,
      canRemove: false,
      onChangeInstrument: vi.fn(),
    });

    expect(items.map((item) => item.label)).toEqual(["Change instrument"]);
  });
});
