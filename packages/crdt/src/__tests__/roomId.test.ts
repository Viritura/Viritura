import { describe, expect, it } from "vitest";
import { generateRoomId, isValidRoomId } from "../roomId";
import { colorForUserId } from "../awareness";

describe("roomId", () => {
  it("generates ids matching the format pattern", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateRoomId();
      expect(isValidRoomId(id)).toBe(true);
      expect(id).toHaveLength(16);
    }
  });

  it("generates distinct ids on consecutive calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateRoomId());
    // With 80 bits of entropy we expect zero collisions in 100 draws.
    expect(seen.size).toBe(100);
  });

  it("rejects malformed candidates", () => {
    expect(isValidRoomId("")).toBe(false);
    expect(isValidRoomId("short")).toBe(false);
    expect(isValidRoomId("CAPITAL_LETTERS_!")).toBe(false);
    expect(isValidRoomId("a".repeat(17))).toBe(false);
    expect(isValidRoomId("../../etc/passwd")).toBe(false);
    expect(isValidRoomId("abc123abc123abc1z")).toBe(false); // 17 chars
  });
});

describe("colorForUserId", () => {
  it("is deterministic for the same id", () => {
    const a = colorForUserId("alice");
    const b = colorForUserId("alice");
    expect(a).toBe(b);
  });

  it("returns valid hex strings", () => {
    expect(colorForUserId("alice")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("uses the palette spread across many ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(colorForUserId(`user-${i}`));
    // Palette is 10 colors; with 100 ids we should easily hit most slots.
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});
