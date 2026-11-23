import { useEffect, useRef, useState } from "react";
import { ClickEngine } from "@viritura/audio/click";
import { buildClickSessionProgram, type ClickSessionProgram } from "@viritura/playback/click";
import { readClickDocument, type ClickDocument } from "./clickDocument";
import { clickBarAtTime } from "./barNavigation";

type Phase = "empty" | "ready" | "playing" | "complete";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useClickPlayer() {
  const [document, setDocument] = useState<ClickDocument>();
  const [tempoPercent, setTempoPercent] = useState(100);
  const [countoffBars, setCountoffBars] = useState<1 | 2>(1);
  const [startBar, setStartBar] = useState(0);
  const [phase, setPhase] = useState<Phase>("empty");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  function open(file: File): Promise<void> {
    return run(async () => {
      await closeEngine();
      setDocument(undefined);
      setProgram(undefined);
      setElapsed(0);
      const next = readClickDocument(file.name, await file.text());
      if (!mounted.current) return;
      setDocument(next);
      setStartBar(next.bars.findIndex((bar) => bar.startable));
      setPhase("ready");
    });
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
      if (!document) throw new Error("Open an MNX file first");
      const next = buildClickSessionProgram(document.timing, {
        tempoPercent,
        countoffBars,
        startTimelineMeasure: startBar,
      });
      setProgram(next);
      // Creation happens inside the Start gesture, not while opening a file.
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

  return {
    document,
    tempoPercent,
    setTempoPercent,
    countoffBars,
    setCountoffBars,
    startBar,
    setStartBar,
    phase,
    busy,
    error,
    elapsed,
    program,
    open,
    play,
    stop,
  };
}
