import { Button, Checkbox, FormField, Select } from "@viritura/ui";
import {
  assignProfile,
  clearCategory,
  findProfile,
  type CategoryDefinition,
  type FieldDefinition,
  type MockLayout,
  type Project,
} from "./styleModel";
import { FieldRows } from "./FieldRows";
import { CategoryBrowser, type OpenCategories } from "./CategoryBrowser";
import styles from "./StyleWorkbench.module.css";

interface LayoutEditorProps {
  project: Project;
  layout: MockLayout;
  openCategories: OpenCategories;
  onOpenCategories: (open: OpenCategories) => void;
  onCommit: (project: Project, message: string) => void;
  onTransfer: (category: CategoryDefinition) => void;
  onEditProfile: (id: string) => void;
}

export function LayoutEditor({
  project,
  layout,
  openCategories,
  onOpenCategories,
  onCommit,
  onTransfer,
  onEditProfile,
}: LayoutEditorProps) {
  const profile = findProfile(project, layout.profileId);
  const scope = { kind: "layout", id: layout.id } as const;
  return (
    <div className={styles.editorBody}>
      <h2>{layout.name}</h2>
      <FormField label="Layout profile">
        <Select
          aria-label="Layout profile"
          value={layout.profileId}
          options={project.style.profiles.map((entry) => ({
            value: entry.id,
            label: `${entry.name} (${entry.role === "score" ? "score" : "part"})`,
          }))}
          onValueChange={(id) =>
            onCommit(
              assignProfile(project, layout.id, id),
              `${layout.name} now uses ${findProfile(project, id).name}; its own overrides are kept.`,
            )
          }
        />
      </FormField>
      {profile.role !== layout.role && (
        <p className={styles.warning}>
          This {layout.role} uses a {profile.role} profile.
        </p>
      )}
      <Button size="sm" variant="link" onClick={() => onEditProfile(profile.id)}>
        Edit {profile.name} profile
      </Button>
      <CategoryBrowser
        project={project}
        scope={scope}
        open={openCategories}
        onOpenChange={onOpenCategories}
        renderCategory={(category, fields) => (
          <LayoutCategoryDetail
            project={project}
            layout={layout}
            category={category}
            fields={fields}
            onCommit={onCommit}
            onTransfer={onTransfer}
          />
        )}
      />
    </div>
  );
}

function LayoutCategoryDetail({
  project,
  layout,
  category,
  fields,
  onCommit,
  onTransfer,
}: Pick<LayoutEditorProps, "project" | "layout" | "onCommit" | "onTransfer"> & {
  category: CategoryDefinition;
  fields: FieldDefinition[];
}) {
  const profile = findProfile(project, layout.profileId);
  const scope = { kind: "layout", id: layout.id } as const;
  return (
    <>
      <FieldRows project={project} scope={scope} fields={fields} onCommit={onCommit} />
      {category.id === "numbers" && (
        <div className={styles.notice}>
          <span className={styles.eyebrow}>Layout-only placement</span>
          {layout.staves > 2 ? (
            <Checkbox
              label="Also above the string bracket"
              checked={layout.bracket}
              onChange={(event) =>
                onCommit(
                  {
                    ...project,
                    layouts: project.layouts.map((entry) =>
                      entry.id === layout.id ? { ...entry, bracket: event.target.checked } : entry,
                    ),
                  },
                  `Changed ${layout.name} bracket placement only.`,
                )
              }
            />
          ) : (
            <p>No bracket groups in this layout.</p>
          )}
        </div>
      )}
      <div className={styles.categoryActions}>
        <Button
          size="sm"
          disabled={!category.fields.some(({ id }) => layout.overrides[id] !== undefined)}
          onClick={() =>
            onCommit(
              clearCategory(project, scope, category.id),
              `${layout.name} ${category.label.toLowerCase()} follows ${profile.name} again; manual breaks kept.`,
            )
          }
        >
          Use profile settings
        </Button>
        <Button size="sm" onClick={() => onTransfer(category)}>
          Copy to layouts
        </Button>
      </div>
    </>
  );
}

export function SelectionPlaceholder({ layout, onLayout }: { layout: MockLayout; onLayout: () => void }) {
  return (
    <div className={styles.editorBody}>
      <h2>Manual engraving</h2>
      <p>No selection in this mockup.</p>
      <div className={styles.notice}>
        <strong>
          {layout.manualBreaks} manual breaks in {layout.name}
        </strong>
      </div>
      <Button onClick={onLayout}>Back to This Layout</Button>
    </div>
  );
}
