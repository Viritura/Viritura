import { Button } from "@viritura/ui";
import { CornerDownRight, FileDown } from "lucide-react";

interface BreakToolbarProps {
  selected: boolean;
  kind: "system" | "page" | null;
  onSetKind: (kind: "system" | "page") => void;
}

export function BreakToolbar({ selected, kind, onSetKind }: BreakToolbarProps) {
  return (
    <>
      <Button
        variant="default"
        size="sm"
        shape="icon"
        active={kind === "system"}
        disabled={!selected}
        onClick={() => onSetKind("system")}
        tooltip="Lock system after selected barline (Ctrl/Cmd-click)"
        ariaLabel="System break"
        testId="engrave-system-break"
      >
        <CornerDownRight size={14} />
      </Button>
      <Button
        variant="default"
        size="sm"
        shape="icon"
        active={kind === "page"}
        disabled={!selected}
        onClick={() => onSetKind("page")}
        tooltip="Lock page after selected barline (Shift-click)"
        ariaLabel="Page break"
        testId="engrave-page-break"
      >
        <FileDown size={14} />
      </Button>
    </>
  );
}
