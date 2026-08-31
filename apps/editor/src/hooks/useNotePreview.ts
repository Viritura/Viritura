/**
 * useNotePreview — React hook for auditory note feedback.
 *
 * Listens to selection changes and plays the selected note's pitch via
 * the Web Audio oscillator engine (NotePreviewEngine). Also exposes
 * `previewPitch` for immediate playback during note input.
 */

import { useEffect, useCallback, useRef } from "react";
import { pitchToMidi, isRest } from "@viritura/core";
import type { Pitch, KitNote } from "@viritura/core";
import { useSelection } from "../store/selectionStore";
import { useDocument } from "../store/DocumentContext";
import { usePlaybackActions } from "@viritura/playback";
import { resolveEventFromSubElement, getNoteEventAtLocation, extractNoteIndex } from "../score/ElementPath";
import { parseElementType } from "../score/elementTypes";
import { midiNumberForKitComponent } from "../score/kitInput";

const PREVIEW_DURATION_MS = 400;

interface NotePreviewResult {
  /** Play a single pitch immediately (for note input). */
  previewPitch: (pitch: Pitch) => void;
  /** Play multiple pitches simultaneously (for chord input). */
  previewChord: (pitches: readonly Pitch[]) => void;
}

/**
 * Hook that automatically plays note preview sounds when:
 * 1. A note or event is selected by clicking
 * 2. A specific notehead is selected within a chord
 *
 * Uses the active sampler (SF2) from PlaybackContext when available,
 * falls back to oscillator engine otherwise.
 */
export function useNotePreview(): NotePreviewResult {
  const selection = useSelection();
  const { score } = useDocument();
  const { previewNote } = usePlaybackActions();
  const prevSelectionRef = useRef(selection);

  // Play a MIDI note using the correct part's sampler
  const playMidi = useCallback(
    (midiNote: number, partIndex?: number) => {
      previewNote(midiNote, partIndex, 80, PREVIEW_DURATION_MS);
    },
    [previewNote],
  );

  // Play preview when selection changes to a note/event
  useEffect(() => {
    const prev = prevSelectionRef.current;
    prevSelectionRef.current = selection;

    if (prev === selection) return;
    if (selection.kind !== "single" || !score) return;

    const elementType = parseElementType(selection.elementId);
    if (elementType !== "event" && elementType !== "note" && elementType !== "grace-note") {
      return;
    }

    const noteIndex = extractNoteIndex(selection.elementId);
    const loc = resolveEventFromSubElement(selection.elementId, score);
    if (!loc) return;

    const event = getNoteEventAtLocation(score, loc);
    if (!event || isRest(event)) return;

    // Kit (percussion) events: preview the drum sample for the selected
    // kit-note, not the pitch (kit notes have no pitch).
    const kitNotes = event.kitNotes;
    if (kitNotes && kitNotes.length > 0) {
      const part = score.parts[loc.partIndex];
      if (!part || !part.kit) return;
      const sounds = score.global?.sounds;
      const previewKitNote = (kn: KitNote) => {
        const midi = midiNumberForKitComponent(part, sounds, kn.kitComponent);
        if (midi !== null) playMidi(midi, loc.partIndex);
      };
      if (noteIndex !== undefined && noteIndex < kitNotes.length) {
        previewKitNote(kitNotes[noteIndex]!);
      } else {
        for (const kn of kitNotes) previewKitNote(kn);
      }
      return;
    }

    const notes = event.notes;
    if (!notes || notes.length === 0) return;

    if (noteIndex !== undefined && noteIndex < notes.length) {
      playMidi(pitchToMidi(notes[noteIndex]!.pitch), loc.partIndex);
    } else {
      for (const n of notes) {
        playMidi(pitchToMidi(n.pitch), loc.partIndex);
      }
    }
  }, [selection, score, playMidi]);

  const previewPitch = useCallback(
    (pitch: Pitch) => {
      playMidi(pitchToMidi(pitch));
    },
    [playMidi],
  );

  const previewChord = useCallback(
    (pitches: readonly Pitch[]) => {
      for (const p of pitches) {
        playMidi(pitchToMidi(p));
      }
    },
    [playMidi],
  );

  return { previewPitch, previewChord };
}
