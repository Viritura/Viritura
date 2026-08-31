import { cloneElement, forwardRef, isValidElement, useId } from "react";
import type { ReactElement, ReactNode, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./FormField.module.css";

export interface FormFieldProps {
  /** Field label */
  label: string;
  /** Error message */
  error?: ReactNode;
  /** Help/status message shown below the control when there is no error. */
  message?: ReactNode;
  /** Optional action aligned opposite the label (for example, "Forgot password?"). */
  action?: ReactNode;
  /** Explicit control ID used when an action makes implicit wrapping invalid. */
  htmlFor?: string;
  /** Field content (input, select, etc.) — if not provided, use FormInput/Select */
  children?: ReactNode;
  /** Horizontal layout (label beside input instead of above) */
  horizontal?: boolean;
  /** Additional className */
  className?: string;
}

interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  "aria-labelledby"?: string;
}

export function FormField({
  label,
  error,
  message,
  action,
  htmlFor,
  children,
  horizontal = false,
  className,
}: FormFieldProps) {
  const classNames = [horizontal ? styles.fieldH : styles.field, className ?? ""].filter(Boolean).join(" ");
  const generatedId = useId();
  const child = isValidElement<FieldControlProps>(children) ? children : null;
  const controlId = htmlFor ?? child?.props.id ?? generatedId;
  const labelId = `${controlId}-label`;
  const feedback = error ?? message;
  const feedbackId = feedback ? `${controlId}-feedback` : undefined;
  const describedBy = [child?.props["aria-describedby"], feedbackId].filter(Boolean).join(" ") || undefined;
  const labelledBy = [labelId, child?.props["aria-labelledby"]].filter(Boolean).join(" ");
  const control = child
    ? cloneElement(child as ReactElement<FieldControlProps>, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : child.props["aria-invalid"],
        "aria-labelledby": labelledBy,
      })
    : children;

  return (
    <div className={classNames}>
      {horizontal ? (
        <label id={labelId} className={styles.labelH} htmlFor={controlId}>
          {label}
        </label>
      ) : (
        <span className={styles.labelRow}>
          <label id={labelId} className={styles.label} htmlFor={controlId}>
            {label}
          </label>
          {action && <span className={styles.labelAction}>{action}</span>}
        </span>
      )}
      {control}
      {feedback && (
        <span id={feedbackId} className={error ? styles.error : styles.message}>
          {feedback}
        </span>
      )}
    </div>
  );
}

export interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Use the larger dialog-size variant */
  large?: boolean;
  /** Additional className */
  className?: string;
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(function FormInput(
  { large = false, className, ...props },
  ref,
) {
  const classNames = [large ? styles.inputLg : styles.input, className ?? ""].filter(Boolean).join(" ");

  return <input ref={ref} className={classNames} {...props} />;
});

export interface FormTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  /** Use the larger dialog-size variant */
  large?: boolean;
  /** Additional className */
  className?: string;
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(function FormTextarea(
  { large = false, className, ...props },
  ref,
) {
  const classNames = [large ? styles.textareaLg : styles.textarea, className ?? ""].filter(Boolean).join(" ");

  return <textarea ref={ref} className={classNames} {...props} />;
});
