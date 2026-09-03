import coverageMarkdown from "../../../../../docs/spec/music-notationref-coverage.md?raw";
import { describe, expect, it } from "vitest";
import { filterCoverageRows, statusForSurface } from "./coverageModel";
import { parseCoverageMarkdown } from "./parseCoverageMarkdown";

describe("music notation feature-support data", () => {
  const audit = parseCoverageMarkdown(coverageMarkdown);

  it("parses every notationref row and validates declared totals", () => {
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(new Set(audit.rows.map((row) => row.id)).size).toBe(audit.rows.length);
    expect(audit.groups.length).toBeGreaterThan(0);
    expect(audit.rows.filter((row) => row.partialReasons.virituraMnx)).toHaveLength(
      audit.summaries.virituraMnx.partial + audit.summaries.virituraMnx.unknown,
    );
    expect(audit.rows.filter((row) => row.partialReasons.virituraMxl)).toHaveLength(
      audit.summaries.virituraMxl.partial + audit.summaries.virituraMxl.unknown,
    );
    expect(audit.rows.find((row) => row.id === "note-ottava-22ma")?.partialReasons.virituraMxl?.kind).toBe(
      "Approximation",
    );
    expect(audit.rows.find((row) => row.id === "note-sounded-pitch")?.partialReasons).toEqual({});
    expect(audit.rows.find((row) => row.id === "event-pedal-sustain-up")?.concept).toBe("Sustain pedal up (*)");
    expect(audit.snapshot).toContain("Viritura source:");
    expect(audit.snapshot).not.toContain("This source-first audit");
  });

  it("filters by surface status and free text across groups", () => {
    const results = filterCoverageRows(audit.rows, {
      query: "quarter-tone",
      surface: "viritura-mxl",
      status: "N",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((row) => row.virituraMxl === "N")).toBe(true);
    expect(results.some((row) => row.id === "note-accidental-quarter-sharp")).toBe(true);

    const upstreamResults = filterCoverageRows(audit.rows, {
      query: "sounded pitch",
      surface: "musicxml",
      status: "P",
    });
    expect(upstreamResults.map((row) => row.id)).toContain("note-sounded-pitch");
    expect(upstreamResults.find((row) => row.id === "note-sounded-pitch")?.partialReasons).toEqual({});
  });

  it("selects statuses independently for all four filter surfaces", () => {
    const row = audit.rows.find((candidate) => candidate.id === "note-sounded-pitch")!;
    expect(statusForSurface(row, "mnx")).toBe("S");
    expect(statusForSurface(row, "musicxml")).toBe("P");
    expect(statusForSurface(row, "viritura-mnx")).toBe("S");
    expect(statusForSurface(row, "viritura-mxl")).toBe("S");
  });

  it("fails closed when the source table becomes incomplete", () => {
    const truncated = coverageMarkdown
      .split("\n")
      .filter((line) => !line.includes("`tab-display-note-spacing`"))
      .join("\n");
    expect(() => parseCoverageMarkdown(truncated)).toThrow(/Coverage summary .* does not match its \d+ detail rows/);
  });
});
