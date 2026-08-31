import { forwardRef } from "react";
import type { ElementType, HTMLAttributes, ReactNode, Ref } from "react";
import styles from "./Text.module.css";

export type TextVariant =
  | "display"
  | "title"
  | "heading"
  | "body"
  | "control"
  | "small"
  | "eyebrow"
  | "monoInline"
  | "monoBlock";

export type TextTone = "default" | "bright" | "muted" | "accent" | "error";

const VARIANT_CLASS: Record<TextVariant, string | undefined> = {
  display: styles.display,
  title: styles.title,
  heading: styles.heading,
  body: styles.body,
  control: styles.control,
  small: styles.small,
  eyebrow: styles.eyebrow,
  monoInline: styles.monoInline,
  monoBlock: styles.monoBlock,
};

const TONE_CLASS: Record<TextTone, string | undefined> = {
  default: undefined,
  bright: styles.toneBright,
  muted: styles.toneMuted,
  accent: styles.toneAccent,
  error: styles.toneError,
};

const DEFAULT_AS: Record<TextVariant, ElementType> = {
  display: "h1",
  title: "h2",
  heading: "h3",
  body: "p",
  control: "span",
  small: "span",
  eyebrow: "span",
  monoInline: "code",
  monoBlock: "pre",
};

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, "color"> {
  /** Which typography token to apply. */
  variant: TextVariant;
  /** Color tone override. Each variant has a sensible default. */
  tone?: TextTone;
  /** Render as a different element. Defaults to a semantic choice per variant. */
  as?: ElementType;
  children?: ReactNode;
  className?: string;
}

/**
 * Typography primitive. Renders the chosen --type-* token with a
 * semantic default element per variant (display → h1, body → p,
 * monoInline → code, etc.). Override the element via `as`, the tone
 * via `tone`, and stack additional classes via `className`.
 *
 * See Design Language / Typography in Storybook.
 */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { variant, tone = "default", as, className, children, ...rest },
  ref,
) {
  const Component = (as ?? DEFAULT_AS[variant]) as ElementType;
  const classes = [VARIANT_CLASS[variant], TONE_CLASS[tone], className].filter(Boolean).join(" ");
  return (
    <Component ref={ref as Ref<HTMLElement>} className={classes} {...rest}>
      {children}
    </Component>
  );
});
