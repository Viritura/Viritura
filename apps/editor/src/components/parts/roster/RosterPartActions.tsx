import { Drum, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@viritura/ui";
import styles from "./RosterPartRow.module.css";

interface RosterPartActionsProps {
  readonly partId: string;
  readonly displayName: string;
  readonly canRemove: boolean;
  readonly onChangeInstrument?: (partId: string) => void;
  readonly onEditDrumKit?: (partId: string) => void;
  readonly onRemove?: (partId: string) => void;
}

/** Related instrument-level commands grouped at the end of an expanded roster row. */
export function RosterPartActions({
  partId,
  displayName,
  canRemove,
  onChangeInstrument,
  onEditDrumKit,
  onRemove,
}: RosterPartActionsProps) {
  if (!onChangeInstrument && !onEditDrumKit && !(canRemove && onRemove)) return null;

  return (
    <section className={styles.actionsSection} aria-label={`Actions for ${displayName}`}>
      <span className={styles.sectionLabel}>Actions</span>
      <div className={styles.actions}>
        {onChangeInstrument && (
          <Button size="sm" onClick={() => onChangeInstrument(partId)}>
            <RefreshCw size={11} aria-hidden="true" />
            Change instrument
          </Button>
        )}
        {onEditDrumKit && (
          <Button size="sm" onClick={() => onEditDrumKit(partId)}>
            <Drum size={11} aria-hidden="true" />
            Edit percussion map
          </Button>
        )}
        {canRemove && onRemove && (
          <Button size="sm" variant="danger" onClick={() => onRemove(partId)}>
            <Trash2 size={11} aria-hidden="true" />
            Remove instrument
          </Button>
        )}
      </div>
    </section>
  );
}
