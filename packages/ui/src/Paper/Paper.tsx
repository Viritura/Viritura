/**
 * Paper — opaque "physical" material that sits on top of glass surfaces.
 *
 * Where glass (translucent, blurred) signals "ambient workspace
 * surface", paper signals "a discrete physical object you can pick up":
 * palette tiles, library cards, score pages, library shelf cards.
 *
 * Recipe: uncoated cream + visible fiber noise + bounce-tinted cast
 * shadow + the glass-system specular rim from `--elevation-3`. See
 * `packages/ui/src/docs/design-language/Paper.mdx` (variant G) for the
 * full design rationale and the matte-light-modeling research that
 * shaped it.
 *
 * Uses the `--paper-bg` / `--paper-shadow` token set defined in
 * `tokens.css`, so light / dark / midnight themes resolve automatically.
 */
import type { ButtonHTMLAttributes, ElementType, HTMLAttributes, ReactNode, Ref } from "react";
import styles from "./Paper.module.css";

type PaperOwnProps = {
  /**
   * Element type to render. Defaults to `div`; pass `"button"` for
   * palette-tile-style interactive paper.
   */
  as?: ElementType;
  /** Apply a subtle hover lift (used for interactive paper). */
  interactive?: boolean;
  /** Pressed / selected state — flattens the lift. */
  pressed?: boolean;
  /** Extra className appended after the paper base. */
  className?: string;
  children?: ReactNode;
};

export type PaperProps = PaperOwnProps &
  Omit<HTMLAttributes<HTMLElement>, keyof PaperOwnProps> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof PaperOwnProps | keyof HTMLAttributes<HTMLElement>>;

export function Paper({
  as,
  interactive = false,
  pressed = false,
  className,
  children,
  ...rest
}: PaperProps & { ref?: Ref<HTMLElement> }) {
  const Component = (as ?? "div") as ElementType;
  const classes = [styles.paper, interactive ? styles.interactive : "", pressed ? styles.pressed : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
