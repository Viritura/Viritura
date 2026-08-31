import { useMemo, type RefObject, type MutableRefObject } from "react";
import { buildJumpBarActions } from "../jumpBar";
import { selectAllRange } from "../store/selectionUtils";
import { resolveEventLocation } from "../score/ElementPath";
import { openDialog, toggleDialog } from "../store/dialogStore";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { ActivityView } from "../components/activityRegistry";
import { openSettings } from "../components/SettingsDialog";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { RadialMenuCategory } from "../radialMenu";
import type { TempoPopoverState, StaffTextPopoverState } from "./useAppKeyboardWiring";
import { useJumpBarDestinations } from "./useJumpBarDestinations";

interface LyricStateRef {
  elementId: string;
  lineId: string;
}

export interface JumpBarActionsDeps {
  /** Create a named project folder, initialize its score and history, then open Setup mode. */
  onNewScore: () => void;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  rightPanelRef: RefObject<PanelImperativeHandle | null>;
  mousePositionRef: MutableRefObject<{ x: number; y: number }>;
  store: DocumentStore;
  selection: SelectionState;
  currentZoom: number;
  undo: () => void;
  redo: () => void;
  selectRange: (start: string, end: string) => void;
  handleOpenFile: () => void | Promise<void>;
  handleOpenProject: () => void | Promise<void>;
  handleSave: () => void | Promise<void>;
  handleSaveAs: () => void | Promise<void>;
  handleExportPdf: () => void | Promise<void>;
  handleExportSvg: () => void | Promise<void>;
  handleCopy: () => void | Promise<void>;
  handleCut: () => void | Promise<void>;
  handlePaste: () => void | Promise<void>;
  handleRepeat: () => void;
  getSelectedMeasureIndex: () => number | null;
  setRadialMenu: (m: { category: RadialMenuCategory; position: { x: number; y: number } } | null) => void;
  setTempoPopover: (s: TempoPopoverState | null) => void;
  setStaffTextPopover: (s: StaffTextPopoverState | null) => void;
  setLyricMode: (b: boolean) => void;
  setLyricState: (s: LyricStateRef | null) => void;
  onOpenActivity: (view: ActivityView) => void;
  onSwitchScore: (index: number) => void;
}

export function useJumpBarActions(deps: JumpBarActionsDeps): ReturnType<typeof buildJumpBarActions> {
  const destinations = useJumpBarDestinations();
  const {
    canvasRef,
    leftPanelRef,
    rightPanelRef,
    mousePositionRef,
    store,
    selection,
    currentZoom,
    undo,
    redo,
    selectRange,
    handleOpenFile,
    handleOpenProject,
    handleSave,
    handleSaveAs,
    handleExportPdf,
    handleExportSvg,
    handleCopy,
    handleCut,
    handlePaste,
    handleRepeat,
    getSelectedMeasureIndex,
    setRadialMenu,
    setTempoPopover,
    setStaffTextPopover,
    setLyricMode,
    setLyricState,
    onNewScore,
    onOpenActivity,
    onSwitchScore,
  } = deps;

  return useMemo(
    () =>
      buildJumpBarActions(
        {
          newScore: () => onNewScore(),
          openProject: () => {
            void handleOpenProject();
          },
          openFile: () => {
            void handleOpenFile();
          },
          save: () => {
            void handleSave();
          },
          saveAs: () => {
            void handleSaveAs();
          },
          exportPdf: () => {
            void handleExportPdf();
          },
          exportSvg: () => {
            void handleExportSvg();
          },
          undo,
          redo,
          copy: () => {
            void handleCopy();
          },
          cut: () => {
            void handleCut();
          },
          paste: () => {
            void handlePaste();
          },
          selectAll: () => {
            const { score } = store.getState();
            if (score) {
              const range = selectAllRange(score);
              if (range) selectRange(range.startElementId, range.endElementId);
            }
          },
          deleteSelection: () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
          },
          transpose: () => openDialog("transpose"),
          splitOrchestralStaves: () => openDialog("orchestralStaffSplit"),
          zoomIn: () => {
            const z = Math.min(currentZoom * 1.25, MAX_ZOOM);
            canvasRef.current?.setZoom(z);
          },
          zoomOut: () => {
            const z = Math.max(currentZoom / 1.25, MIN_ZOOM);
            canvasRef.current?.setZoom(z);
          },
          resetZoom: () => canvasRef.current?.resetViewport(),
          togglePanels: () => {
            const lp = leftPanelRef.current;
            const rp = rightPanelRef.current;
            const anyExpanded = (lp && !lp.isCollapsed()) || (rp && !rp.isCollapsed());
            if (anyExpanded) {
              lp?.collapse();
              rp?.collapse();
            } else {
              lp?.expand();
              rp?.expand();
            }
          },
          showHelp: () => openDialog("help"),
          toggleSourceView: () => toggleDialog("source"),
          toggleNoteInput: () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
          },
          openClefMenu: () => setRadialMenu({ category: "clef", position: { ...mousePositionRef.current } }),
          openBarlineMenu: () => setRadialMenu({ category: "barline", position: { ...mousePositionRef.current } }),
          openKeySignatureMenu: () =>
            setRadialMenu({ category: "key-signature", position: { ...mousePositionRef.current } }),
          openTimeSignatureMenu: () =>
            setRadialMenu({ category: "time-signature", position: { ...mousePositionRef.current } }),
          openDynamicsMenu: () => setRadialMenu({ category: "dynamic", position: { ...mousePositionRef.current } }),
          openOrnamentsMenu: () => setRadialMenu({ category: "ornament", position: { ...mousePositionRef.current } }),
          openTupletMenu: () => setRadialMenu({ category: "tuplet", position: { ...mousePositionRef.current } }),
          openBreathFermataMenu: () =>
            setRadialMenu({ category: "breath-fermata", position: { ...mousePositionRef.current } }),
          openFingeringMenu: () => setRadialMenu({ category: "fingering", position: { ...mousePositionRef.current } }),
          openArticulationMenu: () =>
            setRadialMenu({ category: "articulation", position: { ...mousePositionRef.current } }),
          openRepeatsMenu: () => setRadialMenu({ category: "repeat", position: { ...mousePositionRef.current } }),
          setTempo: () => {
            const idx = getSelectedMeasureIndex() ?? 0;
            const { score } = store.getState();
            const existing = score?.global.measures[idx]?.tempos?.[0];
            setTempoPopover({
              position: { ...mousePositionRef.current },
              initialValue: existing?.bpm?.toString() ?? "",
              measureIndex: idx,
              base: existing?.value?.base ?? "quarter",
              dots: existing?.value?.dots ?? 0,
            });
          },
          addStaffText: () => {
            const { score } = store.getState();
            if (!score || selection.kind !== "single") return;
            const loc = resolveEventLocation(selection.elementId, score);
            if (!loc) return;
            setStaffTextPopover({
              position: { ...mousePositionRef.current },
              partIndex: loc.partIndex,
              measureIndex: loc.measureIndex,
              sequenceIndex: loc.sequenceIndex,
              eventIndex: loc.eventIndex,
            });
          },
          enterLyrics: () => {
            const { score } = store.getState();
            if (score && selection.kind === "single") {
              setLyricMode(true);
              setLyricState({ elementId: selection.elementId, lineId: "1" });
            }
          },
          repeatSelection: handleRepeat,
          goToActivity: onOpenActivity,
          switchScore: onSwitchScore,
          openSettings,
        },
        destinations,
      ),
    [
      store,
      selection,
      currentZoom,
      undo,
      redo,
      selectRange,
      handleOpenFile,
      handleOpenProject,
      handleSave,
      handleSaveAs,
      handleExportPdf,
      handleExportSvg,
      handleCopy,
      handleCut,
      handlePaste,
      handleRepeat,
      getSelectedMeasureIndex,
      canvasRef,
      leftPanelRef,
      rightPanelRef,
      mousePositionRef,
      setRadialMenu,
      setTempoPopover,
      setStaffTextPopover,
      setLyricMode,
      setLyricState,
      onNewScore,
      onOpenActivity,
      onSwitchScore,
      destinations,
    ],
  );
}
