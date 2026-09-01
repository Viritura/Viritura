import { Select } from "@viritura/ui";
import type { ScoreViewerScoreOption } from "@viritura/score-viewer-react";

interface PlaygroundScoreSelectProps {
  readonly scoreIndex: number;
  readonly onScoreIndexChange: (value: number) => void;
  readonly scoreOptions: readonly ScoreViewerScoreOption[];
}

export function PlaygroundScoreSelect({ scoreIndex, onScoreIndexChange, scoreOptions }: PlaygroundScoreSelectProps) {
  if (scoreOptions.length <= 1) return null;
  return (
    <Select
      aria-label="Score or part"
      className="mnx-playground__score-select"
      value={String(scoreIndex)}
      onValueChange={(value) => onScoreIndexChange(Number(value))}
      options={scoreOptions.map((score) => ({ value: String(score.index), label: score.label }))}
    />
  );
}
