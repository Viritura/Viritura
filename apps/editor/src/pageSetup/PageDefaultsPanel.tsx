import { useState } from "react";
import { DEFAULT_PAGE_SETUP, DEFAULT_PART_PAGE_SETUP, type PageSetupRole } from "@viritura/core";
import { FormField, Select } from "@viritura/ui";
import { PageSetupDialog } from "../components/PageSetupDialog";
import { usePageDefaultsStore } from "./pageDefaultsStore";

export function PageDefaultsPanel() {
  const [role, setRole] = useState<PageSetupRole>("score");
  const defaults = usePageDefaultsStore((state) => state.defaults);
  const setDefault = usePageDefaultsStore((state) => state.setDefault);
  const builtIn = role === "score" ? DEFAULT_PAGE_SETUP : DEFAULT_PART_PAGE_SETUP;
  return (
    <PageSetupDialog
      key={role}
      embedded
      embeddedPreamble={
        <>
          <p>Defaults for new projects on this device. Existing projects keep their own settings.</p>
          <FormField label="Page defaults for">
            <Select
              aria-label="Page defaults for"
              value={role}
              options={[
                { value: "score", label: "Scores" },
                { value: "part", label: "Parts" },
              ]}
              onValueChange={(value) => {
                if (value === "score" || value === "part") setRole(value);
              }}
            />
          </FormField>
        </>
      }
      initialSetup={defaults[role] ?? builtIn}
      onApply={(setup) => setDefault(role, setup)}
      resetSetup={builtIn}
      onResetToDefault={() => setDefault(role, undefined)}
      resetLabel="Reset to app default"
      applyLabel="Save defaults"
    />
  );
}
