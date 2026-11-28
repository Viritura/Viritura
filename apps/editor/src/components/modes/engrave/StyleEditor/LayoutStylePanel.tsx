import { useState, type ReactNode } from "react";
import type { PageSetupRole, Score } from "@viritura/core";
import { Button, Collapsible, FormField, Select } from "@viritura/ui";
import {
  assignLayoutProfile,
  clearLayoutOverrides,
  layoutOverrides,
  layoutProfileScope,
  profilesForRole,
  sameScope,
  scopeName,
  setLayoutRole,
  type PageScope,
} from "../../../../engraveStyle";
import { BarNumbersPanel } from "../HouseStylePanel/BarNumbersPanel";
import { PageTurnsPanel } from "../HouseStylePanel/PageTurnsPanel";
import { PageFieldRows } from "./PageFieldRows";
import { CopyPageSettingsDialog, OverridesReviewDialog } from "./StyleDialogs";
import { useStyleNavigation } from "./styleNavigation";
import styles from "./StyleEditor.module.css";

type Section = "page" | "bar-numbers" | "page-turns" | "systems";

interface LayoutStylePanelProps {
  score: Score;
  scoreIndex: number;
  /** Break, instrument-name, and staff-hiding controls for this layout. */
  systems: ReactNode;
}

function profileValue(scope: { role: PageSetupRole; id?: string }): string {
  return scope.id ?? `default-${scope.role}`;
}

/** Everything that shapes one score or part layout, with values inherited from its profile and the house style. */
export function LayoutStylePanel({ score, scoreIndex, systems }: LayoutStylePanelProps) {
  const nav = useStyleNavigation();
  const [open, setOpen] = useState<Record<Section, boolean>>({
    page: true,
    "bar-numbers": false,
    "page-turns": false,
    systems: true,
  });
  const [dialog, setDialog] = useState<"copy" | "review" | null>(null);
  const layout: PageScope = { kind: "layout", index: scoreIndex };
  const profile = layoutProfileScope(score, scoreIndex);
  const profiles = profilesForRole(score, profile.role);
  const overrides = layoutOverrides(score, scoreIndex);
  const name = scopeName(score, layout);
  const section = (id: Section, title: string, content: ReactNode) => (
    <Collapsible
      title={title}
      open={open[id]}
      onOpenChange={(next) => setOpen((current) => ({ ...current, [id]: next }))}
    >
      {content}
    </Collapsible>
  );

  return (
    <div className={styles.body} data-testid="layout-style-panel">
      <div className={styles.houseBar}>
        <div>
          House style
          <small>Shared by every layout in this project</small>
        </div>
        <Button size="sm" onClick={() => nav.openProfile(profile)}>
          Edit house style
        </Button>
      </div>

      <div className={styles.row}>
        <FormField label="Layout type">
          <Select
            aria-label="Layout type"
            value={profile.role}
            options={[
              { value: "score", label: "Score" },
              { value: "part", label: "Part" },
            ]}
            onValueChange={(value) => {
              if (value === "score" || value === "part")
                nav.transform((current) => setLayoutRole(current, scoreIndex, value));
            }}
          />
        </FormField>
        <FormField label="Profile">
          <Select
            aria-label="Layout profile"
            value={profileValue(profile)}
            options={profiles.map((entry) => ({ value: profileValue(entry), label: scopeName(score, entry) }))}
            onValueChange={(value) => {
              const next = profiles.find((entry) => profileValue(entry) === value);
              if (next && !sameScope(next, profile)) {
                nav.transform(
                  (current) => assignLayoutProfile(current, scoreIndex, next),
                  `${name} now uses the ${scopeName(score, next)} profile.`,
                );
              }
            }}
          />
        </FormField>
      </div>

      <div className={styles.summary}>
        <span>
          {overrides.total
            ? `${overrides.total} custom ${overrides.total === 1 ? "setting" : "settings"} on ${name}`
            : `${name} follows its profile and the house style`}
        </span>
        <span className={styles.summaryActions}>
          <Button size="sm" variant="ghost" onClick={() => setDialog("review")}>
            Review
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!overrides.total}
            tooltip="Remove this layout's custom page and bar number settings. Breaks stay."
            onClick={() =>
              nav.transform(
                (current) => clearLayoutOverrides(current, scoreIndex),
                `${name} now follows its profile and the house style.`,
              )
            }
          >
            Reset
          </Button>
        </span>
      </div>

      {section(
        "page",
        "Page",
        <>
          <PageFieldRows score={score} scope={layout} />
          <div className={styles.sectionActions}>
            <Button
              size="sm"
              variant="ghost"
              disabled={(score.scores?.length ?? 0) < 2}
              onClick={() => setDialog("copy")}
            >
              Copy page settings to layouts
            </Button>
          </div>
        </>,
      )}
      {section("bar-numbers", "Bar numbers", <BarNumbersPanel scope="layout" />)}
      {section("page-turns", "Page turns", <PageTurnsPanel scope={layout} />)}
      {section("systems", "Systems and breaks", systems)}

      {dialog === "copy" && (
        <CopyPageSettingsDialog score={score} nav={nav} sourceIndex={scoreIndex} onClose={() => setDialog(null)} />
      )}
      {dialog === "review" && <OverridesReviewDialog score={score} nav={nav} onClose={() => setDialog(null)} />}
    </div>
  );
}
