import type { JumpBarAction } from "../components/JumpBar";
import { fuzzyMatch, matchScore } from "../components/jumpBarMatch";

/** Filter ordinary commands, giving an exact compact-navigation query priority. */
export function resolveJumpBarResults(
  actions: readonly JumpBarAction[],
  query: string,
  resolveQueryAction?: (query: string) => JumpBarAction | null,
): JumpBarAction[] {
  const available = actions.filter((action) => !action.enabled || action.enabled());
  if (!query.trim()) return available.filter((action) => !action.hideWhenEmpty);
  const direct = resolveQueryAction?.(query.trim());
  if (direct) return [direct];
  const q = query.trim();
  return available
    .filter((action) => {
      const searchText = [action.label, action.category, action.shortcut ?? "", ...(action.keywords ?? [])].join(" ");
      return fuzzyMatch(q, searchText);
    })
    .sort((left, right) => {
      const leftScore = Math.min(
        matchScore(q, left.label),
        matchScore(q, left.category),
        ...(left.keywords ?? []).map((keyword) => matchScore(q, keyword)),
      );
      const rightScore = Math.min(
        matchScore(q, right.label),
        matchScore(q, right.category),
        ...(right.keywords ?? []).map((keyword) => matchScore(q, keyword)),
      );
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.label.localeCompare(right.label);
    });
}
