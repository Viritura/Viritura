import { BookOpen, Palette, Plus } from "lucide-react";
import { Badge, Button } from "@viritura/ui";
import {
  affectedLayouts,
  categoryDefinition,
  clearCategory,
  deleteProfile,
  findProfile,
  layer,
  scopeLabel,
  type Category,
  type MockLayout,
  type Project,
  type Scope,
} from "./styleModel";
import { CategoryPicker, FieldRows } from "./FieldRows";
import styles from "./StyleWorkbench.module.css";

interface HouseStyleEditorProps {
  project: Project;
  scope: Scope;
  modified: boolean;
  viewing: MockLayout;
  categoryId: Category;
  onScope: (scope: Scope) => void;
  onCategory: (category: Category) => void;
  onCommit: (project: Project, message: string) => void;
  onNewProfile: () => void;
  onView: (id: string) => void;
  onLibrary: () => void;
}

function ScopeList({ project, scope, onScope, onNewProfile }: HouseStyleEditorProps) {
  const count = (id: string) => project.layouts.filter((layout) => layout.profileId === id).length;
  return (
    <div className={styles.scopeList} role="group" aria-label="House-style layer">
      <Button
        variant="ghost"
        fullWidth
        active={scope.kind === "common"}
        onClick={() => onScope({ kind: "common" })}
        className={styles.layoutButton}
      >
        <span>
          Shared settings
          <small>All {project.layouts.length} layouts</small>
        </span>
      </Button>
      <span className={styles.groupHeading}>Layout profiles</span>
      {project.style.profiles.map((profile) => (
        <Button
          key={profile.id}
          variant="ghost"
          fullWidth
          active={scope.kind === "profile" && scope.id === profile.id}
          onClick={() => onScope({ kind: "profile", id: profile.id })}
          className={styles.layoutButton}
        >
          <span>
            {profile.name}
            <small>
              {profile.role === "score" ? "Score" : "Part"} / {profile.settings.paper ?? "Inherited page"} /{" "}
              {count(profile.id)} {count(profile.id) === 1 ? "layout" : "layouts"}
            </small>
          </span>
        </Button>
      ))}
      <Button size="sm" onClick={onNewProfile}>
        <Plus size={14} />
        New layout profile
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
    <div className={styles.notice}>
      <strong>{profile.name}</strong>
      <p>
        {users.length ? `Used by ${users.map((layout) => layout.name).join(", ")}.` : "Not used by any layout yet."}{" "}
        Assign profiles from This Layout.
      </p>
      {viewing.profileId !== profile.id && (
        <p className={styles.warning}>
          Viewing {viewing.name}, which uses {findProfile(project, viewing.profileId).name}. These edits will not show
          in the preview.{" "}
          <Button size="sm" variant="link" onClick={() => onScope({ kind: "profile", id: viewing.profileId })}>
            Edit {findProfile(project, viewing.profileId).name} instead
          </Button>
          {firstUser && (
            <Button size="sm" variant="link" onClick={() => onView(firstUser.id)}>
              View {firstUser.name}
            </Button>
          )}
        </p>
      )}
      <Button
        size="sm"
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
  );
}

export function HouseStyleEditor(props: HouseStyleEditorProps) {
  const { project, scope, modified, categoryId, onScope, onCategory, onCommit, onLibrary } = props;
  const category = categoryDefinition(categoryId);
  const affected = affectedLayouts(project, scope);
  const sharedPage = scope.kind === "common" && category.profileOnly;
  const settings = layer(project, scope);
  return (
    <div className={styles.editorBody}>
      <div className={styles.styleIdentity}>
        <Palette size={18} />
        <div>
          <strong>{project.style.name}</strong>
          <p>Project default for every score and part / from the {project.origin.name} library style</p>
        </div>
        <Badge variant={modified ? "warning" : "muted"}>{modified ? "Edited in project" : "Matches library"}</Badge>
      </div>
      <Button size="sm" onClick={onLibrary}>
        <BookOpen size={14} />
        Library and save
      </Button>
      <ScopeList {...props} />
      <ProfileSummary {...props} />
      <div className={styles.categoryHeading}>
        <div>
          <span className={styles.eyebrow}>{scopeLabel(project, scope)}</span>
          <h2>{category.label}</h2>
        </div>
      </div>
      <CategoryPicker value={categoryId} onChange={onCategory} />
      <p className={styles.hint}>{category.description}</p>
      {sharedPage ? (
        <div className={styles.notice}>
          <strong>Print sizes belong to layout profiles.</strong>
          <p>Each profile defines its own page size, orientation, margins and staff size.</p>
          {project.style.profiles.map((profile) => (
            <Button key={profile.id} size="sm" onClick={() => onScope({ kind: "profile", id: profile.id })}>
              Edit {profile.name}
            </Button>
          ))}
        </div>
      ) : (
        <>
          <FieldRows project={project} scope={scope} categoryId={categoryId} onCommit={onCommit} />
          {categoryId === "numbers" && (
            <p className={styles.hint}>Specific bracket placement is chosen per layout in This Layout.</p>
          )}
          <div className={styles.categoryActions}>
            <Button
              size="sm"
              disabled={!category.fields.some(({ id }) => settings[id] !== undefined)}
              onClick={() =>
                onCommit(
                  clearCategory(project, scope, categoryId),
                  `${category.label} in ${scopeLabel(project, scope)} now inherits.`,
                )
              }
            >
              {scope.kind === "common" ? "Use built-in values" : "Inherit shared settings"}
            </Button>
          </div>
        </>
      )}
      <div className={styles.impact}>
        <strong>
          Applies live to {affected.length} {affected.length === 1 ? "layout" : "layouts"}
        </strong>
        <p>
          {affected.map((layout) => layout.name).join(", ") || "None"}. Layout overrides are preserved. Flip through
          layouts on the left or use All layouts in the preview to check the result.
        </p>
      </div>
    </div>
  );
}
