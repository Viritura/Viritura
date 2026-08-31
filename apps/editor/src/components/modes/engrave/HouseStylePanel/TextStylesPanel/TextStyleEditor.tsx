import { useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, RotateCcw } from "lucide-react";
import { Button, ButtonGroup, FormInput, IconButton, Select } from "@viritura/ui";
import type { FontFamily, ResolvedTextStyle } from "@viritura/core";
import {
  FONT_FAMILY_OPTIONS,
  MAX_SIZE,
  MIN_SIZE,
  TEXT_COLOR_SWATCHES,
  isValidHexColor,
  swatchStyleFor,
  type StyleField,
} from "./textStyleModel";
import styles from "./TextStylesPanel.module.css";

const ALIGN_OPTIONS = [
  { value: "left" as const, label: <AlignLeft size={14} />, tooltip: "Align left" },
  { value: "center" as const, label: <AlignCenter size={14} />, tooltip: "Align centre" },
  { value: "right" as const, label: <AlignRight size={14} />, tooltip: "Align right" },
];

export interface TextStyleEditorProps {
  style: ResolvedTextStyle;
  /** Fields that differ from the engine default, for per-control marking. */
  changed: readonly StyleField[];
  onChange: <F extends StyleField>(field: F, value: ResolvedTextStyle[F]) => void;
  onReset: () => void;
  /** Disables reset when the role is already at its defaults. */
  canReset: boolean;
}

/**
 * The formatting controls for one text-style role — a compact toolbar in the
 * shape people already know from a word processor: family, size, bold/italic,
 * alignment, colour.
 */
export function TextStyleEditor({ style, changed, onChange, onReset, canReset }: TextStyleEditorProps) {
  const isChanged = (field: StyleField) => changed.includes(field);

  return (
    <div className={styles.editor}>
      <div className={styles.controlGrid}>
        <Field label="Font" changed={isChanged("family")}>
          <Select
            value={style.family}
            onValueChange={(value) => onChange("family", value as FontFamily)}
            options={[...FONT_FAMILY_OPTIONS]}
            aria-label="Font family"
            className={styles.familySelect}
          />
        </Field>

        <Field label="Size" changed={isChanged("size")} hint="staff spaces">
          <SizeInput value={style.size} onCommit={(next) => onChange("size", next)} />
        </Field>

        <Field label="Style" changed={isChanged("bold") || isChanged("italic")}>
          <span className={styles.toggleRow}>
            <IconButton
              size="sm"
              tooltip="Bold"
              active={style.bold}
              aria-label="Bold"
              onClick={() => onChange("bold", !style.bold)}
            >
              <Bold size={14} />
            </IconButton>
            <IconButton
              size="sm"
              tooltip="Italic"
              active={style.italic}
              aria-label="Italic"
              onClick={() => onChange("italic", !style.italic)}
            >
              <Italic size={14} />
            </IconButton>
          </span>
        </Field>

        <Field label="Alignment" changed={isChanged("align")}>
          <ButtonGroup
            options={ALIGN_OPTIONS}
            value={style.align}
            onChange={(value) => onChange("align", value)}
            ariaLabel="Alignment"
          />
        </Field>
      </div>

      <div className={styles.colorRow}>
        <Field label="Colour" changed={isChanged("color")}>
          <ColorControl value={style.color} onCommit={(next) => onChange("color", next)} />
        </Field>

        <Button variant="ghost" size="sm" disabled={!canReset} onClick={onReset} tooltip="Restore engine defaults">
          <RotateCcw size={13} />
          Reset
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  changed,
  children,
}: {
  label: string;
  hint?: string;
  changed: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.field} data-changed={changed ? "true" : undefined}>
      <span className={styles.fieldLabel}>
        {label}
        {hint !== undefined && <span className={styles.fieldHint}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

/**
 * Size in staff spaces.
 *
 * Kept as local text while focused so a partly-typed value ("2." on the way to
 * "2.5") isn't parsed and clamped out from under the cursor; the score is only
 * updated once the value parses to something in range.
 */
function SizeInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [syncedValue, setSyncedValue] = useState(value);

  // Re-sync the draft when the score changes the value underneath us (a reset,
  // or another client in a live session). Adjusting state during render is
  // React's documented alternative to a setState-in-effect, which would render
  // the stale draft first and then immediately render again.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(String(value));
  }

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(MAX_SIZE, Math.max(MIN_SIZE, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <FormInput
      type="number"
      min={MIN_SIZE}
      max={MAX_SIZE}
      step={0.1}
      value={draft}
      aria-label="Size in staff spaces"
      className={styles.sizeInput}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
        }
      }}
    />
  );
}

/**
 * Colour as a row of swatches plus a hex field.
 *
 * The hex field commits on blur/Enter rather than per keystroke, so typing
 * "#1a2b3c" doesn't push five invalid intermediate colours at the score.
 */
function ColorControl({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);

  // See SizeInput — same render-time re-sync rather than a setState effect.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(value);
  }

  const commit = (raw: string) => {
    const candidate = raw.startsWith("#") ? raw : `#${raw}`;
    if (isValidHexColor(candidate)) {
      const normalized = candidate.toLowerCase();
      setDraft(normalized);
      if (normalized !== value) onCommit(normalized);
    } else {
      setDraft(value);
    }
  };

  const invalid = !isValidHexColor(draft.startsWith("#") ? draft : `#${draft}`);

  return (
    <span className={styles.colorControl}>
      <span className={styles.swatchRow}>
        {TEXT_COLOR_SWATCHES.map((swatch) => (
          <Button
            key={swatch}
            size="sm"
            className={styles.swatch}
            style={swatchStyleFor(swatch)}
            active={swatch === value.toLowerCase()}
            tooltip={swatch}
            aria-label={`Use ${swatch}`}
            onClick={() => onCommit(swatch)}
          />
        ))}
      </span>
      <FormInput
        value={draft}
        aria-label="Colour hex value"
        placeholder="#000000"
        spellCheck={false}
        className={[styles.hexInput, invalid ? styles.hexInvalid : ""].filter(Boolean).join(" ")}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
      />
    </span>
  );
}
