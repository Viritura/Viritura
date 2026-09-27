import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildImportErrorLog, ImportErrorLogDialog } from "../../importErrorLog";

const provenance = JSON.stringify({
  mnx: {
    version: 1,
    _x: {
      mnxdom: {
        client: { name: "denigma", version: "4.0.0", commit: "0426d4215db4" },
        mnxdom: { version: "3.1.0", commit: "ee14988" },
        source: { filename: "crumbfill.musx" },
      },
    },
  },
});

const recovered = buildImportErrorLog({
  filename: "crumbfill.mnx",
  mnxJson: provenance,
  now: new Date("2026-09-23T12:18:50Z"),
  recovered: [
    {
      logId: "E1",
      partIndex: 0,
      partId: "P1",
      measureIndex: 1,
      measureId: "m2",
      sequenceIndex: 0,
      staff: 1,
      voice: "s1layer1",
      discardedIds: ["ev16", "ev16n1"],
      errors: [
        {
          pointer: "/parts/0/measures/1/sequences/0/content/0/content",
          keyword: "tupletDuration",
          message:
            "tuplet content duration must equal its inner duration; use linked Viritura span fragments for a cross-barline tuplet",
        },
      ],
    },
  ],
});

const failed = buildImportErrorLog({
  filename: "legacy-score.mnx",
  mnxJson: "{}",
  now: new Date("2026-09-23T12:18:50Z"),
  recovered: [],
  failure: Object.assign(new Error("MNX schema validation failed"), {
    errors: [{ pointer: "(root)", keyword: "required", message: "must have required property 'mnx'" }],
  }),
});

const meta: Meta<typeof ImportErrorLogDialog> = {
  title: "App/Import Error Log",
  component: ImportErrorLogDialog,
  args: { onClose: () => {} },
};

export default meta;

export const RecoveredSequences: StoryObj<typeof ImportErrorLogDialog> = {
  args: { log: recovered },
  name: "Opened with emptied sequences",
};

export const ImportFailed: StoryObj<typeof ImportErrorLogDialog> = {
  args: { log: failed },
  name: "Import failed",
};
