import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, PASSWORD_PATTERN, PASSWORD_RULES, isPasswordCompliant } from "./passwordPolicy";

describe("PASSWORD_RULES", () => {
  function ruleById(id: string) {
    const r = PASSWORD_RULES.find((x) => x.id === id);
    if (!r) throw new Error(`missing rule ${id}`);
    return r;
  }

  it("length rule requires at least PASSWORD_MIN_LENGTH characters", () => {
    const rule = ruleById("length");
    expect(rule.test("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(rule.test("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
  });

  it("upper rule requires an uppercase ASCII letter", () => {
    const rule = ruleById("upper");
    expect(rule.test("abcA")).toBe(true);
    expect(rule.test("abcdef")).toBe(false);
  });

  it("lower rule requires a lowercase ASCII letter", () => {
    const rule = ruleById("lower");
    expect(rule.test("ABCa")).toBe(true);
    expect(rule.test("ABCDEF")).toBe(false);
  });

  it("digit rule requires a decimal digit", () => {
    const rule = ruleById("digit");
    expect(rule.test("abc1")).toBe(true);
    expect(rule.test("abcdef")).toBe(false);
  });

  it("symbol rule requires a non-alphanumeric character", () => {
    const rule = ruleById("symbol");
    expect(rule.test("abc!")).toBe(true);
    expect(rule.test("abc123")).toBe(false);
  });
});

describe("isPasswordCompliant", () => {
  it("returns true for a fully-compliant password", () => {
    expect(isPasswordCompliant("GoodPassw0rd!")).toBe(true);
  });

  it("returns false when any single rule fails", () => {
    // 12 chars but no uppercase.
    expect(isPasswordCompliant("goodpassw0rd!")).toBe(false);
    // 12 chars but no digit.
    expect(isPasswordCompliant("GoodPassword!")).toBe(false);
    // 12 chars but no symbol.
    expect(isPasswordCompliant("GoodPassw0rdA")).toBe(false);
    // Below the length floor.
    expect(isPasswordCompliant("Sh0rt!")).toBe(false);
  });
});

describe("PASSWORD_PATTERN", () => {
  it("matches the same passwords that isPasswordCompliant accepts", () => {
    const regex = new RegExp(PASSWORD_PATTERN);
    expect(regex.test("GoodPassw0rd!")).toBe(true);
    expect(regex.test("Sh0rt!")).toBe(false);
    expect(regex.test("nosymbol1234A")).toBe(false);
  });

  it("enforces the documented minimum length", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });
});
