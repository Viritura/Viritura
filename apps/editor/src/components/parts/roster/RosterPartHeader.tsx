import type { CSSProperties, MouseEventHandler } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { Button, ListRow } from "@viritura/ui";
import styles from "./RosterPartRow.module.css";

function chevronStyle(expanded: boolean): CSSProperties {
  return {
    transition: "transform 120ms ease",
    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
    color: "var(--text-muted)",
    flexShrink: 0,
  };
}
interface Props {
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
  onOpenMenu?: MouseEventHandler<HTMLButtonElement>;
}

/** Collapsed header row in the parts roster — disclosure and instrument name. */
export function RosterPartHeader({ displayName, expanded, onToggle, onContextMenu, onOpenMenu }: Props) {
  return (
    <div className={styles.headerRow}>
      <ListRow
        className={styles.headerDisclosure}
        onClick={onToggle}
        onContextMenu={onContextMenu}
        selected={expanded}
        aria-expanded={expanded}
        tooltip={expanded ? "Collapse" : "Edit properties"}
        leading={<ChevronRight size={11} style={chevronStyle(expanded)} />}
      >
        {displayName}
      </ListRow>
      {onOpenMenu && (
        <Button
          size="sm"
          shape="icon"
          variant="ghost"
          className={styles.headerMenu}
          onClick={onOpenMenu}
          ariaLabel={`Instrument actions for ${displayName}`}
          tooltip="Instrument actions"
        >
          <Ellipsis size={14} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
