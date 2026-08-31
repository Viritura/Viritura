import { describe, expect, it, vi } from "vitest";
import { handleNoteInputKey } from "../keyboard/noteInputHandlers";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { buildEditorBindings, type EditorBindingConfig } from "../keyboard/editorBindings";

function keyEvent(key: string): KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe("note-input accidental shortcuts", () => {
  it("uses backslash for an explicit natural", () => {
    const setAccidental = vi.fn();
    const context = { setAccidental } as unknown as KeyboardHandlerContext;

    handleNoteInputKey(keyEvent("\\"), context);

    expect(setAccidental).toHaveBeenCalledWith("natural");
  });

  it("registers backslash in the note-input keyboard bindings", () => {
    const setAccidental = vi.fn();
    const context = { setAccidental } as unknown as KeyboardHandlerContext;
    const bindings = buildEditorBindings({ ctx: context } as EditorBindingConfig);
    const natural = bindings.find((binding) => binding.id === "noteInput.natural");

    expect(natural).toMatchObject({ key: "\\", context: "noteInput" });
    natural!.handler(keyEvent("\\"));
    expect(setAccidental).toHaveBeenCalledWith("natural");
  });

  it("keeps zero assigned to rest mode", () => {
    const toggleRest = vi.fn();
    const setAccidental = vi.fn();
    const context = { toggleRest, setAccidental } as unknown as KeyboardHandlerContext;

    handleNoteInputKey(keyEvent("0"), context);

    expect(toggleRest).toHaveBeenCalledOnce();
    expect(setAccidental).not.toHaveBeenCalled();
  });
});
