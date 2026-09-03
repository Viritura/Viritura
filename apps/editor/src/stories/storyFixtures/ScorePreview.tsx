/**
 * ScorePreview — wrapper component for Storybook stories.
 *
 * Takes MNX JSON string, loads it into the document context,
 * and renders it via ScoreCanvas. Emits the MNX JSON to the
 * Storybook channel so the MNX Source addon panel can display it.
 *
 * When `showEditor` is true, renders a split-pane layout with the
 * score canvas on the left and a Monaco JSON editor on the right.
 * Edits in Monaco instantly re-render the score.
 */
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type ReactNode } from "react";
import { ScoreCanvas, type ScoreCanvasHandle } from "../../components/ScoreCanvas";
import { DocumentProvider, useDocumentActions, useDocument } from "../../store/DocumentContext";
import { ErrorBoundary } from "@viritura/ui";
import { parseMnxWithDiagnostics } from "@viritura/format";
import { MnxEditor } from "@viritura/monaco-react";
import type { ScrollAnchor, ScrollAnchorAxes } from "../../viewport";

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
function canvasPaneRootStyle(height: number | undefined): CSSProperties {
  return { flex: 1, minHeight: height, overflow: "hidden", position: "relative" };
}
function splitLeftStyle(editorRatio: number): CSSProperties {
  return { flex: 1 - editorRatio, display: "flex", flexDirection: "column", overflow: "hidden" };
}
function splitRightStyle(editorRatio: number): CSSProperties {
  return { flex: editorRatio, display: "flex", flexDirection: "column", background: "#1e1e1e", overflow: "hidden" };
}
export interface ScorePreviewProps {
  /** MNX JSON string to render */
  mnxJson: string;
  /** Optional height for the canvas container */
  height?: number;
  /** Show an inline Monaco editor beside the canvas (split-pane playground mode) */
  showEditor?: boolean;
  /** Editor width ratio (0-1). Default 0.45 = editor takes 45% of width */
  editorRatio?: number;
  /**
   * Canvas view mode. Defaults to "horizon" (continuous horizontal scroll).
   * Use "page" to render with system breaks and line wrapping — useful for
   * stories that need to demonstrate multi-system behaviour (e.g. abbreviated labels).
   */
  viewMode?: "horizon" | "page" | "spread" | "spread-h";
  /** Initial canvas framing. Storybook previews default to centered. */
  scrollAnchor?: ScrollAnchor | ScrollAnchorAxes;
  /**
   * When true, every multi-source staff in the active layout is rendered with
   * its individual source staves underneath (the blue "expansion" staves the
   * editor shows when you expand a condensed staff). Useful for condensing/
   * engraving-matrix stories so the source material is visible alongside the
   * condensed result.
   */
  expandCondensingSources?: boolean;
  /** Optional children to render below the canvas */
  children?: ReactNode;
}

function ScorePreviewInner({
  mnxJson,
  height = 400,
  showEditor = true,
  editorRatio = 0.45,
  viewMode = "horizon",
  scrollAnchor = "center",
  expandCondensingSources = false,
}: ScorePreviewProps) {
  const { loadScore } = useDocumentActions();
  const { mnxJson: _currentJson } = useDocument();
  const canvasRef = useRef<ScoreCanvasHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMnx, setLiveMnx] = useState(mnxJson);
  const [editorValue, setEditorValue] = useState(() => formatJson(mnxJson));

  // Load score from props or live edits
  useEffect(() => {
    const json = liveMnx || mnxJson;
    if (!json) return;
    try {
      const raw = JSON.parse(json);
      const score = parseMnxWithDiagnostics(raw).score;
      loadScore(score);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [liveMnx, mnxJson, loadScore]);

  // Reset live MNX when story props change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setLiveMnx(mnxJson);
    setEditorValue(formatJson(mnxJson));
  }, [mnxJson]);

  // When `expandCondensingSources` is on, compute the path keys for every
  // multi-source staff in the active layout. ScoreCanvas reuses these keys
  // (via `injectExpandedStaves`) to insert blue source staves below each
  // condensed staff — mirroring the editor's "expand condensed staff" UI.
  // Path scheme matches ScoreCanvas's `injectExpandedStaves`: top-level
  // index, with nested groups joined by `-` (e.g. "0", "0-1", "2-0-1").
  const expandedPaths = useMemo<Set<string> | undefined>(() => {
    if (!expandCondensingSources) return undefined;
    try {
      const parsed = JSON.parse(liveMnx || mnxJson);
      const scores = parsed.scores ?? [];
      const sd = scores[0];
      if (!sd) return undefined;
      const layoutId = sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout;
      if (!layoutId) return undefined;
      const layout = (parsed.layouts ?? []).find((l: { id: string }) => l.id === layoutId);
      if (!layout) return undefined;
      const out = new Set<string>();
      const walk = (content: Array<Record<string, unknown>>, prefix: string) => {
        content.forEach((node, i) => {
          const path = prefix ? `${prefix}-${i}` : `${i}`;
          if (node.type === "group") {
            walk((node.content as Array<Record<string, unknown>>) ?? [], path);
          } else if (node.type === "staff") {
            const sources = node.sources as Array<{ part: string }> | undefined;
            if (sources && sources.length > 1) out.add(path);
          }
        });
      };
      walk(layout.content ?? [], "");
      return out;
    } catch {
      return undefined;
    }
  }, [expandCondensingSources, liveMnx, mnxJson]);

  // Handle Monaco editor changes — live re-render on valid JSON
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!value) return;
    setEditorValue(value);
    try {
      JSON.parse(value); // validate
      setLiveMnx(value);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const canvasPane = (
    // overflow: hidden prevents scrollbar-oscillation feedback loops.
    // ScoreCanvas manages scrolling internally via its own viewport
    // (viewport.scrollX/scrollY) — the outer pane never needs scrollbars.
    // With overflow:auto, a stale 1px canvas size would briefly overflow,
    // trigger a scrollbar that shrinks client area, trigger ResizeObserver,
    // re-layout, canvas re-fits, scrollbar disappears, and the loop repeats
    // continuously at certain zoom levels / window sizes.
    <div style={canvasPaneRootStyle(height)}>
      {error && <div style={ERROR_BANNER_STYLE}>⚠ {error}</div>}
      <ErrorBoundary resetKey={liveMnx}>
        <ScoreCanvas
          ref={canvasRef}
          keepLayoutBackendAlive
          viewMode={viewMode}
          initialZoom={1.0}
          scrollAnchor={scrollAnchor}
          fitToWidth={viewMode === "horizon"}
          expandedCondensingStaves={expandedPaths}
        />
      </ErrorBoundary>
    </div>
  );

  if (!showEditor) {
    return <div style={SOLO_WRAP_STYLE}>{canvasPane}</div>;
  }

  // Split-pane: canvas left, Monaco editor right
  return (
    <div style={SPLIT_ROOT_STYLE}>
      <div style={splitLeftStyle(editorRatio)}>{canvasPane}</div>
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

/**
 * Top-level ScorePreview with all required context providers.
 * Use this in stories:
 *
 * ```tsx
 * export const MyStory = () => <ScorePreview mnxJson={json} />;
 * ```
 */
export function ScorePreview(props: ScorePreviewProps) {
  return (
    <DocumentProvider>
      <ScorePreviewInner {...props} />
    </DocumentProvider>
  );
}

function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
