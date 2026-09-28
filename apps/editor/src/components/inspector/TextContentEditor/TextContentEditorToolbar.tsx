import { Button, Select, type SelectOption } from "@viritura/ui";
import { Bold, Italic, Underline } from "lucide-react";
import type { TextRunStyle } from "@viritura/core";
import styles from "./TextContentEditor.module.css";

const FONT_FAMILIES = ["serif", "sans-serif", "monospace"] as const;
const FONT_LABELS: Record<(typeof FONT_FAMILIES)[number], string> = {
  serif: "Serif",
  "sans-serif": "Sans serif",
  monospace: "Monospace",
};
const FONT_OPTIONS: SelectOption[] = [
  { value: "", label: "Default font", triggerLabel: "Font" },
  ...FONT_FAMILIES.map((font) => ({ value: font, label: FONT_LABELS[font] })),
];

/**
 * Relative sizes, as a multiple of the owning role's resolved size (CSS `em`
 * equivalent). Shown as percentages because that reads more naturally than
 * "1.5×"; the model always stores the multiplier.
 */
const SIZE_MULTIPLES = [0.75, 0.9, 1, 1.25, 1.5, 2, 3];
const SIZE_OPTIONS: SelectOption[] = [
  { value: "", label: "Default size", triggerLabel: "Size" },
  ...SIZE_MULTIPLES.map((size) => ({ value: String(size), label: `${Math.round(size * 100)}%` })),
];

function toFontFamily(value: string): TextRunStyle["font"] {
  return FONT_FAMILIES.find((font) => font === value);
}

function sizeOptionsFor(value: string): SelectOption[] {
  if (value === "" || SIZE_OPTIONS.some((option) => option.value === value)) return SIZE_OPTIONS;
  return [...SIZE_OPTIONS, { value, label: `${Math.round(Number(value) * 100)}%` }];
}

interface TextContentEditorToolbarProps {
  activeStyle: TextRunStyle;
  onToggleInlineStyle: (command: "bold" | "italic" | "underline") => void;
  onApplyStyle: (style: Partial<TextRunStyle>) => void;
  onRememberSelection: () => void;
}

export function TextContentEditorToolbar({
  activeStyle,
  onToggleInlineStyle,
  onApplyStyle,
  onRememberSelection,
}: TextContentEditorToolbarProps) {
  const sizeValue = activeStyle.size === undefined ? "" : String(activeStyle.size);
  return (
    <div className={styles.toolbar} aria-label="Text formatting">
      <Button
        size="sm"
        variant="ghost"
        shape="icon"
        ariaLabel="Bold"
        active={activeStyle.weight === "bold"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onToggleInlineStyle("bold")}
      >
        <Bold size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        shape="icon"
        ariaLabel="Italic"
        active={activeStyle.fontStyle === "italic"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onToggleInlineStyle("italic")}
      >
        <Italic size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        shape="icon"
        ariaLabel="Underline"
        active={activeStyle.decoration === "underline"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onToggleInlineStyle("underline")}
      >
        <Underline size={14} />
      </Button>
      <span className={styles.toolbarControl} onMouseDown={onRememberSelection}>
        <Select
          aria-label="Font family"
          value={activeStyle.font ?? ""}
          options={FONT_OPTIONS}
          fullWidth={false}
          className={styles.toolbarSelect}
          onValueChange={(font) => onApplyStyle({ font: toFontFamily(font) })}
        />
      </span>
      <span className={styles.toolbarControl} onMouseDown={onRememberSelection}>
        <Select
          aria-label="Relative text size"
          value={sizeValue}
          options={sizeOptionsFor(sizeValue)}
          fullWidth={false}
          className={styles.toolbarSelect}
          onValueChange={(size) => onApplyStyle({ size: size === "" ? undefined : Number(size) })}
        />
      </span>
    </div>
  );
}
