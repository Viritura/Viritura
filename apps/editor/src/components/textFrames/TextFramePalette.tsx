import { useMemo } from "react";
import { useSelection } from "../../store/selectionStore";
import { AddMusicalFrame, AddPageFrame } from "./AddFrameControls";
import { SelectedTextFrameEditor } from "./TextFrameEditor";
import { selectionMusicalContext } from "./textFrameContext";
import { useTextFrameEditing } from "./useTextFrameEditing";
import styles from "./TextFrames.module.css";

export function TextFramePalette() {
  const editing = useTextFrameEditing();
  const selection = useSelection();
  const context = useMemo(() => selectionMusicalContext(selection, editing.score), [selection, editing.score]);
  if (!editing.score?.scores?.[editing.scoreIndex]) {
    return <p className={styles.help}>Text frames belong to a score view. Create a score to add them.</p>;
  }
  return (
    <section className={styles.panel} aria-label="Add text frames">
      <p className={styles.groupTitle}>Page text frames</p>
      <p className={styles.help}>
        Choose a fixed page, or follow the page containing the selected measure or event. These are page-positioned
        frames, not staff text.
      </p>
      <AddPageFrame onCreate={editing.createFrame} />
      <AddMusicalFrame score={editing.score} context={context} onCreate={editing.createFrame} />
      <SelectedTextFrameEditor editing={editing} />
    </section>
  );
}
