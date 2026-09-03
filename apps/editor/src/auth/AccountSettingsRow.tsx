import { SettingsRow } from "@viritura/ui";
import type { ReactNode } from "react";
import styles from "./AccountSettingsRow.module.css";

interface AccountSettingsRowProps {
  readonly label: string;
  readonly description: ReactNode;
  readonly action: ReactNode;
  readonly details?: ReactNode;
}

export function AccountSettingsRow({ label, description, action, details }: AccountSettingsRowProps) {
  return (
    <div className={styles.root}>
      <SettingsRow className={styles.row} label={label} description={description}>
        {action}
      </SettingsRow>
      {details ? <div className={styles.details}>{details}</div> : null}
    </div>
  );
}
