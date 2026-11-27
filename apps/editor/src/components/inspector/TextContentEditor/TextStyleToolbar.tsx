import { Button, FormInput, Select, type SelectOption } from "@viritura/ui";
import { Bold, Italic, Strikethrough, Underline } from "lucide-react";
import {
  pointsToStaffSpaces,
  staffSpacesToPoints,
  type FontFamily,
  type ResolvedTextStyle,
  type TextDecoration,
  type TextRunStyle,
} from "@viritura/core";
import { useState } from "react";
import styles from "./TextContentEditor.module.css";

const FONT_FAMILIES = ["serif", "sans-serif", "monospace"] as const;
const FONT_LABELS: Record<FontFamily, string> = {
  serif: "Serif",
  "sans-serif": "Sans serif",
  monospace: "Monospace",
};
const FONT_OPTIONS: SelectOption[] = [
  { value: "", label: "Default font", triggerLabel: "Font" },
  ...FONT_FAMILIES.map((font) => ({ value: font, label: FONT_LABELS[font] })),
];
const ROLE_FONT_OPTIONS: SelectOption[] = FONT_FAMILIES.map((font) => ({
  value: font,
  label: FONT_LABELS[font],
}));

/**
 * Relative sizes, as a multiple of the owning role's resolved size (CSS `em`
 * equivalent). Shown as percentages; the model stores the multiplier.
 */
const SIZE_MULTIPLES = [0.75, 0.9, 1, 1.25, 1.5, 2, 3];
const SIZE_OPTIONS: SelectOption[] = [
  { value: "", label: "Default size", triggerLabel: "Size" },
  ...SIZE_MULTIPLES.map((size) => ({ value: String(size), label: `${Math.round(size * 100)}%` })),
];

function sizeOptionsFor(value: string): SelectOption[] {
  if (value === "" || SIZE_OPTIONS.some((option) => option.value === value)) return SIZE_OPTIONS;
  return [...SIZE_OPTIONS, { value, label: `${Math.round(Number(value) * 100)}%` }];
}

interface InlineTextStyleToolbarProps {
  mode: "inline";
  activeStyle: TextRunStyle;
  onToggleInlineStyle: (command: "bold" | "italic" | TextDecoration) => void;
  onApplyStyle: (style: Partial<TextRunStyle>) => void;
  onRememberSelection: () => void;
}

interface RoleTextStyleToolbarProps {
  mode: "role";
  activeStyle: ResolvedTextStyle;
  spatiumMm: number;
  minSizeSp?: number;
  maxSizeSp?: number;
  onApplyStyle: (style: Partial<ResolvedTextStyle>) => void;
  onInvalidSize: (minPoints: number, maxPoints: number) => void;
}

type TextStyleToolbarProps = InlineTextStyleToolbarProps | RoleTextStyleToolbarProps;

/** Shared text-formatting controls for inline text and score-level text roles. */
export function TextStyleToolbar(props: TextStyleToolbarProps) {
  return props.mode === "inline" ? <InlineToolbar {...props} /> : <RoleToolbar {...props} />;
}

function InlineToolbar({
  activeStyle,
  onToggleInlineStyle,
  onApplyStyle,
  onRememberSelection,
}: InlineTextStyleToolbarProps) {
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
        active={activeStyle.decorations?.includes("underline") === true}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onToggleInlineStyle("underline")}
      >
        <Underline size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        shape="icon"
        ariaLabel="Strikethrough"
        active={activeStyle.decorations?.includes("strikethrough") === true}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onToggleInlineStyle("strikethrough")}
      >
        <Strikethrough size={14} />
      </Button>
      <span className={styles.toolbarControl} onMouseDown={onRememberSelection}>
        <Select
          aria-label="Font family"
          value={activeStyle.font ?? ""}
          options={FONT_OPTIONS}
          fullWidth={false}
          className={styles.toolbarSelect}
          onValueChange={(font) => onApplyStyle({ font: FONT_FAMILIES.find((family) => family === font) })}
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

function RoleToolbar({
  activeStyle,
  spatiumMm,
  minSizeSp = 0.5,
  maxSizeSp = 20,
  onApplyStyle,
  onInvalidSize,
}: RoleTextStyleToolbarProps) {
  const handleFamily = (family: string) => {
    const next = FONT_FAMILIES.find((candidate) => candidate === family);
    if (next) onApplyStyle({ family: next });
  };
  return (
    <div className={styles.toolbar} aria-label="Text formatting">
      <Button
        size="sm"
        variant="ghost"
        shape="icon"
        ariaLabel="Bold"
        active={activeStyle.bold}
        onClick={() => onApplyStyle({ bold: !activeStyle.bold })}
      >
        <Bold size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        shape="icon"
        ariaLabel="Italic"
        active={activeStyle.italic}
        onClick={() => onApplyStyle({ italic: !activeStyle.italic })}
      >
        <Italic size={14} />
      </Button>
      <span className={styles.toolbarControl}>
        <Select
          aria-label="Font family"
          value={activeStyle.family}
          options={ROLE_FONT_OPTIONS}
          fullWidth={false}
          className={styles.toolbarSelect}
          onValueChange={handleFamily}
        />
      </span>
      <RoleSizeInput
        sizeSp={activeStyle.size}
        spatiumMm={spatiumMm}
        minSizeSp={minSizeSp}
        maxSizeSp={maxSizeSp}
        onCommit={(size) => onApplyStyle({ size })}
        onInvalid={onInvalidSize}
      />
    </div>
  );
}

interface RoleSizeInputProps {
  sizeSp: number;
  spatiumMm: number;
  minSizeSp: number;
  maxSizeSp: number;
  onCommit: (sizeSp: number) => void;
  onInvalid: (minPoints: number, maxPoints: number) => void;
}

function RoleSizeInput({ sizeSp, spatiumMm, minSizeSp, maxSizeSp, onCommit, onInvalid }: RoleSizeInputProps) {
  const points = staffSpacesToPoints(sizeSp, spatiumMm);
  const minPoints = Math.ceil(staffSpacesToPoints(minSizeSp, spatiumMm) * 10) / 10;
  const maxPoints = Math.floor(staffSpacesToPoints(maxSizeSp, spatiumMm) * 10) / 10;
  const displayedPoints = Math.min(maxPoints, Math.max(minPoints, Number(points.toFixed(1))));
  const [draft, setDraft] = useState(displayedPoints.toFixed(1));
  const [syncedPoints, setSyncedPoints] = useState(displayedPoints);

  if (syncedPoints !== displayedPoints) {
    setSyncedPoints(displayedPoints);
    setDraft(displayedPoints.toFixed(1));
  }

  const commit = (raw: string) => {
    const parsed = Number(Number(raw).toFixed(1));
    if (!raw.trim() || !Number.isFinite(parsed) || parsed < minPoints || parsed > maxPoints) {
      onInvalid(minPoints, maxPoints);
      setDraft(displayedPoints.toFixed(1));
      return;
    }
    if (Number(parsed.toFixed(1)) === displayedPoints) {
      setDraft(displayedPoints.toFixed(1));
      return;
    }
    const nextSizeSp = pointsToStaffSpaces(parsed, spatiumMm);
    setDraft(parsed.toFixed(1));
    onCommit(nextSizeSp);
  };

  return (
    <span className={styles.roleSizeControl}>
      <FormInput
        type="number"
        min={minPoints}
        max={maxPoints}
        step={0.1}
        value={draft}
        aria-label="Size in points"
        className={styles.roleSizeInput}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
      />
      <span className={styles.roleSizeUnit} aria-hidden="true">
        pt
      </span>
    </span>
  );
}
