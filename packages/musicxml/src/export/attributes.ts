import { clefLineFromBottom, type Score, type TimeSignature } from "@viritura/core";
import type { PartPlan } from "./types";
import { displayTransposition, instrumentAt } from "./instruments";
import { displayInterval, keyFifths, transposeElement } from "./pitch";
import { compare, multiply, rational, ZERO, type Rational } from "./rhythm";
import { node, type XmlContext, type XmlElement } from "./xml";

export interface AttributeItem {
  position: Rational;
  element: XmlElement;
}

function staffAttributes(
  context: XmlContext,
  plan: PartPlan,
  mi: number,
): { position: Rational; element: XmlElement; order: number }[] {
  const measure = plan.measures[mi]!;
  const result: { position: Rational; element: XmlElement; order: number }[] = [];
  const at = (staff: number, fraction: [number, number]) => {
    const ratio = measure.staffMeters.get(staff)?.ratioToGlobal;
    return multiply(rational(...fraction), ratio ? rational(ratio.num, ratio.den) : rational(1));
  };
  for (const change of plan.selection.part.measures[mi]!.clefs ?? []) {
    const staff = plan.selection.staves.get(change.staff ?? 1);
    if (!staff) continue;
    result.push({
      position: at(change.staff ?? 1, change.position?.fraction ?? [0, 1]),
      order: 0,
      element: node(
        context,
        "clef",
        [
          node(context, "sign", change.clef.sign === "P" ? "percussion" : change.clef.sign),
          ["G", "F", "C"].includes(change.clef.sign)
            ? node(context, "line", clefLineFromBottom(change.clef))
            : undefined,
          change.clef.octave ? node(context, "clef-octave-change", change.clef.octave) : undefined,
        ],
        { number: plan.selection.staves.size > 1 ? staff : undefined },
      ),
    });
  }
  for (const change of plan.selection.part.measures[mi]!.staffConfigs ?? []) {
    const staff = plan.selection.staves.get(change.staff ?? 1);
    if (!staff) continue;
    result.push({
      position: at(change.staff ?? 1, change.position?.fraction ?? [0, 1]),
      order: 1,
      element: node(context, "staff-details", [node(context, "staff-lines", change.config.lines)], { number: staff }),
    });
  }
  return result.sort((a, b) => compare(a.position, b.position) || a.order - b.order);
}

function meterChanges(context: XmlContext, plan: PartPlan, mi: number): XmlElement[] {
  const measure = plan.measures[mi]!;
  const previous = plan.measures[mi - 1];
  const elements: XmlElement[] = [];
  for (const [sourceStaff, staff] of plan.selection.staves) {
    const local = measure.staffMeters.get(sourceStaff)?.timeSignature ?? measure.time;
    const oldLocal = previous?.staffMeters.get(sourceStaff)?.timeSignature ?? previous?.time;
    if (mi === 0 || JSON.stringify(local) !== JSON.stringify(oldLocal))
      elements.push(timeElement(context, local, plan.selection.staves.size > 1 ? staff : undefined));
  }
  return elements;
}
function timeElement(context: XmlContext, time: TimeSignature, staff?: number): XmlElement {
  return node(
    context,
    "time",
    time.display === "senzaMisura"
      ? [node(context, "senza-misura")]
      : [
          node(
            context,
            "beats",
            time.groupingDisplay === "additive" && time.beatStructure ? time.beatStructure.join("+") : time.count,
          ),
          node(context, "beat-type", time.unit),
        ],
    { number: staff, symbol: time.display === "common" ? "common" : time.display === "cut" ? "cut" : undefined },
  );
}

export function measureAttributes(
  context: XmlContext,
  score: Score,
  plan: PartPlan,
  mi: number,
  divisions: bigint,
  useWritten: boolean,
): AttributeItem[] {
  const measure = plan.measures[mi]!;
  const rows: AttributeItem[] = [];
  const initial: XmlElement[] = [node(context, "divisions", String(divisions))];
  const state = instrumentAt(plan, mi, ZERO);
  const transposition = displayTransposition(state, useWritten);
  const key = () =>
    node(context, "key", [
      node(context, "fifths", measure.key.atonal ? 0 : keyFifths(measure.key.fifths, transposition)),
      measure.key.atonal ? node(context, "mode", "none") : undefined,
    ]);
  if (
    mi === 0 ||
    measure.global.key ||
    plan.instrumentChanges.some(
      (change) => change.measureIndex === mi && compare(rational(...change.position), ZERO) === 0,
    )
  )
    initial.push(key());
  initial.push(...meterChanges(context, plan, mi));
  if (mi === 0 && plan.selection.staves.size > 1) initial.push(node(context, "staves", plan.selection.staves.size));
  for (const item of staffAttributes(context, plan, mi)) {
    if (compare(item.position, ZERO) === 0) initial.push(item.element);
    else rows.push({ position: item.position, element: node(context, "attributes", [item.element]) });
  }
  const transposeRows = (position: Rational) => {
    const active = instrumentAt(plan, mi, position);
    const displayed = displayInterval(
      measure.key.atonal ? 0 : measure.key.fifths,
      displayTransposition(active, useWritten),
    );
    if (useWritten || displayed || mi !== 0 || compare(position, ZERO) !== 0)
      rows.push({
        position,
        element: node(context, "attributes", [
          transposeElement(context, displayed ?? { staffDistance: 0, halfSteps: 0 }),
        ]),
      });
    if (!useWritten && active.transposition?.interval)
      rows.push({
        position,
        element: node(context, "attributes", [
          node(context, "for-part", [
            transposeElement(
              context,
              displayInterval(measure.key.atonal ? 0 : measure.key.fifths, active.transposition)!,
              "part-transpose",
            ),
          ]),
        ]),
      });
  };
  rows.unshift({ position: ZERO, element: node(context, "attributes", initial) });
  // Enharmonic key flips can change the diatonic interval without changing its chromatic interval.
  if (mi === 0 || measure.global.key) transposeRows(ZERO);
  for (const change of plan.instrumentChanges.filter((change) => change.measureIndex === mi)) {
    const position = rational(...change.position);
    const changed = displayTransposition(change.state, useWritten);
    if (compare(position, ZERO) !== 0)
      rows.push({
        position,
        element: node(context, "attributes", [
          node(context, "key", [
            node(context, "fifths", measure.key.atonal ? 0 : keyFifths(measure.key.fifths, changed)),
          ]),
        ]),
      });
    transposeRows(position);
  }
  const repeat = score.parts[plan.selection.sourceIndex]!.measures[mi]!.measureRepeat;
  if (repeat)
    rows[0]!.element.appendChild(
      node(context, "measure-style", [node(context, "measure-repeat", repeat.number, { type: "start" })]),
    );
  const endingRepeat = score.parts[plan.selection.sourceIndex]!.measures.findIndex(
    (raw, start) => raw.measureRepeat && start + raw.measureRepeat.number - 1 === mi,
  );
  if (endingRepeat >= 0)
    rows[0]!.element.appendChild(
      node(context, "measure-style", [node(context, "measure-repeat", undefined, { type: "stop" })]),
    );
  return rows.sort((a, b) => compare(a.position, b.position));
}
