import type { ReactNode } from "react";

export interface NavListItem {
  /** Stable identifier, also used as the selection value. */
  id: string;
  /** Row label. */
  label: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional trailing content (count, badge). */
  trailing?: ReactNode;
  /** Disable selection for this row. Disabled rows are skipped by arrow keys. */
  disabled?: boolean;
}

export interface NavListGroup {
  /** Stable identifier for the group. */
  id: string;
  /** Group heading. Omit for an ungrouped run of items at the top. */
  label?: string;
  /** Optional icon shown beside the group heading. */
  icon?: ReactNode;
  items: NavListItem[];
}
