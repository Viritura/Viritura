import { useState, type ReactNode } from "react";
import { Collapsible, PanelSearchHeader } from "@viritura/ui";
import {
  CATEGORIES,
  layer,
  type Category,
  type CategoryDefinition,
  type FieldDefinition,
  type Project,
  type Scope,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

export type OpenCategories = Partial<Record<Category, boolean>>;

interface CategoryBrowserProps {
  project: Project;
  scope: Scope;
  open: OpenCategories;
  onOpenChange: (open: OpenCategories) => void;
  /** Section body; `fields` is narrowed while searching. */
  renderCategory: (category: CategoryDefinition, fields: FieldDefinition[]) => ReactNode;
}

function matchingFields(category: CategoryDefinition, terms: string[]): FieldDefinition[] {
  if (!terms.length) return category.fields;
  const matches = (text: string) => terms.every((term) => text.toLowerCase().includes(term));
  if (matches(category.label)) return category.fields;
  return category.fields.filter(({ label }) => matches(label));
}

export function CategoryBrowser({ project, scope, open, onOpenChange, renderCategory }: CategoryBrowserProps) {
  const [query, setQuery] = useState("");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const settings = layer(project, scope);
  const visible = CATEGORIES.filter((category) => scope.kind !== "common" || !category.profileOnly)
    .map((category) => ({ category, fields: matchingFields(category, terms) }))
    .filter(({ fields }) => fields.length > 0);
  const anyOpen = visible.some(({ category }) => searching || open[category.id]);
  return (
    <div className={styles.categoryBrowser}>
      <PanelSearchHeader
        value={query}
        onValueChange={setQuery}
        placeholder="Search settings"
        searchLabel="Search settings"
        anyOpen={anyOpen}
        onToggleAll={() =>
          onOpenChange({ ...open, ...Object.fromEntries(visible.map(({ category }) => [category.id, !anyOpen])) })
        }
        toggleLabel={anyOpen ? "Collapse all sections" : "Expand all sections"}
        toggleDisabled={searching || !visible.length}
      />
      {visible.map(({ category, fields }) => {
        const count = category.fields.filter(({ id }) => settings[id] !== undefined).length;
        return (
          <Collapsible
            key={category.id}
            title={category.label}
            open={searching || !!open[category.id]}
            onOpenChange={(next) => onOpenChange({ ...open, [category.id]: next })}
            actions={
              count > 0 && (
                <span className={styles.customCount} aria-label={`${category.label}: ${count} custom`}>
                  {count}
                </span>
              )
            }
          >
            {renderCategory(category, fields)}
          </Collapsible>
        );
      })}
      {!visible.length && <p className={styles.hint}>No matching settings.</p>}
    </div>
  );
}
