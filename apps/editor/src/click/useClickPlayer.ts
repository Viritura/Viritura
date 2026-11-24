import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClickEngine } from "@viritura/audio/click";
import { buildClickSessionProgram, type ClickSessionProgram } from "@viritura/playback/click";
import { readClickDocument, type ClickDocument } from "./clickDocument";
import { clickBarAtTime, clickBarForMeasure, type ClickBar } from "./barNavigation";

type Phase = "empty" | "ready" | "playing" | "complete";

interface ClickPlayerOptions {
  /** Releases every other audio graph before the click engine starts. */
  readonly releaseOtherAudio?: () => Promise<void>;
}

const noRelease = async (): Promise<void> => {};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSource(mnx: string): { document?: ClickDocument; error: string } {
  if (!mnx) return { error: "" };
  try {
    return { document: readClickDocument(mnx), error: "" };
  } catch (failure) {
    return { error: message(failure) };
  }
}

function firstStartable(bars: readonly ClickBar[]): number {
  return bars.findIndex((bar) => bar.startable);
}

/**
 * Click-only transport for the open document. Document edits are adopted only
 * while stopped, so a running take never switches program or bar numbering.
 */
export function useClickPlayer(mnx: string, { releaseOtherAudio = noRelease }: ClickPlayerOptions = {}) {
  const [tempoPercent, setTempoPercent] = useState(100);
  const [countoffBars, setCountoffBars] = useState<1 | 2>(1);
  const [startBar, setStartBar] = useState(0);
  const [transportPhase, setPhase] = useState<Exclude<Phase, "empty">>("ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceMnx, setSourceMnx] = useState(mnx);
  if (mnx !== sourceMnx && transportPhase !== "playing" && !busy) setSourceMnx(mnx);
  const source = useMemo(() => readSource(sourceMnx), [sourceMnx]);
  const document = source.document;
  const [barsDocument, setBarsDocument] = useState<ClickDocument>();
  if (barsDocument !== document) {
    setBarsDocument(document);
    if (document) {
      const kept = document.bars[startBar]?.startable ? startBar : firstStartable(document.bars);
      if (kept !== startBar) setStartBar(kept);
    }
  }
  const phase: Phase = document ? transportPhase : "empty";
  const [elapsed, setElapsed] = useState(0);
  const [program, setProgram] = useState<ClickSessionProgram>();
  const engineRef = useRef<ClickEngine | undefined>(undefined);
  const mounted = useRef(true);
  const locked = useRef(false);
  const anchor = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const engine = engineRef.current;
      engineRef.current = undefined;
      void engine?.dispose().catch((failure: unknown) => console.error("Could not close click audio", failure));
    };
  }, []);

  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(() => {
      const engine = engineRef.current;
      if (engine) {
        setElapsed(Math.max(0, engine.context.currentTime - anchor.current));
      }
    }, 75);
    return () => clearInterval(timer);
  }, [phase]);

  async function closeEngine(): Promise<void> {
    const engine = engineRef.current;
    engineRef.current = undefined;
    await engine?.dispose();
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      let detail = message(failure);
      try {
        await closeEngine();
      } catch (cleanupFailure) {
        detail += `; could not close audio: ${message(cleanupFailure)}`;
      }
      if (mounted.current) {
        setError(detail);
        setPhase("ready");
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function getEngine(): Promise<ClickEngine | undefined> {
    if (engineRef.current) return engineRef.current;
    const engine = await ClickEngine.create();
    if (!mounted.current) {
      await engine.dispose();
      return;
    }
    engineRef.current = engine;
    engine.onEvent((event) => {
      if (engineRef.current !== engine) return;
      if (event.type === "ended") {
        setPhase("complete");
      } else if (event.type === "missed" || event.type === "failed") {
        setError(
          event.type === "failed"
            ? event.message
            : `Click interrupted: ${event.count} missed click(s). Press Start for a fresh countoff.`,
        );
        setPhase("ready");
        void closeEngine().catch((failure: unknown) => setError(`Could not close audio: ${message(failure)}`));
      }
    });
    engine.context.onstatechange = () => {
      if (engineRef.current !== engine || engine.context.state === "running") return;
      setError("Click audio was interrupted. Press Start for a fresh countoff.");
      setPhase("ready");
      void closeEngine().catch((failure: unknown) => setError(`Could not close audio: ${message(failure)}`));
    };
    return engine;
  }

  function play(): Promise<void> {
    return run(async () => {
      if (!document) throw new Error("Open a score first");
      const next = buildClickSessionProgram(document.timing, {
        tempoPercent,
        countoffBars,
        startTimelineMeasure: startBar,
      });
      setProgram(next);
      // Instrument playback and previews must be silent before a recording take.
      await releaseOtherAudio();
      if (!mounted.current) return;
      // Creation happens inside the Start gesture, not while opening a score.
      const engine = await getEngine();
      if (!engine) return;
      await engine.context.resume();
      await engine.load(next.events, next.duration);
      const receipt = await engine.start();
      if (!mounted.current || engineRef.current !== engine) return;
      anchor.current = receipt.contextTime;
      setElapsed(0);
      setPhase("playing");
    });
  }

  function stop(): Promise<void> {
    return run(async () => {
      const engine = engineRef.current;
      if (!engine || !document || !program) throw new Error("No click playback to stop");
      const stoppedElapsed = await engine.stop();
      if (!mounted.current || engineRef.current !== engine) return;
      setStartBar(clickBarAtTime(document.timing, program, stoppedElapsed, tempoPercent));
      setElapsed(0);
      setPhase("ready");
    });
  }

  const selectScoreMeasure = useCallback(
    (measureIndex: number): void => {
      if (!document || phase === "playing" || locked.current) return;
      const next = clickBarForMeasure(document.bars, measureIndex, startBar);
      if (next === undefined) {
        setError("This bar has no full-bar visit in the playback order. Choose a start from the bar dial.");
        return;
      }
      setError("");
      setStartBar(next);
    },
    [document, phase, startBar],
  );

  return {
    document,
    tempoPercent,
    setTempoPercent,
    countoffBars,
    setCountoffBars,
    startBar,
    setStartBar,
    selectScoreMeasure,
    phase,
    busy,
    error: error || source.error,
    elapsed,
    program,
    play,
    stop,
  };
}
