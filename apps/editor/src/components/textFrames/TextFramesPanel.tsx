import { useMemo } from "react";
import { PanelHeader } from "@viritura/ui";
import { useSelection } from "../../store/selectionStore";
import { AddMusicalFrame, AddPageFrame } from "./AddFrameControls";
import { SelectedTextFrameEditor } from "./TextFrameEditor";
import { TextFrameList } from "./TextFrameList";
import { selectionMusicalContext, unplacedFrameIds } from "./textFrameContext";
import { useRenderedPageCount } from "./renderedPages";
import { useTextFrameEditing } from "./useTextFrameEditing";
import styles from "./TextFrames.module.css";

/**
 * Document-level text-frame manager for the active score view (Engrave and
 * other paged views). Lists every frame in paint order and edits the selection.
 */
export function TextFramesPanel() {
  const editing = useTextFrameEditing();
  const selection = useSelection();
  const { score, frames, selectedFrame } = editing;
  const context = useMemo(() => selectionMusicalContext(selection, score), [selection, score]);
  const pageCount = useRenderedPageCount(score, editing.scoreIndex);
  if (!score?.scores?.[editing.scoreIndex]) {
    return <p className={styles.help}>Text frames belong to a score view. Create a score to add them.</p>;
  }
  return (
    <section className={styles.panel} aria-label="Text frames" data-testid="text-frames-panel">
      <PanelHeader title="Text frames" subtitle="Free text for this score or part. Frames are listed back to front." />
      <div className={styles.group}>
        <AddPageFrame onCreate={editing.createFrame} />
        <AddMusicalFrame score={score} context={context} onCreate={editing.createFrame} />
      </div>
      <TextFrameList
        score={score}
        frames={frames}
        selectedFrameId={selectedFrame?.id ?? null}
        ariaLabel="All text frames"
        emptyMessage="No text frames in this score view."
        unplacedIds={unplacedFrameIds(score, editing.scoreIndex, frames, pageCount)}
        editing={editing}
      />
      <SelectedTextFrameEditor editing={editing} />
    </section>
  );
}
