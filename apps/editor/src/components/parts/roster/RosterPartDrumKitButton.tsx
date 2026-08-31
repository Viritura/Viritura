import type { CSSProperties } from "react";
import { Drum } from "lucide-react";
import { Button } from "@viritura/ui";

const DRUM_KIT_ROW_STYLE: CSSProperties = {
  display: "flex",
  marginTop: 8,
};

interface Props {
  partId: string;
  onEditDrumKit: (partId: string) => void;
}

/** "Edit Percussion Map…" affordance shown in an expanded percussion part row,
 *  opening the per-part drum-kit mapping editor. Full-width so it reads as the
 *  primary action for the part. */
export function RosterPartDrumKitButton({ partId, onEditDrumKit }: Props) {
  return (
    <div style={DRUM_KIT_ROW_STYLE}>
      <Button
        variant="default"
        size="sm"
        fullWidth
        onClick={() => onEditDrumKit(partId)}
        tooltip="Edit this part's percussion map"
      >
        <Drum size={11} />
        Edit Percussion Map…
      </Button>
    </div>
  );
}
