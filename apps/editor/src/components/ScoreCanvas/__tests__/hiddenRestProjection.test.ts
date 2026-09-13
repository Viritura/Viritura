import { describe, expect, it } from "vitest";
import type { DisplayList } from "@viritura/renderer";
import { HIDDEN_REST_COLOR, projectHiddenRestsForWrite, tintHiddenRestPlaceholders } from "../hiddenRestProjection";

describe("hidden rest Write-mode projection", () => {
  it("projects spaces to selectable rests without changing the source JSON", () => {
    const source = JSON.stringify({
      parts: [{ measures: [{ sequences: [{ content: [{ type: "space", duration: [1, 4] }] }] }] }],
    });

    expect(JSON.parse(projectHiddenRestsForWrite(source))).toEqual({
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      id: "__viritura_hidden_space_t0",
                      duration: { base: "quarter" },
                      rest: {},
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.parse(source).parts[0].measures[0].sequences[0].content[0].type).toBe("space");
  });

  it("tints only commands belonging to hidden-rest placeholders", () => {
    const displayList: DisplayList = {
      width: 100,
      height: 100,
      commands: [
        { type: "DrawGlyph", x: 10, y: 20, codepoint: 0xe4e5, font: "Bravura", size: 40, color: "#000000" },
        { type: "DrawGlyph", x: 30, y: 20, codepoint: 0xe4e5, font: "Bravura", size: 40, color: "#000000" },
      ],
      elementIds: ["p0/m0/s0/__viritura_hidden_space_t0", "p0/m0/s0/visible"],
    };

    const tinted = tintHiddenRestPlaceholders(displayList);
    expect(tinted.commands[0]).toMatchObject({ color: HIDDEN_REST_COLOR });
    expect(tinted.commands[1]).toMatchObject({ color: "#000000" });
  });
});
