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
  PRESETS,
  resolveLayout,
  type Category,
  type MockLayout,
  type Project,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

type Commit = (project: Project, message: string) => void;

interface StylePresetsProps {
  project: Project;
  modified: boolean;
  onClose: () => void;
  onCommit: Commit;
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

export function StylePresets({ project, modified, onClose, onCommit }: StylePresetsProps) {
  const [selectedId, setSelectedId] = useState(project.origin.id);
  const selected = PRESETS.find((style) => style.id === selectedId);
  if (!selected) throw new Error(`Unknown house style preset: ${selectedId}`);
  const next = adoptStyle(project, selected);
  const changes = effectiveChanges(project, next);
  const overrideCount = project.layouts.reduce((total, layout) => total + Object.keys(layout.overrides).length, 0);
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title="House style presets" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>Each preset includes score and part profiles.</p>
        <div className={styles.presetGrid}>
          {PRESETS.map((style) => (
            <Button
              key={style.id}
              active={selectedId === style.id}
              onClick={() => setSelectedId(style.id)}
              className={styles.preset}
            >
              <strong>{style.name}</strong>
              <span>{style.description}</span>
            </Button>
          ))}
        </div>
        <p>
          <Badge variant="success">{overrideCount} overrides preserved</Badge>
        </p>
        {modified && (
          <p className={styles.warning}>
            Your house style edits and profiles will be replaced. You can undo this change.
          </p>
        )}
        {changes.length ? (
          <details>
            <summary>{changes.length} effective changes</summary>
            <ul className={styles.changeList}>
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </details>
        ) : (
          <p className={styles.hint}>No effective changes.</p>
        )}
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
        <p className={styles.warning}>Copied settings become overrides and no longer follow the profile.</p>
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
        <p className={styles.hint}>Resetting overrides preserves manual breaks and bracket decisions.</p>
        {project.layouts.every((layout) => Object.keys(layout.overrides).length === 0) && (
          <p className={styles.hint}>No overrides.</p>
        )}
        {project.layouts
          .filter((layout) => Object.keys(layout.overrides).length > 0)
          .map((layout) => (
            <section className={styles.overrideGroup} key={layout.id}>
              <h3>
                {layout.name} <Badge variant="muted">{findProfile(project, layout.profileId).name}</Badge>
              </h3>
              {CATEGORIES.filter((category) =>
                category.fields.some(({ id }) => layout.overrides[id] !== undefined),
              ).map((category) => (
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
              ))}
            </section>
          ))}
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
