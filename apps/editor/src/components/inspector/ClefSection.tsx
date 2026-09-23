import { Checkbox } from "@viritura/ui";
import { legendStyle, mergeFocusedSectionStyle } from "./types";
import type { InspectorSection } from "./notationInspectorMeta";

export interface ClefSectionProps {
  focusedSection: InspectorSection | null;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
}

export function ClefSection({ focusedSection, hidden, onHiddenChange }: ClefSectionProps) {
  return (
    <fieldset style={mergeFocusedSectionStyle("measure", focusedSection)}>
      <legend style={legendStyle}>Clef</legend>
      <Checkbox
        data-testid="notation-clef-hide"
        label="Hide clef"
        checked={hidden}
        onChange={(e) => onHiddenChange(e.target.checked)}
      />
    </fieldset>
  );
}
