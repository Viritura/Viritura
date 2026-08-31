import type { CSSProperties } from "react";
import { FOLIO_V_PATH, FOLIO_WORDMARK_PATH } from "./brandPaths";

export interface VirituraMarkProps {
  readonly size?: number | string;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export interface VirituraWordmarkProps {
  readonly width?: number | string;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export interface VirituraLogoProps {
  readonly markSize?: number | string;
  readonly wordmarkWidth?: number | string;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function VirituraMark({ size = 32, title = "Viritura", className, style }: VirituraMarkProps) {
  const labelled = Boolean(title);
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={labelled ? "img" : "presentation"}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      className={className}
      style={style}
      fill="none"
    >
      {labelled && <title>{title}</title>}
      <rect width="64" height="64" fill="var(--viritura-brand, var(--brand, #215e4e))" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        stroke="var(--viritura-brand-keyline, var(--brand-keyline, #dceee7))"
        strokeWidth="1.5"
      />
      <path
        d={FOLIO_V_PATH}
        fill="var(--viritura-brand-ink, var(--brand-ink, #e7f3ee))"
        transform="translate(9 54) scale(.07 -.07)"
      />
    </svg>
  );
}

export function VirituraWordmark({ width = 168, title = "Viritura", className, style }: VirituraWordmarkProps) {
  const labelled = Boolean(title);
  return (
    <svg
      viewBox="0 0 300 64"
      width={width}
      role={labelled ? "img" : "presentation"}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      className={className}
      style={style}
      fill="currentColor"
    >
      {labelled && <title>{title}</title>}
      <path d={FOLIO_WORDMARK_PATH} transform="translate(2 54) scale(.075 -.075)" />
    </svg>
  );
}

function logoSpanStyle(style: CSSProperties | undefined): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.7em",
    color: "var(--accent)",
    ...style,
  };
}

export function VirituraLogo({
  markSize = 32,
  wordmarkWidth = 168,
  title = "Viritura",
  className,
  style,
}: VirituraLogoProps) {
  return (
    <span className={className} style={logoSpanStyle(style)}>
      <VirituraMark size={markSize} title="" />
      <VirituraWordmark width={wordmarkWidth} title={title} />
    </span>
  );
}
