import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DynamicGroup } from "@viritura/core";
import { useDynamicGroupHandlers } from "../components/inspector/useDynamicGroupHandlers";

function inspector(dynamic: DynamicGroup) {
  return renderHook(() => useDynamicGroupHandlers((update) => update(dynamic))).result;
}

describe("dynamic inspector edits", () => {
  it("replaces stale imported glyphs when changing the marking", () => {
    const dynamic: DynamicGroup = {
      id: "d",
      type: "immediate",
      position: { fraction: [0, 1] },
      value: "fff",
      glyphs: ["dynamicForte", "dynamicForte", "dynamicForte"],
    };
    const handlers = inspector(dynamic);
    act(() => handlers.current.handleDynamicValueChange("p"));
    expect(dynamic.value).toBe("p");
    expect(dynamic.glyphs).toEqual(["dynamicPiano"]);
  });

  it("does not impose explicit glyphs when editing unrelated imported properties", () => {
    const dynamic: DynamicGroup = {
      id: "d",
      type: "immediate",
      position: { fraction: [0, 1] },
      value: "fff",
    };
    const handlers = inspector(dynamic);
    act(() => {
      handlers.current.handleDynamicPlacementChange("above");
      handlers.current.handleDynamicPrefixChange("sempre");
    });
    expect(dynamic.glyphs).toBeUndefined();
    expect(dynamic.value).toBe("fff");
  });

  it("can clear a relative printed marking without changing performance intent", () => {
    const dynamic: DynamicGroup = {
      id: "d",
      type: "relative",
      position: { fraction: [0, 1] },
      relativeValue: "louder",
      value: "p",
      glyphs: ["dynamicPiano"],
    };
    const handlers = inspector(dynamic);
    act(() => handlers.current.handleDynamicValueChange(undefined));
    expect(dynamic.value).toBeUndefined();
    expect(dynamic.glyphs).toBeUndefined();
    expect(dynamic.relativeValue).toBe("louder");
  });
});
