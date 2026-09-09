import { useEffect, useRef } from "react";
import {
  findControllerProfile,
  resolveControllerAction,
  isControllerPreviewMessage,
  type MidiInputMessage,
} from "@viritura/midi";
import { usePlaybackActions, usePlaybackState } from "@viritura/playback";
import { useHistoryStore } from "../store/historyStore";
import { useNoteInput } from "../store/noteInputStore";
import { MidiChordCapture } from "./midiChordCapture";
import { autoInitializeProfiledMidiInputs, midiControllerManager, midiPerformanceManager } from "./runtime";

interface MidiControllerBridgeProps {
  onNoteInput(midiNotes: readonly number[]): void;
  onCursorMove(direction: "left" | "right" | "up" | "down"): void;
}

export function MidiControllerBridge({ onNoteInput, onCursorMove }: MidiControllerBridgeProps) {
  const playback = usePlaybackState();
  const playbackActions = usePlaybackActions();
  const undo = useHistoryStore((state) => state.undo);
  const { state: noteInput, setDuration, toggleNoteInput } = useNoteInput();
  const chordCaptureRef = useRef(new MidiChordCapture());

  useEffect(() => {
    void autoInitializeProfiledMidiInputs().catch((error: unknown) => {
      console.warn("[MIDI] Could not query or restore previously granted MIDI access:", error);
    });
  }, []);

  useEffect(() => {
    if (noteInput.active) return;
    chordCaptureRef.current.reset();
  }, [noteInput.active]);

  useEffect(() => {
    const handlePerformanceInputChanged = () => {
      chordCaptureRef.current.reset();
      playbackActions.previewInstrumentAllNotesOff();
    };
    midiPerformanceManager.on("inputchanged", handlePerformanceInputChanged);
    return () => midiPerformanceManager.off("inputchanged", handlePerformanceInputChanged);
  }, [playbackActions]);

  useEffect(() => {
    const handleMessage = (message: MidiInputMessage) => {
      const input = midiControllerManager.selectedInput;
      if (!input) return;
      const profile = findControllerProfile(input);
      if (!profile) return;
      const action = resolveControllerAction(profile, input.name, message);
      if (!action) return;

      switch (action.type) {
        case "transport.play-stop":
          if (playback.status === "playing") {
            playbackActions.stop();
          } else {
            void playbackActions.play();
          }
          break;
        case "history.undo":
          undo();
          break;
        case "note-input.set-duration":
          setDuration(action.duration);
          break;
        case "note-input.toggle":
          toggleNoteInput();
          break;
        case "note-input.move-cursor":
          onCursorMove(action.direction);
          break;
      }
    };

    midiControllerManager.on("message", handleMessage);
    return () => midiControllerManager.off("message", handleMessage);
  }, [onCursorMove, playback.status, playbackActions, setDuration, toggleNoteInput, undo]);

  useEffect(() => {
    const handlePerformanceMessage = (message: MidiInputMessage) => {
      const input = midiPerformanceManager.selectedInput;
      if (!input) return;
      const profile = findControllerProfile(input);
      if (!profile || !isControllerPreviewMessage(profile, input.name, message) || message.data1 === null) return;
      if (message.kind === "note-on") {
        if (noteInput.active) {
          const partIndex = noteInput.cursorPosition?.partIndex ?? 0;
          chordCaptureRef.current.noteOn(message.data1);
          void playbackActions.previewPartNoteOn(message.data1, partIndex, message.data2 ?? 80);
        } else {
          void playbackActions.previewInstrumentNoteOn(
            message.data1,
            profile.notePreview?.program ?? 0,
            message.data2 ?? 80,
          );
        }
      } else {
        playbackActions.previewInstrumentNoteOff(message.data1);
        if (noteInput.active) {
          const releasedChord = chordCaptureRef.current.noteOff(message.data1);
          if (releasedChord) onNoteInput(releasedChord);
        }
      }
    };

    midiPerformanceManager.on("message", handlePerformanceMessage);
    return () => midiPerformanceManager.off("message", handlePerformanceMessage);
  }, [noteInput.active, noteInput.cursorPosition?.partIndex, onNoteInput, playbackActions]);

  return null;
}
