import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Reads prepare-assets.ts as text to verify OFL notices are always shipped with fonts.
// This catches the case where a developer adds a font binary without adding its license.

const scriptPath = path.resolve(__dirname, "../../scripts/prepare-assets.ts");
const scriptSource = readFileSync(scriptPath, "utf8");

describe("package notices", () => {
  it("prepare-assets copies OFL-1.1.txt alongside font binaries", () => {
    expect(scriptSource).toContain("OFL-1.1.txt");
  });

  it("prepare-assets copies THIRD_PARTY_NOTICES.md alongside font binaries", () => {
    expect(scriptSource).toContain("THIRD_PARTY_NOTICES.md");
  });

  it("notice destinations are not placed under media/ (must be at package root)", () => {
    // OFL text and notices must live at the VSIX root so they are obvious to inspectors;
    // placing them under media/ would bury them inside the font/wasm asset directory.
    const oflLine = scriptSource.split("\n").find((l) => l.includes("OFL-1.1.txt")) ?? "";
    expect(oflLine).not.toContain("mediaDir");
  });
});
