import { describe, it, expect } from "vitest";
import {
  gmProgramForInstrument,
  gmProgramName,
  isStringSoloProgram,
  GM_STRING_ENSEMBLE_1,
  GM_STRING_ENSEMBLE_2,
} from "./gmPrograms";

describe("gmPrograms", () => {
  describe("constants", () => {
    it("GM_STRING_ENSEMBLE_1 is 48", () => {
      expect(GM_STRING_ENSEMBLE_1).toBe(48);
    });
    it("GM_STRING_ENSEMBLE_2 is 49", () => {
      expect(GM_STRING_ENSEMBLE_2).toBe(49);
    });
  });

  describe("isStringSoloProgram", () => {
    it("returns true for violin (40)", () => {
      expect(isStringSoloProgram(40)).toBe(true);
    });
    it("returns true for viola (41)", () => {
      expect(isStringSoloProgram(41)).toBe(true);
    });
    it("returns true for cello (42)", () => {
      expect(isStringSoloProgram(42)).toBe(true);
    });
    it("returns true for contrabass (43)", () => {
      expect(isStringSoloProgram(43)).toBe(true);
    });
    it("returns false for string ensemble (48)", () => {
      expect(isStringSoloProgram(48)).toBe(false);
    });
    it("returns false for piano (0)", () => {
      expect(isStringSoloProgram(0)).toBe(false);
    });
  });

  describe("gmProgramForInstrument", () => {
    it("matches exact instrument names", () => {
      expect(gmProgramForInstrument("violin")).toBe(40);
      expect(gmProgramForInstrument("flute")).toBe(73);
      expect(gmProgramForInstrument("trumpet")).toBe(56);
      expect(gmProgramForInstrument("piano")).toBe(0);
    });

    it("is case-insensitive", () => {
      expect(gmProgramForInstrument("Violin")).toBe(40);
      expect(gmProgramForInstrument("FLUTE")).toBe(73);
      expect(gmProgramForInstrument("French Horn")).toBe(60);
    });

    it("trims whitespace", () => {
      expect(gmProgramForInstrument("  violin  ")).toBe(40);
    });

    it("resolves abbreviation aliases", () => {
      expect(gmProgramForInstrument("vln")).toBe(40);
      expect(gmProgramForInstrument("vc")).toBe(42);
      expect(gmProgramForInstrument("fl")).toBe(73);
      expect(gmProgramForInstrument("tpt")).toBe(56);
      expect(gmProgramForInstrument("hn")).toBe(60);
      expect(gmProgramForInstrument("hp")).toBe(46);
    });

    it("resolves long-form aliases", () => {
      expect(gmProgramForInstrument("violoncello")).toBe(42);
      expect(gmProgramForInstrument("cor anglais")).toBe(69);
      expect(gmProgramForInstrument("contrabassoon")).toBe(70);
      expect(gmProgramForInstrument("bass clarinet")).toBe(71);
    });

    it("matches substring in part names like 'Violin 1'", () => {
      expect(gmProgramForInstrument("Violin 1")).toBe(40);
      expect(gmProgramForInstrument("Flute 2")).toBe(73);
      expect(gmProgramForInstrument("Horn in F")).toBe(60);
    });

    it("prefers longer alias to avoid 'bass' matching before 'bassoon'", () => {
      // "contrabassoon" should match the alias, not bare "bass"
      expect(gmProgramForInstrument("contrabassoon")).toBe(70);
      // "bassoon" should match directly
      expect(gmProgramForInstrument("bassoon")).toBe(70);
    });

    it("returns null for unknown instruments", () => {
      expect(gmProgramForInstrument("theremin")).toBeNull();
      expect(gmProgramForInstrument("")).toBeNull();
    });
  });

  describe("gmProgramName", () => {
    it("returns correct names for known programs", () => {
      expect(gmProgramName(0)).toBe("Acoustic Grand Piano");
      expect(gmProgramName(40)).toBe("Violin");
      expect(gmProgramName(73)).toBe("Flute");
      expect(gmProgramName(127)).toBe("Gunshot");
    });

    it("returns fallback for out-of-range programs", () => {
      expect(gmProgramName(128)).toBe("Program 128");
      expect(gmProgramName(-1)).toBe("Program -1");
    });
  });
});
