import { describe, expect, it } from "vitest";
import { readSensitiveSearchParams } from "./urlSearchParams";

describe("readSensitiveSearchParams", () => {
  it("returns empty strings when params are missing", () => {
    const result = readSensitiveSearchParams(new URLSearchParams());

    expect(result).toEqual({
      uid: "",
      email: "",
      token: "",
    });
  });

  it("returns provided values when params are present", () => {
    const result = readSensitiveSearchParams(new URLSearchParams("uid=u123&email=user%40example.com&token=t456"));

    expect(result).toEqual({
      uid: "u123",
      email: "user@example.com",
      token: "t456",
    });
  });
});
