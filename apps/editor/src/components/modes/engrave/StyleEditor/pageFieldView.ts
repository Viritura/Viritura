import type { Score } from "@viritura/core";
import type { CascadingMenuItem } from "@viritura/ui";
import {
  clearDownstream,
  downstreamOverrides,
  inheritedPageSetup,
  isFieldSet,
  layoutProfileScope,
  promoteField,
  resetField,
  resolvedPageSetup,
  scopeName,
  type PageFieldDefinition,
  type PageScope,
  type ProfileScope,
} from "../../../../engraveStyle";
import type { DownstreamLink, TrailStep } from "./StyleField";

export interface StyleNavigation {
  transform: (update: (score: Score) => Score, message?: string) => void;
  openProfile: (profile: ProfileScope) => void;
  openLayout: (index: number) => void;
}

export interface PageFieldView {
  explicit: boolean;
  trail: TrailStep[];
  actions: CascadingMenuItem[];
  downstream: DownstreamLink[];
}

function profileLabel(score: Score, profile: ProfileScope): string {
  return `${scopeName(score, profile)} profile`;
}

function layoutTrail(score: Score, index: number, field: PageFieldDefinition, nav: StyleNavigation): TrailStep[] {
  const profile = layoutProfileScope(score, index);
  const layout: PageScope = { kind: "layout", index };
  const explicit = isFieldSet(score, layout, field);
  const layoutName = scopeName(score, layout);
  return [
    {
      name: profileLabel(score, profile),
      set: true,
      current: false,
      detail: `${profileLabel(score, profile)}: ${field.format(resolvedPageSetup(score, profile))}`,
      onJump: () => nav.openProfile(profile),
    },
    {
      name: layoutName,
      set: explicit,
      current: true,
      detail: explicit ? `${layoutName}: ${field.format(resolvedPageSetup(score, layout))}` : `${layoutName}: inherits`,
    },
  ];
}

/** Where a page setting comes from and what can be done about it at one layer. */
export function pageFieldView(
  score: Score,
  scope: PageScope,
  field: PageFieldDefinition,
  nav: StyleNavigation,
): PageFieldView {
  const explicit = isFieldSet(score, scope, field);
  const actions: CascadingMenuItem[] = [];
  const name = field.label.toLowerCase();
  if (explicit) {
    const inherited = field.format(inheritedPageSetup(score, scope));
    actions.push({
      id: "reset",
      label: `Reset to ${inherited}`,
      onSelect: () => nav.transform((current) => resetField(current, scope, field)),
    });
  }
  if (explicit && scope.kind === "layout") {
    const profile = layoutProfileScope(score, scope.index);
    actions.push({
      id: "promote",
      label: `Move to ${profileLabel(score, profile)}`,
      onSelect: () =>
        nav.transform(
          (current) => promoteField(current, scope, field),
          `Every layout using the ${profileLabel(score, profile)} now uses this ${name}.`,
        ),
    });
  }
  const below = scope.kind === "profile" ? downstreamOverrides(score, scope, field) : [];
  if (scope.kind === "profile" && below.length) {
    actions.push({
      id: "clear-downstream",
      label: `Clear ${below.length} custom layout ${below.length === 1 ? "setting" : "settings"}`,
      onSelect: () =>
        nav.transform(
          (current) => clearDownstream(current, scope, field),
          `${below.length} ${below.length === 1 ? "layout now follows" : "layouts now follow"} this profile's ${name}.`,
        ),
    });
  }
  return {
    explicit,
    trail: scope.kind === "layout" ? layoutTrail(score, scope.index, field, nav) : [],
    actions,
    downstream: below.map((index) => {
      const layout: PageScope = { kind: "layout", index };
      const layoutName = scopeName(score, layout);
      return {
        key: String(index),
        name: layoutName,
        detail: `${layoutName}: ${field.format(resolvedPageSetup(score, layout))}`,
        onSelect: () => nav.openLayout(index),
      };
    }),
  };
}
