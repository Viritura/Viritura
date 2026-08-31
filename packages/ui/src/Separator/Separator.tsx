import styles from "./Separator.module.css";

export interface SeparatorProps {
  /** Orientation: vertical (toolbar) or horizontal (menu/list) */
  orientation?: "vertical" | "horizontal";
  /** Additional className */
  className?: string;
}

export function Separator({ orientation = "vertical", className }: SeparatorProps) {
  const classNames = [styles[orientation], className ?? ""].filter(Boolean).join(" ");

  return <div className={classNames} role="separator" />;
}
