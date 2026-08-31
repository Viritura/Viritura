import { describe, expect, it } from "vitest";
import shortcutsMarkdown from "../../../../../docs/spec/keyboard-shortcuts.md?raw";
import { renderDoc } from "./renderDoc";

describe("renderDoc", () => {
  it("uses explicit heading ids without exposing the marker", () => {
    const rendered = renderDoc("## Picture Activity {#picture}");

    expect(rendered.html).toContain('<h2 id="picture">Picture Activity</h2>');
    expect(rendered.html).not.toContain("{#picture}");
    expect(rendered.toc).toEqual([{ id: "picture", text: "Picture Activity", level: 2 }]);
  });

  it("removes contributor-only blocks from the public site", () => {
    const rendered = renderDoc(`
## Public

Visible.

<!-- docs-site:exclude-start -->
## Contributor policy

Internal.
<!-- docs-site:exclude-end -->
`);

    expect(rendered.html).toContain("Visible.");
    expect(rendered.html).not.toContain("Contributor policy");
    expect(rendered.html).not.toContain("Internal.");
  });

  it("keeps duplicate generated ids unique", () => {
    const rendered = renderDoc("## Notes\n\n## Notes");

    expect(rendered.toc.map((entry) => entry.id)).toEqual(["notes", "notes-2"]);
  });

  it("extracts interactive blocks into mount points", () => {
    const rendered = renderDoc('## Buttons\r\n\r\n:::interactive id="ui.button"\r\n:::\r\n');

    expect(rendered.embeds).toEqual([{ id: "ui.button" }]);
    expect(rendered.html).toContain('data-doc-embed="ui.button"');
    expect(rendered.html).not.toContain(":::interactive");
  });

  it("localizes the primary modifier key without changing the source markdown", () => {
    const markdown = "Use Ctrl/Cmd-click or Mod+A to select multiple items.";

    expect(renderDoc(markdown, { primary: "Ctrl", alternate: "Alt" }).html).toContain("Ctrl-click");
    expect(renderDoc(markdown, { primary: "Ctrl", alternate: "Alt" }).html).toContain("Ctrl+A");
    expect(renderDoc(markdown, { primary: "Ctrl", alternate: "Alt" }).html).not.toContain("Ctrl/Cmd");
    expect(renderDoc(markdown, { primary: "Cmd", alternate: "Option" }).html).toContain("Cmd-click");
    expect(renderDoc(markdown, { primary: "Cmd", alternate: "Option" }).html).toContain("Cmd+A");
    expect(markdown).toContain("Ctrl/Cmd-click or Mod+A");
  });

  it("localizes the alternate modifier key without changing ordinary words", () => {
    const markdown = "Hold Alt for an alternative snap grid.";

    expect(renderDoc(markdown, { primary: "Ctrl", alternate: "Alt" }).html).toContain("Hold Alt for an alternative");
    expect(renderDoc(markdown, { primary: "Cmd", alternate: "Option" }).html).toContain(
      "Hold Option for an alternative",
    );
  });

  it("renders GitHub-compatible availability alerts as semantic callouts", () => {
    const markdown = `> [!NOTE]
> **Availability: Desktop app only**
>
> VST instruments require the native audio host.`;
    const rendered = renderDoc(markdown);

    expect(rendered.html).toContain('<aside class="docs-availability">');
    expect(rendered.html).toContain("<span>Availability</span>Desktop app only");
    expect(rendered.html).toContain("VST instruments require the native audio host.");
    expect(rendered.html).not.toContain("[!NOTE]");
  });

  it("keeps every Global shortcut inside one table", () => {
    const rendered = renderDoc(shortcutsMarkdown);
    const globalSection = rendered.html.match(/<h2 id="global">[\s\S]*?(?=<h2 id="normal">)/)?.[0] ?? "";

    expect(globalSection.match(/<table>/g)).toHaveLength(1);
    expect(globalSection).toContain("<td>Undo</td>");
    expect(globalSection.indexOf("<td>Undo</td>")).toBeLessThan(globalSection.indexOf("</table>"));
  });
});
