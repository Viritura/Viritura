/**
 * ScorePreview — MNX library preview built on the public packages.
 *
 * Renders MNX through `<ScoreViewer>` from `@viritura/score-viewer-react`, the
 * same component external consumers embed, at the staff size and page geometry
 * the document asks for. When `showEditor` is true, a Monaco JSON editor sits
 * beside the score and edits re-engrave it live.
 *
 * App Storybook stories that need editor-only view features use
 * EditorScorePreview instead.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { MnxEditor } from "@viritura/monaco-react";
import { ScoreViewer, type ScoreViewMode } from "@viritura/score-viewer-react";
import { documentPageLayout } from "./documentPageLayout";

const ERROR_BANNER_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  padding: "0.5rem 0.75rem",
  background: "rgba(255, 243, 205, 0.95)",
  color: "#856404",
  borderBottom: "1px solid #ffc107",
  fontSize: 13,
  fontFamily: "monospace",
};
const SOLO_WRAP_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100vh" };
const SPLIT_ROOT_STYLE: CSSProperties = { display: "flex", height: "100vh", width: "100%" };
const SPLITTER_STYLE: CSSProperties = { width: 1, background: "#333", flexShrink: 0, cursor: "col-resize" };
const VIEWER_STYLE: CSSProperties = { position: "absolute", inset: 0 };
function canvasPaneRootStyle(height: number | undefined): CSSProperties {
  return { flex: 1, minHeight: height, overflow: "hidden", position: "relative" };
}
function splitLeftStyle(editorRatio: number): CSSProperties {
  return { flex: 1 - editorRatio, display: "flex", flexDirection: "column", overflow: "hidden" };
}
function splitRightStyle(editorRatio: number): CSSProperties {
  return { flex: editorRatio, display: "flex", flexDirection: "column", background: "#1e1e1e", overflow: "hidden" };
}

const VIEW_MODES: Record<NonNullable<ScorePreviewProps["viewMode"]>, ScoreViewMode> = {
  horizon: "horizon",
  page: "page",
  spread: "spread",
  "spread-h": "spread-horizontal",
};

export interface ScorePreviewProps {
  /** MNX JSON string to render */
  mnxJson: string;
  /** Optional minimum height for the score pane */
  height?: number;
  /** Show an inline Monaco editor beside the score (split-pane playground mode) */
  showEditor?: boolean;
  /** Editor width ratio (0-1). Default 0.45 = editor takes 45% of width */
  editorRatio?: number;
  /**
   * Score view mode. Defaults to "horizon" (one continuous system). Use "page"
   * to render with system breaks and line wrapping — useful for stories that
   * need to demonstrate multi-system behaviour (e.g. abbreviated labels).
   */
  viewMode?: "horizon" | "page" | "spread" | "spread-h";
}

export function ScorePreview({
  mnxJson,
  height = 400,
  showEditor = true,
  editorRatio = 0.45,
  viewMode = "horizon",
}: ScorePreviewProps) {
  const [liveMnx, setLiveMnx] = useState(mnxJson);
  const [editorValue, setEditorValue] = useState(() => formatJson(mnxJson));
  const [error, setError] = useState<string | null>(null);

  // Reset live MNX when story props change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setLiveMnx(mnxJson);
    setEditorValue(formatJson(mnxJson));
    setError(null);
  }, [mnxJson]);

  const layout = useMemo(() => documentPageLayout(liveMnx), [liveMnx]);

  // Handle Monaco editor changes — live re-render on valid JSON
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!value) return;
    setEditorValue(value);
    try {
      JSON.parse(value);
      setLiveMnx(value);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const scorePane = (
    <div style={canvasPaneRootStyle(height)}>
      {error && <div style={ERROR_BANNER_STYLE}>⚠ {error}</div>}
      <ScoreViewer
        mnx={liveMnx}
        viewMode={VIEW_MODES[viewMode]}
        spatium={layout?.spatium}
        pageWidth={layout?.pageWidth}
        pageHeight={layout?.pageHeight}
        pageMargins={layout?.pageMargins}
        controls={false}
        defaultFitMode={viewMode === "horizon" ? "width" : "none"}
        defaultZoom={1}
        minZoom={0.05}
        maxZoom={1}
        contentAlign="center"
        style={VIEWER_STYLE}
        onError={(err) => setError(err.message)}
      />
    </div>
  );

  if (!showEditor) {
    return <div style={SOLO_WRAP_STYLE}>{scorePane}</div>;
  }

  return (
    <div style={SPLIT_ROOT_STYLE}>
      <div style={splitLeftStyle(editorRatio)}>{scorePane}</div>
      <div style={SPLITTER_STYLE} />
      <div style={splitRightStyle(editorRatio)}>
        <MnxEditor
          modelPath="file:///storybook.mnx"
          schemaUrl={`${import.meta.env.BASE_URL}mnx-schema.json`}
          value={editorValue}
          onChange={handleEditorChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            // Monaco option requires a numeric font size.
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            formatOnPaste: true,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
