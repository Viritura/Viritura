import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Slider } from "@viritura/ui";
import { ToolbarPortal } from "../components/AppShell";
import { WorkspaceToolbar } from "../components/WorkspaceToolbar";
import { ScoreSwitcherPicker } from "../scoreSwitcher";
import { ProjectFileSwitcher } from "../projectFiles";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { ClickControls } from "./ClickControls";
import { ClickScoreControls, type ClickScoreSettings } from "./ClickScoreControls";
import { FloatingTransport } from "./FloatingTransport";
import { clickBarAtTime, clickScorePosition, clickStartPosition } from "./barNavigation";
import { useClickPlayer } from "./useClickPlayer";
import { useClickSpaceShortcut } from "./useClickSpaceShortcut";
import { useExclusiveClickAudio } from "./useExclusiveClickAudio";
import { publishClickCanvasConfig, publishClickCanvasPlayback } from "../store/clickCanvasStore";
import { useProjectStore } from "../store/projectStore";
import { ClickScoreInteractions } from "./ClickScoreInteractions";
import styles from "./ClickView.module.css";

function statusLabel(
  phase: ReturnType<typeof useClickPlayer>["phase"],
  busy: boolean,
  countingOff: boolean,
  tempoPercent: number,
  document: ReturnType<typeof useClickPlayer>["document"],
): string {
  if (busy) return "Preparing";
  if (countingOff) return "Counting off";
  if (document && tempoPercent === 0) return "Set tempo above 0% to start";
  return { empty: "", ready: "Ready", playing: "Playing", complete: "Finished" }[phase];
}

type ClickPlayer = ReturnType<typeof useClickPlayer>;

/** Where the dials and playhead point: the live click clock while playing, otherwise the chosen start. */
function clickCursor(player: ClickPlayer, active: boolean) {
  const { document, program, elapsed, tempoPercent, startBar } = player;
  if (active && document && program) {
    return {
      countingOff: elapsed < program.countoffSeconds,
      barIndex: clickBarAtTime(document.timing, program, elapsed, tempoPercent),
      scorePosition: clickScorePosition(document.timing, program, elapsed, tempoPercent),
    };
  }
  return {
    countingOff: false,
    barIndex: startBar,
    scorePosition: document ? clickStartPosition(document.timing, startBar) : { measureIndex: 0, beat: 0 },
  };
}

function canStartClick(player: ClickPlayer, dialSettling: boolean): boolean {
  return !player.busy && !dialSettling && player.tempoPercent > 0 && player.document !== undefined;
}

interface ClickSettingsBarProps {
  readonly player: ClickPlayer;
  readonly views: NonNullable<ClickPlayer["document"]>["scoreViews"];
  readonly hidden: boolean;
  readonly statusId: string;
  readonly settings: ClickScoreSettings;
  readonly onSettingsChange: (settings: ClickScoreSettings) => void;
}

/** Session tempo and score view controls; hidden during a take so only the transport remains. */
function ClickSettingsBar({ player, views, hidden, statusId, settings, onSettingsChange }: ClickSettingsBarProps) {
  const tempoId = useId();
  const entries = useMemo(
    () => views.map((view, index) => ({ index, name: view.label, isScore: view.isScore })),
    [views],
  );
  return (
    <ToolbarPortal>
      <div className={styles.toolbar} role="group" aria-label="Click settings" hidden={hidden}>
        <WorkspaceToolbar
          left={
            <>
              <ProjectFileSwitcher className={styles.filePicker} disabled={hidden || player.busy} />
              <div className={styles.scorePicker}>
                <ScoreSwitcherPicker
                  entries={entries}
                  selectedScoreIndex={settings.viewIndex}
                  onSelectScore={(viewIndex) => onSettingsChange({ ...settings, viewIndex })}
                  disabled={hidden || player.busy}
                />
              </div>
            </>
          }
          right={
            <fieldset className={styles.tempo} disabled={hidden || player.busy}>
              <label htmlFor={tempoId}>Session tempo %</label>
              <Slider
                id={tempoId}
                min={0}
                max={100}
                step={1}
                value={player.tempoPercent}
                onChange={player.setTempoPercent}
                ariaDescribedBy={statusId}
              />
              <output htmlFor={tempoId} aria-label="Session tempo percentage">
                {player.tempoPercent}%
              </output>
            </fieldset>
          }
        />
      </div>
    </ToolbarPortal>
  );
}

const DEFAULT_SCORE_SETTINGS: ClickScoreSettings = {
  viewIndex: 0,
  viewMode: "horizon",
  zoom: 1,
  fitMode: "height",
  fitRequest: 0,
};

// The status zone enables pointer events and transforms on its direct children;
// the full-screen controller host must remain pass-through and viewport-anchored.
const CONTROLLER_STYLE: CSSProperties = { pointerEvents: "none", transform: "none" };

function applyScoreSettings(
  next: ClickScoreSettings,
  current: ClickScoreSettings,
  canvasRef: RefObject<ScoreCanvasHandle | null>,
  setScoreSettings: (settings: ClickScoreSettings) => void,
): void {
  if (next.zoom !== current.zoom) canvasRef.current?.setZoom(next.zoom);
  setScoreSettings(next);
}

interface ClickViewProps {
  /** Serialized MNX of the open document. */
  readonly mnx: string;
  readonly canvasRef?: RefObject<ScoreCanvasHandle | null>;
  readonly canvasZoom?: number;
}

/** Click activity: a click-only recording transport for the open document. */
export function ClickView({ mnx, canvasRef, canvasZoom }: ClickViewProps) {
  const fallbackCanvasRef = useRef<ScoreCanvasHandle | null>(null);
  const activeCanvasRef = canvasRef ?? fallbackCanvasRef;
  const releaseOtherAudio = useExclusiveClickAudio();
  const scoreKey = useProjectStore((state) => state.activeScorePath);
  const player = useClickPlayer(mnx, { releaseOtherAudio, scoreKey });
  const [dialSettling, setDialSettling] = useState(false);
  const [storedScoreSettings, setScoreSettings] = useState(DEFAULT_SCORE_SETTINGS);
  const scoreSettings = { ...storedScoreSettings, zoom: canvasZoom ?? storedScoreSettings.zoom };
  const [settingsViews, setSettingsViews] = useState(player.document?.scoreViews);
  if (settingsViews !== player.document?.scoreViews) {
    setSettingsViews(player.document?.scoreViews);
    if (scoreSettings.viewIndex >= (player.document?.scoreViews.length ?? 0)) {
      setScoreSettings({ ...scoreSettings, viewIndex: 0 });
    }
  }
  const statusId = useId();
  const active = player.phase === "playing";
  const canStart = canStartClick(player, dialSettling);
  useClickSpaceShortcut(() => {
    if (active && !player.busy) void player.stop();
    else if (!active && canStart) void player.play();
  });
  const { countingOff, barIndex, scorePosition } = clickCursor(player, active);
  const status = statusLabel(player.phase, player.busy, countingOff, player.tempoPercent, player.document);
  const selectedView = player.document?.scoreViews[scoreSettings.viewIndex];

  useEffect(() => {
    publishClickCanvasConfig({
      selectedScoreIndex: selectedView?.scoreIndex ?? 0,
      selectedPartIds: selectedView?.partId ? [selectedView.partId] : undefined,
      sourcePartIndex: selectedView?.partIndex,
      viewMode:
        scoreSettings.viewMode === "spread-horizontal" || scoreSettings.viewMode === "horizontal"
          ? "spread-h"
          : scoreSettings.viewMode,
      pageSetup: selectedView?.pageSetup,
      fitToView: scoreSettings.fitMode !== "none",
      fitRequest: scoreSettings.fitRequest,
      onSelectMeasure: player.selectScoreMeasure,
    });
  }, [
    selectedView,
    scoreSettings.viewMode,
    scoreSettings.fitMode,
    scoreSettings.fitRequest,
    player.selectScoreMeasure,
  ]);

  useEffect(() => {
    publishClickCanvasPlayback({ active, position: scorePosition });
  }, [active, scorePosition]);

  function changeScoreSettings(next: ClickScoreSettings): void {
    applyScoreSettings(next, scoreSettings, activeCanvasRef, setScoreSettings);
  }

  return (
    <>
      {player.document && (
        <ClickSettingsBar
          player={player}
          views={player.document.scoreViews}
          hidden={active}
          statusId={statusId}
          settings={scoreSettings}
          onSettingsChange={changeScoreSettings}
        />
      )}
      {player.document && !active && <ClickScoreControls settings={scoreSettings} onChange={changeScoreSettings} />}
      <div className={`${styles.controller} ${active ? styles.performing : ""}`} style={CONTROLLER_STYLE}>
        {!player.document && !player.error && (
          <p className={styles.empty}>Open or create a score to set up a click track.</p>
        )}
        {player.document && (
          <ClickScoreInteractions canvasRef={activeCanvasRef} enabled={!active && !player.busy && !dialSettling} />
        )}
        {(player.document || player.error || player.busy) && (
          <FloatingTransport busy={player.busy} compact={active}>
            {player.error && (
              <p className={styles.error} role="alert">
                {player.error}
              </p>
            )}
            <ClickControls
              player={player}
              active={active}
              barIndex={barIndex}
              dialSettling={dialSettling}
              onSettlingChange={setDialSettling}
            />
            <div id={statusId} className={styles.srOnly} role="status" aria-label="Playback status">
              {status}
            </div>
          </FloatingTransport>
        )}
      </div>
    </>
  );
}
