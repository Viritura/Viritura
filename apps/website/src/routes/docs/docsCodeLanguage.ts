/**
 * Monaco language ids for fenced code blocks in the docs.
 *
 * Only Monaco's lightweight Monarch tokenizers are registered: the docs show
 * read-only samples, so the TypeScript and HTML language services (and their
 * workers) would add weight without adding anything a reader can use.
 */
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/shell/register.js";
import "monaco-editor/languages/definitions/typescript/register.js";

const FENCE_LANGUAGES: Readonly<Record<string, string>> = {
  bash: "shell",
  html: "html",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  jsx: "javascript",
  sh: "shell",
  shell: "shell",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
};

/** Map a markdown fence info string (`js`, `tsx`) to a Monaco language id. */
export function monacoLanguageForFence(fence: string): string {
  return FENCE_LANGUAGES[fence.toLowerCase()] ?? "plaintext";
}
