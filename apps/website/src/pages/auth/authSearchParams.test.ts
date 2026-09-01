import { describe, expect, it } from "vitest";
import { readSensitiveSearchParams } from "./authSearchParams";

describe("readSensitiveSearchParams", () => {
  it("returns empty values when params are absent", () => {
    const result = readSensitiveSearchParams(new URLSearchParams());
    expect(result).toEqual({ uid: "", email: "", token: "" });
  });

  it("reads uid, email, and token values from search params", () => {
    const result = readSensitiveSearchParams(new URLSearchParams("uid=u1&email=a%40b.test&token=t1"));
    expect(result).toEqual({ uid: "u1", email: "a@b.test", token: "t1" });
  });
});
