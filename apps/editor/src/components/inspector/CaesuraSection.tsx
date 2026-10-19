import type { CaesuraStyle } from "@viritura/core";
import { Button, Select } from "@viritura/ui";
import { globalCaesuraMeasure, planCaesuraProperties, selectedCaesura } from "../../commands/caesura";
import { useDocument, useDocumentActions } from "../../store/DocumentContext";
import { useSelection } from "../../store/selectionStore";
import { labelStyle, legendStyle, sectionStyle } from "./types";

export function CaesuraSection() {
  const { score } = useDocument();
  const { commitPatches } = useDocumentActions();
  const selection = useSelection();
  if (!score || selection.kind !== "single") return null;
  const caesura = selectedCaesura(score, selection.elementId);
  if (!caesura) return null;
  const update = (properties: Parameters<typeof planCaesuraProperties>[2]) => {
    const patches = planCaesuraProperties(score, selection.elementId, properties);
    if (patches) commitPatches(patches);
  };
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Caesura</legend>
      <p>
        {globalCaesuraMeasure(selection.elementId) === null ? "Event marking" : "Global ending barline — all staves"}
      </p>
      <label style={labelStyle}>
        Shape
        <Select
          data-testid="notation-caesura-shape"
          value={caesura.style ?? "normal"}
          options={[
            { value: "normal", label: "Normal" },
            { value: "thick", label: "Thick" },
            { value: "short", label: "Short" },
            { value: "curved", label: "Curved" },
          ]}
          onValueChange={(value) => update({ style: value as CaesuraStyle })}
        />
      </label>
      <label style={labelStyle}>
        Strokes
        <Select
          data-testid="notation-caesura-marks"
          value={String(caesura.marks ?? 2)}
          options={[
            { value: "1", label: "1" },
            { value: "2", label: "2" },
          ]}
          onValueChange={(value) => update({ marks: value === "1" ? 1 : 2 })}
        />
      </label>
      <Button onClick={() => update(undefined)}>Remove caesura</Button>
    </fieldset>
  );
}
