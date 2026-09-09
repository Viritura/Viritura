import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function scriptSources(policy: string): string[] {
  const scriptDirective = policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src "));
  return scriptDirective?.split(/\s+/).slice(1) ?? [];
}

describe("deployed editor CSP", () => {
  it("allows WASM without allowing JavaScript eval", () => {
    const headers = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
    const policy = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
    const sources = scriptSources(policy);

    expect(sources).toContain("'wasm-unsafe-eval'");
    expect(sources).not.toContain("'unsafe-eval'");
  });
});
