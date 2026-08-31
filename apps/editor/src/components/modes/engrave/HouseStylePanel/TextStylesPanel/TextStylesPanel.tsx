import { useCallback, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@viritura/ui";
import type { ResolvedTextStyle, TextStyles } from "@viritura/core";
import { useDocumentStore } from "../../../../../store/DocumentContext";
import { TextStyleRow } from "./TextStyleRow";
import {
  ROLE_ORDER,
  changedFields,
  effectiveStyle,
  isOverridden,
  resetRole,
  setStyleField,
  type StyleField,
} from "./textStyleModel";
import styles from "./TextStylesPanel.module.css";

/**
 * Per-score typography, edited as controls rather than raw JSON.
 *
 * Every role is listed with a live specimen of itself; expanding one reveals
 * the formatting controls. Edits apply to the score immediately so the visible
 * Engrave canvas provides direct feedback.
 *
 * Only genuine differences from the engine defaults are written back (see
 * `setStyleField`), so a score that has never been restyled carries no
 * `textStyles` data at all.
 */
export function TextStylesPanel() {
  const score = useDocumentStore((s) => s.score);
  const updateScore = useDocumentStore((s) => s.updateScore);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const textStyles = score?.textStyles;

  const commit = useCallback(
    (next: TextStyles) => {
      if (!score) return;
      updateScore({ ...score, textStyles: next });
    },
    [score, updateScore],
  );

  const handleChange = useCallback(
    <F extends StyleField>(role: string, field: F, value: ResolvedTextStyle[F]) => {
      commit(setStyleField(textStyles, role, field, value));
    },
    [commit, textStyles],
  );

  const overriddenRoles = useMemo(() => ROLE_ORDER.filter((role) => isOverridden(role, textStyles)), [textStyles]);

  if (!score) {
    return <p className={styles.empty}>Open a score to edit its text styles.</p>;
  }

  return (
    <>
      <div className={styles.intro}>
        <p className={styles.introText}>
          Sizes are in staff spaces, so text scales with the score rather than being pinned to a point size. Previews
          show each role as it will print.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={overriddenRoles.length === 0}
          onClick={() => commit({})}
          tooltip="Restore every role to the engine defaults"
        >
          <RotateCcw size={13} />
          Reset all
        </Button>
      </div>

      <div className={styles.list}>
        {ROLE_ORDER.map((role) => (
          <TextStyleRow
            key={role}
            role={role}
            style={effectiveStyle(role, textStyles)}
            overridden={isOverridden(role, textStyles)}
            changed={changedFields(role, textStyles)}
            expanded={expandedRole === role}
            onToggle={() => setExpandedRole((current) => (current === role ? null : role))}
            onChange={(field, value) => handleChange(role, field, value)}
            onReset={() => commit(resetRole(textStyles, role))}
          />
        ))}
      </div>
    </>
  );
}
