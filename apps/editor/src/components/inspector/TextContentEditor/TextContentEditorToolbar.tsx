import type { TextDecoration, TextRunStyle } from "@viritura/core";
import { TextStyleToolbar } from "./TextStyleToolbar";

interface TextContentEditorToolbarProps {
  activeStyle: TextRunStyle;
  onToggleInlineStyle: (command: "bold" | "italic" | TextDecoration) => void;
  onApplyStyle: (style: Partial<TextRunStyle>) => void;
  onRememberSelection: () => void;
}

export function TextContentEditorToolbar({
  activeStyle,
  onToggleInlineStyle,
  onApplyStyle,
  onRememberSelection,
}: TextContentEditorToolbarProps) {
  return (
    <TextStyleToolbar
      mode="inline"
      activeStyle={activeStyle}
      onToggleInlineStyle={onToggleInlineStyle}
      onApplyStyle={onApplyStyle}
      onRememberSelection={onRememberSelection}
    />
  );
}
