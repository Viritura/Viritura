import { BookOpen, Plus } from "lucide-react";
import { Badge, Button, FormField, Select } from "@viritura/ui";
import {
  affectedLayouts,
  clearCategory,
  deleteProfile,
  findProfile,
  layer,
  scopeLabel,
  type MockLayout,
  type Project,
  type Scope,
} from "./styleModel";
import { FieldRows } from "./FieldRows";
import { CategoryBrowser, type OpenCategories } from "./CategoryBrowser";
import styles from "./StyleWorkbench.module.css";

interface HouseStyleEditorProps {
  project: Project;
  scope: Scope;
  modified: boolean;
  viewing: MockLayout;
  openCategories: OpenCategories;
  onScope: (scope: Scope) => void;
  onOpenCategories: (open: OpenCategories) => void;
  onCommit: (project: Project, message: string) => void;
  onNewProfile: () => void;
  onView: (id: string) => void;
  onLibrary: () => void;
}

function ScopeList({ project, scope, onScope, onNewProfile }: HouseStyleEditorProps) {
  return (
    <div className={styles.scopeList}>
      <FormField label="Editing">
        <Select
          aria-label="House style settings"
          value={scope.kind === "profile" ? `profile:${scope.id}` : "common"}
          options={[
            { value: "common", label: "Shared settings" },
            ...project.style.profiles.map((profile) => ({
              value: `profile:${profile.id}`,
              label: `${profile.name} profile`,
            })),
          ]}
          onValueChange={(value) =>
            onScope(value === "common" ? { kind: "common" } : { kind: "profile", id: value.slice("profile:".length) })
          }
        />
      </FormField>
      <Button size="sm" variant="link" onClick={onNewProfile}>
        <Plus size={14} />
        New profile
      </Button>
    </div>
  );
}

function ProfileSummary({ project, scope, viewing, onScope, onView, onCommit }: HouseStyleEditorProps) {
  if (scope.kind !== "profile") return null;
  const profile = findProfile(project, scope.id);
  const users = affectedLayouts(project, scope);
  const lastOfRole = !project.style.profiles.some((entry) => entry.id !== profile.id && entry.role === profile.role);
  const firstUser = users[0];
  return (
    <div className={styles.profileSummary}>
      <div className={styles.profileActions}>
        <span className={styles.hint}>
          {users.length} {users.length === 1 ? "layout" : "layouts"}
        </span>
        <Button
          size="sm"
          variant="link"
          disabled={lastOfRole}
          tooltip={lastOfRole ? `Every house style needs at least one ${profile.role} profile.` : undefined}
          onClick={() => {
            onCommit(
              deleteProfile(project, profile.id),
              `Deleted ${profile.name}; its layouts moved to another profile.`,
            );
            onScope({ kind: "common" });
          }}
        >
          Delete profile
        </Button>
      </div>
      {viewing.profileId !== profile.id && (
        <p className={styles.warning}>
          {viewing.name} uses {findProfile(project, viewing.profileId).name}, so this preview won&rsquo;t change.{" "}
          <Button size="sm" variant="link" onClick={() => onScope({ kind: "profile", id: viewing.profileId })}>
            Edit {findProfile(project, viewing.profileId).name}
          </Button>
          {firstUser && (
            <Button size="sm" variant="link" onClick={() => onView(firstUser.id)}>
              View {firstUser.name}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}

export function HouseStyleEditor(props: HouseStyleEditorProps) {
  const { project, scope, modified, openCategories, onOpenCategories, onCommit, onLibrary } = props;
  const settings = layer(project, scope);
  return (
    <div className={styles.editorBody}>
      <div className={styles.styleIdentity}>
        <div>
          <strong>{project.style.name}</strong>
          <p>Project house style</p>
        </div>
        {modified && <Badge variant="warning">Edited</Badge>}
        <Button size="sm" onClick={onLibrary}>
          <BookOpen size={14} />
          Library
        </Button>
      </div>
      <ScopeList {...props} />
      <ProfileSummary {...props} />
      <CategoryBrowser
        project={project}
        scope={scope}
        open={openCategories}
        onOpenChange={onOpenCategories}
        renderCategory={(category, fields) => (
          <>
            <FieldRows project={project} scope={scope} fields={fields} onCommit={onCommit} />
            <div className={styles.categoryActions}>
              <Button
                size="sm"
                disabled={!category.fields.some(({ id }) => settings[id] !== undefined)}
                onClick={() =>
                  onCommit(
                    clearCategory(project, scope, category.id),
                    `${category.label} in ${scopeLabel(project, scope)} now inherits.`,
                  )
                }
              >
                {scope.kind === "common" ? "Use built-in values" : "Inherit shared settings"}
              </Button>
            </div>
          </>
        )}
      />
    </div>
  );
}
