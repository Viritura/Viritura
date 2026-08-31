import type { NavListGroup } from "@viritura/ui";
import { SETTINGS_GROUPS, type SettingsCategory } from "./settingsCategories";

/**
 * Filters categories by a free-text query.
 *
 * Matches label, group, description and keywords, so a user can find
 * "Rendering" by typing "fps" — the terms people actually reach for rarely
 * appear in the category name. Every term in the query must match somewhere
 * (AND, not OR), which keeps a two-word query from widening the result set.
 */
export function filterCategories(categories: readonly SettingsCategory[], query: string): SettingsCategory[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...categories];

  return categories.filter((category) => {
    const haystack = [category.label, category.group, category.description, ...category.keywords]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Buckets categories into `NavList` groups, dropping groups with no matches. */
export function toNavGroups(categories: readonly SettingsCategory[]): NavListGroup[] {
  return SETTINGS_GROUPS.flatMap((group) => {
    const items = categories.filter((category) => category.group === group);
    if (items.length === 0) return [];
    return [
      {
        id: group,
        label: group,
        items: items.map((category) => ({ id: category.id, label: category.label, icon: category.icon })),
      },
    ];
  });
}
