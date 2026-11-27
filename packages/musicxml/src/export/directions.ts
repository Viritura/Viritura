import {
  dynamicSpelling,
  partShowsChordSymbols,
  plainTextContent,
  type DiagnosticCollector,
  type GlobalMeasure,
  type MeasureRhythmicPosition,
  type MusicText,
  type Score,
  type Tempo,
} from "@viritura/core";
import type { PartPlan } from "./types";
import {
  compare,
  durationOf,
  multiply,
  noteType,
  rational,
  rebasePosition,
  ticks,
  ZERO,
  type Rational,
} from "./rhythm";
import { displayTransposition, instrumentAt } from "./instruments";
import { displayInterval } from "./pitch";
import { harmonyElement } from "./harmony";
import { includesDirection } from "./selection";
import { textElements } from "./text";
import { node, placement, type XmlAttributes, type XmlContext, type XmlElement } from "./xml";

export interface DirectionItem {
  position: Rational;
  content: XmlElement[];
  sound?: XmlElement;
  attributes?: XmlAttributes;
  staff?: number;
  voice?: string;
  harmony?: XmlElement;
}

interface DirectionWriter {
  context: XmlContext;
  score: Score;
  plan: PartPlan;
  diagnostics: DiagnosticCollector;
  add: (mi: number, item: DirectionItem) => void;
  end: (end: MeasureRhythmicPosition, staff: number) => { mi: number; position: Rational };
  number: (kind: string, mi: number, position: Rational, end: { mi: number; position: Rational }) => number;
}

function outputStaff(plan: PartPlan, staff?: number): number | undefined {
  return plan.selection.staves.get(staff ?? [...plan.selection.staves.keys()][0]!);
}

function outputVoice(plan: PartPlan, voice?: string, staff?: number): string | undefined {
  if (voice === undefined) return undefined;
  const sourceStaff = staff ?? [...plan.selection.staves.keys()][0]!;
  for (const measure of plan.measures) {
    const sequence = measure.sequences.find(
      (candidate) => candidate.sourceStaff === sourceStaff && candidate.sequence.voice === voice,
    );
    if (sequence) return sequence.voice;
  }
  throw new Error(`Direction references missing voice "${voice}".`);
}

function dynamicDirections(writer: DirectionWriter, mi: number): void {
  const { context, plan } = writer;
  const groups = [...(plan.selection.part.measures[mi]!.dynamics ?? [])].sort((a, b) =>
    compare(rational(...a.position.fraction), rational(...b.position.fraction)),
  );
  for (const group of groups) {
    if (!includesDirection(plan.selection, group.staff, group.voice)) continue;
    const staff = outputStaff(plan, group.staff);
    if (!staff) continue;
    const voice = outputVoice(plan, group.voice, group.staff);
    const position = scaledPosition(plan, mi, group.position.fraction, group.staff);
    if (group.type === "gradual") {
      const end = writer.end(group.end, group.staffEnd ?? group.staff ?? 1);
      const number = writer.number("wedge", mi, position, end);
      writer.add(mi, {
        position,
        staff,
        voice,
        content: [
          node(context, "direction-type", [
            node(context, "wedge", undefined, {
              type: group.wedgeType === "increasing" ? "crescendo" : "diminuendo",
              number,
            }),
          ]),
        ],
        attributes: { placement: placement(group.placement) ?? "below" },
      });
      writer.add(end.mi, {
        position: end.position,
        staff: outputStaff(plan, group.staffEnd ?? group.staff),
        voice,
        content: [node(context, "direction-type", [node(context, "wedge", undefined, { type: "stop", number })])],
      });
    } else {
      const spelling = dynamicSpelling(group);
      const known = /^(?:p{1,6}|f{1,6}|mp|mf|sf|sfp|sfpp|fp|rf|rfz|sfz|sffz|fz|pf|sfzp)$/u.test(spelling);
      writer.add(mi, {
        position,
        staff,
        voice,
        content: [
          node(context, "direction-type", [
            node(context, "dynamics", [
              node(context, known ? spelling : "other-dynamics", known ? undefined : spelling),
            ]),
          ]),
        ],
        attributes: { placement: placement(group.placement) ?? "below" },
      });
    }
  }
}

function octaveDirections(writer: DirectionWriter, mi: number): void {
  const { context, plan } = writer;
  for (const ottava of plan.selection.part.measures[mi]!.ottavas ?? []) {
    if (!includesDirection(plan.selection, ottava.staff ?? 1, ottava.voice)) continue;
    const staff = outputStaff(plan, ottava.staff ?? 1);
    if (!staff) continue;
    const voice = outputVoice(plan, ottava.voice, ottava.staff ?? 1);
    const end = writer.end(ottava.end, ottava.staff ?? 1);
    const position = scaledPosition(plan, mi, ottava.position.fraction, ottava.staff);
    const number = writer.number("octave", mi, position, end);
    const size = Math.abs(ottava.value) * 7 + 1;
    writer.add(mi, {
      position,
      staff,
      voice,
      content: [
        node(context, "direction-type", [
          node(context, "octave-shift", undefined, { type: ottava.value > 0 ? "down" : "up", size, number }),
        ]),
      ],
    });
    writer.add(end.mi, {
      position: end.position,
      staff,
      voice,
      content: [
        node(context, "direction-type", [node(context, "octave-shift", undefined, { type: "stop", size, number })]),
      ],
    });
  }
}

function pedalDirections(writer: DirectionWriter, mi: number): void {
  const { context, plan } = writer;
  for (const pedal of plan.selection.part.measures[mi]!.pedals ?? []) {
    if (!includesDirection(plan.selection, pedal.staff, pedal.voice)) continue;
    const staff = outputStaff(plan, pedal.staff);
    if (!staff) continue;
    const voice = outputVoice(plan, pedal.voice, pedal.staff);
    const end = writer.end(pedal.end, pedal.staff ?? 1);
    for (const boundary of [
      { mi, position: scaledPosition(plan, mi, pedal.position.fraction, pedal.staff), start: true },
      { ...end, start: false },
    ]) {
      const text =
        pedal.type === "una-corda"
          ? boundary.start
            ? "una corda"
            : "tre corde"
          : pedal.type === "sostenuto" && boundary.start
            ? "Sost. Ped."
            : undefined;
      const content = text ? [node(context, "direction-type", [node(context, "words", text)])] : [];
      if (pedal.type !== "una-corda")
        content.push(
          node(context, "direction-type", [
            node(context, "pedal", undefined, {
              type: boundary.start ? "start" : "stop",
              number: pedal.type === "sostenuto" ? 2 : 1,
              line: pedal.style === "bracket" ? "yes" : "no",
              sign: pedal.style === "bracket" ? "no" : "yes",
            }),
          ]),
        );
      const soundKey =
        pedal.type === "una-corda" ? "soft-pedal" : pedal.type === "sostenuto" ? "sostenuto-pedal" : "damper-pedal";
      writer.add(boundary.mi, {
        position: boundary.position,
        staff,
        voice,
        content,
        sound: node(context, "sound", [], { [soundKey]: boundary.start ? "yes" : "no" }),
      });
    }
  }
}

function globalDirections(writer: DirectionWriter, mi: number): void {
  const { context, score, plan, diagnostics } = writer;
  const global = plan.measures[mi]!.global;
  for (const tempo of global.tempos ?? []) writer.add(mi, tempoItem(context, tempo, diagnostics));
  for (const text of global.systemText ?? []) {
    if (text.tempo)
      writer.add(
        mi,
        tempoItem(
          context,
          { ...text.tempo, location: text.position, text: text.text, showText: text.showText },
          diagnostics,
        ),
      );
    else if (text.showText !== false) writer.add(mi, wordsItem(context, text, diagnostics));
  }
  if (global.rehearsalMark)
    writer.add(mi, {
      position: ZERO,
      content: [
        node(context, "direction-type", [
          node(context, "rehearsal", plainTextContent(global.rehearsalMark.text), {
            enclosure:
              global.rehearsalMark.style === "circled"
                ? "circle"
                : global.rehearsalMark.style === "plain"
                  ? "none"
                  : "square",
          }),
        ]),
      ],
    });
  for (const item of navigationItems(context, score, global, mi)) writer.add(mi, item);
  const ramp = global.gradualTempo;
  if (!ramp) return;
  if (!ramp.systemTextId)
    writer.add(mi, {
      position: rational(...ramp.position.fraction),
      content: [node(context, "direction-type", [node(context, "words", ramp.kind === "accel" ? "accel." : "rit.")])],
    });
  const end = writer.end(ramp.end, 1);
  if (ramp.endBpm !== undefined)
    writer.add(end.mi, {
      position: end.position,
      content: [],
      sound: node(context, "sound", [], { tempo: ramp.endBpm }),
    });
  diagnostics.warn(
    `/global/measures/${mi}`,
    "Gradual tempo text and an explicit final tempo are retained; the playback curve is not portable to MusicXML.",
    "musicxml-tempo-ramp",
  );
}

function scaledPosition(plan: PartPlan, mi: number, position: readonly [number, number], staff = 1): Rational {
  const scale = plan.measures[mi]!.staffMeters.get(staff)?.ratioToGlobal;
  return multiply(rational(position[0], position[1]), scale ? rational(scale.num, scale.den) : rational(1));
}

function tempoItem(context: XmlContext, tempo: Tempo, diagnostics: DiagnosticCollector): DirectionItem {
  const content: XmlElement[] = [];
  if (tempo.text && tempo.showText !== false)
    content.push(node(context, "direction-type", textElements(context, tempo.text, diagnostics)));
  if (tempo.bpm !== undefined && tempo.showMetronomeMark !== false) {
    const type = noteType(tempo.value);
    if (type)
      content.push(
        node(context, "direction-type", [
          node(context, "metronome", [
            node(context, "beat-unit", type),
            ...Array.from({ length: tempo.value.dots ?? 0 }, () => node(context, "beat-unit-dot")),
            node(context, "per-minute", tempo.bpm),
          ]),
        ]),
      );
    else
      diagnostics.warn(
        "",
        "This metronome note value has no MusicXML equivalent; its exact playback tempo is retained.",
        "musicxml-metronome-value",
      );
  }
  const swing = tempo.swing;
  const soundContent: XmlElement[] = [];
  if (swing) {
    if (swing.mode === "swing" && swing.ratio.some((value) => !Number.isSafeInteger(value) || value <= 0))
      throw new Error("Invalid swing ratio in MusicXML export.");
    soundContent.push(
      node(
        context,
        "swing",
        swing.mode === "straight"
          ? [node(context, "straight")]
          : [
              node(context, "first", swing.ratio[0]),
              node(context, "second", swing.ratio[1]),
              node(context, "swing-type", swing.subdivision),
            ],
      ),
    );
  }
  const quarterBpm =
    tempo.bpm === undefined
      ? undefined
      : (tempo.bpm * Number(durationOf(tempo.value).n) * 4) / Number(durationOf(tempo.value).d);
  if (quarterBpm !== undefined && (!Number.isFinite(quarterBpm) || quarterBpm <= 0))
    throw new Error("Invalid tempo in MusicXML export.");
  const sound =
    quarterBpm !== undefined || soundContent.length
      ? node(context, "sound", soundContent, { tempo: quarterBpm })
      : undefined;
  return {
    position: tempo.location ? rational(...tempo.location.fraction) : ZERO,
    content,
    sound,
    attributes: { placement: "above" },
  };
}

function wordsItem(context: XmlContext, text: MusicText, diagnostics: DiagnosticCollector): DirectionItem {
  const offset = text.manualOffset;
  return {
    position: rational(...text.position.fraction),
    content: [
      node(
        context,
        "direction-type",
        textElements(context, text.text, diagnostics, "words", {
          "relative-x": offset ? offset[0] * 10 : undefined,
          "relative-y": offset ? offset[1] * 10 : undefined,
        }),
      ),
    ],
    attributes: { placement: placement(text.placement) },
  };
}

function navigationItems(context: XmlContext, score: Score, global: GlobalMeasure, mi: number): DirectionItem[] {
  const result: DirectionItem[] = [];
  for (const [tag, marker] of [
    ["segno", global.segno],
    ["coda", global.coda],
  ] as const) {
    if (!marker) continue;
    const content =
      marker.text?.placement === "replace"
        ? []
        : [
            node(context, "direction-type", [
              node(context, tag, undefined, { smufl: marker.glyph, color: marker.color }),
            ]),
          ];
    if (marker.text)
      content.push(node(context, "direction-type", [node(context, "words", plainTextContent(marker.text.content))]));
    result.push({
      position: rational(...marker.location.fraction),
      content,
      sound: node(context, "sound", [], { [tag]: `${tag}-${mi}` }),
    });
  }
  if (global.fine)
    result.push({
      position: rational(...global.fine.location.fraction),
      content: [
        node(context, "direction-type", [
          node(context, "words", global.fine.text ? plainTextContent(global.fine.text.content) : "Fine"),
        ]),
      ],
      sound: node(context, "sound", [], { fine: "yes" }),
    });
  if (global.jump) {
    const jump = global.jump;
    const labels = {
      dc: "D.C.",
      dcAlCoda: "D.C. al Coda",
      dcAlFine: "D.C. al Fine",
      dsAlCoda: "D.S. al Coda",
      dsAlFine: "D.S. al Fine",
      segno: "D.S.",
      toCoda: "To Coda",
    };
    const segno = score.global.measures.findLastIndex((measure, i) => i <= mi && measure.segno !== undefined);
    const coda = score.global.measures.findIndex((measure, i) => i > mi && measure.coda !== undefined);
    const attributes: Record<string, string> = {};
    if (jump.type.startsWith("dc")) attributes.dacapo = "yes";
    else if (jump.type === "toCoda") {
      if (coda < 0) throw new Error("To Coda has no later coda destination.");
      attributes.tocoda = `coda-${coda}`;
    } else {
      if (segno < 0) throw new Error("D.S. has no preceding segno destination.");
      attributes.dalsegno = `segno-${segno}`;
    }
    result.push({
      position: rational(...jump.location.fraction),
      content: [
        node(context, "direction-type", [
          node(context, "words", jump.text ? plainTextContent(jump.text.content) : labels[jump.type]),
        ]),
      ],
      sound: node(context, "sound", [], attributes),
    });
  }
  return result;
}

export function buildDirections(
  context: XmlContext,
  score: Score,
  plan: PartPlan,
  includeGlobal: boolean,
  useWritten: boolean,
  diagnostics: DiagnosticCollector,
): DirectionItem[][] {
  const rows: DirectionItem[][] = plan.measures.map(() => []);
  const ids = new Map(score.global.measures.map((measure, mi) => [measure.id, mi]));
  const addItem = (mi: number, item: DirectionItem) => {
    if (!rows[mi]) throw new Error("Direction references a missing measure.");
    rows[mi]!.push(item);
  };
  const endPosition = (end: MeasureRhythmicPosition, staff: number) => {
    const mi = ids.get(end.measure);
    if (mi === undefined) throw new Error(`Direction references missing measure "${end.measure}".`);
    return { mi, position: scaledPosition(plan, mi, end.position.fraction, staff) };
  };
  const spans = new Map<string, { mi: number; position: Rational }[]>();
  const spanNumber = (kind: string, mi: number, position: Rational, end: ReturnType<typeof endPosition>) => {
    const activeEnds = spans.get(kind) ?? [];
    let index = activeEnds.findIndex((old) => old.mi < mi || (old.mi === mi && compare(old.position, position) <= 0));
    if (index < 0) index = activeEnds.length;
    if (index >= 16) throw new Error(`More than 16 simultaneous ${kind} lines cannot be represented in MusicXML.`);
    activeEnds[index] = end;
    spans.set(kind, activeEnds);
    return index + 1;
  };
  const writer: DirectionWriter = {
    context,
    score,
    plan,
    diagnostics,
    add: addItem,
    end: endPosition,
    number: spanNumber,
  };
  plan.measures.forEach((measure, mi) => {
    const raw = plan.selection.part.measures[mi]!;
    const global = measure.global;
    if (includeGlobal) globalDirections(writer, mi);
    if (
      partShowsChordSymbols(plan.selection.part) ||
      (includeGlobal && plan.selection.part.chordSymbolVisibility !== "hide")
    ) {
      for (const chord of global.chordSymbols ?? []) {
        const state = instrumentAt(plan, mi, rational(...chord.position.fraction));
        addItem(mi, {
          position: rational(...chord.position.fraction),
          content: [],
          harmony: harmonyElement(
            context,
            chord,
            displayInterval(measure.key.fifths, displayTransposition(state, useWritten)),
            diagnostics,
            plan.selection.part.id,
          ),
        });
      }
    }
    for (const expression of raw.expressions ?? []) {
      if (
        !includesDirection(plan.selection, expression.staff, expression.voice) ||
        (expression.staff !== undefined && !plan.selection.staves.has(expression.staff))
      )
        continue;
      const item = wordsItem(context, expression, diagnostics);
      item.position = scaledPosition(plan, mi, expression.position.fraction, expression.staff);
      item.staff = plan.selection.staves.get(expression.staff ?? [...plan.selection.staves.keys()][0]!);
      item.voice = outputVoice(plan, expression.voice, expression.staff);
      addItem(mi, item);
    }
    dynamicDirections(writer, mi);
    octaveDirections(writer, mi);
    pedalDirections(writer, mi);
    for (const change of plan.instrumentChanges.filter((change) => change.measureIndex === mi)) {
      const text =
        change.change.instruction?.text ??
        (change.change.instrument
          ? `To ${change.state.instrument?.name ?? change.state.instrument?.instrumentId ?? plan.selection.part.name}`
          : undefined);
      const content =
        change.change.instruction?.hidden || !text
          ? []
          : [node(context, "direction-type", [node(context, "words", text)])];
      addItem(mi, { position: rational(...change.position), content });
    }
  });
  return normalizeDirections(rows, plan, diagnostics);
}

function normalizeDirections(
  rows: DirectionItem[][],
  plan: PartPlan,
  diagnostics: DiagnosticCollector,
): DirectionItem[][] {
  const normalized: DirectionItem[][] = rows.map(() => []);
  const durations = plan.measures.map((measure) => measure.duration);
  rows.forEach((items, mi) => {
    for (const item of items) {
      const rebased = rebasePosition(mi, item.position, durations);
      const target = rebased.mi;
      item.position = rebased.position;
      if (target !== mi)
        diagnostics.info(
          `/parts/${plan.selection.sourceIndex}/measures/${mi}`,
          "A direction crossing a barline is exported in the adjacent measure at the same musical time.",
          "musicxml-direction-barline",
        );
      normalized[target]!.push(item);
    }
  });
  return normalized;
}

export function directionElement(context: XmlContext, item: DirectionItem, divisions: bigint): XmlElement {
  if (item.harmony) {
    const offset = node(context, "offset", ticks(item.position, divisions));
    item.harmony.appendChild(offset);
    return item.harmony;
  }
  return node(
    context,
    "direction",
    [
      ...(item.content.length ? item.content : [node(context, "direction-type", [node(context, "words", "")])]),
      node(context, "offset", ticks(item.position, divisions), { sound: item.sound ? "yes" : undefined }),
      item.voice ? node(context, "voice", item.voice) : undefined,
      item.staff ? node(context, "staff", item.staff) : undefined,
      item.sound,
    ],
    item.attributes,
  );
}
