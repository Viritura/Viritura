import type { CommitInfo } from "../../../git";

export const HISTORY_SESSION_GAP_MS = 90 * 60 * 1000;

export interface HistorySession {
  id: string;
  commits: CommitInfo[];
  newestTimestamp: number;
  oldestTimestamp: number;
  dateKey: string;
  dateLabel: string;
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatDateLabel(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function createSession(commits: CommitInfo[], now: number): HistorySession {
  const newest = commits[0]!;
  const oldest = commits.at(-1)!;
  return {
    id: newest.sha,
    commits,
    newestTimestamp: newest.timestamp,
    oldestTimestamp: oldest.timestamp,
    dateKey: localDateKey(newest.timestamp),
    dateLabel: formatDateLabel(newest.timestamp, now),
  };
}

/**
 * Group newest-first commits into working sessions. A session boundary is a
 * period of inactivity, while calendar dates remain presentation labels only.
 */
export function groupHistorySessions(
  commits: CommitInfo[],
  now = Date.now(),
  sessionGapMs = HISTORY_SESSION_GAP_MS,
): HistorySession[] {
  if (commits.length === 0) return [];

  const sessions: HistorySession[] = [];
  let current: CommitInfo[] = [];
  let previousTimestamp: number | null = null;

  for (const commit of commits) {
    if (previousTimestamp !== null && previousTimestamp - commit.timestamp >= sessionGapMs) {
      sessions.push(createSession(current, now));
      current = [];
    }
    current.push(commit);
    previousTimestamp = commit.timestamp;
  }
  if (current.length > 0) sessions.push(createSession(current, now));
  return sessions;
}

export function formatSessionRange(session: HistorySession): string {
  const format = (timestamp: number) =>
    new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(timestamp));
  const join = (parts: Intl.DateTimeFormatPart[], includePeriod: boolean) =>
    parts
      .filter((part) => includePeriod || part.type !== "dayPeriod")
      .map((part) => part.value)
      .join("")
      .trim();
  const newestParts = format(session.newestTimestamp);
  if (session.newestTimestamp === session.oldestTimestamp) return join(newestParts, true);

  const oldestParts = format(session.oldestTimestamp);
  const oldestPeriod = oldestParts.find((part) => part.type === "dayPeriod")?.value;
  const newestPeriod = newestParts.find((part) => part.type === "dayPeriod")?.value;
  return `${join(oldestParts, oldestPeriod !== newestPeriod)}–${join(newestParts, true)}`;
}
