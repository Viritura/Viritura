// Older editor builds wrote staff-group symbols outside the MNX enum.
const LEGACY_STAFF_SYMBOLS: Readonly<Record<string, string>> = {
  line: "square",
  none: "noSymbol",
};

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

function eachLayoutGroup(content: unknown, visit: (group: Obj) => void): void {
  if (!Array.isArray(content)) return;
  for (const item of content) {
    const node = asObj(item);
    if (node?.["type"] !== "group") continue;
    visit(node);
    eachLayoutGroup(node["content"], visit);
  }
}

function eachLayout(doc: Obj, visit: (group: Obj) => void): void {
  const layouts = doc["layouts"];
  if (!Array.isArray(layouts)) return;
  for (const layout of layouts) eachLayoutGroup(asObj(layout)?.["content"], visit);
}

function isLegacySymbol(symbol: unknown): symbol is string {
  return typeof symbol === "string" && Object.hasOwn(LEGACY_STAFF_SYMBOLS, symbol);
}

/**
 * Rewrite legacy layout-group symbols (`line`, `none`) to their MNX
 * equivalents. Returns the input unchanged when there is nothing to upgrade.
 */
export function migrateLegacyStaffSymbols(json: unknown): unknown {
  const doc = asObj(json);
  if (!doc) return json;
  let found = false;
  eachLayout(doc, (group) => {
    if (isLegacySymbol(group["symbol"])) found = true;
  });
  if (!found) return json;

  const upgraded = structuredClone(doc);
  eachLayout(upgraded, (group) => {
    const symbol = group["symbol"];
    if (isLegacySymbol(symbol)) group["symbol"] = LEGACY_STAFF_SYMBOLS[symbol];
  });
  return upgraded;
}
