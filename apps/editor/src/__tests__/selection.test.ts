import { describe, it, expect } from "vitest";
import {
  selectionReducer,
  type Selection,
  type SelectionAction,
  type SelectionRhythmicRange,
} from "../store/selectionStore";

describe("selectionReducer", () => {
  const none: Selection = { kind: "none" };
  const single: Selection = {
    kind: "single",
    elementId: "p0/m0/s0/ev-1",
    elementType: "event",
  };
  const range: Selection = {
    kind: "range",
    startElementId: "p0/m0/s0/ev-1",
    endElementId: "p0/m2/s0/ev-3",
  };

  describe("SELECT_ELEMENT", () => {
    it("selects an element from none", () => {
      const action: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m0/s0/ev-1",
      };
      const result = selectionReducer(none, action);
      expect(result).toEqual({
        kind: "single",
        elementId: "p0/m0/s0/ev-1",
        elementType: "event",
      });
    });

    it("replaces a single selection", () => {
      const action: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m1/s0/ev-2",
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({
        kind: "single",
        elementId: "p0/m1/s0/ev-2",
        elementType: "event",
      });
    });

    it("replaces a range selection with single", () => {
      const action: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m1/s0/ev-2",
      };
      const result = selectionReducer(range, action);
      expect(result).toEqual({
        kind: "single",
        elementId: "p0/m1/s0/ev-2",
        elementType: "event",
      });
    });

    it("computes elementType for non-event elements", () => {
      const dynAction: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m1/dyn0",
      };
      expect(selectionReducer(none, dynAction)).toEqual({
        kind: "single",
        elementId: "p0/m1/dyn0",
        elementType: "dynamic",
      });

      const clefAction: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m0/clef",
      };
      expect(selectionReducer(none, clefAction)).toEqual({
        kind: "single",
        elementId: "p0/m0/clef",
        elementType: "clef",
      });

      const artAction: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m1/s0/ev-1/art0",
      };
      expect(selectionReducer(none, artAction)).toEqual({
        kind: "single",
        elementId: "p0/m1/s0/ev-1/art0",
        elementType: "articulation",
      });
    });
  });

  describe("CLEAR_SELECTION", () => {
    it("clears a single selection", () => {
      const action: SelectionAction = { type: "CLEAR_SELECTION" };
      const result = selectionReducer(single, action);
      expect(result).toEqual({ kind: "none" });
    });

    it("clears a range selection", () => {
      const action: SelectionAction = { type: "CLEAR_SELECTION" };
      const result = selectionReducer(range, action);
      expect(result).toEqual({ kind: "none" });
    });

    it("returns same state when already none", () => {
      const action: SelectionAction = { type: "CLEAR_SELECTION" };
      const result = selectionReducer(none, action);
      expect(result).toBe(none); // referential equality
    });
  });

  describe("EXTEND_SELECTION", () => {
    it("creates single from none", () => {
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "p0/m0/s0/ev-1",
      };
      const result = selectionReducer(none, action);
      expect(result).toEqual({
        kind: "single",
        elementId: "p0/m0/s0/ev-1",
        elementType: "event",
      });
    });

    it("creates range from single", () => {
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "p0/m2/s0/ev-3",
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({
        kind: "range",
        startElementId: "p0/m0/s0/ev-1",
        endElementId: "p0/m2/s0/ev-3",
      });
    });

    it("returns same state when extending to same element", () => {
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "p0/m0/s0/ev-1",
      };
      const result = selectionReducer(single, action);
      expect(result).toBe(single);
    });

    it("extends end of an existing range", () => {
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "p0/m5/s0/ev-9",
      };
      const result = selectionReducer(range, action);
      expect(result).toEqual({
        kind: "range",
        startElementId: "p0/m0/s0/ev-1",
        endElementId: "p0/m5/s0/ev-9",
      });
    });

    it("extends a measure selection to the clicked element without corrupting the staff range", () => {
      const measureSel: Selection = {
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 1,
        startStaffIndex: 0,
        endStaffIndex: 1,
        startMeasure: 2,
        endMeasure: 2,
      };
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "p3/m6/s0/ev-9",
      };
      const result = selectionReducer(measureSel, action);
      // endStaffIndex must remain a STAFF index (preserved), never the part index (3).
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 3,
        startStaffIndex: 0,
        endStaffIndex: 1,
        startMeasure: 2,
        endMeasure: 6,
      });
    });
  });

  describe("SELECT_RANGE", () => {
    it("creates a range from none", () => {
      const action: SelectionAction = {
        type: "SELECT_RANGE",
        startElementId: "p0/m0/s0/ev-1",
        endElementId: "p0/m3/s0/ev-5",
      };
      const result = selectionReducer(none, action);
      expect(result).toEqual({
        kind: "range",
        startElementId: "p0/m0/s0/ev-1",
        endElementId: "p0/m3/s0/ev-5",
      });
    });

    describe("SELECT_ELEMENTS", () => {
      const rhythmicRange: SelectionRhythmicRange = {
        start: { measureIndex: 0, beat: 0 },
        end: { measureIndex: 0, beat: 4 },
      };

      it("selects an exact non-contiguous group and removes duplicates", () => {
        const result = selectionReducer(none, {
          type: "SELECT_ELEMENTS",
          elementIds: ["p0/m0/s0/a", "p0/m0/s0/b", "p0/m0/s0/a"],
        });
        expect(result).toEqual({ kind: "multi", elementIds: ["p0/m0/s0/a", "p0/m0/s0/b"] });
      });

      it("normalizes a one-member group to a single selection", () => {
        const result = selectionReducer(none, {
          type: "SELECT_ELEMENTS",
          elementIds: ["p0/m0/s0/a"],
        });
        expect(result).toEqual({ kind: "single", elementId: "p0/m0/s0/a", elementType: "event" });
      });

      it("preserves the visual expansion anchor for grouped selection", () => {
        const measureAnchor = { partIndex: 1, staffIndex: 2, measureIndex: 0, isExpansion: true };
        const result = selectionReducer(none, {
          type: "SELECT_ELEMENTS",
          elementIds: ["p1/m0/s0/a", "p1/m0/s0/b"],
          measureAnchor,
        });
        expect(result).toEqual({
          kind: "multi",
          elementIds: ["p1/m0/s0/a", "p1/m0/s0/b"],
          measureAnchor,
        });
      });

      it.each([{ elementIds: ["p0/m0/s0/a"] }, { elementIds: ["p0/m0/s0/a", "p0/m0/s1/b"] }])(
        "preserves explicit timing for the group $elementIds",
        ({ elementIds }) => {
          const measureAnchor = { partIndex: 0, staffIndex: 0, measureIndex: 0 };
          const result = selectionReducer(none, {
            type: "SELECT_ELEMENTS",
            elementIds: [...elementIds, elementIds[0]!, "bare-id"],
            measureAnchor,
            rhythmicRange,
          });
          expect(result).toEqual({ kind: "multi", elementIds, measureAnchor, rhythmicRange });
        },
      );

      it.each([{ elementIds: [] }, { elementIds: ["bare-id"] }])(
        "clears an empty valid group even with timing: $elementIds",
        ({ elementIds }) => {
          expect(selectionReducer(single, { type: "SELECT_ELEMENTS", elementIds, rhythmicRange })).toEqual(none);
        },
      );

      it.each<SelectionAction>([
        { type: "SELECT_ELEMENT", elementId: "p0/m0/s0/c" },
        { type: "SELECT_RANGE", startElementId: "p0/m0/s0/a", endElementId: "p0/m0/s0/c" },
        { type: "SELECT_ELEMENTS", elementIds: ["p0/m0/s0/a", "p0/m0/s0/c"] },
        { type: "TOGGLE_SELECTION", elementId: "p0/m0/s0/c" },
        { type: "TOGGLE_SELECTION", elementId: "p0/m0/s0/a" },
        { type: "EXTEND_SELECTION", elementId: "p0/m0/s0/c" },
        { type: "SELECT_MEASURE", partIndex: 0, staffIndex: 0, measureIndex: 1 },
        { type: "EXTEND_MEASURE", partIndex: 0, staffIndex: 0, measureIndex: 1 },
        { type: "CLEAR_SELECTION" },
      ])("clears stale timing on $type", (action) => {
        const timed: Selection = {
          kind: "multi",
          elementIds: ["p0/m0/s0/a", "p0/m0/s1/b"],
          rhythmicRange,
        };
        expect(selectionReducer(timed, action)).not.toHaveProperty("rhythmicRange");
      });
    });

    it("replaces a single selection with range", () => {
      const action: SelectionAction = {
        type: "SELECT_RANGE",
        startElementId: "p0/m1/s0/ev-2",
        endElementId: "p0/m4/s0/ev-7",
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({
        kind: "range",
        startElementId: "p0/m1/s0/ev-2",
        endElementId: "p0/m4/s0/ev-7",
      });
    });
  });

  describe("bare ID guard", () => {
    it("rejects bare element IDs without structural prefix in SELECT_ELEMENT", () => {
      const action: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "ev-abc123",
      };
      const result = selectionReducer(none, action);
      expect(result.kind).toBe("none");
    });

    it("rejects bare element IDs without structural prefix in EXTEND_SELECTION", () => {
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "ev-abc123",
      };
      const result = selectionReducer(none, action);
      expect(result.kind).toBe("none");
    });

    it("accepts valid element IDs with structural prefix", () => {
      const action: SelectionAction = {
        type: "SELECT_ELEMENT",
        elementId: "p0/m0/s0/ev1",
      };
      const result = selectionReducer(none, action);
      expect(result.kind).toBe("single");
    });
  });

  describe("TOGGLE_SELECTION", () => {
    it("creates single from none", () => {
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m0/s0/ev-1",
      };
      const result = selectionReducer(none, action);
      expect(result).toEqual({
        kind: "single",
        elementId: "p0/m0/s0/ev-1",
        elementType: "event",
      });
    });

    it("deselects the same element back to none", () => {
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m0/s0/ev-1",
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({ kind: "none" });
    });

    it("creates multi from single + different element", () => {
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m1/s0/ev-2",
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({
        kind: "multi",
        elementIds: ["p0/m0/s0/ev-1", "p0/m1/s0/ev-2"],
      });
    });

    it("adds to multi selection", () => {
      const multi: Selection = {
        kind: "multi",
        elementIds: ["p0/m0/s0/ev-1", "p0/m1/s0/ev-2"],
      };
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m2/s0/ev-3",
      };
      const result = selectionReducer(multi, action);
      expect(result).toEqual({
        kind: "multi",
        elementIds: ["p0/m0/s0/ev-1", "p0/m1/s0/ev-2", "p0/m2/s0/ev-3"],
      });
    });

    it("removes from multi selection, back to single", () => {
      const multi: Selection = {
        kind: "multi",
        elementIds: ["p0/m0/s0/ev-1", "p0/m1/s0/ev-2"],
      };
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m1/s0/ev-2",
      };
      const result = selectionReducer(multi, action);
      expect(result).toEqual({
        kind: "single",
        elementId: "p0/m0/s0/ev-1",
        elementType: "event",
      });
    });

    it("removes last from multi goes to none", () => {
      const multi: Selection = {
        kind: "multi",
        elementIds: ["p0/m0/s0/ev-1"],
      };
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m0/s0/ev-1",
      };
      const result = selectionReducer(multi, action);
      expect(result).toEqual({ kind: "none" });
    });

    it("from range starts fresh multi", () => {
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "p0/m3/s0/ev-5",
      };
      const result = selectionReducer(range, action);
      expect(result).toEqual({
        kind: "multi",
        elementIds: ["p0/m3/s0/ev-5"],
      });
    });

    it("rejects bare IDs", () => {
      const action: SelectionAction = {
        type: "TOGGLE_SELECTION",
        elementId: "bare-id",
      };
      const result = selectionReducer(none, action);
      expect(result.kind).toBe("none");
    });
  });

  describe("SELECT_MEASURE", () => {
    it("selects a measure from none", () => {
      const action: SelectionAction = {
        type: "SELECT_MEASURE",
        partIndex: 0,
        staffIndex: 0,
        measureIndex: 2,
      };
      const result = selectionReducer(none, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 2,
        endMeasure: 2,
      });
    });

    it("replaces single selection with measure", () => {
      const action: SelectionAction = {
        type: "SELECT_MEASURE",
        partIndex: 1,
        staffIndex: 1,
        measureIndex: 3,
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 1,
        startStaffIndex: 1,
        endStaffIndex: 1,
        startMeasure: 3,
        endMeasure: 3,
      });
    });
  });

  describe("EXTEND_MEASURE", () => {
    it("extends measure range", () => {
      const measureSel: Selection = {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      };
      const action: SelectionAction = {
        type: "EXTEND_MEASURE",
        partIndex: 0,
        staffIndex: 0,
        measureIndex: 4,
      };
      const result = selectionReducer(measureSel, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 4,
      });
    });

    it("extends across staves", () => {
      const measureSel: Selection = {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 3,
        endMeasure: 3,
      };
      const action: SelectionAction = {
        type: "EXTEND_MEASURE",
        partIndex: 2,
        staffIndex: 2,
        measureIndex: 4,
      };
      const result = selectionReducer(measureSel, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 2,
        startStaffIndex: 0,
        endStaffIndex: 2,
        startMeasure: 3,
        endMeasure: 4,
      });
    });

    it("from single event without pointer metadata preserves the clicked staff", () => {
      const action: SelectionAction = {
        type: "EXTEND_MEASURE",
        partIndex: 2,
        staffIndex: 2,
        measureIndex: 5,
      };
      const result = selectionReducer(single, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 2,
        startStaffIndex: 2,
        endStaffIndex: 2,
        startMeasure: 0,
        endMeasure: 5,
      });
    });

    it("uses a single selection's visual staff anchor across parts", () => {
      const singleInPart2: Selection = {
        kind: "single",
        elementId: "p2/m1/s0/ev-1",
        elementType: "event",
        measureAnchor: { partIndex: 2, staffIndex: 4, measureIndex: 1 },
      };
      const action: SelectionAction = {
        type: "EXTEND_MEASURE",
        partIndex: 3,
        staffIndex: 1,
        measureIndex: 5,
      };
      const result = selectionReducer(singleInPart2, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 2,
        endPartIndex: 3,
        startStaffIndex: 4,
        endStaffIndex: 1,
        startMeasure: 1,
        endMeasure: 5,
      });
    });

    it("from range without pointer metadata preserves the clicked staff", () => {
      const action: SelectionAction = {
        type: "EXTEND_MEASURE",
        partIndex: 1,
        staffIndex: 1,
        measureIndex: 3,
      };
      const result = selectionReducer(range, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 1,
        startStaffIndex: 1,
        endStaffIndex: 1,
        startMeasure: 0,
        endMeasure: 3,
      });
    });

    it("preserves a single element's visual anchor when it becomes an element range", () => {
      const anchoredSingle: Selection = {
        ...single,
        measureAnchor: { partIndex: 1, staffIndex: 3, measureIndex: 2 },
      };
      const elementRange = selectionReducer(anchoredSingle, {
        type: "EXTEND_SELECTION",
        elementId: "p2/m4/s0/ev-5",
      });
      const result = selectionReducer(elementRange, {
        type: "EXTEND_MEASURE",
        partIndex: 4,
        staffIndex: 7,
        measureIndex: 6,
      });

      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 1,
        endPartIndex: 4,
        startStaffIndex: 3,
        endStaffIndex: 7,
        startMeasure: 2,
        endMeasure: 6,
      });
    });

    it("from none creates single measure", () => {
      const action: SelectionAction = {
        type: "EXTEND_MEASURE",
        partIndex: 2,
        staffIndex: 2,
        measureIndex: 5,
      };
      const result = selectionReducer(none, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 2,
        endPartIndex: 2,
        startStaffIndex: 2,
        endStaffIndex: 2,
        startMeasure: 5,
        endMeasure: 5,
      });
    });
  });

  describe("EXTEND_SELECTION from measure", () => {
    it("extends measure to include shift-clicked event", () => {
      const measureSel: Selection = {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 1,
      };
      const action: SelectionAction = {
        type: "EXTEND_SELECTION",
        elementId: "p2/m4/s0/ev-5",
      };
      const result = selectionReducer(measureSel, action);
      expect(result).toEqual({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 2,
        startStaffIndex: 0,
        endStaffIndex: 0,
        startMeasure: 1,
        endMeasure: 4,
      });
    });
  });
});
