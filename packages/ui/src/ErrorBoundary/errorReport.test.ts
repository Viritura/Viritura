import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDebugReport } from "./errorReport";

afterEach(() => vi.unstubAllGlobals());

describe("buildDebugReport", () => {
  it("omits query and fragment bearer data", () => {
    vi.stubGlobal("location", {
      href: "https://viritura.com/auth/reset-password?uid=user-1#token=secret-token",
      origin: "https://viritura.com",
      pathname: "/auth/reset-password",
    });

    const report = buildDebugReport({ error: new Error("boom") });

    expect(report).toContain("https://viritura.com/auth/reset-password");
    expect(report).not.toContain("user-1");
    expect(report).not.toContain("secret-token");
  });
});
