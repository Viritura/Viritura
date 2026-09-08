import { useCallback, useMemo } from "react";
import type {
  ArpeggioMarkKind,
  BreathMarkSymbol,
  Fingering,
  NonArpeggio,
  NoteEvent,
  OrnamentType,
  Orientation,
  PartMeasureArpeggio,
  Pedal,
  PedalLineStyle,
  PedalType,
  Score,
} from "@viritura/core";
import { produce } from "../../score/scoreClone";
import type { SelectableElementType } from "../../score/elementTypes";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";

interface SelectedMarkingArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  selectedElementType: SelectableElementType | null;
  selectedEvent: NoteEvent | null;
  updateScore: (score: Score) => void;
}

interface SelectedArpeggio {
  kind: ArpeggioMarkKind;
  value: PartMeasureArpeggio | NonArpeggio;
}

function pedalIndexFor(
  target: NotationSelectionTarget | null,
  selectedElementType: SelectableElementType | null,
): number {
  if (!target || selectedElementType !== "pedal") return Number.NaN;
  return Number.parseInt(target.elementType.match(/^pedal(\d+)$/)?.[1] ?? "", 10);
}

function indexFromElementId(elementId: string, prefix: string): number {
  const match = elementId.match(new RegExp(`/${prefix}(?:ament|ering)?(\\d+)$`));
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function eventAtTarget(score: Score, target: NotationSelectionTarget): NoteEvent | null {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) return null;
  const content =
    score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex]?.content;
  if (!content) return null;
  if (target.graceContainerIndex !== undefined) {
    const container = content[target.graceContainerIndex];
    const event = container?.type === "grace" ? container.content?.[target.eventIndex] : undefined;
    return event?.type === "event" ? event : null;
  }
  if (target.tupletIndex !== undefined) {
    const container = content[target.tupletIndex];
    const event =
      container?.type === "tuplet" || container?.type === "tremolo"
        ? container.content?.[target.eventIndex]
        : undefined;
    return event?.type === "event" ? event : null;
  }
  const event = content[target.eventIndex];
  return event?.type === "event" ? event : null;
}

function sameSpan(value: PartMeasureArpeggio | NonArpeggio, span: { start: string; end: string }): boolean {
  return value.span.start === span.start && value.span.end === span.end;
}

function startsAtSelectedEvent(value: PartMeasureArpeggio | NonArpeggio, event: NoteEvent | null): boolean {
  return event?.notes?.some((note) => note.id === value.span.start) ?? false;
}

function setFractionValue(fraction: [number, number], axis: 0 | 1, value: number): void {
  if (!Number.isInteger(value) || value < (axis === 0 ? 0 : 1)) return;
  fraction[axis] = value;
}

function arpeggioKind(value: PartMeasureArpeggio): ArpeggioMarkKind {
  if (value.arrow === false || value.arrow === undefined) return "plain";
  return value.direction ?? "auto";
}

function resolveSelectedArpeggio(
  score: Score | null,
  target: NotationSelectionTarget | null,
  selectedElementType: SelectableElementType | null,
  selectedEvent: NoteEvent | null,
): SelectedArpeggio | null {
  if (selectedElementType !== "arpeggio" || !score || !target) return null;
  const measure = score.parts[target.partIndex]?.measures[target.measureIndex];
  const arpeggio = measure?.arpeggios?.find((value) => startsAtSelectedEvent(value, selectedEvent));
  if (arpeggio) return { kind: arpeggioKind(arpeggio), value: arpeggio };
  const nonArpeggio = measure?.nonArpeggios?.find((value) => startsAtSelectedEvent(value, selectedEvent));
  return nonArpeggio ? { kind: "nonArpeggio", value: nonArpeggio } : null;
}

export function useSelectedMarking({
  score,
  target,
  selectedElementType,
  selectedEvent,
  updateScore,
}: SelectedMarkingArgs) {
  const fingeringIndex = target ? indexFromElementId(target.elementId, "fing") : 0;
  const pedalIndex = pedalIndexFor(target, selectedElementType);

  const selectedBreath = selectedEvent?.markings?.breath ?? null;
  const selectedFingering = selectedEvent?.markings?.fingerings?.[fingeringIndex] ?? null;
  const selectedOrnaments = selectedEvent?.markings?.ornaments ?? null;
  const selectedPedal =
    score && target && Number.isInteger(pedalIndex)
      ? (score.parts[target.partIndex]?.measures[target.measureIndex]?.pedals?.[pedalIndex] ?? null)
      : null;
  const selectedArpeggio = useMemo(
    () => resolveSelectedArpeggio(score, target, selectedElementType, selectedEvent),
    [score, selectedElementType, selectedEvent, target],
  );

  const mutateEvent = useCallback(
    (mutate: (event: NoteEvent) => void) => {
      if (!score || !target) return;
      performance.mark("viritura:input-event");
      const next = produce(score, (draft) => {
        const event = eventAtTarget(draft, target);
        if (event) mutate(event);
      });
      if (next !== score) updateScore(next);
    },
    [score, target, updateScore],
  );

  const mutatePedal = useCallback(
    (mutate: (pedal: Pedal) => void) => {
      if (!score || !target || !Number.isInteger(pedalIndex)) return;
      performance.mark("viritura:input-event");
      const next = produce(score, (draft) => {
        const pedal = draft.parts[target.partIndex]?.measures[target.measureIndex]?.pedals?.[pedalIndex];
        if (pedal) mutate(pedal);
      });
      if (next !== score) updateScore(next);
    },
    [pedalIndex, score, target, updateScore],
  );

  const mutateArpeggio = useCallback(
    (mutate: (value: PartMeasureArpeggio | NonArpeggio) => void) => {
      if (!score || !target || !selectedArpeggio) return;
      const selectedSpan = selectedArpeggio.value.span;
      performance.mark("viritura:input-event");
      const next = produce(score, (draft) => {
        const measure = draft.parts[target.partIndex]?.measures[target.measureIndex];
        const value =
          measure?.arpeggios?.find((item) => sameSpan(item, selectedSpan)) ??
          measure?.nonArpeggios?.find((item) => sameSpan(item, selectedSpan));
        if (value) mutate(value);
      });
      if (next !== score) updateScore(next);
    },
    [score, selectedArpeggio, target, updateScore],
  );

  const setArpeggioKind = useCallback(
    (kind: ArpeggioMarkKind) => {
      if (!score || !target || !selectedArpeggio) return;
      const selectedSpan = selectedArpeggio.value.span;
      performance.mark("viritura:input-event");
      const next = produce(score, (draft) => {
        const measure = draft.parts[target.partIndex]?.measures[target.measureIndex];
        if (!measure) return;
        measure.arpeggios = measure.arpeggios?.filter((value) => !sameSpan(value, selectedSpan));
        measure.nonArpeggios = measure.nonArpeggios?.filter((value) => !sameSpan(value, selectedSpan));
        if (measure.arpeggios?.length === 0) delete measure.arpeggios;
        if (measure.nonArpeggios?.length === 0) delete measure.nonArpeggios;
        const common = {
          position: selectedArpeggio.value.position,
          span: selectedArpeggio.value.span,
          id: selectedArpeggio.value.id,
        };
        if (kind === "nonArpeggio") {
          measure.nonArpeggios = [...(measure.nonArpeggios ?? []), common];
        } else {
          measure.arpeggios = [
            ...(measure.arpeggios ?? []),
            { ...common, direction: kind === "plain" ? "auto" : kind, arrow: kind !== "plain" },
          ];
        }
      });
      if (next !== score) updateScore(next);
    },
    [score, selectedArpeggio, target, updateScore],
  );

  return {
    selectedBreath: selectedElementType === "breath" ? selectedBreath : null,
    selectedFingering: selectedElementType === "fingering" ? selectedFingering : null,
    selectedOrnaments: selectedElementType === "ornament" ? selectedOrnaments : null,
    selectedArpeggio,
    selectedPedal: selectedElementType === "pedal" ? selectedPedal : null,
    setBreathSymbol: (symbol: BreathMarkSymbol) =>
      mutateEvent((event) => {
        if (event.markings?.breath) event.markings.breath.symbol = symbol;
      }),
    setBreathOrientation: (orient: Orientation | undefined) =>
      mutateEvent((event) => {
        if (event.markings?.breath) event.markings.breath.orient = orient;
      }),
    setFingeringValue: (finger: Fingering["finger"]) =>
      mutateEvent((event) => {
        const fingering = event.markings?.fingerings?.[fingeringIndex];
        if (fingering) fingering.finger = finger;
      }),
    setOrnament: (index: number, ornament: OrnamentType) =>
      mutateEvent((event) => {
        if (event.markings?.ornaments?.[index]) event.markings.ornaments[index] = ornament;
      }),
    setArpeggioKind,
    setArpeggioPosition: (axis: 0 | 1, value: number) =>
      mutateArpeggio((arpeggio) => {
        setFractionValue(arpeggio.position.fraction, axis, value);
      }),
    setArpeggioSpan: (endpoint: "start" | "end", value: string) =>
      mutateArpeggio((arpeggio) => {
        if (value) arpeggio.span[endpoint] = value;
      }),
    setPedalType: (type: PedalType) => mutatePedal((pedal) => void (pedal.type = type)),
    setPedalStyle: (style: PedalLineStyle) => mutatePedal((pedal) => void (pedal.style = style)),
    setPedalPosition: (axis: 0 | 1, value: number) =>
      mutatePedal((pedal) => {
        setFractionValue(pedal.position.fraction, axis, value);
      }),
    setPedalEndMeasure: (measure: string) =>
      mutatePedal((pedal) => {
        if (measure) pedal.end.measure = measure;
      }),
    setPedalEndPosition: (axis: 0 | 1, value: number) =>
      mutatePedal((pedal) => {
        setFractionValue(pedal.end.position.fraction, axis, value);
      }),
    setPedalStaff: (staff: number | undefined) =>
      mutatePedal((pedal) => {
        if (staff === undefined || (Number.isInteger(staff) && staff > 0)) pedal.staff = staff;
      }),
    setPedalVoice: (voice: string) => mutatePedal((pedal) => void (pedal.voice = voice || undefined)),
  };
}
