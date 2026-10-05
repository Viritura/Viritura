import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TextContent } from "@viritura/core";
import { TextContentEditor } from "./TextContentEditor";

const nativeExecCommand = document.execCommand;
afterEach(() => {
  document.execCommand = nativeExecCommand;
});

function renderEditor(initial: TextContent) {
  const onChange = vi.fn();
  const view = render(
    <TextContentEditor value={initial} onChange={onChange} placeholder="Expression text" ariaLabel="Text" />,
  );
  const ui = within(view.container);
  const selectAll = (): void => {
    act(() => {
      const editor = ui.getByRole("textbox", { name: "Text" });
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  };
  const latest = (): TextContent => onChange.mock.calls.at(-1)?.[0] as TextContent;
  const rerender = (next: TextContent): void => {
    view.rerender(
      <TextContentEditor value={next} onChange={onChange} placeholder="Expression text" ariaLabel="Text" />,
    );
  };
  return { ui, selectAll, latest, rerender };
}

describe("TextContentEditor", () => {
  it("keeps glyph markup identifiable after a model rerender", () => {
    const { ui, rerender } = renderEditor([{ glyphs: ["dynamicPP"] }]);
    const editor = ui.getByRole("textbox", { name: "Text" });
    expect(editor.querySelector("[data-glyph='dynamicPP']")).not.toBeNull();
    rerender([{ text: "sempre " }, { glyphs: ["dynamicPP"] }]);
    expect(editor.querySelector("[data-glyph='dynamicPP']")).not.toBeNull();
  });

  it("opens glyph search only on request and preserves notation runs on insertion", async () => {
    const user = userEvent.setup();
    const { ui, latest } = renderEditor([{ text: "sempre " }]);
    expect(ui.queryByRole("searchbox", { name: "Search SMuFL glyphs" })).toBeNull();
    await user.click(ui.getByRole("button", { name: "Insert notation glyph" }));
    await user.type(ui.getByRole("searchbox", { name: "Search SMuFL glyphs" }), "dynamicPP");
    await user.click(ui.getByRole("option", { name: "dynamicPP glyph" }));
    expect(latest()).toEqual([{ text: "sempre " }, { glyphs: ["dynamicPP"] }]);
    expect(ui.queryByRole("searchbox", { name: "Search SMuFL glyphs" })).toBeNull();
  });

  it("accepts Enter and multiline paste without losing surrounding rich runs", () => {
    const onChange = vi.fn();
    const view = render(
      <TextContentEditor
        multiline
        value={[{ text: "dolce", style: { weight: "bold" } }]}
        onChange={onChange}
        placeholder="Text"
        ariaLabel="Multiline text"
      />,
    );
    const editor = within(view.container).getByRole("textbox", { name: "Multiline text" });
    expect(editor.getAttribute("aria-multiline")).toBe("true");
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.execCommand = vi.fn((command, _ui, text) => {
      const current = window.getSelection()!.getRangeAt(0);
      const node = command === "insertLineBreak" ? document.createElement("br") : document.createTextNode(text ?? "");
      current.insertNode(node);
      current.setStartAfter(node);
      current.collapse(true);
      return true;
    });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith([{ text: "dolce", style: { weight: "bold" } }, { text: "\n" }]);
    fireEvent.paste(editor, { clipboardData: { getData: () => "quietly\r\nthen resume" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { text: "dolce", style: { weight: "bold" } },
      { text: "\nquietly\nthen resume" },
    ]);
    expect(document.execCommand).toHaveBeenCalledWith("insertLineBreak");
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "quietly\nthen resume");
  });

  it("keeps single-line semantic fields from accepting Enter", () => {
    const { ui, latest } = renderEditor([{ text: "dolce" }]);
    const editor = ui.getByRole("textbox", { name: "Text" });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor.getAttribute("aria-multiline")).toBe("false");
    expect(latest()).toBeUndefined();
  });

  it("applies and then clears bold over the whole field", async () => {
    const user = userEvent.setup();
    const { ui, selectAll, latest } = renderEditor([{ text: "dolce" }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Bold" }));
    expect(latest()).toEqual([{ text: "dolce", style: { weight: "bold" } }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Bold" }));
    expect(latest()).toEqual([{ text: "dolce" }]);
  });

  it("keeps runs flat so a later change is not shadowed by an earlier one", async () => {
    const user = userEvent.setup();
    const { ui, selectAll, latest } = renderEditor([{ text: "dolce" }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Italic" }));
    selectAll();
    await user.click(ui.getByRole("button", { name: "Underline" }));
    expect(latest()).toEqual([{ text: "dolce", style: { fontStyle: "italic", decorations: ["underline"] } }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Italic" }));
    expect(latest()).toEqual([{ text: "dolce", style: { decorations: ["underline"] } }]);
  });

  it("accumulates decorations rather than replacing them", async () => {
    const user = userEvent.setup();
    const { ui, selectAll, latest } = renderEditor([{ text: "dolce" }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Underline" }));
    selectAll();
    await user.click(ui.getByRole("button", { name: "Strikethrough" }));
    expect(latest()).toEqual([{ text: "dolce", style: { decorations: ["underline", "strikethrough"] } }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Underline" }));
    expect(latest()).toEqual([{ text: "dolce", style: { decorations: ["strikethrough"] } }]);
  });

  it("reflects the style under the selection in the toolbar", async () => {
    const user = userEvent.setup();
    const { ui, selectAll } = renderEditor([{ text: "dolce", style: { fontStyle: "italic" } }]);

    expect(ui.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");

    selectAll();
    await user.click(ui.getByRole("button", { name: "Bold" }));
    expect(ui.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(ui.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("writes an explicit upright run when un-italicising italic-by-default text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(
      <TextContentEditor
        value={[{ text: "Have fun!" }]}
        onChange={onChange}
        placeholder="Marker text"
        ariaLabel="Text"
        inheritedStyle={{ fontStyle: "italic" }}
      />,
    );
    const ui = within(view.container);
    const italic = ui.getByRole("button", { name: "Italic" });
    expect(italic.getAttribute("aria-pressed")).toBe("true");

    await user.click(italic);
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual([{ text: "Have fun!", style: { fontStyle: "normal" } }]);
    expect(italic.getAttribute("aria-pressed")).toBe("false");

    await user.click(italic);
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual([{ text: "Have fun!" }]);
  });

  it("preserves glyph runs when formatting the surrounding text", async () => {
    const user = userEvent.setup();
    const { ui, selectAll, latest } = renderEditor([{ text: "sempre " }, { glyphs: ["dynamicPP"] }]);

    selectAll();
    await user.click(ui.getByRole("button", { name: "Bold" }));

    expect(latest()).toEqual([
      { text: "sempre ", style: { weight: "bold" } },
      { glyphs: ["dynamicPP"], style: { weight: "bold" } },
    ]);
  });

  it("keeps a readable font label after the font falls back to the default", () => {
    const { ui, rerender } = renderEditor([{ text: "dolce", style: { font: "serif" } }]);

    expect(ui.getByRole("combobox", { name: "Font family" }).textContent).toContain("Serif");

    rerender([{ text: "dolce" }]);

    expect(ui.getByRole("combobox", { name: "Font family" }).textContent).toContain("Font");
  });
});
