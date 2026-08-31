import { useMemo, useState, type CSSProperties } from "react";
import type { Part, PartDisplayInfo, Score } from "@viritura/core";
import {
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormInput,
} from "@viritura/ui";
import { FAMILY_META, type InstrumentFamily } from "../../score/InstrumentCatalog";
import { collectPartIdsInLayout } from "../../score/ScoreMutations";

export type ScoreMembershipMode = "section" | "manage";

export interface ScoreMembershipDialogProps {
  open: boolean;
  mode: ScoreMembershipMode;
  score: Score;
  partDisplayMap: Map<string, PartDisplayInfo>;
  /** Score index being managed (manage mode only). */
  scoreIndex?: number;
  onClose: () => void;
  /** Section mode: create a new score from the chosen parts. */
  onCreateSection?: (partIds: string[], name: string) => void;
  /** Manage mode: set the score's membership to the chosen parts. */
  onSetMembership?: (scoreIndex: number, partIds: string[]) => void;
}

const LABEL_STYLE: CSSProperties = {
  display: "block",
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 4,
};
const FAMILY_HEADING_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "10px 0 4px",
};
const CHECK_LIST_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, paddingLeft: 4 };
const NAME_FIELD_STYLE: CSSProperties = { marginBottom: 8 };
const EMPTY_STYLE: CSSProperties = { fontSize: "var(--type-small-size)", color: "var(--text-muted)", padding: "8px 0" };

/** Family bucket order used to group the checklist. */
function familyOf(part: Part): InstrumentFamily | "other" {
  const fam = part._x?.viritura?.family as InstrumentFamily | undefined;
  return fam && fam in FAMILY_META ? fam : "other";
}

function familyOrder(fam: InstrumentFamily | "other"): number {
  return fam === "other" ? 99 : FAMILY_META[fam].order;
}

function familyLabel(fam: InstrumentFamily | "other"): string {
  return fam === "other" ? "Other" : FAMILY_META[fam].label;
}

interface FamilyBucket {
  family: InstrumentFamily | "other";
  label: string;
  parts: Part[];
}

/** Resolve the layout a managed score renders (top-level or first page). */
function managedLayoutId(score: Score, scoreIndex: number | undefined): string | undefined {
  if (scoreIndex === undefined) return undefined;
  const sd = score.scores?.[scoreIndex];
  return sd?.layout ?? sd?.pages?.[0]?.systems?.[0]?.layout;
}

/** Initial checked set: current membership in manage mode, empty in section mode. */
function initialChecked(mode: ScoreMembershipMode, score: Score, scoreIndex: number | undefined): Set<string> {
  if (mode !== "manage") return new Set();
  const layoutId = managedLayoutId(score, scoreIndex);
  const layout = layoutId ? (score.layouts ?? []).find((l) => l.id === layoutId) : undefined;
  return layout ? new Set(collectPartIdsInLayout(layout.content)) : new Set();
}

/** Group the score's parts (in document order) into family buckets. */
function buildBuckets(parts: readonly Part[]): FamilyBucket[] {
  const byFamily = new Map<InstrumentFamily | "other", Part[]>();
  for (const p of parts) {
    if (!p.id) continue;
    const fam = familyOf(p);
    const list = byFamily.get(fam) ?? [];
    list.push(p);
    byFamily.set(fam, list);
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => familyOrder(a) - familyOrder(b))
    .map(([family, parts]) => ({ family, label: familyLabel(family), parts }));
}

/**
 * Pick-instruments dialog used to (a) create a new section score from a subset
 * of parts, or (b) manage an existing score's instrument membership. Parts are
 * grouped by family with a checkbox each; manage mode pre-checks the parts the
 * score already contains.
 */
export function ScoreMembershipDialog({
  open,
  mode,
  score,
  partDisplayMap,
  scoreIndex,
  onClose,
  onCreateSection,
  onSetMembership,
}: ScoreMembershipDialogProps) {
  const [checked, setChecked] = useState<Set<string>>(() => initialChecked(mode, score, scoreIndex));
  const [name, setName] = useState(() =>
    mode === "manage" && scoreIndex !== undefined ? (score.scores?.[scoreIndex]?.name ?? "") : "",
  );

  const buckets = useMemo(() => buildBuckets(score.parts), [score.parts]);

  const toggle = (partId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  };

  const handleConfirm = () => {
    const partIds = [...checked];
    if (mode === "section") onCreateSection?.(partIds, name);
    else if (scoreIndex !== undefined) onSetMembership?.(scoreIndex, partIds);
    onClose();
  };

  const title = mode === "section" ? "New Section Score" : "Manage Instruments";
  const confirmLabel = mode === "section" ? "Create" : "Apply";
  const canConfirm = mode === "section" ? checked.size > 0 : true;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        {mode === "section" && (
          <div style={NAME_FIELD_STYLE}>
            <label style={LABEL_STYLE} htmlFor="section-score-name">
              Score name
            </label>
            <FormInput
              id="section-score-name"
              value={name}
              placeholder="Section Score"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <span style={LABEL_STYLE}>Instruments</span>
        {buckets.length === 0 ? (
          <div style={EMPTY_STYLE}>No instruments in this document.</div>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.family}>
              <div style={FAMILY_HEADING_STYLE}>{bucket.label}</div>
              <div style={CHECK_LIST_STYLE}>
                {bucket.parts.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={partDisplayMap.get(p.id!)?.displayName ?? p.name}
                    checked={checked.has(p.id!)}
                    onChange={() => toggle(p.id!)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton onClick={onClose} />
        <DialogPrimaryButton onClick={handleConfirm} disabled={!canConfirm}>
          {confirmLabel}
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
