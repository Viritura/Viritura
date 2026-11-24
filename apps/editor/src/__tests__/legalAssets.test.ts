// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncLegalNotices } from "../../buildAssets";

describe("editor third-party notices", () => {
  it("stages the MP3 encoder notices and licenses for web and desktop builds", () => {
    const root = mkdtempSync(join(tmpdir(), "viritura-legal-"));
    try {
      syncLegalNotices(root);
      expect(readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain("## MP3 encoding");
      expect(readFileSync(join(root, "LICENSES", "LGPL-2.0.txt"), "utf8")).toContain(
        "GNU LIBRARY GENERAL PUBLIC LICENSE",
      );
      expect(readFileSync(join(root, "LICENSES", "audio-encode-mp3-MIT.txt"), "utf8")).toContain("Dmitry Iv.");
      expect(readFileSync(join(root, "LICENSES", "wasm-media-encoders-MIT.txt"), "utf8")).toContain("arseneyr");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
