import type { CSSProperties } from "react";
import { DiffEditor } from "@viritura/monaco-react";
import { SnippetEditor } from "../../DiffTreeView";
import type { UseDiffEngineResult } from "../../../hooks/useDiffEngine";
import { splitterStyle, canvasPlaceholderStyle, canvasLabelStyle } from "./styles";

const DIFF_ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" };
const DIFF_CONTENT_STYLE: CSSProperties = {
  display: "flex",
  flex: 1,
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};
const OVERSIZED_NOTICE_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: "100%",
  padding: 24,
  textAlign: "center",
  color: "var(--text-muted)",
};
const OVERSIZED_TITLE_STYLE: CSSProperties = { fontWeight: 600, color: "var(--text)" };
const CANVAS_BLOCK_STYLE: CSSProperties = { display: "block" };
const COMPARISON_DIVIDER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  width: 10,
  flexShrink: 0,
  background: "color-mix(in srgb, var(--canvas-bg, #e0e2ea) 82%, var(--surface))",
  boxShadow: "inset 1px 0 rgba(20, 20, 28, 0.08), inset -1px 0 rgba(20, 20, 28, 0.08)",
};
const COMPARISON_DIVIDER_LINE_STYLE: CSSProperties = {
  width: 1,
  background: "color-mix(in srgb, var(--text-muted) 30%, transparent)",
};
const ORIGINAL_LABEL_STYLE: CSSProperties = {
  ...canvasLabelStyle,
  color: "#c62828",
  background: "rgba(198,40,40,0.10)",
  borderColor: "rgba(198,40,40,0.25)",
};
const MODIFIED_LABEL_STYLE: CSSProperties = {
  ...canvasLabelStyle,
  color: "#2e7d32",
  background: "rgba(46,125,50,0.10)",
  borderColor: "rgba(46,125,50,0.25)",
};
function topPaneStyle(splitPercent: number): CSSProperties {
  return { height: `${splitPercent}%`, overflow: "hidden", borderBottom: "1px solid var(--border)" };
}
function bottomPaneStyle(): CSSProperties {
  return { flex: 1, minHeight: 0, display: "flex", overflow: "hidden" };
}
function canvasContainerStyle(isViewportDragging: boolean): CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    background: "var(--canvas-bg, #e0e2ea)",
    cursor: isViewportDragging ? "grabbing" : "grab",
  };
}

export function DiffMainPane({ engine }: { engine: UseDiffEngineResult }) {
  const {
    splitPercent,
    diffMode,
    selectedDiffNode,
    originalText,
    modifiedText,
    viewMode,
    showSource,
    handleBeforeMount,
    handleEditorMount,
    handleSplitterMouseDown,
    isViewportDragging,
    wasmReady,
    originalDl,
    modifiedDl,
    oversized,
    leftContainerRef,
    rightContainerRef,
    leftCanvasRef,
    rightCanvasRef,
  } = engine;
  if (oversized) {
    return (
      <div id="diff-main-container" style={DIFF_ROOT_STYLE}>
        <div style={OVERSIZED_NOTICE_STYLE}>
          <span style={OVERSIZED_TITLE_STYLE}>Score too large to diff</span>
          <span>
            This score exceeds the size the Review view can compare without exhausting memory. Editing and playback are
            unaffected — visual diffing is disabled for documents this large.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div id="diff-main-container" style={DIFF_ROOT_STYLE}>
      <div id="diff-content-container" style={DIFF_CONTENT_STYLE}>
        {showSource && (
          <>
            <div style={topPaneStyle(splitPercent)}>
              {diffMode === "snippets" ? (
                <SnippetEditor node={selectedDiffNode} />
              ) : (
                <DiffEditor
                  original={originalText}
                  modified={modifiedText}
                  language="json"
                  theme="vs-light"
                  beforeMount={handleBeforeMount}
                  onMount={handleEditorMount}
                  options={{
                    readOnly: true,
                    renderSideBySide: viewMode === "side",
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    renderIndicators: true,
                    renderMarginRevertIcon: false,
                    originalEditable: false,
                  }}
                />
              )}
            </div>
            <div
              onMouseDown={handleSplitterMouseDown}
              role="separator"
              aria-label="Resize source and score comparison"
              aria-orientation="horizontal"
              style={splitterStyle}
            />
          </>
        )}
        <div style={bottomPaneStyle()}>
          <div ref={leftContainerRef} style={canvasContainerStyle(isViewportDragging)}>
            {!wasmReady ? (
              <div style={canvasPlaceholderStyle}>Loading WASM…</div>
            ) : originalDl ? (
              <canvas ref={leftCanvasRef} style={CANVAS_BLOCK_STYLE} />
            ) : (
              <div style={canvasPlaceholderStyle}>No score to render</div>
            )}
            <div style={ORIGINAL_LABEL_STYLE}>Before</div>
          </div>
          <div
            role="separator"
            aria-label="Before and after scores"
            aria-orientation="vertical"
            style={COMPARISON_DIVIDER_STYLE}
          >
            <span style={COMPARISON_DIVIDER_LINE_STYLE} />
          </div>
          <div ref={rightContainerRef} style={canvasContainerStyle(isViewportDragging)}>
            {!wasmReady ? (
              <div style={canvasPlaceholderStyle}>Loading WASM…</div>
            ) : modifiedDl ? (
              <canvas ref={rightCanvasRef} style={CANVAS_BLOCK_STYLE} />
            ) : (
              <div style={canvasPlaceholderStyle}>No score to render</div>
            )}
            <div style={MODIFIED_LABEL_STYLE}>After</div>
          </div>
        </div>
      </div>
    </div>
  );
}
