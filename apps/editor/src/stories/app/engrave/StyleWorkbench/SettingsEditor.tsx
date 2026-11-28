import { Palette } from "lucide-react";
import { Badge, Button, ButtonGroup, Checkbox, FormField, Select } from "@viritura/ui";
import {
  CATEGORIES,
  SCOPES,
  changeField,
  clearCategory,
  layer,
  resolveField,
  type Category,
  type MockLayout,
  type Project,
  type Scope,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

interface EditorProps {
  project: Project;
  layout: MockLayout;
  scope: Scope;
  categoryId: Category;
  onScope: (scope: Exclude<Scope, "layout">) => void;
  onLayout: () => void;
  onTransfer: () => void;
  onCommit: (project: Project, message: string) => void;
}

function CategoryFields({
  project,
  layout,
  scope,
  categoryId,
  onCommit,
}: Pick<EditorProps, "project" | "layout" | "scope" | "categoryId" | "onCommit">) {
  const overrides = layer(project, scope, layout);
  const targetName =
    scope === "layout" ? layout.name : `Project ${SCOPES.find((entry) => entry.value === scope)!.label}`;
  return CATEGORIES.find((entry) => entry.id === categoryId)!.fields.map((field) => {
    const resolved = resolveField(project, scope, layout, field.id);
    const explicit = overrides[field.id] !== undefined;
    return (
      <div className={styles.field} key={field.id}>
        <FormField label={field.label}>
          <Select
            aria-label={field.label}
            value={resolved.value}
            options={field.options}
            onValueChange={(value) =>
              onCommit(
                changeField(project, scope, layout.id, field.id, value),
                `Changed ${field.label.toLowerCase()} in ${targetName}. Other overrides are preserved.`,
              )
            }
          />
        </FormField>
        <div className={styles.provenance}>
          <span>
            <Badge variant={explicit ? "accent" : "muted"}>
              {explicit ? (scope === "layout" ? "This layout" : "Project adjustment") : "Inherited"}
            </Badge>
            <small>{explicit ? "Kept when parent settings change" : resolved.source}</small>
          </span>
          <Button
            size="sm"
            variant="link"
            onClick={() =>
              onCommit(
                changeField(project, scope, layout.id, field.id, explicit ? undefined : resolved.value),
                explicit
                  ? `${field.label} now inherits its parent value.`
                  : `Pinned ${field.label.toLowerCase()} at ${resolved.value}.`,
              )
            }
          >
            {explicit ? (scope === "layout" ? "Use project value" : "Use inherited value") : "Customize"}
          </Button>
        </div>
      </div>
    );
  });
}

function CategoryExtras({
  project,
  layout,
  scope,
  categoryId,
  onLayout,
  onTransfer,
  onCommit,
}: Omit<EditorProps, "onScope">) {
  const category = CATEGORIES.find((entry) => entry.id === categoryId)!;
  const overrides = layer(project, scope, layout);
  const affected =
    scope === "layout" ? [layout] : project.layouts.filter((entry) => scope === "common" || entry.role === scope);
  return (
    <>
      {categoryId === "numbers" &&
        (scope === "layout" ? (
          <div className={styles.notice}>
            <span className={styles.eyebrow}>Layout-only placement</span>
            {layout.id === "full" ? (
              <Checkbox
                label="Also above the woodwind bracket"
                checked={layout.bracket}
                onChange={(event) =>
                  onCommit(
                    {
                      ...project,
                      layouts: project.layouts.map((entry) =>
                        entry.id === layout.id ? { ...entry, bracket: event.target.checked } : entry,
                      ),
                    },
                    "Changed this layout's bracket placement only.",
                  )
                }
              />
            ) : (
              <p>No bracket groups in this sample part.</p>
            )}
            <p className={styles.hint}>Specific groups belong to this layout, not to reusable house styles.</p>
          </div>
        ) : (
          <div className={styles.notice}>
            <p>Specific bracket placement is configured per layout.</p>
            <Button size="sm" onClick={onLayout}>
              Edit {layout.name}
            </Button>
          </div>
        ))}
      <div className={styles.categoryActions}>
        <Button
          size="sm"
          disabled={!category.fields.some(({ id }) => overrides[id] !== undefined)}
          onClick={() =>
            onCommit(
              clearCategory(project, scope, layout.id, categoryId),
              `${category.label} now follows inherited defaults; manual decisions retained.`,
            )
          }
        >
          {scope === "layout" ? "Use project settings" : "Reset category adjustments"}
        </Button>
        {scope === "layout" && (
          <Button size="sm" onClick={onTransfer}>
            Copy to layouts
          </Button>
        )}
      </div>
      <div className={styles.impact}>
        <strong>
          {scope === "layout"
            ? "Only this layout is edited"
            : `${affected.length} ${affected.length === 1 ? "layout" : "layouts"} in this scope`}
        </strong>
        <p>
          {scope === "layout"
            ? "Customize pins a value, even when it matches its parent. Reset explicitly resumes inheritance."
            : "Propagation is per field. Open Layout overrides to inspect protected exceptions."}
        </p>
      </div>
    </>
  );
}

export function SettingsEditor(props: EditorProps) {
  const { project, layout, scope, categoryId, onScope, onCommit } = props;
  const category = CATEGORIES.find((entry) => entry.id === categoryId)!;
  const unavailable = scope === "common" && categoryId === "page";
  const targetName =
    scope === "layout" ? layout.name : `Project ${SCOPES.find((entry) => entry.value === scope)!.label}`;
  return (
    <div className={styles.editorBody}>
      {scope !== "layout" ? (
        <>
          <div className={styles.styleIdentity}>
            <Palette size={18} />
            <div>
              <strong>{project.adopted.name}</strong>
              <p>Project snapshot / independent of library updates</p>
            </div>
          </div>
          <ButtonGroup options={SCOPES} value={scope} onChange={onScope} />
          <p className={styles.hint}>Edits flow to inheriting layouts. Individual overrides are preserved.</p>
        </>
      ) : (
        <>
          <h2>{layout.name}</h2>
          <FormField label="Layout role">
            <Select
              aria-label="Layout role"
              value={layout.role}
              options={[
                { value: "score", label: "Score" },
                { value: "part", label: "Part" },
              ]}
              onValueChange={(role) => {
                if (role !== "score" && role !== "part") return;
                onCommit(
                  {
                    ...project,
                    layouts: project.layouts.map((entry) => (entry.id === layout.id ? { ...entry, role } : entry)),
                  },
                  `Changed ${layout.name} to ${role}; explicit overrides retained.`,
                );
              }}
            />
          </FormField>
          <p className={styles.hint}>
            Uses project {layout.role === "score" ? "Score" : "Part"} defaults / {Object.keys(layout.overrides).length}{" "}
            explicit overrides
          </p>
        </>
      )}
      <div className={styles.categoryHeading}>
        <div>
          <span className={styles.eyebrow}>{targetName}</span>
          <h2>{category.label}</h2>
        </div>
        <Badge variant="muted">{scope === "layout" ? "Overrides" : "Defaults"}</Badge>
      </div>
      <p className={styles.hint}>{category.description}</p>
      {unavailable ? (
        <div className={styles.notice}>
          <strong>Scores and Parts have their own page settings.</strong>
          <p>Choose a role to edit its page size, staff size and casting policy.</p>
          <Button onClick={() => onScope("score")}>Edit Scores</Button>
          <Button onClick={() => onScope("part")}>Edit Parts</Button>
        </div>
      ) : (
        <>
          <CategoryFields {...props} />
          <CategoryExtras {...props} />
        </>
      )}
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
        <p>Style changes, category resets and house-style adoption do not remove these.</p>
      </div>
      <Button onClick={onLayout}>Back to This Layout</Button>
    </div>
  );
}
