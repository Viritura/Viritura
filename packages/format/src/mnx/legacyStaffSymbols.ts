// Older editor builds wrote staff-group symbols outside the MNX enum, and
// used a `bracket` nested inside another bracket to mean the thin sub-bracket
// that MNX now spells `square`.
const LEGACY_STAFF_SYMBOLS: Readonly<Record<string, string>> = {
  line: "square",
  none: "noSymbol",
};

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

/** An omitted group symbol defaults to a bracket. */
function isBracketGroup(group: Obj): boolean {
  return group["symbol"] === undefined || group["symbol"] === "bracket";
}

function eachLayoutGroup(
  content: unknown,
  insideBracket: boolean,
  visit: (group: Obj, insideBracket: boolean) => void,
): void {
  if (!Array.isArray(content)) return;
  for (const item of content) {
    const node = asObj(item);
    if (node?.["type"] !== "group") continue;
    const childrenInsideBracket = insideBracket || isBracketGroup(node);
    visit(node, insideBracket);
    eachLayoutGroup(node["content"], childrenInsideBracket, visit);
  }
}

function eachLayout(doc: Obj, visit: (group: Obj, insideBracket: boolean) => void): void {
  const layouts = doc["layouts"];
  if (!Array.isArray(layouts)) return;
  for (const layout of layouts) eachLayoutGroup(asObj(layout)?.["content"], false, visit);
}

function upgradedSymbol(symbol: unknown, insideBracket: boolean): string | undefined {
  if (typeof symbol !== "string") return undefined;
  if (Object.hasOwn(LEGACY_STAFF_SYMBOLS, symbol)) return LEGACY_STAFF_SYMBOLS[symbol];
  if (symbol === "bracket" && insideBracket) return "square";
  return undefined;
}

/**
 * Rewrite legacy layout-group symbols (`line`, `none`, and nested `bracket`)
 * to their MNX equivalents. Returns the input unchanged when there is nothing
 * to upgrade.
 */
export function migrateLegacyStaffSymbols(json: unknown): unknown {
  const doc = asObj(json);
  if (!doc) return json;
  let found = false;
  eachLayout(doc, (group, insideBracket) => {
    if (upgradedSymbol(group["symbol"], insideBracket) !== undefined) found = true;
  });
  if (!found) return json;

  const upgraded = structuredClone(doc);
  // Classify every group against the original symbols before rewriting any:
  // turning a nested bracket into `square` must not change how its own
  // descendants are classified.
  const rewrites: Array<[Obj, string]> = [];
  eachLayout(upgraded, (group, insideBracket) => {
    const symbol = upgradedSymbol(group["symbol"], insideBracket);
    if (symbol !== undefined) rewrites.push([group, symbol]);
  });
  for (const [group, symbol] of rewrites) group["symbol"] = symbol;
  return upgraded;
}
