import { pageSetupRoleForScore, resolvePageTurnSettings, resolveScorePageSetup } from "@viritura/core";
import { Select, Tooltip } from "@viritura/ui";
import { useState } from "react";
import { useDocumentStore, useDocumentStoreApi } from "../../../../store/DocumentContext";
import { produce } from "../../../../score/scoreClone";

export function TitlePageControl({ scoreIndex }: { scoreIndex: number }) {
  const score = useDocumentStore((state) => state.score);
  const store = useDocumentStoreApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const definition = score?.scores?.[scoreIndex];
  if (
    !score ||
    !definition ||
    pageSetupRoleForScore(score.scores, scoreIndex, score.layouts, score.parts.length) !== "part"
  ) {
    return null;
  }
  const settings = resolvePageTurnSettings(resolveScorePageSetup(score, scoreIndex).pageTurns);
  const authored = Boolean(definition.pages?.length || definition.layoutBreaks?.length);
  const disabled = !settings.enabled || authored;
  const description = authored
    ? "Title-page planning is unavailable while this part has authored system or page breaks."
    : !settings.enabled
      ? "Enable page-turn optimization in House Style to plan a title page."
      : "Replan this part's page turns automatically, or with a title page required or excluded. Page geometry is unchanged.";

  const onChange = (value: string) => {
    if (value !== "auto" && value !== "always" && value !== "never") {
      throw new Error(`Unknown title-page choice: ${value}`);
    }
    const { workingScore, updateScore } = store.getState();
    if (!workingScore?.scores?.[scoreIndex]) return;
    const next = produce(workingScore, (draft) => {
      const selected = draft.scores![scoreIndex]!;
      selected.pageSetup ??= {};
      selected.pageSetup.pageTurns ??= { enabled: settings.enabled };
      selected.pageSetup.pageTurns.titlePage = value;
    });
    updateScore(next);
  };

  return (
    // The tooltip would overlap the option list and intercept clicks.
    <Tooltip content={description} open={menuOpen ? false : undefined}>
      <span>
        <Select
          onOpenChange={setMenuOpen}
          aria-label="Title page for this part"
          fullWidth={false}
          active={settings.titlePage !== "auto"}
          disabled={disabled}
          value={settings.titlePage}
          onValueChange={onChange}
          options={[
            { value: "auto", label: "Automatic", triggerLabel: "Title: Auto" },
            { value: "always", label: "On", triggerLabel: "Title: On" },
            { value: "never", label: "Off", triggerLabel: "Title: Off" },
          ]}
        />
      </span>
    </Tooltip>
  );
}
