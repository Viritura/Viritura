import { describe, it, expect } from "vitest";
import { parseElementType, isEventAttached, isMeasureLevel, isGlobalLevel } from "../elementTypes";
import type { SelectableElementType } from "../elementTypes";

describe("parseElementType", () => {
  describe("event-attached elements", () => {
    it("returns 'accidental' for acc-prefixed segments", () => {
      expect(parseElementType("p0/m1/s0/ev1/acc0")).toBe("accidental");
      expect(parseElementType("p0/m0/s0/ev0/acc12")).toBe("accidental");
    });

    it("keeps an accidental distinct from the notehead it spells", () => {
      expect(parseElementType("p0/m1/s0/ev1/n0")).toBe("note");
      expect(parseElementType("p0/m1/s0/ev1/acc0")).toBe("accidental");
      expect(isEventAttached("accidental")).toBe(true);
    });

    it("returns 'articulation' for art-prefixed segments", () => {
      expect(parseElementType("p0/m1/s0/ev1/art0")).toBe("articulation");
      expect(parseElementType("p0/m0/s0/ev0/art3")).toBe("articulation");
    });

    it("returns 'fermata' for ferm-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/ferm0")).toBe("fermata");
      expect(parseElementType("p0/m1/s0/ev2/fermata")).toBe("fermata");
    });

    it("returns 'ornament' for orn-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/orn0")).toBe("ornament");
      expect(parseElementType("p1/m2/s0/ev1/ornament0")).toBe("ornament");
    });

    it("returns 'trill' for trill-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/trill0")).toBe("trill");
      expect(parseElementType("p0/m0/s0/ev0/trill")).toBe("trill");
    });

    it("returns 'fingering' for fing-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/fing0")).toBe("fingering");
      expect(parseElementType("p0/m0/s0/ev0/fingering2")).toBe("fingering");
    });

    it("returns 'arpeggio' for arp-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/arp0")).toBe("arpeggio");
      expect(parseElementType("p0/m0/s0/ev0/arpeggio")).toBe("arpeggio");
    });

    it("returns 'tremolo' for trem-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/trem0")).toBe("tremolo");
      expect(parseElementType("p0/m0/s0/ev0/tremolo1")).toBe("tremolo");
    });

    it("returns 'breath' for breath-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/breath")).toBe("breath");
      expect(parseElementType("p0/m0/s0/ev0/breath0")).toBe("breath");
    });

    it("returns 'slur' for slur-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/slur0")).toBe("slur");
      expect(parseElementType("p0/m0/s0/ev0/slur")).toBe("slur");
    });

    it("returns 'tie' for tie segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/tie")).toBe("tie");
      expect(parseElementType("p0/m0/s0/ev0/tie0")).toBe("tie");
    });

    it("returns 'glissando' for gliss-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/ev0/gliss0")).toBe("glissando");
      expect(parseElementType("p0/m0/s0/ev0/glissando")).toBe("glissando");
    });
  });

  describe("measure-level elements", () => {
    it("returns 'dynamic' for dyn-prefixed segments", () => {
      expect(parseElementType("p0/m2/dyn0")).toBe("dynamic");
      expect(parseElementType("p1/m0/dyn3")).toBe("dynamic");
    });

    it("returns 'hairpin' for hairpin-prefixed segments", () => {
      expect(parseElementType("p0/m0/hairpin0")).toBe("hairpin");
      expect(parseElementType("p0/m1/hairpin2")).toBe("hairpin");
    });

    it("returns 'pedal' for pedal-prefixed segments", () => {
      expect(parseElementType("p0/m0/pedal0")).toBe("pedal");
      expect(parseElementType("p0/m1/pedal1")).toBe("pedal");
    });

    it("returns 'ottava' for ottava-prefixed segments", () => {
      expect(parseElementType("p0/m0/ottava0")).toBe("ottava");
      expect(parseElementType("p0/m1/ottava1")).toBe("ottava");
    });

    it("returns 'expression' for expr-prefixed segments", () => {
      expect(parseElementType("p0/m0/expr0")).toBe("expression");
      expect(parseElementType("p0/m1/expression1")).toBe("expression");
    });

    it("returns 'chord-symbol' for chord-prefixed segments", () => {
      expect(parseElementType("p0/m0/chord0")).toBe("chord-symbol");
      expect(parseElementType("p0/m1/chordSym2")).toBe("chord-symbol");
    });

    it("returns 'measure-number' for mnum segments", () => {
      expect(parseElementType("p0/m0/mnum")).toBe("measure-number");
      expect(parseElementType("p0/m3/mnum0")).toBe("measure-number");
    });

    it("returns 'barline' for barline segments", () => {
      expect(parseElementType("p0/m0/barline")).toBe("barline");
      expect(parseElementType("p0/m1/barline")).toBe("barline");
    });

    it("returns 'clef' for clef segments", () => {
      expect(parseElementType("p0/m0/clef")).toBe("clef");
      expect(parseElementType("p1/m2/clef")).toBe("clef");
    });

    it("returns 'key-signature' for key segments", () => {
      expect(parseElementType("p0/m0/key")).toBe("key-signature");
      expect(parseElementType("p1/m0/key")).toBe("key-signature");
    });

    it("returns 'time-signature' for time segments", () => {
      expect(parseElementType("m0/time")).toBe("time-signature");
      expect(parseElementType("p0/m0/time")).toBe("time-signature");
    });
  });

  describe("global-level elements", () => {
    it("returns 'tempo' for tempo-prefixed segments", () => {
      expect(parseElementType("m0/tempo0")).toBe("tempo");
      expect(parseElementType("m0/tempo")).toBe("tempo");
    });

    it("returns 'rehearsal' for rehearsal segments", () => {
      expect(parseElementType("m0/rehearsal")).toBe("rehearsal");
      expect(parseElementType("m4/rehearsal0")).toBe("rehearsal");
    });

    it("returns 'jump' for jump-prefixed segments", () => {
      expect(parseElementType("m0/jump0")).toBe("jump");
      expect(parseElementType("m3/jump")).toBe("jump");
    });

    it("returns 'volta' for volta segments", () => {
      expect(parseElementType("m0/volta0")).toBe("volta");
      expect(parseElementType("m2/volta")).toBe("volta");
    });
  });

  describe("structural elements", () => {
    it("returns 'beam' for beam-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/beam0")).toBe("beam");
      expect(parseElementType("p0/m0/beam1")).toBe("beam");
    });

    it("returns 'tuplet' for tuplet-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/tuplet0")).toBe("tuplet");
      expect(parseElementType("p0/m0/tuplet1")).toBe("tuplet");
    });

    it("returns 'grace-note' for grace-prefixed segments", () => {
      expect(parseElementType("p0/m0/s0/grace0")).toBe("grace-note");
      expect(parseElementType("p0/m0/s0/graceGroup")).toBe("grace-note");
    });
  });

  describe("event fallback", () => {
    it("returns 'event' for standard event IDs", () => {
      expect(parseElementType("p0/m0/s0/e0")).toBe("event");
      expect(parseElementType("p0/m1/v0/e3")).toBe("event");
      expect(parseElementType("p0/m0/s0/ev1")).toBe("event");
    });

    it("returns 'event' for custom event IDs", () => {
      expect(parseElementType("p0/m0/s0/myCustomEvent")).toBe("event");
      expect(parseElementType("p0/m0/s0/note1")).toBe("event");
    });
  });

  describe("edge cases", () => {
    it("returns 'unknown' for empty string", () => {
      expect(parseElementType("")).toBe("unknown");
    });

    it("returns 'event' for single unknown segment", () => {
      expect(parseElementType("something")).toBe("event");
    });

    it("handles trailing slash gracefully", () => {
      // trailing slash produces an empty last segment → unknown
      expect(parseElementType("p0/m0/")).toBe("unknown");
    });

    it("handles single-segment known types", () => {
      expect(parseElementType("clef")).toBe("clef");
      expect(parseElementType("barline")).toBe("barline");
      expect(parseElementType("tempo")).toBe("tempo");
    });
  });
});

describe("isEventAttached", () => {
  const eventAttachedTypes: SelectableElementType[] = [
    "articulation",
    "fermata",
    "ornament",
    "trill",
    "fingering",
    "arpeggio",
    "tremolo",
    "breath",
    "caesura",
    "slur",
    "tie",
    "glissando",
  ];

  for (const type of eventAttachedTypes) {
    it(`returns true for '${type}'`, () => {
      expect(isEventAttached(type)).toBe(true);
    });
  }

  const notEventAttached: SelectableElementType[] = [
    "event",
    "rest",
    "dynamic",
    "hairpin",
    "clef",
    "tempo",
    "rehearsal",
    "barline",
    "unknown",
  ];

  for (const type of notEventAttached) {
    it(`returns false for '${type}'`, () => {
      expect(isEventAttached(type)).toBe(false);
    });
  }
});

describe("isMeasureLevel", () => {
  const measureTypes: SelectableElementType[] = [
    "dynamic",
    "hairpin",
    "pedal",
    "ottava",
    "expression",
    "chord-symbol",
    "measure-number",
    "barline",
    "clef",
    "key-signature",
    "time-signature",
  ];

  for (const type of measureTypes) {
    it(`returns true for '${type}'`, () => {
      expect(isMeasureLevel(type)).toBe(true);
    });
  }

  const notMeasure: SelectableElementType[] = ["event", "articulation", "tempo", "rehearsal", "unknown"];

  for (const type of notMeasure) {
    it(`returns false for '${type}'`, () => {
      expect(isMeasureLevel(type)).toBe(false);
    });
  }
});

describe("isGlobalLevel", () => {
  const globalTypes: SelectableElementType[] = ["tempo", "rehearsal", "jump", "volta"];

  for (const type of globalTypes) {
    it(`returns true for '${type}'`, () => {
      expect(isGlobalLevel(type)).toBe(true);
    });
  }

  const notGlobal: SelectableElementType[] = ["event", "dynamic", "clef", "articulation", "unknown"];

  for (const type of notGlobal) {
    it(`returns false for '${type}'`, () => {
      expect(isGlobalLevel(type)).toBe(false);
    });
  }
});
