import assert from "node:assert/strict";
import test from "node:test";
import type { AuditRow, ConceptNode, FormatMatrix, UpstreamSnapshot } from "./update";
import { flattenConcepts, mergeAuditRows, updateAuditMarkdown } from "./update";

const currentRows: AuditRow[] = [
  {
    group: "Notes",
    subgroup: "Pitch",
    id: "pitch",
    name: "Pitch",
    mnx: "S",
    musicXml: "S",
    virituraMnx: "S",
    virituraMxl: "P",
    partialGap: "Viritura MXL [Subset]: Preserves `name` and \\_x.viritura (\\*)",
  },
  {
    group: "Old group",
    subgroup: "Old subgroup",
    id: "removed",
    name: "Removed",
    mnx: "N",
    musicXml: "S",
    virituraMnx: "N",
    virituraMxl: "N",
    partialGap: "-",
  },
];

const concepts: ConceptNode[] = [
  {
    type: "group",
    name: "Notes",
    items: [
      {
        type: "subgroup",
        name: "Pitches",
        items: [
          { type: "item", id: "pitch", name: "Pitched note" },
          { type: "item", id: "new-concept", name: "New concept" },
        ],
      },
    ],
  },
];

const matrix = (name: string, support: FormatMatrix["support"]): FormatMatrix => ({ name, support });
const snapshot: UpstreamSnapshot = {
  metadata: {
    taxonomyCommit: "1".repeat(40),
    mnxCommit: "2".repeat(40),
    musicXmlCommit: "3".repeat(40),
  },
  concepts,
  mnx: matrix("MNX", { pitch: { level: 2 }, "new-concept": { level: 3 }, orphan: { level: 1 } }),
  musicXml: matrix("MusicXML", { pitch: { level: 1 }, "new-concept": { level: 1 } }),
};

test("flattens nested notationref groups into stable row paths", () => {
  assert.deepEqual(flattenConcepts(concepts), [
    { group: "Notes", subgroup: "Pitches", id: "pitch", name: "Pitched note" },
    { group: "Notes", subgroup: "Pitches", id: "new-concept", name: "New concept" },
  ]);
});

test("escapes backslashes and table delimiters from upstream taxonomy text", () => {
  const specialSnapshot: UpstreamSnapshot = {
    ...snapshot,
    concepts: [
      {
        type: "group",
        name: "Notes",
        items: [
          {
            type: "subgroup",
            name: "Path \\ syntax",
            items: [{ type: "item", id: "pitch", name: "Pitch \\ marker | alternate" }],
          },
        ],
      },
    ],
    mnx: matrix("MNX", { pitch: { level: 1 } }),
    musicXml: matrix("MusicXML", { pitch: { level: 1 } }),
  };
  const markdown = `# Music Notation Reference coverage audit

<!-- notationref-audit-meta {"taxonomyCommit":"${"a".repeat(40)}","mnxCommit":"${"b".repeat(40)}","musicXmlCommit":"${"c".repeat(40)}","virituraCommit":"${"d".repeat(40)}","upstreamSyncedAt":"2026-01-01","virituraAuditedAt":"2026-01-01"} -->
> snapshot

This source-first audit is a fixture.

## Status legend and method

Fixture method.

## Summary

old summary

### Highest-confidence findings

- Keep this prose.

## Complete row audit

### Notes

| Subgroup | Concept | ID | MNX | MusicXML | Viritura MNX | Viritura MXL | Viritura partial gap |
| --- | --- | --- | :---: | :---: | :---: | :---: | --- |
| Pitch | Pitch | \`pitch\` | S | S | S | P | Viritura MXL [Subset]: Preserves semitone pitches |
`;
  const result = updateAuditMarkdown(markdown, specialSnapshot, { today: "2026-09-03" });
  assert.match(result.markdown, /Path \\\\ syntax/);
  assert.match(result.markdown, /Pitch \\\\ marker \\\| alternate/);
});

test("updates upstream-owned fields while preserving Viritura assessments", () => {
  const result = mergeAuditRows(currentRows, snapshot);
  assert.deepEqual(result.report, {
    added: ["new-concept"],
    removed: ["removed"],
    renamed: ["pitch"],
    moved: ["pitch"],
    upstreamStatusChanged: ["pitch"],
    matrixOnlyIds: { mnx: ["orphan"], musicXml: [] },
    matrixMissingIds: { mnx: [], musicXml: [] },
  });
  assert.deepEqual(result.rows[0], {
    ...currentRows[0],
    subgroup: "Pitches",
    name: "Pitched note",
    mnx: "P",
  });
  assert.equal(result.rows[1]?.virituraMnx, "?");
  assert.match(result.rows[1]?.partialGap ?? "", /Needs source audit/);
});

test("regenerates metadata, summaries, and detail rows without changing the Viritura revision", () => {
  const markdown = `# Music Notation Reference coverage audit

<!-- notationref-audit-meta {"taxonomyCommit":"${"a".repeat(40)}","mnxCommit":"${"b".repeat(40)}","musicXmlCommit":"${"c".repeat(40)}","virituraCommit":"${"d".repeat(40)}","upstreamSyncedAt":"2026-01-01","virituraAuditedAt":"2026-01-01"} -->
> old snapshot

This source-first audit is a fixture.

## Status legend and method

Fixture method.

## Summary

old summary

### Highest-confidence findings

- Keep this prose.

## Complete row audit

### Notes

| Subgroup | Concept | ID | MNX | MusicXML | Viritura MNX | Viritura MXL | Viritura partial gap |
| --- | --- | --- | :---: | :---: | :---: | :---: | --- |
| Pitch | Pitch | \`pitch\` | S | S | S | P | Viritura MXL [Subset]: Preserves \`name\` and \\_x.viritura (\\*) |
| Old | Removed | \`removed\` | N | S | N | N | - |
`;
  const result = updateAuditMarkdown(markdown.replace(/\n/g, "\r\n"), snapshot, { today: "2026-09-03" });
  assert.equal(result.metadata.virituraCommit, "d".repeat(40));
  assert.equal(result.metadata.upstreamSyncedAt, "2026-09-03");
  assert.match(result.markdown, /Keep this prose/);
  assert.match(result.markdown, /Viritura MXL \[Subset\]: Preserves `name` and \\_x\.viritura \(\\\*\)/);
  assert.match(result.markdown, /new-concept/);
  assert.doesNotMatch(result.markdown, /^> This source-first audit/m);
  assert.match(result.markdown, /This source-first audit is a fixture\.\n\n## Status legend and method/);

  const withManualSummaryNote = result.markdown.replace(
    "### Highest-confidence findings",
    "Manual summary note.\n\n### Highest-confidence findings",
  );
  const noOp = updateAuditMarkdown(withManualSummaryNote, snapshot, { today: "2026-09-04" });
  assert.equal(noOp.metadata.upstreamSyncedAt, "2026-09-03");
  assert.match(noOp.markdown, /Manual summary note/);
  assert.match(noOp.markdown, /Preserves `name` and \\_x\.viritura \(\\\*\)/);
});
