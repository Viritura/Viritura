import type { CSSProperties } from "react";
import { DiffEditor } from "@viritura/monaco-react";
import { SnippetEditor } from "../../DiffTreeView";
import type { UseDiffEngineResult } from "../../../hooks/useDiffEngine";
import { splitterStyle, canvasPlaceholderStyle, canvasLabelStyle } from "./styles";

const DIFF_ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" };
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
function bottomPaneStyle(splitPercent: number): CSSProperties {
  return { height: `${100 - splitPercent}%`, display: "flex", overflow: "hidden" };
}
function canvasContainerStyle(isViewportDragging: boolean, withBorder: boolean): CSSProperties {
  return {
    width: "50%",
    ...(withBorder ? { borderRight: "1px solid var(--border)" } : {}),
    overflow: "hidden",
    position: "relative",
    background: "var(--surface-raised)",
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
      <div onMouseDown={handleSplitterMouseDown} role="separator" aria-orientation="horizontal" style={splitterStyle} />
      <div style={bottomPaneStyle(splitPercent)}>
        <div ref={leftContainerRef} style={canvasContainerStyle(isViewportDragging, true)}>
          {!wasmReady ? (
            <div style={canvasPlaceholderStyle}>Loading WASM…</div>
          ) : originalDl ? (
            <canvas ref={leftCanvasRef} style={CANVAS_BLOCK_STYLE} />
          ) : (
            <div style={canvasPlaceholderStyle}>No score to render</div>
          )}
          <div style={ORIGINAL_LABEL_STYLE}>Original</div>
        </div>
        <div ref={rightContainerRef} style={canvasContainerStyle(isViewportDragging, false)}>
          {!wasmReady ? (
            <div style={canvasPlaceholderStyle}>Loading WASM…</div>
          ) : modifiedDl ? (
            <canvas ref={rightCanvasRef} style={CANVAS_BLOCK_STYLE} />
          ) : (
            <div style={canvasPlaceholderStyle}>No score to render</div>
          )}
          <div style={MODIFIED_LABEL_STYLE}>Modified</div>
        </div>
      </div>
    </div>
  );
}
