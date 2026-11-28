import { useState } from "react";
import type { Score } from "@viritura/core";
import { Button, CascadingMenu, FormField, PromptDialog, Select } from "@viritura/ui";
import { toast } from "sonner";
import {
  deleteLayoutProfile,
  layoutsUsingProfile,
  profilesForRole,
  renameLayoutProfile,
  resolvedPageSetup,
  scopeName,
  type ProfileScope,
} from "../../../../engraveStyle";
import { usePageDefaultsStore } from "../../../../pageSetup";
import { ConfirmationDialog } from "../../../ConfirmationDialog";
import { HouseStylePanel } from "../HouseStylePanel";
import { PageFieldRows } from "./PageFieldRows";
import { HouseStylePresetsDialog, NewProfileDialog } from "./StyleDialogs";
import { useStyleNavigation } from "./styleNavigation";
import { useStyleEditorStore } from "./styleEditorStore";
import styles from "./StyleEditor.module.css";

const NEW_PROFILE = "__new__";

function profileValue(profile: ProfileScope): string {
  return profile.id ?? `default-${profile.role}`;
}

interface HouseStyleModeProps {
  score: Score;
  scoreIndex: number;
}

/** Project-wide engraving defaults: score and part profiles plus every house style category. */
export function HouseStyleMode({ score, scoreIndex }: HouseStyleModeProps) {
  const nav = useStyleNavigation();
  const stored = useStyleEditorStore((state) => state.houseProfile);
  const done = useStyleEditorStore((state) => state.openLayout);
  const setDefault = usePageDefaultsStore((state) => state.setDefault);
  const [dialog, setDialog] = useState<"presets" | "new" | "rename" | "delete" | null>(null);
  const profiles = [...profilesForRole(score, "score"), ...profilesForRole(score, "part")];
  const profile = profiles.find((entry) => entry.role === stored.role && entry.id === stored.id) ?? profiles[0]!;
  const named = score.layoutProfiles?.find((entry) => entry.id === profile.id);
  const usage = layoutsUsingProfile(score, profile).length;
  const name = scopeName(score, profile);

  const saveAsDefaults = () => {
    setDefault("score", resolvedPageSetup(score, { kind: "profile", role: "score" }));
    setDefault("part", resolvedPageSetup(score, { kind: "profile", role: "part" }));
    toast.success("New projects will start with these Score and Part page settings.");
  };

  return (
    <div className={styles.panel} data-testid="house-style-mode">
      <div className={styles.modeHeader}>
        <span className={styles.modeTitle}>House style</span>
        <span className={styles.modeActions}>
          <Button size="sm" variant="ghost" onClick={() => setDialog("presets")}>
            Presets
          </Button>
          <CascadingMenu
            ariaLabel="More house style actions"
            label="More"
            tooltip="More house style actions"
            items={[{ id: "save-defaults", label: "Save as my defaults for new projects", onSelect: saveAsDefaults }]}
            triggerSize="sm"
            triggerFullWidth={false}
          />
          <Button size="sm" variant="primary" onClick={done}>
            Done
          </Button>
        </span>
      </div>
      <div className={styles.houseIntro}>
        <p className={styles.hint}>Changes here apply to every layout that has not customized the same setting.</p>
        <div className={styles.row}>
          <FormField label="Editing profile">
            <Select
              aria-label="Editing profile"
              value={profileValue(profile)}
              options={[
                ...profiles.map((entry) => ({
                  value: profileValue(entry),
                  label: `${scopeName(score, entry)}${entry.id ? ` (${entry.role === "part" ? "parts" : "scores"})` : ""}`,
                })),
                { value: NEW_PROFILE, label: "New profile" },
              ]}
              onValueChange={(value) => {
                if (value === NEW_PROFILE) {
                  setDialog("new");
                  return;
                }
                const next = profiles.find((entry) => profileValue(entry) === value);
                if (next) nav.openProfile(next);
              }}
            />
          </FormField>
          {named && (
            <CascadingMenu
              ariaLabel={`${name} profile actions`}
              label="Profile"
              tooltip={`Actions for the ${name} profile`}
              items={[
                { id: "rename", label: "Rename profile", onSelect: () => setDialog("rename") },
                { id: "delete", label: "Delete profile", onSelect: () => setDialog("delete") },
              ]}
              triggerSize="sm"
              triggerFullWidth={false}
            />
          )}
        </div>
        <p className={styles.hint}>
          {usage
            ? `Used by ${usage} ${usage === 1 ? "layout" : "layouts"}.`
            : named
              ? "Not used by any layout yet. Assign it from the Layout tab."
              : "Not used by any layout."}
        </p>
      </div>
      <HouseStylePanel pageScope={profile} pageSection={<PageFieldRows score={score} scope={profile} />} />

      {dialog === "presets" && (
        <HouseStylePresetsDialog score={score} nav={nav} scoreIndex={scoreIndex} onClose={() => setDialog(null)} />
      )}
      {dialog === "new" && (
        <NewProfileDialog score={score} nav={nav} initialRole={profile.role} onClose={() => setDialog(null)} />
      )}
      {named && (
        <PromptDialog
          open={dialog === "rename"}
          onClose={() => setDialog(null)}
          title="Rename profile"
          label="Profile name"
          initialValue={named.name}
          onSubmit={(value) => {
            if (!value.trim()) return false;
            nav.transform((current) => renameLayoutProfile(current, named.id, value));
            setDialog(null);
          }}
        />
      )}
      {named && (
        <ConfirmationDialog
          open={dialog === "delete"}
          title={`Delete the ${named.name} profile?`}
          message={
            usage
              ? `${usage} ${usage === 1 ? "layout uses" : "layouts use"} it and will follow the default ${profile.role} profile instead. Their custom settings stay.`
              : "No layouts use this profile."
          }
          confirmLabel="Delete profile"
          onConfirm={() => {
            setDialog(null);
            nav.transform((current) => deleteLayoutProfile(current, named.id), `Deleted the ${named.name} profile.`);
            nav.openProfile({ kind: "profile", role: profile.role });
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
