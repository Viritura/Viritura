import type { Selection } from "../../store/selectionStore";

/** Concise status announced when the score selection changes. */
export function selectionAnnouncement(selection: Selection): string {
  switch (selection.kind) {
    case "none":
      return "No score selection.";
    case "single":
      return `Selected ${selection.elementType}.`;
    case "multi":
      return `${selection.elementIds.length} score elements selected.`;
    case "range":
      return "Score range selected.";
    case "measure": {
      const measureCount = Math.abs(selection.endMeasure - selection.startMeasure) + 1;
      const staffCount = Math.abs(selection.endStaffIndex - selection.startStaffIndex) + 1;
      return `${measureCount} ${measureCount === 1 ? "measure" : "measures"} selected across ${staffCount} ${
        staffCount === 1 ? "staff" : "staves"
      }.`;
    }
  }
}
