/**
 * Music tab — the score's opening musical settings: time signature, key
 * signature, tempo, and bar count.
 *
 * These are the settings the old New Score wizard collected on its "Score
 * Details" step. In Setup mode they edit the live score instead of a throwaway
 * draft, so the shared canvas re-renders on every change.
 *
 * Everything here writes to measure 0 of the global timeline (the *opening*
 * signature). Mid-score signature changes are a Write-mode concern and stay in
 * the palette, where a selection determines the target measure.
 */
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { deleteMeasure, setKeySignature, setTimeSignature, type Score } from "@viritura/core";
import { FormField, FormInput, Select } from "@viritura/ui";
import { useDocumentStore } from "../../../store/DocumentContext";
import { produce } from "../../../score/scoreClone";
import { appendEmptyMeasures } from "../../../score/ScoreMutations";

const ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 };
const LIST_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "12px 12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const NO_SCORE_STYLE: CSSProperties = { padding: 16, fontSize: "var(--type-small-size)", color: "var(--text-muted)" };
const TIME_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "flex-end", gap: 8 };
const TIME_FIELD_STYLE: CSSProperties = { flex: 1 };
const HINT_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  lineHeight: 1.4,
  paddingTop: 4,
};

const KEY_OPTIONS: readonly { fifths: number; label: string }[] = [
  { fifths: -7, label: "C♭ major" },
  { fifths: -6, label: "G♭ major" },
  { fifths: -5, label: "D♭ major" },
  { fifths: -4, label: "A♭ major" },
  { fifths: -3, label: "E♭ major" },
  { fifths: -2, label: "B♭ major" },
  { fifths: -1, label: "F major" },
  { fifths: 0, label: "C major" },
  { fifths: 1, label: "G major" },
  { fifths: 2, label: "D major" },
  { fifths: 3, label: "A major" },
  { fifths: 4, label: "E major" },
  { fifths: 5, label: "B major" },
  { fifths: 6, label: "F♯ major" },
  { fifths: 7, label: "C♯ major" },
];

const TIME_UNITS = [2, 4, 8, 16] as const;

const MIN_MEASURES = 1;
const MAX_MEASURES = 999;
const MIN_TEMPO = 20;
const MAX_TEMPO = 400;
const MIN_BEATS = 1;
const MAX_BEATS = 32;

/** Trim the score down to `target` measures by deleting from the end. */
function truncateMeasures(score: Score, target: number): Score {
  let next = score;
  for (let i = next.global.measures.length; i > target; i--) {
    next = deleteMeasure(next, i - 1);
  }
  return next;
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly testId: string;
  readonly onCommit: (value: number) => void;
}

/**
 * Numeric field that commits on blur/Enter rather than on every keystroke.
 *
 * Binding a number input straight to the score is wrong here: clearing the box
 * to retype produces an empty (then partial) string, and a directly-bound
 * field would either reject the edit and snap back or write a garbage
 * intermediate value into the score. Buffering the keystrokes and committing
 * only a valid, in-range number mirrors how `ProjectMode` handles its metadata
 * text fields.
 */
function NumberField({ label, value, min, max, testId, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));

  // Re-seed the buffer when the score changes from elsewhere (undo/redo,
  // document load), using the React 19 "compare prop during render" pattern.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(String(value));
  }

  const commit = useCallback(() => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }, [draft, value, min, max, onCommit]);

  return (
    <FormField label={label}>
      <FormInput
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        data-testid={testId}
      />
    </FormField>
  );
}

export function MusicTab() {
  const score = useDocumentStore((s) => s.score);
  const updateScore = useDocumentStore((s) => s.updateScore);

  const opening = score?.global.measures[0];
  const measureCount = score?.global.measures.length ?? 0;
  const timeCount = opening?.time?.count ?? 4;
  const timeUnit = opening?.time?.unit ?? 4;
  const keyFifths = opening?.key?.fifths ?? 0;
  const tempoBpm = opening?.tempos?.[0]?.bpm ?? 120;

  const handleTimeCount = useCallback(
    (count: number) => {
      if (!score) return;
      updateScore(setTimeSignature(score, 0, { count, unit: timeUnit }));
    },
    [score, timeUnit, updateScore],
  );

  const handleTimeUnit = useCallback(
    (raw: string) => {
      if (!score) return;
      updateScore(setTimeSignature(score, 0, { count: timeCount, unit: Number(raw) }));
    },
    [score, timeCount, updateScore],
  );

  const handleKey = useCallback(
    (raw: string) => {
      if (!score) return;
      updateScore(setKeySignature(score, 0, { fifths: Number(raw) }));
    },
    [score, updateScore],
  );

  const handleTempo = useCallback(
    (bpm: number) => {
      if (!score) return;
      updateScore(
        produce(score, (draft) => {
          const first = draft.global.measures[0];
          if (!first) return;
          const existing = first.tempos?.[0];
          first.tempos = [{ ...existing, bpm, value: existing?.value ?? { base: "quarter" } }];
        }),
      );
    },
    [score, updateScore],
  );

  // Growing appends empty bars; shrinking deletes from the end. Both are
  // ordinary undoable score edits, so the canvas repaginates immediately.
  const handleMeasureCount = useCallback(
    (target: number) => {
      if (!score) return;
      const current = score.global.measures.length;
      if (target === current) return;
      updateScore(target > current ? appendEmptyMeasures(score, target - current) : truncateMeasures(score, target));
    },
    [score, updateScore],
  );

  const keyOptions = useMemo(() => KEY_OPTIONS.map((k) => ({ value: String(k.fifths), label: k.label })), []);
  const unitOptions = useMemo(() => TIME_UNITS.map((u) => ({ value: String(u), label: String(u) })), []);

  if (!score) {
    return <div style={NO_SCORE_STYLE}>No score loaded.</div>;
  }

  return (
    <div style={ROOT_STYLE}>
      <div className="viritura-scroll" style={LIST_STYLE}>
        <div style={TIME_ROW_STYLE}>
          <div style={TIME_FIELD_STYLE}>
            <NumberField
              label="Time signature"
              value={timeCount}
              min={MIN_BEATS}
              max={MAX_BEATS}
              testId="setup-time-count"
              onCommit={handleTimeCount}
            />
          </div>
          <div style={TIME_FIELD_STYLE}>
            <FormField label="Beat unit">
              <Select
                value={String(timeUnit)}
                onValueChange={handleTimeUnit}
                options={unitOptions}
                aria-label="Beat unit"
              />
            </FormField>
          </div>
        </div>

        <FormField label="Key signature">
          <Select value={String(keyFifths)} onValueChange={handleKey} options={keyOptions} aria-label="Key signature" />
        </FormField>

        <NumberField
          label="Tempo (BPM)"
          value={tempoBpm}
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          testId="setup-tempo"
          onCommit={handleTempo}
        />

        <NumberField
          label="Bars"
          value={measureCount}
          min={MIN_MEASURES}
          max={MAX_MEASURES}
          testId="setup-measure-count"
          onCommit={handleMeasureCount}
        />

        <div style={HINT_STYLE}>
          These set the opening bar. Add signature changes later in Write mode, where the selection picks the bar they
          apply from. Reducing the bar count deletes bars from the end.
        </div>
      </div>
    </div>
  );
}
