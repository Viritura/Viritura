/** Source part IDs, with deterministic positional fallbacks for missing IDs. */
export function stablePartIds(rawMnx: unknown): string[] {
  const raw = typeof rawMnx === "string" ? (JSON.parse(rawMnx) as unknown) : rawMnx;
  if (!raw || typeof raw !== "object" || !("parts" in raw) || !Array.isArray(raw.parts)) return [];
  return raw.parts.map((part: unknown, index: number) => {
    if (part && typeof part === "object" && "id" in part && typeof part.id === "string" && part.id.length > 0) {
      return part.id;
    }
    return `#${index}`;
  });
}
