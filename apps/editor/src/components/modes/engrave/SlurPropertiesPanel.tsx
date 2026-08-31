import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { FormInput, PanelHeader, PanelActionButton } from "@viritura/ui";
import type { SlurShape } from "@viritura/core";

const SLUR_OFFSET_ROW_STYLE: CSSProperties = { display: "flex", gap: 6 };
function slurInputStyle(): CSSProperties {
  return { ...inspectorInputStyle, width: "4.5rem", textAlign: "right" };
}
import {
  panelOuterStyle,
  inspectorBodyStyle,
  inspectorSectionStyle,
  inspectorLegendStyle,
  inspectorLabelStyle,
  inspectorInputStyle,
} from "./styles";

/**
 * Right-panel inspector for the currently selected slur. Rendered inside the
 * same `ViewLayout.rightPanel` slot the editor uses for `NotationInspector`,
 * and styled with the same glass-panel chrome (`<aside>` + `<fieldset>`
 * sections) for visual consistency with Write mode's inspector.
 *
 * Shows the four bezier handle deltas (`p0`–`p3`) as editable sp values.
 * Editing a value replaces the entire shape (i.e. is not additive with prior
 * drags) so the panel acts as a precise nudge tool. The "Reset shape" button
 * clears all overrides and lets the engine re-layout the slur from defaults.
 */
export function SlurPropertiesPanel({
  slurElementId,
  shape,
  onChange,
  onReset,
  onDeselect,
}: {
  slurElementId: string | null;
  shape: SlurShape | null;
  onChange: (next: SlurShape) => void;
  onReset: () => void;
  onDeselect: () => void;
}) {
  // Empty state — panel is still mounted (and the right column still occupies
  // its width when expanded) but reads as inert. In practice the auto-collapse
  // hook keeps it hidden whenever this branch fires; we just render something
  // sensible so the panel never flashes blank during the collapse animation.
  if (!slurElementId || shape === null) {
    return (
      <aside style={panelOuterStyle} data-testid="slur-properties-panel">
        <PanelHeader title="Notation Properties" subtitle="No slur selected." />
      </aside>
    );
  }

  // Strip the `slur/` prefix and split the two MNX event ids back out for display.
  const label = (() => {
    if (!slurElementId.startsWith("slur/")) return slurElementId;
    const parts = slurElementId.slice(5).split("/");
    if (parts.length >= 2) return `${parts[0]} → ${parts[1]}`;
    return slurElementId.slice(5);
  })();

  const setHandle = (h: "p0" | "p1" | "p2" | "p3", axis: 0 | 1, value: number) => {
    const cur = shape[h] ?? [0, 0];
    const nextVec: [number, number] = axis === 0 ? [value, cur[1]] : [cur[0], value];
    // Drop the entry when both axes return to 0 so the override doesn't
    // serialize as a no-op.
    const next: SlurShape = { ...shape };
    if (Math.abs(nextVec[0]) < 1e-6 && Math.abs(nextVec[1]) < 1e-6) delete next[h];
    else next[h] = nextVec;
    onChange(next);
  };

  return (
    <aside style={panelOuterStyle} data-testid="slur-properties-panel">
      <PanelHeader
        title="Notation Properties"
        subtitle={`Selected: slur (${label})`}
        actions={
          <>
            <PanelActionButton onClick={onReset} tooltip="Clear all shape overrides">
              <RotateCcw size={11} /> Reset
            </PanelActionButton>
            <PanelActionButton onClick={onDeselect} tooltip="Deselect slur">
              Deselect
            </PanelActionButton>
          </>
        }
      />
      <div className="viritura-scroll" style={inspectorBodyStyle}>
        <fieldset style={inspectorSectionStyle}>
          <legend style={inspectorLegendStyle}>Shape · handle offsets (sp)</legend>
          {(["p0", "p1", "p2", "p3"] as const).map((h) => (
            <SlurHandleRow
              key={h}
              label={h === "p0" ? "p0 — start" : h === "p3" ? "p3 — end" : h === "p1" ? "p1 — start CP" : "p2 — end CP"}
              value={shape[h] ?? [0, 0]}
              onChange={(axis, v) => setHandle(h, axis, v)}
            />
          ))}
        </fieldset>
      </div>
    </aside>
  );
}

function SlurHandleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number];
  onChange: (axis: 0 | 1, v: number) => void;
}) {
  return (
    <label style={inspectorLabelStyle}>
      <span>{label}</span>
      <div style={SLUR_OFFSET_ROW_STYLE}>
        <NumberInput value={value[0]} onChange={(v) => onChange(0, v)} title={`${label} Δx (sp)`} />
        <NumberInput value={value[1]} onChange={(v) => onChange(1, v)} title={`${label} Δy (sp)`} />
      </div>
    </label>
  );
}

function NumberInput({ value, onChange, title }: { value: number; onChange: (v: number) => void; title?: string }) {
  // Local text state lets the user type intermediate strings ("-", "0.") that
  // wouldn't survive an immediate parseFloat round-trip. We only push numeric
  // updates upstream when the text parses cleanly; on blur we re-sync from
  // the canonical value.
  const [text, setText] = useState(() => formatSp(value));
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(formatSp(value));
    }
  }, [value]);
  return (
    <FormInput
      type="number"
      step={0.05}
      value={text}
      title={title}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = parseFloat(t);
        if (!Number.isNaN(n) && Number.isFinite(n)) {
          lastValueRef.current = n;
          onChange(n);
        }
      }}
      onBlur={() => setText(formatSp(lastValueRef.current))}
      style={slurInputStyle()}
    />
  );
}

function formatSp(v: number): string {
  // Trim to 3 decimals but drop trailing zeros so the field reads cleanly.
  return parseFloat(v.toFixed(3)).toString();
}
