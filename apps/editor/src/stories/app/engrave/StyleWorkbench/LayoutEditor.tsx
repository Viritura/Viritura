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
          This {layout.role} uses a {profile.role} profile. That is allowed, for example a part printed as a score.
        </p>
      )}
      <p className={styles.hint}>
        Follows {project.style.name} / {profile.name}.{" "}
        <Button size="sm" variant="link" onClick={() => onEditProfile(profile.id)}>
          Edit {profile.name} profile
        </Button>
      </p>
      <div className={styles.categoryHeading}>
        <div>
          <span className={styles.eyebrow}>{layout.name} overrides</span>
          <h2>{category.label}</h2>
        </div>
      </div>
      <CategoryPicker value={categoryId} onChange={onCategory} />
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
          <p className={styles.hint}>Specific groups belong to this layout, not to the house style.</p>
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
      <div className={styles.impact}>
        <strong>Only {layout.name} is edited</strong>
        <p>Customize pins a value even when it matches the profile. Use inherited value resumes following it.</p>
      </div>
    </div>
  );
}

export function SelectionPlaceholder({ layout, onLayout }: { layout: MockLayout; onLayout: () => void }) {
  return (
    <div className={styles.editorBody}>
      <span className={styles.eyebrow}>Local decisions / {layout.name}</span>
      <h2>Manual engraving</h2>
      <p>
        No score object is selected in this mockup. Real selection would expose offsets and individual appearance here.
      </p>
      <div className={styles.notice}>
        <strong>{layout.manualBreaks} authored breaks retained</strong>
        <p>House-style edits, profile changes and category resets do not remove these.</p>
      </div>
      <Button onClick={onLayout}>Back to This Layout</Button>
    </div>
  );
}
