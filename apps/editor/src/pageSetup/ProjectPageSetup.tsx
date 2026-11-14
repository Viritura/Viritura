import { useState, type ReactNode } from "react";
import {
  defaultPageSetupForScore,
  pageSetupRoleForScore,
  resolveScorePageSetup,
  type PageSetup,
  type PageSetupRole,
  type Score,
} from "@viritura/core";
import { Checkbox, FormField, Select } from "@viritura/ui";
import { PageSetupDialog } from "../components/PageSetupDialog";
import { useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";
import { setProjectPageDefault } from "./projectDefaults";
import { usePageDefaultsStore } from "./pageDefaultsStore";

interface ProjectPageSetupProps {
  score: Score;
  scoreIndex: number;
  preamble: ReactNode;
  onApply: (setup: PageSetup) => void;
  onReset: () => void;
}

export function ProjectPageSetup({
  score: displayedScore,
  scoreIndex,
  preamble,
  onApply,
  onReset,
}: ProjectPageSetupProps) {
  const [scope, setScope] = useState<"current" | PageSetupRole>("current");
  const [replaceOverrides, setReplaceOverrides] = useState(false);
  const store = useDocumentStoreApi();
  const workingScore = useDocumentStore((state) => state.workingScore);
  const score = workingScore ?? displayedScore;
  const userDefaults = usePageDefaultsStore((state) => state.defaults);
  const role =
    scope === "current" ? pageSetupRoleForScore(score.scores, scoreIndex, score.layouts, score.parts.length) : scope;
  const builtIn = defaultPageSetupForScore([{ pageSetupRole: role }], 0);
  const projectDefault = score.pageSetupDefaults?.[role] ?? builtIn;
  const resetSetup = scope === "current" ? projectDefault : (userDefaults[role] ?? builtIn);
  const applyDefault = (setup: PageSetup) => {
    const { workingScore, updateScore } = store.getState();
    if (workingScore) updateScore(setProjectPageDefault(workingScore, role, setup, replaceOverrides));
  };
  return (
    <PageSetupDialog
      key={`${scoreIndex}-${scope}`}
      embedded
      embeddedPreamble={
        <>
          {preamble}
          <FormField label="Page setup for">
            <Select
              aria-label="Page setup for"
              value={scope}
              options={[
                { value: "current", label: score.scores?.[scoreIndex]?.name ?? "Current layout" },
                { value: "score", label: "Project score defaults" },
                { value: "part", label: "Project part defaults" },
              ]}
              onValueChange={(value) => {
                if (value !== "current" && value !== "score" && value !== "part") return;
                setScope(value);
                setReplaceOverrides(false);
              }}
            />
          </FormField>
          {scope === "current" ? (
            <p>
              {score.scores?.[scoreIndex]?.pageSetup
                ? "This layout has custom page settings."
                : `This layout uses the project ${role} defaults.`}
            </p>
          ) : (
            <>
              <p>
                Sets the project default for all {scope === "score" ? "scores" : "parts"}, including future layouts.
              </p>
              <Checkbox
                label="Replace custom layouts"
                checked={replaceOverrides}
                onChange={(event) => setReplaceOverrides(event.currentTarget.checked)}
              />
              <p>Custom page settings are preserved unless replacement is selected.</p>
            </>
          )}
        </>
      }
      initialSetup={scope === "current" ? resolveScorePageSetup(score, scoreIndex) : projectDefault}
      resetSetup={resetSetup}
      resetLabel={scope === "current" ? "Reset to document default" : "Use user default"}
      applyLabel={scope === "current" ? "Apply" : `Apply to all ${scope === "score" ? "scores" : "parts"}`}
      onApply={scope === "current" ? onApply : applyDefault}
      onResetToDefault={scope === "current" ? onReset : () => applyDefault(resetSetup)}
    />
  );
}
