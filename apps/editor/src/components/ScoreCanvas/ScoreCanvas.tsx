/* eslint-disable max-lines -- component shell after 25+ sibling extractions (canvasHandlers, paintScoreFrame, paintEngraveAdornments, repaintCanvas, computeDisplayList, hitTesting, layoutHelpers, viewportGeometry, ...). The remainder is React glue that does not decompose cleanly: state/ref declarations, useImperativeHandle, prop-mirror refs for engrave callbacks, effect orchestration coordinating WASM/fast-layout/relayout, and JSX. Splitting further would scatter cross-effect dependencies into argument bundles. */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  GlyphAtlas,
  PageCache,
  SpatialIndex,
  isWasmReady,
  isTileCacheDisabled,
  TileCache,
  getGlobalPerfTracker,
  detectStaves,
  type DisplayList,
  type ScoreInfo,
  type SpannerHandleHit,
  type StickyClefInfo,
  type PatchInfo,
} from "@viritura/renderer";
import type { Note } from "@viritura/core";
import { DEFAULT_PAGE_SETUP } from "@viritura/core";
import type { PageSetup } from "@viritura/core";
// loadMnxFromString removed — we use the Score from DocumentContext directly
import { useViewport } from "../../hooks/useViewport";
import { useFollowPlayhead } from "../../hooks/useFollowPlayhead";
import { useNoteInput } from "../../store/noteInputStore";
import { useSelection, useSelectionActions } from "../../store/selectionStore";
import { useDocument, useDocumentActions, useDocumentStoreApi } from "../../store/DocumentContext";
import { useThemeStore } from "../../store/themeStore";
import { useDebugSettingsStore } from "../../store/debugSettingsStore";
import { InputCursor, type NoteInputClickInfo } from "../InputCursor";
import { PlayheadOverlay } from "@viritura/playback";
import { FollowPlayheadButton } from "../FollowPlayheadButton";
import { GhostRailOverlay, type GhostRailDescriptor } from "../GhostRailOverlay";
import { CondensedStaffToggles } from "../../condensedStaves";

/** Stable empty set so the overlay's memo isn't invalidated every render. */
const EMPTY_EXPANDED: Set<string> = new Set();
import { usePlaybackActions, usePlaybackState, useFollowEnabled } from "@viritura/playback";
import { useLayoutDebugStore } from "../../debug/layoutDebugStore";
import { ContextMenu, type ContextMenuState } from "@viritura/ui";

// Public types live in `./types` and `./imperativeHandle` so this file
// exports only the component (per react-refresh/only-export-components).
export type {
  EngraveBreakMarker,
  EngraveAdornments,
  EngraveStaffEye,
  StaffEyeHit,
  BarlineHit,
  EngraveClickModifiers,
  ScoreCanvasProps,
} from "./types";
export type { ScoreCanvasHandle } from "./imperativeHandle";
import type { ScoreCanvasProps, EngraveAdornments, BarlineHit } from "./types";
import type { ScoreCanvasHandle } from "./imperativeHandle";

import {
  ATLAS_FONT_SIZE,
  SCORE_CANVAS_WRAP_STYLE,
  SCORE_ERROR_STYLE,
  SCORE_LOADING_STYLE,
  SCORE_ROOT_STYLE,
  scoreCanvasElementStyle,
} from "./constants";

/** Constants for spread layout positioning. */

import { type DerivedGhostRail } from "./engraveAdornments";

import { setLayoutPerfDebug } from "./layoutHelpers";
import { addNoteAtClick } from "./noteInputClickHandler";
import { paintScoreFrame } from "./paintScoreFrame";
import { selectionVoiceIndex } from "./selectionVoice";
import { buildDragSnapPoints as buildDragSnapPointsImpl } from "./dragSnapPoints";
import { commitSpannerDragImpl } from "./commitSpannerDrag";
import { runFastLayoutAndPaint } from "./fastLayout";
import { computeSelectedIds } from "./computeSelectedIds";
import { buildScoreCanvasHandle } from "./imperativeHandle";
import { runInitialLoad, contentSizeForMode } from "./initialLoad";
import { computeDisplayListImpl, prewarmPatchChain } from "./computeDisplayList";
import { initWasmAndFont } from "./initWasmAndFont";
import type { LayoutBackend } from "./layoutBackend";
import { runBackgroundTask } from "../../store/backgroundTaskStore";
import { useEngraveHoverFade } from "./useEngraveHoverFade";
import { useFastLayoutCallback, runSecondaryRelayout, useScoreViewRelayout } from "./relayoutEffects";
import { usePlayPauseShortcut } from "./usePlayPauseShortcut";
import { useFitToWidthZoom, useParentNotifications } from "./parentEffects";
import {
  handleCanvasClickImpl,
  handleCanvasDoubleClickImpl,
  handleCanvasMouseDownImpl,
  handleCanvasMouseUpImpl,
  handleCanvasMouseMoveImpl,
  handleCanvasMouseLeaveImpl,
  handleCanvasContextMenuImpl,
  type CanvasHandlerCtx,
} from "./canvasHandlers";
import { produce } from "../../score/scoreClone";
import { reanchoredSlurElementId, reanchorSlurInScore } from "../../score/ScoreMutations";

export const ScoreCanvas = forwardRef<ScoreCanvasHandle, ScoreCanvasProps>(
  // eslint-disable-next-line max-lines-per-function, complexity, max-statements -- Component glue: state declarations, refs, effects orchestration, useImperativeHandle, JSX render. Sub-pieces extracted to sibling files (paintScoreFrame, canvasHandlers, noteInputClickHandler, paintEngraveAdornments, repaintCanvas, layoutHelpers, viewportGeometry, hitTesting, engraveAdornments, slurHandles, paperPattern, dragSnapPoints, commitSpannerDrag, fastLayout, layoutEnginePath, selectionStartTime, computeSelectedIds, imperativeHandle, initialLoad, computeDisplayList, initWasmAndFont, useEngraveHoverFade, usePlayPauseShortcut, relayoutEffects, parentEffects).
  function ScoreCanvas(
    {
      partIndex = 0,
      keepLayoutBackendAlive = false,
      selectedScoreIndex = 0,
      selectedPartIds,
      expandedCondensingStaves,
      onToggleCondensedStaff,
      onViewportChange,
      onScoreInfoChange,
      onHoverBeat,
      onLayoutsChange,
      onPageCountChange,
      onPrintOverflowChange,
      viewMode = "horizon",
      initialZoom,
      printPreview = false,
      scrollAnchor,
      safeArea,
      fitToWidth = false,
      interactionMode = "write",
      engraveAdornments,
      selectedEngraveMarkerId = null,
      onEngraveBarlineClick,
      onEngraveBarlineHover,
      onEngraveMarkerClick,
      onEngraveEmptyClick,
      onEngraveStaffEyeClick,
      onEngraveSlurShapeEdit,
      onEngraveSlurShapeReset,
      onEngraveSlurReanchor,
      onEngraveSlurSelectionChange,
      onEngraveTextExpressionOffsetEdit,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const displayListRef = useRef<DisplayList | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [scoreInfo, setScoreInfo] = useState<string>("");
    const [wasmReady, setWasmReady] = useState(false);
    const backendRef = useRef<LayoutBackend | null>(null);
    const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
    const glyphAtlasRef = useRef<GlyphAtlas | null>(null);
    const pageCacheRef = useRef<PageCache | null>(null);
    const [scoreDefinitions, setScoreDefinitions] = useState<string[]>([]);
    const [containerWidth, setContainerWidth] = useState(0);
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [displayListVersion, setDisplayListVersion] = useState(0);
    const displayListVersionRef = useRef(0);
    const spatialIndexRef = useRef<SpatialIndex | null>(null);
    const perfTrackerRef = useRef(getGlobalPerfTracker());
    const tileCacheRef = useRef(new TileCache());
    /** Cached page setup for margin rendering. */
    const pageSetupRef = useRef<PageSetup>(DEFAULT_PAGE_SETUP);
    /** Cached sticky clef info — recomputed when display list version changes. */
    const stickyClefCacheRef = useRef<{
      version: number;
      info: StickyClefInfo[];
      staves: ReturnType<typeof detectStaves>;
    }>({ version: -1, info: [], staves: [] });
    /** Ref to the latest repaint function to avoid stale closures in effects. */
    const repaintRef = useRef<() => void>(() => {});
    /** Ref to the synchronous paint function for the fast edit path. */
    const paintNowRef = useRef<(forceDirect?: boolean) => void>(() => {});

    // ─── Engrave-mode state (refs to avoid re-binding handlers) ────
    const interactionModeRef = useRef<"write" | "engrave">(interactionMode);
    interactionModeRef.current = interactionMode;
    const engraveAdornmentsRef = useRef<EngraveAdornments | undefined>(engraveAdornments);
    engraveAdornmentsRef.current = engraveAdornments;
    const selectedEngraveMarkerIdRef = useRef<string | null>(selectedEngraveMarkerId);
    selectedEngraveMarkerIdRef.current = selectedEngraveMarkerId;
    const onEngraveBarlineClickRef = useRef(onEngraveBarlineClick);
    onEngraveBarlineClickRef.current = onEngraveBarlineClick;
    const onEngraveBarlineHoverRef = useRef(onEngraveBarlineHover);
    onEngraveBarlineHoverRef.current = onEngraveBarlineHover;
    const onEngraveMarkerClickRef = useRef(onEngraveMarkerClick);
    onEngraveMarkerClickRef.current = onEngraveMarkerClick;
    const onEngraveEmptyClickRef = useRef(onEngraveEmptyClick);
    onEngraveEmptyClickRef.current = onEngraveEmptyClick;
    const onEngraveStaffEyeClickRef = useRef(onEngraveStaffEyeClick);
    onEngraveStaffEyeClickRef.current = onEngraveStaffEyeClick;
    const onEngraveSlurShapeEditRef = useRef(onEngraveSlurShapeEdit);
    onEngraveSlurShapeEditRef.current = onEngraveSlurShapeEdit;
    const onEngraveSlurShapeResetRef = useRef(onEngraveSlurShapeReset);
    onEngraveSlurShapeResetRef.current = onEngraveSlurShapeReset;
    const onEngraveSlurReanchorRef = useRef(onEngraveSlurReanchor);
    onEngraveSlurReanchorRef.current = onEngraveSlurReanchor;
    const onEngraveSlurSelectionChangeRef = useRef(onEngraveSlurSelectionChange);
    onEngraveSlurSelectionChangeRef.current = onEngraveSlurSelectionChange;
    const onEngraveTextExpressionOffsetEditRef = useRef(onEngraveTextExpressionOffsetEdit);
    onEngraveTextExpressionOffsetEditRef.current = onEngraveTextExpressionOffsetEdit;
    /** Tracks the barline currently under the pointer in engrave mode (for hover highlight). */
    const engraveBarlineHoverRef = useRef<BarlineHit | null>(null);
    const engraveEyeHoverIdRef = useRef<string | null>(null);
    const engraveGhostRailHoverIdRef = useRef<string | null>(null);
    const engraveHoverFadeTRef = useRef(0);
    const [engraveHoverCursor, setEngraveHoverCursor] = useState(false);

    // Multi-staff ghost-rail popover: lifted out of GhostRailOverlay so the
    // overlay renders a SINGLE controlled popover (no per-rail DOM). The canvas
    // click handler hit-tests the rail ring and pushes the hit rail here; the
    // descriptor is frozen until the popover closes (so toggling a staff
    // visible doesn't collapse the popover under the user).
    const [openGhostRail, setOpenGhostRail] = useState<GhostRailDescriptor | null>(null);
    const onOpenGhostRailPopoverRef = useRef<((rail: DerivedGhostRail) => void) | undefined>(undefined);
    onOpenGhostRailPopoverRef.current = (rail: DerivedGhostRail) => {
      setOpenGhostRail({
        id: rail.id,
        systemMeasureId: rail.systemMeasureId,
        partIds: rail.partIds,
        partLabels: rail.partLabels,
        staffGroups: rail.staffGroups,
        staffGroupLabels: rail.staffGroupLabels,
        staffGroupHasMusic: rail.staffGroupHasMusic,
        cx: rail.cx,
        cy: rail.cy,
      });
    };

    const { startEngraveHoverFade } = useEngraveHoverFade({
      engraveEyeHoverIdRef,
      engraveGhostRailHoverIdRef,
      engraveHoverFadeTRef,
      repaint: () => repaintRef.current?.(),
    });
    /** Latest mapping of part index → MNX part id, for staff-eye hit-tests. */
    const partIdByIndexRef = useRef<readonly string[]>([]);

    const selection = useSelection();
    // Tracks whether a selection is active, read by the fast-layout callback to
    // rebuild the spatial index immediately (not on the typing debounce) so the
    // selection overlay tracks edited geometry instead of lagging one edit
    // behind (e.g. transposing a selected note).
    const selectionActiveRef = useRef(false);
    selectionActiveRef.current = selection.kind !== "none";
    const selectionActions = useSelectionActions();
    const { selectElement, extendSelection, toggleSelection, selectMeasure, extendMeasure, clearSelection } =
      selectionActions;

    const {
      state: noteInputState,
      setSlurStart,
      clearSlurStart,
      toggleSlur,
      setLastPitch,
      setCursor,
      setAccidental,
      toggleNoteInput,
    } = useNoteInput();

    const { mnxJson, score: docScore, dirty } = useDocument();
    const { updateScore } = useDocumentActions();
    const documentStore = useDocumentStoreApi();

    // Refs to avoid stale closures in keyboard/click handlers
    const docScoreRef = useRef(docScore);
    docScoreRef.current = docScore;
    useEffect(
      () =>
        documentStore.subscribe((state) => {
          docScoreRef.current = state.workingScore;
          partIdByIndexRef.current = (state.workingScore?.parts ?? []).map((part) => part.id ?? "");
        }),
      [documentStore],
    );
    // Latest selection-injection state, mirrored so the deferred patch-chain
    // pre-warm can read it without re-firing the initial-load effect on
    // selection changes.
    const selectedPartIdsRef = useRef(selectedPartIds);
    selectedPartIdsRef.current = selectedPartIds;
    const expandedCondensingStavesRef = useRef(expandedCondensingStaves);
    expandedCondensingStavesRef.current = expandedCondensingStaves;
    // Map part index → MNX part id (kept current for engrave eye-pill hit-tests).
    partIdByIndexRef.current = (docScore?.parts ?? []).map((p) => p.id ?? "");
    const noteInputActiveRef = useRef(noteInputState.active);
    noteInputActiveRef.current = noteInputState.active;
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const updateScoreRef = useRef(updateScore);
    updateScoreRef.current = updateScore;
    const setLastPitchRef = useRef(setLastPitch);
    setLastPitchRef.current = setLastPitch;

    // Stable user-interaction sink for the viewport gesture handlers. The
    // follow-playhead controller (created after useViewport, since it needs
    // setScroll) installs its detach handler into this ref.
    const followInteractRef = useRef<() => void>(() => {});
    const handleUserInteract = useCallback(() => followInteractRef.current(), []);
    // Horizontal spreads place the opening page at one page-width, leaving
    // intentional turn space before the first painted page. Exclude that
    // leading blank region from the horizontal scroll cap.
    const contentStartX =
      viewMode === "spread-h" && displayListRef.current?.pages && displayListRef.current.pages.length > 0
        ? displayListRef.current.width
        : 0;

    const { viewport, containerRef, isDragging, resetViewport, setZoom, setScroll, dragLockRef } = useViewport({
      contentWidth: contentSize.width,
      contentHeight: contentSize.height,
      contentStartX,
      initialZoom,
      // Anchor strategy: if the caller supplied an explicit scrollAnchor,
      // use it (Storybook snippets want centered framing). Otherwise pick a
      // sensible default per view mode for the editor:
      //   - print preview: centered both ways (PDF-viewer style)
      //   - horizon: x=start so music begins at the left, y=center so a
      //     single short staff is vertically centered in the viewport
      //   - page/spread: x=start, y=start so the page top-left lands in
      //     a predictable place when it fits inside the viewport
      scrollAnchor:
        scrollAnchor ??
        (printPreview ? "center" : viewMode === "horizon" ? { x: "start", y: "center" } : { x: "start", y: "start" }),
      safeArea,
      onUserInteract: handleUserInteract,
    });

    // Playback state for playhead overlay + keyboard shortcuts
    const playback = usePlaybackState();
    const playbackActions = usePlaybackActions();

    // Follow-the-playhead: keep the latest viewport in a ref for the per-frame
    // controller, then wire its detach handler back into the viewport gesture
    // sink declared above.
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const followEnabled = useFollowEnabled();
    const follow = useFollowPlayhead({
      enabled: followEnabled && !printPreview,
      status: playback.status,
      viewMode,
      viewportRef,
      containerRef,
      setScroll,
    });
    followInteractRef.current = follow.onUserInteract;

    // Keyboard shortcut: Space = play/pause (registered in central registry).
    // Escape no longer stops playback — it's reserved for selection/mode exit
    // (see useEditorKeyboard global Escape binding).
    usePlayPauseShortcut({
      playback,
      playbackActions,
      selection,
      noteInputActiveRef,
      docScoreRef,
    });

    useImperativeHandle(
      ref,
      () =>
        buildScoreCanvasHandle({
          setZoom,
          setScroll,
          resetViewport,
          scoreDefinitions,
          selectedScoreIndex,
          viewport,
          displayListRef,
          spatialIndexRef,
          canvasRef,
          containerRef,
          docScoreRef,
          viewMode,
        }),
      [setZoom, setScroll, resetViewport, scoreDefinitions, selectedScoreIndex, viewport, containerRef, viewMode],
    );

    // Notify parent of viewport / score-info / layouts / page-count changes,
    // and auto-shrink the zoom so content fits in the container width.
    useParentNotifications({
      viewport,
      scoreInfo,
      scoreDefinitions,
      displayListRef,
      displayListVersion,
      onViewportChange,
      onScoreInfoChange,
      onLayoutsChange,
      onPageCountChange,
      onPrintOverflowChange,
      pageSetupRef,
      viewMode,
    });
    useFitToWidthZoom({
      fitToWidth,
      containerWidth,
      contentWidth: contentSize.width,
      initialZoom,
      currentZoom: viewport.zoom,
      setZoom,
    });

    // ─── Pitch change callback (for Up/Down arrow keys) ─────
    const _handlePitchChange = useCallback(
      (partIndex: number, measureIndex: number, sequenceIndex: number, eventIndex: number, updatedNotes: Note[]) => {
        const score = docScoreRef.current;
        if (!score) return;
        const newScore = produce(score, (draft) => {
          const event = draft.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex]?.content[eventIndex];
          if (event && "notes" in event && event.notes) {
            event.notes = updatedNotes;
          }
        });
        if (newScore !== score) updateScore(newScore);
      },
      [updateScore],
    );

    // Keyboard shortcuts are handled by useEditorKeyboard in App.tsx

    // ─── Note input click handler ─────────────────
    const handleNoteInputClick = useCallback(
      (info: NoteInputClickInfo) => {
        if (!docScore) return;
        addNoteAtClick({
          info,
          score: docScore,
          noteInputState,
          spatialIndex: spatialIndexRef.current,
          displayList: displayListRef.current,
          selectedScoreIndex,
          updateScore,
          setCursor,
          setLastPitch,
          setAccidental,
          setSlurStart,
          clearSlurStart,
          toggleSlur,
          playbackActions,
        });
      },
      [
        docScore,
        noteInputState,
        updateScore,
        setSlurStart,
        clearSlurStart,
        toggleSlur,
        setCursor,
        setLastPitch,
        setAccidental,
        selectedScoreIndex,
        playbackActions,
      ],
    );

    // Initialize WASM, font, and glyph atlas on mount
    useEffect(
      () =>
        initWasmAndFont({
          atlasFontSize: ATLAS_FONT_SIZE,
          backendRef,
          glyphAtlasRef,
          pageCacheRef,
          emitLayoutDebug: useLayoutDebugStore.getState().enabled,
          keepLayoutBackendAlive,
          setWasmReady,
        }),
      [keepLayoutBackendAlive],
    );

    // Track container width for responsive resize (debounced)
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      setContainerWidth(Math.round(el.clientWidth));
      const observer = new ResizeObserver((entries) => {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => {
          for (const entry of entries) {
            setContainerWidth(Math.round(entry.contentRect.width));
          }
        }, 150);
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
        clearTimeout(resizeTimerRef.current);
      };
    }, [containerRef]);

    // Helper: compute display list for given MNX JSON and score index
    const computeDisplayList = useCallback(
      (mnxJson: string, info: ScoreInfo, scoreIdx: number, patchInfo?: PatchInfo) =>
        computeDisplayListImpl({
          mnxJson,
          info,
          scoreIdx,
          patchInfo,
          partIndex,
          viewMode,
          selectedPartIds,
          expandedCondensingStaves,
          score: docScoreRef.current,
          engine: backendRef.current,
          perfTracker: perfTrackerRef.current,
          setLayoutPerfDebug,
          pageSetupRef,
        }),
      [partIndex, viewMode, selectedPartIds, expandedCondensingStaves],
    );

    // Cached ScoreInfo to avoid re-calling WASM getScoreInfo on every edit
    const cachedScoreInfoRef = useRef<ScoreInfo | null>(null);
    // Track previous mnxJson to detect initial load vs incremental edit
    const prevMnxJsonRef = useRef<string>("");
    // Track the last mnxJson that was fast-painted to avoid duplicate work in useEffect
    const lastFastPaintedJsonRef = useRef<string>("");
    // JSON whose (async) fast layout is currently in flight. Set synchronously
    // by the fast-layout callback so the mnxJson useEffect doesn't redundantly
    // lay out — and re-apply the patch for — an edit the worker is still
    // processing.
    const pendingFastJsonRef = useRef<string>("");
    const lastScoreDefinitionRelayoutKeyRef = useRef<string>("");
    // mnxJson identity at the time of the last view-switch relayout. Lets the
    // view-switch effect detect that the engine layout is already current
    // (so switching among paged modes can skip the WASM relayout) even when no
    // edit has flowed through the fast-paint path that owns lastFastPaintedJsonRef.
    const lastViewRelayoutJsonRef = useRef<string>("");
    const lastContainerWidthRelayoutRef = useRef<number | null>(null);
    const lastDebugRelayoutKeyRef = useRef<string>("");
    // mnxJson whose FULL initial load has already run. The main effect re-fires
    // on view/score/width changes (with dirty===false, isInitialLoad is always
    // true), but only an actual *content* change warrants another full load —
    // view/score changes are owned by the view-switch effect. Without this,
    // every switch re-ran a multi-second WASM pass that committed score index 0
    // (the full score), flashing it over the selected part-score.
    const lastInitialLoadJsonRef = useRef<string>("");
    // mnxJson whose patch chain has already been pre-warmed (one throwaway
    // empty-patch re-seed after the initial load, so the first *user* edit
    // skips the one-time ~1s order re-seed). Guards against double-firing.
    const prewarmedJsonRef = useRef<string>("");
    // Last debug-enabled value actually applied. The debug-toggle effect depends
    // on viewMode/selectedScoreIndex (so a flip uses the current view), but those
    // changing must NOT trigger a relayout there — only an actual flag flip does.
    const lastDebugEnabledRef = useRef<boolean | null>(null);
    // Monotonic token for view-switch relayouts. Each switch increments it; a
    // background relayout only commits its display list if its captured token is
    // still the latest. This prevents a slower, older-selection relayout (e.g.
    // the full score) from resolving last and clobbering the part the user
    // actually switched to. (The layout worker is Comlink-serialized, but the
    // editor-side paint/commit is async, so completion order isn't guaranteed.)
    const viewSwitchTokenRef = useRef(0);

    // Repaint debounce/rAF refs (used by fast-layout path + paintNow scheduling).
    const rafRef = useRef(0);
    /** Debounce timer for spatial index rebuild during rapid edits. */
    const spatialDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Register synchronous fast-layout callback on the global perf tracker.
    // DocumentContext calls this from updateScore BEFORE React state updates,
    // eliminating the ~32ms react-schedule gap.
    useFastLayoutCallback({
      wasmReady,
      computeDisplayList,
      selectedScoreIndex,
      perfTrackerRef,
      cachedScoreInfoRef,
      displayListRef,
      displayListVersionRef,
      spatialIndexRef,
      rafRef,
      spatialDebounceRef,
      docScoreRef,
      paintNowRef,
      lastFastPaintedJsonRef,
      pendingFastJsonRef,
      interactionModeRef,
      selectionActiveRef,
    });

    // Ref to track selectedScoreIndex without triggering the main effect
    const selectedScoreIndexRef = useRef(selectedScoreIndex);
    selectedScoreIndexRef.current = selectedScoreIndex;
    const debugEnabled = useLayoutDebugStore((s) => s.enabled);

    // Compute display list when MNX JSON changes (from document context)
    useEffect(() => {
      if (!wasmReady || !mnxJson) return;
      const backend = backendRef.current;
      if (!backend) return;

      const isInitialLoad = !prevMnxJsonRef.current || !dirty;
      prevMnxJsonRef.current = mnxJson;

      // Skip if the fast-layout callback already painted this mnxJson — or is
      // still laying it out off-thread (pendingFastJsonRef). Without the
      // pending guard, this effect would re-run the same incremental patch
      // before the worker resolved, applying the edit twice.
      if (mnxJson === lastFastPaintedJsonRef.current || mnxJson === pendingFastJsonRef.current) {
        return;
      }

      // The layout coalescer (registered as `fastLayoutCallback`) owns ALL
      // content edits. During a fast-typed burst it *holds* the latest edit in
      // its pending buffer to collapse the burst onto the single worker — and a
      // held edit is NOT reflected in `pendingFastJsonRef` (the coalescer only
      // sets that when it *fires*, not when it accumulates). So the json-match
      // guard above leaks every held edit through to the fallback below, which
      // would dispatch an *uncoalesced, full* relayout per held edit — turning a
      // 6-keystroke burst into 6 serial multi-second full layouts (the "faster I
      // type, the slower it gets" meltdown). When the callback is registered,
      // defer to it: it guarantees the latest edit is eventually laid out
      // (trailing-edge drain), so nothing is dropped.
      if (!isInitialLoad && perfTrackerRef.current.fastLayoutCallback) {
        return;
      }

      // ── Fast path for incremental edits (fallback if callback wasn't registered) ──
      if (!isInitialLoad && cachedScoreInfoRef.current) {
        performance.mark("viritura:fast-effect-start");
        try {
          performance.measure("viritura:react-schedule", "viritura:setState-done", "viritura:fast-effect-start");
        } catch {
          /* ignore */
        }
        pendingFastJsonRef.current = mnxJson;
        void runFastLayoutAndPaint({
          json: mnxJson,
          computeDisplayList: (j) => computeDisplayList(j, cachedScoreInfoRef.current!, selectedScoreIndexRef.current),
          displayListRef,
          displayListVersionRef,
          spatialIndexRef,
          rafRef,
          spatialDebounceRef,
          docScoreRef,
          paintNowRef,
          perfTracker: perfTrackerRef.current,
        })
          .then(() => {
            lastFastPaintedJsonRef.current = mnxJson;
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (pendingFastJsonRef.current === mnxJson) pendingFastJsonRef.current = "";
          });
        return;
      }

      // ── Full path for initial load / file changes ──
      // Dedup: a full load is only warranted when the document CONTENT changes.
      // This effect also re-fires on view/score/width changes (dirty stays false
      // so isInitialLoad is always true), but those are owned by the view-switch
      // effect operating on the engine's retained score. Re-running a full load
      // here both wastes a multi-second WASM pass and commits the WRONG layout
      // (runInitialLoad lays out the score index passed below), flashing it over
      // the selected part-score.
      if (mnxJson === lastInitialLoadJsonRef.current) {
        return;
      }
      lastInitialLoadJsonRef.current = mnxJson;

      setLoading(true);
      setError(null);

      void runBackgroundTask("Laying out score…", () =>
        runInitialLoad({
          mnxJson,
          getScoreInfo: (j) => backend.getScoreInfo(j),
          computeDisplayList,
          viewMode,
          containerWidth,
          debugEnabled,
          selectedScoreIndex: selectedScoreIndexRef.current,
          cachedScoreInfoRef,
          displayListRef,
          spatialIndexRef,
          docScoreRef,
          perfTracker: perfTrackerRef.current,
          lastScoreDefinitionRelayoutKeyRef,
          lastViewRelayoutJsonRef,
          lastContainerWidthRelayoutRef,
          lastDebugRelayoutKeyRef,
          setScoreInfo,
          setScoreDefinitions,
          setContentSize,
          clearSelection,
        }),
      )
        .then(() => {
          setLoading(false);
          // Pre-warm the patch chain off the critical path: fire one throwaway
          // empty-patch re-seed so the user's first edit isn't the one paying
          // the ~1s order re-seed. Deferred to idle so it never delays the
          // initial paint, and skipped if a real edit already engaged the
          // chain (the edit does the re-seed itself) or the view changed.
          if (prewarmedJsonRef.current !== mnxJson) {
            prewarmedJsonRef.current = mnxJson;
            const schedule =
              typeof requestIdleCallback === "function"
                ? (cb: () => void) => requestIdleCallback(() => cb(), { timeout: 1000 })
                : (cb: () => void) => setTimeout(cb, 0);
            schedule(() => {
              // Bail if an edit already flowed through the fast path (it
              // re-seeded already) or one is in flight (it will).
              if (lastFastPaintedJsonRef.current === mnxJson) return;
              if (pendingFastJsonRef.current) return;
              void prewarmPatchChain({
                scoreIdx: selectedScoreIndexRef.current,
                viewMode,
                selectedPartIds: selectedPartIdsRef.current,
                expandedCondensingStaves: expandedCondensingStavesRef.current,
                score: docScoreRef.current,
                engine: backendRef.current,
                pageSetupRef,
              }).catch(() => {
                // Pre-warm is best-effort; a failure just means the first edit
                // pays the re-seed as before. Allow a retry on next load.
                if (prewarmedJsonRef.current === mnxJson) prewarmedJsonRef.current = "";
              });
            });
          }
        })
        .catch((err: unknown) => {
          // Allow a retry of this content on the next render.
          if (lastInitialLoadJsonRef.current === mnxJson) lastInitialLoadJsonRef.current = "";
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }, [
      mnxJson,
      partIndex,
      wasmReady,
      computeDisplayList,
      clearSelection,
      dirty,
      viewMode,
      containerWidth,
      debugEnabled,
    ]);

    useScoreViewRelayout({
      selectedScoreIndex,
      scoreDefinitions,
      wasmReady,
      mnxJson,
      viewMode,
      selectedPartIds,
      expandedCondensingStaves,
      computeDisplayList,
      backendRef,
      docScoreRef,
      pageSetupRef,
      cachedScoreInfoRef,
      displayListRef,
      displayListVersionRef,
      spatialIndexRef,
      paintNowRef,
      lastRelayoutKeyRef: lastScoreDefinitionRelayoutKeyRef,
      lastRelayoutJsonRef: lastViewRelayoutJsonRef,
      viewSwitchTokenRef,
      setContentSize,
      setDisplayListVersion,
    });

    // React to container-width changes (responsive resize). The engine layout
    // is INDEPENDENT of container width — the page width handed to the engine
    // comes from the score's page setup (or 0 in horizon mode), never from the
    // container (see resolvePageSetup). Container width only feeds the
    // fit-to-width *zoom* (parentEffects) and paint-time page placement, both
    // handled by the repaint path. So a width change must NOT trigger a full
    // WASM relayout: doing so re-parsed the (potentially huge) MNX and produced
    // an identical display list, and on engrave-mode entry the mount-time width
    // changes (0 → measured → panel animation) stacked several multi-second
    // relayouts that OOM-crashed the page. Recompute only the scroll content
    // size from the existing display list.
    useEffect(() => {
      if (!wasmReady || !mnxJson || containerWidth === 0) return;
      if (lastContainerWidthRelayoutRef.current === containerWidth) return;
      lastContainerWidthRelayoutRef.current = containerWidth;
      const dl = displayListRef.current;
      if (dl) setContentSize(contentSizeForMode(dl, viewMode));
    }, [containerWidth, wasmReady, mnxJson, viewMode]);

    // Re-layout when the spacing-debug "enabled" flag flips so the next
    // DisplayList carries (or drops) the layoutDebug sidecar. Without this,
    // toggling the panel wouldn't show the overlay until the next edit.
    useEffect(() => {
      if (!wasmReady || !mnxJson || scoreDefinitions.length === 0) return;
      // Only act on an ACTUAL debug-flag flip. This effect depends on
      // viewMode/selectedScoreIndex/computeDisplayList (so a flip re-lays-out the
      // current view), but those changing must NOT relayout here — the
      // view-switch effect owns view/score changes and the backend retains the
      // emit-debug flag, so its relayout already carries the sidecar. Without
      // this guard the effect committed an UNGUARDED display list on every view
      // and score switch, racing the view-switch relayout (it was a hidden third
      // committer behind the part-switch flicker).
      if (lastDebugEnabledRef.current === debugEnabled) return;
      lastDebugEnabledRef.current = debugEnabled;
      const backend = backendRef.current;
      if (!backend) return;
      // Propagate the debug flag to the (possibly worker-hosted) engine so the
      // next layout emits/drops the layoutDebug sidecar, then bust the cache so
      // the engine re-runs (its measure cache is independent of the flag).
      backend.setEmitLayoutDebug(debugEnabled);
      backend.invalidateCache();
      void runSecondaryRelayout({
        mnxJson,
        selectedScoreIndex,
        viewMode,
        computeDisplayList,
        getScoreInfo: (j) => backend.getScoreInfo(j),
        cachedScoreInfoRef,
        displayListRef,
        displayListVersionRef,
        spatialIndexRef,
        docScoreRef,
        paintNowRef,
        setDisplayListVersion, // no setContentSize for debug path
        forceDirectPaint: true,
      });
    }, [debugEnabled, wasmReady, mnxJson, computeDisplayList, selectedScoreIndex, scoreDefinitions.length, viewMode]);

    // Build set of selected element IDs for the overlay
    const selectedIds = useMemo(
      () => computeSelectedIds(selection, spatialIndexRef.current, docScoreRef.current),
      [selection],
    );

    // ─── Spanner handle drag state ─────────────────
    const spannerDragRef = useRef<{
      hit: SpannerHandleHit;
      dragX: number;
      bbox: { x: number; y: number; width: number; height: number };
      snapPoints: Array<{ x: number; beat: number; measureIndex: number }>;
      altKey: boolean;
    } | null>(null);

    // ─── Slur bezier-handle drag state (engrave mode) ─────────────
    /**
     * Per-handle (p0/p1/p2/p3) drag of a slur's bezier spine. While a drag is
     * active, the base painter suppresses the original tagged command and
     * paintEngraveAdornments asks Rust to cut a filled preview from the live
     * handle delta. On drop, the pixel delta is converted to spatia using `sp`
     * and composed with any existing override so user edits accumulate.
     */
    const slurHandleDragRef = useRef<import("./paintScoreFrame").SlurHandleDragState | null>(null);
    /** `${elementId}::p0|p1|p2|p3` of the slur handle currently under the cursor (engrave mode hover). */
    const hoverSlurHandleKeyRef = useRef<string | null>(null);
    /**
     * Live text-expression drag state (engrave mode). While a drag is active,
     * paintEngraveAdornments reads `dxPx`/`dyPx` to draw a translucent ghost of
     * the element's bbox translated by the in-progress drag, so the move
     * previews before it commits (mirrors the slur handle drag preview).
     */
    const textExpressionDragRef = useRef<import("./paintScoreFrame").TextExpressionDragState | null>(null);
    /**
     * Element id of the currently selected slur in engrave mode. Only when set
     * do bezier handles become visible / interactive. Cleared by clicking empty
     * canvas or another slur. The state mirror exists so the context menu and
     * other React-driven UI can react to changes.
     */
    const selectedSlurIdRef = useRef<string | null>(null);
    const [, setSelectedSlurIdState] = useState<string | null>(null);
    const setSelectedSlurId = useCallback((id: string | null) => {
      if (selectedSlurIdRef.current === id) return;
      selectedSlurIdRef.current = id;
      setSelectedSlurIdState(id);
      onEngraveSlurSelectionChangeRef.current?.(id);
      repaintRef.current?.();
    }, []);
    useEffect(() => {
      if (interactionMode !== "write") return;
      const writeSlurId =
        selection.kind === "single" && selection.elementId.startsWith("slur/") ? selection.elementId : null;
      setSelectedSlurId(writeSlurId);
    }, [interactionMode, selection, setSelectedSlurId]);
    const commitSlurReanchor = useCallback(
      (slurElementId: string, end: "start" | "end", newEventId: string) => {
        const score = docScoreRef.current;
        if (!score) return;
        const nextElementId = reanchoredSlurElementId(score, slurElementId, end, newEventId);
        if (!nextElementId || nextElementId === slurElementId) return;
        const nextScore = reanchorSlurInScore(score, slurElementId, end, newEventId);
        if (nextScore === score) return;

        const externalCommit = onEngraveSlurReanchorRef.current;
        if (externalCommit) externalCommit(slurElementId, end, newEventId);
        else updateScore(nextScore);

        setSelectedSlurId(nextElementId);
        if (interactionModeRef.current === "write") selectElement(nextElementId);
      },
      [selectElement, setSelectedSlurId, updateScore],
    );
    /** Open context menu (anchored at the right-clicked screen pos) for the selected slur. */
    const [slurContextMenu, setSlurContextMenu] = useState<ContextMenuState | null>(null);

    /**
     * Build snap points for the spanner drag ruler — body lives in
     * dragSnapPoints.ts.
     */
    const buildDragSnapPoints = useCallback(
      (partIndex: number, fine: boolean) =>
        buildDragSnapPointsImpl(
          docScoreRef.current,
          spatialIndexRef.current,
          displayListRef.current?.measureBounds,
          partIndex,
          fine,
        ),
      [],
    );
    // Repaint on viewport or content changes
    /** Track previous zoom to detect active zooming and bypass tiles. */
    const prevZoomRef = useRef(viewport.zoom);
    /** Timer for deferred tile warm-up after zoom gesture ends. */
    const zoomTileTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const performanceOverlayEnabled = useDebugSettingsStore((s) => s.performanceOverlay);
    const hitboxOverlayEnabled = useDebugSettingsStore((s) => s.hitboxOverlay);
    const tileCacheDisabled = useDebugSettingsStore((s) => s.tileCacheDisabled);

    /**
     * Core paint logic — can be called synchronously or from rAF.
     * Body lives in `paintScoreFrame.ts`; this wrapper just gathers refs/state.
     * @param forceDirect If true, bypass tile cache for a fast single-frame render.
     */
    const paintNow = useCallback(
      (forceDirect = false) => {
        performance.mark("viritura:paint-callback-entry");
        try {
          performance.measure(
            "viritura:paint-callback-dispatch",
            "viritura:raf-callback",
            "viritura:paint-callback-entry",
          );
        } catch {
          /* optional performance telemetry */
        }
        const canvas = canvasRef.current;
        const dl = displayListRef.current;
        if (!canvas || !dl) return;
        const firstSelectedId = selectedIds?.values().next().value;
        performance.mark("viritura:paint-callback-ready");
        paintScoreFrame({
          canvas,
          container: containerRef.current,
          displayList: dl,
          forceDirect,
          viewport,
          prevZoomRef,
          selectedIds,
          selectionVoiceIndex: selectionVoiceIndex(docScoreRef.current, firstSelectedId),
          selection,
          viewMode,
          printPreview,
          safeAreaLeft: safeArea?.left ?? 0,
          hitboxOverlayEnabled,
          performanceOverlayEnabled,
          interactionMode: interactionModeRef.current,
          perfTracker: perfTrackerRef.current,
          tileCache: tileCacheRef.current,
          glyphAtlas: glyphAtlasRef.current,
          spatialIndex: spatialIndexRef.current,
          displayListVersion: displayListVersionRef.current,
          pageSetup: pageSetupRef.current,
          engraveBarlineHover: engraveBarlineHoverRef.current,
          engraveAdornments: engraveAdornmentsRef.current,
          selectedEngraveMarkerId: selectedEngraveMarkerIdRef.current,
          partIdByIndex: partIdByIndexRef.current,
          engraveEyeHoverId: engraveEyeHoverIdRef.current,
          engraveGhostRailHoverId: engraveGhostRailHoverIdRef.current,
          engraveHoverFadeT: engraveHoverFadeTRef.current,
          slurHandleDrag: slurHandleDragRef.current,
          hoverSlurHandleKey: hoverSlurHandleKeyRef.current,
          selectedSlurId: selectedSlurIdRef.current,
          textExpressionDrag: textExpressionDragRef.current,
          spannerDrag: spannerDragRef.current,
          stickyClefCache: stickyClefCacheRef.current,
        });
      },
      [
        viewport,
        containerRef,
        selectedIds,
        viewMode,
        selection,
        hitboxOverlayEnabled,
        performanceOverlayEnabled,
        printPreview,
        safeArea?.left,
      ],
    );

    paintNowRef.current = paintNow;

    /** Schedule a repaint on the next animation frame (for scroll/zoom/selection changes). */
    const repaint = useCallback(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        performance.mark("viritura:raf-callback");
        try {
          performance.measure("viritura:raf-wait", "viritura:repaint-call", "viritura:raf-callback");
        } catch {
          /* ignore */
        }
        paintNow();

        // After zoom gesture ends, warm up tiles with a debounced follow-up.
        // During active zooming, paintNow uses direct render (zoomChanged=true),
        // so tiles aren't built. Once zoom stabilizes, this timer fires to
        // pre-render tiles for smooth subsequent scrolling.
        clearTimeout(zoomTileTimerRef.current);
        zoomTileTimerRef.current = setTimeout(() => {
          if (!isTileCacheDisabled()) {
            // Trigger a non-forced repaint to build tiles at the settled zoom
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
              paintNowRef.current();
              const renderPending = () => {
                if (!isTileCacheDisabled() && tileCacheRef.current.hasPendingTiles) {
                  rafRef.current = requestAnimationFrame(() => {
                    paintNowRef.current();
                    renderPending();
                  });
                }
              };
              renderPending();
            });
          }
        }, 150);

        // Continue rendering pending tiles across subsequent frames
        const renderPending = () => {
          if (!isTileCacheDisabled() && tileCacheRef.current.hasPendingTiles) {
            rafRef.current = requestAnimationFrame(() => {
              paintNowRef.current();
              renderPending();
            });
          }
        };
        renderPending();
      });
    }, [paintNow]);
    repaintRef.current = repaint;

    useEffect(() => {
      if (!loading && displayListRef.current) {
        repaint();
      }
      return () => {
        cancelAnimationFrame(rafRef.current);
        clearTimeout(zoomTileTimerRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- timeout handle ref, intentional
        clearTimeout(spatialDebounceRef.current);
      };
    }, [loading, repaint, selectedIds]);

    // Repaint when theme changes so workspace background and tile cache refresh
    const theme = useThemeStore((s) => s.theme);
    useEffect(() => {
      if (!loading && displayListRef.current) {
        repaintRef.current?.();
      }
    }, [theme, loading]);

    useEffect(() => {
      if (!loading && displayListRef.current) {
        repaintRef.current?.();
      }
    }, [performanceOverlayEnabled, hitboxOverlayEnabled, tileCacheDisabled, loading]);

    // Repaint when perf overlay is toggled from settings or the console helper.
    useEffect(() => {
      const handler = () => repaint();
      window.addEventListener("viritura:perf-toggle", handler);
      return () => window.removeEventListener("viritura:perf-toggle", handler);
    }, [repaint]);

    // Repaint when the paper-background pattern finishes loading. First paint
    // falls back to a cream solid fill; once the noise tile is rasterized we
    // re-render so the paper texture comes in.
    useEffect(() => {
      const handler = () => repaintRef.current?.();
      window.addEventListener("viritura:paper-ready", handler);
      return () => window.removeEventListener("viritura:paper-ready", handler);
    }, []);

    // Repaint when engrave-mode adornments change (markers list, mode toggle, selection)
    useEffect(() => {
      if (!loading && displayListRef.current) repaintRef.current?.();
    }, [interactionMode, engraveAdornments, selectedEngraveMarkerId, loading]);

    // Track whether a drag occurred between mousedown and mouseup
    const dragOccurredRef = useRef(false);
    const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);

    // ─── Commit spanner drag (body in commitSpannerDrag.ts) ──────────
    const commitSpannerDrag = useCallback(
      (hit: SpannerHandleHit, dragX: number) => {
        const score = docScoreRef.current;
        if (!score) return;
        const snapPoints = spannerDragRef.current?.snapPoints ?? [];
        const newScore = commitSpannerDragImpl(score, hit, dragX, snapPoints);
        if (newScore !== score) updateScore(newScore);
      },
      [updateScore],
    );
    // ─── Canvas pointer handlers (bodies live in canvasHandlers.ts) ───
    const canvasHandlerCtx: CanvasHandlerCtx = useMemo(
      () => ({
        viewport,
        viewMode,
        selectedIds,
        performanceOverlayEnabled,
        canvasRef,
        spatialIndexRef,
        displayListRef,
        displayListVersionRef,
        perfTrackerRef,
        dragOccurredRef,
        mouseDownPosRef,
        dragLockRef,
        spannerDragRef,
        slurHandleDragRef,
        textExpressionDragRef,
        interactionModeRef,
        pageSetupRef,
        engraveAdornmentsRef,
        partIdByIndexRef,
        selectedSlurIdRef,
        engraveBarlineHoverRef,
        engraveEyeHoverIdRef,
        engraveGhostRailHoverIdRef,
        hoverSlurHandleKeyRef,
        repaintRef,
        onEngraveStaffEyeClickRef,
        onOpenGhostRailPopoverRef,
        onEngraveMarkerClickRef,
        onEngraveBarlineClickRef,
        onEngraveBarlineHoverRef,
        onEngraveEmptyClickRef,
        onEngraveSlurShapeEditRef,
        onEngraveSlurShapeResetRef,
        onEngraveTextExpressionOffsetEditRef,
        docScoreRef,
        repaint,
        commitSlurReanchor,
        setSelectedSlurId,
        selectElement,
        extendSelection,
        toggleSelection,
        clearSelection,
        selectMeasure,
        extendMeasure,
        toggleNoteInput,
        commitSpannerDrag,
        buildDragSnapPoints,
        startEngraveHoverFade,
        setEngraveHoverCursor,
        setSlurContextMenu,
      }),
      [
        viewport,
        viewMode,
        selectedIds,
        performanceOverlayEnabled,
        canvasRef,
        dragLockRef,
        repaint,
        commitSlurReanchor,
        setSelectedSlurId,
        selectElement,
        extendSelection,
        toggleSelection,
        clearSelection,
        selectMeasure,
        extendMeasure,
        toggleNoteInput,
        commitSpannerDrag,
        buildDragSnapPoints,
        startEngraveHoverFade,
      ],
    );

    const handleCanvasClick = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => handleCanvasClickImpl(e, canvasHandlerCtx),
      [canvasHandlerCtx],
    );
    const handleCanvasDoubleClick = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => handleCanvasDoubleClickImpl(e, canvasHandlerCtx),
      [canvasHandlerCtx],
    );
    const handleCanvasMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => handleCanvasMouseDownImpl(e, canvasHandlerCtx),
      [canvasHandlerCtx],
    );
    const handleCanvasMouseUp = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => handleCanvasMouseUpImpl(e, canvasHandlerCtx),
      [canvasHandlerCtx],
    );
    const handleCanvasMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => handleCanvasMouseMoveImpl(e, canvasHandlerCtx),
      [canvasHandlerCtx],
    );
    const handleCanvasMouseLeave = useCallback(() => handleCanvasMouseLeaveImpl(canvasHandlerCtx), [canvasHandlerCtx]);
    const handleCanvasContextMenu = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => handleCanvasContextMenuImpl(e, canvasHandlerCtx),
      [canvasHandlerCtx],
    );
    // Close any open ghost-rail popover when leaving engrave mode (the overlay
    // only renders in engrave, so a stale descriptor would otherwise reappear
    // on return).
    useEffect(() => {
      if (interactionMode !== "engrave") setOpenGhostRail(null);
    }, [interactionMode]);

    const handleGhostRailToggle = useCallback((systemMeasureId: string, partId: string, nextVisible: boolean) => {
      onEngraveStaffEyeClickRef.current?.({
        id: `ghost:${systemMeasureId}|${partId}`,
        systemMeasureId,
        partId,
        // `visible` is the *current* state on the StaffEyeHit contract.
        // The EngraveView handler will flip it, so pass the opposite of
        // what we want.
        visible: !nextVisible,
      });
    }, []);

    return (
      <div ref={containerRef} style={SCORE_ROOT_STYLE}>
        {!wasmReady && !isWasmReady() && <div style={SCORE_LOADING_STYLE}>Loading WASM engine...</div>}
        {loading && wasmReady && <div style={SCORE_LOADING_STYLE}>Loading score...</div>}
        {error && <div style={SCORE_ERROR_STYLE}>Error loading score: {error}</div>}
        <div style={SCORE_CANVAS_WRAP_STYLE}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onClick={printPreview ? undefined : handleCanvasClick}
            onDoubleClick={printPreview ? undefined : handleCanvasDoubleClick}
            onMouseDown={printPreview ? undefined : handleCanvasMouseDown}
            onMouseUp={printPreview ? undefined : handleCanvasMouseUp}
            onMouseMove={printPreview ? undefined : handleCanvasMouseMove}
            onMouseLeave={printPreview ? undefined : handleCanvasMouseLeave}
            onContextMenu={printPreview ? undefined : handleCanvasContextMenu}
            onAuxClick={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            style={scoreCanvasElementStyle(
              !(loading || !wasmReady),
              printPreview
                ? "default"
                : isDragging
                  ? "grabbing"
                  : interactionMode === "engrave"
                    ? engraveHoverCursor
                      ? "pointer"
                      : "default"
                    : noteInputState.active
                      ? "crosshair"
                      : "default",
              printPreview,
              theme,
            )}
          />
          {!printPreview && (
            <InputCursor
              displayList={displayListRef.current}
              scrollX={viewport.scrollX}
              scrollY={viewport.scrollY}
              zoom={viewport.zoom}
              onClick={noteInputState.active ? handleNoteInputClick : undefined}
              spatialIndex={spatialIndexRef.current}
              score={docScore}
              onHoverBeat={onHoverBeat}
            />
          )}
          <PlayheadOverlay
            playheadPosition={playback.playheadPosition}
            displayList={displayListRef.current}
            scrollX={viewport.scrollX}
            scrollY={viewport.scrollY}
            zoom={viewport.zoom}
            viewMode={viewMode}
            onPlayheadRect={follow.onPlayheadRect}
          />
          <FollowPlayheadButton visible={follow.detached} onClick={follow.reengage} />
          {!printPreview && onToggleCondensedStaff && (
            <CondensedStaffToggles
              score={docScore}
              displayList={displayListRef.current}
              selectedScoreIndex={selectedScoreIndex}
              expanded={expandedCondensingStaves ?? EMPTY_EXPANDED}
              onToggle={onToggleCondensedStaff}
              scrollX={viewport.scrollX}
              scrollY={viewport.scrollY}
              zoom={viewport.zoom}
              viewMode={viewMode}
              safeAreaLeft={safeArea?.left ?? 0}
            />
          )}
          {interactionMode === "engrave" && (
            <GhostRailOverlay
              openRail={openGhostRail}
              zoom={viewport.zoom}
              scrollX={viewport.scrollX}
              scrollY={viewport.scrollY}
              ringSize={24}
              onClose={() => setOpenGhostRail(null)}
              onTogglePart={handleGhostRailToggle}
            />
          )}
        </div>
        <ContextMenu state={slurContextMenu} onClose={() => setSlurContextMenu(null)} />
      </div>
    );
  },
);
