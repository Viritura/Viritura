import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogHeader,
  DialogPrimaryButton,
  FormField,
  FormInput,
  Select,
} from "@viritura/ui";
import {
  adoptStyle,
  CATEGORIES,
  categoryDefinition,
  clearCategory,
  copyCategory,
  duplicateProfile,
  findProfile,
  resolveLayout,
  snapshotStyle,
  type Category,
  type HouseStyle,
  type MockLayout,
  type Project,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

type Commit = (project: Project, message: string) => void;

interface LibraryProps {
  project: Project;
  library: HouseStyle[];
  modified: boolean;
  onClose: () => void;
  onCommit: Commit;
  onSave: (style: HouseStyle) => void;
}

function effectiveChanges(before: Project, after: Project): string[] {
  return before.layouts.flatMap((layout, index) => {
    const next = after.layouts[index]!;
    const profileChange =
      findProfile(before, layout.profileId).name === findProfile(after, next.profileId).name
        ? []
        : [`${layout.name}: profile ${findProfile(after, next.profileId).name}`];
    return [
      ...profileChange,
      ...CATEGORIES.flatMap((category) =>
        category.fields.flatMap(({ id, label }) => {
          const from = resolveLayout(before, layout, id);
          const to = resolveLayout(after, next, id);
          return from === to ? [] : [`${layout.name}: ${label} ${from} to ${to}`];
        }),
      ),
    ];
  });
}

export function StyleLibrary({ project, library, modified, onClose, onCommit, onSave }: LibraryProps) {
  const [selectedId, setSelectedId] = useState(project.origin.id);
  const [name, setName] = useState("");
  const selected = library.find((style) => style.id === selectedId) ?? library[0]!;
  const next = adoptStyle(project, selected);
  const changes = effectiveChanges(project, next);
  const overrideCount = project.layouts.reduce((total, layout) => total + Object.keys(layout.overrides).length, 0);
  function save() {
    const style = snapshotStyle(project, `saved-${library.length}`, name.trim());
    onSave(style);
    onCommit({ ...project, origin: { id: style.id, name: style.name } }, `Saved ${style.name} to the library.`);
    setSelectedId(style.id);
    setName("");
  }
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title="House-style library" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>
          The project keeps its own copy of the house style. Library edits never change existing projects, and project
          edits reach the library only when you save.
        </p>
        <div className={styles.saveStyle}>
          <FormField label="Save this project's house style, including all layout profiles">
            <FormInput
              aria-label="New house-style name"
              placeholder="My concert style"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <Button disabled={!name.trim()} onClick={save}>
            Save to library
          </Button>
        </div>
        <h3>Replace with a library style</h3>
        <div className={styles.libraryGrid}>
          {library.map((style) => (
            <Button
              key={style.id}
              active={selectedId === style.id}
              onClick={() => setSelectedId(style.id)}
              className={styles.preset}
            >
              <strong>{style.name}</strong>
              <span>{style.description}</span>
              <span>Profiles: {style.profiles.map((profile) => profile.name).join(", ")}</span>
            </Button>
          ))}
        </div>
        <p>
          <Badge variant="success">{overrideCount} layout overrides protected</Badge>
        </p>
        {modified && (
          <p className={styles.warning}>
            Edits made to this project&rsquo;s house style will be replaced. Save them first to keep a reusable copy.
          </p>
        )}
        <h3>Review effective changes</h3>
        <ul className={styles.changeList}>
          {changes.length ? (
            changes.map((change) => <li key={change}>{change}</li>)
          ) : (
            <li>No effective layout values change.</li>
          )}
        </ul>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          onClick={() => {
            onCommit(next, `Applied ${selected.name} to all layouts; layout overrides preserved.`);
            onClose();
          }}
        >
          Apply {selected.name}
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

interface NewProfileProps {
  project: Project;
  sourceId: string;
  onClose: () => void;
  onCreate: (project: Project, id: string, message: string) => void;
}

export function NewProfileDialog({ project, sourceId, onClose, onCreate }: NewProfileProps) {
  const [source, setSource] = useState(sourceId);
  const [name, setName] = useState("");
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="New layout profile" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>
          Profiles are reusable print setups inside the house style, for example Study score or Large-print part.
        </p>
        <FormField label="Start from">
          <Select
            aria-label="Start from"
            value={source}
            options={project.style.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            onValueChange={setSource}
          />
        </FormField>
        <FormField label="Name">
          <FormInput
            aria-label="Profile name"
            placeholder="Study score"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          disabled={!name.trim()}
          onClick={() => {
            const created = duplicateProfile(project, source, name);
            onCreate(created.project, created.id, `Created the ${name.trim()} profile.`);
            onClose();
          }}
        >
          Create profile
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

interface TransferProps {
  project: Project;
  source: MockLayout;
  category: Category;
  onClose: () => void;
  onCommit: Commit;
}

export function TransferSettings({ project, source, category, onClose, onCommit }: TransferProps) {
  const [targets, setTargets] = useState<string[]>([]);
  const label = categoryDefinition(category).label.toLowerCase();
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title={`Copy ${label}`} onClose={onClose} />
      <DialogBody>
        <p>
          Copy effective {label} from <strong>{source.name}</strong> to:
        </p>
        <div className={styles.checkList}>
          {project.layouts
            .filter((layout) => layout.id !== source.id)
            .map((layout) => (
              <Checkbox
                key={layout.id}
                label={layout.name}
                checked={targets.includes(layout.id)}
                onChange={(event) =>
                  setTargets((current) =>
                    event.target.checked ? [...current, layout.id] : current.filter((id) => id !== layout.id),
                  )
                }
              />
            ))}
        </div>
        <p className={styles.warning}>
          These fields become explicit overrides on the selected layouts and stop following their profile. To change
          every layout on a profile, edit the profile in House Style instead.
        </p>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          disabled={!targets.length}
          onClick={() => {
            onCommit(
              copyCategory(project, source.id, targets, category),
              `Copied ${label} to ${targets.length} ${targets.length === 1 ? "layout" : "layouts"} as overrides.`,
            );
            onClose();
          }}
        >
          Copy settings
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

interface OverridesProps {
  project: Project;
  onClose: () => void;
  onInspect: (id: string, category: Category) => void;
  onCommit: Commit;
}

export function OverridesReview({ project, onClose, onInspect, onCommit }: OverridesProps) {
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title="Layout overrides" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>
          Only explicit style overrides are listed. Resetting a category never removes manual breaks or bracket
          decisions.
        </p>
        {project.layouts.map((layout) => (
          <section className={styles.overrideGroup} key={layout.id}>
            <h3>
              {layout.name} <Badge variant="muted">{findProfile(project, layout.profileId).name}</Badge>
            </h3>
            {Object.keys(layout.overrides).length === 0 && <p className={styles.hint}>Fully follows its profile.</p>}
            {CATEGORIES.filter((category) => category.fields.some(({ id }) => layout.overrides[id] !== undefined)).map(
              (category) => (
                <div className={styles.overrideRow} key={category.id}>
                  <div>
                    <strong>{category.label}</strong>
                    <p>
                      {category.fields
                        .filter(({ id }) => layout.overrides[id] !== undefined)
                        .map(({ id, label }) => `${label}: ${layout.overrides[id]}`)
                        .join(" / ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      onInspect(layout.id, category.id);
                      onClose();
                    }}
                  >
                    Inspect
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      onCommit(
                        clearCategory(project, { kind: "layout", id: layout.id }, category.id),
                        `${layout.name} now follows its profile for ${category.label.toLowerCase()}.`,
                      )
                    }
                  >
                    Use profile settings
                  </Button>
                </div>
              ),
            )}
          </section>
        ))}
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
