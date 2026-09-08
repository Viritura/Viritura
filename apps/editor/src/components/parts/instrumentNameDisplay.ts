import type {
  InstrumentNameDisplayPolicy,
  InstrumentNameDisplaySettings,
  LayoutContent,
  LayoutDefinition,
  LayoutStaff,
  ScoreDefinition,
  StaffLabelRef,
} from "@viritura/core";
import { generateId } from "@viritura/core";

export type InstrumentNameDisplayValue = InstrumentNameDisplayPolicy | "custom";

function staffLabelRef(staff: LayoutStaff): StaffLabelRef | undefined {
  return staff.labelref ?? staff.sources.find((source) => source.labelref)?.labelref;
}

function collectStaffs(content: readonly LayoutContent[], result: LayoutStaff[]): void {
  for (const node of content) {
    if (node.type === "staff") result.push(node);
    else collectStaffs(node.content, result);
  }
}

function hasLiteralLabel(content: readonly LayoutContent[]): boolean {
  return content.some((node) => node.label !== undefined || (node.type === "group" && hasLiteralLabel(node.content)));
}

function uniformLayoutPolicy(content: readonly LayoutContent[]): InstrumentNameDisplayValue {
  const staffs: LayoutStaff[] = [];
  collectStaffs(content, staffs);
  if (staffs.length === 0 || hasLiteralLabel(content)) return "custom";

  const refs = staffs.map(staffLabelRef);
  if (refs.every((ref) => ref === undefined)) return "hidden";
  if (refs.every((ref) => ref === "name")) return "full";
  if (refs.every((ref) => ref === "shortName")) return "short";
  return "custom";
}

export function instrumentNameDisplayFor(
  content: readonly LayoutContent[],
  score: ScoreDefinition,
): {
  firstSystem: InstrumentNameDisplayValue;
  subsequentSystems: InstrumentNameDisplayValue;
} {
  if (score.instrumentNameDisplay) return score.instrumentNameDisplay;
  const policy = uniformLayoutPolicy(content);
  if (policy === "full") return { firstSystem: "full", subsequentSystems: "short" };
  return { firstSystem: policy, subsequentSystems: policy };
}

function applyLabelRef(content: LayoutContent[], labelref: StaffLabelRef | undefined): void {
  for (const node of content) {
    if (node.type === "group") {
      delete node.label;
      applyLabelRef(node.content, labelref);
      continue;
    }
    delete node.label;
    delete node.labelref;
    for (const source of node.sources) delete source.labelref;
    if (labelref !== undefined) node.labelref = labelref;
  }
}

function setInstrumentNameDisplay(
  content: readonly LayoutContent[],
  labelref: StaffLabelRef | undefined,
): LayoutContent[] {
  const next = structuredClone(content) as LayoutContent[];
  applyLabelRef(next, labelref);
  return next;
}

export function instrumentNameDisplayLayoutIds(score: ScoreDefinition): Set<string> {
  const ids = new Set<string>();
  if (score.layout) ids.add(score.layout);
  for (const page of score.pages ?? []) {
    for (const system of page.systems) {
      if (system.layout) ids.add(system.layout);
      for (const change of system.layoutChanges ?? []) ids.add(change.layout);
    }
  }
  return ids;
}

export function setScoreInstrumentNameDisplay(
  layouts: readonly LayoutDefinition[],
  scores: readonly ScoreDefinition[],
  scoreIndex: number,
  settings: InstrumentNameDisplaySettings,
): { layouts: LayoutDefinition[]; scores: ScoreDefinition[] } {
  const score = scores[scoreIndex];
  if (!score) return { layouts: [...layouts], scores: [...scores] };
  const layoutIds = instrumentNameDisplayLayoutIds(score);
  const standardLabelRef =
    settings.firstSystem === "full" && settings.subsequentSystems === "short"
      ? "name"
      : settings.firstSystem === "short" && settings.subsequentSystems === "short"
        ? "shortName"
        : settings.firstSystem === "hidden" && settings.subsequentSystems === "hidden"
          ? undefined
          : "name";
  const layoutsUsedByOtherScores = new Set<string>();
  scores.forEach((candidate, index) => {
    if (index !== scoreIndex) {
      for (const id of instrumentNameDisplayLayoutIds(candidate)) layoutsUsedByOtherScores.add(id);
    }
  });
  const replacements = new Map<string, string>();
  const nextLayouts = layouts.flatMap((layout) => {
    if (!layoutIds.has(layout.id)) return [layout];
    const updated = { ...layout, content: setInstrumentNameDisplay(layout.content, standardLabelRef) };
    if (!layoutsUsedByOtherScores.has(layout.id)) return [updated];
    const id = generateId();
    replacements.set(layout.id, id);
    return [layout, { ...updated, id }];
  });
  const usesStandardMnx =
    (settings.firstSystem === "full" && settings.subsequentSystems === "short") ||
    (settings.firstSystem === "short" && settings.subsequentSystems === "short") ||
    (settings.firstSystem === "hidden" && settings.subsequentSystems === "hidden");
  const nextScore = { ...score };
  if (usesStandardMnx) delete nextScore.instrumentNameDisplay;
  else nextScore.instrumentNameDisplay = settings;
  if (nextScore.layout) nextScore.layout = replacements.get(nextScore.layout) ?? nextScore.layout;
  nextScore.pages = nextScore.pages?.map((page) => ({
    ...page,
    systems: page.systems.map((system) => ({
      ...system,
      ...(system.layout ? { layout: replacements.get(system.layout) ?? system.layout } : {}),
      ...(system.layoutChanges
        ? {
            layoutChanges: system.layoutChanges.map((change) => ({
              ...change,
              layout: replacements.get(change.layout) ?? change.layout,
            })),
          }
        : {}),
    })),
  }));
  const nextScores = [...scores];
  nextScores[scoreIndex] = nextScore;
  return { layouts: nextLayouts, scores: nextScores };
}

export type { InstrumentNameDisplayPolicy, InstrumentNameDisplaySettings };
