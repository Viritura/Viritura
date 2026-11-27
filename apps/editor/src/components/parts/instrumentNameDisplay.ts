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
import { collectPartIdsInLayout } from "../../score/ScoreMutations";

export type InstrumentNameDisplayValue = InstrumentNameDisplayPolicy | "custom";

function staffLabelRef(staff: LayoutStaff): StaffLabelRef | undefined {
  return staff.labelRef ?? staff.sources.find((source) => source.labelRef)?.labelRef;
}

function collectStaffs(content: readonly LayoutContent[], result: LayoutStaff[]): void {
  for (const node of content) {
    if (node.type === "staff") result.push(node);
    else collectStaffs(node.content, result);
  }
}

function hasLiteralLabel(content: readonly LayoutContent[]): boolean {
  return content.some((node) => {
    if (node.type === "group") {
      const instrumentLabel = collectPartIdsInLayout(node.content).size <= 1;
      return (
        (instrumentLabel && (node.label !== undefined || node.labelRef !== undefined)) || hasLiteralLabel(node.content)
      );
    }
    return node.label !== undefined || node.sources.some((source) => source.label !== undefined);
  });
}

function hasInstrumentGroupLabel(content: readonly LayoutContent[]): boolean {
  return content.some(
    (node) =>
      node.type === "group" &&
      ((collectPartIdsInLayout(node.content).size <= 1 && (node.label !== undefined || node.labelRef !== undefined)) ||
        hasInstrumentGroupLabel(node.content)),
  );
}

function uniformLayoutPolicy(content: readonly LayoutContent[]): {
  firstSystem: InstrumentNameDisplayValue;
  subsequentSystems: InstrumentNameDisplayValue;
} {
  const staffs: LayoutStaff[] = [];
  collectStaffs(content, staffs);
  if (staffs.length === 0 || hasLiteralLabel(content)) return { firstSystem: "custom", subsequentSystems: "custom" };

  if (
    staffs.some((staff) => {
      const refs = [staff.labelRef, ...staff.sources.map((source) => source.labelRef)].filter(
        (ref) => ref !== undefined,
      );
      return (
        refs.length > 1 ||
        (staff.labelRef?.target !== undefined && staff.labelRef.target !== staff.sources[0]?.part) ||
        staff.sources.some((source) => source.labelRef?.target !== undefined && source.labelRef.target !== source.part)
      );
    })
  ) {
    return { firstSystem: "custom", subsequentSystems: "custom" };
  }
  const refs = staffs.flatMap((staff) =>
    [staff.labelRef, ...staff.sources.map((source) => source.labelRef)].filter((ref) => ref !== undefined),
  );
  if (refs.length === 0) return { firstSystem: "hidden", subsequentSystems: "hidden" };
  if (staffs.some((staff) => staffLabelRef(staff) === undefined)) {
    return { firstSystem: "custom", subsequentSystems: "custom" };
  }
  if (refs.every((ref) => (ref.ref ?? "auto") === "auto")) {
    return { firstSystem: "full", subsequentSystems: "short" };
  }
  if (refs.every((ref) => ref?.ref === "name")) return { firstSystem: "full", subsequentSystems: "full" };
  if (refs.every((ref) => ref?.ref === "shortName")) return { firstSystem: "short", subsequentSystems: "short" };
  return { firstSystem: "custom", subsequentSystems: "custom" };
}

export function instrumentNameDisplayFor(
  content: readonly LayoutContent[],
  score: ScoreDefinition,
): {
  firstSystem: InstrumentNameDisplayValue;
  subsequentSystems: InstrumentNameDisplayValue;
} {
  if (score.instrumentNameDisplay) return score.instrumentNameDisplay;
  return uniformLayoutPolicy(content);
}

function applyLabelRef(content: LayoutContent[], labelRef: StaffLabelRef | undefined): void {
  for (const node of content) {
    if (node.type === "group") {
      applyLabelRef(node.content, labelRef);
      continue;
    }
    delete node.label;
    delete node.labelRef;
    for (const source of node.sources) {
      delete source.label;
      delete source.labelRef;
    }
    if (labelRef !== undefined) node.labelRef = labelRef;
  }
}

function setInstrumentNameDisplay(
  content: readonly LayoutContent[],
  labelRef: StaffLabelRef | undefined,
): LayoutContent[] {
  const next = structuredClone(content) as LayoutContent[];
  applyLabelRef(next, labelRef);
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
  const standardLabelRef: StaffLabelRef | undefined =
    settings.firstSystem === "full" && settings.subsequentSystems === "short"
      ? { ref: "auto" }
      : settings.firstSystem === "full" && settings.subsequentSystems === "full"
        ? { ref: "name" }
        : settings.firstSystem === "short" && settings.subsequentSystems === "short"
          ? { ref: "shortName" }
          : settings.firstSystem === "hidden" && settings.subsequentSystems === "hidden"
            ? undefined
            : { ref: "auto" };
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
    !layouts.some((layout) => layoutIds.has(layout.id) && hasInstrumentGroupLabel(layout.content)) &&
    ((settings.firstSystem === "full" && settings.subsequentSystems === "short") ||
      (settings.firstSystem === "full" && settings.subsequentSystems === "full") ||
      (settings.firstSystem === "short" && settings.subsequentSystems === "short") ||
      (settings.firstSystem === "hidden" && settings.subsequentSystems === "hidden"));
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
