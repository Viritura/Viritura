import type { Glissando } from "@viritura/core";
import { Checkbox, FormInput, Select } from "@viritura/ui";
import { errorStyle, labelStyle, legendStyle, mergeFocusedSectionStyle } from "./types";
import type { InspectorSection } from "./notationInspectorMeta";

const KIND_OPTIONS = [
  { value: "glissando", label: "Glissando" },
  { value: "portamento", label: "Portamento" },
] as const;

const STYLE_OPTIONS = [
  { value: "straight", label: "Straight" },
  { value: "wavy", label: "Wavy" },
] as const;

export interface GlissandoSectionProps {
  glissando: Glissando;
  focusedSection: InspectorSection | null;
  error: string | null;
  onTargetChange: (value: string) => void;
  onKindChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onTextVisibleChange: (visible: boolean) => void;
  onTextChange: (value: string) => void;
}

export function GlissandoSection({
  glissando,
  focusedSection,
  error,
  onTargetChange,
  onKindChange,
  onStyleChange,
  onTextVisibleChange,
  onTextChange,
}: GlissandoSectionProps) {
  return (
    <fieldset style={mergeFocusedSectionStyle("glissando", focusedSection)}>
      <legend style={legendStyle}>Glissando / portamento</legend>
      <label style={labelStyle}>
        Type
        <Select
          data-testid="notation-glissando-kind"
          value={glissando.kind ?? "glissando"}
          onValueChange={onKindChange}
          options={[...KIND_OPTIONS]}
        />
      </label>
      <label style={labelStyle}>
        Line style
        <Select
          data-testid="notation-glissando-style"
          value={glissando.style ?? "straight"}
          onValueChange={onStyleChange}
          options={[...STYLE_OPTIONS]}
        />
      </label>
      <label style={labelStyle}>
        Target event ID
        <FormInput
          data-testid="notation-glissando-target"
          value={glissando.target}
          onChange={(event) => onTargetChange(event.target.value)}
        />
      </label>
      <Checkbox
        data-testid="notation-glissando-show-text"
        label="Show text"
        checked={glissando.text !== undefined && glissando.showText !== false}
        onChange={(event) => onTextVisibleChange(event.target.checked)}
      />
      {glissando.text !== undefined && glissando.showText !== false && (
        <label style={labelStyle}>
          Display text
          <FormInput
            data-testid="notation-glissando-text"
            value={glissando.text}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </label>
      )}
      {error && <div style={errorStyle}>{error}</div>}
    </fieldset>
  );
}
