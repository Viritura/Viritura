import { describe, expect, it } from "vitest";
import { buildPreviewHtml } from "../previewHtml";

describe("buildPreviewHtml", () => {
  const baseOptions = {
    scriptUri: "webview:/media/viewer.js",
    assetBaseUri: "webview:/media",
    cspSource: "vscode-webview://test",
  };

  it("renders the viewer shell", () => {
    const html = buildPreviewHtml({ ...baseOptions, fileName: "score.mnx" });

    expect(html).toContain("MNX Preview: score.mnx");
    expect(html).toContain("viewer.js");
    expect(html).toContain("assetBaseUrl");
  });

  it("escapes unsafe filenames", () => {
    const html = buildPreviewHtml({ ...baseOptions, fileName: "<script>alert(1)</script>.mnx" });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;.mnx");
  });
});
