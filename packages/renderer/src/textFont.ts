/**
 * Text-font family resolution for render commands.
 *
 * Engine families (optionally followed by style words) map bundled Libertinus
 * Serif to a private family name. Sans-serif uses
 * installed Arial or the platform fallback, without a bundled sans face.
 */

/** Private FontFace family under which Libertinus Serif is registered. */
export const TEXT_FONT_FAMILY = "Viritura Serif";

const SERIF_STACK = `"${TEXT_FONT_FAMILY}", serif`;

/** Map a render-command family name to a CSS font-family list. */
export function canvasFontFamily(family: string): string {
  if (family === "sans-serif") return "Arial, sans-serif";
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
