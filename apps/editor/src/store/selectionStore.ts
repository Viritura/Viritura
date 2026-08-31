/**
 * Selection store.
 *
 * Module-level zustand store that owns the editor's selection (none /
 * single element / element range / multi / measure range). Replaces the
 * prior `SelectionContext` + `SelectionProvider` pair. The pure
 * `selectionReducer` is kept exported so unit tests can exercise state
 * transitions without going through React.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { parseElementType, type SelectableElementType } from "../score/elementTypes";
import { extractPartIndex, extractMeasureIndex } from "../score/ElementPath";

// --- Selection Types ---
export interface MeasureSelectionPoint {
  readonly partIndex: number;
  readonly staffIndex: number;
  readonly localStaffIndex?: number;
  readonly measureIndex: number;
  /** The pointer landed on a synthetic source staff under condensed notation. */
  readonly isExpansion?: boolean;
}

interface SelectionNone {
  readonly kind: "none";
}

/** A single element is selected by its element ID. */
interface SelectionSingle {
  readonly kind: "single";
  readonly elementId: string;
  readonly elementType: SelectableElementType;
  /** Visual staff location where the pointer selected this element. */
  readonly measureAnchor?: MeasureSelectionPoint;
}

/** A contiguous range of elements is selected. */
interface SelectionRange {
  readonly kind: "range";
  readonly startElementId: string;
  readonly endElementId: string;
  /** Visual staff location of the range's fixed start anchor. */
  readonly measureAnchor?: MeasureSelectionPoint;
}

/** Multiple non-contiguous elements are selected (Ctrl+click). */
interface SelectionMulti {
  readonly kind: "multi";
  readonly elementIds: readonly string[];
}

/** A measure (or range of measures) is selected by clicking empty space. */
interface SelectionMeasure {
  readonly kind: "measure";
  readonly startPartIndex: number;
  readonly endPartIndex: number;
  readonly startStaffIndex: number;
  readonly endStaffIndex: number;
  readonly startLocalStaffIndex?: number;
  readonly endLocalStaffIndex?: number;
  readonly startMeasure: number;
  readonly endMeasure: number;
}

type Selection = SelectionNone | SelectionSingle | SelectionRange | SelectionMulti | SelectionMeasure;

// --- Actions ---

interface SelectElementAction {
  readonly type: "SELECT_ELEMENT";
  readonly elementId: string;
  readonly measureAnchor?: MeasureSelectionPoint;
}

interface SelectRangeAction {
  readonly type: "SELECT_RANGE";
  readonly startElementId: string;
  readonly endElementId: string;
}

interface ExtendSelectionAction {
  readonly type: "EXTEND_SELECTION";
  readonly elementId: string;
}

interface ClearSelectionAction {
  readonly type: "CLEAR_SELECTION";
}

interface ToggleSelectionAction {
  readonly type: "TOGGLE_SELECTION";
  readonly elementId: string;
}

interface SelectMeasureAction {
  readonly type: "SELECT_MEASURE";
  readonly partIndex: number;
  readonly staffIndex: number;
  readonly localStaffIndex?: number;
  readonly measureIndex: number;
}

interface ExtendMeasureAction {
  readonly type: "EXTEND_MEASURE";
  readonly measureIndex: number;
  readonly partIndex: number;
  readonly staffIndex: number;
  readonly localStaffIndex?: number;
}

type SelectionAction =
  | SelectElementAction
  | SelectRangeAction
  | ExtendSelectionAction
  | ClearSelectionAction
  | ToggleSelectionAction
  | SelectMeasureAction
  | ExtendMeasureAction;

// --- Reducer ---

function extendElementSelection(state: Selection, action: ExtendSelectionAction): Selection {
  if (state.kind === "none") {
    return {
      kind: "single",
      elementId: action.elementId,
      elementType: parseElementType(action.elementId),
    };
  }
  if (state.kind === "single") {
    if (state.elementId === action.elementId) return state;
    return {
      kind: "range",
      startElementId: state.elementId,
      endElementId: action.elementId,
      ...(state.measureAnchor && { measureAnchor: state.measureAnchor }),
    };
  }
  if (state.kind === "measure") {
    const targetPart = extractPartIndex(action.elementId) ?? 0;
    const targetMeasure = extractMeasureIndex(action.elementId) ?? 0;
    // An element ID encodes part/measure/sequence but NOT staff, so the
    // clicked element's staff is unknown here. Preserve the existing staff
    // range rather than corrupting it with a part index.
    return {
      kind: "measure",
      startPartIndex: state.startPartIndex,
      endPartIndex: targetPart,
      startStaffIndex: state.startStaffIndex,
      endStaffIndex: state.endStaffIndex,
      startMeasure: state.startMeasure,
      endMeasure: targetMeasure,
    };
  }
  if (state.kind === "multi") {
    // Multi: just start fresh single
    return {
      kind: "single",
      elementId: action.elementId,
      elementType: parseElementType(action.elementId),
    };
  }
  // Already a range — extend the end
  return {
    kind: "range",
    startElementId: state.startElementId,
    endElementId: action.elementId,
    ...(state.measureAnchor && { measureAnchor: state.measureAnchor }),
  };
}

function toggleElementSelection(state: Selection, action: ToggleSelectionAction): Selection {
  if (state.kind === "none") {
    return {
      kind: "single",
      elementId: action.elementId,
      elementType: parseElementType(action.elementId),
    };
  }
  if (state.kind === "single") {
    if (state.elementId === action.elementId) return { kind: "none" };
    return {
      kind: "multi",
      elementIds: [state.elementId, action.elementId],
    };
  }
  if (state.kind === "multi") {
    const existing = state.elementIds;
    if (existing.includes(action.elementId)) {
      const remaining = existing.filter((id) => id !== action.elementId);
      if (remaining.length === 0) return { kind: "none" };
      if (remaining.length === 1) {
        return {
          kind: "single",
          elementId: remaining[0]!,
          elementType: parseElementType(remaining[0]!),
        };
      }
      return { kind: "multi", elementIds: remaining };
    }
    return { kind: "multi", elementIds: [...existing, action.elementId] };
  }
  // From range: start fresh multi-select
  return {
    kind: "multi",
    elementIds: [action.elementId],
  };
}

function extendMeasureSelection(state: Selection, action: ExtendMeasureAction): Selection {
  if (state.kind === "measure") {
    return {
      kind: "measure",
      startPartIndex: state.startPartIndex,
      endPartIndex: action.partIndex,
      startStaffIndex: state.startStaffIndex,
      endStaffIndex: action.staffIndex,
      ...(state.startLocalStaffIndex !== undefined && { startLocalStaffIndex: state.startLocalStaffIndex }),
      ...(action.localStaffIndex !== undefined && { endLocalStaffIndex: action.localStaffIndex }),
      startMeasure: state.startMeasure,
      endMeasure: action.measureIndex,
    };
  }
  if (state.kind === "single" || state.kind === "range") {
    const anchorId = state.kind === "single" ? state.elementId : state.startElementId;
    const anchorPart = state.measureAnchor?.partIndex ?? extractPartIndex(anchorId) ?? action.partIndex;
    const anchorMeasure = state.measureAnchor?.measureIndex ?? extractMeasureIndex(anchorId) ?? action.measureIndex;
    // Non-pointer selections have no visual staff metadata. In that case,
    // preserve the clicked staff instead of silently widening to staff zero.
    const anchorStaff = state.measureAnchor?.staffIndex ?? action.staffIndex;
    return {
      kind: "measure",
      startPartIndex: anchorPart,
      endPartIndex: action.partIndex,
      startStaffIndex: anchorStaff,
      endStaffIndex: action.staffIndex,
      ...(state.measureAnchor?.localStaffIndex !== undefined && {
        startLocalStaffIndex: state.measureAnchor.localStaffIndex,
      }),
      ...(action.localStaffIndex !== undefined && { endLocalStaffIndex: action.localStaffIndex }),
      startMeasure: anchorMeasure,
      endMeasure: action.measureIndex,
    };
  }
  // From none/multi — select the single measure
  return {
    kind: "measure",
    startPartIndex: action.partIndex,
    endPartIndex: action.partIndex,
    startStaffIndex: action.staffIndex,
    endStaffIndex: action.staffIndex,
    ...(action.localStaffIndex !== undefined && {
      startLocalStaffIndex: action.localStaffIndex,
      endLocalStaffIndex: action.localStaffIndex,
    }),
    startMeasure: action.measureIndex,
    endMeasure: action.measureIndex,
  };
}

function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "SELECT_ELEMENT": {
      // Guard: reject bare event IDs (must contain structural prefix p{}/m{})
      if (action.elementId && !action.elementId.includes("/")) {
        console.warn("[selectionStore] Rejected bare element ID (no structural prefix):", action.elementId);
        return state;
      }
      return {
        kind: "single",
        elementId: action.elementId,
        elementType: parseElementType(action.elementId),
        ...(action.measureAnchor && { measureAnchor: action.measureAnchor }),
      };
    }

    case "SELECT_RANGE":
      return {
        kind: "range",
        startElementId: action.startElementId,
        endElementId: action.endElementId,
      };

    case "EXTEND_SELECTION":
      // Guard: reject bare element IDs
      if (action.elementId && !action.elementId.includes("/")) {
        console.warn("[selectionStore] Rejected bare element ID in EXTEND_SELECTION:", action.elementId);
        return state;
      }
      return extendElementSelection(state, action);

    case "CLEAR_SELECTION":
      if (state.kind === "none") return state;
      return { kind: "none" };

    case "TOGGLE_SELECTION":
      // Guard: reject bare event IDs
      if (action.elementId && !action.elementId.includes("/")) return state;
      return toggleElementSelection(state, action);

    case "SELECT_MEASURE":
      return {
        kind: "measure",
        startPartIndex: action.partIndex,
        endPartIndex: action.partIndex,
        startStaffIndex: action.staffIndex,
        endStaffIndex: action.staffIndex,
        ...(action.localStaffIndex !== undefined && {
          startLocalStaffIndex: action.localStaffIndex,
          endLocalStaffIndex: action.localStaffIndex,
        }),
        startMeasure: action.measureIndex,
        endMeasure: action.measureIndex,
      };

    case "EXTEND_MEASURE":
      return extendMeasureSelection(state, action);

    default:
      return state;
  }
}

// --- Zustand store ---

const INITIAL_SELECTION: Selection = { kind: "none" };

interface SelectionStore {
  selection: Selection;
  _dispatch: (action: SelectionAction) => void;
}

export const useSelectionStore = create<SelectionStore>()((set) => ({
  selection: INITIAL_SELECTION,
  _dispatch: (action) =>
    set((s) => {
      const next = selectionReducer(s.selection, action);
      return next === s.selection ? s : { ...s, selection: next };
    }),
}));

/** Dispatch a selection action from outside React (commands, tests). */
function dispatchSelection(action: SelectionAction): void {
  useSelectionStore.getState()._dispatch(action);
}

/** Reset the store to its initial state (primarily for test isolation). */
export function resetSelectionStore(): void {
  useSelectionStore.setState(
    {
      selection: INITIAL_SELECTION,
      _dispatch: (action) =>
        useSelectionStore.setState((s) => {
          const next = selectionReducer(s.selection, action);
          return next === s.selection ? s : { ...s, selection: next };
        }),
    },
    true,
  );
}

// --- Action bag (stable identity, module-scoped) ---

interface SelectionActionsValue {
  selectElement: (elementId: string, measureAnchor?: MeasureSelectionPoint) => void;
  selectRange: (startElementId: string, endElementId: string) => void;
  extendSelection: (elementId: string) => void;
  toggleSelection: (elementId: string) => void;
  selectMeasure: (partIndex: number, staffIndex: number, measureIndex: number, localStaffIndex?: number) => void;
  extendMeasure: (partIndex: number, staffIndex: number, measureIndex: number, localStaffIndex?: number) => void;
  clearSelection: () => void;
}

const actions: SelectionActionsValue = {
  selectElement: (elementId, measureAnchor) =>
    dispatchSelection({ type: "SELECT_ELEMENT", elementId, ...(measureAnchor && { measureAnchor }) }),
  selectRange: (startElementId, endElementId) =>
    dispatchSelection({ type: "SELECT_RANGE", startElementId, endElementId }),
  extendSelection: (elementId) => dispatchSelection({ type: "EXTEND_SELECTION", elementId }),
  toggleSelection: (elementId) => dispatchSelection({ type: "TOGGLE_SELECTION", elementId }),
  selectMeasure: (partIndex, staffIndex, measureIndex, localStaffIndex) =>
    dispatchSelection({
      type: "SELECT_MEASURE",
      partIndex,
      staffIndex,
      measureIndex,
      ...(localStaffIndex !== undefined && { localStaffIndex }),
    }),
  extendMeasure: (partIndex, staffIndex, measureIndex, localStaffIndex) =>
    dispatchSelection({
      type: "EXTEND_MEASURE",
      partIndex,
      staffIndex,
      measureIndex,
      ...(localStaffIndex !== undefined && { localStaffIndex }),
    }),
  clearSelection: () => dispatchSelection({ type: "CLEAR_SELECTION" }),
};

// --- Hooks ---

/** Read the current selection state. */
export function useSelection(): Selection {
  return useSelectionStore((s) => s.selection);
}

/** Get selection mutation actions. Identity is stable across renders. */
export function useSelectionActions(): SelectionActionsValue {
  return actions;
}

/** Returns the element type for a single selection, or null otherwise. */
export function useSelectedElementType(): SelectableElementType | null {
  const selection = useSelection();
  return useMemo(() => (selection.kind === "single" ? selection.elementType : null), [selection]);
}

// --- Backward-compatible type aliases ---
export type SelectionState = Selection;

// --- Re-exports for testing ---
export { selectionReducer };
export type { Selection, SelectionAction, SelectableElementType };
