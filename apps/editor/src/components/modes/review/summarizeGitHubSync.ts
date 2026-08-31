import type { useProjectStore } from "../../../store/projectStore";

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function summarizeGitHubSync(status: ReturnType<typeof useProjectStore.getState>["status"]): string {
  if (!status?.remoteUrl) return "Not connected";
  const prefix = status.branch ? `${status.branch} · ` : "";
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount;

  if (ahead > 0 && (behind ?? 0) > 0) {
    return `${prefix}${ahead} ${pluralize(ahead, "change")} to push · ${behind} new on GitHub`;
  }
  if (ahead > 0) {
    return `${prefix}${ahead} ${pluralize(ahead, "change")} ready to push`;
  }
  if ((behind ?? 0) > 0) {
    return `${prefix}${behind} new ${pluralize(behind!, "version")} on GitHub`;
  }
  if (behind === null) {
    return `${prefix}GitHub not checked yet`;
  }
  return `${prefix}Up to date with GitHub`;
}
