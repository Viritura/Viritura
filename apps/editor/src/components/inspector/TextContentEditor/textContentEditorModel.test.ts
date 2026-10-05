import { describe, expect, it } from "vitest";
import type { TextContent } from "@viritura/core";
import {
  glyphNamesMatching,
  htmlForTextContent,
  styledTextContent,
  textContentFromEditor,
} from "./textContentEditorModel";

describe("text content editor model", () => {
  it("round-trips authored newlines, including trailing empty lines and glyph runs", () => {
    const content: TextContent = [{ text: "first\n\nsecond " }, { glyphs: ["dynamicPP"] }, { text: "\n\n" }];
    const editor = document.createElement("div");
    editor.innerHTML = htmlForTextContent(content);
    expect(textContentFromEditor(editor)).toEqual(content);
  });

  it("reads native line breaks and pasted paragraphs without counting browser placeholder breaks", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<span>first<br>second<br><br></span>";
    expect(textContentFromEditor(editor)).toEqual([{ text: "first\nsecond\n" }]);
    editor.innerHTML = "<div>first</div><div><br></div><div>third</div>";
    expect(textContentFromEditor(editor)).toEqual([{ text: "first\n\nthird" }]);
  });

  it("round-trips run styling and SMuFL glyph styling through the editor DOM", () => {
    const content: TextContent = [
      { text: "con ", style: { fontStyle: "italic" } },
      { glyphs: ["dynamicMF"], style: { size: 1.2 }, smuflStyle: { color: "#aabbcc" } },
      { text: "subito", style: { weight: "bold", size: 1.25 } },
    ];
    const editor = document.createElement("div");
    editor.innerHTML = htmlForTextContent(content);

    expect(textContentFromEditor(editor)).toEqual(content);
  });

  it("escapes score text before placing it in editable markup", () => {
    const editor = document.createElement("div");
    editor.innerHTML = htmlForTextContent([{ text: "<img src=x onerror=alert(1)>" }]);

    expect(editor.querySelector("img")).toBeNull();
    expect(textContentFromEditor(editor)).toEqual([{ text: "<img src=x onerror=alert(1)>" }]);
  });

  it("offers only glyph names the engine can engrave", () => {
    const names = glyphNamesMatching("dynamic");

    expect(names).toContain("dynamicMF");
    expect(names).toContain("dynamicRfz");
    expect(glyphNamesMatching("ottava")).toEqual([]);
  });

  it("styles only the selected span of a single text run", () => {
    expect(styledTextContent([{ text: "molto dolce" }], 6, 11, { fontStyle: "italic" })).toEqual([
      { text: "molto " },
      { text: "dolce", style: { fontStyle: "italic" } },
    ]);
  });

  it("clears a run style back to an unstyled run", () => {
    const styled = styledTextContent([{ text: "dolce" }], 0, 5, { weight: "bold" });

    expect(styledTextContent(styled, 0, 5, { weight: undefined })).toEqual([{ text: "dolce" }]);
  });

  it("splits a glyph run so only the selected glyphs are restyled", () => {
    const content: TextContent = [{ glyphs: ["dynamicP", "dynamicF"] }];

    expect(styledTextContent(content, 1, 2, { size: 1.5 })).toEqual([
      { glyphs: ["dynamicP"] },
      { glyphs: ["dynamicF"], style: { size: 1.5 } },
    ]);
  });

  it("merges neighbouring runs that end up sharing a style", () => {
    const content: TextContent = [
      { text: "sem", style: { weight: "bold" } },
      { text: "pre", style: { fontStyle: "italic" } },
    ];

    expect(styledTextContent(content, 0, 6, { weight: undefined, fontStyle: "italic" })).toEqual([
      { text: "sempre", style: { fontStyle: "italic" } },
    ]);
  });
});
