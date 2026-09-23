/**
 * Platform-appropriate modifier labels for menu shortcut hints.
 *
 * Shared by the menu bar and the score context menu so a command's shortcut
 * reads identically wherever it is surfaced.
 */

export const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
export const MOD = IS_MAC ? "⌘" : "Ctrl+";
