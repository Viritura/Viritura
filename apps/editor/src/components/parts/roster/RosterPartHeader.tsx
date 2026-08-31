import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { ListRow } from "@viritura/ui";
import type { Part } from "@viritura/core";
import { FAMILY_COLORS } from "../styles";
import { familyForPart } from "./familyForPart";

function chevronStyle(expanded: boolean): CSSProperties {
  return {
    transition: "transform 120ms ease",
    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
    color: "var(--text-muted)",
    flexShrink: 0,
  };
}
function familyDotStyle(family: keyof typeof FAMILY_COLORS): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: FAMILY_COLORS[family],
    flexShrink: 0,
  };
}
const PART_SHORT_STYLE: CSSProperties = { fontSize: "var(--type-eyebrow-size)", color: "var(--text-muted)" };

interface Props {
  part: Part;
  displayName: string;
  displayShort?: string;
  expanded: boolean;
  onToggle: () => void;
}

/** Collapsed header row in the parts roster — chevron + family dot + name. */
export function RosterPartHeader({ part, displayName, displayShort, expanded, onToggle }: Props) {
  const family = familyForPart(part);
  return (
    <ListRow
      onClick={onToggle}
      selected={expanded}
      aria-expanded={expanded}
      tooltip={expanded ? "Collapse" : "Edit properties"}
      leading={
        <>
          <ChevronRight size={11} style={chevronStyle(expanded)} />
          <span style={familyDotStyle(family)} />
        </>
      }
      trailing={displayShort ? <span style={PART_SHORT_STYLE}>{displayShort}</span> : undefined}
    >
      {displayName}
    </ListRow>
  );
}
