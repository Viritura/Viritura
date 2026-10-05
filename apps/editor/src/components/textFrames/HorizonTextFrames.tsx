import { useMemo } from "react";
import { useSelection } from "../../store/selectionStore";
import { SelectedTextFrameEditor } from "./TextFrameEditor";
import { TextFrameList } from "./TextFrameList";
import { framesAtMeasure, pageIndexFrames, selectionMusicalContext, unplacedFrameIds } from "./textFrameContext";
import { useRenderedPageCount } from "./renderedPages";
import { useTextFrameEditing } from "./useTextFrameEditing";
import styles from "./TextFrames.module.css";

/**
 * Horizon mode paints no pages, so text frames are hidden there. This surface
 * lists frames that follow the selected measure (or an event in it) and,
 * document-wide, frames located by page index, and edits them in place.
 */
export function HorizonTextFrames() {
  const editing = useTextFrameEditing();
  const selection = useSelection();
  const { score, frames, selectedFrame } = editing;
  const context = useMemo(() => selectionMusicalContext(selection, score), [selection, score]);
  const pageCount = useRenderedPageCount(score, editing.scoreIndex);
  if (!score?.scores?.[editing.scoreIndex] || frames.length === 0) return null;

  const nearby = context ? framesAtMeasure(score, editing.scoreIndex, frames, context.measureIndex) : [];
  const unplacedIds = unplacedFrameIds(score, editing.scoreIndex, frames, pageCount);
  const unplaced = frames.filter((frame) => frame.locator.type !== "page" && unplacedIds.has(frame.id));
  const pageFrames = pageIndexFrames(frames);
  const selectedId = selectedFrame?.id ?? null;

  return (
    <section className={styles.panel} aria-label="Hidden text frames" data-testid="horizon-text-frames">
      <p className={styles.help}>Page frames are hidden in Horizon. Edit them here.</p>
      <div className={styles.group}>
        <p className={styles.groupTitle}>
          {context ? `Frames at measure ${context.measureIndex + 1}` : "Frames at selection"}
        </p>
        {context ? (
          <TextFrameList
            score={score}
            frames={nearby}
            selectedFrameId={selectedId}
            ariaLabel="Text frames at the selected measure"
            emptyMessage="No frames follow this measure."
            editing={editing}
          />
        ) : (
          <p className={styles.help}>Select a measure or note to see frames that follow it.</p>
        )}
      </div>
      <div className={styles.group}>
        <p className={styles.groupTitle}>Page frames</p>
        <TextFrameList
          score={score}
          frames={pageFrames}
          selectedFrameId={selectedId}
          ariaLabel="Text frames located by page"
          emptyMessage="No frames are placed on a fixed page."
          editing={editing}
        />
      </div>
      {unplaced.length > 0 && (
        <div className={styles.group}>
          <p className={styles.groupTitle}>Unplaced frames</p>
          <p className={styles.help}>Their measure or event is missing from this score view, so they are not drawn.</p>
          <TextFrameList
            score={score}
            frames={unplaced}
            selectedFrameId={selectedId}
            ariaLabel="Unplaced text frames"
            unplacedIds={unplacedIds}
            emptyMessage=""
            editing={editing}
          />
        </div>
      )}
      <SelectedTextFrameEditor editing={editing} />
    </section>
  );
}
