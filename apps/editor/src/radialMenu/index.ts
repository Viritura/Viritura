/**
 * Radial menu — barrel export.
 *
 * All public API is re-exported from here so consumers can import from
 * "./radialMenu" instead of individual modules.
 */

// Types
export type { RadialMenuCategory } from "./types";

// Per-category resolvers
export { resolveClef } from "./clefMenu";
export { resolveBarline, parseAddMeasures } from "./barlineMenu";
export { resolveTimeSignature } from "./timeSignatureMenu";
export { resolveKeySignature } from "./keySignatureMenu";
export { resolveOrnament } from "./ornamentMenu";
export { resolveBreathFermata } from "./breathFermataMenu";
export { resolveTuplet, parseTupletRatio } from "./tupletMenu";
export { parseTimeSignatureInput } from "../components/palette";
export { resolveFingering } from "./fingeringMenu";
export { resolveRepeat } from "./repeatMenu";
export { resolveArticulation } from "./articulationMenu";

// Dynamic expression builder (re-exported from dynamicMenu)
export { parseDynamicExpression } from "./dynamicMenu";

// Mixed expression support
export { parseMixedExpression, isMixedExpression } from "./dynamicExpressionParser";

// Registry — category → items / title / options
export {
  getMenuItems,
  getMenuTitle,
  getMenuMaxItems,
  getMenuFirstPageMaxItems,
  getMenuStartAlign,
  getMenuRenderExpression,
  getMenuSearchPlaceholder,
} from "./menuRegistry";

// Items (for direct import in tests)
export { KEY_SIGNATURE_ITEMS } from "./keySignatureMenu";
