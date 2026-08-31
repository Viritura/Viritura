/* eslint-disable max-lines -- palette is the single UI surface for ~30 input-mode property toggles (tie, slur, lv, dynamics, articulations, ornaments, tuplets, grace, dots, accidentals, voice, ...). Each toggle owns a small handler that reads selection + dispatches a score mutation; splitting into per-section files would force re-importing the same selection/score plumbing in every file with no shared sub-concept to extract. */
import { useCallback, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FormInput, IconButton, PaletteButton, PromptDialog, Tooltip } from "@viritura/ui";
import { X, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { noteInputActions, useNoteInputStore } from "../store/noteInputStore";
import { useSelection, useSelectionStore, type SelectionState } from "../store/selectionStore";
import { keyboardRegistry } from "../keyboard/KeyboardRegistry";
import { useDocumentStoreApi, useDocumentStore } from "../store/DocumentContext";
import { resolveEventLocation, getEventAtLocation, type EventLocation } from "../score/ElementPath";
import { resolveCapabilityTargets, EVENT_ACTION } from "../store/selectionCapabilities";
import { groupEventsByVoice, resolveSelectionAnchor, resolveSelectionScope } from "../store/selectionUtils";
import { resolveCondensedEventTargets, resolveCondensedSelectionEvents } from "../score/condensedWriteback";
import { useViewStateStore } from "../store/viewStateStore";
import { toggleMeasureRepeatForSelection } from "../commands/measureRepeatCommands";
import {
  toggleDynamic,
  setMultiNoteTremolo,
  setMultiNoteTremoloMarks,
  setTrillAccidental,
  type ArticulationType,
  type DynamicValue,
  type ArpeggioMarkKind,
} from "../commands/articulationCommands";
import {
  applyArticulationToSelection,
  applyArpeggioToSelection,
  applyBreathMarkToSelection,
  applyCourtesyAccidentalToSelection,
  applyFingeringToSelection,
  applyOrnamentToSelection,
  applyTrillToSelection,
  applyTremoloToSelection,
  removeTremolosFromSelection,
} from "../radialMenu/applyToSelection";
import {
  addDynamic,
  addDynamicExpression,
  addMixedExpression,
  applyBreathFermata,
} from "../radialMenu/radialMenuActions";
import { createTuplet, createTupletFromEvent, parseTupletRatio } from "../commands/tupletCommands";
import {
  durationToBeats,
  sequenceContentBeats,
  beatsToDuration,
  findLastNoteEvent,
  addTie,
  removeTies,
  addSlur,
  findForwardSlurTargetId,
  generateEventId,
} from "../commands/noteCommands";
import type {
  Score,
  OrnamentType,
  SequenceContent,
  Duration,
  Barline,
  Clef,
  Ending,
  FermataSymbol,
  BreathMarkSymbol,
  PartMeasure,
  TimeSignature,
} from "@viritura/core";
import {
  setTimeSignature,
  setKeySignature,
  setBarline,
  setClef,
  setRepeatStart,
  setRepeatEnd,
  setEnding,
} from "@viritura/core";
import {
  measureIndexFromElementId,
  measureRangeFromElementId,
  partIndexFromElementId,
  resolveInsertMeasureIndex,
  ENDING_PRESETS,
} from "../commands/signatureCommands";
import { produce } from "../score/scoreClone";
import { insertEmptyMeasures } from "../score/ScoreMutations";
import {
  SMUFL,
  ARTICULATION_ITEMS,
  DYNAMIC_ITEMS,
  TUPLET_ITEMS,
  CLEF_PALETTE_ITEMS,
  BARLINE_PALETTE_ITEMS,
  KEY_SIG_PALETTE_ITEMS,
  TIME_SIG_PALETTE_ITEMS,
  ORNAMENT_PALETTE_ITEMS,
  MEASURE_REPEAT_PALETTE_ITEMS,
  type PaletteItem,
  SingleNoteTremoloIcon,
  TwoNoteTremoloIcon,
  resolveTwoNoteTremoloSelection,
  NonArpeggioIcon,
  BarlineGlyph,
  ClefGlyph,
  TimeSigGlyph,
  KeySigGlyph,
  parseTimeSignatureInput,
  panelStyle,
  panelScrollStyle,
  gridStyle,
  wideGridStyle,
  ATONAL_LABEL_STYLE,
  CUSTOM_TIME_SIGNATURE_STYLE,
  TEMPO_LABEL_STYLE,
  TEMPO_GLYPH_STYLE,
  EXPRESSION_LABEL_STYLE,
  REHEARSAL_BOX_STYLE,
  SEARCH_ROW_STYLE,
  SEARCH_INPUT_WRAP_STYLE,
  SEARCH_INPUT_STYLE,
  eventPositionFraction,
  resolveSpannerPositions,
  SortablePaletteSection,
} from "./palette";

function measureStartIndexForSelection(selection: SelectionState, score: Score): number | null {
  if (selection.kind === "single") {
    const barlineMatch = selection.elementId.match(/^m(\d+)\/barline$/);
    if (barlineMatch) {
      const index = Number.parseInt(barlineMatch[1]!, 10);
      return index < score.global.measures.length ? index : null;
    }
  }
  const scope = resolveSelectionScope(selection, score);
  return scope?.startMeasure ?? measureIndexFromElementId(resolveSelectionAnchor(selection), score);
}

// eslint-disable-next-line max-lines-per-function, max-statements -- component body holds prompt-dialog state, ~30 handler useCallback declarations (one per palette toggle), derived selection state, and JSX layout for sortable sections. Sub-handlers and sortable section primitives are already extracted to ./palette/*; the remaining body is one-line handler wrappers + JSX wiring.
export function PalettePanel() {
  // Subscribe ONLY to the note-input slices that affect what this panel
  // renders (the active-mode flag and the tie/slur button highlight state).
  // The high-frequency slices (cursorPosition, lastPitch, currentDuration,
  // …) change on every keystroke during note entry; reading them here via
  // the full `useNoteInput()` bundle would re-render the entire palette
  // per keystroke. Handlers that need those values read them
  // imperatively from `useNoteInputStore.getState()` at click time instead.
  const active = useNoteInputStore((s) => s.active);
  const inputTieActive = useNoteInputStore((s) => s.tieActive);
  const inputSlurActive = useNoteInputStore((s) => s.slurActive);
  const { toggleTie, toggleSlur } = noteInputActions;
  const selection = useSelection();
  const store = useDocumentStoreApi();
  const updateScore = useDocumentStore((s) => s.updateScore);
  const docScore = useDocumentStore((s) => s.score);
  const selectedScoreIndex = useViewStateStore((s) => s.selectedScoreIndex);

  // ── Prompt dialog state ──
  // Single shared dialog used in place of `window.prompt()` for every
  // prompt-style action in the palette (tempo, rehearsal mark, expression).
  // `onSubmit` is captured at the time the dialog is opened so the
  // closure has the correct selection / event location.
  const [promptState, setPromptState] = useState<{
    open: boolean;
    title: string;
    initialValue: string;
    type: "text" | "number";
    allowEmpty: boolean;
    onSubmit: (value: string) => boolean | void;
  }>({
    open: false,
    title: "",
    initialValue: "",
    type: "text",
    allowEmpty: true,
    onSubmit: () => {},
  });
  const closePrompt = useCallback(() => setPromptState((p) => ({ ...p, open: false })), []);

  // â”€â”€ Derived state â”€â”€

  const selectedEventMarkings = useMemo(() => {
    if (active || selection.kind !== "single" || !docScore) return null;
    const loc = resolveEventLocation(selection.elementId, docScore);
    if (!loc) return null;
    const ev = getEventAtLocation(docScore, loc);
    if (!ev || !("markings" in ev)) return null;
    return (ev as unknown as Record<string, unknown>).markings as Record<string, unknown> | undefined;
  }, [active, selection, docScore]);

  // Derive tie/slur/lv active state from model when not in input mode
  const { tieActive, slurActive, lvActive } = useMemo(() => {
    if (active) return { tieActive: inputTieActive, slurActive: inputSlurActive, lvActive: false };
    if (selection.kind !== "single" || !docScore) return { tieActive: false, slurActive: false, lvActive: false };
    const loc = resolveEventLocation(selection.elementId, docScore);
    if (!loc) return { tieActive: false, slurActive: false, lvActive: false };
    const ev = getEventAtLocation(docScore, loc);
    if (!ev || ev.type !== "event") return { tieActive: false, slurActive: false, lvActive: false };
    const hasTie = !!(ev.notes && ev.notes.some((n) => n.ties && n.ties.length > 0));
    const hasSlur = !!(ev.slurs && ev.slurs.length > 0);
    const hasLv = !!(ev.notes && ev.notes.some((n) => n.ties?.some((t) => t.lv === true)));
    return { tieActive: hasTie, slurActive: hasSlur, lvActive: hasLv };
  }, [active, inputTieActive, inputSlurActive, selection, docScore]);

  const handleTieClick = useCallback(() => {
    if (active) {
      toggleTie();
      return;
    }
    const sel = useSelectionStore.getState().selection;
    const score = store.getState().score;
    if (!score) return;
    // A bar (measure) or multi/range selection ties every covered note as a
    // group, exactly as if each note were selected individually. Toggle as a
    // group: if any covered note is untied, add ties to all; otherwise remove.
    const events = resolveCondensedSelectionEvents(score, sel, selectedScoreIndex);
    if (events.length === 0) return;
    const newScore = produce(score, (draft) => {
      const tieables: EventLocation[] = [];
      let anyUntied = false;
      for (const loc of events) {
        const ev = getEventAtLocation(draft, loc);
        if (ev?.type !== "event" || !ev.notes?.length) continue;
        tieables.push(loc);
        if (!ev.notes.some((n) => n.ties && n.ties.length > 0)) anyUntied = true;
      }
      if (tieables.length === 0) return;
      for (const loc of tieables) {
        const tieArgs = {
          partIndex: loc.partIndex,
          measureIndex: loc.measureIndex,
          sequenceIndex: loc.sequenceIndex,
          eventIndex: loc.eventIndex,
          tupletIndex: loc.tupletIndex,
        };
        if (anyUntied) {
          addTie(draft, tieArgs);
        } else {
          removeTies(draft, tieArgs);
        }
      }
    });
    if (newScore !== score) updateScore(newScore);
  }, [active, selectedScoreIndex, store, toggleTie, updateScore]);

  const handleSlurClick = useCallback(() => {
    if (active) {
      toggleSlur();
      return;
    }
    const sel = useSelectionStore.getState().selection;
    const score = store.getState().score;
    if (!score) return;

    // A bar (measure) or any multi/range selection behaves as if every covered
    // note were selected. Because a slur can't cross staves/voices, the covered
    // notes are grouped by voice and one slur is drawn per voice (first → last)
    // — so a multi-staff bar selection slurs every staff at once. Only a
    // selection that covers exactly one note falls through to the single-note
    // toggle (slur to the following note) below.
    const events = resolveCondensedSelectionEvents(score, sel, selectedScoreIndex);
    if (events.length === 0) return;
    if (sel.kind !== "single") {
      const spanScore = produce(score, (draft) => {
        for (const group of groupEventsByVoice(events)) {
          if (group.length < 2) continue;
          const first = group[0];
          const last = group[group.length - 1];
          if (!first || !last) continue;
          const src = getEventAtLocation(draft, first);
          const tgt = getEventAtLocation(draft, last);
          if (src?.type !== "event" || tgt?.type !== "event") continue;
          if (!src.id) src.id = generateEventId();
          if (!tgt.id) tgt.id = generateEventId();
          addSlur(draft, { sourceEventId: src.id, targetEventId: tgt.id });
        }
      });
      if (spanScore !== score) updateScore(spanScore);
      return;
    }
    const newScore = produce(score, (draft) => {
      const shouldRemove = events.every((loc) => {
        const event = getEventAtLocation(draft, loc);
        return event?.type === "event" && !!event.slurs?.length;
      });
      for (const loc of events) {
        const ev = getEventAtLocation(draft, loc);
        if (!ev || ev.type !== "event") continue;
        if (shouldRemove) {
          delete ev.slurs;
          continue;
        }
        const targetId = findForwardSlurTargetId(draft, loc);
        if (!targetId) continue;
        if (!ev.id) ev.id = generateEventId();
        addSlur(draft, { sourceEventId: ev.id, targetEventId: targetId });
      }
    });
    if (newScore !== score) updateScore(newScore);
  }, [active, selectedScoreIndex, store, toggleSlur, updateScore]);

  const handleLvTie = useCallback(() => {
    const sel = useSelectionStore.getState().selection;
    const score = store.getState().score;
    if (!score || sel.kind !== "single") return;
    const loc = resolveEventLocation(sel.elementId, score);
    if (!loc) return;
    const newScore = produce(score, (draft) => {
      const ev = getEventAtLocation(draft, loc);
      if (!ev || ev.type !== "event" || !ev.notes?.length) return;
      const hasLv = ev.notes.some((n) => n.ties?.some((t) => t.lv === true));
      for (const note of ev.notes) {
        if (hasLv) {
          // Remove L.V. ties
          if (note.ties) {
            note.ties = note.ties.filter((t) => !t.lv);
            if (note.ties.length === 0) delete note.ties;
          }
        } else {
          // Add L.V. tie
          if (!note.ties) note.ties = [];
          note.ties.push({ lv: true });
        }
      }
    });
    if (newScore !== score) updateScore(newScore);
  }, [store, updateScore]);

  // ── Measure-level helpers (shared by time/key/barline/clef/repeat/ending) ──

  const getEditorState = useCallback(() => {
    const score = store.getState().score;
    if (!score) return null;
    const sel = useSelectionStore.getState().selection;
    const elementId = sel.kind === "single" ? sel.elementId : null;
    return { score, elementId };
  }, [store]);

  const handleSetTimeSignature = useCallback(
    (time: TimeSignature) => {
      const score = store.getState().score;
      if (!score) return;
      const selection = useSelectionStore.getState().selection;
      const measureIndex = measureStartIndexForSelection(selection, score) ?? 0;
      updateScore(setTimeSignature(score, measureIndex, time));
    },
    [store, updateScore],
  );

  const handleCustomTimeSignature = useCallback(() => {
    const score = store.getState().score;
    if (!score) return;
    const selection = useSelectionStore.getState().selection;
    const targetMeasureIndex = measureStartIndexForSelection(selection, score) ?? 0;
    setPromptState({
      open: true,
      title: "Custom time signature",
      initialValue: "5/8",
      type: "text",
      allowEmpty: false,
      onSubmit: (input) => {
        const time = parseTimeSignatureInput(input);
        if (!time) {
          toast.warning("Use n/d with denominator 1, 2, 4, 8, 16, 32, 64, or 128");
          return false;
        }
        const latestScore = store.getState().score;
        if (latestScore) updateScore(setTimeSignature(latestScore, targetMeasureIndex, time));
        return true;
      },
    });
  }, [store, updateScore]);

  const handleSetKeySignature = useCallback(
    (key: { fifths: number }) => {
      const es = getEditorState();
      if (!es) return;
      const idx = measureIndexFromElementId(es.elementId, es.score) ?? 0;
      updateScore(setKeySignature(es.score, idx, key));
    },
    [getEditorState, updateScore],
  );

  const handleSetBarline = useCallback(
    (barline: { type: string }) => {
      const es = getEditorState();
      if (!es) return;
      const idx = measureIndexFromElementId(es.elementId, es.score) ?? 0;
      updateScore(setBarline(es.score, idx, barline as Barline));
    },
    [getEditorState, updateScore],
  );

  const handleSetClef = useCallback(
    (clef: { sign: string; staffPosition: number; octave?: number; glyph?: string }) => {
      const es = getEditorState();
      if (!es) return;
      const score = es.score;
      const measureIndex = measureIndexFromElementId(es.elementId, es.score) ?? 0;
      const partIndex = partIndexFromElementId(es.elementId, es.score) ?? 0;
      let position: { fraction: [number, number] } | undefined;
      const sel = useSelectionStore.getState().selection;
      if (sel.kind === "single") {
        const loc = resolveEventLocation(sel.elementId, score);
        if (loc) {
          const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
          if (seq) {
            const beatOffset = seq.content
              .slice(0, loc.eventIndex)
              .reduce((sum, c) => sum + sequenceContentBeats(c as SequenceContent), 0);
            if (beatOffset > 0) {
              let num = Math.round(beatOffset * 1024);
              let den = 4096;
              const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
              const d = gcd(Math.abs(num), den);
              num /= d;
              den /= d;
              position = { fraction: [num, den] };
            }
          }
        }
      }
      updateScore(setClef(score, measureIndex, partIndex, clef as Clef, position ? { position } : undefined));
    },
    [getEditorState, updateScore],
  );

  /** Get the raw barline measure index (without N-1 adjustment) when a barline is selected. */
  const barlineMeasureIndex = useCallback((): number | null => {
    const sel = useSelectionStore.getState().selection;
    if (sel.kind !== "single" || !sel.elementId) return null;
    const match = sel.elementId.match(/^m(\d+)\/barline$/);
    return match ? parseInt(match[1]!, 10) : null;
  }, []);

  const handleSetRepeatStart = useCallback(
    (rs: Record<string, unknown> | null) => {
      const es = getEditorState();
      if (!es) return;
      // When a barline is selected, repeat-start goes on the measure AFTER the barline
      // (the barline at the start of measure N → repeatStart on measure N)
      const barlineIdx = barlineMeasureIndex();
      const idx = barlineIdx ?? measureIndexFromElementId(es.elementId, es.score) ?? 0;
      updateScore(setRepeatStart(es.score, idx, rs));
    },
    [getEditorState, updateScore, barlineMeasureIndex],
  );

  const handleSetRepeatEnd = useCallback(
    (re: Record<string, unknown> | null) => {
      const es = getEditorState();
      if (!es) return;
      // When a barline is selected, repeat-end goes on the measure BEFORE the barline
      // (measureIndexFromElementId already does N-1 for barlines)
      const idx = measureIndexFromElementId(es.elementId, es.score) ?? 0;
      updateScore(setRepeatEnd(es.score, idx, re));
    },
    [getEditorState, updateScore],
  );

  const handleSetRepeatBoth = useCallback(() => {
    const es = getEditorState();
    if (!es) return;
    const barlineIdx = barlineMeasureIndex();
    // Repeat-end on the measure before the barline, repeat-start on the measure after
    const endIdx =
      barlineIdx != null ? Math.max(0, barlineIdx - 1) : (measureIndexFromElementId(es.elementId, es.score) ?? 0);
    const startIdx = barlineIdx ?? measureIndexFromElementId(es.elementId, es.score) ?? 0;
    let newScore = setRepeatEnd(es.score, endIdx, {});
    newScore = setRepeatStart(newScore, startIdx, {});
    updateScore(newScore);
  }, [getEditorState, updateScore, barlineMeasureIndex]);

  const handleToggleMeasureRepeat = useCallback(
    (number: 1 | 2 | 4) => {
      const score = store.getState().score;
      if (!score) return;
      const result = toggleMeasureRepeatForSelection(score, useSelectionStore.getState().selection, number);
      if (result.error) {
        toast.warning(result.error);
        return;
      }
      if (result.score !== score) updateScore(result.score);
    },
    [store, updateScore],
  );

  const handleSetEnding = useCallback(
    (ending: Ending | null) => {
      const es = getEditorState();
      if (!es) return;
      const range = measureRangeFromElementId(es.elementId, es.score);
      const idx = range?.start ?? 0;
      const endingToSet = ending !== null && range ? { ...ending, duration: range.end - range.start + 1 } : ending;
      updateScore(setEnding(es.score, idx, endingToSet));
    },
    [getEditorState, updateScore],
  );

  const editSelectedNote = useCallback(
    (editFn: (score: Score, loc: EventLocation) => Score | null): boolean => {
      const sel = useSelectionStore.getState().selection;
      const score = store.getState().score;
      if (!score || sel.kind === "none" || active) return false;

      // Resolve every event the selection covers through the declared
      // capability contract (EVENT_ACTION: single / multi / range / measure,
      // tuplet-aware, de-duplicated). This is the one place palette edits map a
      // selection to events; the per-kind ladders that used to live here
      // drifted from the rest of the editor. Going through the contract keeps
      // the runtime behavior and docs/spec/selection-behavior-matrix.md in sync.
      const targets = resolveCapabilityTargets(EVENT_ACTION, sel, score);
      if (!targets || targets.mode !== "events") return false;
      const events = targets.events;

      const newScore = produce(score, (draft) => {
        for (const loc of events) {
          editFn(draft, loc);
        }
      });
      if (newScore !== score) {
        updateScore(newScore);
        return true;
      }
      return false;
    },
    [active, store, updateScore],
  );

  // â”€â”€ Handlers â”€â”€

  // Run a selection-wide score transform (the match-aware applyXToSelection
  // helpers) behind the common palette guards: a resolvable selection that
  // isn't in note-entry mode. Keeps the per-marking handlers one line each.
  const applySelectionScore = useCallback(
    (run: (score: Score, sel: SelectionState) => Score | null) => {
      const sel = useSelectionStore.getState().selection;
      const score = store.getState().score;
      if (!score || sel.kind === "none" || active) {
        toast.warning(active ? "Finish note entry or select existing notes first" : "Select one or more notes first");
        return;
      }
      const newScore = run(score, sel);
      if (newScore) updateScore(newScore);
      else toast.warning("That marking cannot be applied to the current selection");
    },
    [active, store, updateScore],
  );

  const handleArticulation = useCallback(
    // "Match" semantics: a mixed on/off selection unifies to ON first, then a
    // second press clears it — instead of inverting each note independently.
    (articulation: ArticulationType) => () =>
      applySelectionScore((score, sel) => applyArticulationToSelection(score, sel, articulation, selectedScoreIndex)),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleDynamic = useCallback(
    (value: DynamicValue) => () => {
      if (!active) {
        applySelectionScore((score, sel) => addDynamic(score, sel, value, selectedScoreIndex));
        return;
      }
      const score = store.getState().score;
      const ni = useNoteInputStore.getState();
      if (ni.active && score) {
        const partIndex = ni.cursorPosition?.partIndex ?? 0;
        const voice = ni.currentVoice - 1;
        const loc = findLastNoteEvent(score, partIndex, voice);
        if (loc) {
          const newScore = produce(score, (draft) => {
            toggleDynamic(draft, partIndex, loc.measureIndex, voice, loc.eventIndex, value);
          });
          if (newScore !== score) updateScore(newScore);
        }
      }
    },
    [active, applySelectionScore, selectedScoreIndex, store, updateScore],
  );

  // ── Shared spanner position computation ─────────────────
  // Computes start/end beat positions and measure IDs from the current selection.
  // Used by hairpins, ottavas, and pedals.
  const computeSpannerPositions = useCallback(
    (
      onMutate: (
        draft: Score,
        loc: NonNullable<ReturnType<typeof resolveEventLocation>>,
        partMeasure: PartMeasure,
        position: { fraction: [number, number] },
        end: { measure: string; position: { fraction: [number, number] } },
      ) => void,
    ): boolean => {
      const score = store.getState().score;
      const sel = useSelectionStore.getState().selection;
      if (!score) return false;

      const positions = resolveSpannerPositions(score, sel, selectedScoreIndex);
      if (!positions) return false;

      const newScore = produce(score, (draft) => {
        positions.targets.forEach((target) => {
          const partMeasure = draft.parts[target.partIndex]?.measures[target.measureIndex];
          if (partMeasure) onMutate(draft, target, partMeasure, positions.position, positions.end);
        });
      });

      if (newScore !== score) {
        updateScore(newScore);
        return true;
      }
      return false;
    },
    [selectedScoreIndex, store, updateScore],
  );

  const handleHairpin = useCallback(
    (type: "crescendo" | "decrescendo") => () =>
      applySelectionScore((score, sel) =>
        addDynamicExpression(
          score,
          sel,
          [{ type: type === "crescendo" ? "crescendo" : "diminuendo" }],
          selectedScoreIndex,
        ),
      ),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleToggleGlobalMeasureProp = useCallback(
    (prop: "segno" | "coda" | "fine") => () => {
      const score = store.getState().score;
      const sel = useSelectionStore.getState().selection;
      if (!score || sel.kind !== "single") return;
      // Segno is a landing point that opens new content, so a barline
      // selection targets the measure AFTER it (like repeat-start). Coda/fine
      // conclude the bar they're written in, so `measureIndexFromElementId`'s
      // barline N-1 handling (like repeat-end) is what we want there.
      const measureIndex =
        prop === "segno"
          ? (barlineMeasureIndex() ?? measureIndexFromElementId(sel.elementId, score))
          : measureIndexFromElementId(sel.elementId, score);
      if (measureIndex === null) return;
      const newScore = produce(score, (draft) => {
        const gm = draft.global.measures[measureIndex];
        if (!gm) return;
        if ((gm as Record<string, unknown>)[prop]) {
          delete (gm as Record<string, unknown>)[prop];
        } else {
          (gm as Record<string, unknown>)[prop] = { location: { fraction: [0, 1] } };
        }
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, updateScore, barlineMeasureIndex],
  );

  const handleAddPedal = useCallback(
    (type: "sustain" | "sostenuto" | "una-corda") => () => {
      computeSpannerPositions((draft, _loc, partMeasure, position, end) => {
        const existing = partMeasure.pedals ?? [];
        existing.push({ type, position, end });
        partMeasure.pedals = existing;
      });
    },
    [computeSpannerPositions],
  );

  const handleSetJump = useCallback(
    (type: string) => () => {
      const score = store.getState().score;
      const sel = useSelectionStore.getState().selection;
      if (!score || sel.kind !== "single") return;
      // A jump instruction (D.S./D.C. al Coda, ...) concludes the bar it's
      // written in, so a barline selection targets the measure BEFORE it
      // (measureIndexFromElementId already does N-1 for barlines).
      const measureIndex = measureIndexFromElementId(sel.elementId, score);
      if (measureIndex === null) return;
      const newScore = produce(score, (draft) => {
        const gm = draft.global.measures[measureIndex];
        if (!gm) return;
        if (
          (gm as Record<string, unknown>).jump &&
          ((gm as Record<string, unknown>).jump as { type: string }).type === type
        ) {
          delete (gm as Record<string, unknown>).jump;
        } else {
          (gm as Record<string, unknown>).jump = { type, location: { fraction: [0, 1] } };
        }
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, updateScore],
  );

  const handleSetCaesura = useCallback(
    (style: string) => () => {
      const score = store.getState().score;
      const sel = useSelectionStore.getState().selection;
      if (!score || sel.kind !== "single") return;
      // A caesura sits at/near the end of the bar it's written in, so a
      // barline selection targets the measure BEFORE it (N-1, like coda/jump).
      const measureIndex = measureIndexFromElementId(sel.elementId, score);
      if (measureIndex === null) return;
      const newScore = produce(score, (draft) => {
        const gm = draft.global.measures[measureIndex];
        if (!gm) return;
        if ((gm as Record<string, unknown>).caesura) {
          delete (gm as Record<string, unknown>).caesura;
        } else {
          (gm as Record<string, unknown>).caesura = { style };
        }
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, updateScore],
  );

  const handleSetTempo = useCallback(() => {
    const score = store.getState().score;
    const sel = useSelectionStore.getState().selection;
    if (!score || sel.kind !== "single") return;
    const loc = resolveEventLocation(sel.elementId, score);
    if (!loc) return;
    const current = score.global.measures[loc.measureIndex]?.tempos?.[0]?.bpm?.toString() ?? "";
    setPromptState({
      open: true,
      title: "Tempo (BPM)",
      initialValue: current,
      type: "number",
      allowEmpty: true,
      onSubmit: (input) => {
        const newScore = produce(score, (draft) => {
          const gm = draft.global.measures[loc.measureIndex];
          if (!gm) return;
          if (!input.trim()) {
            gm.tempos = [];
          } else {
            const bpm = Number(input);
            if (isNaN(bpm) || bpm <= 0) return;
            const existing = gm.tempos?.[0];
            gm.tempos = [{ bpm, value: existing?.value ?? { base: "quarter" } }];
          }
        });
        if (newScore !== score) updateScore(newScore);
      },
    });
  }, [store, updateScore]);

  const handleSetRehearsalMark = useCallback(() => {
    const score = store.getState().score;
    const sel = useSelectionStore.getState().selection;
    if (!score) return;
    const measureIndex = measureStartIndexForSelection(sel, score);
    if (measureIndex === null) return;
    const current = (score.global.measures[measureIndex] as Record<string, unknown>)?.rehearsalMark as
      | { text?: string }
      | undefined;
    setPromptState({
      open: true,
      title: "Rehearsal mark",
      initialValue: current?.text ?? "",
      type: "text",
      allowEmpty: true,
      onSubmit: (input) => {
        const newScore = produce(score, (draft) => {
          const gm = draft.global.measures[measureIndex];
          if (!gm) return;
          if (!input.trim()) {
            delete (gm as Record<string, unknown>).rehearsalMark;
          } else {
            (gm as Record<string, unknown>).rehearsalMark = { text: input.trim() };
          }
        });
        if (newScore !== score) updateScore(newScore);
      },
    });
  }, [store, updateScore]);

  const handleAddStaffText = useCallback(() => {
    const score = store.getState().score;
    const sel = useSelectionStore.getState().selection;
    if (!score || sel.kind !== "single") return;
    const loc = resolveEventLocation(sel.elementId, score);
    if (!loc) return;
    setPromptState({
      open: true,
      title: "Staff text",
      initialValue: "",
      type: "text",
      allowEmpty: false,
      onSubmit: (input) => {
        if (!input.trim()) return;
        const targets = resolveCondensedEventTargets(score, selectedScoreIndex, loc);
        const newScore = produce(score, (draft) => {
          const fraction = eventPositionFraction(score, loc);

          for (const target of targets) {
            const partMeasure = draft.parts[target.partIndex]?.measures[target.measureIndex];
            if (!partMeasure) continue;
            partMeasure.expressions = [
              ...(partMeasure.expressions ?? []),
              { text: input.trim(), position: { fraction }, placement: "above" },
            ];
          }
        });
        if (newScore !== score) updateScore(newScore);
      },
    });
  }, [selectedScoreIndex, store, updateScore]);

  const handleAddExpression = useCallback(() => {
    const score = store.getState().score;
    const sel = useSelectionStore.getState().selection;
    if (!score || sel.kind === "none") return;
    setPromptState({
      open: true,
      title: "Expression text",
      initialValue: "",
      type: "text",
      allowEmpty: false,
      onSubmit: (input) => {
        if (!input.trim()) return;
        const newScore = addMixedExpression(score, sel, [{ type: "text", value: input.trim() }], selectedScoreIndex);
        if (newScore) updateScore(newScore);
      },
    });
  }, [selectedScoreIndex, store, updateScore]);

  const handleAddBars = useCallback(() => {
    const score = store.getState().score;
    if (!score) return;
    // Insert relative to the selection (barline boundary / after a note or
    // measure / append when nothing resolves) — shared with the Shift+B radial.
    const insertAt = resolveInsertMeasureIndex(getEditorState()?.elementId ?? null, score);
    setPromptState({
      open: true,
      title: "Add bars",
      initialValue: "1",
      type: "number",
      allowEmpty: false,
      onSubmit: (input) => {
        const count = Number(input);
        if (!Number.isInteger(count) || count < 1 || count > 999) return;
        const newScore = insertEmptyMeasures(score, insertAt, count);
        if (newScore !== score) updateScore(newScore);
      },
    });
  }, [store, updateScore, getEditorState]);

  const handleAddOttava = useCallback(
    (value: number) => () => {
      computeSpannerPositions((draft, _loc, partMeasure, position, end) => {
        const existing = partMeasure.ottavas ?? [];
        existing.push({ value, position, end });
        partMeasure.ottavas = existing;
      });
    },
    [computeSpannerPositions],
  );

  const handleBreathMark = useCallback(
    (symbol: BreathMarkSymbol | undefined) => () =>
      applySelectionScore((score, sel) => applyBreathMarkToSelection(score, sel, symbol, selectedScoreIndex)),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleTremolo = useCallback(
    (marks: number) => () =>
      applySelectionScore((score, sel) => applyTremoloToSelection(score, sel, marks as 1 | 2 | 3, selectedScoreIndex)),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleMultiNoteTremolo = useCallback(
    (marks: 1 | 2 | 3) => () => {
      const sel = useSelectionStore.getState().selection;
      const score = store.getState().score;
      if (!score || active) return;

      const locations = resolveTwoNoteTremoloSelection(sel, score);
      const firstLocation = locations[0];
      if (firstLocation?.tupletIndex !== undefined) {
        const container =
          score.parts[firstLocation.partIndex]?.measures[firstLocation.measureIndex]?.sequences[
            firstLocation.sequenceIndex
          ]?.content[firstLocation.tupletIndex];
        if (container?.type === "tremolo") {
          const newScore = produce(score, (draft) => {
            setMultiNoteTremoloMarks(
              draft,
              firstLocation.partIndex,
              firstLocation.measureIndex,
              firstLocation.sequenceIndex,
              firstLocation.tupletIndex!,
              marks,
            );
          });
          if (newScore !== score) updateScore(newScore);
          return;
        }
      }

      if (locations.length !== 2) {
        toast.warning("Select two adjacent notes for a two-note tremolo");
        return;
      }
      const loc1 = locations[0]!;
      const loc2 = locations[1]!;

      // Must be in the same part, measure, and sequence
      if (
        loc1.partIndex !== loc2.partIndex ||
        loc1.measureIndex !== loc2.measureIndex ||
        loc1.sequenceIndex !== loc2.sequenceIndex
      ) {
        toast.warning("Select two adjacent notes in the same voice");
        return;
      }

      const newScore = produce(score, (draft) => {
        setMultiNoteTremolo(
          draft,
          loc1.partIndex,
          loc1.measureIndex,
          loc1.sequenceIndex,
          loc1.eventIndex,
          loc2.eventIndex,
          marks,
        );
      });
      if (newScore !== score) updateScore(newScore);
    },
    [active, store, updateScore],
  );

  const handleRemoveTremolo = useCallback(() => {
    const sel = useSelectionStore.getState().selection;
    const score = store.getState().score;
    if (!score || active) return;
    const newScore = removeTremolosFromSelection(score, sel, selectedScoreIndex);
    if (!newScore) {
      toast.warning("Select one or more tremolos to remove them");
      return;
    }
    updateScore(newScore);
  }, [active, selectedScoreIndex, store, updateScore]);

  const handleFermata = useCallback(
    (shape: string) => () =>
      applySelectionScore((score, sel) =>
        applyBreathFermata(score, sel, { kind: "fermata", shape: shape as FermataSymbol }, selectedScoreIndex),
      ),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleOrnament = useCallback(
    // Match semantics: a mixed selection unifies to ON, a second press clears it.
    (ornament: string) => () =>
      applySelectionScore((score, sel) =>
        applyOrnamentToSelection(score, sel, ornament as OrnamentType, selectedScoreIndex),
      ),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleArpeggio = useCallback(
    (kind: ArpeggioMarkKind) => () =>
      applySelectionScore((score, sel) => applyArpeggioToSelection(score, sel, kind, selectedScoreIndex)),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleFingering = useCallback(
    // Match semantics: a mixed selection unifies to ON, a second press clears it.
    (finger: number) => () =>
      applySelectionScore((score, sel) => applyFingeringToSelection(score, sel, finger, selectedScoreIndex)),
    [applySelectionScore, selectedScoreIndex],
  );

  // Kept under a `_` prefix while the trill accidental palette row is being
  // unified with the global accidental palette (see grandfather TODO history
  // in eslint.config.js).
  const _handleTrillAccidental = useCallback(
    (accidental: number | null) => () => {
      editSelectedNote((score, loc) =>
        setTrillAccidental(
          score,
          loc.partIndex,
          loc.measureIndex,
          loc.sequenceIndex,
          loc.eventIndex,
          accidental as -1 | 0 | 1 | null,
          loc.tupletIndex,
        ),
      );
    },
    [editSelectedNote],
  );

  const handleToggleTrill = useCallback(
    // Match semantics: a mixed selection unifies to ON, a second press clears it.
    () => applySelectionScore((score, sel) => applyTrillToSelection(score, sel, selectedScoreIndex)),
    [applySelectionScore, selectedScoreIndex],
  );

  const handleTuplet = useCallback(
    (tupletNumber: number, outerMultiple: number) => () => {
      const score = store.getState().score;
      const sel = useSelectionStore.getState().selection;
      if (!score) return;

      const ni = useNoteInputStore.getState();
      if (sel.kind !== "single" && (!ni.active || !ni.cursorPosition)) {
        toast.warning("Select a note or activate note input before creating a tuplet");
        return;
      }

      const newScore = produce(score, (draft) => {
        // Mode 1: Selection — convert the selected event into a tuplet.
        if (sel.kind === "single") {
          const loc = resolveEventLocation(sel.elementId, draft);
          if (!loc) return;
          if (loc.tupletIndex !== undefined) {
            toast.warning("Cannot create a tuplet inside another tuplet");
            return;
          }
          try {
            createTupletFromEvent(draft, {
              measureIndex: loc.measureIndex,
              partIndex: loc.partIndex,
              voice: loc.sequenceIndex,
              eventIndex: loc.eventIndex,
              tupletNumber,
              outerMultiple,
            });
          } catch (err) {
            console.warn("[Tuplet]", (err as Error).message);
            toast.warning((err as Error).message || "Failed to create tuplet");
          }
          return;
        }

        // Mode 2: Note input mode — create a tuplet at the cursor position.
        if (ni.active && ni.cursorPosition) {
          const cursor = ni.cursorPosition;
          const voice = ni.currentVoice - 1;

          const totalDuration: Duration = {
            base: ni.currentDuration,
            ...(ni.dotCount > 0 ? { dots: ni.dotCount } : {}),
          };
          const baseDuration = beatsToDuration(durationToBeats(totalDuration) / outerMultiple);
          if (!baseDuration) {
            toast.warning(`${tupletNumber}:${outerMultiple} cannot exactly divide the selected duration`);
            return;
          }

          try {
            createTuplet(draft, {
              measureIndex: cursor.measureIndex,
              partIndex: cursor.partIndex,
              voice,
              beatPosition: cursor.beatPosition,
              tupletNumber,
              outerMultiple,
              baseDuration,
            });
          } catch (err) {
            console.warn("[Tuplet]", (err as Error).message);
            toast.warning((err as Error).message || "Failed to create tuplet");
          }
        }
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, updateScore],
  );

  const handleCustomTuplet = useCallback(() => {
    setPromptState({
      open: true,
      title: "Tuplet ratio (notes:time)",
      initialValue: "3:2",
      type: "text",
      allowEmpty: false,
      onSubmit: (value) => {
        const ratio = parseTupletRatio(value);
        if (!ratio) {
          toast.warning("Enter different whole numbers from 1 to 32, such as 3:2");
          return false;
        }
        handleTuplet(ratio.inner, ratio.outer)();
      },
    });
  }, [handleTuplet]);

  // â”€â”€ Accidental display handlers â”€â”€

  const handleCourtesyAccidental = useCallback(() => {
    applySelectionScore((score, sel) => applyCourtesyAccidentalToSelection(score, sel, selectedScoreIndex));
  }, [applySelectionScore, selectedScoreIndex]);

  // ── Keyboard shortcuts for palette actions (registered centrally) ──
  // Z/X/C/V/B = articulations; A = courtesy accidental.
  // Articulations are normal-mode only — registered as global with a
  // mutually-exclusive `when` predicate so the registry knows they're
  // disabled in note-input mode.

  // The keyboard registry calls these handlers from outside React (after
  // commit), so wrap the latest-value reads in `useEffectEvent`: the
  // registration Effect runs once on mount, but each invocation always
  // sees the latest committed `handleArticulation`/`handleCourtesyAccidental`
  // and `state.active`. (React 19 stable; see
  // https://react.dev/reference/react/useEffectEvent.)
  const onArticulationKey = useEffectEvent((art: ArticulationType) => {
    handleArticulation(art)();
  });
  const onCourtesyAccidentalKey = useEffectEvent(() => {
    const sel = useSelectionStore.getState().selection;
    if (sel.kind === "single" && !useNoteInputStore.getState().active) {
      handleCourtesyAccidental();
    }
  });

  useEffect(() => {
    const articulationMap: Record<string, ArticulationType> = {
      Z: "staccato",
      X: "tenuto",
      C: "accent",
      V: "strongAccent",
      B: "staccatissimo",
    };
    const teardowns: Array<() => void> = [];
    for (const [letter, art] of Object.entries(articulationMap)) {
      teardowns.push(
        keyboardRegistry.register({
          id: `palette.articulation.${art}`,
          key: letter,
          context: "normal",
          handler: () => {
            onArticulationKey(art);
          },
        }),
      );
    }
    teardowns.push(
      keyboardRegistry.register({
        id: "palette.courtesyAccidental",
        key: "A",
        context: "normal",
        handler: () => {
          onCourtesyAccidentalKey();
        },
      }),
    );
    return () => {
      for (const t of teardowns) t();
    };
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const searchLower = searchQuery.toLowerCase();

  // ── Persisted UI state: open/closed per section, and section order. ──
  // Both live in localStorage so the panel layout survives refresh. The
  // open map is sparse (unset → defaults to open) so we only persist
  // explicit user toggles.
  const ORDER_KEY = "viritura.palettes.order.v1";
  const OPEN_KEY = "viritura.palettes.open.v1";
  const [paletteOrder, setPaletteOrderState] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(ORDER_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const setPaletteOrder = useCallback((next: string[]) => {
    setPaletteOrderState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ORDER_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
  }, []);
  const [openMap, setOpenMapState] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const setOpenMap = useCallback((next: Record<string, boolean>) => {
    setOpenMapState(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Activate drag only after a small movement so plain clicks on the
  // handle still bubble cleanly to focus/aria handlers.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Filter function - checks if an item matches the search
  const matchesSearch = (item: PaletteItem): boolean => {
    if (!searchQuery) return true;
    return item.title.toLowerCase().includes(searchLower) || item.id.toLowerCase().includes(searchLower);
  };

  // Check if any items in a section match
  const articulationsMatch = ARTICULATION_ITEMS.some(matchesSearch);
  const dynamicsMatch = DYNAMIC_ITEMS.some(matchesSearch);
  const breathMatch = !searchQuery || "breath comma tick caesura fermata".includes(searchLower);
  const tupletsMatch = TUPLET_ITEMS.some(matchesSearch);
  const ornamentsMatch = !searchQuery || "trill turn mordent inverted delayed schleifer ornament".includes(searchLower);
  const tremMatch = !searchQuery || "tremolo slash single".includes(searchLower);
  const arpMatch = !searchQuery || "arpeggio up down plain no arrow".includes(searchLower);
  const tempoMatch = !searchQuery || "tempo bpm".includes(searchLower);
  const textMatch = !searchQuery || "rehearsal mark expression text".includes(searchLower);
  const linesMatch =
    !searchQuery || "ottava 8va 8vb 15ma 15mb pedal sustain sostenuto una corda lines".includes(searchLower);
  const repeatsNavigationMatch =
    MEASURE_REPEAT_PALETTE_ITEMS.some(matchesSearch) ||
    !searchQuery ||
    "repeat navigation segno coda fine ending volta".includes(searchLower);

  // ── Category catalog ─────────────────────────────────────────
  // One entry per Collapsible section. `show` gates against the current
  // search query (sections without searchable items default to !searchQuery
  // so they hide while searching). Rendering order is driven by the
  // persisted `paletteOrder` state below; users can drag to reorder.
  const categories: Array<{
    id: string;
    title: string;
    shortcut?: string;
    show: boolean;
    render: () => ReactNode;
  }> = [
    {
      id: "clef",
      title: "Clef",
      shortcut: "Shift+C",
      show: !searchQuery,
      render: () => (
        <div style={wideGridStyle}>
          {CLEF_PALETTE_ITEMS.map((p) => (
            <PaletteButton shape="tall" key={p.id} title={p.label} onClick={() => handleSetClef(p.clef)}>
              <ClefGlyph
                sign={p.clef.sign}
                staffPosition={p.clef.staffPosition}
                octave={p.clef.octave}
                glyphOverride={p.clef.glyph}
              />
            </PaletteButton>
          ))}
        </div>
      ),
    },
    {
      id: "keysig",
      title: "Key Signature",
      shortcut: "Shift+5",
      show: !searchQuery,
      render: () => (
        <div style={wideGridStyle}>
          {KEY_SIG_PALETTE_ITEMS.map((p) => (
            <PaletteButton
              shape="tall"
              key={p.id}
              title={p.label}
              onClick={() =>
                handleSetKeySignature({ fifths: p.keySig.fifths, ...(p.keySig.atonal ? { atonal: true } : {}) })
              }
            >
              {p.keySig.atonal ? (
                <span style={ATONAL_LABEL_STYLE}>atonal</span>
              ) : (
                <KeySigGlyph fifths={p.keySig.fifths} />
              )}
            </PaletteButton>
          ))}
        </div>
      ),
    },
    {
      id: "timesig",
      title: "Time Signature",
      shortcut: "Shift+4",
      show: !searchQuery,
      render: () => (
        <div style={wideGridStyle}>
          {TIME_SIG_PALETTE_ITEMS.map((p) => {
            const symbolicGlyph =
              p.time.display === "common"
                ? SMUFL.timeSigCommon
                : p.time.display === "cut"
                  ? SMUFL.timeSigCut
                  : p.time.display === "senzaMisura"
                    ? SMUFL.timeSigOpenPenderecki
                    : null;
            if (symbolicGlyph !== null) {
              return (
                <PaletteButton
                  shape="tall"
                  key={p.id}
                  title={p.label}
                  useBravura
                  label={symbolicGlyph}
                  onClick={() => handleSetTimeSignature(p.time)}
                />
              );
            }
            return (
              <PaletteButton shape="tall" key={p.id} title={p.label} onClick={() => handleSetTimeSignature(p.time)}>
                <TimeSigGlyph count={p.time.count} unit={p.time.unit} />
              </PaletteButton>
            );
          })}
          <PaletteButton shape="tall" title="Custom time signature" onClick={handleCustomTimeSignature}>
            <span style={CUSTOM_TIME_SIGNATURE_STYLE}>n/d</span>
          </PaletteButton>
        </div>
      ),
    },
    {
      id: "barline",
      title: "Bars",
      shortcut: "Shift+B",
      show: !searchQuery,
      render: () => (
        <div style={wideGridStyle}>
          {BARLINE_PALETTE_ITEMS.map((p) => (
            <PaletteButton shape="tall" key={p.id} title={p.label} onClick={() => handleSetBarline(p.barline)}>
              <BarlineGlyph glyph={p.glyph} />
            </PaletteButton>
          ))}
          <PaletteButton shape="wide" label="Add bars…" title="Insert bars at the selection" onClick={handleAddBars} />
        </div>
      ),
    },
    {
      id: "articulations",
      title: "Articulations",
      shortcut: "Shift+A",
      show: articulationsMatch,
      render: () => (
        <div style={gridStyle}>
          {ARTICULATION_ITEMS.filter(matchesSearch).map((item) => (
            <PaletteButton
              key={item.id}
              label={item.label}
              title={item.title}
              useBravura={item.useBravura}
              shortcut={item.shortcut}
              active={!!selectedEventMarkings?.[item.articulation]}
              onClick={handleArticulation(item.articulation)}
            />
          ))}
        </div>
      ),
    },
    {
      id: "dynamics",
      title: "Dynamics",
      shortcut: "Shift+D",
      show: dynamicsMatch,
      render: () => (
        <div style={gridStyle}>
          {DYNAMIC_ITEMS.filter(matchesSearch).map((item) => (
            <PaletteButton
              key={item.id}
              label={item.label}
              title={item.title}
              useBravura={item.useBravura}
              onClick={handleDynamic(item.value)}
            />
          ))}
          <PaletteButton
            label={SMUFL.hairpinCrescendo}
            title="Crescendo hairpin"
            useBravura
            onClick={handleHairpin("crescendo")}
          />
          <PaletteButton
            label={SMUFL.hairpinDecrescendo}
            title="Decrescendo hairpin"
            useBravura
            onClick={handleHairpin("decrescendo")}
          />
        </div>
      ),
    },
    {
      id: "ornaments",
      title: "Ornaments",
      shortcut: "Shift+E",
      show: ornamentsMatch,
      render: () => (
        <div style={gridStyle}>
          {ORNAMENT_PALETTE_ITEMS.map((p) => (
            <PaletteButton
              key={p.id}
              label={p.glyph}
              title={p.label}
              useBravura
              onClick={p.kind === "trill" ? handleToggleTrill : handleOrnament(p.ornament!)}
            />
          ))}
        </div>
      ),
    },
    {
      id: "tremolos",
      title: "Tremolos",
      shortcut: "Shift+R",
      show: tremMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton title="Single tremolo (1 slash)" onClick={handleTremolo(1)}>
            <SingleNoteTremoloIcon glyph={SMUFL.tremoloSingle1} />
          </PaletteButton>
          <PaletteButton title="Single tremolo (2 slashes)" onClick={handleTremolo(2)}>
            <SingleNoteTremoloIcon glyph={SMUFL.tremoloSingle2} />
          </PaletteButton>
          <PaletteButton title="Single tremolo (3 slashes)" onClick={handleTremolo(3)}>
            <SingleNoteTremoloIcon glyph={SMUFL.tremoloSingle3} />
          </PaletteButton>
          <PaletteButton label="" title="Two-note tremolo (1 slash)" onClick={handleMultiNoteTremolo(1)}>
            <TwoNoteTremoloIcon slashes={1} />
          </PaletteButton>
          <PaletteButton label="" title="Two-note tremolo (2 slashes)" onClick={handleMultiNoteTremolo(2)}>
            <TwoNoteTremoloIcon slashes={2} />
          </PaletteButton>
          <PaletteButton label="" title="Two-note tremolo (3 slashes)" onClick={handleMultiNoteTremolo(3)}>
            <TwoNoteTremoloIcon slashes={3} />
          </PaletteButton>
          <PaletteButton title="Remove tremolo" onClick={handleRemoveTremolo}>
            <X size={18} />
          </PaletteButton>
        </div>
      ),
    },
    {
      id: "arpeggios",
      title: "Arpeggios",
      show: arpMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton label={SMUFL.arpeggioUp} title="Arpeggio up" useBravura onClick={handleArpeggio("up")} />
          <PaletteButton label={SMUFL.arpeggioDown} title="Arpeggio down" useBravura onClick={handleArpeggio("down")} />
          <PaletteButton
            label={SMUFL.arpeggio}
            title="Arpeggio (no arrow)"
            useBravura
            onClick={handleArpeggio("plain")}
          />
          <PaletteButton label="" title="Non-arpeggio bracket" onClick={handleArpeggio("nonArpeggio")}>
            <NonArpeggioIcon />
          </PaletteButton>
        </div>
      ),
    },
    {
      id: "tempo",
      title: "Tempo",
      shortcut: "Shift+T",
      show: tempoMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton shape="wide" title="Set tempo (BPM)" onClick={handleSetTempo}>
            <span style={TEMPO_LABEL_STYLE}>
              <span style={TEMPO_GLYPH_STYLE}>{"\uECA5"}</span>
              {"=120"}
            </span>
          </PaletteButton>
        </div>
      ),
    },
    {
      id: "text",
      title: "Text",
      show: textMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton
            shape="wide"
            label="Staff text"
            title="Staff text"
            shortcut="Shift+X"
            onClick={handleAddStaffText}
          />
          <PaletteButton shape="wide" title="Expression text" onClick={handleAddExpression}>
            <span style={EXPRESSION_LABEL_STYLE}>espress.</span>
          </PaletteButton>
          <PaletteButton title="Rehearsal mark" onClick={handleSetRehearsalMark}>
            <span style={REHEARSAL_BOX_STYLE}>A</span>
          </PaletteButton>
        </div>
      ),
    },
    {
      id: "tuplets",
      title: "Tuplets",
      shortcut: "Shift+3",
      show: tupletsMatch,
      render: () => (
        <div style={gridStyle}>
          {TUPLET_ITEMS.filter(matchesSearch).map((item) => (
            <PaletteButton
              key={item.id}
              label={item.label}
              title={item.title}
              shortcut={item.shortcut}
              onClick={handleTuplet(item.tupletNumber, item.outerMultiple)}
            />
          ))}
          {!searchQuery && <PaletteButton label="N:M" title="Custom tuplet ratio" onClick={handleCustomTuplet} />}
        </div>
      ),
    },
    {
      id: "ties-slurs",
      title: "Ties & Slurs",
      show: !searchQuery,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton label="⌢" title="Tie (T)" shortcut="T" active={tieActive} onClick={handleTieClick} />
          <PaletteButton label="⌒" title="Slur (S)" shortcut="S" active={slurActive} onClick={handleSlurClick} />
          <PaletteButton label="l.v." title="Laissez vibrer tie" active={lvActive} onClick={handleLvTie} />
        </div>
      ),
    },
    {
      id: "breath-fermata",
      title: "Breath & Fermata",
      shortcut: "Shift+H",
      show: breathMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton
            label={SMUFL.breathMarkComma}
            title="Breath mark (comma)"
            useBravura
            active={!!selectedEventMarkings?.breath}
            onClick={handleBreathMark("comma")}
          />
          <PaletteButton
            label={SMUFL.breathMarkTick}
            title="Breath mark (tick)"
            useBravura
            onClick={handleBreathMark("tick")}
          />
          <PaletteButton
            label={SMUFL.breathMarkUpbow}
            title="Breath mark (upbow)"
            useBravura
            onClick={handleBreathMark("upbow")}
          />
          <PaletteButton
            label={SMUFL.breathMarkSalzedo}
            title="Breath mark (Salzedo)"
            useBravura
            onClick={handleBreathMark("salzedo")}
          />
          <PaletteButton
            label={SMUFL.fermataAbove}
            title="Fermata (normal)"
            useBravura
            onClick={handleFermata("normal")}
          />
          <PaletteButton
            label={SMUFL.fermataShortAbove}
            title="Fermata (short)"
            useBravura
            onClick={handleFermata("short")}
          />
          <PaletteButton
            label={SMUFL.fermataLongAbove}
            title="Fermata (long)"
            useBravura
            onClick={handleFermata("long")}
          />
          <PaletteButton label={SMUFL.caesura} title="Caesura" useBravura onClick={handleSetCaesura("normal")} />
        </div>
      ),
    },
    {
      id: "repeats-navigation",
      title: "Repeats & Navigation",
      shortcut: "Shift+R",
      show: repeatsNavigationMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton
            label={SMUFL.repeatLeft}
            title="Repeat Start"
            useBravura
            onClick={() => handleSetRepeatStart({})}
          />
          <PaletteButton
            label={SMUFL.repeatRight}
            title="Repeat End"
            useBravura
            onClick={() => handleSetRepeatEnd({})}
          />
          <PaletteButton label={SMUFL.repeatRightLeft} title="Repeat Both" useBravura onClick={handleSetRepeatBoth} />
          {MEASURE_REPEAT_PALETTE_ITEMS.filter(matchesSearch).map((item) => (
            <PaletteButton
              key={item.id}
              label={item.label}
              title={item.title}
              useBravura
              onClick={() => handleToggleMeasureRepeat(item.number)}
            />
          ))}
          <PaletteButton
            label={SMUFL.segno}
            title="Segno"
            useBravura
            onClick={handleToggleGlobalMeasureProp("segno")}
          />
          <PaletteButton label={SMUFL.coda} title="Coda" useBravura onClick={handleToggleGlobalMeasureProp("coda")} />
          <PaletteButton label="Fine" title="Fine" onClick={handleToggleGlobalMeasureProp("fine")} />
          <PaletteButton shape="wide" label="D.S. al Fine" title="D.S. al Fine" onClick={handleSetJump("dsalfine")} />
          <PaletteButton shape="wide" label="D.S. al Coda" title="D.S. al Coda" onClick={handleSetJump("dsalcoda")} />
          <PaletteButton shape="wide" label="D.C. al Coda" title="D.C. al Coda" onClick={handleSetJump("dcalcoda")} />
          {ENDING_PRESETS.map((p) => (
            <PaletteButton
              shape="wide"
              key={p.label}
              label={p.label}
              title={p.label}
              onClick={() => handleSetEnding(p.ending)}
            />
          ))}
        </div>
      ),
    },
    {
      id: "fingering",
      title: "Fingering",
      shortcut: "Shift+F",
      show: !searchQuery,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton label="0" title="Fingering 0 (thumb)" onClick={handleFingering(0)} />
          <PaletteButton label="1" title="Fingering 1" onClick={handleFingering(1)} />
          <PaletteButton label="2" title="Fingering 2" onClick={handleFingering(2)} />
          <PaletteButton label="3" title="Fingering 3" onClick={handleFingering(3)} />
          <PaletteButton label="4" title="Fingering 4" onClick={handleFingering(4)} />
          <PaletteButton label="5" title="Fingering 5" onClick={handleFingering(5)} />
        </div>
      ),
    },
    {
      id: "lines",
      title: "Lines",
      show: linesMatch,
      render: () => (
        <div style={gridStyle}>
          <PaletteButton label={SMUFL.ottavaAlta} title="Ottava 8va (up)" useBravura onClick={handleAddOttava(1)} />
          <PaletteButton
            label={SMUFL.ottavaBassaVb}
            title="Ottava 8vb (down)"
            useBravura
            onClick={handleAddOttava(-1)}
          />
          <PaletteButton label={SMUFL.quindicesima} title="Ottava 15ma (up)" useBravura onClick={handleAddOttava(2)} />
          <PaletteButton
            label={SMUFL.quindicesimaBassMb}
            title="Ottava 15mb (down)"
            useBravura
            onClick={handleAddOttava(-2)}
          />
          <PaletteButton label={SMUFL.pedalPed} title="Sustain pedal" useBravura onClick={handleAddPedal("sustain")} />
          <PaletteButton
            label={SMUFL.pedalSost}
            title="Sostenuto pedal"
            useBravura
            onClick={handleAddPedal("sostenuto")}
          />
          <PaletteButton label="u.c." title="Una corda pedal" onClick={handleAddPedal("una-corda")} />
        </div>
      ),
    },
  ];

  const allCategoryIds = categories.map((c) => c.id);
  // Apply persisted ordering: known ids in saved order first, then any
  // new categories appended at the end (covers adding sections after the
  // user has already saved a custom order).
  const orderedIds = [
    ...paletteOrder.filter((id) => allCategoryIds.includes(id)),
    ...allCategoryIds.filter((id) => !paletteOrder.includes(id)),
  ];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const visibleIds = orderedIds.filter((id) => byId.get(id)?.show);

  const anyOpen = visibleIds.some((id) => openMap[id] !== false);
  const handleToggleAll = () => {
    const next: Record<string, boolean> = { ...openMap };
    const target = !anyOpen;
    for (const id of allCategoryIds) next[id] = target;
    setOpenMap(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setPaletteOrder(arrayMove(orderedIds, oldIndex, newIndex));
  };

  return (
    <div style={panelStyle}>
      {/* Search box + collapse-all toggle. The "Palettes" title that used
          to live above this row was redundant with the parent panel chrome
          (the tab itself is already labelled "Palettes"). */}
      <div style={SEARCH_ROW_STYLE}>
        <div style={SEARCH_INPUT_WRAP_STYLE}>
          <FormInput
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search palettes..."
            aria-label="Search palettes"
            style={SEARCH_INPUT_STYLE}
          />
          {searchQuery && (
            <IconButton size="sm" onClick={() => setSearchQuery("")} tooltip="Clear search">
              <X size={12} />
            </IconButton>
          )}
        </div>
        <Tooltip content={anyOpen ? "Collapse all" : "Expand all"}>
          <IconButton
            size="md"
            onClick={handleToggleAll}
            tooltip={anyOpen ? "Collapse all palette sections" : "Expand all palette sections"}
          >
            {anyOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          </IconButton>
        </Tooltip>
      </div>
      <div className="viritura-scroll" style={panelScrollStyle}>
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            {visibleIds.map((id) => {
              const cat = byId.get(id)!;
              return (
                <SortablePaletteSection
                  key={cat.id}
                  id={cat.id}
                  title={cat.title}
                  shortcut={cat.shortcut}
                  open={openMap[cat.id] !== false}
                  onOpenChange={(o) => setOpenMap({ ...openMap, [cat.id]: o })}
                >
                  {cat.render()}
                </SortablePaletteSection>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      <PromptDialog
        open={promptState.open}
        onClose={closePrompt}
        onSubmit={promptState.onSubmit}
        title={promptState.title}
        initialValue={promptState.initialValue}
        type={promptState.type}
        allowEmpty={promptState.allowEmpty}
      />
    </div>
  );
}
