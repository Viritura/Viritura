import { Badge, Button, ButtonGroup, FormField, Select } from "@viritura/ui";
import {
  CATEGORIES,
  categoryDefinition,
  changeField,
  findLayout,
  findProfile,
  layer,
  promoteOverride,
  protectedLayouts,
  resolveField,
  scopeLabel,
  type Category,
  type Project,
  type Scope,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

export interface FieldEditorProps {
  project: Project;
  scope: Scope;
  categoryId: Category;
  onCommit: (project: Project, message: string) => void;
}

export function CategoryPicker({ value, onChange }: { value: Category; onChange: (category: Category) => void }) {
  return (
    <ButtonGroup
      ariaLabel="Settings category"
      options={CATEGORIES.map((category) => ({ value: category.id, label: category.label }))}
      value={value}
      onChange={onChange}
    />
  );
}

const EXPLICIT_LABEL: Record<Scope["kind"], string> = {
  common: "Shared value",
  profile: "Profile value",
  layout: "This layout",
};

export function FieldRows({ project, scope, categoryId, onCommit }: FieldEditorProps) {
  const settings = layer(project, scope);
  const target = scopeLabel(project, scope);
  const profileName =
    scope.kind === "layout" ? findProfile(project, findLayout(project, scope.id).profileId).name : undefined;
  return categoryDefinition(categoryId).fields.map((field) => {
    const resolved = resolveField(project, scope, field.id);
    const explicit = settings[field.id] !== undefined;
    const kept = protectedLayouts(project, scope, field.id);
    return (
      <div className={styles.field} key={field.id}>
        <FormField label={field.label}>
          <Select
            aria-label={field.label}
            value={resolved.value}
            options={field.options}
            onValueChange={(value) =>
              onCommit(
                changeField(project, scope, field.id, value),
                `Changed ${field.label.toLowerCase()} in ${target}.`,
              )
            }
          />
        </FormField>
        <div className={styles.provenance}>
          <span>
            <Badge variant={explicit ? "accent" : "muted"}>{explicit ? EXPLICIT_LABEL[scope.kind] : "Inherited"}</Badge>
            <small>{explicit ? "Kept when the layer above changes" : `From ${resolved.source}`}</small>
          </span>
          <span className={styles.fieldActions}>
            {explicit && scope.kind === "layout" && (
              <Button
                size="sm"
                variant="link"
                onClick={() =>
                  onCommit(
                    promoteOverride(project, scope.id, field.id),
                    `${field.label} ${resolved.value} is now the ${profileName} profile default.`,
                  )
                }
              >
                Make {profileName} default
              </Button>
            )}
            <Button
              size="sm"
              variant="link"
              onClick={() =>
                onCommit(
                  changeField(project, scope, field.id, explicit ? undefined : resolved.value),
                  explicit
                    ? `${field.label} now inherits again in ${target}.`
                    : `Pinned ${field.label.toLowerCase()} at ${resolved.value} in ${target}.`,
                )
              }
            >
              {explicit ? "Use inherited value" : "Customize"}
            </Button>
          </span>
        </div>
        {kept.length > 0 && (
          <p className={styles.keptNote}>
            {kept.map((layout) => layout.name).join(", ")} {kept.length === 1 ? "keeps its" : "keep their"} own value
          </p>
        )}
      </div>
    );
  });
}
