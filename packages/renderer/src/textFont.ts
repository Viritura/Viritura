/**
 * Text-font family resolution for render commands.
 *
 * The engine emits `DrawText { font: "serif" }` (optionally followed by style
 * words such as `"serif italic"`). Libertinus Serif is registered under a
 * private family name so embedding pages keep their own generic `serif`
 * font; the generic family remains the fallback when the private face is not
 * loaded (for example when a host opts out of font loading).
 */

/** Private FontFace family under which Libertinus Serif is registered. */
export const TEXT_FONT_FAMILY = "Viritura Serif";

const SERIF_STACK = `"${TEXT_FONT_FAMILY}", serif`;

/** Map a render-command family name to a CSS font-family list. */
export function canvasFontFamily(family: string): string {
  return family === "serif" ? SERIF_STACK : family;
}

/**
 * Build a Canvas `font` shorthand from a render-command font name, which may
 * carry style words after the family (`"serif bold italic"`).
 */
export function canvasTextFont(font: string, size: number): string {
  const parts = font.split(" ");
  const family = canvasFontFamily(parts[0] || "serif");
  const style = parts.slice(1).join(" ");
  return style ? `${style} ${size}px ${family}` : `${size}px ${family}`;
}
