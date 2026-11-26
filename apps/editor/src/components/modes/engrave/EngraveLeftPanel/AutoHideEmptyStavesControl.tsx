import type { CSSProperties } from "react";
import { Button, Checkbox, SectionLabel } from "@viritura/ui";
import { pageSetupRoleForScore, resolvePartDisplayNames, type Score } from "@viritura/core";
import { partIdsInScoreView, type AutoHideEmptyStavesChange } from "../../../../score/ScoreMutations";
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
  onChange: (change: AutoHideEmptyStavesChange) => void;
}

export function AutoHideEmptyStavesControl({ score, scoreIndex, onChange }: AutoHideEmptyStavesControlProps) {
  const workingDefinition = useDocumentStore((state) => state.workingScore?.scores?.[scoreIndex]);
  const definition = workingDefinition ?? score.scores?.[scoreIndex];
  if (!definition) return null;
  const present = partIdsInScoreView(score, scoreIndex);
  const names = resolvePartDisplayNames(score.parts);
  const selected = definition.autoHideEmptyParts ?? [];
  const roleOf = (index: number) => pageSetupRoleForScore(score.scores, index, score.layouts, score.parts.length);
  const role = roleOf(scoreIndex);
  const sameRoleCount = (score.scores ?? []).filter((_, index) => roleOf(index) === role).length;
  return (
    <div style={ROOT_STYLE} onClick={(event) => event.stopPropagation()}>
      <SectionLabel label="Auto-hide empty staves" />
      <p style={HELP_STYLE}>
        Applies to this {role} view only. Selected instruments hide on rest-only systems in page view. Music or markings
        on any staff keep the whole instrument visible. Shared staves stay visible unless all their instruments are
        selected and empty. At least one instrument remains visible. Click a hidden staff&apos;s rail to keep it on that
        system.
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
              onChange({
                kind: "parts",
                partIds: event.target.checked ? [...selected, id] : selected.filter((value) => value !== id),
              });
            }}
          />
        ) : null,
      )}
      <Checkbox
        label="Show all staves on the first system"
        checked={definition.autoHideEmptyStaves?.firstSystem === "show"}
        onChange={(event) => onChange({ kind: "firstSystem", firstSystem: event.target.checked ? "show" : "hide" })}
      />
      {sameRoleCount > 1 ? (
        <Button size="sm" onClick={() => onChange({ kind: "applyToRole" })}>
          {role === "part" ? "Apply to all part views" : "Apply to all score views"}
        </Button>
      ) : null}
    </div>
  );
}
