import type { OpenFileResult } from "../commands/fileCommands";

const MAX_WARNING_DETAILS = 3;
const MAX_DETAIL_LENGTH = 240;

export function formatImportWarning(result: OpenFileResult): { message: string; description: string } | null {
  const messages = [
    ...new Set(
      (result.importDiagnostics ?? [])
        .filter((diagnostic) => diagnostic.severity === "warning")
        .map((diagnostic) => diagnostic.message.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ];
  if (messages.length === 0) return null;

  const details = messages
    .slice(0, MAX_WARNING_DETAILS)
    .map((message) => (message.length > MAX_DETAIL_LENGTH ? `${message.slice(0, MAX_DETAIL_LENGTH - 1)}…` : message));
  const remaining = messages.length - details.length;
  if (remaining > 0) details.push(`And ${remaining} more warning${remaining === 1 ? "" : "s"}.`);
  return {
    message: `Imported ${result.filename} with ${messages.length} warning${messages.length === 1 ? "" : "s"}`,
    description: details.join("\n"),
  };
}
