import { Button, StatusSelect } from "@viritura/ui";
import type { ScoreViewerScoreOption } from "@viritura/score-viewer-react";
import { playgroundDocuments } from "./playgroundDocuments";
import type { PagePresetId, PlaygroundViewMode } from "./playgroundLayout";

interface PlaygroundStatusControlsProps {
  readonly exampleId: string;
  readonly onExampleChange: (value: string) => void;
  readonly viewMode: PlaygroundViewMode;
  readonly onViewModeChange: (value: PlaygroundViewMode) => void;
  readonly pagePresetId: PagePresetId;
  readonly onPagePresetChange: (value: PagePresetId) => void;
  readonly staffSizeId: string;
  readonly onStaffSizeChange: (value: string) => void;
  readonly scoreIndex: number;
  readonly onScoreIndexChange: (value: number) => void;
  readonly scoreOptions: readonly ScoreViewerScoreOption[];
  readonly onFormat: () => void;
  readonly onReset: () => void;
  readonly onUpload: () => void;
  readonly onDownload: () => void;
}

export function PlaygroundStatusControls({
  exampleId,
  onExampleChange,
  viewMode,
  onViewModeChange,
  pagePresetId,
  onPagePresetChange,
  staffSizeId,
  onStaffSizeChange,
  scoreIndex,
  onScoreIndexChange,
  scoreOptions,
  onFormat,
  onReset,
  onUpload,
  onDownload,
}: PlaygroundStatusControlsProps) {
  return (
    <div className="mnx-playground__controls">
      <div className="mnx-playground__selectors">
        <StatusSelect
          ariaLabel="Example document"
          value={exampleId}
          onChange={onExampleChange}
          options={playgroundDocuments.map((document) => ({ value: document.id, label: document.title }))}
        />
        <StatusSelect
          ariaLabel="Preview view"
          value={viewMode}
          onChange={(value) => onViewModeChange(value as PlaygroundViewMode)}
          options={[
            { value: "horizon", label: "Horizon" },
            { value: "page", label: "Page" },
          ]}
        />
        {viewMode === "page" ? (
          <>
            <StatusSelect
              ariaLabel="Page size"
              value={pagePresetId}
              onChange={(value) => onPagePresetChange(value as PagePresetId)}
              options={[
                { value: "a4", label: "A4" },
                { value: "letter", label: "Letter" },
              ]}
            />
            <StatusSelect
              ariaLabel="Staff size"
              value={staffSizeId}
              onChange={onStaffSizeChange}
              options={[
                { value: "small", label: "Small staff" },
                { value: "medium", label: "Medium staff" },
                { value: "large", label: "Large staff" },
              ]}
            />
          </>
        ) : null}
        {scoreOptions.length > 1 ? (
          <StatusSelect
            ariaLabel="Score layout"
            value={String(scoreIndex)}
            onChange={(value) => onScoreIndexChange(Number(value))}
            options={scoreOptions.map((score) => ({ value: String(score.index), label: score.label }))}
          />
        ) : null}
      </div>
      <div className="mnx-playground__actions">
        <Button size="sm" variant="ghost" onClick={onFormat}>
          Format
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset}>
          Reset
        </Button>
        <Button size="sm" variant="ghost" onClick={onUpload}>
          Upload
        </Button>
        <Button size="sm" variant="ghost" onClick={onDownload}>
          Download
        </Button>
      </div>
    </div>
  );
}
