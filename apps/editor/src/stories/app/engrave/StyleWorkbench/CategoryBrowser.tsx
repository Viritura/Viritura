import { useState, type ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { Collapsible, IconButton, PanelSearchHeader } from "@viritura/ui";
import {
  CATEGORIES,
  isModifiedAtScope,
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

function matchingFields(
  category: CategoryDefinition,
  terms: string[],
  customOnly: boolean,
  isModified: (field: FieldDefinition) => boolean,
): FieldDefinition[] {
  const fields = customOnly ? category.fields.filter(isModified) : category.fields;
  if (!terms.length) return fields;
  const matches = (text: string) => terms.every((term) => text.toLowerCase().includes(term));
  if (matches(category.label)) return fields;
  return fields.filter(({ label }) => matches(label));
}

export function CategoryBrowser({ project, scope, open, onOpenChange, renderCategory }: CategoryBrowserProps) {
  const [query, setQuery] = useState("");
  const [customOnly, setCustomOnly] = useState(false);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0 || customOnly;
  const visible = CATEGORIES.filter((category) => scope.kind !== "common" || !category.profileOnly)
    .map((category) => ({
      category,
      fields: matchingFields(category, terms, customOnly, (field) => isModifiedAtScope(project, scope, field.id)),
    }))
    .filter(({ fields }) => fields.length > 0);
  const anyOpen = visible.some(({ category }) => searching || open[category.id]);
  return (
    <div className={styles.categoryBrowser}>
      <div className={styles.filterRow}>
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
        <IconButton
          size="md"
          active={customOnly}
          tooltip={customOnly ? "Show all settings" : "Show only custom settings"}
          aria-label="Custom only"
          onClick={() => setCustomOnly((current) => !current)}
        >
          <ListFilter size={14} />
        </IconButton>
      </div>
      {visible.map(({ category, fields }) => {
        const count = category.fields.filter((field) => isModifiedAtScope(project, scope, field.id)).length;
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
      {!visible.length && <p className={styles.hint}>{customOnly ? "No custom settings." : "No matching settings."}</p>}
    </div>
  );
}
