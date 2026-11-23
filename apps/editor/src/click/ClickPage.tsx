import { useId, useRef, useState } from "react";
import { Button, FormInput } from "@viritura/ui";
import type { ClickSessionProgram } from "@viritura/playback/click";
import { ClickControls } from "./ClickControls";
import { ClickScore } from "./ClickScore";
import { ClickScoreControls, type ClickScoreSettings } from "./ClickScoreControls";
import { FloatingTransport } from "./FloatingTransport";
import { clickBarAtTime, clickScorePosition } from "./barNavigation";
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

function countoffPosition(program: ClickSessionProgram | undefined, elapsed: number): number {
  if (!program) return 1;
  let beats = 0;
  for (const event of program.events) {
    if (event.time >= program.countoffSeconds || event.time > elapsed) break;
    if (event.level !== "subdivision") beats++;
  }
  return Math.max(1, beats);
}

export function ClickPage() {
  const player = useClickPlayer();
  const [dialSettling, setDialSettling] = useState(false);
  const [scoreSettings, setScoreSettings] = useState<ClickScoreSettings>({ viewIndex: 0, zoom: 1, fitMode: "height" });
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const active = player.phase === "playing";
  const countingOff = active && player.program !== undefined && player.elapsed < player.program.countoffSeconds;
  const status = statusLabel(player.phase, player.busy, countingOff, player.tempoPercent, player.document);
  const barIndex =
    active && player.document && player.program
      ? clickBarAtTime(player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : player.startBar;
  const countoffBeat = countoffPosition(player.program, player.elapsed);
  const scorePosition =
    active && player.document && player.program
      ? clickScorePosition(player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : { measureIndex: player.document?.bars[player.startBar]?.measureIndex ?? 0, beat: 0 };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
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
              setScoreSettings({ viewIndex: 0, zoom: 1, fitMode: "height" });
              void player.open(file);
            }
          }}
        />
        <Button disabled={active || player.busy || dialSettling} onClick={() => inputRef.current?.click()}>
          Open MNX
        </Button>
        {player.document && (
          <ClickScoreControls views={player.document.scoreViews} settings={scoreSettings} onChange={setScoreSettings} />
        )}
      </header>
      <main className={styles.workspace}>
        {player.document && (
          <ClickScore
            document={player.document}
            position={scorePosition}
            settings={scoreSettings}
            onSettingsChange={setScoreSettings}
          />
        )}
        {(player.document || player.error || player.busy) && (
          <FloatingTransport busy={player.busy}>
            {player.error && (
              <p className={styles.error} role="alert">
                {player.error}
              </p>
            )}
            <ClickControls
              player={player}
              active={active}
              barIndex={barIndex}
              countoffBeat={countingOff ? countoffBeat : undefined}
              dialSettling={dialSettling}
              onSettlingChange={setDialSettling}
              statusId={statusId}
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
