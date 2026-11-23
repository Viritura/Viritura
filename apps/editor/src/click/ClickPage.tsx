import { useId, useRef, useState } from "react";
import { Button, FormInput } from "@viritura/ui";
import type { ClickSessionProgram } from "@viritura/playback/click";
import { ClickControls } from "./ClickControls";
import { clickBarAtTime, describeClickBar } from "./barNavigation";
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
  if (document && tempoPercent === 0) return "Set tempo above 0% to play";
  return { empty: "", ready: "Ready", playing: "Playing", paused: "Paused", complete: "Finished" }[phase];
}

function countoffPosition(program: ClickSessionProgram | undefined, elapsed: number): number {
  return Math.max(
    1,
    program?.events.slice(0, program.countoffClicks).filter((event) => event.time <= elapsed).length ?? 0,
  );
}

export function ClickPage() {
  const player = useClickPlayer();
  const [dialSettling, setDialSettling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const active = player.phase === "playing" || player.phase === "paused";
  const beforeStart = active && player.program !== undefined && player.elapsed < player.program.countoffSeconds;
  const countingOff = player.phase === "playing" && beforeStart;
  const status = statusLabel(player.phase, player.busy, countingOff, player.tempoPercent, player.document);
  const barIndex =
    active && player.document && player.program
      ? clickBarAtTime(player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : player.startBar;
  const currentBar = player.document?.bars[barIndex];
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
          <ClickControls
            player={player}
            active={active}
            barIndex={barIndex}
            dialSettling={dialSettling}
            onSettlingChange={setDialSettling}
            statusId={statusId}
          />
          <div id={statusId} className={styles.status} role="status" aria-label="Playback status" aria-live="polite">
            <strong>{status}</strong>
            {countingOff && (
              <span>
                {countoffBeat} of {player.program?.countoffClicks}
              </span>
            )}
          </div>
          {active && currentBar && (
            <div className={styles.position} role="status" aria-label="Playback position" aria-live="polite">
              <span>{beforeStart ? "After countoff" : "Current bar"}</span>
              <strong>{describeClickBar(currentBar)}</strong>
              {currentBar.rehearsalContext && <span>Rehearsal {currentBar.rehearsalContext}</span>}
            </div>
          )}
          {player.error && (
            <p className={styles.error} role="alert">
              {player.error}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
