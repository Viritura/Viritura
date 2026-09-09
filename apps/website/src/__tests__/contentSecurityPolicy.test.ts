import { describe, expect, it } from "vitest";
import { scopeContentSecurityPolicy } from "../../scripts/scope-content-security-policy";

const policy =
  "<meta http-equiv=\"content-security-policy\" content=\"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-example='; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline';\">";

describe("generated website CSP", () => {
  it("removes WASM and runtime style allowances from ordinary pages", () => {
    const result = scopeContentSecurityPolicy(policy, "index.html");
    expect(result).not.toContain("'wasm-unsafe-eval'");
    expect(result).toContain("style-src-elem 'self'");
    expect(result).toContain("style-src-attr 'unsafe-inline'");
    expect(result).toContain("'sha256-example='");
  });

  it("retains WASM and Monaco runtime styles on the converter", () => {
    const result = scopeContentSecurityPolicy(policy, "mnx/mxl-converter/index.html");
    expect(result).toContain("'wasm-unsafe-eval'");
    expect(result).toContain("style-src-elem 'self' 'unsafe-inline'");
  });

  it("retains only WASM on the MNX hub", () => {
    const result = scopeContentSecurityPolicy(policy, "mnx/index.html");
    expect(result).toContain("'wasm-unsafe-eval'");
    expect(result).toContain("style-src-elem 'self'");
  });

  it("retains WASM and Monaco runtime styles on the playground", () => {
    const result = scopeContentSecurityPolicy(policy, "mnx/playground/index.html");
    expect(result).toContain("'wasm-unsafe-eval'");
    expect(result).toContain("style-src-elem 'self' 'unsafe-inline'");
  });
});
