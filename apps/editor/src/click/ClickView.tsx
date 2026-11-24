import { useId, useState } from "react";
import { Slider } from "@viritura/ui";
import { ClickControls } from "./ClickControls";
import { ClickScore } from "./ClickScore";
import { ClickScoreControls, type ClickScoreSettings } from "./ClickScoreControls";
import { FloatingTransport } from "./FloatingTransport";
import { clickBarAtTime, clickScorePosition, clickStartPosition } from "./barNavigation";
import { useClickPlayer } from "./useClickPlayer";
import { useClickSpaceShortcut } from "./useClickSpaceShortcut";
import { useExclusiveClickAudio } from "./useExclusiveClickAudio";
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
  return (
    <div className={styles.header} role="group" aria-label="Click settings" hidden={hidden}>
      <h1>Click</h1>
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
      <ClickScoreControls views={views} settings={settings} onChange={onSettingsChange} />
    </div>
  );
}

const DEFAULT_SCORE_SETTINGS: ClickScoreSettings = { viewIndex: 0, viewMode: "horizon", zoom: 1, fitMode: "height" };

interface ClickViewProps {
  /** Serialized MNX of the open document. */
  readonly mnx: string;
}

/** Click activity: a click-only recording transport for the open document. */
export function ClickView({ mnx }: ClickViewProps) {
  const releaseOtherAudio = useExclusiveClickAudio();
  const player = useClickPlayer(mnx, { releaseOtherAudio });
  const [dialSettling, setDialSettling] = useState(false);
  const [scoreSettings, setScoreSettings] = useState(DEFAULT_SCORE_SETTINGS);
  const [settingsViews, setSettingsViews] = useState(player.document?.scoreViews);
  if (settingsViews !== player.document?.scoreViews) {
    setSettingsViews(player.document?.scoreViews);
    if (scoreSettings.viewIndex >= (player.document?.scoreViews.length ?? 0)) {
      setScoreSettings({ ...scoreSettings, viewIndex: 0 });
    }
  }
  const statusId = useId();
  const active = player.phase === "playing";
  const canStart = !player.busy && !dialSettling && player.tempoPercent > 0 && player.document !== undefined;
  useClickSpaceShortcut(() => {
    if (active && !player.busy) void player.stop();
    else if (!active && canStart) void player.play();
  });
  const { countingOff, barIndex, scorePosition } = clickCursor(player, active);
  const status = statusLabel(player.phase, player.busy, countingOff, player.tempoPercent, player.document);

  return (
    <section className={active ? `${styles.page} ${styles.performing}` : styles.page} aria-label="Click track">
      {player.document && (
        <ClickSettingsBar
          player={player}
          views={player.document.scoreViews}
          hidden={active}
          statusId={statusId}
          settings={scoreSettings}
          onSettingsChange={setScoreSettings}
        />
      )}
      <div className={styles.workspace}>
        {!player.document && !player.error && (
          <p className={styles.empty}>Open or create a score to set up a click track.</p>
        )}
        {player.document && (
          <ClickScore
            document={player.document}
            position={scorePosition}
            settings={scoreSettings}
            onSettingsChange={setScoreSettings}
            interactionEnabled={!active && !player.busy && !dialSettling}
            active={active}
            onSelectMeasure={player.selectScoreMeasure}
          />
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
    </section>
  );
}
