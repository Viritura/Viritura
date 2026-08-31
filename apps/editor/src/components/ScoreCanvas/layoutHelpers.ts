// Pure helpers used by ScoreCanvas's layout pipeline. Extracted from the
// component so the inline `useCallback` blocks (with empty deps) live as
// plain module-level functions — no React closure capture, no per-render
// allocation, easier to test.

import type { PatchInfo } from "@viritura/renderer";

/**
 * Walk the layout's content tree and inject individual source staves
 * immediately after any condensed staff whose path is in `expandedPaths`.
 * The injected staves carry a `_expansion: true` marker so downstream
 * code can distinguish them from author-authored staves.
 */
export function injectExpandedStaves(mnxJson: string, scoreIdx: number, expandedPaths: Set<string>): string {
  const parsed = JSON.parse(mnxJson);
  const scores = parsed.scores ?? [];
  const sd = scores[scoreIdx];
  if (!sd) return mnxJson;
  const layoutId = sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout;
  if (!layoutId) return mnxJson;
  const layouts = parsed.layouts ?? [];
  const layoutIdx = layouts.findIndex((l: { id: string }) => l.id === layoutId);
  if (layoutIdx < 0) return mnxJson;

  function expandContent(content: Array<Record<string, unknown>>, pathPrefix: string): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (let i = 0; i < content.length; i++) {
      const node = content[i]!;
      const path = pathPrefix ? `${pathPrefix}-${i}` : `${i}`;
      if (node.type === "group") {
        const expanded = expandContent(node.content as Array<Record<string, unknown>>, path);
        result.push({ ...node, content: expanded });
      } else if (node.type === "staff") {
        result.push(node);
        const sources = node.sources as Array<{ part: string }>;
        if (sources && sources.length > 1 && expandedPaths.has(path)) {
          for (const src of sources) {
            result.push({
              type: "staff",
              sources: [{ part: src.part, labelref: "name" }],
              _expansion: true,
            });
          }
        }
      } else {
        result.push(node);
      }
    }
    return result;
  }

  const layout = layouts[layoutIdx];
  layout.content = expandContent(layout.content, "");

  return JSON.stringify(parsed);
}

/**
 * Inject a filtered synthetic layout (id `__viritura_multi_select`) that
 * preserves group structure but keeps only staves whose part id is in
 * `partIds`. Used for ctrl/shift-staff selection. Returns the patched
 * MNX JSON plus the index of the synthetic score entry.
 */
export function injectSyntheticLayout(
  mnxJson: string,
  partIds: string[],
  scoreIdx: number,
): { json: string; scoreIndex: number } {
  const parsed = JSON.parse(mnxJson);
  const partSet = new Set(partIds);
  const syntheticLayoutId = "__viritura_multi_select";

  const scores = parsed.scores ?? [];
  const sd = scores[scoreIdx];
  const layoutId = sd?.layout ?? sd?.pages?.[0]?.systems?.[0]?.layout;
  const sourceLayout = layoutId ? (parsed.layouts ?? []).find((l: { id: string }) => l.id === layoutId) : null;

  function filterContent(content: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const node of content) {
      if (node.type === "group") {
        const filtered = filterContent(node.content as Array<Record<string, unknown>>);
        if (filtered.length > 0) {
          result.push({ ...node, content: filtered });
        }
      } else if (node.type === "staff") {
        const sources = node.sources as Array<{ part: string }>;
        if (sources?.some((s) => partSet.has(s.part))) {
          result.push(node);
        }
      }
    }
    return result;
  }

  const filteredContent = sourceLayout?.content
    ? filterContent(sourceLayout.content)
    : partIds.map((pid) => ({
        type: "staff",
        sources: [{ part: pid, labelref: "name" }],
      }));

  const syntheticLayout = { id: syntheticLayoutId, content: filteredContent };
  if (!parsed.layouts) parsed.layouts = [];
  const existingIdx = parsed.layouts.findIndex((l: { id: string }) => l.id === syntheticLayoutId);
  if (existingIdx >= 0) parsed.layouts[existingIdx] = syntheticLayout;
  else parsed.layouts.push(syntheticLayout);

  const syntheticScore = {
    name: "Selection",
    layout: syntheticLayoutId,
    ...(sd?.useWritten != null ? { useWritten: sd.useWritten } : {}),
  };
  if (!parsed.scores) parsed.scores = [];
  const existingScoreIdx = parsed.scores.findIndex(
    (s: { name?: string; layout?: string }) => s.name === "Selection" && s.layout === syntheticLayoutId,
  );
  if (existingScoreIdx >= 0) parsed.scores[existingScoreIdx] = syntheticScore;
  else parsed.scores.push(syntheticScore);

  const scoreIndex = parsed.scores.findIndex(
    (s: { name?: string; layout?: string }) => s.name === "Selection" && s.layout === syntheticLayoutId,
  );
  return { json: JSON.stringify(parsed), scoreIndex };
}

/** Build a WASM patch JSON from full MNX JSON + delta change info. */
export function buildPatchJson(mnxJson: string, patchInfo: PatchInfo): string {
  const parsed = JSON.parse(mnxJson);
  const patch: Record<string, unknown> = {};

  if (patchInfo.changedGlobalMeasures.length > 0) {
    const gm: Record<string, unknown> = {};
    for (const idx of patchInfo.changedGlobalMeasures) {
      gm[idx] = parsed.global.measures[idx];
    }
    patch.globalMeasures = gm;
  }

  if (patchInfo.changedPartMeasures.size > 0) {
    const pm: Record<string, Record<string, unknown>> = {};
    for (const [pi, indices] of patchInfo.changedPartMeasures) {
      pm[pi] = {};
      for (const mi of indices) {
        pm[pi]![mi] = parsed.parts[pi].measures[mi];
      }
    }
    patch.partMeasures = pm;
  }

  return JSON.stringify(patch);
}

/**
 * Record a layout-perf event onto `window` for the perf overlay / devtools.
 * Keeps a rolling buffer of the last 24 events. No-op outside the browser.
 */
export function setLayoutPerfDebug(info: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const target = window as unknown as Record<string, unknown>;
  const event = { ...info, at: performance.now() };
  target.__VIRITURA_LAST_LAYOUT__ = event;
  const events = Array.isArray(target.__VIRITURA_LAYOUT_EVENTS__) ? target.__VIRITURA_LAYOUT_EVENTS__ : [];
  target.__VIRITURA_LAYOUT_EVENTS__ = [...events.slice(-24), event];
}
