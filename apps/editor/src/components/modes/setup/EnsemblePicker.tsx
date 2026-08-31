/**
 * EnsemblePicker — ensemble templates (string quartet, concert band, …)
 * grouped by category, which add every instrument of the template to the live
 * score in a single undoable edit.
 *
 * Previously this was step 1 of the New Score wizard and could therefore only
 * ever run once, at creation. Hosting it in Setup mode makes it an ordinary
 * action: add a wind quintet to a score that already has a piano in it, and
 * watch the staves appear on the shared canvas.
 */
import { useMemo, type CSSProperties } from "react";
import { ActionTile } from "@viritura/ui";
import { ENSEMBLE_CATEGORIES, ENSEMBLE_TEMPLATES, type EnsembleTemplate } from "../../../score/InstrumentCatalog";

const ROOT_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const GROUP_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const GROUP_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
};
const GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: 6,
};

export interface EnsemblePickerProps {
  readonly onSelect: (templateId: string) => void;
}

export function EnsemblePicker({ onSelect }: EnsemblePickerProps) {
  // Only render categories that actually have templates, so the list stays
  // honest if the catalog changes.
  const groups = useMemo(
    () =>
      ENSEMBLE_CATEGORIES.map((category) => ({
        ...category,
        templates: ENSEMBLE_TEMPLATES.filter((t: EnsembleTemplate) => t.category === category.id),
      })).filter((group) => group.templates.length > 0),
    [],
  );

  return (
    <div style={ROOT_STYLE}>
      {groups.map((group) => (
        <div key={group.id} style={GROUP_STYLE}>
          <span style={GROUP_LABEL_STYLE}>{group.label}</span>
          <div style={GRID_STYLE}>
            {group.templates.map((template) => (
              <ActionTile
                key={template.id}
                title={template.name}
                tooltip={template.description}
                onClick={() => onSelect(template.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
