import { ChevronRight } from "lucide-react";
import { Badge } from "@viritura/ui";
import type { ResolvedTextStyle } from "@viritura/core";
import { TextStyleEditor } from "./TextStyleEditor";
import { previewStyleFor, roleLabel, summarize, type StyleField } from "./textStyleModel";
import styles from "./TextStylesPanel.module.css";

export interface TextStyleRowProps {
  role: string;
  style: ResolvedTextStyle;
  overridden: boolean;
  changed: readonly StyleField[];
  expanded: boolean;
  onToggle: () => void;
  onChange: <F extends StyleField>(field: F, value: ResolvedTextStyle[F]) => void;
  onReset: () => void;
}

/**
 * One role in the style list.
 *
 * The row previews itself: the role's name is drawn using that role's own
 * font, size, weight, slant and colour, so the list doubles as a specimen
 * sheet — the same trick a word processor's style gallery uses. Clicking a row
 * expands its formatting controls in place; a nested dialog would be the
 * obvious alternative but the House Style panel already provides the editing context.
 */
export function TextStyleRow({
  role,
  style,
  overridden,
  changed,
  expanded,
  onToggle,
  onChange,
  onReset,
}: TextStyleRowProps) {
  const label = roleLabel(role);
  const panelId = `text-style-${role}`;
  const previewStyle = previewStyleFor(style);

  return (
    <div className={styles.row} data-expanded={expanded ? "true" : undefined}>
      {/* eslint-disable-next-line no-restricted-syntax -- ListRow is a single-line
          leading/body/trailing row; this is a two-line type specimen whose body
          must wrap to its own font metrics, so the row chrome is bespoke. */}
      <button
        type="button"
        className={styles.rowHeader}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <ChevronRight size={14} className={styles.chevron} aria-hidden />

        <span className={styles.rowText}>
          {/* The preview carries the styling; the role name is repeated for
              assistive tech because font styling conveys nothing there. */}
          <span className={styles.preview} style={previewStyle} aria-hidden>
            {label}
          </span>
          <span className={styles.srOnly}>{label}</span>
          <span className={styles.summary}>{summarize(style)}</span>
        </span>

        {overridden && (
          <Badge variant="muted" className={styles.modifiedBadge}>
            Modified
          </Badge>
        )}
      </button>

      {expanded && (
        <div id={panelId} className={styles.rowBody}>
          <TextStyleEditor
            style={style}
            changed={changed}
            onChange={onChange}
            onReset={onReset}
            canReset={overridden}
          />
        </div>
      )}
    </div>
  );
}
