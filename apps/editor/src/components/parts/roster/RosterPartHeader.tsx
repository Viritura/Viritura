import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { ListRow } from "@viritura/ui";

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
}

/** Collapsed header row in the parts roster — disclosure and instrument name. */
export function RosterPartHeader({ displayName, expanded, onToggle }: Props) {
  return (
    <ListRow
      onClick={onToggle}
      selected={expanded}
      aria-expanded={expanded}
      tooltip={expanded ? "Collapse" : "Edit properties"}
      leading={<ChevronRight size={11} style={chevronStyle(expanded)} />}
    >
      {displayName}
    </ListRow>
  );
}
