/**
 * MNX Serializer — Part and PartMeasure subtree.
 * Split out of serializer.ts to keep the main file under the 600-line budget
 * and the `serializeMnx` entry point under the per-function line limit.
 */

import type {
  Part,
  PartMeasure,
  PartMeasureArpeggio,
  PositionedClef,
  DynamicGroup,
  Ottava,
  NonArpeggio,
  MeasureRepeat,
  Pedal,
  TextExpression,
  Sequence,
  Beam,
  StaffMeterChange,
} from "@viritura/core";
import { isStaffMeterReset } from "@viritura/core";

type Obj = Record<string, unknown>;

export interface PartSerializerHelpers {
  serializeBeam: (b: Beam) => Obj;
  serializeSequence: (s: Sequence) => Obj;
  serializeTextExpression: (e: TextExpression) => Obj;
}

export function serializePart(part: Part, helpers: PartSerializerHelpers): Obj {
  const partObj: Obj = {};
  if (part.id) partObj["id"] = part.id;
  partObj["measures"] = part.measures.map((pm) => serializePartMeasure(pm, helpers));
  if (part.name) partObj["name"] = part.name;
  if (part.shortName) partObj["shortName"] = part.shortName;
  if (part.staves !== undefined) partObj["staves"] = part.staves;
  if (part.transposition) {
    partObj["transposition"] = serializeTransposition(part.transposition);
  }
  if (part.kit && Object.keys(part.kit).length > 0) {
    partObj["kit"] = serializeKit(part.kit);
  }
  // Instrument identity remains nested in the model; display policy is hoisted.
  const partExt = part._x?.viritura;
  const ext: Obj = {};
  if (partExt) {
    if (partExt.instrumentId !== undefined) ext["instrumentId"] = partExt.instrumentId;
    if (partExt.midiProgram !== undefined) ext["midiProgram"] = partExt.midiProgram;
    if (partExt.family !== undefined) ext["family"] = partExt.family;
    if (partExt.spatial !== undefined) ext["spatial"] = { x: partExt.spatial.x, y: partExt.spatial.y };
  }
  if (part.chordSymbolVisibility !== undefined) ext["chordSymbolVisibility"] = part.chordSymbolVisibility;
  if (Object.keys(ext).length > 0) {
    partObj["_x"] = { viritura: ext };
  }
  return partObj;
}

function serializeTransposition(t: NonNullable<Part["transposition"]>): Obj {
  const out: Obj = {
    interval: {
      halfSteps: t.interval.halfSteps,
      staffDistance: t.interval.staffDistance,
    },
  };
  if (t.keyFifthsFlipAt !== undefined) out["keyFifthsFlipAt"] = t.keyFifthsFlipAt;
  if (t.prefersWrittenPitches !== undefined) out["prefersWrittenPitches"] = t.prefersWrittenPitches;
  return out;
}

function serializeKit(kit: NonNullable<Part["kit"]>): Obj {
  const kitObj: Obj = {};
  for (const [id, c] of Object.entries(kit)) {
    const co: Obj = { staffPosition: c.staffPosition };
    if (c.name !== undefined) co["name"] = c.name;
    if (c.sound !== undefined) co["sound"] = c.sound;
    if (c.notehead !== undefined || c.drumKit !== undefined) {
      const viritura: Obj = {};
      if (c.notehead !== undefined) viritura["notehead"] = c.notehead;
      if (c.drumKit !== undefined) viritura["drumKit"] = c.drumKit;
      co["_x"] = { viritura };
    }
    kitObj[id] = co;
  }
  return kitObj;
}

export function serializePartMeasure(pm: PartMeasure, helpers: PartSerializerHelpers): Obj {
  const mObj: Obj = {};
  if (pm.beams !== undefined) mObj["beams"] = pm.beams.map(helpers.serializeBeam);
  if (pm.arpeggios && pm.arpeggios.length > 0) mObj["arpeggios"] = pm.arpeggios.map(serializeArpeggio);
  if (pm.nonArpeggios && pm.nonArpeggios.length > 0) {
    mObj["nonArpeggios"] = pm.nonArpeggios.map(serializeNonArpeggio);
  }
  if (pm.clefs && pm.clefs.length > 0) mObj["clefs"] = pm.clefs.map(serializePositionedClef);
  if (pm.staffConfigs && pm.staffConfigs.length > 0) {
    mObj["staffConfigs"] = pm.staffConfigs.map(serializePositionedStaffConfig);
  }
  if (pm.dynamics && pm.dynamics.length > 0) mObj["dynamics"] = pm.dynamics.map(serializeDynamicGroup);
  if (pm.ottavas && pm.ottavas.length > 0) mObj["ottavas"] = pm.ottavas.map(serializeOttava);
  if (pm.measureRepeat) mObj["measureRepeat"] = serializeMeasureRepeat(pm.measureRepeat);

  const pmViritura = collectPartMeasureVendorExt(pm, helpers);
  if (Object.keys(pmViritura).length > 0) {
    mObj["_x"] = { viritura: pmViritura };
  }
  mObj["sequences"] = pm.sequences.map(helpers.serializeSequence);
  return mObj;
}

export function serializeArpeggio(a: PartMeasureArpeggio): Obj {
  const out: Obj = { position: a.position, span: a.span };
  if (a.direction !== undefined) out["direction"] = a.direction;
  if (a.arrow !== undefined) out["arrow"] = a.arrow;
  if (a.id !== undefined) out["id"] = a.id;
  return out;
}

export function serializeNonArpeggio(a: NonArpeggio): Obj {
  const out: Obj = { position: a.position, span: a.span };
  if (a.id !== undefined) out["id"] = a.id;
  return out;
}

function serializePositionedClef(pc: PositionedClef): Obj {
  const clefObj: Obj = {
    sign: pc.clef.sign,
    staffPosition: pc.clef.staffPosition,
  };
  if (pc.clef.color) clefObj["color"] = pc.clef.color;
  if (pc.clef.glyph) clefObj["glyph"] = pc.clef.glyph;
  if (pc.clef.octave !== undefined) clefObj["octave"] = pc.clef.octave;
  if (pc.clef.showOctave !== undefined) clefObj["showOctave"] = pc.clef.showOctave;
  if (pc.clef.hide !== undefined) clefObj["hide"] = pc.clef.hide;
  const clefEntry: Obj = { clef: clefObj };
  if (pc.position) clefEntry["position"] = pc.position;
  if (pc.staff !== undefined) clefEntry["staff"] = pc.staff;
  return clefEntry;
}

function serializePositionedStaffConfig(sc: NonNullable<PartMeasure["staffConfigs"]>[number]): Obj {
  const config: Obj = {};
  if (sc.config.id !== undefined) config["id"] = sc.config.id;
  if (sc.config._c !== undefined) config["_c"] = sc.config._c;
  if (sc.config._x !== undefined) config["_x"] = sc.config._x;
  if (sc.config.lines !== undefined) config["lines"] = sc.config.lines;
  const out: Obj = { config };
  if (sc.id !== undefined) out["id"] = sc.id;
  if (sc._c !== undefined) out["_c"] = sc._c;
  if (sc._x !== undefined) out["_x"] = sc._x;
  if (sc.position) out["position"] = sc.position;
  if (sc.staff !== undefined) out["staff"] = sc.staff;
  return out;
}

export function serializeDynamicGroup(d: DynamicGroup): Obj {
  const out: Obj = { id: d.id, position: d.position, type: d.type };
  if (d.value !== undefined) out["value"] = d.value;
  if (d.residualValue !== undefined) out["residualValue"] = d.residualValue;
  if (d.accentPrefix !== undefined) out["accentPrefix"] = d.accentPrefix;
  if (d.accentSuffix !== undefined) out["accentSuffix"] = d.accentSuffix;
  if (d.end !== undefined) out["end"] = d.end;
  if (d.glyphs !== undefined && d.glyphs.length > 0) out["glyphs"] = d.glyphs;
  if (d.placement !== undefined) out["placement"] = d.placement;
  if (d.prefix !== undefined) out["prefix"] = d.prefix;
  if (d.relativeValue !== undefined) out["relativeValue"] = d.relativeValue;
  if (d.staff !== undefined) out["staff"] = d.staff;
  if (d.staffEnd !== undefined) out["staffEnd"] = d.staffEnd;
  if (d.suffix !== undefined) out["suffix"] = d.suffix;
  if (d.visuallyContinues !== undefined) out["visuallyContinues"] = d.visuallyContinues;
  if (d.voice !== undefined) out["voice"] = d.voice;
  if (d.wedgeType !== undefined) out["wedgeType"] = d.wedgeType;
  const viritura: Obj = {};
  if (d.manualOffset) viritura["manualOffset"] = d.manualOffset;
  if (d.avoidCollisions === false) viritura["avoidCollisions"] = false;
  if (Object.keys(viritura).length > 0) out["_x"] = { viritura };
  return out;
}

function serializeMeasureRepeat(mr: MeasureRepeat): Obj {
  const out: Obj = { number: mr.number };
  if (mr.counter) {
    const counter: Obj = { count: mr.counter.count };
    if (mr.counter.placement !== undefined) counter["placement"] = mr.counter.placement;
    out["counter"] = counter;
  }
  if (mr.displayNumber !== undefined) out["displayNumber"] = mr.displayNumber;
  if (mr.staffPosition !== undefined) out["staffPosition"] = mr.staffPosition;
  return out;
}

function serializeOttava(o: Ottava): Obj {
  const out: Obj = { end: o.end, position: o.position, value: o.value };
  if (o.placement !== undefined) out["placement"] = o.placement;
  if (o.staff !== undefined) out["staff"] = o.staff;
  if (o.voice) out["voice"] = o.voice;
  return out;
}

function serializePedal(p: Pedal): Obj {
  const out: Obj = { type: p.type, position: p.position, end: p.end };
  if (p.style) out["style"] = p.style;
  if (p.staff !== undefined) out["staff"] = p.staff;
  if (p.voice) out["voice"] = p.voice;
  return out;
}

function collectPartMeasureVendorExt(pm: PartMeasure, helpers: PartSerializerHelpers): Obj {
  const ext: Obj = {};
  if (pm.pedals && pm.pedals.length > 0) ext["pedals"] = pm.pedals.map(serializePedal);
  if (pm.expressions && pm.expressions.length > 0) {
    ext["expressions"] = pm.expressions.map(helpers.serializeTextExpression);
  }
  if (pm.condensingOverride) ext["condensingOverride"] = pm.condensingOverride;
  if (pm.groupingDisplayOverrides && pm.groupingDisplayOverrides.length > 0) {
    ext["groupingDisplayOverrides"] = pm.groupingDisplayOverrides.map((override) => ({
      staff: override.staff,
      groupingDisplay: override.groupingDisplay,
    }));
  }
  if (pm.staffMeters && pm.staffMeters.length > 0) {
    ext["staffMeters"] = pm.staffMeters.map(serializeStaffMeterChange);
  }
  return ext;
}

function serializeStaffMeterChange(change: StaffMeterChange): Obj {
  if (isStaffMeterReset(change)) {
    return { staff: change.staff, useGlobal: true };
  }
  const meterObj: Obj = { count: change.meter.count, unit: change.meter.unit };
  if (change.meter.beatStructure && change.meter.beatStructure.length > 0) {
    meterObj["beatStructure"] = [...change.meter.beatStructure];
  }
  return { staff: change.staff, meter: meterObj, synchronization: change.synchronization };
}
