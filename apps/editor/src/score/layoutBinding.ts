/**
 * LayoutBinding — how a structure editor reads and writes a layout tree.
 *
 * A score's staff order, grouping, and bracketing exist at two tiers:
 *
 *   • **base**   — the score's default structure (`scores[].layout`), edited
 *                  in Setup mode and used by every system that doesn't
 *                  override it.
 *   • **system** — a per-system override (`pages[].systems[].layout`), edited
 *                  in Engrave mode. MNX models this by pointing the system at
 *                  a *different* `LayoutDefinition`; Viritura mints those on
 *                  demand and dedups them structurally (see `derivedLayouts`).
 *
 * Per-system overrides already ship for staff visibility, and the engine
 * honours arbitrary per-system layout swaps — so bracketing and staff order
 * are *already* expressible per system, they simply have no UI yet. This
 * binding is the seam that lets one structure editor serve both tiers: Setup
 * passes a base binding today, Engrave passes a system binding later, and the
 * editor itself never learns which tier it is editing.
 */
import type { LayoutContent, LayoutDefinition, Score, ScoreDefinition } from "@viritura/core";
import { ensureLayoutForContent, pruneUnusedDerivedLayouts } from "@viritura/core";
import { collectReferencedLayoutIds } from "./staffVisibilityMutations";
import type { NodePath } from "../components/parts/treeOps";

/** Which tier a binding edits. Drives labelling and the revert affordance. */
type LayoutScope =
  | { readonly kind: "base" }
  | {
      readonly kind: "system";
      /** `SystemDefinition.measure` — the system whose layout is overridden. */
      readonly systemMeasureId: string;
      /** Human-readable scope for the UI, e.g. "System at bar 12". */
      readonly label: string;
    };

export interface LayoutBinding {
  readonly scope: LayoutScope;
  /** The layout content currently in effect for this scope. */
  readonly content: LayoutContent[];
  /**
   * True when this node differs from the base. Always `false` for a base
   * binding — the base has nothing to inherit from — which is exactly why the
   * editor can render override affordances unconditionally.
   */
  isOverridden(path: NodePath): boolean;
  /** True when anything in this scope overrides the base. */
  readonly hasOverrides: boolean;
  /** Commit an edited tree. Base writes through; system derives. */
  applyEdit(next: LayoutContent[]): Score;
  /** Drop the override and fall back to the base. Undefined for a base binding. */
  revert?(): Score;
}

/** Structural identity for one node, used for inherited/overridden comparison. */
function nodeKey(node: LayoutContent | undefined): string {
  if (!node) return "";
  if (node.type === "staff") {
    return `staff:${node.sources.map((s) => s.part).join("+")}`;
  }
  return `group:${node.symbol ?? ""}:${node.label ?? ""}:${node.content.length}`;
}

function nodeAt(content: LayoutContent[] | undefined, path: NodePath): LayoutContent | undefined {
  let list = content;
  let node: LayoutContent | undefined;
  for (const index of path) {
    if (!list) return undefined;
    node = list[index];
    if (!node) return undefined;
    list = node.type === "group" ? node.content : undefined;
  }
  return node;
}

function findSystemLayoutId(sd: ScoreDefinition | undefined, systemMeasureId: string): string | undefined {
  for (const page of sd?.pages ?? []) {
    for (const sys of page.systems) {
      if (sys.measure === systemMeasureId) return sys.layout;
    }
  }
  return undefined;
}

/** Drop derived layouts nothing references any more. */
function gc(score: Score): Score {
  const referenced = collectReferencedLayoutIds(score);
  const layouts: LayoutDefinition[] = pruneUnusedDerivedLayouts(score.layouts ?? [], referenced);
  return { ...score, layouts };
}

/**
 * Editing the score's default structure. Writes straight through to the
 * score's own layout, so every non-overriding system picks the change up.
 */
export function createBaseLayoutBinding(score: Score, scoreIndex: number): LayoutBinding | null {
  const baseId = score.scores?.[scoreIndex]?.layout;
  if (!baseId) return null;
  const base = score.layouts?.find((l) => l.id === baseId);
  if (!base) return null;

  return {
    scope: { kind: "base" },
    content: base.content,
    isOverridden: () => false,
    hasOverrides: false,
    applyEdit(next: LayoutContent[]): Score {
      const layouts = (score.layouts ?? []).map((l) => (l.id === baseId ? { ...l, content: next } : l));
      return { ...score, layouts };
    },
  };
}

/**
 * Editing one system's structure. Never mutates the base: the edit mints (or
 * reuses) a derived layout and repoints only that system at it, then GCs any
 * derived layout the change orphaned.
 */
export function createSystemLayoutBinding(
  score: Score,
  scoreIndex: number,
  systemMeasureId: string,
  label: string,
): LayoutBinding | null {
  const sd = score.scores?.[scoreIndex];
  const baseId = sd?.layout;
  if (!baseId) return null;
  const base = score.layouts?.find((l) => l.id === baseId);
  if (!base) return null;

  const effectiveId = findSystemLayoutId(sd, systemMeasureId) ?? baseId;
  const effective = score.layouts?.find((l) => l.id === effectiveId) ?? base;
  const overriding = effectiveId !== baseId;

  const repoint = (layoutId: string): Score => {
    const scores = score.scores!.map((s, i) =>
      i !== scoreIndex
        ? s
        : {
            ...s,
            pages: s.pages?.map((page) => ({
              ...page,
              systems: page.systems.map((sys) =>
                sys.measure === systemMeasureId ? { ...sys, layout: layoutId } : sys,
              ),
            })),
          },
    );
    return { ...score, scores };
  };

  return {
    scope: { kind: "system", systemMeasureId, label },
    content: effective.content,
    isOverridden(path: NodePath) {
      if (!overriding) return false;
      return nodeKey(nodeAt(effective.content, path)) !== nodeKey(nodeAt(base.content, path));
    },
    hasOverrides: overriding,
    applyEdit(next: LayoutContent[]): Score {
      const ensured = ensureLayoutForContent(score.layouts ?? [], next);
      return gc({ ...repoint(ensured.layoutId), layouts: ensured.layouts });
    },
    revert(): Score {
      return gc(repoint(baseId));
    },
  };
}
