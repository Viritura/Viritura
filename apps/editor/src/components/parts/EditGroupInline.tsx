import type { CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { FormInput, Select, IconButton } from "@viritura/ui";
import { SYMBOL_OPTIONS } from "./styles";

const EDIT_GROUP_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 3, flex: 1 };
const EDIT_GROUP_INPUT_STYLE: CSSProperties = {
  flex: 1,
  fontSize: "var(--type-eyebrow-size)",
  padding: "1px 4px",
  border: "1px solid var(--accent)",
  borderRadius: 3,
  outline: "none",
  background: "var(--surface)",
  color: "var(--text)",
  minWidth: 0,
};

export interface EditGroupInlineProps {
  label: string;
  symbol: string;
  onLabelChange: (v: string) => void;
  onSymbolChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EditGroupInline({
  label,
  symbol,
  onLabelChange,
  onSymbolChange,
  onConfirm,
  onCancel,
}: EditGroupInlineProps) {
  return (
    <div style={EDIT_GROUP_ROW_STYLE} onClick={(e) => e.stopPropagation()}>
      <FormInput
        autoFocus
        type="text"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Label"
        style={EDIT_GROUP_INPUT_STYLE}
      />
      <Select value={symbol} onValueChange={onSymbolChange} options={SYMBOL_OPTIONS} />
      <IconButton onClick={onConfirm} tooltip="Confirm" size="sm">
        <Check size={10} />
      </IconButton>
      <IconButton onClick={onCancel} tooltip="Cancel" size="sm">
        <X size={10} />
      </IconButton>
    </div>
  );
}
