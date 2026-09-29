import type { KeyboardEvent } from "react";
import type { Score, TextFrame } from "@viritura/core";
import { ListRow } from "@viritura/ui";
import { describeTextFrameLocator, textFramePreview } from "./textFrameContext";
import { TEXT_FRAME_COARSE_NUDGE, TEXT_FRAME_NUDGE, type TextFrameEditing } from "./useTextFrameEditing";
import styles from "./TextFrames.module.css";

const ARROW_DELTAS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export interface TextFrameListProps {
  score: Score;
  frames: readonly TextFrame[];
  selectedFrameId: string | null;
  emptyMessage: string;
  /** Frames authored but not drawn in this view (missing target). */
  unplacedIds?: ReadonlySet<string>;
  ariaLabel: string;
  editing: Pick<TextFrameEditing, "selectFrame" | "move" | "remove">;
}

/**
 * Selectable frame rows. A focused, selected row accepts arrow keys to move
 * the frame (Shift for larger steps) and Delete/Backspace to delete it.
 */
export function TextFrameList({
  score,
  frames,
  selectedFrameId,
  emptyMessage,
  ariaLabel,
  editing,
  unplacedIds,
}: TextFrameListProps) {
  if (frames.length === 0) return <p className={styles.help}>{emptyMessage}</p>;
  const onKeyDown = (frame: TextFrame, event: KeyboardEvent<HTMLButtonElement>) => {
    if (frame.id !== selectedFrameId) return;
    const direction = ARROW_DELTAS[event.key];
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? TEXT_FRAME_COARSE_NUDGE : TEXT_FRAME_NUDGE;
      editing.move(frame.id, { x: direction.x * step, y: direction.y * step });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      editing.remove(frame.id);
    }
  };
  return (
    <ul className={styles.list} aria-label={ariaLabel}>
      {frames.map((frame) => (
        <li key={frame.id}>
          <ListRow
            density="compact"
            selected={frame.id === selectedFrameId}
            aria-pressed={frame.id === selectedFrameId}
            data-testid={`text-frame-row-${frame.id}`}
            onClick={() => editing.selectFrame(frame.id === selectedFrameId ? null : frame.id)}
            onKeyDown={(event) => onKeyDown(frame, event)}
          >
            <span className={styles.rowText}>
              <span className={styles.rowPreview}>{textFramePreview(frame)}</span>
              <span className={styles.rowLocator}>
                {describeTextFrameLocator(score, frame.locator)}
                {unplacedIds?.has(frame.id) ? " · not placed in this view" : ""}
              </span>
            </span>
          </ListRow>
        </li>
      ))}
    </ul>
  );
}
