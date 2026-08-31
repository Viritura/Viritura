import type {
  Beam,
  LayoutContent,
  LayoutSource,
  Note,
  NoteEvent,
  Part,
  PartMeasure,
  Score,
  ScoreDefinition,
  Sequence,
  SequenceContent,
  TextExpression,
} from "@viritura/core";
import { durationToBeats, generateEventId, generateNoteId, sequenceContentBeats } from "../commands/noteCommands";
import { buildCondensedLayoutContent } from "../app/condensedLayout";
import { parsePlayerRoutingLabel, type PlayerRouting } from "./routingText";
import { SPLIT_POLICIES, type SplitPolicy } from "./splitPolicies";

type RoutingState = "split" | "both" | "first" | "second";

interface ReferenceMaps {
  readonly events: Map<string, string>;
  readonly notes: Map<string, string>;
  readonly dynamics: Map<string, string>;
}

interface RoutingChange {
  readonly beat: number;
  readonly state: RoutingState;
}

export function splitOrchestralParts(score: Score): Score {
  const result = structuredClone(score);
  const splitPartIds = new Map<string, string[]>();
  for (const policy of SPLIT_POLICIES) {
    const playerIds = policy.players.map((_, index) => `${policy.id}-${String(index + 1)}`);
    const partIndex = result.parts.findIndex((candidate) => candidate.id === policy.id);
    const part = result.parts[partIndex];
    const presentPlayers = playerIds.filter((id) => result.parts.some((candidate) => candidate.id === id));
    if (!part && presentPlayers.length === playerIds.length) continue;
    if (!part && presentPlayers.length === 0) {
      throw new Error(`Required orchestral part ${policy.id} is missing.`);
    }
    if (!part || presentPlayers.length > 0) {
      throw new Error(`Orchestral part ${policy.id} has a mixed or incomplete split roster.`);
    }
    if (!policy.acceptedNames.includes(part.name)) {
      throw new Error(`Part ${policy.id} has unexpected name "${part.name}".`);
    }

    const maps = new Map<number, ReferenceMaps>();
    for (let staff = 1; staff <= policy.players.length; staff += 1) {
      maps.set(staff, { events: new Map(), notes: new Map(), dynamics: new Map() });
    }
    const routing = new Map<number, RoutingState>([[1, "split"]]);
    const routedMeasures = part.measures.map((measure, measureIndex) =>
      splitMeasure(measure, policy, routing, maps, measureIndex),
    );
    repairPartReferences(routedMeasures, maps);
    const splitParts = policy.players.map((player, index) =>
      makePlayerPart(part, routedMeasures, index + 1, player, maps.get(index + 1)!),
    );
    result.parts.splice(partIndex, 1, ...splitParts);
    splitPartIds.set(
      policy.id,
      splitParts.map((splitPart) => splitPart.id!),
    );
  }

  if (splitPartIds.size === 0) return result;
  remapSoundAssignments(result, splitPartIds);
  rebuildLayoutsAndScores(result, score, splitPartIds);
  return result;
}

export function refreshOrchestralCondensedScore(score: Score): Score {
  validateSplitRoster(score);
  const result = structuredClone(score);
  const fullScore = result.scores?.find((definition) => (definition.name ?? "").trim().toLowerCase() === "full score");
  const condensedScore = result.scores?.find(
    (definition) => (definition.name ?? "").trim().toLowerCase() === "condensed score",
  );
  const fullLayoutId = fullScore && scoreLayoutIds(fullScore)[0];
  const condensedLayoutId = condensedScore && scoreLayoutIds(condensedScore)[0];
  const fullLayout = result.layouts?.find((layout) => layout.id === fullLayoutId);
  const condensedLayout = result.layouts?.find((layout) => layout.id === condensedLayoutId);
  if (!fullLayout || !condensedLayout) {
    throw new Error("The orchestral condensed-score refresh requires Full Score and Condensed Score layouts.");
  }

  for (const layout of result.layouts ?? []) {
    layout.content = ensureSplitPlayerStaffLabels(layout.content);
  }
  fullLayout.content = normalizeSplitPlayerBraceGroups(fullLayout.content);
  condensedLayout.content = buildCondensedLayoutContent(fullLayout.content, result.parts);
  return result;
}

function makePlayerPart(
  source: Part,
  routedMeasures: readonly PartMeasure[],
  playerNumber: number,
  player: { readonly name: string; readonly shortName: string },
  referenceMaps: ReferenceMaps,
): Part {
  const part: Part = {
    ...source,
    id: `${source.id!}-${String(playerNumber)}`,
    name: player.name,
    shortName: player.shortName,
    measures: routedMeasures.map((measure) => extractPlayerMeasure(measure, playerNumber, referenceMaps)),
  };
  delete part.staves;
  return part;
}

function extractPlayerMeasure(measure: PartMeasure, playerNumber: number, referenceMaps: ReferenceMaps): PartMeasure {
  const sequences = measure.sequences
    .filter((sequence) => (sequence.staff ?? 1) === playerNumber)
    .map((sequence) => normalizeSequenceStaff(sequence));
  const eventIds = new Set(
    collectEvents(sequences.flatMap((sequence) => sequence.content)).flatMap((event) => event.id ?? []),
  );
  return {
    ...measure,
    sequences,
    clefs: normalizeStaffItems(measure.clefs, playerNumber),
    arpeggios: measure.arpeggios?.flatMap((arpeggio) => {
      const start = referenceMaps.notes.get(arpeggio.span.start);
      const end = referenceMaps.notes.get(arpeggio.span.end);
      return start && end ? [{ ...arpeggio, id: crypto.randomUUID(), span: { start, end } }] : [];
    }),
    nonArpeggios: measure.nonArpeggios?.flatMap((nonArpeggio) => {
      const start = referenceMaps.notes.get(nonArpeggio.span.start);
      const end = referenceMaps.notes.get(nonArpeggio.span.end);
      return start && end ? [{ ...nonArpeggio, id: crypto.randomUUID(), span: { start, end } }] : [];
    }),
    beams: measure.beams?.flatMap((beam) => filterBeam(beam, eventIds) ?? []),
    dynamics: normalizeStaffItems(measure.dynamics, playerNumber, (dynamic) => {
      const normalized = { ...dynamic };
      delete normalized.staff;
      delete normalized.staffEnd;
      return normalized;
    }),
    ottavas: normalizeStaffItems(measure.ottavas, playerNumber),
    pedals: normalizeStaffItems(measure.pedals, playerNumber),
    expressions: normalizeStaffItems(measure.expressions, playerNumber),
  };
}

function normalizeSequenceStaff(sequence: Sequence): Sequence {
  const normalized: Sequence = {
    ...sequence,
    content: sequence.content.map(normalizeContentStaff),
  };
  delete normalized.staff;
  return normalized;
}

function normalizeContentStaff(item: SequenceContent): SequenceContent {
  if (item.type === "event") {
    const normalized = { ...item };
    delete normalized.staff;
    return normalized;
  }
  if (item.type === "tuplet") {
    const normalized = { ...item, content: item.content.map(normalizeContentStaff) };
    delete normalized.staff;
    return normalized;
  }
  if (item.type === "grace" || item.type === "tremolo") {
    return { ...item, content: item.content.map((event) => normalizeContentStaff(event) as NoteEvent) };
  }
  return item;
}

function normalizeStaffItems<T extends { staff?: number }>(
  items: readonly T[] | undefined,
  playerNumber: number,
  normalize: (item: T) => T = (item) => {
    const normalized = { ...item };
    delete normalized.staff;
    return normalized;
  },
): T[] | undefined {
  if (!items) return undefined;
  const retained = items.filter((item) => (item.staff ?? 1) === playerNumber).map(normalize);
  return retained.length > 0 ? retained : undefined;
}

function filterBeam(beam: Beam, eventIds: ReadonlySet<string>): Beam | undefined {
  const events = beam.events.filter((id) => eventIds.has(id));
  const beams = beam.beams?.flatMap((nested) => filterBeam(nested, eventIds) ?? []);
  if (events.length < 2 && (!beams || beams.length === 0)) return undefined;
  return { ...beam, events, ...(beams && beams.length > 0 ? { beams } : { beams: undefined }) };
}

function collectEvents(content: readonly SequenceContent[]): NoteEvent[] {
  return content.flatMap((item): NoteEvent[] => {
    if (item.type === "event") return [item];
    if (item.type === "tuplet") return collectEvents(item.content);
    if (item.type === "grace" || item.type === "tremolo") return item.content;
    return [];
  });
}

function remapSoundAssignments(score: Score, splitPartIds: ReadonlyMap<string, readonly string[]>): void {
  if (!score.soundProfile) return;
  for (const [sourceId, targetIds] of splitPartIds) {
    const assignment = score.soundProfile.parts[sourceId];
    if (!assignment) continue;
    delete score.soundProfile.parts[sourceId];
    for (const targetId of targetIds) score.soundProfile.parts[targetId] = structuredClone(assignment);
  }
}

function rebuildLayoutsAndScores(
  result: Score,
  source: Score,
  splitPartIds: ReadonlyMap<string, readonly string[]>,
): void {
  const sourceLayouts = source.layouts ?? [];
  const sourceScores = source.scores ?? [];
  const obsoleteLayoutIds = new Set<string>();
  const sourcePartScores = new Map<string, ScoreDefinition>();
  const condensedScores = sourceScores.filter(
    (definition) => (definition.name ?? "").trim().toLowerCase() === "condensed score",
  );
  const condensedLayoutIds = new Set(condensedScores.flatMap(scoreLayoutIds));
  for (const layoutId of condensedLayoutIds) obsoleteLayoutIds.add(layoutId);
  for (const layout of sourceLayouts) {
    const sourcePartId = singleSourcePartId(layout.content);
    if (sourcePartId && splitPartIds.has(sourcePartId)) obsoleteLayoutIds.add(layout.id);
  }
  for (const scoreDefinition of sourceScores) {
    for (const layoutId of scoreLayoutIds(scoreDefinition)) {
      const layout = sourceLayouts.find((candidate) => candidate.id === layoutId);
      const sourcePartId = layout && singleSourcePartId(layout.content);
      if (sourcePartId && splitPartIds.has(sourcePartId)) {
        sourcePartScores.set(sourcePartId, scoreDefinition);
      }
    }
  }

  const retainedLayouts = sourceLayouts
    .filter((layout) => !obsoleteLayoutIds.has(layout.id))
    .map((layout) => ({
      ...layout,
      content: normalizeSplitPlayerBraceGroups(
        ensureSplitPlayerStaffLabels(layout.content.flatMap((node) => expandLayoutNode(node, splitPartIds))),
      ),
    }));
  if (retainedLayouts.length === 0) {
    retainedLayouts.push({
      id: "full-score",
      content: result.parts.flatMap((part): LayoutContent[] =>
        part.id
          ? [{ type: "staff", sources: [{ part: part.id }], ...(isSplitPlayerId(part.id) ? { labelref: "name" } : {}) }]
          : [],
      ),
    });
  }
  const fullScore = sourceScores[0];
  const fullLayoutId = fullScore ? scoreLayoutIds(fullScore)[0] : retainedLayouts[0]?.id;
  const fullLayout = retainedLayouts.find((layout) => layout.id === fullLayoutId) ?? retainedLayouts[0];
  if (!fullLayout) throw new Error("The orchestral split requires a full-score layout.");

  const usedLayoutIds = new Set(retainedLayouts.map((layout) => layout.id));
  for (const policy of SPLIT_POLICIES.filter((candidate) => splitPartIds.has(candidate.id))) {
    const inherited = sourcePartScores.get(policy.id);
    for (const player of policy.players.map(
      (_, index) => result.parts.find((part) => part.id === `${policy.id}-${String(index + 1)}`)!,
    )) {
      const layoutId = uniqueId(`part-${player.id!}`, usedLayoutIds);
      retainedLayouts.push({
        id: layoutId,
        content: [{ type: "staff", sources: [{ part: player.id! }], labelref: "name" }],
      });
      sourcePartScores.set(player.id!, {
        name: player.name,
        layout: layoutId,
        ...((inherited?.useWritten ?? Boolean(player.transposition)) ? { useWritten: true } : {}),
      });
    }
  }

  const condensedId = uniqueId("condensed-score", usedLayoutIds);
  retainedLayouts.push({
    id: condensedId,
    content: buildCondensedLayoutContent(fullLayout.content, result.parts),
  });
  result.layouts = retainedLayouts;

  const retainedScores = sourceScores.filter((scoreDefinition, index) => {
    if (index === 0) return false;
    if ((scoreDefinition.name ?? "").trim().toLowerCase() === "condensed score") return false;
    return !scoreLayoutIds(scoreDefinition).some((layoutId) => obsoleteLayoutIds.has(layoutId));
  });
  const playerScores = [...sourcePartScores.entries()]
    .filter(([partId]) => partId.includes("-"))
    .map(([, scoreDefinition]) => scoreDefinition);
  const condensedDefinition: ScoreDefinition = {
    ...(condensedScores[0] ?? {}),
    name: "Condensed Score",
    layout: condensedId,
    pages: undefined,
  };
  result.scores = [
    fullScore ? { ...fullScore } : { name: "Full Score", layout: fullLayout.id },
    condensedDefinition,
    ...retainedScores,
    ...playerScores,
  ];
}

function singleSourcePartId(content: readonly LayoutContent[]): string | undefined {
  const sources = content.flatMap(collectLayoutSources);
  const partIds = new Set(sources.map((source) => source.part));
  return partIds.size === 1 ? sources[0]?.part : undefined;
}

function collectLayoutSources(node: LayoutContent): LayoutSource[] {
  return node.type === "group" ? node.content.flatMap(collectLayoutSources) : [...node.sources];
}

function scoreLayoutIds(scoreDefinition: ScoreDefinition): string[] {
  return [
    ...(scoreDefinition.layout ? [scoreDefinition.layout] : []),
    ...(scoreDefinition.pages ?? []).flatMap((page) =>
      page.systems.flatMap((system) => [
        ...(system.layout ? [system.layout] : []),
        ...(system.layoutChanges ?? []).map((change) => change.layout),
      ]),
    ),
  ];
}

function uniqueId(preferred: string, used: Set<string>): string {
  let id = preferred;
  let suffix = 2;
  while (used.has(id)) {
    id = `${preferred}-${String(suffix)}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function validateSplitRoster(score: Score): void {
  const partIds = new Set(score.parts.flatMap((part) => part.id ?? []));
  for (const policy of SPLIT_POLICIES) {
    const playerIds = policy.players.map((_, index) => `${policy.id}-${String(index + 1)}`);
    if (partIds.has(policy.id) || playerIds.some((id) => !partIds.has(id))) {
      throw new Error(`The orchestral condensed-score refresh requires the split ${policy.id} player roster.`);
    }
  }
}

function normalizeSplitPlayerBraceGroups(content: readonly LayoutContent[]): LayoutContent[] {
  return content.map((node): LayoutContent => {
    if (node.type === "staff") return node;
    const normalizedContent = normalizeSplitPlayerBraceGroups(node.content);
    if (node.symbol !== "brace" || !isCompleteSplitPlayerGroup(normalizedContent)) {
      return { ...node, content: normalizedContent };
    }
    return { ...node, symbol: "bracket", content: normalizedContent };
  });
}

function isCompleteSplitPlayerGroup(content: readonly LayoutContent[]): boolean {
  const partIds = new Set(content.flatMap(collectLayoutSources).map((source) => source.part));
  return SPLIT_POLICIES.some((policy) => {
    const expected = policy.players.map((_, index) => `${policy.id}-${String(index + 1)}`);
    return partIds.size === expected.length && expected.every((id) => partIds.has(id));
  });
}

function splitMeasure(
  measure: PartMeasure,
  policy: SplitPolicy,
  routing: Map<number, RoutingState>,
  maps: Map<number, ReferenceMaps>,
  measureIndex: number,
): PartMeasure {
  const expressions = remapExpressions(measure.expressions, policy);
  const sequences: Sequence[] = [];
  for (const [sourceStaff, targets] of policy.sourceTargets) {
    const sourceSequences = measure.sequences.filter((sequence) => (sequence.staff ?? 1) === sourceStaff);
    const pitchedSequences = sourceSequences.filter(sequenceHasPitches);
    const changes = routingChanges(measure.expressions, sourceStaff, targets);
    if (targets.length > 1 && pitchedSequences.length > targets.length) {
      throw new Error(
        `${policy.id} measure ${String(measureIndex + 1)} staff ${String(sourceStaff)} has ` +
          `${String(pitchedSequences.length)} pitched voices for ${String(targets.length)} players.`,
      );
    }

    const directSource = targets.length === 1;
    const explicitVoices = !directSource && pitchedSequences.length > 1;
    let routedPitchedSequence = false;
    for (const sourceSequence of sourceSequences) {
      const assignedTarget = explicitVoices ? targets[pitchedSequences.indexOf(sourceSequence)] : undefined;
      const route =
        !explicitVoices && sequenceHasPitches(sourceSequence)
          ? buildSingleSequenceRouting(sourceSequence, targets, routing.get(sourceStaff) ?? "split", changes)
          : undefined;
      if (route) routing.set(sourceStaff, route.state);
      if (route) routedPitchedSequence = true;
      for (const targetStaff of targets) {
        sequences.push(
          cloneSequenceForStaff(
            sourceSequence,
            targetStaff,
            maps.get(targetStaff)!,
            directSource
              ? true
              : explicitVoices
                ? !sequenceHasPitches(sourceSequence) || assignedTarget === targetStaff
                : (route?.forTarget(targetStaff) ?? true),
          ),
        );
      }
    }
    if (explicitVoices) routing.set(sourceStaff, "split");
    else if (!routedPitchedSequence && changes.length > 0) routing.set(sourceStaff, changes.at(-1)!.state);
  }

  return {
    ...measure,
    sequences,
    clefs: remapStaffItems(
      measure.clefs,
      policy,
      (item) => item.staff,
      (item, staff) => ({ ...item, staff }),
    ),
    dynamics: measure.dynamics?.flatMap((item) =>
      remapStaffItem(item, policy, item.staff, (staff) => {
        const id = crypto.randomUUID();
        maps.get(staff)!.dynamics.set(item.id, id);
        return { ...item, id, staff, ...(item.staffEnd === undefined ? {} : { staffEnd: staff }) };
      }),
    ),
    ottavas: remapStaffItems(
      measure.ottavas,
      policy,
      (item) => item.staff,
      (item, staff) => ({ ...item, staff }),
    ),
    pedals: remapStaffItems(
      measure.pedals,
      policy,
      (item) => item.staff,
      (item, staff) => ({ ...item, staff }),
    ),
    expressions,
  };
}

function buildSingleSequenceRouting(
  sequence: Sequence,
  targets: readonly number[],
  initialState: RoutingState,
  changes: readonly RoutingChange[],
): {
  readonly state: RoutingState;
  readonly forTarget: (targetStaff: number) => (event: NoteEvent) => boolean | Note[];
} {
  let state = initialState;
  let changeIndex = 0;
  const assignments = new Map<NoteEvent, ReadonlyMap<number, Note[]>>();
  for (const { event, beat } of collectPositionedEvents(sequence.content)) {
    while (changeIndex < changes.length && changes[changeIndex]!.beat <= beat) {
      state = changes[changeIndex]!.state;
      changeIndex += 1;
    }
    const notes = event.notes ?? [];
    if (notes.length > targets.length) {
      throw new Error(`Pitched chord with ${String(notes.length)} notes exceeds ${String(targets.length)} players.`);
    }
    if (notes.length === 0) continue;
    if (notes.length === 2) {
      state = "split";
      const sorted = [...notes].sort((left, right) => pitchNumber(right) - pitchNumber(left));
      assignments.set(
        event,
        new Map([
          [targets[0]!, [sorted[0]!]],
          [targets[1]!, [sorted[1]!]],
        ]),
      );
      continue;
    }
    const assignedTargets = state === "both" ? targets : [state === "second" ? targets[1]! : targets[0]!];
    assignments.set(event, new Map(assignedTargets.map((target) => [target, notes])));
  }
  while (changeIndex < changes.length) {
    state = changes[changeIndex]!.state;
    changeIndex += 1;
  }
  return {
    state,
    forTarget: (targetStaff) => (event) => {
      if (!event.notes || event.notes.length === 0) return true;
      return assignments.get(event)?.get(targetStaff) ?? false;
    },
  };
}

function collectPositionedEvents(
  content: readonly SequenceContent[],
  startBeat = 0,
  scale = 1,
): { readonly event: NoteEvent; readonly beat: number }[] {
  const result: { event: NoteEvent; beat: number }[] = [];
  let beat = startBeat;
  for (const item of content) {
    if (item.type === "event") {
      result.push({ event: item, beat });
    } else if (item.type === "tuplet") {
      const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
      result.push(
        ...collectPositionedEvents(item.content, beat, scale * (innerBeats === 0 ? 1 : outerBeats / innerBeats)),
      );
    } else if (item.type === "grace" || item.type === "tremolo") {
      result.push(...item.content.map((event) => ({ event, beat })));
    }
    beat += sequenceContentBeats(item) * scale;
  }
  return result;
}

function cloneSequenceForStaff(
  source: Sequence,
  staff: number,
  maps: ReferenceMaps,
  route: boolean | ((event: NoteEvent) => boolean | Note[]),
): Sequence {
  return {
    ...source,
    staff,
    content: source.content.map((item) => cloneContent(item, staff, maps, route)),
  };
}

function cloneContent(
  source: SequenceContent,
  staff: number,
  maps: ReferenceMaps,
  route: boolean | ((event: NoteEvent) => boolean | Note[]),
): SequenceContent {
  if (source.type === "event") return cloneEvent(source, staff, maps, route);
  if (source.type === "tuplet") {
    return { ...source, staff, content: source.content.map((item) => cloneContent(item, staff, maps, route)) };
  }
  if (source.type === "grace" || source.type === "tremolo") {
    return { ...source, content: source.content.map((event) => cloneEvent(event, staff, maps, route)) };
  }
  return structuredClone(source);
}

function cloneEvent(
  source: NoteEvent,
  staff: number,
  maps: ReferenceMaps,
  route: boolean | ((event: NoteEvent) => boolean | Note[]),
): NoteEvent {
  const event = structuredClone(source);
  const oldEventId = source.id;
  event.id = generateEventId();
  event.staff = staff;
  const routed = typeof route === "function" ? route(source) : route;
  const selectedNotes = routed === true ? source.notes : Array.isArray(routed) ? routed : undefined;
  if (!selectedNotes || selectedNotes.length === 0) {
    delete event.notes;
    delete event.kitNotes;
    event.rest = {};
    delete event.slurs;
    delete event.glissandos;
    delete event.markings;
    delete event.fermata;
    delete event.lyrics;
    return event;
  }

  delete event.rest;
  event.notes = selectedNotes.map((sourceNote) => {
    const note = structuredClone(sourceNote);
    const oldNoteId = sourceNote.id;
    note.id = generateNoteId();
    if (oldNoteId) maps.notes.set(oldNoteId, note.id);
    return note;
  });
  if (oldEventId) maps.events.set(oldEventId, event.id);
  return event;
}

function repairPartReferences(measures: readonly PartMeasure[], maps: Map<number, ReferenceMaps>): void {
  for (const measure of measures) {
    for (const sequence of measure.sequences) {
      const referenceMaps = maps.get(sequence.staff ?? 1)!;
      for (const item of sequence.content) repairContentReferences(item, referenceMaps);
    }
    measure.beams = remapBeams(measure.beams, maps);
    for (const dynamic of measure.dynamics ?? []) {
      if (dynamic.visuallyContinues) {
        dynamic.visuallyContinues = maps.get(dynamic.staff ?? 1)?.dynamics.get(dynamic.visuallyContinues);
      }
    }
  }
}

function repairContentReferences(item: SequenceContent, maps: ReferenceMaps): void {
  if (item.type === "event") {
    repairEventReferences(item, maps);
  } else if (item.type === "tuplet") {
    item.content.forEach((child) => repairContentReferences(child, maps));
  } else if (item.type === "grace" || item.type === "tremolo") {
    item.content.forEach((event) => repairEventReferences(event, maps));
  }
}

function repairEventReferences(event: NoteEvent, maps: ReferenceMaps): void {
  if (event.slurs) {
    event.slurs = event.slurs.flatMap((slur) => {
      const target = maps.events.get(slur.target);
      if (!target) return [];
      return [
        {
          ...slur,
          target,
          ...(slur.startNote && maps.notes.has(slur.startNote)
            ? { startNote: maps.notes.get(slur.startNote) }
            : { startNote: undefined }),
          ...(slur.endNote && maps.notes.has(slur.endNote)
            ? { endNote: maps.notes.get(slur.endNote) }
            : { endNote: undefined }),
        },
      ];
    });
    if (event.slurs.length === 0) delete event.slurs;
  }
  if (event.glissandos) {
    event.glissandos = event.glissandos.flatMap((glissando) => {
      const target = maps.notes.get(glissando.target);
      return target ? [{ ...glissando, target }] : [];
    });
    if (event.glissandos.length === 0) delete event.glissandos;
  }
  for (const note of event.notes ?? []) {
    if (!note.ties) continue;
    note.ties = note.ties.flatMap((tie) => {
      if (!tie.target) return [tie];
      const target = maps.notes.get(tie.target);
      return target ? [{ ...tie, target }] : [];
    });
    if (note.ties.length === 0) delete note.ties;
  }
}

function remapBeams(beams: readonly Beam[] | undefined, maps: Map<number, ReferenceMaps>): Beam[] | undefined {
  if (!beams) return undefined;
  const result: Beam[] = [];
  for (const referenceMaps of maps.values()) {
    for (const beam of beams) {
      const remapped = remapBeam(beam, referenceMaps.events);
      if (remapped) result.push(remapped);
    }
  }
  return result;
}

function remapBeam(beam: Beam, eventMap: ReadonlyMap<string, string>): Beam | undefined {
  const events = beam.events.flatMap((id) => eventMap.get(id) ?? []);
  const beams = beam.beams?.flatMap((nested) => remapBeam(nested, eventMap) ?? []);
  if (events.length < 2 && (!beams || beams.length === 0)) return undefined;
  return { ...beam, events, ...(beams && beams.length > 0 ? { beams } : { beams: undefined }) };
}

function remapExpressions(
  expressions: readonly TextExpression[] | undefined,
  policy: SplitPolicy,
): TextExpression[] | undefined {
  if (!expressions) return undefined;
  const retained: TextExpression[] = [];
  for (const expression of expressions) {
    if (parsePlayerRoutingLabel(expression.text)) continue;
    retained.push(...remapStaffItem(expression, policy, expression.staff, (staff) => ({ ...expression, staff })));
  }
  return retained.length > 0 ? retained : undefined;
}

function routingChanges(
  expressions: readonly TextExpression[] | undefined,
  sourceStaff: number,
  targets: readonly number[],
): RoutingChange[] {
  return (expressions ?? [])
    .flatMap((expression): RoutingChange[] => {
      if ((expression.staff ?? 1) !== sourceStaff) return [];
      const state = routingState(parsePlayerRoutingLabel(expression.text), targets);
      if (!state) return [];
      return [{ beat: (expression.position.fraction[0] / expression.position.fraction[1]) * 4, state }];
    })
    .sort((left, right) => left.beat - right.beat);
}

function remapStaffItems<T>(
  items: readonly T[] | undefined,
  policy: SplitPolicy,
  getStaff: (item: T) => number | undefined,
  clone: (item: T, staff: number) => T,
): T[] | undefined {
  if (!items) return undefined;
  return items.flatMap((item) => remapStaffItem(item, policy, getStaff(item), (staff) => clone(item, staff)));
}

function remapStaffItem<T>(item: T, policy: SplitPolicy, staff: number | undefined, clone: (staff: number) => T): T[] {
  const targets = policy.sourceTargets.get(staff ?? 1);
  return targets ? targets.map(clone) : [item];
}

function routingState(routing: PlayerRouting | null, targets: readonly number[]): RoutingState | undefined {
  if (!routing) return undefined;
  if (routing.kind === "all") return targets.length > 1 ? "both" : "first";

  const selected = targets.filter((target) => routing.players.includes(target));
  if (selected.length === targets.length && targets.length > 1) return "both";
  if (selected[0] === targets[0]) return "first";
  if (selected[0] === targets[1]) return "second";
  return undefined;
}

function sequenceHasPitches(sequence: Sequence): boolean {
  return sequence.content.some(contentHasPitches);
}

function contentHasPitches(item: SequenceContent): boolean {
  if (item.type === "event") return (item.notes?.length ?? 0) > 0;
  if (item.type === "tuplet") return item.content.some(contentHasPitches);
  if (item.type === "grace" || item.type === "tremolo")
    return item.content.some((event) => (event.notes?.length ?? 0) > 0);
  return false;
}

function pitchNumber(note: Note): number {
  const steps: Record<Note["pitch"]["step"], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return note.pitch.octave * 12 + steps[note.pitch.step] + (note.pitch.alter ?? 0);
}

function expandLayoutNode(node: LayoutContent, splitPartIds: ReadonlyMap<string, readonly string[]>): LayoutContent[] {
  if (node.type === "group") {
    return [{ ...node, content: node.content.flatMap((child) => expandLayoutNode(child, splitPartIds)) }];
  }
  const expandedSources = node.sources.flatMap((source) => expandLayoutSource(source, splitPartIds));
  if (
    expandedSources.length === node.sources.length &&
    expandedSources.every((source, index) => source === node.sources[index])
  ) {
    return [node];
  }
  return expandedSources.map((source, index) => ({
    type: "staff",
    sources: [source],
    ...(index === 0 && node.label !== undefined ? { label: node.label } : {}),
    ...(node.labelref !== undefined ? { labelref: node.labelref } : {}),
    ...(node.labelref === undefined && (index > 0 || !node.label?.trim()) ? { labelref: "name" } : {}),
  }));
}

function ensureSplitPlayerStaffLabels(content: readonly LayoutContent[]): LayoutContent[] {
  return content.map((node): LayoutContent => {
    if (node.type === "group") {
      return { ...node, content: ensureSplitPlayerStaffLabels(node.content) };
    }
    const partId = node.sources.length === 1 ? node.sources[0]?.part : undefined;
    if (!partId || !isSplitPlayerId(partId) || node.label?.trim()) return node;
    return { ...node, labelref: "name" };
  });
}

function isSplitPlayerId(partId: string): boolean {
  return SPLIT_POLICIES.some((policy) =>
    policy.players.some((_, index) => partId === `${policy.id}-${String(index + 1)}`),
  );
}

function expandLayoutSource(
  source: LayoutSource,
  splitPartIds: ReadonlyMap<string, readonly string[]>,
): LayoutSource[] {
  const policy = SPLIT_POLICIES.find((candidate) => candidate.id === source.part);
  const playerIds = splitPartIds.get(source.part);
  if (!policy || !playerIds) return [source];
  const sourceStaff = source.staff ?? 1;
  const directStaffMapping = [...policy.sourceTargets.values()].every((targets) => targets.length === 1);
  const targets =
    source.staff === undefined && directStaffMapping
      ? [...policy.sourceTargets.values()].flat()
      : policy.sourceTargets.get(sourceStaff);
  return targets ? targets.map((staff) => ({ ...source, part: playerIds[staff - 1]!, staff: undefined })) : [source];
}
