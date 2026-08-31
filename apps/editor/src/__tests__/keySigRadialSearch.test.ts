import { describe, it, expect } from "vitest";
import { filterRadialMenuItems } from "@viritura/ui";
import { KEY_SIGNATURE_ITEMS } from "../radialMenu";

/** Helper: run filter & return matched ids */
function search(query: string): string[] {
  return filterRadialMenuItems(KEY_SIGNATURE_ITEMS, query).map((i) => i.id);
}

/** Helper: assert that a query matches exactly these ids (order-independent) */
function _expectMatch(query: string, ...ids: string[]) {
  expect(search(query).sort()).toEqual([...ids].sort());
}

/** Helper: assert that a query matches exactly one id */
function expectSingle(query: string, id: string) {
  expect(search(query)).toEqual([id]);
}

describe("Key signature radial menu search", () => {
  // ── Basic structure ──
  it("returns all 16 items when query is empty", () => {
    expect(search("")).toHaveLength(16);
  });

  // ── Single uppercase letter → major key (case-sensitive) ──
  describe("single uppercase letter → major key", () => {
    it("C → C major (0 sharps/flats)", () => expectSingle("C", "0"));
    it("G → G major (1 sharp)", () => expectSingle("G", "1"));
    it("D → D major (2 sharps)", () => expectSingle("D", "2"));
    it("A → A major (3 sharps)", () => expectSingle("A", "3"));
    it("E → E major (4 sharps)", () => expectSingle("E", "4"));
    it("B → B major (5 sharps)", () => expectSingle("B", "5"));
    it("F → F major (1 flat)", () => expectSingle("F", "-1"));
  });

  // ── Single lowercase letter → minor key (case-sensitive, exact match priority) ──
  describe("single lowercase letter → minor key", () => {
    it("a → A minor (0 sharps/flats)", () => expectSingle("a", "0"));
    it("e → E minor (1 sharp)", () => expectSingle("e", "1"));
    it("b → B minor (2 sharps)", () => expectSingle("b", "2"));
    it("d → D minor (1 flat)", () => expectSingle("d", "-1"));
    it("g → G minor (2 flats)", () => expectSingle("g", "-2"));
    it("c → C minor (3 flats)", () => expectSingle("c", "-3"));
    it("f → F minor (4 flats)", () => expectSingle("f", "-4"));
  });

  // ── Sharp key signatures with # symbol ──
  describe("sharp count with # symbol", () => {
    it("1# → G major (1 sharp)", () => expectSingle("1#", "1"));
    it("2# → D major (2 sharps)", () => expectSingle("2#", "2"));
    it("3# → A major (3 sharps)", () => expectSingle("3#", "3"));
    it("4# → E major (4 sharps)", () => expectSingle("4#", "4"));
    it("5# → B major (5 sharps)", () => expectSingle("5#", "5"));
    it("6# → F# major (6 sharps)", () => expectSingle("6#", "6"));
    it("7# → C# major (7 sharps)", () => expectSingle("7#", "7"));
  });

  // ── Flat key signatures with b ──
  describe("flat count with b", () => {
    it("1b → F major (1 flat)", () => expectSingle("1b", "-1"));
    it("2b → Bb major (2 flats)", () => expectSingle("2b", "-2"));
    it("3b → Eb major (3 flats)", () => expectSingle("3b", "-3"));
    it("4b → Ab major (4 flats)", () => expectSingle("4b", "-4"));
    it("5b → Db major (5 flats)", () => expectSingle("5b", "-5"));
    it("6b → Gb major (6 flats)", () => expectSingle("6b", "-6"));
    it("7b → Cb major (7 flats)", () => expectSingle("7b", "-7"));
  });

  // ── "sharp" and "flat" spelled out ──
  describe("spelled-out sharp/flat", () => {
    it("1sharp → 1 sharp", () => expectSingle("1sharp", "1"));
    it("2sharp → 2 sharps", () => expectSingle("2sharp", "2"));
    it("7sharp → 7 sharps", () => expectSingle("7sharp", "7"));
    it("1flat → 1 flat", () => expectSingle("1flat", "-1"));
    it("3flat → 3 flats", () => expectSingle("3flat", "-3"));
    it("7flat → 7 flats", () => expectSingle("7flat", "-7"));
  });

  // ── Whitespace is stripped ──
  describe("whitespace stripping", () => {
    it("'1 sharp' → same as '1sharp'", () => expectSingle("1 sharp", "1"));
    it("'7 sharp' → same as '7sharp'", () => expectSingle("7 sharp", "7"));
    it("'3 flat' → same as '3flat'", () => expectSingle("3 flat", "-3"));
    it("'  2  #  ' → same as '2#'", () => expectSingle("  2  #  ", "2"));
    it("'D major' → same as 'Dmajor'", () => expectSingle("D major", "2"));
  });

  // ── "Ns" shorthand (number + s for sharps) ──
  describe("Ns shorthand for sharps", () => {
    it("1s → 1 sharp", () => expectSingle("1s", "1"));
    it("4s → 4 sharps", () => expectSingle("4s", "4"));
    it("7s → 7 sharps", () => expectSingle("7s", "7"));
  });

  // ── Accidental keys with # or b in the name ──
  describe("accidental major keys", () => {
    it("F# → F# major (6 sharps)", () => expectSingle("F#", "6"));
    it("C# → C# major (7 sharps)", () => expectSingle("C#", "7"));
    it("Bb → Bb major (2 flats)", () => expectSingle("Bb", "-2"));
    it("Eb → Eb major (3 flats)", () => expectSingle("Eb", "-3"));
    it("Ab → Ab major (4 flats)", () => expectSingle("Ab", "-4"));
    it("Db → Db major (5 flats)", () => expectSingle("Db", "-5"));
    it("Gb → Gb major (6 flats)", () => expectSingle("Gb", "-6"));
    it("Cb → Cb major (7 flats)", () => expectSingle("Cb", "-7"));
  });

  describe("accidental minor keys", () => {
    it("f# → F# minor (3 sharps)", () => expectSingle("f#", "3"));
    it("c# → C# minor (4 sharps)", () => expectSingle("c#", "4"));
    it("g# → G# minor (5 sharps)", () => expectSingle("g#", "5"));
    it("d# → D# minor (6 sharps)", () => expectSingle("d#", "6"));
    it("a# → A# minor (7 sharps)", () => expectSingle("a#", "7"));
    it("eb → Eb minor (6 flats)", () => expectSingle("eb", "-6"));
    it("ab → Ab minor (7 flats)", () => expectSingle("ab", "-7"));
  });

  // ── Explicit "major" / "minor" disambiguation ──
  describe("explicit major/minor with uppercase letter", () => {
    it("Dmajor → D major (2 sharps)", () => expectSingle("Dmajor", "2"));
    it("Fmajor → F major (1 flat)", () => expectSingle("Fmajor", "-1"));
    it("Bbmajor → Bb major (2 flats)", () => expectSingle("Bbmajor", "-2"));
    it("Dminor → D minor (1 flat)", () => expectSingle("Dminor", "-1"));
    it("Eminor → E minor (1 sharp)", () => expectSingle("Eminor", "1"));
    it("Aminor → A minor (0)", () => expectSingle("Aminor", "0"));
    it("Gminor → G minor (2 flats)", () => expectSingle("Gminor", "-2"));
    it("Cminor → C minor (3 flats)", () => expectSingle("Cminor", "-3"));
    it("Fminor → F minor (4 flats)", () => expectSingle("Fminor", "-4"));
  });

  describe("explicit major/minor with lowercase letter", () => {
    it("dmajor → D major (2 sharps)", () => expectSingle("dmajor", "2"));
    it("amajor → A major (3 sharps)", () => expectSingle("amajor", "3"));
    it("gmajor → G major (1 sharp)", () => expectSingle("gmajor", "1"));
    it("fmajor → F major (1 flat)", () => expectSingle("fmajor", "-1"));
    it("cmajor → C major (0)", () => expectSingle("cmajor", "0"));
    it("bmajor → B major (5 sharps)", () => expectSingle("bmajor", "5"));
    it("emajor → E major (4 sharps)", () => expectSingle("emajor", "4"));
  });

  describe("explicit major/minor with spaces", () => {
    it("'D major' → D major (2 sharps)", () => expectSingle("D major", "2"));
    it("'d major' → D major (2 sharps)", () => expectSingle("d major", "2"));
    it("'D minor' → D minor (1 flat)", () => expectSingle("D minor", "-1"));
    it("'d minor' → D minor (1 flat)", () => expectSingle("d minor", "-1"));
    it("'Eb major' → Eb major (3 flats)", () => expectSingle("Eb major", "-3"));
    it("'F# minor' → F# minor (3 sharps)", () => expectSingle("F# minor", "3"));
    it("'Bb major' → Bb major (2 flats)", () => expectSingle("Bb major", "-2"));
  });

  // ── Abbreviated forms (maj/min) ──
  describe("abbreviated maj/min", () => {
    it("Cmaj → C major (0)", () => expectSingle("Cmaj", "0"));
    it("Dmaj → D major (2 sharps)", () => expectSingle("Dmaj", "2"));
    it("amin → A minor (0)", () => expectSingle("amin", "0"));
    it("emin → E minor (1 sharp)", () => expectSingle("emin", "1"));
    it("dmin → D minor (1 flat)", () => expectSingle("dmin", "-1"));
    it("Bbmaj → Bb major (2 flats)", () => expectSingle("Bbmaj", "-2"));
    it("Ebmaj → Eb major (3 flats)", () => expectSingle("Ebmaj", "-3"));
  });

  // ── "flat" and "sharp" spelled after note name ──
  describe("spelled-out accidentals in note names", () => {
    it("Bflat → Bb major (2 flats)", () => expectSingle("Bflat", "-2"));
    it("Eflat → Eb major (3 flats)", () => expectSingle("Eflat", "-3"));
    it("Aflat → Ab major (4 flats)", () => expectSingle("Aflat", "-4"));
    it("Dflat → Db major (5 flats)", () => expectSingle("Dflat", "-5"));
    it("Gflat → Gb major (6 flats)", () => expectSingle("Gflat", "-6"));
    it("Cflat → Cb major (7 flats)", () => expectSingle("Cflat", "-7"));
    it("Fsharp → F# major (6 sharps)", () => expectSingle("Fsharp", "6"));
    it("Csharp → C# major (7 sharps)", () => expectSingle("Csharp", "7"));
  });

  // ── Atonal ──
  describe("atonal key", () => {
    it("atonal", () => expectSingle("atonal", "atonal"));
    it("open", () => expectSingle("open", "atonal"));
    it("keyless", () => expectSingle("keyless", "atonal"));
    it("none", () => expectSingle("none", "atonal"));
    it("x", () => expectSingle("x", "atonal"));
  });

  // ── Exact match priority ──
  describe("exact match priority", () => {
    it("'e' matches only E minor (not Eb minor too)", () => {
      // "e" is an exact match for E minor (key "1"), should not also return "eb" prefix matches
      expectSingle("e", "1");
    });
    it("'b' matches only B minor (not Bb or Bflat)", () => {
      expectSingle("b", "2");
    });
    it("'f' matches only F minor (not F# or Fsharp or Fmaj)", () => {
      expectSingle("f", "-4");
    });
    it("'d' matches only D minor (not Db or Dflat)", () => {
      expectSingle("d", "-1");
    });
    it("'g' matches only G minor (not Gb)", () => {
      expectSingle("g", "-2");
    });
    it("'c' matches only C minor (not C# or Cb or Cmaj)", () => {
      expectSingle("c", "-3");
    });
    it("'a' matches only A minor (not Ab or Amaj)", () => {
      expectSingle("a", "0");
    });
    it("'F' matches only F major (not F# major)", () => {
      expectSingle("F", "-1");
    });
    it("'B' matches only B major (not Bb major)", () => {
      expectSingle("B", "5");
    });
  });

  // ── Prefix matching (no exact match available) ──
  describe("prefix matching returns multiple results when no exact match", () => {
    it("'Bm' prefix matches both B major (Bmaj) and B♭ minor (bbmin) items", () => {
      const ids = search("Bm");
      // Should match Bmaj (id "5") since "Bmajor" starts with "Bm"
      // and Bminor (id "2") since "Bminor" starts with "Bm"
      expect(ids).toContain("5");
      expect(ids).toContain("2");
    });
  });

  // ── No matches ──
  describe("no matches for invalid queries", () => {
    it("'z' returns nothing", () => {
      expect(search("z")).toHaveLength(0);
    });
    it("'10#' returns nothing", () => {
      expect(search("10#")).toHaveLength(0);
    });
    it("'H major' returns nothing", () => {
      expect(search("H major")).toHaveLength(0);
    });
  });
});
