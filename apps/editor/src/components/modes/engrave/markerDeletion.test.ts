import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { useEngraveContextRefs, useMarkerSelection } from "./hooks";
import { KeyboardRegistry } from "../../../keyboard/KeyboardRegistry";

afterEach(cleanup);

function harness() {
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }, { id: "m1" }] },
    parts: [],
    scores: [{ layoutBreaks: [{ measure: "m1", kind: "system" }] }],
  };
  const updateScore = vi.fn();
  const hook = renderHook(
    ({ active, scoreIndex }) =>
      useMarkerSelection(useEngraveContextRefs(score, scoreIndex, updateScore), scoreIndex, active),
    { initialProps: { active: true, scoreIndex: 0 } },
  );
  act(() => hook.result.current.setSelectedMarkerId("m1"));
  return { ...hook, updateScore };
}

describe("Engrave marker deletion ownership", () => {
  it.each(["Delete", "Backspace"])("consumes %s before the normal score-selection binding", (key) => {
    const { updateScore } = harness();
    const registry = new KeyboardRegistry();
    const deleteScoreSelection = vi.fn();
    registry.register({ id: "score.delete", key, context: "normal", handler: deleteScoreSelection });
    const uninstall = registry.install();
    try {
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
      expect(updateScore).toHaveBeenCalledOnce();
      expect(updateScore.mock.calls[0]![0].scores[0].layoutBreaks).toBeUndefined();
      expect(deleteScoreSelection).not.toHaveBeenCalled();
    } finally {
      uninstall();
    }
  });

  it.each(["input", "textarea", "select", "editable", "dialog"])("protects %s focus", (kind) => {
    const { updateScore } = harness();
    const target = document.createElement(["editable", "dialog"].includes(kind) ? "div" : kind);
    if (kind === "editable") target.setAttribute("contenteditable", "true");
    if (kind === "dialog") target.setAttribute("role", "dialog");
    document.body.append(target);
    try {
      act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
      expect(updateScore).not.toHaveBeenCalled();
    } finally {
      target.remove();
    }
  });

  it("does not delete an inactive or already-consumed target or intercept modified keys", () => {
    const { updateScore, rerender } = harness();
    const consumed = new KeyboardEvent("keydown", { key: "Delete", cancelable: true });
    consumed.preventDefault();
    act(() => window.dispatchEvent(consumed));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", ctrlKey: true })));
    rerender({ active: false, scoreIndex: 0 });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })));
    expect(updateScore).not.toHaveBeenCalled();
  });

  it("clears marker ownership when switching scores", () => {
    const { updateScore, rerender } = harness();
    rerender({ active: true, scoreIndex: 1 });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })));
    expect(updateScore).not.toHaveBeenCalled();
  });
});
