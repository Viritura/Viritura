import { describe, expect, it } from "vitest";
import { parseMnx, parseMnxUnvalidated } from "../index";

describe("schema-independent MNX parser", () => {
  it("builds the model without schema validation while parseMnx remains guarded", () => {
    const raw = { mnx: { version: 1 }, global: { measures: [{}] }, parts: [] };
    expect(parseMnxUnvalidated(raw).global.measures).toHaveLength(1);
    expect(() => parseMnx({ ...raw, unexpected: true })).toThrow();
  });
});
