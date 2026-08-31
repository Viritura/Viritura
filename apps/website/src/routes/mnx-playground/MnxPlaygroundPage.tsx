import { useRef, useState } from "react";
import Editor, { type OnValidate } from "@monaco-editor/react";
import { StatusBar, Tabs, Text } from "@viritura/ui";
import { ScoreViewer, type ScoreViewerScoreOption } from "@viritura/score-viewer-react";
import { pagePresets, staffSizes, type PagePresetId, type PlaygroundViewMode } from "./playgroundLayout";
import { PlaygroundStatusControls } from "./PlaygroundStatusControls";
import {
  configurePlaygroundEditor,
  downloadMnxSource,
  formatMnxSource,
  PLAYGROUND_MODEL_PATH,
} from "./playgroundEditor";
import { findPlaygroundDocument, playgroundDocuments } from "./playgroundDocuments";
import { usePlaygroundDocument } from "./usePlaygroundDocument";
import "./mnxPlayground.css";

type MobilePane = "editor" | "preview";

function scoreOptions(document: object): readonly ScoreViewerScoreOption[] {
  const scores = (document as { readonly scores?: readonly unknown[] }).scores;
  if (!Array.isArray(scores)) return [];
  return scores.map((score, index) => {
    const record = typeof score === "object" && score !== null ? (score as Record<string, unknown>) : {};
    const label = [record.name, record.label, record.title, record.id].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return { index, label: label?.trim() ?? `Score ${index + 1}` };
  });
}

export function MnxPlaygroundPage() {
  const [exampleId, setExampleId] = useState(playgroundDocuments[0]!.id);
  const [mobilePane, setMobilePane] = useState<MobilePane>("editor");
  const [viewMode, setViewMode] = useState<PlaygroundViewMode>("horizon");
  const [pagePresetId, setPagePresetId] = useState<PagePresetId>("a4");
  const [staffSizeId, setStaffSizeId] = useState("medium");
  const [scoreIndex, setScoreIndex] = useState(0);
  const [markerCount, setMarkerCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedExample = findPlaygroundDocument(exampleId);
  const playground = usePlaygroundDocument(selectedExample.source);
  const availableScores = scoreOptions(playground.renderedDocument);
  const pagePreset = pagePresets[pagePresetId];
  const pageMargin = pagePreset.margin;
  const pageMargins = { top: pageMargin, right: pageMargin, bottom: pageMargin, left: pageMargin };
  const pageWidth = viewMode === "horizon" ? 0 : pagePreset.width;
  const pageHeight = viewMode === "horizon" ? 0 : pagePreset.height;
  const viewerMode = viewMode === "horizon" ? "horizontal" : "page";
  const spatium = staffSizes[staffSizeId] ?? staffSizes.medium;

  const chooseExample = (id: string) => {
    const example = findPlaygroundDocument(id);
    setExampleId(example.id);
    setScoreIndex(0);
    playground.setSource(example.source);
  };

  const handleFormat = () => {
    try {
      playground.setSource(formatMnxSource(playground.source));
    } catch {
      // Monaco and the accessible status surface already report the syntax error.
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    playground.setSource(await file.text());
    setExampleId(playgroundDocuments[0]!.id);
    setScoreIndex(0);
  };

  const handleValidate: OnValidate = (markers) => setMarkerCount(markers.length);

  return (
    <div className="mnx-playground">
      <div className="mnx-playground__heading">
        <div>
          <Text as="p" variant="eyebrow" tone="muted">
            MNX Playground
          </Text>
          <Text as="h1" variant="title">
            Edit MNX and inspect the engraving
          </Text>
        </div>
        <Text as="p" variant="body" tone="muted">
          {selectedExample.description}
        </Text>
      </div>

      <div className="mnx-playground__mobile-tabs">
        <Tabs
          tabs={[
            { id: "editor", label: "Editor" },
            { id: "preview", label: "Preview" },
          ]}
          activeTab={mobilePane}
          onTabChange={(id) => setMobilePane(id as MobilePane)}
        >
          <div className="mnx-playground__workspace">
            <section
              className="mnx-playground__pane mnx-playground__editor"
              data-mobile-active={mobilePane === "editor"}
              aria-label="MNX JSON editor"
            >
              <Editor
                path={PLAYGROUND_MODEL_PATH}
                language="json"
                value={playground.source}
                beforeMount={configurePlaygroundEditor}
                onChange={(value) => playground.setSource(value ?? "")}
                onValidate={handleValidate}
                theme="vs"
                options={{
                  automaticLayout: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  tabSize: 2,
                  insertSpaces: true,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
              />
            </section>

            <section
              className="mnx-playground__pane mnx-playground__preview"
              data-mobile-active={mobilePane === "preview"}
              aria-label="Live score preview"
            >
              <ScoreViewer
                mnx={playground.renderedDocument}
                scoreIndex={scoreIndex}
                onScoreIndexChange={setScoreIndex}
                scoreOptions={availableScores}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                pageMargins={pageMargins}
                spatium={spatium}
                viewMode={viewerMode}
                controls={{ score: false, viewMode: false, zoom: true, fit: true }}
                defaultFitMode="width"
                controlSurface="floating-status"
                onError={playground.rejectCandidate}
              />
              {playground.candidateDocument ? (
                <div className="mnx-playground__candidate" aria-hidden="true">
                  <ScoreViewer
                    mnx={playground.candidateDocument}
                    scoreIndex={scoreIndex}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                    pageMargins={pageMargins}
                    spatium={spatium}
                    viewMode={viewerMode}
                    controls={false}
                    onReady={playground.acceptCandidate}
                    onError={playground.rejectCandidate}
                  />
                </div>
              ) : null}
            </section>
          </div>
        </Tabs>
      </div>

      <div className="mnx-playground__status-wrap">
        <StatusBar
          ariaLabel="MNX playground status and actions"
          left={
            <span className="mnx-playground__status-message" aria-live="polite" data-error={playground.hasError}>
              {playground.hasError ? "Error: " : ""}
              {playground.status}
              {markerCount > 0 ? ` (${markerCount} editor diagnostic${markerCount === 1 ? "" : "s"})` : ""}
            </span>
          }
          right={
            <PlaygroundStatusControls
              exampleId={exampleId}
              onExampleChange={chooseExample}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              pagePresetId={pagePresetId}
              onPagePresetChange={setPagePresetId}
              staffSizeId={staffSizeId}
              onStaffSizeChange={setStaffSizeId}
              scoreIndex={scoreIndex}
              onScoreIndexChange={setScoreIndex}
              scoreOptions={availableScores}
              onFormat={handleFormat}
              onReset={() => playground.setSource(selectedExample.source)}
              onUpload={() => fileInputRef.current?.click()}
              onDownload={() => downloadMnxSource(playground.source, `${exampleId}.mnx`)}
            />
          }
        />
        <input
          ref={fileInputRef}
          className="mnx-playground__file-input"
          type="file"
          accept=".mnx,application/json,application/mnx+json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void handleUpload(file);
          }}
        />
      </div>
    </div>
  );
}
