// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderRoute } from "../entry-static";

describe("static route rendering", () => {
  it("includes route content and hydration scripts in the completed HTML", async () => {
    const result = await renderRoute("/");

    expect(result.html).toContain("<h1");
    expect(result.html).toContain("<script");
    expect(result.html).toContain("$R");
    expect(result.injectedHtml).toBe("");
  });
});
