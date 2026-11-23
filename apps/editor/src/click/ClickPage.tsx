import { useId, useRef, useState } from "react";
import { Button, FormInput, Slider } from "@viritura/ui";
import { ClickControls } from "./ClickControls";
import { ClickScore } from "./ClickScore";
import { ClickScoreControls, type ClickScoreSettings } from "./ClickScoreControls";
import { FloatingTransport } from "./FloatingTransport";
import { clickBarAtTime, clickScorePosition, clickStartPosition } from "./barNavigation";
import { useClickPlayer } from "./useClickPlayer";
import styles from "./ClickPage.module.css";

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

export function ClickPage() {
  const player = useClickPlayer();
  const [dialSettling, setDialSettling] = useState(false);
  const [scoreSettings, setScoreSettings] = useState<ClickScoreSettings>({
    viewIndex: 0,
    viewMode: "horizon",
    zoom: 1,
    fitMode: "height",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const tempoId = useId();
  const active = player.phase === "playing";
  const countingOff = active && player.program !== undefined && player.elapsed < player.program.countoffSeconds;
  const status = statusLabel(player.phase, player.busy, countingOff, player.tempoPercent, player.document);
  const barIndex =
    active && player.document && player.program
      ? clickBarAtTime(player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : player.startBar;
  const scorePosition =
    active && player.document && player.program
      ? clickScorePosition(player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : player.document
        ? clickStartPosition(player.document.timing, player.startBar)
        : { measureIndex: 0, beat: 0 };

  return (
    <div className={styles.page}>
      <header className={styles.header} hidden={active}>
        <a href="/">Viritura</a>
        <h1>{player.document?.filename ?? "Click"}</h1>
        <FormInput
          ref={inputRef}
          type="file"
          accept=".mnx,application/json"
          aria-label="MNX file"
          hidden
          disabled={active || player.busy || dialSettling}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              setScoreSettings({ viewIndex: 0, viewMode: "horizon", zoom: 1, fitMode: "height" });
              void player.open(file);
            }
          }}
        />
        <Button disabled={active || player.busy || dialSettling} onClick={() => inputRef.current?.click()}>
          Open MNX
        </Button>
        {player.document && (
          <>
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
              <output htmlFor={tempoId} aria-label="Session tempo percentage">
                {player.tempoPercent}%
              </output>
            </fieldset>
            <ClickScoreControls
              views={player.document.scoreViews}
              settings={scoreSettings}
              onChange={setScoreSettings}
            />
          </>
        )}
      </header>
      <main className={styles.workspace}>
        {player.document && (
          <ClickScore
            document={player.document}
            position={scorePosition}
            settings={scoreSettings}
            onSettingsChange={setScoreSettings}
            interactionEnabled={!active && !player.busy && !dialSettling}
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
      </main>
    </div>
  );
}
