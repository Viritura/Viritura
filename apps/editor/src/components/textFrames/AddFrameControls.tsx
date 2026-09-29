import { useState } from "react";
import { Button } from "@viritura/ui";
import type { Score, TextFrameLocator } from "@viritura/core";
import { measureLocatorAt } from "../../score/textFrameMutations";
import { CommitNumberField } from "./CommitNumberField";
import type { SelectionMusicalContext } from "./textFrameContext";
import styles from "./TextFrames.module.css";

interface AddPageFrameProps {
  onCreate: (locator: TextFrameLocator) => void;
}

/** Page-number field plus create button for a frame located by page index. */
export function AddPageFrame({ onCreate }: AddPageFrameProps) {
  const [pageNumber, setPageNumber] = useState(1);
  return (
    <div className={styles.fieldRow}>
      <CommitNumberField
        id="text-frame-new-page"
        aria-label="Page number for new frame"
        value={pageNumber}
        step={1}
        min={1}
        onCommit={(value) => setPageNumber(Math.max(1, Math.round(value)))}
      />
      <Button size="sm" onClick={() => onCreate({ type: "page", pageIndex: pageNumber - 1 })}>
        Add page frame
      </Button>
    </div>
  );
}

interface AddMusicalFrameProps {
  score: Score;
  context: SelectionMusicalContext | null;
  onCreate: (locator: TextFrameLocator) => void;
}

/**
 * Create a frame that follows the selected event (when it has an MNX ID) or
 * measure onto whichever page pagination puts it.
 */
export function AddMusicalFrame({ score, context, onCreate }: AddMusicalFrameProps) {
  const locator = context ? (context.eventLocator ?? measureLocatorAt(score, context.measureIndex)) : null;
  const label = context?.eventLocator
    ? "Add frame at selected event"
    : context
      ? `Add frame at measure ${context.measureIndex + 1}`
      : "Add frame at selection";
  return (
    <>
      <Button size="sm" disabled={!locator} onClick={() => locator && onCreate(locator)}>
        {label}
      </Button>
      {context && !locator && (
        <p className={styles.help}>This measure has no stable ID, so a frame cannot follow it. Use a page frame.</p>
      )}
    </>
  );
}
