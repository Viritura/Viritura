import { useMemo, useState } from "react";
import { toast } from "sonner";
import { compareChordSymbolPositions, type Score } from "@viritura/core";
import { usePlaybackActions, usePlaybackState } from "@viritura/playback";
import type { DisplayList } from "@viritura/renderer";
import { useDocumentStore, useDocumentStoreApi } from "../../store/DocumentContext";
import { useSelectionActions } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import {
  editChordTrackText,
  removeChordTrackChord,
  scoreTrackChords,
  moveChordTrackChord,
} from "../../score/chordTrack";
import { pointChord } from "./trackGeometry";
import type { TimedChord, TrackPoint } from "./types";
import { useChordTrackSelection } from "./useChordTrackSelection";

export interface TrackEditorTarget {
  point: TrackPoint;
  position: { x: number; y: number };
}

export function useChordTrackEditing(displayList: DisplayList) {
  const store = useDocumentStoreApi();
  const score = useDocumentStore((state) => state.workingScore ?? state.score);
  const { selectElement, clearSelection } = useSelectionActions();
  const { previewChord } = usePlaybackActions();
  const playbackStatus = usePlaybackState().status;
  const audition = useViewStateStore((state) => state.chordTrackAudition);
  const [editor, setEditor] = useState<TrackEditorTarget | null>(null);
  const chords = useMemo(() => (score ? scoreTrackChords(score) : []), [score]);
  useChordTrackSelection(store);

  function selectChord(current: Score, point: TrackPoint) {
    const chord = pointChord(scoreTrackChords(current), point);
    const bound = displayList.measureBounds?.find(
      (measure) =>
        measure.index === point.measureIndex && !measure.ghostStaff && !measure.isExpansion && !measure.isHidden,
    );
    if (chord?.elementId && bound) {
      selectElement(chord.elementId, {
        partIndex: bound.partIndex,
        staffIndex: bound.staffIndex,
        localStaffIndex: 0,
        measureIndex: point.measureIndex,
        sourceStaff: 1,
        chordTrack: true,
        chordPosition: chord.symbol.position,
      });
    } else clearSelection();
    return chord;
  }

  function auditionChord(current: Score, point: TrackPoint) {
    if (!audition || playbackStatus !== "stopped") return;
    const chord = pointChord(scoreTrackChords(current), point);
    if (chord)
      void previewChord(chord.symbol, current).catch((error: unknown) => {
        console.warn("[Audio] Chord-track audition failed", error);
      });
  }

  function open(point: TrackPoint, rect: DOMRect) {
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current) {
      toast.error("No score is available for chord entry");
      return;
    }
    selectChord(current, point);
    setEditor({ point, position: { x: rect.x + rect.width / 2, y: rect.bottom + 8 } });
  }

  function select(point: TrackPoint) {
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current) {
      toast.error("No score is available for chord selection");
      return;
    }
    selectChord(current, point);
    auditionChord(current, point);
  }

  function move(source: TimedChord, target: TrackPoint) {
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current) {
      toast.error("No score is available for moving chords");
      return;
    }
    try {
      const next = moveChordTrackChord(current, source, target);
      if (next !== current) {
        store.getState().updateScore(next, {
          start: Math.min(source.measureIndex, target.measureIndex),
          end: Math.max(source.measureIndex, target.measureIndex),
        });
        selectChord(next, target);
        auditionChord(next, target);
      }
    } catch (error: unknown) {
      console.error("Chord-track move failed", error);
      toast.error(error instanceof Error ? error.message : "Could not move the chord");
    }
  }

  function commit(text: string): Score | null {
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current || !editor) {
      toast.error("The chord-entry position is no longer available");
      return null;
    }
    if (!text.trim()) return current;
    try {
      const next = editChordTrackText(current, editor.point, text);
      if (next !== current) {
        store.getState().updateScore(next, { start: editor.point.measureIndex, end: editor.point.measureIndex });
        auditionChord(next, editor.point);
      }
      selectChord(next, editor.point);
      return next;
    } catch (error: unknown) {
      console.error("Chord-track edit failed", error);
      toast.error(error instanceof Error ? error.message : "Could not edit the chord");
      return null;
    }
  }

  function remove(point: TrackPoint) {
    const current = store.getState().workingScore ?? store.getState().score;
    if (!current) {
      toast.error("No score is available for chord deletion");
      return;
    }
    try {
      const next = removeChordTrackChord(current, point);
      if (next !== current) store.getState().updateScore(next, { start: point.measureIndex, end: point.measureIndex });
      clearSelection();
      setEditor(null);
    } catch (error: unknown) {
      console.error("Chord-track deletion failed", error);
      toast.error(error instanceof Error ? error.message : "Could not remove the chord");
    }
  }

  const selected = editor ? pointChord(chords, editor.point) : undefined;
  const initialText = selected?.symbol.rawText ?? "";
  return { score, chords, editor, setEditor, open, select, move, commit, remove, selected, initialText };
}

export function trackBeatStep(score: Score, measureIndex: number): number {
  let time = { count: 4, unit: 4 };
  for (let index = 0; index <= measureIndex; index++) time = score.global.measures[index]?.time ?? time;
  return time.count > 3 && time.count % 3 === 0 && time.unit >= 8 ? 12 / time.unit : 4 / time.unit;
}

export function trackPositionEqual(a: TrackPoint, b: TrackPoint): boolean {
  if (a.measureIndex !== b.measureIndex) return false;
  if (a.position && b.position) return compareChordSymbolPositions(a.position, b.position) === 0;
  return Math.abs(a.beat - b.beat) < 1e-9 && a.position?.graceIndex === b.position?.graceIndex;
}
