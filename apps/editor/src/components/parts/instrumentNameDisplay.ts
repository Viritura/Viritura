import type {
  InstrumentNameDisplayPolicy,
  InstrumentNameDisplaySettings,
  LayoutContent,
  LayoutDefinition,
  LayoutStaff,
  ScoreDefinition,
  StaffLabelRef,
} from "@viritura/core";

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

function uniformLayoutPolicy(content: readonly LayoutContent[]): InstrumentNameDisplayValue {
  const staffs: LayoutStaff[] = [];
  collectStaffs(content, staffs);
  if (staffs.length === 0 || staffs.some((staff) => staff.label !== undefined)) return "custom";

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
  score: ScoreDefinition,
  settings: InstrumentNameDisplaySettings,
): { layouts: LayoutDefinition[]; score: ScoreDefinition } {
  const layoutIds = instrumentNameDisplayLayoutIds(score);
  const standardLabelRef =
    settings.firstSystem === "full" && settings.subsequentSystems === "short"
      ? "name"
      : settings.firstSystem === "short" && settings.subsequentSystems === "short"
        ? "shortName"
        : settings.firstSystem === "hidden" && settings.subsequentSystems === "hidden"
          ? undefined
          : "name";
  const nextLayouts = layouts.map((layout) =>
    layoutIds.has(layout.id)
      ? { ...layout, content: setInstrumentNameDisplay(layout.content, standardLabelRef) }
      : layout,
  );
  const usesStandardMnx =
    (settings.firstSystem === "full" && settings.subsequentSystems === "short") ||
    (settings.firstSystem === "short" && settings.subsequentSystems === "short") ||
    (settings.firstSystem === "hidden" && settings.subsequentSystems === "hidden");
  const nextScore = { ...score };
  if (usesStandardMnx) delete nextScore.instrumentNameDisplay;
  else nextScore.instrumentNameDisplay = settings;
  return { layouts: nextLayouts, score: nextScore };
}

export type { InstrumentNameDisplayPolicy, InstrumentNameDisplaySettings };
