import type { LayoutContent, LayoutDefinition, LayoutStaff, ScoreDefinition, StaffLabelRef } from "@viritura/core";

export type InstrumentNameDisplayPolicy = "fullThenShort" | "short" | "hidden";
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

export function instrumentNameDisplayFor(content: readonly LayoutContent[]): InstrumentNameDisplayValue {
  const staffs: LayoutStaff[] = [];
  collectStaffs(content, staffs);
  if (staffs.length === 0 || staffs.some((staff) => staff.label !== undefined)) return "custom";

  const refs = staffs.map(staffLabelRef);
  if (refs.every((ref) => ref === undefined)) return "hidden";
  if (refs.every((ref) => ref === "name")) return "fullThenShort";
  if (refs.every((ref) => ref === "shortName")) return "short";
  return "custom";
}

function applyPolicy(content: LayoutContent[], labelref: StaffLabelRef | undefined): void {
  for (const node of content) {
    if (node.type === "group") {
      applyPolicy(node.content, labelref);
      continue;
    }
    delete node.label;
    delete node.labelref;
    for (const source of node.sources) delete source.labelref;
    if (labelref !== undefined) node.labelref = labelref;
  }
}

export function setInstrumentNameDisplay(
  content: readonly LayoutContent[],
  policy: InstrumentNameDisplayPolicy,
): LayoutContent[] {
  const next = structuredClone(content) as LayoutContent[];
  const labelref = policy === "fullThenShort" ? "name" : policy === "short" ? "shortName" : undefined;
  applyPolicy(next, labelref);
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
  policy: InstrumentNameDisplayPolicy,
): LayoutDefinition[] {
  const layoutIds = instrumentNameDisplayLayoutIds(score);
  return layouts.map((layout) =>
    layoutIds.has(layout.id) ? { ...layout, content: setInstrumentNameDisplay(layout.content, policy) } : layout,
  );
}
