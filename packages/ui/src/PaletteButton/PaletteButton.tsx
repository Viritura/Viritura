import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import styles from "./PaletteButton.module.css";
import { withTooltip } from "../Tooltip/withTooltip";

// ── Glyph centering helper ──
//
// SMuFL music glyphs have wildly different bounding boxes. CenteredGlyph
// measures each glyph and applies a per-instance translateY so it visually
// sits in the middle of the button's line-box.

function measureGlyphOffset(text: string, font: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent ?? 0;
  const descent = m.actualBoundingBoxDescent ?? 0;
  return (ascent - descent) / 2;
}

const glyphOffsetCache = new Map<string, number>();

function getGlyphOffset(text: string, fontSize: number): number {
  const key = `${text}@${fontSize}`;
  const cached = glyphOffsetCache.get(key);
  if (cached !== undefined) return cached;
  const offset = measureGlyphOffset(text, `${fontSize}px Bravura`);
  glyphOffsetCache.set(key, offset);
  return offset;
}

function centeredGlyphStyle(offset: number): CSSProperties {
  // `font: inherit` is critical: in some contexts (e.g. Storybook docs MDX,
  // typography reset stylesheets) the global rule for `span` overrides the
  // parent button's font-family/size, so the SMuFL glyph silently falls
  // back to a system serif at 16px and renders as tofu. Forcing inherit
  // makes the glyph track its button's Bravura font regardless of host.
  return {
    display: "inline-block",
    font: "inherit",
    transform: offset ? `translateY(${offset}px)` : undefined,
  };
}

export function CenteredGlyph({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState(0);
  const text = typeof children === "string" ? children : "";

  useEffect(() => {
    if (!text || !ref.current) return;
    const computed = window.getComputedStyle(ref.current);
    const size = parseFloat(computed.fontSize) || 18;
    setOffset(getGlyphOffset(text, size));
  }, [text]);

  return (
    <span ref={ref} style={centeredGlyphStyle(offset)}>
      {children}
    </span>
  );
}

// ── PaletteButton ──

export type PaletteButtonShape = "tile" | "tall" | "wide" | "vertical";
export type PaletteButtonSelectionMode = "press" | "radio";

export interface PaletteButtonProps {
  /** Visible label (string for text/glyph, or use children for arbitrary content) */
  label?: string;
  /** Tooltip text; combined with `shortcut` if provided */
  title: string;
  /** Optional keyboard shortcut, appended to the tooltip as "(shortcut)" */
  shortcut?: string;
  /** Active/pressed state — tints to accent and dims the rim */
  active?: boolean;
  /** Disabled — dims to 40% and disables the click handler */
  disabled?: boolean;
  /** Render label in Bravura font for SMuFL glyphs (auto-centered via CenteredGlyph) */
  useBravura?: boolean;
  /** Shape variant: tile, tall glyph tile, wide row, or vertical content card. */
  shape?: PaletteButtonShape;
  /** Selection semantics: toggle/pressed button (default) or one option in a radio group. */
  selectionMode?: PaletteButtonSelectionMode;
  /** Click handler */
  onClick?: () => void;
  /** Arbitrary content; overrides `label` */
  children?: ReactNode;
  /** Optional className for further customization */
  className?: string;
}

function PaletteButtonImpl({
  label,
  title,
  shortcut,
  active = false,
  disabled = false,
  useBravura = false,
  shape = "tile",
  selectionMode = "press",
  onClick,
  children,
  className,
}: PaletteButtonProps) {
  const fullTitle = shortcut ? `${title} (${shortcut})` : title;
  // A tooltip only earns its keep when it tells the user something the
  // button's face doesn't already show. A plain-text button whose visible
  // label is the same string as its title (and which carries no extra
  // shortcut hint) would just echo itself on hover, so we skip the Radix
  // tooltip for it — `aria-label` below still carries the accessible name.
  // Glyph buttons (Bravura / arbitrary children) keep their tooltip because
  // their face is a symbol, not readable text.
  const showsPlainTextLabel = children === undefined && !useBravura;
  const tooltip = showsPlainTextLabel && !shortcut && label === title ? undefined : fullTitle;
  const classNames = [
    styles.paletteButton,
    shape === "tall" ? styles.tall : "",
    shape === "wide" ? styles.wide : "",
    shape === "vertical" ? styles.vertical : "",
    useBravura ? styles.bravura : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const content =
    children !== undefined ? (
      shape === "tall" ? (
        <CenteredGlyph>{children}</CenteredGlyph>
      ) : (
        children
      )
    ) : useBravura && label !== undefined ? (
      <CenteredGlyph>{label}</CenteredGlyph>
    ) : (
      label
    );

  const handleRadioKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (selectionMode !== "radio") return;
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (direction === 0 && event.key !== "Home" && event.key !== "End") return;
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const radios = Array.from(group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)') ?? []);
    const current = radios.indexOf(event.currentTarget);
    if (current < 0 || radios.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? radios.length - 1
          : (current + direction + radios.length) % radios.length;
    radios[nextIndex]?.focus();
    radios[nextIndex]?.click();
  };

  return withTooltip(
    <button
      type="button"
      className={classNames}
      aria-label={fullTitle}
      role={selectionMode === "radio" ? "radio" : undefined}
      aria-checked={selectionMode === "radio" ? active : undefined}
      aria-pressed={selectionMode === "press" ? active : undefined}
      disabled={disabled}
      onKeyDown={handleRadioKey}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled && onClick) onClick();
      }}
    >
      {content}
    </button>,
    tooltip,
  );
}

// Memoized: surfaces like the note palette render many buttons. When an
// unrelated panel re-render occurs, buttons whose props are unchanged skip
// reconciliation entirely, so idle buttons do no Radix tooltip work.
export const PaletteButton = memo(PaletteButtonImpl);
