import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Button, LongPressButton, Select } from "@viritura/ui";
import { ChevronsRight, ChevronsLeft, Link2, Unlink2 } from "lucide-react";
import { useNoteInput, type DotCount, type GraceType, type Voice } from "../store/noteInputStore";
import type { NoteValueBase, AccidentalType, Duration } from "@viritura/core";
import { useSelectionStore } from "../store/selectionStore";
import { useDocumentStoreApi, useDocumentStore } from "../store/DocumentContext";
import { resolveEventLocation, getContentArrayForLocation, type EventLocation } from "../score/ElementPath";
import { changeDuration } from "../commands/noteCommands";
import type { Score, NoteEvent } from "@viritura/core";
import { Separator } from "@viritura/ui";
import styles from "./Toolbar.module.css";
import { produce } from "../score/scoreClone";
import {
  beamTogetherSelection,
  breakBeamAfterSelection,
  canBeamTogetherSelection,
  canBreakBeamAfterSelection,
} from "../commands/beamCommands";
import { useViewStateStore } from "../store/viewStateStore";

const TUPLET_GLYPH_STACK_STYLE: CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "Bravura",
  // Bravura music glyph — sized independently from the --type-* chrome scale.
  fontSize: "18px",
  lineHeight: "4.4px",
  height: "20px",
  // Custom children skip Button's baseline-centring logic, so compensate
  // manually for Bravura's font baseline sitting below the line-box centre.
  transform: "translateY(-6px)",
};
const AUG_DOT_ROW_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "3px" };
const AUG_DOT_SPAN_STYLE: CSSProperties = { letterSpacing: "2px" };

/**
 * SMuFL codepoints for toolbar icons (from Bravura font).
 * Metronome note glyphs for duration buttons, accidental glyphs for accidentals.
 */
const SMUFL = {
  metNoteDoubleWhole: String.fromCodePoint(0xeca0),
  metNoteWhole: String.fromCodePoint(0xeca2),
  metNoteHalf: String.fromCodePoint(0xeca3),
  metNoteQuarter: String.fromCodePoint(0xeca5),
  metNote8th: String.fromCodePoint(0xeca7),
  metNote16th: String.fromCodePoint(0xeca9),
  metNote32nd: String.fromCodePoint(0xecab),
  metNote64th: String.fromCodePoint(0xecad),
  restQuarter: String.fromCodePoint(0xe4e5),
  augDot: String.fromCodePoint(0xecb7),
  doubleFlat: String.fromCodePoint(0xe264),
  flat: String.fromCodePoint(0xe260),
  natural: String.fromCodePoint(0xe261),
  sharp: String.fromCodePoint(0xe262),
  doubleSharp: String.fromCodePoint(0xe263),
  tripleFlat: String.fromCodePoint(0xe266),
  tripleSharp: String.fromCodePoint(0xe265),
  graceNoteAcciaccatura: String.fromCodePoint(0xe560),
  graceNoteAppoggiatura: String.fromCodePoint(0xe562),
};

interface DurationButtonDef {
  duration: NoteValueBase;
  label: string;
  title: string;
  shortcut: string;
  testId: string;
  useBravura?: boolean;
  /** Glyph alignment within the button.
   *  - `"center"` for stemmed notes so the whole figure (stem + notehead) sits visually centered.
   *  - `"baseline"` for stemless notes (whole, breve) so the notehead lines up with the
   *    noteheads of the stemmed neighbors instead of floating mid-row. */
  bravuraAlign?: "center" | "baseline";
}

const DURATION_BUTTONS_DEFAULT: DurationButtonDef[] = [
  {
    duration: "whole",
    label: SMUFL.metNoteWhole,
    title: "Whole note",
    shortcut: "7",
    testId: "1",
    useBravura: true,
    bravuraAlign: "baseline",
  },
  { duration: "half", label: SMUFL.metNoteHalf, title: "Half note", shortcut: "6", testId: "2", useBravura: true },
  {
    duration: "quarter",
    label: SMUFL.metNoteQuarter,
    title: "Quarter note",
    shortcut: "5",
    testId: "4",
    useBravura: true,
  },
  { duration: "eighth", label: SMUFL.metNote8th, title: "Eighth note", shortcut: "4", testId: "8", useBravura: true },
  { duration: "16th", label: SMUFL.metNote16th, title: "16th note", shortcut: "3", testId: "16", useBravura: true },
];

const DURATION_BUTTONS_EXTENDED: DurationButtonDef[] = [
  { duration: "maxima", label: "M", title: "Maxima (8× whole)", shortcut: "9", testId: "maxima" },
  { duration: "longa", label: "L", title: "Longa (4× whole)", shortcut: "", testId: "longa" },
  {
    duration: "breve",
    label: SMUFL.metNoteDoubleWhole,
    title: "Breve (double whole)",
    shortcut: "8",
    testId: "breve",
    useBravura: true,
    bravuraAlign: "baseline",
  },
];

const DURATION_BUTTONS_EXTENDED_SHORT: DurationButtonDef[] = [
  { duration: "32nd", label: SMUFL.metNote32nd, title: "32nd note", shortcut: "2", testId: "32", useBravura: true },
  { duration: "64th", label: SMUFL.metNote64th, title: "64th note", shortcut: "1", testId: "64", useBravura: true },
  { duration: "128th", label: "128", title: "128th note", shortcut: "", testId: "128" },
  { duration: "256th", label: "256", title: "256th note", shortcut: "", testId: "256" },
];

interface AccidentalButtonDef {
  accidental: AccidentalType;
  label: string;
  title: string;
  shortcut: string;
}

const ACCIDENTAL_BUTTONS_DEFAULT: AccidentalButtonDef[] = [
  { accidental: "flat", label: SMUFL.flat, title: "Flat", shortcut: "−" },
  { accidental: "natural", label: SMUFL.natural, title: "Natural", shortcut: "\\ note input; 0 normal mode" },
  { accidental: "sharp", label: SMUFL.sharp, title: "Sharp", shortcut: "=" },
];

const ACCIDENTAL_BUTTONS_EXTENDED_FLAT: AccidentalButtonDef[] = [
  { accidental: "triple-flat", label: SMUFL.tripleFlat, title: "Triple flat", shortcut: "" },
  { accidental: "double-flat", label: SMUFL.doubleFlat, title: "Double flat", shortcut: "Z" },
];

const ACCIDENTAL_BUTTONS_EXTENDED_SHARP: AccidentalButtonDef[] = [
  { accidental: "double-sharp", label: SMUFL.doubleSharp, title: "Double sharp", shortcut: "X" },
  { accidental: "triple-sharp", label: SMUFL.tripleSharp, title: "Triple sharp", shortcut: "" },
];

const VOICES: readonly Voice[] = [1, 2, 3, 4];

const EXTENDED_ACCIDENTALS: readonly AccidentalType[] = ["double-flat", "triple-flat", "double-sharp", "triple-sharp"];

/**
 * Streamlined toolbar: only essential note input controls.
 *
 * Layout: [N] | Durations | . .. | Rest | Accidentals | V1-V4 | Tie Slur | ↩ ↪
 *
 * Articulations, dynamics, tuplets, grace notes, and colors are in the Palette panel.
 * Streamlined notation-entry toolbar grouped by editing task.
 */
type ToolbarProps = Record<string, never>;

// eslint-disable-next-line max-lines-per-function -- toolbar render: pulls ~12 fields from the note-input store and emits one button group per (duration, rests, dots, accidentals, voice, modes, beaming, playback, history, view). Each group is 5-10 lines of JSX; splitting per group would force re-passing the store slice into every sub-component.
export function Toolbar(_props: ToolbarProps = {}) {
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const {
    state,
    toggleNoteInput,
    setDuration,
    toggleRest,
    setDotCount,
    toggleDotActive,
    setAccidental,
    setVoice,
    setGraceType,
    toggleGraceActive,
    toggleChordLock,
  } = useNoteInput();
  const store = useDocumentStoreApi();
  const updateScore = useDocumentStore((s) => s.updateScore);
  const score = useDocumentStore((s) => s.score);
  const selection = useSelectionStore((s) => s.selection);

  const activeVoice = state.currentVoice;
  const [showExtendedDurations, setShowExtendedDurations] = useState(false);
  const [showExtendedAccidentals, setShowExtendedAccidentals] = useState(false);

  // Auto-expand accidental panel when keyboard steps into double/triple range
  useEffect(() => {
    if (state.currentAccidental && EXTENDED_ACCIDENTALS.includes(state.currentAccidental)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
      setShowExtendedAccidentals(true);
    }
  }, [state.currentAccidental]);

  /**
   * Apply an edit to the currently selected note. The edit receives the
   * resolved event (addressed through any tuplet/tremolo container via
   * `getContentArrayForLocation`) and its location, so edits land on the
   * correct event even when it is nested inside a container.
   */
  const editSelectedNote = useCallback(
    (editFn: (score: Score, event: NoteEvent, loc: EventLocation) => Score | null): boolean => {
      const sel = useSelectionStore.getState().selection;
      const score = store.getState().score;
      if (!score || sel.kind !== "single" || state.active) return false;
      const loc = resolveEventLocation(sel.elementId, score);
      if (!loc) return false;
      const newScore = produce(score, (draft) => {
        const content = getContentArrayForLocation(draft, loc);
        const ev = content?.[loc.eventIndex];
        if (!ev || ev.type !== "event") return;
        editFn(draft, ev, loc);
      });
      if (newScore !== score) {
        updateScore(newScore);
        return true;
      }
      return false;
    },
    [state.active, store, updateScore],
  );

  const handleDuration = useCallback(
    (duration: NoteValueBase) => () => {
      editSelectedNote((score, _ev, loc) => {
        // changeDuration rebalances top-level sequence content and does not
        // support events nested inside a tuplet/tremolo; skip those rather
        // than corrupt the wrong top-level event.
        if (loc.tupletIndex !== undefined) return null;
        try {
          changeDuration(score, {
            measureIndex: loc.measureIndex,
            partIndex: loc.partIndex,
            voice: loc.sequenceIndex,
            eventIndex: loc.eventIndex,
            newDuration: { base: duration },
          });
          return score;
        } catch {
          return null;
        }
      });
      setDuration(duration);
    },
    [setDuration, editSelectedNote],
  );

  const handleAccidental = useCallback(
    (accidental: AccidentalType) => () => {
      editSelectedNote((score, ev) => {
        if (ev.notes && ev.notes.length > 0) {
          const alter =
            accidental === "sharp"
              ? 1
              : accidental === "flat"
                ? -1
                : accidental === "natural"
                  ? 0
                  : accidental === "double-sharp"
                    ? 2
                    : accidental === "double-flat"
                      ? -2
                      : undefined;
          if (alter !== undefined) {
            for (const note of ev.notes) {
              note.pitch = { ...note.pitch, alter: alter === 0 ? undefined : alter };
            }
            return score;
          }
        }
        return null;
      });
      setAccidental(accidental);
    },
    [setAccidental, editSelectedNote],
  );

  const _handleDot = useCallback(
    (count: DotCount) => () => {
      const newCount = state.dotCount === count ? 0 : count;
      editSelectedNote((score, ev, loc) => {
        // See handleDuration: changeDuration can't address tuplet/tremolo
        // children, so dot changes are skipped for nested events.
        if (loc.tupletIndex !== undefined) return null;
        const newDuration: Duration =
          newCount > 0 ? { base: ev.duration.base, dots: newCount } : { base: ev.duration.base };
        try {
          changeDuration(score, {
            measureIndex: loc.measureIndex,
            partIndex: loc.partIndex,
            voice: loc.sequenceIndex,
            eventIndex: loc.eventIndex,
            newDuration,
          });
          return score;
        } catch {
          return null;
        }
      });
      setDotCount(newCount);
    },
    [setDotCount, state.dotCount, editSelectedNote],
  );

  const handleVoiceClick = useCallback(
    (voice: Voice) => {
      setVoice(voice);
    },
    [setVoice],
  );

  const handleBeamBreak = useCallback(() => {
    const currentScore = store.getState().score;
    if (!currentScore) return;
    const currentSelection = useSelectionStore.getState().selection;
    let changed = false;
    const nextScore = produce(currentScore, (draft) => {
      changed = breakBeamAfterSelection(draft, currentSelection, selectedScoreIndex);
    });
    if (changed && nextScore !== currentScore) updateScore(nextScore);
  }, [selectedScoreIndex, store, updateScore]);

  const handleBeamTogether = useCallback(() => {
    const currentScore = store.getState().score;
    if (!currentScore) return;
    const currentSelection = useSelectionStore.getState().selection;
    let changed = false;
    const nextScore = produce(currentScore, (draft) => {
      changed = beamTogetherSelection(draft, currentSelection, selectedScoreIndex);
    });
    if (changed && nextScore !== currentScore) updateScore(nextScore);
  }, [selectedScoreIndex, store, updateScore]);

  const beamBreakEnabled = !state.active && canBreakBeamAfterSelection(score, selection);
  const beamTogetherEnabled = !state.active && canBeamTogetherSelection(score, selection, selectedScoreIndex);

  return (
    <div
      className={state.active ? styles.toolbarActive : styles.toolbar}
      role="toolbar"
      aria-label="Note input toolbar"
    >
      {/* ── Note Input Toggle ── */}
      <Button
        label="N"
        active={state.active}
        onClick={toggleNoteInput}
        testId="toolbar-note-input"
        ariaLabel="Toggle note input (N)"
        tooltip="Toggle note input (N)"
      />

      {/* ── Chord-mode Lock (Q) ── */}
      <Button
        active={state.chordLock}
        onClick={toggleChordLock}
        testId="toolbar-chord-lock"
        ariaLabel="Chord mode"
        tooltip="Chord mode (Q) — A-G adds to chord instead of advancing"
      >
        <span style={TUPLET_GLYPH_STACK_STYLE} aria-hidden="true">
          <span>{"\uE0A2"}</span>
          <span>{"\uE0A2"}</span>
          <span>{"\uE0A2"}</span>
        </span>
      </Button>

      <Separator />

      {/* ── Duration Buttons ── */}
      <DurationGroup
        currentDuration={state.currentDuration}
        expanded={showExtendedDurations}
        onToggleExpanded={() => setShowExtendedDurations((v) => !v)}
        onSelect={handleDuration}
      />

      <Separator />

      {/* ── Augmentation Dot (long-press or right-click for options) ── */}
      <AugmentationDotButton
        dotCount={state.dotCount}
        selectedDotCount={state.selectedDotCount}
        onSetDotCount={setDotCount}
        onToggleDotActive={toggleDotActive}
        editSelectedNote={editSelectedNote}
      />

      {/* ── Rest Toggle ── */}
      <Button
        label={SMUFL.restQuarter}
        active={state.isRest}
        onClick={toggleRest}
        useBravura
        testId="toolbar-rest"
        ariaLabel="Rest (0)"
        tooltip="Rest (0)"
      />

      {/* ── Grace Note (long-press or right-click for options) ── */}
      <LongPressButton
        title={
          state.currentGraceType
            ? `Grace note: ${state.selectedGraceType === "grace" ? "Acciaccatura (slashed)" : "Appoggiatura (unslashed)"}`
            : "Grace note (click to toggle, right-click for options)"
        }
        options={[
          { label: SMUFL.graceNoteAcciaccatura, title: "Acciaccatura (slashed)", value: "grace" as GraceType },
          { label: SMUFL.graceNoteAppoggiatura, title: "Appoggiatura (unslashed)", value: "appoggiatura" as GraceType },
        ]}
        selectedValue={state.selectedGraceType}
        active={state.currentGraceType !== null}
        onToggle={toggleGraceActive}
        onSelectedChange={(v) => setGraceType(v as GraceType)}
        useBravura
        testId="toolbar-grace"
      >
        <span>
          {state.selectedGraceType === "appoggiatura" ? SMUFL.graceNoteAppoggiatura : SMUFL.graceNoteAcciaccatura}
        </span>
      </LongPressButton>

      <Separator />

      {/* ── Accidental Buttons ── */}
      <AccidentalGroup
        currentAccidental={state.currentAccidental}
        expanded={showExtendedAccidentals}
        onToggleExpanded={() => setShowExtendedAccidentals((v) => !v)}
        onSelect={handleAccidental}
      />

      <Separator />

      {/* ── Voice Selector ── */}
      <Select
        value={String(activeVoice)}
        onValueChange={(v) => handleVoiceClick(Number(v) as Voice)}
        options={VOICES.map((v) => ({ value: String(v), label: `Voice ${v}` }))}
        data-testid="toolbar-voice"
      />

      <Separator />

      <Button
        onClick={handleBeamTogether}
        disabled={!beamTogetherEnabled}
        testId="toolbar-beam-together"
        ariaLabel="Beam selected notes"
        tooltip="Beam selected notes together"
      >
        <Link2 size={15} aria-hidden="true" />
      </Button>

      <Button
        onClick={handleBeamBreak}
        disabled={!beamBreakEnabled}
        testId="toolbar-beam-break"
        ariaLabel="Break beam after selection"
        tooltip="Break beam after the last selected note"
      >
        <Unlink2 size={15} aria-hidden="true" />
      </Button>
    </div>
  );
}

interface AugmentationDotButtonProps {
  readonly dotCount: DotCount;
  readonly selectedDotCount: 1 | 2 | 3 | 4;
  readonly onSetDotCount: (n: DotCount) => void;
  readonly onToggleDotActive: () => void;
  readonly editSelectedNote: (editFn: (score: Score, event: NoteEvent, loc: EventLocation) => Score | null) => boolean;
}

function AugmentationDotButton({
  dotCount,
  selectedDotCount,
  onSetDotCount,
  onToggleDotActive,
  editSelectedNote,
}: AugmentationDotButtonProps) {
  const applyDotCountToSelection = (count: DotCount) => {
    editSelectedNote((score, ev, loc) => {
      // changeDuration can't address tuplet/tremolo children; skip them.
      if (loc.tupletIndex !== undefined) return null;
      const newDuration: Duration = count > 0 ? { base: ev.duration.base, dots: count } : { base: ev.duration.base };
      try {
        changeDuration(score, {
          measureIndex: loc.measureIndex,
          partIndex: loc.partIndex,
          voice: loc.sequenceIndex,
          eventIndex: loc.eventIndex,
          newDuration,
        });
        return score;
      } catch {
        return null;
      }
    });
  };

  const handleToggle = () => {
    // The toggle flips dotCount between 0 and selectedDotCount, so the
    // count that lands on the selection is the *post-toggle* value.
    const next: DotCount = dotCount > 0 ? 0 : selectedDotCount;
    applyDotCountToSelection(next);
    onToggleDotActive();
  };

  const handleSelectedChange = (v: number | string) => {
    const count = v as DotCount;
    applyDotCountToSelection(count);
    onSetDotCount(count);
  };

  const active = dotCount > 0;
  return (
    <LongPressButton
      title={
        active
          ? `${dotCount} dot${dotCount > 1 ? "s" : ""} (click to remove, right-click for options)`
          : `Augmentation dot — ${selectedDotCount} dot${selectedDotCount > 1 ? "s" : ""} (click to apply, right-click for options)`
      }
      options={[
        { label: "1.", title: "Single dot", value: 1 },
        { label: "2..", title: "Double dot", value: 2 },
        { label: "3...", title: "Triple dot", value: 3 },
        { label: "4....", title: "Quadruple dot", value: 4 },
      ]}
      selectedValue={selectedDotCount}
      active={active}
      onToggle={handleToggle}
      onSelectedChange={handleSelectedChange}
      useBravura
      testId="toolbar-dot"
    >
      <span style={AUG_DOT_ROW_STYLE}>
        <span>{SMUFL.metNoteQuarter}</span>
        <span style={AUG_DOT_SPAN_STYLE}>{SMUFL.augDot.repeat(selectedDotCount)}</span>
      </span>
    </LongPressButton>
  );
}

interface DurationGroupProps {
  readonly currentDuration: NoteValueBase;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onSelect: (d: NoteValueBase) => () => void;
}

function DurationGroup({ currentDuration, expanded, onToggleExpanded, onSelect }: DurationGroupProps) {
  const renderButton = (btn: DurationButtonDef) => {
    const tip = btn.shortcut ? `${btn.title} (${btn.shortcut})` : btn.title;
    return (
      <Button
        key={btn.duration}
        label={btn.label}
        active={currentDuration === btn.duration}
        onClick={onSelect(btn.duration)}
        useBravura={btn.useBravura}
        // Note durations: each glyph's head+stem bbox is visually centered
        // in its pill (default `"center"`), so stems don't clip the top of
        // the button. The stemless `whole` and `breve` glyphs override to
        // `"baseline"` so their noteheads line up with the noteheads of
        // their stemmed neighbors instead of floating mid-pill.
        bravuraAlign={btn.bravuraAlign ?? "center"}
        testId={`toolbar-duration-${btn.testId}`}
        ariaLabel={tip}
        tooltip={tip}
      />
    );
  };
  return (
    <div className={styles.group} role="group" aria-label="Duration">
      {expanded && DURATION_BUTTONS_EXTENDED.map(renderButton)}
      {DURATION_BUTTONS_DEFAULT.map(renderButton)}
      {expanded && DURATION_BUTTONS_EXTENDED_SHORT.map(renderButton)}
      <Button
        onClick={onToggleExpanded}
        active={expanded}
        ariaLabel="Toggle extended durations"
        tooltip={expanded ? "Hide extended durations" : "Show extended durations (maxima, long, 64th\u2013256th)"}
      >
        {expanded ? <ChevronsLeft size={13} /> : <ChevronsRight size={13} />}
      </Button>
    </div>
  );
}

interface AccidentalGroupProps {
  readonly currentAccidental: AccidentalType | null;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onSelect: (a: AccidentalType) => () => void;
}

function AccidentalGroup({ currentAccidental, expanded, onToggleExpanded, onSelect }: AccidentalGroupProps) {
  const renderButton = (btn: AccidentalButtonDef) => {
    const tip = btn.shortcut ? `${btn.title} (${btn.shortcut})` : btn.title;
    return (
      <Button
        key={btn.accidental}
        label={btn.label}
        active={currentAccidental === btn.accidental}
        onClick={onSelect(btn.accidental)}
        useBravura
        bravuraSize="1.55rem"
        testId={`toolbar-accidental-${btn.accidental}`}
        ariaLabel={tip}
        tooltip={tip}
      />
    );
  };
  return (
    <div className={styles.group} role="group" aria-label="Accidentals">
      {expanded && ACCIDENTAL_BUTTONS_EXTENDED_FLAT.map(renderButton)}
      {ACCIDENTAL_BUTTONS_DEFAULT.map(renderButton)}
      {expanded && ACCIDENTAL_BUTTONS_EXTENDED_SHARP.map(renderButton)}
      <Button
        onClick={onToggleExpanded}
        active={expanded}
        ariaLabel="Toggle extended accidentals"
        tooltip={expanded ? "Hide extended accidentals" : "Show double/triple accidentals"}
      >
        {expanded ? <ChevronsLeft size={13} /> : <ChevronsRight size={13} />}
      </Button>
    </div>
  );
}
