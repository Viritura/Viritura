import { Checkbox, FormField, PanelActionButton, Select, SettingsRow, Switch } from "@viritura/ui";
import { boundaryDescription, percent } from "./measurements";
import { usePaginationDebugStore, type PaginationCategories } from "./store";

const CATEGORIES: { key: keyof PaginationCategories; label: string }[] = [
  { key: "restWindows", label: "Rest time before and after turns" },
  { key: "pageCapacity", label: "Page capacity and density" },
  { key: "systemDensity", label: "System density and width scale" },
  { key: "alternatives", label: "Unselected system-end alternatives" },
  { key: "reasons", label: "Constraints, binding and planner status" },
];

export function PaginationDebugPanel() {
  const { enabled, categories, diagnostics, selectedSystem, setEnabled, toggleCategory, selectSystem } =
    usePaginationDebugStore();
  const selected = diagnostics?.systems.find((s) => s.systemIndex === selectedSystem);
  return (
    <>
      <SettingsRow
        label="Page and system overlay"
        description="Inspect page turns and layout density independently of the spacing overlay. Never printed or saved in the score."
      >
        {({ controlId, descriptionId }) => (
          <Switch id={controlId} aria-describedby={descriptionId} checked={enabled} onCheckedChange={setEnabled} />
        )}
      </SettingsRow>
      {CATEGORIES.map(({ key, label }) => (
        <SettingsRow key={key} label={label}>
          {({ controlId }) => (
            <Checkbox
              id={controlId}
              aria-label={label}
              checked={categories[key]}
              disabled={!enabled}
              onChange={() => toggleCategory(key)}
            />
          )}
        </SettingsRow>
      ))}
      <p>
        Green: comfortable. Amber: quick or tight. Red: no rest or a musical hazard. Times require every voice to rest.
      </p>
      {enabled && !diagnostics && (
        <p role="status">
          No page diagnostics in the current layout. Use a paged, automatically flowing layout; authored page layouts
          and horizon view are not supported.
        </p>
      )}
      {enabled && diagnostics && (
        <>
          <p role="status">
            {diagnostics.status}. {diagnostics.titlePage ? "Dedicated title page." : "No dedicated title page."}{" "}
            {diagnostics.measuredRepacking
              ? "Measured layout changed the planned membership."
              : "No measured membership change."}
          </p>
          <p>
            Page budget is measured before vertical justification; placed fill includes the final spacing. System
            density is natural width divided by rendered content width, not note count.
          </p>
          <details>
            <summary>Page capacity summary</summary>
            <ul>
              {diagnostics.pages.map((p) => (
                <li key={p.pageIndex}>
                  Page {p.pageIndex + 1}: {p.kind}
                  {p.kind === "music" && (
                    <>
                      ; capacity {Math.round(p.capacity)} engine px; budget {percent(p.contentHeight, p.capacity)},
                      placed {percent(p.placedHeight, p.capacity)}
                      {p.isFinalMusicPage ? "; final-page exemption" : ""}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
          <FormField label="Inspect system-end boundary">
            <Select
              aria-label="Inspect system-end boundary"
              value={selectedSystem === null ? "" : String(selectedSystem)}
              options={[
                { value: "", label: "Choose a boundary" },
                ...diagnostics.systems
                  .filter((s) => s.boundary)
                  .map((s) => ({
                    value: String(s.systemIndex),
                    label: `After bar ${s.lastMeasure + 1} / system ${s.systemIndex + 1}${s.physicalTurnAfter ? " (turn)" : s.pageBreakAfter ? " (facing page)" : ""}`,
                  })),
              ]}
              onValueChange={(value) => selectSystem(value === "" ? null : Number(value))}
            />
          </FormField>
          {selected && (
            <div role="status">
              <p>{boundaryDescription(selected)}</p>
              <p>
                System density: {percent(selected.naturalWidth, selected.availableWidth)}. Hypothetical physical-turn
                cost: {selected.boundary?.turnCost.toFixed(2)}.
              </p>
              <p>
                {selected.pageBreakAfter ? "Selected page break." : "Not selected as a page break."}{" "}
                {selected.plannedPageBreakAfter !== selected.pageBreakAfter
                  ? "Changed after the pre-measurement page plan."
                  : ""}
              </p>
              <p>
                Unselected boundaries are analysis opportunities, not proven feasible alternatives. This view does not
                yet rerun constrained plans or report rejected candidate rankings.
              </p>
            </div>
          )}
          <PanelActionButton
            onClick={() => {
              const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "page-system-diagnostics.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            Export diagnostics
          </PanelActionButton>
          <p>Bar labels are one-based written positions, including any pickup.</p>
          <p>Rest timing uses measure-entry tempo; tempo ramps and mid-measure changes are not interpolated.</p>
        </>
      )}
    </>
  );
}
