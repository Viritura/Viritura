import { describe, expect, it } from "vitest";
import type { CommitInfo } from "../git";
import {
  HISTORY_SESSION_GAP_MS,
  formatSessionRange,
  groupHistorySessions,
} from "../components/modes/review/historySessions";

function commit(sha: string, timestamp: number, subject = sha, auto = false): CommitInfo {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents: [],
    message: subject,
    subject,
    author: { name: "Composer", email: "composer@example.com" },
    timestamp,
    auto,
    refs: [],
  };
}

describe("groupHistorySessions", () => {
  it("starts a new session after 90 minutes of inactivity", () => {
    const now = new Date(2026, 8, 12, 12).getTime();
    const sessions = groupHistorySessions(
      [
        commit("latest", now),
        commit("same-session", now - HISTORY_SESSION_GAP_MS + 1),
        commit("older-session", now - HISTORY_SESSION_GAP_MS * 2),
      ],
      now,
    );

    expect(sessions.map((session) => session.commits.map((entry) => entry.sha))).toEqual([
      ["latest", "same-session"],
      ["older-session"],
    ]);
  });

  it("does not split a continuous session solely because it crosses midnight", () => {
    const newest = new Date(2026, 8, 12, 0, 20).getTime();
    const older = new Date(2026, 8, 11, 23, 50).getTime();

    expect(groupHistorySessions([commit("newest", newest), commit("older", older)], newest)).toHaveLength(1);
  });

  it("formats same-period session ranges without repeating the day period", () => {
    const now = new Date(2026, 8, 12, 12).getTime();
    const [session] = groupHistorySessions(
      [
        commit("latest", new Date(2026, 8, 12, 13, 20).getTime()),
        commit("oldest", new Date(2026, 8, 12, 13, 5).getTime()),
      ],
      now,
    );

    expect(formatSessionRange(session!)).toMatch(/1:05\s*[–-]\s*1:20\s*PM/i);
  });
});
