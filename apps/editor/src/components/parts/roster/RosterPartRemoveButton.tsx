import type { CSSProperties } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@viritura/ui";

const REMOVE_ROW_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 10,
  paddingTop: 8,
  borderTop: "1px solid rgba(20, 20, 28, 0.08)",
};

interface Props {
  partId: string;
  displayName: string;
  onRemove: (partId: string) => void;
}

/** Trash-can affordance shown at the bottom of an expanded part row. */
export function RosterPartRemoveButton({ partId, displayName, onRemove }: Props) {
  return (
    <div style={REMOVE_ROW_STYLE}>
      <Button variant="danger" size="sm" onClick={() => onRemove(partId)} tooltip={`Remove ${displayName}`}>
        <Trash2 size={11} />
        Remove
      </Button>
    </div>
  );
}
