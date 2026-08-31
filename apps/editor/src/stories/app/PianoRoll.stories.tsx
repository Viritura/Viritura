/**
 * Storybook story for the WebGL2-backed piano roll.
 *
 * Skips the full MNX → MIDI projection pipeline and feeds the
 * renderer synthetic `PianoRollNote`s directly so the WebGL pipeline
 * can be exercised without depending on score data. A `requestAnimationFrame`
 * loop advances the playhead so notes scroll naturally.
 *
 * Variants:
 *   - Sparse — a few dozen notes across a few seconds (debug feel).
 *   - Dense — ~10k notes, the stress case the renderer was built for.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  FpsCounter,
  PianoKeyboard,
  PianoRollCanvas,
  PianoRollProvider,
  type PianoRollNote,
} from "@viritura/piano-roll";

const PANEL_STYLE: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: 600,
  background: "var(--canvas-bg, #16161c)",
};

const KEYBOARD_STYLE: CSSProperties = { width: "100%", flexShrink: 0 };

const COLOR_PALETTE: readonly string[] = ["#215e4e", "#7d2f6a", "#6a7d2f", "#2f4a7d", "#7d6a2f"];

interface SyntheticArgs {
  noteCount: number;
  seconds: number;
}

function makeSyntheticNotes({ noteCount, seconds }: SyntheticArgs): PianoRollNote[] {
  const out: PianoRollNote[] = [];
  // Deterministic pseudo-random so the story is stable across reloads.
  let seed = 0x1234_5678;
  const rand = (): number => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0xffff_ffff;
  };
  for (let i = 0; i < noteCount; i++) {
    const start = rand() * seconds;
    const dur = 0.2 + rand() * 0.8;
    const midi = 36 + Math.floor(rand() * 60);
    const partIndex = Math.floor(rand() * COLOR_PALETTE.length);
    out.push({
      locator: { sequencePath: { partId: `p${partIndex}`, measureIndex: 0, voice: 0 }, eventId: `e${i}` },
      noteIndex: 0,
      noteId: `synth-${i}`,
      midiNote: midi,
      velocity: 80,
      partIndex,
      startSeconds: start,
      endSeconds: start + dur,
      startMeasure: 0,
      startBeat: 0,
      notatedDurationQuarters: 1,
      fromTie: false,
      fromRepeat: false,
    });
  }
  out.sort((a, b) => a.startSeconds - b.startSeconds);
  return out;
}

interface DemoProps {
  noteCount: number;
  seconds: number;
}

function PianoRollDemo({ noteCount, seconds }: DemoProps) {
  const notes = useMemo(() => makeSyntheticNotes({ noteCount, seconds }), [noteCount, seconds]);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = (now - startRef.current) / 1000;
      setPlayheadSeconds(elapsed % (seconds + 4));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seconds]);

  const partColors = useMemo(() => {
    const map = new Map<number, string>();
    COLOR_PALETTE.forEach((c, i) => map.set(i, c));
    return map;
  }, []);

  const activeNotes = useMemo(() => {
    const s = new Set<number>();
    for (const n of notes) {
      if (n.startSeconds <= playheadSeconds && playheadSeconds < n.endSeconds) s.add(n.midiNote);
    }
    return s;
  }, [notes, playheadSeconds]);

  return (
    <PianoRollProvider>
      <div style={PANEL_STYLE}>
        <PianoRollCanvas notes={notes} playheadSeconds={playheadSeconds} partColors={partColors} />
        <div style={KEYBOARD_STYLE}>
          <PianoKeyboard
            widthPx={1040}
            heightPx={120}
            viewport={{ secondsAhead: 4, minMidi: 21, maxMidi: 108 }}
            activeNotes={activeNotes}
          />
        </div>
        <FpsCounter />
      </div>
    </PianoRollProvider>
  );
}

const meta: Meta<typeof PianoRollDemo> = {
  title: "App/Piano Roll (WebGL2)",
  component: PianoRollDemo,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof PianoRollDemo>;

export const Sparse: Story = {
  name: "Sparse — debug",
  args: { noteCount: 40, seconds: 10 },
};

export const Dense: Story = {
  name: "Dense — 10k notes",
  args: { noteCount: 10_000, seconds: 60 },
};
