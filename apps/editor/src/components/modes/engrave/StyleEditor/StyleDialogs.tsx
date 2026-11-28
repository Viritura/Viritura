import { useState } from "react";
import type { PageSetupRole, Score } from "@viritura/core";
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
  HOUSE_STYLE_PRESETS,
  PAGE_FIELDS,
  applyHouseStylePreset,
  clearLayoutOverrides,
  copyPageFields,
  createLayoutProfile,
  layoutOverrides,
  profilesForRole,
  resolvedPageSetup,
  roleLabel,
  scopeName,
  type HouseStylePresetId,
  type PageScope,
  type ProfileScope,
} from "../../../../engraveStyle";
import type { StyleNavigation } from "./pageFieldView";
import styles from "./StyleEditor.module.css";

interface DialogBaseProps {
  score: Score;
  nav: StyleNavigation;
  onClose: () => void;
}

function layoutIndexes(score: Score): number[] {
  return (score.scores ?? []).map((_, index) => index);
}

function effectivePageChanges(before: Score, after: Score): string[] {
  return layoutIndexes(before).flatMap((index) => {
    const scope: PageScope = { kind: "layout", index };
    const name = scopeName(before, scope);
    return PAGE_FIELDS.flatMap((field) => {
      const from = field.format(resolvedPageSetup(before, scope));
      const to = field.format(resolvedPageSetup(after, scope));
      return from === to ? [] : [`${name}: ${field.label} ${from} to ${to}`];
    });
  });
}

function customSettingCount(score: Score): number {
  return layoutIndexes(score).reduce((total, index) => total + layoutOverrides(score, index).total, 0);
}

export function HouseStylePresetsDialog({ score, nav, scoreIndex, onClose }: DialogBaseProps & { scoreIndex: number }) {
  const [selectedId, setSelectedId] = useState<HouseStylePresetId>("classical");
  const selected = HOUSE_STYLE_PRESETS.find((preset) => preset.id === selectedId) ?? HOUSE_STYLE_PRESETS[0]!;
  const next = applyHouseStylePreset(score, selected.id, scoreIndex);
  const changes = effectivePageChanges(score, next);
  const kept = customSettingCount(score);
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title="House style presets" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>
          A preset sets the Score and Part profiles, bar numbers, and time signatures for this project.
        </p>
        <div className={styles.presetGrid}>
          {HOUSE_STYLE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              active={selectedId === preset.id}
              onClick={() => setSelectedId(preset.id)}
              className={styles.preset}
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </Button>
          ))}
        </div>
        <p>
          <Badge variant="success">
            {kept} custom layout {kept === 1 ? "setting" : "settings"} kept
          </Badge>
        </p>
        <p className={styles.warning}>
          House style values are replaced. Named profiles, custom layout settings, and manual breaks stay. You can undo
          this change.
        </p>
        {changes.length ? (
          <details>
            <summary>
              {changes.length} page {changes.length === 1 ? "change" : "changes"}
            </summary>
            <ul>
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </details>
        ) : (
          <p className={styles.hint}>No page changes.</p>
        )}
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          onClick={() => {
            nav.transform(
              (current) => applyHouseStylePreset(current, selected.id, scoreIndex),
              `Applied the ${selected.label} house style. Custom layout settings stayed.`,
            );
            onClose();
          }}
        >
          Apply {selected.label}
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

function profileKey(profile: ProfileScope): string {
  return `${profile.role}:${profile.id ?? ""}`;
}

export function NewProfileDialog({
  score,
  nav,
  initialRole,
  onClose,
}: DialogBaseProps & { initialRole: PageSetupRole }) {
  const [role, setRole] = useState<PageSetupRole>(initialRole);
  const [name, setName] = useState("");
  const sources = profilesForRole(score, role);
  const [sourceKey, setSourceKey] = useState(profileKey(sources[0]!));
  const source = sources.find((profile) => profileKey(profile) === sourceKey) ?? sources[0]!;
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = createLayoutProfile(score, role, trimmed, source);
    nav.transform(() => created.score, `Created the ${trimmed} profile.`);
    nav.openProfile(created.profile);
    onClose();
  };
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="New layout profile" onClose={onClose} />
      <DialogBody>
        <div className={styles.dialogForm}>
          <FormField label="Name">
            <FormInput
              aria-label="Profile name"
              placeholder="Study score"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") create();
              }}
            />
          </FormField>
          <FormField label="Used for">
            <Select
              aria-label="Used for"
              value={role}
              options={[
                { value: "score", label: "Scores" },
                { value: "part", label: "Parts" },
              ]}
              onValueChange={(value) => {
                if (value !== "score" && value !== "part") return;
                setRole(value);
                setSourceKey(profileKey({ kind: "profile", role: value }));
              }}
            />
          </FormField>
          <FormField label="Start from">
            <Select
              aria-label="Start from"
              value={profileKey(source)}
              options={sources.map((profile) => ({ value: profileKey(profile), label: scopeName(score, profile) }))}
              onValueChange={setSourceKey}
            />
          </FormField>
          <p className={styles.hint}>
            The new {roleLabel(role).toLowerCase()} profile copies the values set on the profile it starts from. Assign
            it to a layout from the Layout tab.
          </p>
        </div>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton disabled={!name.trim()} onClick={create}>
          Create profile
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}

export function CopyPageSettingsDialog({
  score,
  nav,
  sourceIndex,
  onClose,
}: DialogBaseProps & { sourceIndex: number }) {
  const [targets, setTargets] = useState<number[]>([]);
  const source: PageScope = { kind: "layout", index: sourceIndex };
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="Copy page settings" onClose={onClose} />
      <DialogBody>
        <p>
          Copy the page size, staff size, margins, and page turns of <strong>{scopeName(score, source)}</strong> to:
        </p>
        <div className={styles.checkList}>
          {layoutIndexes(score)
            .filter((index) => index !== sourceIndex)
            .map((index) => (
              <Checkbox
                key={index}
                label={scopeName(score, { kind: "layout", index })}
                checked={targets.includes(index)}
                onChange={(event) =>
                  setTargets((current) =>
                    event.target.checked ? [...current, index] : current.filter((entry) => entry !== index),
                  )
                }
              />
            ))}
        </div>
        <p className={styles.warning}>
          Copied values become custom settings on each layout and stop following its profile. To change every layout
          that shares a profile, edit the profile instead.
        </p>
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <DialogPrimaryButton
          disabled={!targets.length}
          onClick={() => {
            nav.transform(
              (current) => copyPageFields(current, source, targets, PAGE_FIELDS),
              `Copied page settings to ${targets.length} ${targets.length === 1 ? "layout" : "layouts"}.`,
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

export function OverridesReviewDialog({ score, nav, onClose }: DialogBaseProps) {
  const custom = layoutIndexes(score)
    .map((index) => ({ index, summary: layoutOverrides(score, index) }))
    .filter(({ summary }) => summary.total > 0);
  return (
    <Dialog open onClose={onClose} size="wide">
      <DialogHeader title="Custom layout settings" onClose={onClose} />
      <DialogBody>
        <p className={styles.hint}>
          These layouts set values of their own instead of following their profile or the house style. Resetting keeps
          manual breaks and staff visibility.
        </p>
        {!custom.length && <p className={styles.hint}>Every layout follows its profile and the house style.</p>}
        {custom.map(({ index, summary }) => {
          const layout: PageScope = { kind: "layout", index };
          const details = [...summary.page, ...(summary.barNumbers ? [`Bar numbers (${summary.barNumbers})`] : [])];
          return (
            <section className={styles.overrideGroup} key={index}>
              <div className={styles.overrideRow}>
                <div>
                  <strong>{scopeName(score, layout)}</strong>
                  <p>{details.join(" / ")}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    nav.openLayout(index);
                    onClose();
                  }}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    nav.transform(
                      (current) => clearLayoutOverrides(current, index),
                      `${scopeName(score, layout)} now follows its profile and the house style.`,
                    )
                  }
                >
                  Reset
                </Button>
              </div>
            </section>
          );
        })}
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
