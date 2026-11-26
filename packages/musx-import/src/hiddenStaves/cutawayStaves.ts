import type { DenigmaDiagnostic } from "../types";

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
}

function hidesAsCutaway(body: string): boolean {
  return /<hideMode>\s*cutaway\s*<\/hideMode>/.test(body);
}

/**
 * Finale staves hidden in cutaway mode, either by their own Force Hide Staff
 * setting or by an assigned staff style. Unassigned styles (Finale's default
 * documents define cutaway and collapse styles) do not count.
 */
function findCutawayStaves(enigmaXml: string): Set<string> {
  const staves = new Set<string>();
  for (const [, attributes = "", body = ""] of enigmaXml.matchAll(/<staffSpec\b([^>]*)>([\s\S]*?)<\/staffSpec>/g)) {
    const staff = attribute(attributes, "cmper");
    if (staff && hidesAsCutaway(body)) staves.add(staff);
  }
  const cutawayStyles = new Set<string>();
  for (const [, attributes = "", body = ""] of enigmaXml.matchAll(/<staffStyle\b([^>]*)>([\s\S]*?)<\/staffStyle>/g)) {
    const style = attribute(attributes, "cmper");
    if (style && hidesAsCutaway(body)) cutawayStyles.add(style);
  }
  if (cutawayStyles.size === 0) return staves;
  for (const [, attributes = "", body = ""] of enigmaXml.matchAll(
    /<staffStyleAssign\b([^>]*)>([\s\S]*?)<\/staffStyleAssign>/g,
  )) {
    const staff = attribute(attributes, "cmper");
    const style = /<style>\s*(\d+)\s*<\/style>/.exec(body)?.[1];
    if (staff && style && cutawayStyles.has(style)) staves.add(staff);
  }
  return staves;
}

export function cutawayDiagnostic(enigmaXml: string): DenigmaDiagnostic | undefined {
  const count = findCutawayStaves(enigmaXml).size;
  if (count === 0) return undefined;
  return {
    severity: "warning",
    message: `Finale cutaway staff hiding is not supported yet; ${count === 1 ? "1 staff imports" : `${count} staves import`} fully visible where Finale cut it away.`,
  };
}
