import type { GitHubAccountState } from "../github/useGitHubAccount";
import type { VirituraUser } from "./api";

/**
 * Shared helpers for rendering signed-in user identity (avatar, initials, email
 * sanity-checks). Kept in a plain `.ts` file so they can be imported from both
 * component files without tripping `react-refresh/only-export-components`.
 */

export function pickAvatarUrl(user: VirituraUser, github: GitHubAccountState): string | null {
  if (user.avatarUrl) return user.avatarUrl;
  return github.session?.viewer?.avatarUrl ?? null;
}

export function getInitials(user: VirituraUser): string {
  const source = user.displayName?.trim() || user.email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * Placeholder local-part emails the API issues when no real address is available
 * (GitHub no-reply addresses, or our own no-reply fallback for accounts without
 * a verified email). We hide these from the UI so users don't see noise.
 */
export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@users.noreply.github.com") || email.endsWith("@users.noreply.viritura.com");
}
