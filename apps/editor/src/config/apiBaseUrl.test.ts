import { describe, expect, it } from "vitest";
import { resolveVirituraApiBaseUrl } from "./apiBaseUrl";

describe("resolveVirituraApiBaseUrl", () => {
  it("uses localhost only for an unconfigured development build", () => {
    expect(resolveVirituraApiBaseUrl(undefined, true)).toBe("https://localhost:5001");
  });

  it("uses the public API for an unconfigured production build", () => {
    expect(resolveVirituraApiBaseUrl(undefined, false)).toBe("https://api.viritura.com");
  });

  it("honors an explicit environment URL and strips trailing slashes", () => {
    expect(resolveVirituraApiBaseUrl(" https://staging-api.viritura.com/// ", false)).toBe(
      "https://staging-api.viritura.com",
    );
  });
});
