import type { Score } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { useDirectionTextHandlers } from "./useNotationInspectorActions";
import { DirectionTextSection } from "./DirectionTextSection";
import { inheritedStyleForExpression } from "./TextContentEditor";
import { SelectedMarkerTextSection } from "./MarkerTextSection";
import { DynamicGroupSection } from "./DynamicGroupSection";
import { OttavaInspector } from "./OttavaInspector";
import { ChordSymbolSection } from "./ChordSymbolSection";
import { useChordSymbolInspector } from "./useChordSymbolInspector";
import { ChordSymbolEntryAction } from "./ChordSymbolEntryAction";
import { StaffTextFrameFields, StaffTextPositioningField } from "../textFrames";

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
    handleDynamicPlacementChange,
    handleDynamicStaffChange,
    handleDynamicStaffEndChange,
    handleDynamicVisuallyContinuesChange,
    handleDynamicVoiceChange,
    isExpressionSelected,
    selectedExpression,
    handleExpressionTextChange,
    handleExpressionFrameChange,
    isRehearsalSelected,
    selectedRehearsal,
    handleRehearsalTextChange,
    selectedMarker,
    handleMarkerTextChange,
    handleAnnotationOffsetChange,
    handleAnnotationOffsetReset,
    handleAnnotationAvoidCollisionsChange,
  } = useDirectionTextHandlers({ score, target, updateScore });
  const chordSymbol = useChordSymbolInspector({ score, target, updateScore });

  return (
    <>
      {!chordSymbol.chord && <ChordSymbolEntryAction score={score} />}
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
          onPlacementChange={handleDynamicPlacementChange}
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
        <>
          <DirectionTextSection
            title="Expression"
            multiline
            label="Text"
            value={selectedExpression.text}
            placeholder="e.g. dolce, espressivo, rit."
            onChange={handleExpressionTextChange}
            inheritedStyle={inheritedStyleForExpression(selectedExpression.placement)}
            positioning={<StaffTextPositioningField score={score} target={target} updateScore={updateScore} />}
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
          <StaffTextFrameFields
            key={target?.elementId}
            id="staff-text-frame"
            value={selectedExpression.frame}
            onChange={handleExpressionFrameChange}
          />
        </>
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
      <SelectedMarkerTextSection marker={selectedMarker} onChange={handleMarkerTextChange} />
      {chordSymbol.chord && (
        <ChordSymbolSection
          key={chordSymbol.editorKey}
          chord={chordSymbol.chord}
          sourcePart={chordSymbol.sourcePart}
          onTextChange={chordSymbol.setText}
          onRootStepChange={chordSymbol.setRootStep}
          onRootAlterChange={chordSymbol.setRootAlter}
          onQualityChange={chordSymbol.setQuality}
          onKindTextChange={chordSymbol.setKindText}
          onExtensionChange={chordSymbol.setExtension}
          onBassStepChange={chordSymbol.setBassStep}
          onBassAlterChange={chordSymbol.setBassAlter}
          onVisibilityChange={chordSymbol.setVisibility}
          onTextOverrideChange={chordSymbol.setTextOverride}
        />
      )}
      <OttavaInspector score={score} target={target} updateScore={updateScore} />
    </>
  );
}
