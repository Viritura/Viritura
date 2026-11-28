import { Button, Checkbox, FormField, Select } from "@viritura/ui";
import {
  assignProfile,
  categoryDefinition,
  clearCategory,
  findProfile,
  type Category,
  type MockLayout,
  type Project,
} from "./styleModel";
import { CategoryPicker, FieldRows } from "./FieldRows";
import styles from "./StyleWorkbench.module.css";

interface LayoutEditorProps {
  project: Project;
  layout: MockLayout;
  categoryId: Category;
  onCategory: (category: Category) => void;
  onCommit: (project: Project, message: string) => void;
  onTransfer: () => void;
  onEditProfile: (id: string) => void;
}

export function LayoutEditor({
  project,
  layout,
  categoryId,
  onCategory,
  onCommit,
  onTransfer,
  onEditProfile,
}: LayoutEditorProps) {
  const category = categoryDefinition(categoryId);
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
      <div className={styles.categoryHeading}>
        <CategoryPicker value={categoryId} onChange={onCategory} />
      </div>
      <FieldRows project={project} scope={scope} categoryId={categoryId} onCommit={onCommit} />
      {categoryId === "numbers" && (
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
              clearCategory(project, scope, categoryId),
              `${layout.name} ${category.label.toLowerCase()} follows ${profile.name} again; manual breaks kept.`,
            )
          }
        >
          Use profile settings
        </Button>
        <Button size="sm" onClick={onTransfer}>
          Copy to layouts
        </Button>
      </div>
    </div>
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
