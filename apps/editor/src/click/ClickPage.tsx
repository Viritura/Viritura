import { useId, useMemo, useRef } from "react";
import { Button, FormInput, Slider } from "@viritura/ui";
import { buildClickSessionProgram, describeClickCue } from "@viritura/playback/click";
import { useClickPlayer } from "./useClickPlayer";
import styles from "./ClickPage.module.css";

function statusLabel(phase: ReturnType<typeof useClickPlayer>["phase"], busy: boolean, countingOff: boolean): string {
  if (busy) return "Preparing";
  if (countingOff) return "Counting off";
  return { empty: "Open an MNX file", ready: "Ready", playing: "Playing", paused: "Paused", complete: "Finished" }[
    phase
  ];
}

function countoffPosition(program: ReturnType<typeof buildClickSessionProgram> | undefined, elapsed: number): number {
  return Math.max(
    1,
    program?.events.slice(0, program.countoffClicks).filter((event) => event.time <= elapsed).length ?? 0,
  );
}

export function ClickPage() {
  const player = useClickPlayer();
  const inputRef = useRef<HTMLInputElement>(null);
  const tempoId = useId();
  const active = player.phase === "playing" || player.phase === "paused";
  const preview = useMemo(
    () =>
      player.document
        ? buildClickSessionProgram(player.document.timing, { tempoPercent: player.tempoPercent })
        : undefined,
    [player.document, player.tempoPercent],
  );
  const countingOff =
    player.phase === "playing" && player.program !== undefined && player.elapsed < player.program.countoffSeconds;
  const status = statusLabel(player.phase, player.busy, countingOff);
  const nextBeat = preview
    ? describeClickCue({
        measureNumber: player.document?.barNumbers[0] ?? 1,
        countoffClicks: preview.countoffClicks,
      })
    : "One bar countoff before every fresh start";
  const countoffBeat = countoffPosition(preview, player.elapsed);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/">Viritura</a>
        <span>Practice &amp; studio</span>
      </header>
      <section className={styles.card} aria-label="Click player" aria-busy={player.busy}>
        <p className={styles.eyebrow}>CLICK</p>
        <h1>{player.document?.filename ?? "Your music. Just the click."}</h1>
        <p>Open one MNX file. No instruments, no score rendering, only the click.</p>
        <FormInput
          ref={inputRef}
          type="file"
          accept=".mnx,application/json"
          aria-label="MNX file"
          hidden
          disabled={active || player.busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void player.open(file);
          }}
        />
        <Button size="lg" disabled={active || player.busy} onClick={() => inputRef.current?.click()}>
          Open MNX
        </Button>

        {preview && (
          <>
            <div className={styles.preview}>
              <h2>{nextBeat}</h2>
              <p>
                {player.document?.timing.measureTimeSignatures[0]?.count}/
                {player.document?.timing.measureTimeSignatures[0]?.unit}
                {" | "}Quarter = {Number(preview.startBpm.toFixed(2))}
                {" | "}Through track end
              </p>
            </div>
            <fieldset className={styles.tempo} disabled={active || player.busy}>
              <label htmlFor={tempoId}>Session tempo %</label>
              <Slider
                id={tempoId}
                min={25}
                max={200}
                step={1}
                value={player.tempoPercent}
                onChange={player.setTempoPercent}
              />
              <output htmlFor={tempoId}>{player.tempoPercent}%</output>
              <Button disabled={active || player.busy} onClick={() => player.setTempoPercent(100)}>
                Reset to 100%
              </Button>
            </fieldset>
            <div className={styles.transport}>
              <Button variant="primary" size="lg" disabled={active || player.busy} onClick={() => void player.play()}>
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
        )}
        <div className={styles.status} role="status" aria-label="Playback status" aria-live="polite">
          <strong>{status}</strong>
          {countingOff && (
            <span>
              {countoffBeat} of {preview?.countoffClicks}
            </span>
          )}
        </div>
        {player.error && (
          <p className={styles.error} role="alert">
            {player.error}
          </p>
        )}
      </section>
      <p className={styles.note}>
        Click output only. Use a wired audio output for studio sessions. Subdivision editing and setlists are coming
        later.
      </p>
    </main>
  );
}
