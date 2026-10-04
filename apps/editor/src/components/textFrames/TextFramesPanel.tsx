import { PanelHeader } from "@viritura/ui";
import { SelectedTextFrameEditor } from "./TextFrameEditor";
import { TextFrameList } from "./TextFrameList";
import { unplacedFrameIds } from "./textFrameContext";
import { useRenderedPageCount } from "./renderedPages";
import { useTextFrameEditing } from "./useTextFrameEditing";
import styles from "./TextFrames.module.css";

/**
 * Existing-frame properties for paged views, including unplaced frames.
 */
export function TextFramesPanel() {
  const editing = useTextFrameEditing();
  const { score, frames, selectedFrame } = editing;
  const pageCount = useRenderedPageCount(score, editing.scoreIndex);
  if (!score?.scores?.[editing.scoreIndex] || frames.length === 0) return null;
  return (
    <section className={styles.panel} aria-label="Text frames" data-testid="text-frames-panel">
      <PanelHeader title="Text frames" subtitle="Free text for this score or part. Frames are listed back to front." />
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
