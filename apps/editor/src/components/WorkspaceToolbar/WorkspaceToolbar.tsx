import styles from "./WorkspaceToolbar.module.css";
import type { WorkspaceToolbarGroupProps, WorkspaceToolbarProps } from "./types";

export function WorkspaceToolbar({ left, center, right }: WorkspaceToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>{left}</div>
      <div className={styles.center}>{center}</div>
      <div className={styles.right}>{right}</div>
    </div>
  );
}

export function WorkspaceToolbarGroup({ label, children }: WorkspaceToolbarGroupProps) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {children}
    </div>
  );
}
