import { CascadingMenu, type CascadingMenuItem } from "@viritura/ui";
import {
  changeField,
  downstreamOverrides,
  findProfile,
  inheritedValue,
  isModifiedAtScope,
  layer,
  parentScope,
  promoteField,
  resetDownstream,
  scopeLabel,
  type CategoryDefinition,
  type FieldDefinition,
  type Project,
  type Scope,
} from "./styleModel";

type Commit = (project: Project, message: string) => void;

function parentName(project: Project, scope: Scope): string {
  return scope.kind === "profile" ? findProfile(project, scope.id).name : "House";
}

export function FieldActions({
  project,
  scope,
  field,
  onCommit,
}: {
  project: Project;
  scope: Scope;
  field: FieldDefinition;
  onCommit: Commit;
}) {
  const localValue = layer(project, scope)[field.id];
  const canReset = isModifiedAtScope(project, scope, field.id);
  const parent = canReset && localValue !== undefined ? parentScope(project, scope, field.id) : undefined;
  const below = downstreamOverrides(project, scope, field.id);
  const inherited = inheritedValue(project, scope, field.id);
  const actions: CascadingMenuItem[] = [];

  if (canReset) {
    actions.push({
      id: "reset",
      label: `Reset to ${inherited.value}`,
      onSelect: () =>
        onCommit(
          changeField(project, scope, field.id),
          `${field.label} in ${scopeLabel(project, scope)} reset to ${inherited.value}.`,
        ),
    });
  }
  if (parent) {
    actions.push({
      id: "move",
      label: `Move to ${parentName(project, parent)}`,
      onSelect: () =>
        onCommit(
          promoteField(project, scope, field.id),
          `${field.label} ${localValue} moved to ${parentName(project, parent)}.`,
        ),
    });
  }
  if (below.length) {
    actions.push({
      id: "clear-downstream",
      label: `Clear ${below.length} downstream ${below.length === 1 ? "custom setting" : "custom settings"}`,
      onSelect: () =>
        onCommit(
          resetDownstream(project, scope, field.id),
          `Cleared ${below.length} downstream ${field.label.toLowerCase()} ${below.length === 1 ? "setting" : "settings"}.`,
        ),
    });
  }
  if (!actions.length) return null;

  return (
    <CascadingMenu
      ariaLabel={`${field.label} actions`}
      label="Actions"
      tooltip={`Actions for ${field.label}`}
      items={actions}
      triggerSize="xs"
      triggerFullWidth={false}
    />
  );
}

export function SectionActions({
  project,
  scope,
  category,
  onCommit,
  onCopy,
}: {
  project: Project;
  scope: Scope;
  category: CategoryDefinition;
  onCommit: Commit;
  onCopy?: () => void;
}) {
  const fields = category.fields;
  const canReset = fields.some((field) => isModifiedAtScope(project, scope, field.id));
  const downstream = fields.flatMap((field) => downstreamOverrides(project, scope, field.id));
  const actions: CascadingMenuItem[] = [];

  if (canReset) {
    actions.push({
      id: "reset-section",
      label: "Reset section",
      onSelect: () =>
        onCommit(
          fields.reduce((current, field) => changeField(current, scope, field.id), project),
          `${category.label} in ${scopeLabel(project, scope)} reset.`,
        ),
    });
  }
  if (downstream.length) {
    actions.push({
      id: "clear-downstream",
      label: `Clear ${downstream.length} downstream custom ${downstream.length === 1 ? "setting" : "settings"}`,
      onSelect: () =>
        onCommit(
          fields.reduce((current, field) => resetDownstream(current, scope, field.id), project),
          `Cleared ${downstream.length} downstream ${category.label.toLowerCase()} settings.`,
        ),
    });
  }
  if (onCopy) {
    actions.push({
      id: "copy",
      label: "Copy settings to layouts",
      onSelect: onCopy,
    });
  }
  if (!actions.length) return null;

  return (
    <CascadingMenu
      ariaLabel={`${category.label} actions`}
      label="Section actions"
      tooltip={`${category.label} actions`}
      items={actions}
      triggerSize="sm"
      triggerFullWidth={false}
    />
  );
}
