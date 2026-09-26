import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveredSequence } from "@viritura/format";
import {
  buildImportErrorLog,
  buildImportIssueUrl,
  formatImportErrorLog,
  importErrorLogFilename,
  ImportErrorLogDialog,
} from "./index";

const entry: RecoveredSequence = {
  logId: "E1",
  partIndex: 0,
  partId: "P1",
  partName: "Flute",
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
      message: "tuplet content duration must equal its inner duration",
    },
  ],
};

const mnxJson = JSON.stringify({
  mnx: {
    version: 1,
    _x: {
      mnxdom: {
        client: { name: "denigma", version: "4.0.0" },
        source: { filename: "crumbfill.musx" },
      },
    },
  },
});

function recoveredLog() {
  return buildImportErrorLog({
    filename: "crumbfill.mnx",
    mnxJson,
    recovered: [entry],
    converterWarnings: ["A Finale-only detail was omitted."],
    now: new Date("2026-09-26T12:00:00Z"),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("import error log", () => {
  it("records provenance and every emptied sequence", () => {
    const text = formatImportErrorLog(recoveredLog());

    expect(text).toContain("Source file: crumbfill.musx");
    expect(text).toContain("Produced by: denigma 4.0.0");
    expect(text).toContain("[E1] Flute, measure 2 (m2), staff 1, voice s1layer1, sequence 1");
    expect(text).toContain("Discarded ids: ev16, ev16n1");
    expect(text).toContain("/parts/0/measures/1/sequences/0/content/0/content [tupletDuration]");
    expect(text).toContain("A Finale-only detail was omitted.");
  });

  it("lists validation errors when the file could not be opened", () => {
    const failure = Object.assign(new Error("MNX schema validation failed"), {
      errors: [{ pointer: "", keyword: "required", message: "must have required property 'mnx'" }],
    });
    const log = buildImportErrorLog({ filename: "broken.mnx", mnxJson: "{}", recovered: [], failure });

    expect(log.status).toBe("failed");
    expect(formatImportErrorLog(log)).toContain("/ [required] must have required property 'mnx'");
  });

  it("builds a prefilled bug report and a download filename", () => {
    const log = recoveredLog();
    const url = new URL(buildImportIssueUrl(log));

    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Viritura/Viritura/issues/new");
    expect(url.searchParams.get("template")).toBe("bug.yml");
    expect(url.searchParams.get("title")).toBe("[Bug]: Import error in crumbfill.musx");
    expect(url.searchParams.get("evidence")).toContain("[E1]");
    expect(importErrorLogFilename(log)).toBe("crumbfill-import-log.txt");
  });

  it("truncates long logs in the issue URL", () => {
    const url = new URL(buildImportIssueUrl(recoveredLog(), "x".repeat(20_000)));

    expect(url.searchParams.get("evidence")!.length).toBeLessThan(5_200);
  });

  it("shows the log with download and report actions", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onClose = vi.fn();
    render(<ImportErrorLogDialog log={recoveredLog()} onClose={onClose} />);

    expect(screen.getByText("Imported with errors")).toBeTruthy();
    expect(screen.getByTestId("import-error-log").textContent).toContain("[E1]");
    fireEvent.click(screen.getByText("Report issue on GitHub"));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/Viritura/Viritura/issues/new?"),
      "_blank",
      "noopener,noreferrer",
    );
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
