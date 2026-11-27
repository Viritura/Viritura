import { useMemo, useRef, type ReactNode } from "react";
import { Button, ButtonGroup } from "@viritura/ui";
import { buildClickSessionProgram } from "@viritura/playback/click";
import { BarDial } from "./BarDial";
import { RehearsalDial } from "./RehearsalDial";
import { SMUFL, TimeSigGlyph } from "../components/palette";
import type { useClickPlayer } from "./useClickPlayer";
import styles from "./ClickView.module.css";

interface ClickControlsProps {
  readonly player: ReturnType<typeof useClickPlayer>;
  readonly active: boolean;
  readonly compact?: boolean;
  readonly barIndex: number;
  readonly dialSettling: boolean;
  readonly onSettlingChange: (settling: boolean) => void;
  readonly position: ReactNode;
  /** Host-specific action beside Start/Stop, such as moving the controls to another window. */
  readonly hostAction?: ReactNode;
}

interface ClickStartStopProps {
  readonly player: ReturnType<typeof useClickPlayer>;
  readonly active: boolean;
  readonly dialSettling: boolean;
}

export function ClickStartStop({ player, active, dialSettling }: ClickStartStopProps) {
  return (
    <Button
      variant="primary"
      size="lg"
      disabled={player.busy || (!active && (dialSettling || player.tempoPercent === 0 || !player.document))}
      onClick={() => void (active ? player.stop() : player.play())}
    >
      {active ? "Stop" : "Start"}
    </Button>
  );
}

export function ClickControls({
  player,
  active,
  compact = active,
  barIndex,
  dialSettling,
  onSettlingChange,
  position,
  hostAction,
}: ClickControlsProps) {
  const settling = useRef({ bars: false, rehearsals: false });
  const preview = useMemo(
    () =>
      player.document && player.tempoPercent > 0
        ? buildClickSessionProgram(player.document.timing, {
            tempoPercent: player.tempoPercent,
            countoffBars: player.countoffBars,
            startTimelineMeasure: player.startBar,
          })
        : undefined,
    [player.document, player.tempoPercent, player.countoffBars, player.startBar],
  );
  if (!player.document) return null;
  const meter = player.document.timing.measureTimeSignatures[player.startBar]!;
  const bpm = preview ? Number(preview.startBpm.toFixed(2)) : 0;

  function reportSettling(track: "bars" | "rehearsals", value: boolean): void {
    settling.current[track] = value;
    onSettlingChange(settling.current.bars || settling.current.rehearsals);
  }

  return (
    <>
      {!compact && (
        <section className={styles.navigation} aria-label="Bar navigation">
          <div className={styles.navigationGrid} role="group" aria-label="Selected start">
            <output className={styles.startMeter} aria-label={`Time signature ${meter.count} over ${meter.unit}`}>
              <TimeSigGlyph count={meter.count} unit={meter.unit} />
            </output>
            <div className={styles.rehearsalTrack}>
              <RehearsalDial
                bars={player.document.bars}
                index={barIndex}
                enabled={!active && !player.busy}
                onSelect={player.setStartBar}
                onSettlingChange={(value) => reportSettling("rehearsals", value)}
              />
            </div>
            <output className={styles.startTempo} aria-label={`Quarter note equals ${bpm} beats per minute`}>
              <svg width="10" height="22" viewBox="0 0 10 22" aria-hidden="true">
                <text x="1" y="18" fontFamily="Bravura" fontSize="24" fill="currentColor">
                  {SMUFL.metNoteQuarter}
                </text>
              </svg>
              <span aria-hidden="true">= {bpm}</span>
            </output>
            <div className={styles.barTrack}>
              <BarDial
                bars={player.document.bars}
                index={barIndex}
                enabled={!active && !player.busy}
                onSelect={player.setStartBar}
                onSettlingChange={(value) => reportSettling("bars", value)}
              />
            </div>
          </div>
        </section>
      )}
      <div className={compact ? styles.compactControls : styles.controlStrip}>
        {compact ? (
          position
        ) : (
          <div className={styles.settings}>
            <div className={styles.countoff}>
              <ButtonGroup
                ariaLabel="Countoff"
                options={[
                  { value: "1", label: "1 bar" },
                  { value: "2", label: "2 bars" },
                ]}
                value={player.countoffBars === 1 ? "1" : "2"}
                onChange={(value) => player.setCountoffBars(value === "1" ? 1 : 2)}
                disabled={active || player.busy}
              />
              {preview && (
                <span aria-live="polite">
                  {preview.countoffClicks} {preview.countoffClicks === 1 ? "click" : "clicks"} free
                </span>
              )}
            </div>
          </div>
        )}
        <div className={styles.transport}>
          {active && !compact && position}
          {hostAction}
          <ClickStartStop player={player} active={active} dialSettling={dialSettling} />
        </div>
      </div>
    </>
  );
}
