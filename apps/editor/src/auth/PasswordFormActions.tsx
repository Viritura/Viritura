import styles from "./AccountButton.module.css";
import { PASSWORD_FORM_ACTIONS_STYLE } from "./accountFormShared";

/**
 * Cancel / submit row shared across inline disclosure forms (password change, password set,
 * password remove, email change, delete account). Lives in its own file so non-component
 * helpers can sit in `accountFormShared.ts` without violating
 * `react-refresh/only-export-components`.
 */
export function PasswordFormActions({
  onCancel,
  submitting,
  submitLabel,
  danger = false,
}: {
  readonly onCancel: () => void;
  readonly submitting: boolean;
  readonly submitLabel: string;
  readonly danger?: boolean;
}) {
  return (
    <div style={PASSWORD_FORM_ACTIONS_STYLE}>
      {/* eslint-disable-next-line no-restricted-syntax -- inline cancel inside disclosure form; matches GitHubAdvancedUnlink confirm row. */}
      <button type="button" className={styles.linkAction} onClick={onCancel} disabled={submitting}>
        <span>Cancel</span>
      </button>
      {/* eslint-disable-next-line no-restricted-syntax -- inline submit inside disclosure form; matches GitHubAdvancedUnlink confirm row. */}
      <button
        type="submit"
        className={danger ? styles.linkActionDanger : styles.linkActionPrimary}
        disabled={submitting}
      >
        <span>{submitting ? "Saving…" : submitLabel}</span>
      </button>
    </div>
  );
}
