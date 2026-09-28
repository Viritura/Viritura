import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import styles from "./FormField.module.css";

export interface InputSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  /** Use the larger dialog-size variant */
  large?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * Form-input chrome for controls that cannot be a native `<input>` — most
 * notably `contenteditable` rich-text fields, which need the same border,
 * surface, and focus ring as `FormInput` to sit correctly in a form stack.
 */
export const InputSurface = forwardRef<HTMLDivElement, InputSurfaceProps>(function InputSurface(
  { large = false, className, ...props },
  ref,
) {
  const classNames = [large ? styles.inputLg : styles.input, className ?? ""].filter(Boolean).join(" ");

  return <div ref={ref} className={classNames} {...props} />;
});
