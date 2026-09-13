import type { ReactNode } from "react";

export interface WorkspaceToolbarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export interface WorkspaceToolbarGroupProps {
  label: string;
  children: ReactNode;
}
