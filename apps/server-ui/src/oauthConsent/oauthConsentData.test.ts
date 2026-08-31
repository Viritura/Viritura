import { describe, expect, it } from "vitest";
import { readOAuthConsentData, type OAuthConsentData } from "./oauthConsentData";

describe("readOAuthConsentData", () => {
  it("decodes UTF-8 consent data from the server payload", () => {
    const expected: OAuthConsentData = {
      clientName: "Éditeur MCP",
      action: "/oauth/authorize?state=test",
      scopes: ["score:read"],
      fields: [{ name: "state", value: "test" }],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(expected));
    const payload = btoa(String.fromCharCode(...bytes));
    const root = { dataset: { payload } };

    expect(readOAuthConsentData(root)).toEqual(expected);
  });

  it("rejects a page without an OAuth payload", () => {
    const root = { dataset: {} };

    expect(() => readOAuthConsentData(root)).toThrow("OAuth consent data is missing.");
  });
});
