import { forwardRef, type ReactNode } from "react";
import styles from "./Section.module.css";

export interface SectionProps {
  /** Section title (renders as a <legend>) */
  title?: string;
  /** Whether this section should display the focus ring */
  focused?: boolean;
  /** Visual variant */
  variant?: "raised" | "inset";
  /** Section content */
  children: ReactNode;
  /** Additional className */
  className?: string;
}

export const Section = forwardRef<HTMLFieldSetElement, SectionProps>(function Section(
  { title, focused = false, variant = "raised", children, className },
  ref,
) {
  const classNames = [
    variant === "raised" ? styles.section : styles.inset,
    focused ? styles.focused : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset ref={ref} className={classNames}>
      {title && <legend className={styles.legend}>{title}</legend>}
      {children}
    </fieldset>
  );
});
