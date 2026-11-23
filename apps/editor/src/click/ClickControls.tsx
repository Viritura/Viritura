import { useMemo, useRef } from "react";
import { Button, ButtonGroup } from "@viritura/ui";
import { buildClickSessionProgram } from "@viritura/playback/click";
import { BarDial } from "./BarDial";
import { RehearsalDial } from "./RehearsalDial";
import { describeClickBar } from "./barNavigation";
import type { useClickPlayer } from "./useClickPlayer";
import styles from "./ClickPage.module.css";

interface ClickControlsProps {
  readonly player: ReturnType<typeof useClickPlayer>;
  readonly active: boolean;
  readonly barIndex: number;
  readonly dialSettling: boolean;
  readonly onSettlingChange: (settling: boolean) => void;
}

export function ClickControls({ player, active, barIndex, dialSettling, onSettlingChange }: ClickControlsProps) {
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
  const current = player.document.bars[barIndex]!;

  function reportSettling(track: "bars" | "rehearsals", value: boolean): void {
    settling.current[track] = value;
    onSettlingChange(settling.current.bars || settling.current.rehearsals);
  }

  return (
    <>
      {!active && (
        <section className={styles.navigation} aria-label="Bar navigation">
          <RehearsalDial
            bars={player.document.bars}
            index={barIndex}
            enabled={!active && !player.busy}
            onSelect={player.setStartBar}
            onSettlingChange={(value) => reportSettling("rehearsals", value)}
          />
          <BarDial
            bars={player.document.bars}
            index={barIndex}
            enabled={!active && !player.busy}
            onSelect={player.setStartBar}
            onSettlingChange={(value) => reportSettling("bars", value)}
          />
        </section>
      )}
      <div className={active ? styles.compactControls : styles.controlStrip}>
        {active ? (
          <output className={styles.currentBar} aria-label="Current bar" aria-description={describeClickBar(current)}>
            {current.number}
          </output>
        ) : (
          <div className={styles.settings}>
            <div className={styles.startDetails} role="group" aria-label="Selected start" aria-live="polite">
              <span>
                {meter.count}/{meter.unit}
              </span>
              <span>Quarter = {preview ? Number(preview.startBpm.toFixed(2)) : 0}</span>
            </div>
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
          <Button
            variant="primary"
            size="lg"
            disabled={player.busy || (!active && (dialSettling || player.tempoPercent === 0))}
            onClick={() => void (active ? player.stop() : player.play())}
          >
            {active ? "Stop" : "Start"}
          </Button>
        </div>
      </div>
    </>
  );
}
