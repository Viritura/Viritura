import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyContentSecurityPolicy } from "../../scripts/storybookContentSecurityPolicy";

describe("public Storybook content security policy", () => {
  it("hashes final inline scripts and remains idempotent", () => {
    const script = "window.__STORYBOOK_BOOTSTRAP__ = true;";
    const html = `<!doctype html><html><head><title>Storybook</title></head><body><script>${script}</script></body></html>`;
    const title = "MNX Examples and Engraving Library | Viritura";
    const expectedHash = createHash("sha256").update(script).digest("base64");

    const secured = applyContentSecurityPolicy(html, title);

    expect(secured).toContain(`<title>${title}</title>`);
    expect(secured).toContain(`'sha256-${expectedHash}'`);
    expect(secured.match(/http-equiv="content-security-policy"/g)).toHaveLength(1);
    expect(applyContentSecurityPolicy(secured, title)).toBe(secured);
  });
});
