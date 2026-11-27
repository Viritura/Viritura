import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sources(policy: string, name: string): string[] {
  const directive = policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `));
  return directive?.split(/\s+/).slice(1) ?? [];
}

describe("deployed editor CSP", () => {
  it("allows WASM without allowing JavaScript eval", () => {
    const headers = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
    const policy = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
    const scriptSources = sources(policy, "script-src");

    expect(scriptSources).toContain("'wasm-unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-eval'");
  });

  it("allows the MP3 worker to fetch the encoder's embedded WASM", () => {
    const headers = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
    const policy = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
    expect(sources(policy, "connect-src")).toContain("data:");
  });

  it("allows the Llamigos demo video download", () => {
    const headers = readFileSync(resolve(__dirname, "../../public/_headers"), "utf8");
    const policy = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
    expect(sources(policy, "connect-src")).toContain("https://upload.wikimedia.org");
  });
});
