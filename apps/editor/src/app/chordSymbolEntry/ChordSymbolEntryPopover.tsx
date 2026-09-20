import { useStore } from "zustand";
import { toast } from "sonner";
import {
  compareChordSymbolPositions,
  formatChordSymbolText,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  type Score,
} from "@viritura/core";
import { usePlaybackActions } from "@viritura/playback";
import { TextPopover } from "@viritura/ui";
import type { DocumentStore } from "../../store/documentStore";
import { setChordSymbolPopover, type ChordSymbolPopoverState } from "../../store/overlayStore";
import { useSelectionActions } from "../../store/selectionStore";
import { applyChordSymbolEdit } from "../popoverHandlers";
import { navigateChordSymbolInput } from "../chordSymbolNavigation";
import { beatPositionToFraction, eventBeatPosition } from "../timedAnnotationPosition";

interface Props {
  store: DocumentStore;
  popover: ChordSymbolPopoverState | null;
  updateScore: (next: Score) => void;
  selectedScoreIndex: number;
}

function initialText(score: Score | null, popover: ChordSymbolPopoverState | null, scoreIndex: number): string {
  if (!score || !popover) return "";
  const part = score.parts[popover.partIndex];
  const sequence = part?.measures[popover.measureIndex]?.sequences[popover.sequenceIndex];
  if (!sequence) return "";
  const position = popover.rhythmicPosition ?? {
    fraction: beatPositionToFraction(eventBeatPosition(sequence, popover)),
  };
  const chord = score.global.measures[popover.measureIndex]?.chordSymbols?.find(
    (candidate) => compareChordSymbolPositions(candidate.position, position) === 0,
  );
  if (!chord) return "";
  const useWritten = score.scores?.[scoreIndex]?.useWritten || part?.transposition?.prefersWrittenPitches;
  const interval = useWritten ? part?.transposition?.interval : undefined;
  const displayed = interval ? transposeChordSymbol(chord, interval) : chord;
  return formatChordSymbolText({ ...displayed, textOverride: undefined });
}

export function ChordSymbolEntryPopover({ store, popover, updateScore, selectedScoreIndex }: Props) {
  const { selectElement } = useSelectionActions();
  const { previewChord } = usePlaybackActions();
  const score = useStore(store, (state) => state.workingScore ?? state.score);

  function commit(value: string): Score | undefined {
    const state = store.getState();
    const current = state.workingScore ?? state.score;
    if (!current || !popover) return undefined;
    if (!value.trim()) return current;
    const edited = applyChordSymbolEdit(current, popover, value, selectedScoreIndex);
    if (!edited) {
      toast.error("Could not insert chord symbol at the selected position");
      return undefined;
    }
    updateScore(edited);
    const previous = current.global.measures[popover.measureIndex]?.chordSymbols ?? [];
    const committed = edited.global.measures[popover.measureIndex]?.chordSymbols?.find(
      (candidate) => !previous.includes(candidate),
    );
    if (committed) void previewChord(committed, edited).catch(() => {});
    return edited;
  }

  return (
    <TextPopover
      key={`${popover?.partIndex}:${popover?.measureIndex}:${popover?.sequenceIndex}:${popover?.eventIndex}:${popover?.rhythmicPosition?.fraction.join("/")}`}
      open={popover !== null}
      onClose={() => setChordSymbolPopover(null)}
      onSubmit={commit}
      position={popover?.position ?? { x: 0, y: 0 }}
      title="Chord Symbol"
      placeholder="e.g. C#m7, Bb7, C/E"
      initialValue={initialText(score, popover, selectedScoreIndex)}
      renderPreview={(value) => {
        if (!value.trim()) return null;
        const resolution = resolveChordSymbol(parseChordSymbolText(value, { fraction: [0, 1] }));
        return resolution.status === "unsupported" ? <p role="status">{resolution.message}</p> : null;
      }}
      onNavigate={(value, command) => {
        const edited = commit(value);
        if (!edited || !popover) return false;
        const next = navigateChordSymbolInput(edited, popover, command, selectedScoreIndex);
        setChordSymbolPopover(next);
        if (next?.anchorElementId) selectElement(next.anchorElementId);
        return true;
      }}
    />
  );
}
