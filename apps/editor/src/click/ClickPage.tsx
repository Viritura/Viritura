import { useId, useRef, useState } from "react";
import { Button, FormInput } from "@viritura/ui";
import type { ClickSessionProgram } from "@viritura/playback/click";
import { ClickControls } from "./ClickControls";
import { clickBarAtTime } from "./barNavigation";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const active = player.phase === "playing";
  const beforeStart = active && player.program !== undefined && player.elapsed < player.program.countoffSeconds;
  const countingOff = player.phase === "playing" && beforeStart;
  const status = statusLabel(player.phase, player.busy, countingOff, player.tempoPercent, player.document);
  const barIndex =
    active && player.document && player.program
      ? clickBarAtTime(player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : player.startBar;
  const countoffBeat = countoffPosition(player.program, player.elapsed);

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
            if (file) void player.open(file);
          }}
        />
        <Button disabled={active || player.busy || dialSettling} onClick={() => inputRef.current?.click()}>
          Open MNX
        </Button>
      </header>
      <main>
        <section className={styles.card} aria-label="Click player" aria-busy={player.busy}>
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
        </section>
      </main>
    </div>
  );
}
