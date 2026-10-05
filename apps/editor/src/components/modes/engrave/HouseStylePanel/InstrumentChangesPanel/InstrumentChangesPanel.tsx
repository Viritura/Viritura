import type { InstrumentChangeStyle } from "@viritura/core";
import { Checkbox } from "@viritura/ui";
import { toast } from "sonner";
import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";

export function InstrumentChangesPanel() {
  const style = useDocumentStore((state) => state.score?.instrumentChangeStyle);
  const store = useDocumentStoreApi();
  function update(field: keyof InstrumentChangeStyle, value: boolean) {
    const document = store.getState();
    const score = document.workingScore ?? document.score;
    if (!score) {
      toast.error("Open a score before changing its house style.");
      return;
    }
    document.updateScore({
      ...score,
      instrumentChangeStyle: { ...score.instrumentChangeStyle, [field]: value },
    });
  }
  return (
    <>
      <Checkbox
        label="Show label at change"
        checked={style?.showChangeLabel ?? true}
        onChange={(event) => update("showChangeLabel", event.target.checked)}
      />
      <Checkbox
        label="Show advance reminder"
        checked={style?.showAdvanceReminder ?? true}
        onChange={(event) => update("showAdvanceReminder", event.target.checked)}
      />
      <p>Applies throughout this document. Individual changes can override visibility and printed text.</p>
    </>
  );
}
