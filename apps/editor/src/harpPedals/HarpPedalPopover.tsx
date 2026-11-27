import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { Button, TextPopover } from "@viritura/ui";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import { applyHarpPedalEdit, beginHarpPedalEdit, harpPedalEditError, removeHarpPedalEdit } from "./harpPedalEdits";
import { usePedalCalculation } from "./usePedalCalculation";
import { HarpPedalControls } from "./HarpPedalControls";
import { SolutionDialog } from "./SolutionDialog";
import { resolveHarpPedalTarget } from "./harpPedalTarget";
import {
  formatHarpPedalAlter,
  formatHarpPedalText,
  HARP_PEDAL_ORDER,
  moveHarpPedal,
  NATURAL_PEDALS,
  parseHarpPedalText,
} from "./harpPedalText";
import styles from "./HarpPedalPopover.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  store: DocumentStore;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export function HarpPedalPopover(props: Props) {
  return props.open ? <HarpPedalPopoverSession {...props} /> : null;
}

function HarpPedalPopoverSession({ onClose, position, store, selection, updateScore }: Props) {
  const [anchorPosition] = useState(position);
  const [session] = useState(() => {
    const document = store.getState();
    const score = document.workingScore ?? document.score;
    const target = resolveHarpPedalTarget(score, selection);
    return score && target
      ? {
          edit: beginHarpPedalEdit(score, target),
          partId: score.parts[target.partIndex]!.id,
          generation: document.documentGeneration,
        }
      : null;
  });
  const score = useStore(store, (state) => state.workingScore ?? state.score);
  const generation = useStore(store, (state) => state.documentGeneration);
  const calculation = usePedalCalculation({
    store,
    target: session
      ? { partId: session.partId, partIndex: session.edit.target.partIndex, generation: session.generation }
      : null,
    updateScore,
    onClose,
  });
  const initial = session?.edit.original?.tuning ?? session?.edit.inherited?.tuning;
  const [text, setText] = useState(() => formatHarpPedalText(initial ?? NATURAL_PEDALS));
  const pendingCaret = useRef<{ input: HTMLInputElement; position: number } | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (!caret) return;
    caret.input.setSelectionRange(caret.position, caret.position);
    pendingCaret.current = null;
  }, [text]);

  function updateTextAtCaret(input: HTMLInputElement, next: string, position: number): void {
    if (next !== text) {
      pendingCaret.current = { input, position };
      setText(next);
    } else {
      input.setSelectionRange(position, position);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey) {
      const tuning = parseHarpPedalText(text);
      if (!tuning) return;
      event.preventDefault();
      const positions = Array.from(text.matchAll(/[\^vV-]/g), (match) => match.index);
      const nextPedal = positions.findIndex((position) => position >= start);
      const pedalIndex = nextPedal === -1 ? positions.length - 1 : nextPedal;
      const index = positions[pedalIndex]!;
      const letter = HARP_PEDAL_ORDER[pedalIndex]!;
      const current = tuning[letter];
      const next = moveHarpPedal(current, event.key === "ArrowUp" ? "up" : "down");
      const value = next === current ? text : text.slice(0, index) + formatHarpPedalAlter(next) + text.slice(index + 1);
      updateTextAtCaret(input, value, index);
      return;
    }
    if (!/^[\^vV-]$/.test(event.key) || !/^[\^vV-]{3}\|[\^vV-]{4}$/.test(text)) return;
    event.preventDefault();
    const index = start === 3 ? 4 : start;
    if (index >= text.length) return;
    const next = text.slice(0, index) + event.key.toLowerCase() + text.slice(index + 1);
    updateTextAtCaret(input, next, index === 2 ? 4 : index + 1);
  }

  function conflict(current: Score | null, currentGeneration: number): string | null {
    if (!session) return "Select a position on a harp part.";
    if (currentGeneration !== session.generation) return "The score has changed. Close and reopen the pedal editor.";
    return harpPedalEditError(current, session.edit);
  }

  function validate(value: string): string | null {
    if (calculation.busy) return "Calculating harp pedal solutions";
    if (!parseHarpPedalText(value)) return "Enter seven pedal positions in D C B | E F G A order.";
    return conflict(score, generation);
  }

  function submit(value: string): boolean {
    const current = store.getState();
    const currentScore = current.workingScore ?? current.score;
    const error = conflict(currentScore, current.documentGeneration);
    const tuning = parseHarpPedalText(value);
    if (error || !currentScore || !session || !tuning) {
      toast.error(error ?? "Enter seven valid pedal positions.");
      return false;
    }
    updateScore(applyHarpPedalEdit(currentScore, session.edit, tuning));
    return true;
  }

  function remove(): void {
    const current = store.getState();
    const currentScore = current.workingScore ?? current.score;
    const error = conflict(currentScore, current.documentGeneration);
    if (error || !currentScore || !session) {
      toast.error(error ?? "The pedal setting could not be removed.");
      return;
    }
    updateScore(removeHarpPedalEdit(currentScore, session.edit));
    onClose();
  }

  const currentError = conflict(score, generation);
  return (
    <>
      <TextPopover
        open={calculation.solutions === null}
        onClose={() => {
          calculation.cancel();
          onClose();
        }}
        onSubmit={submit}
        position={anchorPosition}
        className={styles.popover}
        title="Harp pedals"
        placeholder="^--|--v^"
        value={text}
        onValueChange={setText}
        onInputKeyDown={handleInputKeyDown}
        validate={validate}
        submitLabel="Apply"
        renderPreview={(value) => {
          const error = validate(value);
          return error ? <span role="status">{error}</span> : null;
        }}
      >
        <HarpPedalControls
          tuning={parseHarpPedalText(text)}
          onChange={(tuning) => setText(formatHarpPedalText(tuning))}
        />
        <Button
          size="sm"
          onClick={() => void calculation.calculate()}
          className={styles.auto}
          disabled={calculation.busy}
          aria-busy={calculation.busy}
        >
          Auto
        </Button>
        {session?.edit.original && (
          <Button size="sm" variant="danger" onClick={remove} disabled={currentError !== null || calculation.busy}>
            Remove setting
          </Button>
        )}
      </TextPopover>
      <SolutionDialog
        solutions={calculation.solutions}
        selectedSolutionKind={calculation.selectedSolutionKind}
        score={score}
        partIndex={
          session?.partId
            ? (score?.parts.findIndex((part) => part.id === session.partId) ?? -1)
            : (session?.edit.target.partIndex ?? -1)
        }
        onSelect={calculation.setSelectedSolutionKind}
        onClose={calculation.cancel}
        onApply={calculation.apply}
      />
    </>
  );
}
