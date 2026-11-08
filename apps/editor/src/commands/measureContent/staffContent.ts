import { walkSequenceEvents, type PartMeasure, type SequenceContent } from "@viritura/core";

export function collectContentIds(content: SequenceContent[], ids: Set<string>): void {
  for (const { event } of walkSequenceEvents(content)) {
    if (event.id) ids.add(event.id);
    for (const note of event.notes ?? []) {
      if (note.id) ids.add(note.id);
    }
  }
}

function retainOtherStaves<T extends { staff?: number }>(
  values: T[] | undefined,
  selectsStaff: (staff: number) => boolean,
): T[] | undefined {
  return values?.filter((value) => !selectsStaff(value.staff ?? 1));
}

export function clearStaffAnnotations(
  measure: PartMeasure,
  selectsStaff: (staff: number) => boolean,
  removedIds: ReadonlySet<string>,
): void {
  measure.dynamics = retainOtherStaves(measure.dynamics, selectsStaff);
  measure.expressions = retainOtherStaves(measure.expressions, selectsStaff);
  measure.pedals = retainOtherStaves(measure.pedals, selectsStaff);
  measure.ottavas = retainOtherStaves(measure.ottavas, selectsStaff);
  const retainsSpan = (value: { span: { start: string; end: string } }): boolean =>
    !removedIds.has(value.span.start) && !removedIds.has(value.span.end);
  measure.arpeggios = measure.arpeggios?.filter(retainsSpan);
  measure.nonArpeggios = measure.nonArpeggios?.filter(retainsSpan);
  measure.beams = measure.beams?.filter((beam) => !beam.events.some((id) => removedIds.has(id)));
  for (const key of ["dynamics", "expressions", "pedals", "ottavas", "arpeggios", "nonArpeggios", "beams"] as const) {
    if (!measure[key]?.length) delete measure[key];
  }
}
