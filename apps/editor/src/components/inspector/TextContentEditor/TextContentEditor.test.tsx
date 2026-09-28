import { describe, expect, it, vi } from "vitest";
import { act, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TextContent } from "@viritura/core";
import { TextContentEditor } from "./TextContentEditor";

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
