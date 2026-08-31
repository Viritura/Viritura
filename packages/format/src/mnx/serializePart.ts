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
  ChordSymbol,
  TextExpression,
  Sequence,
  Beam,
} from "@viritura/core";

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
  // _x.viritura vendor extensions (instrument identity)
  const partExt = part._x?.viritura;
  if (partExt) {
    const ext: Obj = {};
    if (partExt.instrumentId !== undefined) ext["instrumentId"] = partExt.instrumentId;
    if (partExt.midiProgram !== undefined) ext["midiProgram"] = partExt.midiProgram;
    if (partExt.family !== undefined) ext["family"] = partExt.family;
    if (partExt.spatial !== undefined) ext["spatial"] = { x: partExt.spatial.x, y: partExt.spatial.y };
    if (Object.keys(ext).length > 0) {
      partObj["_x"] = { viritura: ext };
    }
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
  const clefEntry: Obj = { clef: clefObj };
  if (pc.position) clefEntry["position"] = pc.position;
  if (pc.staff !== undefined) clefEntry["staff"] = pc.staff;
  return clefEntry;
}

export function serializeDynamicGroup(d: DynamicGroup): Obj {
  const out: Obj = { id: d.id, position: d.position, type: d.type };
  if (d.value !== undefined) out["value"] = d.value;
  if (d.residualValue !== undefined) out["residualValue"] = d.residualValue;
  if (d.accentPrefix !== undefined) out["accentPrefix"] = d.accentPrefix;
  if (d.accentSuffix !== undefined) out["accentSuffix"] = d.accentSuffix;
  if (d.end !== undefined) out["end"] = d.end;
  if (d.glyphs !== undefined && d.glyphs.length > 0) out["glyphs"] = d.glyphs;
  if (d.orient !== undefined) out["orient"] = d.orient;
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
    if (mr.counter.orient !== undefined) counter["orient"] = mr.counter.orient;
    out["counter"] = counter;
  }
  if (mr.displayNumber !== undefined) out["displayNumber"] = mr.displayNumber;
  if (mr.staffPosition !== undefined) out["staffPosition"] = mr.staffPosition;
  return out;
}

function serializeOttava(o: Ottava): Obj {
  const out: Obj = { end: o.end, position: o.position, value: o.value };
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

function serializeChordSymbol(cs: ChordSymbol): Obj {
  const csObj: Obj = {
    position: cs.position,
    root: { step: cs.root.step } as Obj,
    quality: cs.quality,
  };
  if (cs.root.alter !== undefined) (csObj["root"] as Obj)["alter"] = cs.root.alter;
  if (cs.bass) {
    const bassObj: Obj = { step: cs.bass.step };
    if (cs.bass.alter !== undefined) bassObj["alter"] = cs.bass.alter;
    csObj["bass"] = bassObj;
  }
  if (cs.extension !== undefined) csObj["extension"] = cs.extension;
  if (cs.textOverride) csObj["textOverride"] = cs.textOverride;
  return csObj;
}

function collectPartMeasureVendorExt(pm: PartMeasure, helpers: PartSerializerHelpers): Obj {
  const ext: Obj = {};
  if (pm.pedals && pm.pedals.length > 0) ext["pedals"] = pm.pedals.map(serializePedal);
  if (pm.chordSymbols && pm.chordSymbols.length > 0) {
    ext["chordSymbols"] = pm.chordSymbols.map(serializeChordSymbol);
  }
  if (pm.expressions && pm.expressions.length > 0) {
    ext["expressions"] = pm.expressions.map(helpers.serializeTextExpression);
  }
  if (pm.condensingOverride) ext["condensingOverride"] = pm.condensingOverride;
  return ext;
}
