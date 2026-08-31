/**
 * Derived layout helpers for Engrave Mode hide-staff feature.
 *
 * MNX models per-system staff visibility by referencing a different
 * `LayoutDefinition` for that system. Rather than mutate user-authored
 * layouts, we generate derived layouts by stripping selected parts out of
 * a base layout, minting a fresh UUID v7 id, and flagging them with
 * `_x.viritura.derived: true` so the GC pass can distinguish them from
 * user-authored layouts.
 *
 * Dedup is **structural**: a `canonicalLayoutKey` walks the layout's
 * content tree (sorted keys, `undefined` elided, instance `id` excluded)
 * and produces a stable string. Two layouts whose canonical keys match
 * are reused as one — regardless of how each was created. This handles
 * the realistic cases (same hide set off the same base) and the future
 * cases (ossia / divisi / auto-hide producing convergent shapes from
 * different bases) without a parallel parameter-keyed scheme.
 */
import { generateId } from "../id";
import type { LayoutContent, LayoutDefinition, LayoutGroup, LayoutStaff } from "./layout";

/** Collect every part id referenced by a staff in the layout subtree. */
function collectPartIds(content: LayoutContent[]): Set<string> {
  const ids = new Set<string>();
  for (const node of content) {
    if (node.type === "staff") {
      for (const src of node.sources) ids.add(src.part);
    } else {
      for (const id of collectPartIds(node.content)) ids.add(id);
    }
  }
  return ids;
}

/** Drop sources with hidden parts; drop staves whose sources all become empty;
 * drop groups whose content collapses to nothing. */
function pruneContent(content: LayoutContent[], hidden: ReadonlySet<string>): LayoutContent[] {
  const out: LayoutContent[] = [];
  for (const node of content) {
    if (node.type === "staff") {
      const sources = node.sources.filter((s) => !hidden.has(s.part));
      if (sources.length === 0) continue;
      const next: LayoutStaff = { ...node, sources };
      out.push(next);
    } else {
      const inner = pruneContent(node.content, hidden);
      if (inner.length === 0) continue;
      const next: LayoutGroup = { ...node, content: inner };
      out.push(next);
    }
  }
  return out;
}

/**
 * Stable, sorted-keys JSON serialisation with `undefined` fields elided.
 * Arrays preserve source order (semantic in layouts). Object key order is
 * normalised so insertion order can't affect identity.
 */
function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJSON(v)).join(",") + "}";
}

/**
 * Canonical structural key for a layout. Excludes `id` (instance identity)
 * and the `_x.viritura.derived` flag (bookkeeping — shouldn't prevent a
 * derived layout from deduping against a user-authored one with the same
 * shape). Any other `_x.viritura.*` extensions and any future top-level
 * fields are included automatically because the canonicaliser is
 * schema-agnostic.
 */
function canonicalLayoutKey(layout: { id?: string; content: LayoutContent[]; _x?: LayoutDefinition["_x"] }): string {
  const { id: _id, _x, ...rest } = layout;
  const cleanedX = cleanVendorExtensions(_x);
  return canonicalJSON(cleanedX === undefined ? rest : { ...rest, _x: cleanedX });
}

/** Strip the bookkeeping `derived` flag from `_x.viritura` and collapse
 * any empty vendor namespaces so two layouts with the same content
 * canonicalise identically regardless of whether one is flagged. */
function cleanVendorExtensions(_x: LayoutDefinition["_x"] | undefined): Record<string, unknown> | undefined {
  if (!_x) return undefined;
  const out: Record<string, unknown> = {};
  for (const [vendor, ext] of Object.entries(_x)) {
    if (vendor === "viritura" && ext) {
      const { derived: _d, ...restViritura } = ext as Record<string, unknown>;
      if (Object.keys(restViritura).length > 0) out[vendor] = restViritura;
    } else if (ext !== undefined) {
      out[vendor] = ext;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Prune the parts in `hiddenParts` out of `base`. Returns the pruned
 * content subtree and the set of part ids that were actually present
 * (and thus actually pruned). Callers go through `ensureDerivedLayout`
 * to bind an id and dedup against existing layouts.
 */
export function deriveHiddenLayout(
  base: LayoutDefinition,
  hiddenParts: ReadonlySet<string>,
): { content: LayoutContent[]; effective: Set<string> } {
  const effective = new Set<string>();
  if (hiddenParts.size === 0) return { content: base.content, effective };
  const present = collectPartIds(base.content);
  for (const id of hiddenParts) if (present.has(id)) effective.add(id);
  if (effective.size === 0) return { content: base.content, effective };
  return { content: pruneContent(base.content, effective), effective };
}

/**
 * Ensure a layout with exactly `content` exists in the collection, and return
 * the id to reference from a `SystemDefinition`.
 *
 * This is the generic half of derivation, independent of *how* the content was
 * produced. Hiding staves prunes; a future per-system re-bracket or re-order
 * transforms. Both funnel through here so structural dedup and the `derived`
 * bookkeeping flag stay in exactly one place.
 *
 * Dedup is structural: any existing layout whose canonical key matches is
 * reused, whether user-authored or previously derived from a different base.
 */
export function ensureLayoutForContent(
  layouts: LayoutDefinition[],
  content: LayoutContent[],
): { layouts: LayoutDefinition[]; layoutId: string } {
  const candidateKey = canonicalLayoutKey({ content });
  for (const existing of layouts) {
    if (canonicalLayoutKey(existing) === candidateKey) {
      return { layouts, layoutId: existing.id };
    }
  }

  const minted: LayoutDefinition = {
    id: generateId(),
    content,
    _x: { viritura: { derived: true } },
  };
  return { layouts: [...layouts, minted], layoutId: minted.id };
}

/**
 * Ensure a layout matching the hide-staff prune of `baseId` exists in the
 * provided collection. Returns the (possibly extended) collection and the
 * layout id to reference from a `SystemDefinition`.
 *
 * Dedup is structural: any existing layout whose canonical key matches
 * the derived candidate is reused, whether user-authored or previously
 * derived from a different base.
 *
 * No-op (returns base id, unchanged collection) when nothing would be
 * pruned (no hidden ids, or none of the hidden ids appear in the layout).
 */
export function ensureDerivedLayout(
  layouts: LayoutDefinition[],
  baseId: string,
  hiddenParts: ReadonlySet<string>,
): { layouts: LayoutDefinition[]; layoutId: string } {
  const base = layouts.find((l) => l.id === baseId);
  if (!base) return { layouts, layoutId: baseId };

  const { content, effective } = deriveHiddenLayout(base, hiddenParts);
  if (effective.size === 0) return { layouts, layoutId: baseId };

  return ensureLayoutForContent(layouts, content);
}

/**
 * Garbage-collect derived layouts that are no longer referenced. Only
 * layouts flagged `_x.viritura.derived: true` are eligible — user-authored
 * layouts are preserved even when unreferenced, because MNX treats
 * `layouts[]` as a library and an author may keep spare layouts around
 * for future use.
 */
export function pruneUnusedDerivedLayouts(
  layouts: LayoutDefinition[],
  referencedLayoutIds: ReadonlySet<string>,
): LayoutDefinition[] {
  return layouts.filter((l) => {
    if (l._x?.viritura?.derived !== true) return true;
    return referencedLayoutIds.has(l.id);
  });
}
