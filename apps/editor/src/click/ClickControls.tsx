import { useId, useMemo } from "react";
import { Button, Slider } from "@viritura/ui";
import { buildClickSessionProgram, describeClickCue } from "@viritura/playback/click";
import { BarDial } from "./BarDial";
import { describeClickBar } from "./barNavigation";
import type { useClickPlayer } from "./useClickPlayer";
import styles from "./ClickPage.module.css";

interface ClickControlsProps {
  readonly player: ReturnType<typeof useClickPlayer>;
  readonly active: boolean;
  readonly barIndex: number;
  readonly dialSettling: boolean;
  readonly onSettlingChange: (settling: boolean) => void;
  readonly statusId: string;
}

export function ClickControls({
  player,
  active,
  barIndex,
  dialSettling,
  onSettlingChange,
  statusId,
}: ClickControlsProps) {
  const tempoId = useId();
  const preview = useMemo(
    () =>
      player.document && player.tempoPercent > 0
        ? buildClickSessionProgram(player.document.timing, {
            tempoPercent: player.tempoPercent,
            startTimelineMeasure: player.startBar,
          })
        : undefined,
    [player.document, player.tempoPercent, player.startBar],
  );
  if (!player.document) return null;

  const selectedBar = player.document.bars[player.startBar]!;
  const meter = player.document.timing.measureTimeSignatures[player.startBar]!;
  const nextBeat = preview
    ? describeClickCue({
        rehearsal: selectedBar.rehearsalContext,
        measureNumber: selectedBar.number,
        countoffClicks: preview.countoffClicks,
      })
    : undefined;

  return (
    <>
      <section className={styles.navigation} aria-label="Bar navigation">
        <h2>Bar dial</h2>
        <p>Swipe, scroll, or use arrow keys to choose a start bar. The dial follows playback.</p>
        <BarDial
          bars={player.document.bars}
          index={barIndex}
          enabled={!active && !player.busy}
          onSelect={player.setStartBar}
          onSettlingChange={onSettlingChange}
        />
      </section>
      {preview && (
        <div className={styles.preview}>
          <span className={styles.previewLabel}>Next start</span>
          <h2>{nextBeat}</h2>
          <p>
            {describeClickBar(selectedBar)}
            {" | "}
            {meter.count}/{meter.unit}
            {" | "}Quarter = {Number(preview.startBpm.toFixed(2))}
            {" | "}Through track end
          </p>
        </div>
      )}
      <fieldset className={styles.tempo} disabled={active || player.busy}>
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
        <output htmlFor={tempoId}>{player.tempoPercent}%</output>
        <Button disabled={active || player.busy} onClick={() => player.setTempoPercent(100)}>
          Reset to 100%
        </Button>
      </fieldset>
      <div className={styles.transport}>
        <Button
          variant="primary"
          size="lg"
          disabled={active || player.busy || dialSettling || player.tempoPercent === 0}
          onClick={() => void player.play()}
        >
          Play
        </Button>
        <Button
          size="lg"
          disabled={!active || player.busy}
          onClick={() => void (player.phase === "paused" ? player.resume() : player.pause())}
        >
          {player.phase === "paused" ? "Resume" : "Pause"}
        </Button>
        <Button size="lg" disabled={!active || player.busy} onClick={() => void player.stop()}>
          Stop
        </Button>
      </div>
    </>
  );
}
