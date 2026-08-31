import { useCallback, useMemo } from "react";
import {
  setBarline,
  setRepeatStart,
  setRepeatEnd,
  type Barline as BarlineModel,
  type DynamicGroup,
  type NoteValueBase,
  type RehearsalMark,
  type Score,
  type ScorePatch,
  type Tempo,
  type TextExpression,
} from "@viritura/core";
import { produce } from "../../score/scoreClone";
import { useDynamicGroupHandlers, type DynamicGroupHandlers } from "./useDynamicGroupHandlers";
import {
  setAnnotationOffsetAxisInScore,
  setAnnotationAvoidCollisionsInScore,
  resetAnnotationPlacementInScore,
} from "../../score/annotationOffsetMutations";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import {
  setNoteAccidentalDisplay,
  toggleCourtesyAccidental,
  type AccidentalEnclosureSymbolValue,
} from "../../commands/noteCommands";
import { setTrillAccidental, planSetTrillAccidental } from "../../commands/articulationCommands";
import { setEventNotehead, getEventNotehead } from "../../commands/drumKitCommands";
import type { NoteheadShape } from "@viritura/core";

interface SelectionArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (s: Score) => void;
  commitPatches?: (patches: readonly ScorePatch[]) => void;
}

export interface TempoHandlers {
  isTempoSelected: boolean;
  selectedTempo: Tempo | null;
  handleTempoTextChange: (text: string) => void;
  handleTempoShowTextChange: (checked: boolean) => void;
  handleTempoShowMetronomeChange: (checked: boolean) => void;
  handleTempoBpmChange: (value: number) => void;
  handleTempoValueBaseChange: (base: NoteValueBase) => void;
  handleTempoDotsChange: (dots: number) => void;
  handleTempoOffsetChange: (axis: 0 | 1, value: number) => void;
  handleTempoOffsetReset: () => void;
  handleTempoAvoidCollisionsChange: (avoid: boolean) => void;
}

export function useTempoHandlers({ score, target, updateScore }: SelectionArgs): TempoHandlers {
  const tempoMatch = target?.elementType.match(/^tempo(\d+)$/);
  const isTempoSelected = tempoMatch !== null && tempoMatch !== undefined;

  const selectedTempo = useMemo<Tempo | null>(() => {
    if (!isTempoSelected || !score || !target) return null;
    const tempoIdx = parseInt(tempoMatch![1]!, 10);
    return score.global.measures[target.measureIndex]?.tempos?.[tempoIdx] ?? null;
  }, [isTempoSelected, score, target, tempoMatch]);

  const mutateTempo = useCallback(
    (fn: (tempo: Tempo) => void) => {
      if (!score || !target || !tempoMatch) return;
      const tempoIdx = parseInt(tempoMatch[1]!, 10);
      const nextScore = produce(score, (draft) => {
        const tempo = draft.global.measures[target.measureIndex]?.tempos?.[tempoIdx];
        if (!tempo) return;
        fn(tempo);
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, tempoMatch, updateScore],
  );

  // Manual-placement handlers delegate to the shared annotation-offset
  // mutations keyed off the selected tempo's element id.
  const handleTempoOffsetChange = useCallback(
    (axis: 0 | 1, value: number) => {
      if (!score || !target) return;
      performance.mark("viritura:input-event");
      const nextScore = setAnnotationOffsetAxisInScore(score, target.elementId, axis, value);
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, updateScore],
  );
  const handleTempoOffsetReset = useCallback(() => {
    if (!score || !target) return;
    performance.mark("viritura:input-event");
    const nextScore = resetAnnotationPlacementInScore(score, target.elementId);
    if (nextScore !== score) updateScore(nextScore);
  }, [score, target, updateScore]);
  const handleTempoAvoidCollisionsChange = useCallback(
    (avoid: boolean) => {
      if (!score || !target) return;
      performance.mark("viritura:input-event");
      const nextScore = setAnnotationAvoidCollisionsInScore(score, target.elementId, avoid);
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, updateScore],
  );

  return {
    isTempoSelected,
    selectedTempo,
    handleTempoTextChange: (text: string) => {
      performance.mark("viritura:input-event");
      mutateTempo((tempo) => {
        tempo.text = text || undefined;
      });
    },
    handleTempoShowTextChange: (checked: boolean) =>
      mutateTempo((tempo) => {
        tempo.showText = checked ? undefined : false;
      }),
    handleTempoShowMetronomeChange: (checked: boolean) =>
      mutateTempo((tempo) => {
        tempo.showMetronomeMark = checked ? undefined : false;
      }),
    handleTempoBpmChange: (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const clamped = Math.min(999, value);
      mutateTempo((tempo) => {
        tempo.bpm = clamped;
      });
    },
    handleTempoValueBaseChange: (base: NoteValueBase) =>
      mutateTempo((tempo) => {
        tempo.value = { ...tempo.value, base };
      }),
    handleTempoDotsChange: (dots: number) =>
      mutateTempo((tempo) => {
        tempo.value = { ...tempo.value, dots: dots > 0 ? dots : undefined };
      }),
    handleTempoOffsetChange,
    handleTempoOffsetReset,
    handleTempoAvoidCollisionsChange,
  };
}

export interface DirectionTextHandlers extends DynamicGroupHandlers {
  isDynamicSelected: boolean;
  selectedDynamic: DynamicGroup | null;
  isExpressionSelected: boolean;
  selectedExpression: TextExpression | null;
  handleExpressionTextChange: (text: string) => void;
  isRehearsalSelected: boolean;
  selectedRehearsal: RehearsalMark | null;
  handleRehearsalTextChange: (text: string) => void;
  /** Generic manual-placement handlers keyed off the selected element id;
   *  shared by expression, dynamic, and rehearsal sections. */
  handleAnnotationOffsetChange: (axis: 0 | 1, value: number) => void;
  handleAnnotationOffsetReset: () => void;
  handleAnnotationAvoidCollisionsChange: (avoid: boolean) => void;
}

export function useDirectionTextHandlers({ score, target, updateScore }: SelectionArgs): DirectionTextHandlers {
  const dynamicMatch = target?.elementType.match(/^(?:dyn|hairpin)(.+)$/);
  const isDynamicSelected = dynamicMatch !== null && dynamicMatch !== undefined;
  const expressionMatch = target?.elementType.match(/^expr(\d+)$/);
  const isExpressionSelected = expressionMatch !== null && expressionMatch !== undefined;
  const isRehearsalSelected = target?.elementType === "rehearsal";

  const selectedDynamic = useMemo<DynamicGroup | null>(() => {
    if (!isDynamicSelected || !score || !target) return null;
    const groupId = dynamicMatch![1]!;
    return (
      score.parts[target.partIndex]?.measures[target.measureIndex]?.dynamics?.find((group) => group.id === groupId) ??
      null
    );
  }, [isDynamicSelected, score, target, dynamicMatch]);

  const selectedExpression = useMemo<TextExpression | null>(() => {
    if (!isExpressionSelected || !score || !target) return null;
    const idx = parseInt(expressionMatch![1]!, 10);
    return score.parts[target.partIndex]?.measures[target.measureIndex]?.expressions?.[idx] ?? null;
  }, [isExpressionSelected, score, target, expressionMatch]);

  const selectedRehearsal = useMemo<RehearsalMark | null>(() => {
    if (!isRehearsalSelected || !score || !target) return null;
    return score.global.measures[target.measureIndex]?.rehearsalMark ?? null;
  }, [isRehearsalSelected, score, target]);

  const updateSelectedDynamic = useCallback(
    (update: (dynamic: DynamicGroup) => void) => {
      if (!score || !target || !dynamicMatch) return;
      performance.mark("viritura:input-event");
      const groupId = dynamicMatch[1]!;
      const nextScore = produce(score, (draft) => {
        const dynamic = draft.parts[target.partIndex]?.measures[target.measureIndex]?.dynamics?.find(
          (group) => group.id === groupId,
        );
        if (dynamic) update(dynamic as DynamicGroup);
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, dynamicMatch, updateScore],
  );

  const dynamicHandlers = useDynamicGroupHandlers(updateSelectedDynamic);

  const handleExpressionTextChange = useCallback(
    (text: string) => {
      if (!score || !target || !expressionMatch) return;
      performance.mark("viritura:input-event");
      const idx = parseInt(expressionMatch[1]!, 10);
      const nextScore = produce(score, (draft) => {
        const expression = draft.parts[target.partIndex]?.measures[target.measureIndex]?.expressions?.[idx];
        if (!expression) return;
        expression.text = text;
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, expressionMatch, updateScore],
  );

  // Manual-placement handlers are generic across every movable annotation
  // (expression, dynamic, tempo, rehearsal); they key off the selected element
  // id and delegate to the shared annotation-offset mutations.
  const handleAnnotationOffsetChange = useCallback(
    (axis: 0 | 1, value: number) => {
      if (!score || !target) return;
      performance.mark("viritura:input-event");
      const nextScore = setAnnotationOffsetAxisInScore(score, target.elementId, axis, value);
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, updateScore],
  );

  const handleAnnotationOffsetReset = useCallback(() => {
    if (!score || !target) return;
    performance.mark("viritura:input-event");
    const nextScore = resetAnnotationPlacementInScore(score, target.elementId);
    if (nextScore !== score) updateScore(nextScore);
  }, [score, target, updateScore]);

  const handleAnnotationAvoidCollisionsChange = useCallback(
    (avoid: boolean) => {
      if (!score || !target) return;
      performance.mark("viritura:input-event");
      const nextScore = setAnnotationAvoidCollisionsInScore(score, target.elementId, avoid);
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, updateScore],
  );

  const handleRehearsalTextChange = useCallback(
    (text: string) => {
      if (!score || !target || !isRehearsalSelected) return;
      performance.mark("viritura:input-event");
      const nextScore = produce(score, (draft) => {
        const mark = draft.global.measures[target.measureIndex]?.rehearsalMark;
        if (!mark) return;
        mark.text = text;
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, isRehearsalSelected, updateScore],
  );

  return {
    isDynamicSelected,
    selectedDynamic,
    ...dynamicHandlers,
    isExpressionSelected,
    selectedExpression,
    handleExpressionTextChange,
    isRehearsalSelected,
    selectedRehearsal,
    handleRehearsalTextChange,
    handleAnnotationOffsetChange,
    handleAnnotationOffsetReset,
    handleAnnotationAvoidCollisionsChange,
  };
}

export interface BarlineHandlers {
  currentBarlineType: string;
  hasRepeatStart: boolean;
  hasRepeatEnd: boolean;
  repeatEndTimes: number;
  handleBarlineTypeChange: (type: string) => void;
  handleToggleRepeatStart: () => void;
  handleToggleRepeatEnd: () => void;
  handleRepeatEndTimesChange: (times: number) => void;
}

export function useBarlineHandlers(
  { score, target, updateScore }: SelectionArgs,
  isBarlineSelected: boolean,
): BarlineHandlers {
  const barlineRawMeasureIdx = useMemo(() => {
    if (!isBarlineSelected || !target) return null;
    return target.measureIndex;
  }, [isBarlineSelected, target]);
  const barlinePropertyIdx = barlineRawMeasureIdx != null ? Math.max(0, barlineRawMeasureIdx - 1) : null;
  const repeatStartIdx = barlineRawMeasureIdx;
  const repeatEndIdx = barlinePropertyIdx;

  const currentBarlineType = useMemo(() => {
    if (barlinePropertyIdx == null || !score) return "regular";
    return score.global.measures[barlinePropertyIdx]?.barline?.type ?? "regular";
  }, [barlinePropertyIdx, score]);
  const hasRepeatStart = useMemo(() => {
    if (repeatStartIdx == null || !score) return false;
    return !!score.global.measures[repeatStartIdx]?.repeatStart;
  }, [repeatStartIdx, score]);
  const hasRepeatEnd = useMemo(() => {
    if (repeatEndIdx == null || !score) return false;
    return !!score.global.measures[repeatEndIdx]?.repeatEnd;
  }, [repeatEndIdx, score]);
  const repeatEndTimes = useMemo(() => {
    if (repeatEndIdx == null || !score) return 2;
    return score.global.measures[repeatEndIdx]?.repeatEnd?.times ?? 2;
  }, [repeatEndIdx, score]);

  const handleBarlineTypeChange = useCallback(
    (type: string) => {
      if (barlinePropertyIdx == null || !score) return;
      updateScore(setBarline(score, barlinePropertyIdx, { type } as BarlineModel));
    },
    [barlinePropertyIdx, score, updateScore],
  );
  const handleToggleRepeatStart = useCallback(() => {
    if (repeatStartIdx == null || !score) return;
    updateScore(setRepeatStart(score, repeatStartIdx, hasRepeatStart ? null : {}));
  }, [repeatStartIdx, score, hasRepeatStart, updateScore]);
  const handleToggleRepeatEnd = useCallback(() => {
    if (repeatEndIdx == null || !score) return;
    updateScore(setRepeatEnd(score, repeatEndIdx, hasRepeatEnd ? null : {}));
  }, [repeatEndIdx, score, hasRepeatEnd, updateScore]);
  const handleRepeatEndTimesChange = useCallback(
    (times: number) => {
      if (repeatEndIdx == null || !score) return;
      const clamped = Math.max(2, Math.min(32, times));
      updateScore(setRepeatEnd(score, repeatEndIdx, clamped === 2 ? {} : { times: clamped }));
    },
    [repeatEndIdx, score, updateScore],
  );

  return {
    currentBarlineType,
    hasRepeatStart,
    hasRepeatEnd,
    repeatEndTimes,
    handleBarlineTypeChange,
    handleToggleRepeatStart,
    handleToggleRepeatEnd,
    handleRepeatEndTimesChange,
  };
}

export interface AccidentalAndTrillHandlers {
  handleAccidentalDisplayShow: () => void;
  handleCourtesyAccidental: () => void;
  handleAccidentalEnclosure: (symbol: AccidentalEnclosureSymbolValue) => () => void;
  handleTrillAccidentalChange: (accidental: -1 | 0 | 1 | null) => () => void;
}

function accidentalTargetParams(target: NotationSelectionTarget) {
  return {
    partIndex: target.partIndex,
    measureIndex: target.measureIndex,
    sequenceIndex: target.sequenceIndex!,
    eventIndex: target.eventIndex!,
    tupletIndex: target.tupletIndex,
    noteIndex: target.noteIndex,
  };
}

function accidentalTargetNote(score: Score, target: NotationSelectionTarget) {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) return null;
  const sequence = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
  if (!sequence) return null;
  const container = target.tupletIndex === undefined ? null : sequence.content[target.tupletIndex];
  const event =
    container?.type === "tuplet" ? container.content[target.eventIndex] : sequence.content[target.eventIndex];
  if (!event || event.type !== "event" || !event.notes?.length) return null;
  return event.notes[target.noteIndex ?? 0] ?? null;
}

export function useAccidentalAndTrillHandlers({
  score,
  target,
  updateScore,
  commitPatches,
}: SelectionArgs): AccidentalAndTrillHandlers {
  const handleAccidentalDisplayShow = useCallback(() => {
    if (!score || !target || target.sequenceIndex === undefined || target.eventIndex === undefined) return;
    const note = accidentalTargetNote(score, target);
    if (!note) return;
    const nextScore = produce(score, (draft) => {
      setNoteAccidentalDisplay(draft, {
        ...accidentalTargetParams(target),
        show: !(note.accidentalDisplay?.show ?? false),
      });
    });
    if (nextScore !== score) updateScore(nextScore);
  }, [score, target, updateScore]);

  const handleCourtesyAccidental = useCallback(() => {
    if (!score || !target || target.sequenceIndex === undefined || target.eventIndex === undefined) return;
    const nextScore = produce(score, (draft) => {
      toggleCourtesyAccidental(draft, accidentalTargetParams(target));
    });
    if (nextScore !== score) updateScore(nextScore);
  }, [score, target, updateScore]);

  const handleAccidentalEnclosure = useCallback(
    (symbol: AccidentalEnclosureSymbolValue) => () => {
      if (!score || !target || target.sequenceIndex === undefined || target.eventIndex === undefined) return;
      const note = accidentalTargetNote(score, target);
      if (!note) return;
      const nextScore = produce(score, (draft) => {
        setNoteAccidentalDisplay(draft, {
          ...accidentalTargetParams(target),
          enclosureSymbol: note.accidentalDisplay?.enclosure?.symbol === symbol ? null : symbol,
        });
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, updateScore],
  );

  const handleTrillAccidentalChange = useCallback(
    (accidental: -1 | 0 | 1 | null) => () => {
      if (!score || !target || target.sequenceIndex === undefined || target.eventIndex === undefined) return;
      const { partIndex, measureIndex, sequenceIndex, eventIndex } = target;
      // Fast path: dispatch via patches when commitPatches is wired and the
      // planner resolves. Falls back to the slow mutator otherwise.
      if (commitPatches) {
        const patches = planSetTrillAccidental(score, partIndex, measureIndex, sequenceIndex, eventIndex, accidental);
        if (patches && patches.length > 0) {
          commitPatches(patches);
          return;
        }
      }
      const nextScore = produce(score, (draft) => {
        setTrillAccidental(draft, partIndex, measureIndex, sequenceIndex, eventIndex, accidental);
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [score, target, updateScore, commitPatches],
  );

  return {
    handleAccidentalDisplayShow,
    handleCourtesyAccidental,
    handleAccidentalEnclosure,
    handleTrillAccidentalChange,
  };
}

export interface NoteheadHandler {
  /** Current notehead of the selected event, or null when no event is selected. */
  notehead: NoteheadShape | null;
  handleNoteheadChange: (shape: NoteheadShape) => void;
}

export function useNoteheadHandler({ score, target, updateScore }: SelectionArgs): NoteheadHandler {
  const notehead = useMemo<NoteheadShape | null>(() => {
    if (!score || !target || target.sequenceIndex === undefined || target.eventIndex === undefined) return null;
    return getEventNotehead(score, {
      partIndex: target.partIndex,
      measureIndex: target.measureIndex,
      sequenceIndex: target.sequenceIndex,
      eventIndex: target.eventIndex,
      tupletIndex: target.tupletIndex,
    });
  }, [score, target]);

  const handleNoteheadChange = useCallback(
    (shape: NoteheadShape) => {
      if (!score || !target || target.sequenceIndex === undefined || target.eventIndex === undefined) return;
      const result = setEventNotehead(score, {
        partIndex: target.partIndex,
        measureIndex: target.measureIndex,
        sequenceIndex: target.sequenceIndex,
        eventIndex: target.eventIndex,
        tupletIndex: target.tupletIndex,
        notehead: shape,
      });
      if (result && result !== score) updateScore(result);
    },
    [score, target, updateScore],
  );

  return { notehead, handleNoteheadChange };
}
