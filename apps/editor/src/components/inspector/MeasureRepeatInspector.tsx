import type { Score } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { MeasureRepeatSection } from "./BarlineSections";
import type { InspectorSection } from "./notationInspectorMeta";
import { useMeasureRepeatHandlers } from "./useNotationInspectorActions";

export interface MeasureRepeatInspectorProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  focusedSection: InspectorSection | null;
  updateScore: (score: Score) => void;
}

export function MeasureRepeatInspector({ score, target, focusedSection, updateScore }: MeasureRepeatInspectorProps) {
  const {
    isMeasureRepeatSelected,
    selectedMeasureRepeat,
    handleDisplayNumberChange,
    handleCounterEnabledChange,
    handleCounterCountChange,
    handleCounterOrientChange,
  } = useMeasureRepeatHandlers({ score, target, updateScore });

  if (!isMeasureRepeatSelected || !selectedMeasureRepeat) return null;
  return (
    <MeasureRepeatSection
      repeat={selectedMeasureRepeat}
      focusedSection={focusedSection}
      onDisplayNumberChange={handleDisplayNumberChange}
      onCounterEnabledChange={handleCounterEnabledChange}
      onCounterCountChange={handleCounterCountChange}
      onCounterOrientChange={handleCounterOrientChange}
    />
  );
}
