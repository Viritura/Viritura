/**
 * useDiffEngine — headless hook that encapsulates the entire MNX diff engine.
 *
 * Manages: WASM init, layout computation, semantic diff tree, measure bounds,
 * synchronized viewport, canvas repaint, focus/selection state, and Monaco
 * editor coordination.
 *
 * Consumers provide `originalJson` and `modifiedJson` strings and get back
 * everything needed to render the diff UI.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BeforeMount } from "@monaco-editor/react";
// @ts-expect-error — monaco-editor types are loaded at runtime by @monaco-editor/react
import type { editor } from "monaco-editor";
import { initWasm, isWasmReady, loadMusicFont, GlyphAtlas, PerfTracker, type DisplayList } from "@viritura/renderer";
import { useSyncedViewport } from "./useSyncedViewport";
import { semanticDiff, collectLeaves } from "../diff/semanticDiff";
import type { DiffNode } from "../diff/semanticDiff";
import { computeMeasureDiff, type MeasureDiffResult } from "../diff/measureDiff";
import { buildLineToMeasureMap, lineToMeasure } from "../diff/lineToMeasure";
import { computeMeasureBounds } from "../diff/measureBounds";
import { configureMnxJsonDiagnostics, loadMnxSchema } from "../lib/monacoMnxSchema";
import {
  ATLAS_FONT_SIZE,
  type FocusRect,
  computeLayout,
  applyUseWrittenOverride,
  findMeasureLine,
  computeAllMeasureRects,
} from "./useDiffEngineHelpers";
import { useCanvasRepaint, useCanvasMeasureClick, useSplitterDrag } from "./useDiffEngineSubHooks";

// ─── Hook ────────────────────────────────────────────────────────

/**
 * Upper bound (in **content** characters, per side) on the MNX the diff engine
 * will attempt to process. Above this the Review view eagerly parses each
 * string several times and lays out the full score for both sides, which
 * produces display lists large enough to exhaust the browser tab's memory
 * — an unrecoverable crash rather than a catchable exception. Past the cap
 * we surface a graceful "too large to diff" state instead.
 *
 * The cap is measured against the *content* size (whitespace stripped), NOT
 * the raw string length. The Review view receives the MNX pretty-printed
 * (2-space indent), which inflates the source ~3× with cosmetic whitespace
 * (e.g. a ~8 MB orchestral score becomes ~24 M chars). That whitespace does
 * not affect the parsed-object memory that actually drives the OOM risk, so
 * measuring the raw pretty length made the guard fire ~3× too early — a score
 * that lays out and plays fine in the editor was refused a diff purely because
 * it was indented. ~16 M content chars covers very large orchestral scores
 * (Rhapsody in Blue: 510 measures, 33 parts ≈ 8 M) with headroom, while still
 * guarding against pathological multi-megabyte imports.
 */
const MAX_DIFF_CONTENT_CHARS = 16_000_000;

/**
 * Whether a (possibly pretty-printed) JSON string's *content* — its
 * non-whitespace character count — exceeds `cap`. The raw length is an upper
 * bound on content, so small inputs short-circuit without scanning; larger
 * ones are scanned with an early exit the moment the running content count
 * passes `cap`. This keeps the common case O(1) and the worst case a single
 * cheap pass off the typing hot path (it runs on the deferred values).
 *
 * Exported for unit testing the size guard in isolation.
 */
export function contentExceedsCap(s: string, cap: number): boolean {
  if (s.length <= cap) return false; // content ≤ raw length, so cannot exceed
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Skip ASCII whitespace (space, tab, LF, CR) — the only chars pretty-print
    // adds. In-string spaces are content but negligible vs. JSON indentation.
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) {
      count++;
      if (count > cap) return true;
    }
  }
  return false;
}

export interface UseDiffEngineOptions {
  originalJson: string;
  modifiedJson: string;
  /** Presentation-only override applied to both diff canvases. */
  useWritten?: boolean;
}

export interface UseDiffEngineResult {
  // State
  originalText: string;
  modifiedText: string;
  wasmReady: boolean;
  diffTree: DiffNode | null;
  leafCount: number;
  measureDiff: MeasureDiffResult | null;
  focusedMeasure: number | null;
  selectedDiffNode: DiffNode | null;
  originalDl: DisplayList | null;
  modifiedDl: DisplayList | null;
  /** True when the input exceeds the size the diff engine can safely process. */
  oversized: boolean;
  isViewportDragging: boolean;
  viewport: { scrollX: number; scrollY: number; zoom: number };

  // View mode
  viewMode: "side" | "inline";
  setViewMode: (mode: "side" | "inline") => void;
  diffMode: "full" | "snippets";
  setDiffMode: (mode: "full" | "snippets") => void;

  // Splitter
  splitPercent: number;
  handleSplitterMouseDown: (e: React.MouseEvent) => void;

  // Zoom
  setZoom: (zoom: number) => void;

  // Refs (consumers attach to DOM)
  leftCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  rightCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  leftContainerRef: React.RefObject<HTMLDivElement | null>;
  rightContainerRef: React.RefObject<HTMLDivElement | null>;

  // Monaco integration
  handleBeforeMount: BeforeMount;
  handleEditorMount: (diffEditor: editor.IStandaloneDiffEditor) => void;

  // Selection handlers
  handleNodeSelect: (node: DiffNode) => void;
  setFocusedMeasure: (idx: number | null) => void;
}

// eslint-disable-next-line max-lines-per-function -- diff-pane state hook: 8 useState (text/view/mode/wasm-ready/focus/selection/...) + 5 useEffect coordinating WASM init, diff parsing, focus mgmt, and node selection. Each effect reads multiple state slices; lifting them to sibling hooks would force the same slices to be re-threaded back through deps.
export function useDiffEngine({ originalJson, modifiedJson, useWritten }: UseDiffEngineOptions): UseDiffEngineResult {
  const [originalText, setOriginalText] = useState(originalJson);
  const [modifiedText, setModifiedText] = useState(modifiedJson);
  const [viewMode, setViewMode] = useState<"side" | "inline">("side");
  const [diffMode, setDiffMode] = useState<"full" | "snippets">("snippets");
  const [wasmReady, setWasmReady] = useState(false);
  const [focusedMeasure, setFocusedMeasure] = useState<number | null>(null);
  const [selectedDiffNode, setSelectedDiffNode] = useState<DiffNode | null>(null);
  const [originalDl, setOriginalDl] = useState<DisplayList | null>(null);
  const [modifiedDl, setModifiedDl] = useState<DisplayList | null>(null);
  const [splitPercent, setSplitPercent] = useState(50);

  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Parameters<BeforeMount>[0] | null>(null);
  const mnxSchemaRef = useRef<Record<string, unknown> | null>(null);
  const glyphAtlasRef = useRef<GlyphAtlas | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftPerfRef = useRef(new PerfTracker());
  const rightPerfRef = useRef(new PerfTracker());

  // Sync props
  useEffect(() => {
    setOriginalText(originalJson);
    setModifiedText(modifiedJson);
  }, [originalJson, modifiedJson]);

  // Defer the JSON strings for the expensive derived computations (semantic
  // diff, measure diff, layout). The Monaco editor stays bound to the
  // urgent `originalText` / `modifiedText`, but the heavy diff/layout
  // chain reads the deferred copies so background work can be preempted
  // by further typing. See https://react.dev/reference/react/useDeferredValue.
  const deferredOriginalText = useDeferredValue(originalText);
  const deferredModifiedText = useDeferredValue(modifiedText);

  // Guard against multi-megabyte imports that would OOM the tab when the
  // diff engine parses each string several times and lays out the full
  // score for both sides. Measured against *content* size (whitespace
  // stripped) so the inputs' pretty-print indentation (~3×) does not trip the
  // guard prematurely. Above the cap we skip all heavy work and let consumers
  // render a "too large to diff" message instead.
  const oversized = useMemo(
    () =>
      contentExceedsCap(deferredOriginalText, MAX_DIFF_CONTENT_CHARS) ||
      contentExceedsCap(deferredModifiedText, MAX_DIFF_CONTENT_CHARS),
    [deferredOriginalText, deferredModifiedText],
  );

  // Derived data
  const originalBounds = useMemo(() => (originalDl ? computeMeasureBounds(originalDl) : []), [originalDl]);
  const modifiedBounds = useMemo(() => (modifiedDl ? computeMeasureBounds(modifiedDl) : []), [modifiedDl]);

  const measureDiff: MeasureDiffResult | null = useMemo(() => {
    if (oversized || !deferredOriginalText || !deferredModifiedText) return null;
    try {
      return computeMeasureDiff(JSON.parse(deferredOriginalText), JSON.parse(deferredModifiedText));
    } catch {
      return null;
    }
  }, [oversized, deferredOriginalText, deferredModifiedText]);

  const originalLineMap = useMemo(() => {
    if (oversized || !deferredOriginalText) return [];
    try {
      return buildLineToMeasureMap(deferredOriginalText);
    } catch {
      return [];
    }
  }, [oversized, deferredOriginalText]);
  const modifiedLineMap = useMemo(() => {
    if (oversized || !deferredModifiedText) return [];
    try {
      return buildLineToMeasureMap(deferredModifiedText);
    } catch {
      return [];
    }
  }, [oversized, deferredModifiedText]);

  const diffTree: DiffNode | null = useMemo(() => {
    if (oversized || !deferredOriginalText || !deferredModifiedText) return null;
    try {
      return semanticDiff(JSON.parse(deferredOriginalText) as unknown, JSON.parse(deferredModifiedText) as unknown);
    } catch {
      return null;
    }
  }, [oversized, deferredOriginalText, deferredModifiedText]);

  const leafCount = useMemo(() => {
    if (!diffTree || diffTree.type === "unchanged") return 0;
    return collectLeaves(diffTree).length;
  }, [diffTree]);

  // Viewport
  const {
    viewport,
    leftContainerRef,
    rightContainerRef,
    isDragging: isViewportDragging,
    setZoom,
    scrollTo,
  } = useSyncedViewport({
    leftContentWidth: originalDl?.width ?? 0,
    leftContentHeight: originalDl?.height ?? 0,
    rightContentWidth: modifiedDl?.width ?? 0,
    rightContentHeight: modifiedDl?.height ?? 0,
  });

  // WASM + font init
  useEffect(() => {
    Promise.all([initWasm(), loadMusicFont()]).then(() => {
      setWasmReady(isWasmReady());
      if (typeof OffscreenCanvas !== "undefined") {
        try {
          const atlas = new GlyphAtlas({
            fontSize: ATLAS_FONT_SIZE,
            deviceScale: window.devicePixelRatio || 1,
            atlasWidth: 4096,
            atlasHeight: 4096,
          });
          atlas.build();
          glyphAtlasRef.current = atlas;
        } catch {
          /* fallback */
        }
      }
    });
  }, []);

  // MNX schema
  useEffect(() => {
    loadMnxSchema().then((schema) => {
      mnxSchemaRef.current = schema;
      if (monacoRef.current) configureMnxJsonDiagnostics(monacoRef.current, schema);
    });
  }, []);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    configureMnxJsonDiagnostics(monaco, mnxSchemaRef.current);
  }, []);

  // Layout computation
  useEffect(() => {
    if (!wasmReady) return;
    if (oversized) {
      setOriginalDl(null);
      return;
    }
    const pageWidth = leftContainerRef.current?.clientWidth ?? 400;
    const text = deferredOriginalText
      ? useWritten !== undefined
        ? applyUseWrittenOverride(deferredOriginalText, useWritten)
        : deferredOriginalText
      : "";
    setOriginalDl(text ? computeLayout(text, pageWidth) : null);
  }, [oversized, deferredOriginalText, wasmReady, leftContainerRef, useWritten]);

  useEffect(() => {
    if (!wasmReady) return;
    if (oversized) {
      setModifiedDl(null);
      return;
    }
    const pageWidth = rightContainerRef.current?.clientWidth ?? 400;
    const text = deferredModifiedText
      ? useWritten !== undefined
        ? applyUseWrittenOverride(deferredModifiedText, useWritten)
        : deferredModifiedText
      : "";
    setModifiedDl(text ? computeLayout(text, pageWidth) : null);
  }, [oversized, deferredModifiedText, wasmReady, rightContainerRef, useWritten]);

  // Measure focus rects
  const origMeasureRects = useMemo(() => {
    if (!originalDl || !diffTree) return new Map<number, FocusRect>();
    return computeAllMeasureRects(diffTree, originalDl, originalBounds, deferredOriginalText, modifiedDl, "original");
  }, [originalDl, modifiedDl, diffTree, originalBounds, deferredOriginalText]);

  const modMeasureRects = useMemo(() => {
    if (!modifiedDl || !diffTree) return new Map<number, FocusRect>();
    return computeAllMeasureRects(diffTree, modifiedDl, modifiedBounds, deferredModifiedText, originalDl, "modified");
  }, [originalDl, modifiedDl, diffTree, modifiedBounds, deferredModifiedText]);

  // Repaint canvases
  useCanvasRepaint({
    canvasRef: leftCanvasRef,
    containerRef: leftContainerRef,
    dl: originalDl,
    side: "original",
    bounds: originalBounds,
    measureRects: origMeasureRects,
    measureDiff,
    focusedMeasure,
    viewport,
    perfRef: leftPerfRef,
    glyphAtlasRef,
  });
  useCanvasRepaint({
    canvasRef: rightCanvasRef,
    containerRef: rightContainerRef,
    dl: modifiedDl,
    side: "modified",
    bounds: modifiedBounds,
    measureRects: modMeasureRects,
    measureDiff,
    focusedMeasure,
    viewport,
    perfRef: rightPerfRef,
    glyphAtlasRef,
  });

  // Scroll to measure
  const scrollToMeasure = useCallback(
    (measureIndex: number) => {
      const bounds = modifiedBounds.length > 0 ? modifiedBounds : originalBounds;
      const mb = bounds.find((b) => b.measureIndex === measureIndex);
      if (!mb) return;
      const centerX = (mb.xStart + mb.xEnd) / 2;
      const centerY = (mb.yStart + mb.yEnd) / 2;
      const containerWidth = leftContainerRef.current?.clientWidth ?? 400;
      const containerHeight = leftContainerRef.current?.clientHeight ?? 300;
      scrollTo(
        Math.max(0, centerX - containerWidth / (2 * viewport.zoom)),
        Math.max(0, centerY - containerHeight / (2 * viewport.zoom)),
      );
      setFocusedMeasure(measureIndex);
    },
    [originalBounds, modifiedBounds, viewport, scrollTo, leftContainerRef],
  );

  useCanvasMeasureClick({
    leftContainerRef,
    rightContainerRef,
    originalBounds,
    modifiedBounds,
    viewport,
    diffTree,
    setFocusedMeasure,
    setSelectedDiffNode,
  });

  // Node selection handler (from tree sidebar)
  const handleNodeSelect = useCallback(
    (node: DiffNode) => {
      setSelectedDiffNode(node);
      const partsMeasureMatch = node.path.match(/parts\[(\d+)\]\.measures\[(\d+)\]/);
      const globalMeasureMatch = node.path.match(/global\.measures\[(\d+)\]/);
      let partIndex = -1;
      let measureIndex: number | null = null;
      if (partsMeasureMatch?.[1] != null && partsMeasureMatch[2] != null) {
        partIndex = Number(partsMeasureMatch[1]);
        measureIndex = Number(partsMeasureMatch[2]);
      } else if (globalMeasureMatch?.[1] != null) {
        measureIndex = Number(globalMeasureMatch[1]);
      }
      if (measureIndex != null) {
        scrollToMeasure(measureIndex);
        const ed = diffEditorRef.current;
        if (ed) {
          const modEditor = ed.getModifiedEditor();
          const lineNumber = findMeasureLine(modifiedText, partIndex, measureIndex);
          if (lineNumber > 0) {
            modEditor.revealLineInCenter(lineNumber);
            modEditor.setPosition({ lineNumber, column: 1 });
          }
        }
      }
    },
    [scrollToMeasure, modifiedText],
  );

  // Monaco editor mount
  const handleEditorMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor) => {
      diffEditorRef.current = diffEditor;
      const modEditor = diffEditor.getModifiedEditor();
      const origEditor = diffEditor.getOriginalEditor();
      modEditor.onDidChangeCursorPosition((e: { position: { lineNumber: number } }) => {
        const loc = lineToMeasure(modifiedLineMap, e.position.lineNumber);
        if (loc) scrollToMeasure(loc.measureIndex);
      });
      origEditor.onDidChangeCursorPosition((e: { position: { lineNumber: number } }) => {
        const loc = lineToMeasure(originalLineMap, e.position.lineNumber);
        if (loc) scrollToMeasure(loc.measureIndex);
      });
    },
    [originalLineMap, modifiedLineMap, scrollToMeasure],
  );

  // Re-attach cursor listeners when line maps change
  useEffect(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const modDisposable = diffEditor
      .getModifiedEditor()
      .onDidChangeCursorPosition((e: { position: { lineNumber: number } }) => {
        const loc = lineToMeasure(modifiedLineMap, e.position.lineNumber);
        if (loc) scrollToMeasure(loc.measureIndex);
      });
    const origDisposable = diffEditor
      .getOriginalEditor()
      .onDidChangeCursorPosition((e: { position: { lineNumber: number } }) => {
        const loc = lineToMeasure(originalLineMap, e.position.lineNumber);
        if (loc) scrollToMeasure(loc.measureIndex);
      });
    return () => {
      modDisposable.dispose();
      origDisposable.dispose();
    };
  }, [originalLineMap, modifiedLineMap, scrollToMeasure]);

  // Splitter drag
  const { handleSplitterMouseDown } = useSplitterDrag(splitPercent, setSplitPercent);

  return {
    originalText,
    modifiedText,
    wasmReady,
    diffTree,
    leafCount,
    measureDiff,
    focusedMeasure,
    selectedDiffNode,
    originalDl,
    modifiedDl,
    oversized,
    isViewportDragging,
    viewport,
    viewMode,
    setViewMode,
    diffMode,
    setDiffMode,
    splitPercent,
    handleSplitterMouseDown,
    setZoom,
    leftCanvasRef,
    rightCanvasRef,
    leftContainerRef,
    rightContainerRef,
    handleBeforeMount,
    handleEditorMount,
    handleNodeSelect,
    setFocusedMeasure,
  };
}
