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
} from "@viritura/ui";
import {
  adoptPreset,
  CATEGORIES,
  clearCategory,
  copyCategory,
  resolveField,
  type Category,
  type MockLayout,
  type Project,
  type StylePreset,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

interface LibraryProps {
  project: Project;
  presets: StylePreset[];
  onClose: () => void;
  onCommit: (project: Project, message: string) => void;
  onSave: (preset: StylePreset) => void;
}

export function StyleLibrary({ project, presets, onClose, onCommit, onSave }: LibraryProps) {
  const [selectedId, setSelectedId] = useState(project.adopted.id);
  const [preserve, setPreserve] = useState(true);
  const [name, setName] = useState("");
  const selected = presets.find((preset) => preset.id === selectedId)!;
  const next = adoptPreset(project, selected, preserve);
  const changes = project.layouts.flatMap((layout) =>
    CATEGORIES.flatMap((category) =>
      category.fields.flatMap(({ id, label }) => {
        const before = resolveField(project, "layout", layout, id).value;
        const after = resolveField(next, "layout", layout, id).value;
        return before === after ? [] : [`${layout.name}: ${label} ${before} -> ${after}`];
      }),
    ),
  );
  const overrideCount = project.layouts.reduce((total, layout) => total + Object.keys(layout.overrides).length, 0);
  function save() {
    const preset: StylePreset = {
      id: `saved-${presets.length}`,
      name: name.trim(),
      description: "Saved from this mock project's reusable defaults.",
      common: { ...project.adopted.common, ...project.adjustments.common },
      score: { ...project.adopted.score, ...project.adjustments.score },
      part: { ...project.adopted.part, ...project.adjustments.part },
    };
    onSave(preset);
    setSelectedId(preset.id);
    setName("");
  }
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title="House-style library" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>
          Adopt a snapshot into this project. Library edits never change existing projects automatically.
        </p>
        <div className={styles.libraryGrid}>
          {presets.map((preset) => (
            <Button
              key={preset.id}
              active={selectedId === preset.id}
              onClick={() => setSelectedId(preset.id)}
              className={styles.preset}
            >
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </Button>
          ))}
        </div>
        <Checkbox
          label="Preserve project adjustments"
          checked={preserve}
          onChange={(event) => setPreserve(event.target.checked)}
        />
        <p>
          <Badge variant="success">{overrideCount} layout overrides protected</Badge>
        </p>
        {!preserve && (
          <p className={styles.warning}>
            Project Common, Scores and Parts adjustments will be cleared. Individual layout overrides and manual
            decisions are still preserved.
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
        <div className={styles.saveStyle}>
          <FormField label="Save project defaults as a reusable style">
            <FormInput
              aria-label="New house-style name"
              placeholder="My concert style"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <Button disabled={!name.trim()} onClick={save}>
            Save snapshot
          </Button>
        </div>
        <p className={styles.hint}>
          Saved styles live only in this prototype session. Layout overrides, bracket selections and manual breaks are
          excluded.
        </p>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          onClick={() => {
            onCommit(next, `Adopted ${selected.name}; layout overrides preserved.`);
            onClose();
          }}
        >
          Adopt {selected.name}
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
  onCommit: (project: Project, message: string) => void;
}

export function TransferSettings({ project, source, category, onClose, onCommit }: TransferProps) {
  const [targets, setTargets] = useState<string[]>([]);
  const label = CATEGORIES.find((entry) => entry.id === category)!.label;
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title={`Copy ${label.toLowerCase()}`} onClose={onClose} />
      <DialogBody>
        <p>
          Copy effective {label.toLowerCase()} from <strong>{source.name}</strong> to:
        </p>
        <div className={styles.checkList}>
          {project.layouts
            .filter((layout) => layout.id !== source.id)
            .map((layout) => (
              <Checkbox
                key={layout.id}
                label={layout.name}
                checked={targets.includes(layout.id)}
                onChange={(event) => {
                  setTargets((current) =>
                    event.target.checked ? [...current, layout.id] : current.filter((id) => id !== layout.id),
                  );
                }}
              />
            ))}
        </div>
        <p className={styles.warning}>
          These fields become explicit overrides, replacing existing overrides in this category on selected layouts.
          They stop following project defaults.
        </p>
        <p className={styles.hint}>Other categories, specific bracket placement and manual breaks are unchanged.</p>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          disabled={!targets.length}
          onClick={() => {
            onCommit(
              copyCategory(project, source.id, targets, category),
              `Copied ${label.toLowerCase()} to ${targets.length} ${targets.length === 1 ? "layout" : "layouts"} as explicit overrides.`,
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
  onCommit: (project: Project, message: string) => void;
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
              {layout.name} <Badge variant="muted">{layout.role === "score" ? "Score" : "Part"}</Badge>
            </h3>
            {Object.keys(layout.overrides).length === 0 && <p className={styles.hint}>Fully follows project style.</p>}
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
                        clearCategory(project, "layout", layout.id, category.id),
                        `${layout.name} now follows project ${category.label.toLowerCase()}.`,
                      )
                    }
                  >
                    Use project settings
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
