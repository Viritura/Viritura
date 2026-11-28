import {
  applyPageSetupOverride,
  assignedLayoutProfile,
  builtInPageSetup,
  profilePageSetupForScore,
  scorePageSetupRole,
  type PageSetup,
  type PageSetupOverride,
  type PageSetupRole,
  type Score,
} from "@viritura/core";
import { produce } from "../score/scoreClone";

/** A layout profile: the role's default profile when `id` is absent, otherwise a named profile. */
export interface ProfileScope {
  kind: "profile";
  role: PageSetupRole;
  id?: string;
}

/** One score or part view's own sparse overrides. */
export interface LayoutScope {
  kind: "layout";
  index: number;
}

export type PageScope = ProfileScope | LayoutScope;

export function sameScope(a: PageScope, b: PageScope): boolean {
  if (a.kind === "layout") return b.kind === "layout" && a.index === b.index;
  return b.kind === "profile" && a.role === b.role && a.id === b.id;
}

export function roleLabel(role: PageSetupRole): string {
  return role === "part" ? "Part" : "Score";
}

/** The profile a layout inherits from. Missing or mismatched profile IDs fall back to the role default. */
export function layoutProfileScope(score: Score, index: number): ProfileScope {
  const role = scorePageSetupRole(score, index);
  const named = assignedLayoutProfile(score, index);
  return named ? { kind: "profile", role, id: named.id } : { kind: "profile", role };
}

export function scopeName(score: Score, scope: PageScope): string {
  if (scope.kind === "layout") return score.scores?.[scope.index]?.name ?? `Layout ${scope.index + 1}`;
  if (!scope.id) return roleLabel(scope.role);
  return score.layoutProfiles?.find((profile) => profile.id === scope.id)?.name ?? roleLabel(scope.role);
}

export function readPageLayer(score: Score, scope: PageScope): PageSetupOverride | undefined {
  if (scope.kind === "layout") return score.scores?.[scope.index]?.pageSetup;
  if (!scope.id) return score.pageSetupDefaults?.[scope.role];
  return score.layoutProfiles?.find((profile) => profile.id === scope.id)?.pageSetup;
}

function compactLayer(layer: PageSetupOverride | undefined): PageSetupOverride | undefined {
  if (!layer) return undefined;
  const next: PageSetupOverride = { ...layer };
  if (next.margins) {
    const margins = Object.fromEntries(Object.entries(next.margins).filter(([, value]) => value !== undefined));
    if (Object.keys(margins).length) next.margins = margins;
    else delete next.margins;
  }
  for (const key of Object.keys(next) as (keyof PageSetupOverride)[]) {
    if (next[key] === undefined) delete next[key];
  }
  return Object.keys(next).length ? next : undefined;
}

/** Replace one layer's sparse values. Empty layers are removed from the document. */
export function writePageLayer(score: Score, scope: PageScope, layer: PageSetupOverride | undefined): Score {
  const compact = compactLayer(layer);
  const stored = compact ? structuredClone(compact) : undefined;
  return produce(score, (draft) => {
    if (scope.kind === "layout") {
      const view = draft.scores?.[scope.index];
      if (!view) return;
      if (stored) view.pageSetup = stored;
      else delete view.pageSetup;
      return;
    }
    if (scope.id) {
      const profile = draft.layoutProfiles?.find((entry) => entry.id === scope.id);
      if (!profile) return;
      if (stored) profile.pageSetup = stored;
      else delete profile.pageSetup;
      return;
    }
    if (stored) {
      draft.pageSetupDefaults ??= {};
      draft.pageSetupDefaults[scope.role] = stored;
    } else if (draft.pageSetupDefaults) {
      delete draft.pageSetupDefaults[scope.role];
      if (!draft.pageSetupDefaults.score && !draft.pageSetupDefaults.part) delete draft.pageSetupDefaults;
    }
  });
}

/** Values a layer inherits before its own overrides apply. */
export function inheritedPageSetup(score: Score, scope: PageScope): PageSetup {
  return scope.kind === "layout" ? profilePageSetupForScore(score, scope.index) : builtInPageSetup(scope.role);
}

export function resolvedPageSetup(score: Score, scope: PageScope): PageSetup {
  return applyPageSetupOverride(inheritedPageSetup(score, scope), readPageLayer(score, scope));
}

/** Indices of layouts whose page setup inherits from a profile. */
export function layoutsUsingProfile(score: Score, profile: ProfileScope): number[] {
  return (score.scores ?? []).flatMap((_, index) =>
    sameScope(layoutProfileScope(score, index), profile) ? [index] : [],
  );
}

/** Every profile available to a role, default first. */
export function profilesForRole(score: Score, role: PageSetupRole): ProfileScope[] {
  return [
    { kind: "profile", role },
    ...(score.layoutProfiles ?? [])
      .filter((profile) => profile.role === role)
      .map((profile): ProfileScope => ({ kind: "profile", role, id: profile.id })),
  ];
}
