import type { CSSProperties } from "react";
import { Checkbox, SectionLabel } from "@viritura/ui";
import { resolvePartDisplayNames, type Score } from "@viritura/core";
import { collectPartIdsInLayout } from "../../../../score/ScoreMutations";
import { instrumentNameDisplayLayoutIds } from "../../../parts/instrumentNameDisplay";
import { useDocumentStore } from "../../../../store/DocumentContext";

const ROOT_STYLE: CSSProperties = { display: "grid", gap: "var(--space-2)" };
const HELP_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
};

interface AutoHideEmptyStavesControlProps {
  score: Score;
  scoreIndex: number;
  onChange: (partIds: string[]) => void;
}

export function AutoHideEmptyStavesControl({ score, scoreIndex, onChange }: AutoHideEmptyStavesControlProps) {
  const workingSelection = useDocumentStore((state) => state.workingScore?.scores?.[scoreIndex]?.autoHideEmptyParts);
  const definition = score.scores?.[scoreIndex];
  if (!definition) return null;
  const layoutIds = instrumentNameDisplayLayoutIds(definition);
  const present = new Set(
    (score.layouts ?? [])
      .filter((layout) => layoutIds.has(layout.id))
      .flatMap((layout) => [...collectPartIdsInLayout(layout.content)]),
  );
  const names = resolvePartDisplayNames(score.parts);
  const selected = workingSelection ?? definition.autoHideEmptyParts ?? [];
  return (
    <div style={ROOT_STYLE} onClick={(event) => event.stopPropagation()}>
      <SectionLabel label="Auto-hide empty staves" />
      <p style={HELP_STYLE}>
        Selected instruments hide on rest-only systems in paged views, including the first. Music or markings on any
        staff keep the whole instrument visible. Shared staves stay visible unless all their instruments are selected
        and empty. At least one instrument remains visible.
      </p>
      {score.parts.map((part, index) =>
        part.id && present.has(part.id) ? (
          <Checkbox
            key={part.id}
            label={names[index]?.displayName ?? part.name}
            aria-label={`Auto-hide empty staves: ${names[index]?.displayName ?? part.name}`}
            checked={selected.includes(part.id)}
            onChange={(event) => {
              const id = part.id!;
              onChange(event.target.checked ? [...selected, id] : selected.filter((value) => value !== id));
            }}
          />
        ) : null,
      )}
    </div>
  );
}
