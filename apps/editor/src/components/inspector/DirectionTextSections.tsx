import type { Score } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { useDirectionTextHandlers } from "./useNotationInspectorActions";
import { DirectionTextSection } from "./DirectionTextSection";
import { DynamicGroupSection } from "./DynamicGroupSection";
import { OttavaInspector } from "./OttavaInspector";
import { ChordSymbolSection } from "./ChordSymbolSection";
import { useChordSymbolInspector } from "./useChordSymbolInspector";

export interface DirectionTextSectionsProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

/** Renders the property section for a selected direction. */
export function DirectionTextSections({ score, target, updateScore }: DirectionTextSectionsProps) {
  const staffCount = target ? (score?.parts[target.partIndex]?.staves ?? 1) : 1;
  const targetSequences = target ? score?.parts[target.partIndex]?.measures[target.measureIndex]?.sequences : undefined;
  const voiceOptions = Array.from(
    new Set(
      (targetSequences ?? [])
        .map((sequence, index, sequences) => sequence.voice ?? (sequences.length > 1 ? `v${index + 1}` : ""))
        .filter(Boolean),
    ),
  );
  const {
    isDynamicSelected,
    selectedDynamic,
    handleDynamicValueChange,
    handleDynamicResidualValueChange,
    handleDynamicAccentPrefixChange,
    handleDynamicAccentSuffixChange,
    handleDynamicRelativeValueChange,
    handleDynamicWedgeTypeChange,
    handleDynamicPrefixChange,
    handleDynamicSuffixChange,
    handleDynamicOrientationChange,
    handleDynamicStaffChange,
    handleDynamicStaffEndChange,
    handleDynamicVisuallyContinuesChange,
    handleDynamicVoiceChange,
    isExpressionSelected,
    selectedExpression,
    handleExpressionTextChange,
    isRehearsalSelected,
    selectedRehearsal,
    handleRehearsalTextChange,
    handleAnnotationOffsetChange,
    handleAnnotationOffsetReset,
    handleAnnotationAvoidCollisionsChange,
  } = useDirectionTextHandlers({ score, target, updateScore });
  const chordSymbol = useChordSymbolInspector({ score, target, updateScore });

  return (
    <>
      {isDynamicSelected && selectedDynamic && (
        <DynamicGroupSection
          dynamic={selectedDynamic}
          staffCount={staffCount}
          voiceOptions={voiceOptions}
          onValueChange={handleDynamicValueChange}
          onResidualValueChange={handleDynamicResidualValueChange}
          onAccentPrefixChange={handleDynamicAccentPrefixChange}
          onAccentSuffixChange={handleDynamicAccentSuffixChange}
          onRelativeValueChange={handleDynamicRelativeValueChange}
          onWedgeTypeChange={handleDynamicWedgeTypeChange}
          onPrefixChange={handleDynamicPrefixChange}
          onSuffixChange={handleDynamicSuffixChange}
          onOrientationChange={handleDynamicOrientationChange}
          onStaffChange={handleDynamicStaffChange}
          onStaffEndChange={handleDynamicStaffEndChange}
          onVisuallyContinuesChange={handleDynamicVisuallyContinuesChange}
          onVoiceChange={handleDynamicVoiceChange}
          offset={{
            value: selectedDynamic.manualOffset ?? [0, 0],
            onChange: handleAnnotationOffsetChange,
            onReset: handleAnnotationOffsetReset,
            avoidCollisions: {
              value: selectedDynamic.avoidCollisions ?? true,
              onChange: handleAnnotationAvoidCollisionsChange,
            },
          }}
        />
      )}

      {isExpressionSelected && selectedExpression && (
        <DirectionTextSection
          title="Expression"
          label="Text"
          value={selectedExpression.text}
          placeholder="e.g. dolce, espressivo, rit."
          onChange={handleExpressionTextChange}
          offset={{
            value: selectedExpression.manualOffset ?? [0, 0],
            onChange: handleAnnotationOffsetChange,
            onReset: handleAnnotationOffsetReset,
            avoidCollisions: {
              value: selectedExpression.avoidCollisions ?? true,
              onChange: handleAnnotationAvoidCollisionsChange,
            },
          }}
        />
      )}

      {isRehearsalSelected && selectedRehearsal && (
        <DirectionTextSection
          title="Rehearsal Mark"
          label="Text"
          value={selectedRehearsal.text}
          placeholder="e.g. A, B, Verse"
          onChange={handleRehearsalTextChange}
          offset={{
            value: selectedRehearsal.manualOffset ?? [0, 0],
            onChange: handleAnnotationOffsetChange,
            onReset: handleAnnotationOffsetReset,
            avoidCollisions: {
              value: selectedRehearsal.avoidCollisions ?? true,
              onChange: handleAnnotationAvoidCollisionsChange,
            },
          }}
        />
      )}
      {chordSymbol.chord && (
        <ChordSymbolSection
          chord={chordSymbol.chord}
          staffCount={staffCount}
          onRootStepChange={chordSymbol.setRootStep}
          onRootAlterChange={chordSymbol.setRootAlter}
          onQualityChange={chordSymbol.setQuality}
          onKindTextChange={chordSymbol.setKindText}
          onExtensionChange={chordSymbol.setExtension}
          onBassStepChange={chordSymbol.setBassStep}
          onBassAlterChange={chordSymbol.setBassAlter}
          onDisplayStaffChange={chordSymbol.setDisplayStaff}
          onTextOverrideChange={chordSymbol.setTextOverride}
        />
      )}
      <OttavaInspector score={score} target={target} updateScore={updateScore} />
    </>
  );
}
