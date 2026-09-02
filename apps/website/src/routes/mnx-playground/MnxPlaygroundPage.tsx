import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Editor, type OnValidate } from "@viritura/monaco-react";
import { Tabs } from "@viritura/ui";
import { ScoreViewer, type ScoreViewerScoreOption } from "@viritura/score-viewer-react";
import { PlaygroundExampleBrowser } from "./PlaygroundExampleBrowser";
import { PlaygroundScoreSelect } from "./PlaygroundScoreSelect";
import { configurePlaygroundEditor, PLAYGROUND_MODEL_PATH } from "./playgroundEditor";
import { playgroundDocuments } from "./playgroundDocuments";
import { findPlaygroundCatalogItem, loadPlaygroundCatalogItem } from "./playgroundCatalog";
import { exampleIdFromHash, hashForExampleId } from "./playgroundHash";
import { usePlaygroundDocument } from "./usePlaygroundDocument";
import "./mnxPlayground.css";

type MobilePane = "examples" | "editor" | "preview";

function useHashChange(onHashChange: () => void): void {
  const handleHashChange = useEffectEvent(onHashChange);
  useEffect(() => {
    const timeout = window.setTimeout(handleHashChange, 0);
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);
}

function scoreOptions(document: object): readonly ScoreViewerScoreOption[] {
  const scores = (document as { readonly scores?: readonly unknown[] }).scores;
  if (!Array.isArray(scores)) return [];
  return scores.map((score, index) => {
    const record = typeof score === "object" && score !== null ? (score as Record<string, unknown>) : {};
    const label = [record.name, record.label, record.title, record.id].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    const displayLabel = label?.trim().replace(/([a-z])([A-Z])/g, "$1 $2");
    return { index, label: displayLabel ?? `Score ${index + 1}` };
  });
}

function validationLabel(markerCount: number): string {
  return markerCount === 0 ? "Valid MNX" : `${markerCount} validation error${markerCount === 1 ? "" : "s"}`;
}

function EditorValidity({ markerCount }: { readonly markerCount: number }) {
  return (
    <div className="mnx-playground__editor-header">
      <span>MNX Source</span>
      <span className="mnx-playground__validity" data-valid={markerCount === 0}>
        {validationLabel(markerCount)}
      </span>
    </div>
  );
}

export function MnxPlaygroundPage() {
  const [exampleId, setExampleId] = useState(playgroundDocuments[0]!.id);
  const [mobilePane, setMobilePane] = useState<MobilePane>("editor");
  const [scoreIndex, setScoreIndex] = useState(0);
  const [markerCount, setMarkerCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewLoadingLabel, setPreviewLoadingLabel] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const pendingScoreIndexRef = useRef<number | null>(null);
  const previousDocumentRef = useRef<object | null>(null);
  const playground = usePlaygroundDocument(playgroundDocuments[0]!.source);
  const availableScores = scoreOptions(playground.renderedDocument);

  const replaceExampleHash = (id: string) => {
    const url = new URL(window.location.href);
    url.hash = hashForExampleId(id);
    window.history.replaceState(window.history.state, "", url);
  };

  const chooseExample = async (id: string, updateHash = true) => {
    const request = ++loadRequestRef.current;
    const example = findPlaygroundCatalogItem(id);
    if (updateHash) replaceExampleHash(example.id);
    setExampleId(example.id);
    setScoreIndex(0);
    setLoadError(null);
    pendingScoreIndexRef.current = null;
    previousDocumentRef.current = playground.renderedDocument;
    setPreviewLoadingLabel(`Loading ${example.title}...`);
    try {
      const source = await loadPlaygroundCatalogItem(example);
      if (request !== loadRequestRef.current) return;
      playground.setSource(source);
      setMobilePane("editor");
    } catch (error) {
      if (request !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : `Unable to load ${example.title}`);
      previousDocumentRef.current = null;
      setPreviewLoadingLabel(null);
    }
  };

  useHashChange(() => {
    const id = exampleIdFromHash(window.location.hash);
    if (window.location.hash !== hashForExampleId(id)) replaceExampleHash(id);
    if (id !== exampleId) void chooseExample(id, false);
  });

  const handleValidate: OnValidate = (markers) => setMarkerCount(markers.length);
  const chooseScore = (nextScoreIndex: number) => {
    if (nextScoreIndex === scoreIndex) return;
    pendingScoreIndexRef.current = nextScoreIndex;
    previousDocumentRef.current = null;
    setPreviewLoadingLabel("Engraving layout...");
    window.setTimeout(() => setScoreIndex(nextScoreIndex), 16);
  };
  const handleScorePaint = () => {
    if (pendingScoreIndexRef.current !== null && pendingScoreIndexRef.current !== scoreIndex) return;
    if (previousDocumentRef.current !== null && previousDocumentRef.current === playground.renderedDocument) return;
    pendingScoreIndexRef.current = null;
    previousDocumentRef.current = null;
    setPreviewLoadingLabel(null);
  };

  return (
    <div className="mnx-playground">
      <span className="visually-hidden" aria-live="polite">
        {playground.hasError ? "Error: " : ""}
        {playground.status}
        {markerCount > 0 ? ` (${markerCount} editor diagnostic${markerCount === 1 ? "" : "s"})` : ""}
      </span>
      {loadError || playground.hasError || markerCount > 0 ? (
        <span
          className="mnx-playground__status-message"
          aria-live="polite"
          data-error={Boolean(loadError || playground.hasError)}
        >
          {loadError ?? `${playground.hasError ? "Error: " : ""}${playground.status}`}
          {markerCount > 0 ? ` (${markerCount} editor diagnostic${markerCount === 1 ? "" : "s"})` : ""}
        </span>
      ) : null}

      <div className="mnx-playground__mobile-tabs">
        <Tabs
          tabs={[
            { id: "examples", label: "Examples" },
            { id: "editor", label: "Editor" },
            { id: "preview", label: "Preview" },
          ]}
          activeTab={mobilePane}
          onTabChange={(id) => setMobilePane(id as MobilePane)}
        >
          <div className="mnx-playground__workspace">
            <PlaygroundExampleBrowser
              value={exampleId}
              onChange={(id) => void chooseExample(id)}
              mobileActive={mobilePane === "examples"}
            />
            <section
              className="mnx-playground__pane mnx-playground__editor"
              data-mobile-active={mobilePane === "editor"}
              aria-label="MNX JSON editor"
            >
              <EditorValidity markerCount={markerCount} />
              <div className="mnx-playground__editor-host">
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
              </div>
            </section>

            <section
              className="mnx-playground__pane mnx-playground__preview"
              data-mobile-active={mobilePane === "preview"}
              aria-label="Live score preview"
              aria-busy={previewLoadingLabel !== null}
            >
              {availableScores.length > 1 ? (
                <div
                  className="mnx-playground__preview-controls"
                  role="toolbar"
                  aria-label="MNX score and part controls"
                >
                  <PlaygroundScoreSelect
                    scoreIndex={scoreIndex}
                    onScoreIndexChange={chooseScore}
                    scoreOptions={availableScores}
                  />
                </div>
              ) : null}
              {previewLoadingLabel ? (
                <div className="mnx-playground__layout-loading" role="status" aria-live="polite">
                  <span className="mnx-playground__layout-loading-message">
                    <span className="mnx-playground__layout-spinner" aria-hidden="true" />
                    <span>{previewLoadingLabel}</span>
                  </span>
                </div>
              ) : null}
              <ScoreViewer
                mnx={playground.renderedDocument}
                scoreIndex={scoreIndex}
                onScoreIndexChange={setScoreIndex}
                scoreOptions={availableScores}
                pageWidth={0}
                pageHeight={0}
                spatium={8}
                viewMode="horizontal"
                controls={false}
                defaultFitMode="width"
                minZoom={0.05}
                maxZoom={1}
                className="mnx-playground__score-viewer"
                viewportClassName="mnx-playground__score-viewport"
                scoreClassName="mnx-score-surface"
                pageBackground="transparent"
                onPaint={handleScorePaint}
                onError={(error) => {
                  pendingScoreIndexRef.current = null;
                  previousDocumentRef.current = null;
                  setPreviewLoadingLabel(null);
                  playground.rejectCandidate(error);
                }}
              />
              {playground.candidateDocument ? (
                <div className="mnx-playground__candidate" aria-hidden="true">
                  <ScoreViewer
                    mnx={playground.candidateDocument}
                    scoreIndex={scoreIndex}
                    pageWidth={0}
                    pageHeight={0}
                    spatium={8}
                    viewMode="horizontal"
                    controls={false}
                    minZoom={0.05}
                    maxZoom={1}
                    className="mnx-playground__score-viewer"
                    viewportClassName="mnx-playground__score-viewport"
                    scoreClassName="mnx-score-surface"
                    pageBackground="transparent"
                    onReady={playground.acceptCandidate}
                    onError={playground.rejectCandidate}
                  />
                </div>
              ) : null}
            </section>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
