import { useCallback, useMemo } from "react";
import type {
  EffectiveStaffMeter,
  Score,
  StaffMeter,
  StaffMeterIssue,
  StaffMeterSynchronization,
  TimeSignature,
} from "@viritura/core";
import { resolveStaffMeterTimeline, setStaffMeter, setStaffMeterToGlobal } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { staffFromSelection } from "../../app/useSignatureActions";
import type { SelectionState } from "../../store/selectionStore";

/** Mirrors `useGroupingDisplayInspector`'s helper of the same name so every
 *  inspector hook agrees on what "the current global meter" means. */
function effectiveTimeSignatureAt(score: Score, measureIndex: number): TimeSignature {
  for (let i = measureIndex; i >= 0; i--) {
    const time = score.global.measures[i]?.time;
    if (time) return time;
  }
  return { count: 4, unit: 4 };
}

function selectionMeasureAnchor(selection: SelectionState) {
  return selection.kind === "single" || selection.kind === "range" ? selection.measureAnchor : undefined;
}

function selectedPartIndex(selection: SelectionState): number | undefined {
  if (selection.kind !== "measure") return selectionMeasureAnchor(selection)?.partIndex;
  return Math.min(selection.startPartIndex, selection.endPartIndex);
}

function staffDisplayLabel(score: Score | null, partIndex: number, staff: number | undefined) {
  if (staff === undefined) return undefined;
  const part = score?.parts[partIndex];
  if ((part?.staves ?? 1) > 1) return `${part?.name || `Part ${partIndex + 1}`}, staff ${staff}`;
  return part?.name || `Staff ${staff}`;
}

export interface StaffMeterInspectorDeps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export interface StaffMeterInspectorState {
  /** False when the selection has no resolvable staff scope. */
  isAvailable: boolean;
  /** Resolved measure index this state applies to — part of this hook's
   *  identity for keying the section component across selection changes
   *  (see `StaffMeterSection`'s usage in `NotationInspector`). */
  measureIndex: number;
  /** Resolved part index this state applies to — see `measureIndex`. */
  partIndex: number;
  /** 1-based staff number a staff-meter declaration would target. */
  staff: number | undefined;
  /** Musician-facing label for the selected staff/part. */
  staffLabel: string | undefined;
  /** The global meter in force at this measure — shown as "Global" reference. */
  globalTimeSignature: TimeSignature;
  /** This staff's currently-effective staff-local meter, or `undefined` when
   *  it follows the global meter (no declaration, or the nearest one reset). */
  effective: EffectiveStaffMeter | undefined;
  /** A validation issue on the declaration authored at this exact measure, if any
   *  (e.g. a `sharedDuration` meter whose duration doesn't match the global one). */
  issue: StaffMeterIssue | undefined;
  handleSetStaffMeter: (meter: StaffMeter, synchronization: StaffMeterSynchronization) => void;
  handleResetToGlobal: () => void;
}

/**
 * Staff-local synchronous meter state (`_x.viritura.staffMeters`) for the
 * staff at the current selection, at the currently-selected measure.
 * Declarations inherit until changed or reset — see
 * `docs/spec/viritura-extensions.md#staffmeters` — so `effective` reflects
 * the nearest applicable declaration at or before this measure, not only one
 * authored exactly here.
 */
export function useStaffMeterInspector({
  score,
  target,
  selection,
  updateScore,
}: StaffMeterInspectorDeps): StaffMeterInspectorState {
  const measureIndex = target?.measureIndex ?? 0;
  const partIndex = selectedPartIndex(selection) ?? target?.partIndex ?? 0;
  const staff = staffFromSelection(selection);
  const staffLabel = staffDisplayLabel(score, partIndex, staff);
  const globalTimeSignature = score ? effectiveTimeSignatureAt(score, measureIndex) : { count: 4, unit: 4 };

  const { effective, issue } = useMemo(() => {
    const part = score?.parts[partIndex];
    if (!score || !part || staff === undefined) {
      return { effective: undefined, issue: undefined };
    }
    const globalTimeAt = part.measures.map((_, idx) => effectiveTimeSignatureAt(score, idx));
    const { table, issues } = resolveStaffMeterTimeline(
      part.measures.map((pm) => pm.staffMeters),
      globalTimeAt,
    );
    return {
      effective: table[measureIndex]?.get(staff),
      issue: issues.find((entry) => entry.measureIndex === measureIndex && entry.staff === staff),
    };
  }, [score, partIndex, staff, measureIndex]);

  const handleSetStaffMeter = useCallback(
    (meter: StaffMeter, synchronization: StaffMeterSynchronization) => {
      if (!score || !target || staff === undefined) return;
      updateScore(setStaffMeter(score, measureIndex, partIndex, staff, meter, synchronization));
    },
    [score, target, measureIndex, partIndex, staff, updateScore],
  );

  const handleResetToGlobal = useCallback(() => {
    if (!score || !target || staff === undefined) return;
    updateScore(setStaffMeterToGlobal(score, measureIndex, partIndex, staff));
  }, [score, target, measureIndex, partIndex, staff, updateScore]);

  return {
    isAvailable: target !== null && staff !== undefined,
    measureIndex,
    partIndex,
    staff,
    staffLabel,
    globalTimeSignature,
    effective,
    issue,
    handleSetStaffMeter,
    handleResetToGlobal,
  };
}
