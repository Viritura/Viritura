/**
 * MNX Serializer — converts typed @viritura/core model back to MNX JSON.
 *
 * This is the reverse of the parser. It produces valid MNX JSON
 * that conforms to the W3C MNX specification.
 */

import type {
  Score,
  GlobalMeasure,
  PartMeasure,
  Tempo,
  NoteEvent,
  Note,
  KitNote,
  Sequence,
  SequenceContent,
  Tie,
  Markings,
  Slur,
  Lyrics,
  Grace,
  Tuplet,
  MultiNoteTremolo,
  Space,
  Beam,
  TextExpression,
} from "@viritura/core";
import { serializePart, serializePartMeasure } from "./serializePart";
import { serializeLayoutDefinition, serializeScoreDefinition } from "./serializeLayout";

type Obj = Record<string, unknown>;

/**
 * Serialize a Score model to an MNX JSON object.
 * The output is a plain JavaScript object suitable for JSON.stringify().
 */
export function serializeMnx(score: Score): unknown {
  const mnxObj: Obj = { version: score.mnx.version };
  if (score.mnx.support) {
    const supportObj: Obj = {};
    if (score.mnx.support.useAccidentalDisplay !== undefined) {
      supportObj["useAccidentalDisplay"] = score.mnx.support.useAccidentalDisplay;
    }
    if (score.mnx.support.useBeams !== undefined) {
      supportObj["useBeams"] = score.mnx.support.useBeams;
    }
    if (Object.keys(supportObj).length > 0) {
      mnxObj["support"] = supportObj;
    }
  }
  const root: Obj = {
    mnx: mnxObj,
    global: serializeGlobal(score),
  };

  if (score.layouts && score.layouts.length > 0) {
    root["layouts"] = score.layouts.map(serializeLayoutDefinition);
  }

  root["parts"] = score.parts.map((part) =>
    serializePart(part, {
      serializeBeam,
      serializeSequence,
      serializeTextExpression,
    }),
  );

  if (score.scores && score.scores.length > 0) {
    root["scores"] = score.scores.map(serializeScoreDefinition);
  }

  // Root-level vendor extensions: _x.viritura.{metadata,textStyles,soundProfile,videoSync}
  const virituraExt = serializeRootExtensions(score);
  if (Object.keys(virituraExt).length > 0) {
    root["_x"] = { viritura: virituraExt };
  }

  return root;
}

/**
 * Build the `_x.viritura` root vendor dict.
 *
 * Split out of `serializeMnx` so that adding a root extension does not push the
 * entry point past the complexity budget: each block here is independent and
 * reads as one concern rather than another branch in a long function.
 */
function serializeRootExtensions(score: Score): Obj {
  const virituraExt: Obj = {};

  if (score.metadata) {
    const metaObj: Obj = {};
    if (score.metadata.title) metaObj["title"] = score.metadata.title;
    if (score.metadata.subtitle) metaObj["subtitle"] = score.metadata.subtitle;
    if (score.metadata.composer) metaObj["composer"] = score.metadata.composer;
    if (score.metadata.lyricist) metaObj["lyricist"] = score.metadata.lyricist;
    if (score.metadata.arranger) metaObj["arranger"] = score.metadata.arranger;
    if (score.metadata.copyright) metaObj["copyright"] = score.metadata.copyright;
    if (Object.keys(metaObj).length > 0) {
      virituraExt["metadata"] = metaObj;
    }
  }

  if (score.textStyles && Object.keys(score.textStyles).length > 0) {
    virituraExt["textStyles"] = score.textStyles as Obj;
  }

  if (score.timeSignatures && Object.keys(score.timeSignatures).length > 0) {
    virituraExt["timeSignatures"] = score.timeSignatures as unknown as Obj;
  }

  if (score.soundProfile) {
    const parts: Obj = {};
    for (const [partId, override] of Object.entries(score.soundProfile.parts)) {
      const entry: Obj = { sourceId: override.sourceId };
      if (override.profileId !== undefined) entry["profileId"] = override.profileId;
      if (override.profileVersion !== undefined) entry["profileVersion"] = override.profileVersion;
      parts[partId] = entry;
    }
    virituraExt["soundProfile"] = {
      profileId: score.soundProfile.profileId,
      profileVersion: score.soundProfile.profileVersion,
      parts,
    };
  }

  if (score.videoSync) {
    virituraExt["videoSync"] = serializeVideoSync(score.videoSync);
  }

  return virituraExt;
}

/** Serialize score-to-picture settings (`_x.viritura.videoSync`). */
function serializeVideoSync(videoSync: NonNullable<Score["videoSync"]>): Obj {
  const obj: Obj = {
    version: videoSync.version,
    pictureOffsetSeconds: videoSync.pictureOffsetSeconds,
    pictureAudioEnabled: videoSync.pictureAudioEnabled,
  };
  if (videoSync.startTimecodeSeconds !== undefined) {
    obj["startTimecodeSeconds"] = videoSync.startTimecodeSeconds;
  }
  if (videoSync.frameRate !== undefined) {
    obj["frameRate"] = videoSync.frameRate;
  }
  // Media is written as identity only. Emitting a local path here would make the
  // score non-portable and leak the author's filesystem layout into a file that
  // is meant to be shared and committed.
  if (videoSync.media) {
    const media: Obj = { displayName: videoSync.media.displayName };
    if (videoSync.media.contentHash !== undefined) media["contentHash"] = videoSync.media.contentHash;
    if (videoSync.media.demoSourceId !== undefined) media["demoSourceId"] = videoSync.media.demoSourceId;
    if (videoSync.media.durationSeconds !== undefined) media["durationSeconds"] = videoSync.media.durationSeconds;
    obj["media"] = media;
  }
  if (videoSync.hitPoints?.length) {
    // Sorted on the way out so a spotting session that added hits out of order
    // still produces a stable, readable diff.
    obj["hitPoints"] = [...videoSync.hitPoints]
      .sort((a, b) => a.pictureSeconds - b.pictureSeconds)
      .map((hit) => {
        const entry: Obj = { id: hit.id, pictureSeconds: hit.pictureSeconds };
        if (hit.label !== undefined) entry["label"] = hit.label;
        if (hit.locked === false) entry["locked"] = false;
        return entry;
      });
  }
  return obj;
}

// ═══════════════════════════════════════════
// Incremental serialization helpers
// ═══════════════════════════════════════════
//
// These expose the per-measure serializers (identical to what `serializeMnx`
// uses internally) plus a measure-stripped "skeleton" so callers like the
// DeltaSerializer can assemble the full MNX JSON incrementally — splicing
// cached per-measure JSON strings instead of re-transforming every measure
// on each edit.

/** Serialize a single global measure to its MNX object form. */
export function serializeGlobalMeasureObj(gm: GlobalMeasure): unknown {
  return serializeGlobalMeasure(gm);
}

/** Serialize a single part measure to its MNX object form. */
export function serializePartMeasureObj(pm: PartMeasure): unknown {
  return serializePartMeasure(pm, {
    serializeBeam,
    serializeSequence,
    serializeTextExpression,
  });
}

/**
 * Serialize a Score to MNX with all measure arrays emptied. The output is
 * byte-identical to `serializeMnx(score)` except every `global.measures` and
 * `parts[i].measures` array is `[]`. Used as the splice template for
 * incremental full-JSON assembly.
 */
export function serializeMnxSkeleton(score: Score): unknown {
  const stripped: Score = {
    ...score,
    global: { ...score.global, measures: [] },
    parts: score.parts.map((p) => ({ ...p, measures: [] })),
  };
  return serializeMnx(stripped);
}

function serializeRepeatStart(repeat: NonNullable<GlobalMeasure["repeatStart"]>): Obj {
  return repeat.times === undefined ? {} : { times: repeat.times };
}

function serializeRepeatEnd(repeat: NonNullable<GlobalMeasure["repeatEnd"]>): Obj {
  return repeat.times === undefined ? {} : { times: repeat.times };
}

function serializeGlobalMeasure(gm: GlobalMeasure): Obj {
  const obj: Obj = {};
  if (gm.barline) obj["barline"] = { type: gm.barline.type };
  if (gm.ending) {
    const e: Obj = {
      duration: gm.ending.duration,
      numbers: gm.ending.numbers,
    };
    if (gm.ending.open !== undefined) e["open"] = gm.ending.open;
    if (gm.ending.color) e["color"] = gm.ending.color;
    obj["ending"] = e;
  }
  if (gm.fine) {
    const f: Obj = { location: gm.fine.location };
    if (gm.fine.color) f["color"] = gm.fine.color;
    obj["fine"] = f;
  }
  if (gm.id) obj["id"] = gm.id;
  if (gm.number !== undefined) obj["number"] = gm.number;
  if (gm.jump && (gm.jump.type === "segno" || gm.jump.type === "dsalfine")) {
    obj["jump"] = { type: gm.jump.type, location: gm.jump.location };
  }
  if (gm.key) {
    const k: Obj = { fifths: gm.key.fifths };
    if (gm.key.color) k["color"] = gm.key.color;
    if (gm.key.atonal) k["_x"] = { viritura: { atonal: true } };
    obj["key"] = k;
  }
  if (gm.repeatEnd) {
    obj["repeatEnd"] = serializeRepeatEnd(gm.repeatEnd);
  }
  if (gm.repeatStart) {
    obj["repeatStart"] = serializeRepeatStart(gm.repeatStart);
  }
  if (gm.segno) {
    const s: Obj = { location: gm.segno.location };
    if (gm.segno.glyph) s["glyph"] = gm.segno.glyph;
    if (gm.segno.color) s["color"] = gm.segno.color;
    obj["segno"] = s;
  }
  const virituraExt = collectGlobalMeasureVendorExt(gm);
  if (Object.keys(virituraExt).length > 0) {
    obj["_x"] = { viritura: virituraExt };
  }
  if (gm.tempos && gm.tempos.length > 0) {
    obj["tempos"] = gm.tempos.map(serializeTempo);
  }
  if (gm.time) obj["time"] = serializeTimeSignature(gm.time);
  return obj;
}

function serializeTimeSignature(time: NonNullable<GlobalMeasure["time"]>): Obj {
  const out: Obj = { count: time.count, unit: time.unit };
  if (time.display === "common" || time.display === "cut") out["display"] = time.display;
  return out;
}

function collectGlobalMeasureVendorExt(gm: GlobalMeasure): Obj {
  const ext: Obj = {};
  if (gm.rehearsalMark) {
    const rm: Obj = { text: gm.rehearsalMark.text };
    if (gm.rehearsalMark.style) rm["style"] = gm.rehearsalMark.style;
    if (gm.rehearsalMark.manualOffset) rm["manualOffset"] = gm.rehearsalMark.manualOffset;
    if (gm.rehearsalMark.avoidCollisions === false) rm["avoidCollisions"] = false;
    ext["rehearsalMark"] = rm;
  }
  if (gm.coda) {
    const c: Obj = { location: gm.coda.location };
    if (gm.coda.glyph) c["glyph"] = gm.coda.glyph;
    if (gm.coda.color) c["color"] = gm.coda.color;
    ext["coda"] = c;
  }
  if (gm.jump?.type === "dsalcoda" || gm.jump?.type === "dcalcoda") {
    ext["jump"] = { type: gm.jump.type, location: gm.jump.location };
  }
  if (gm.gradualTempo) {
    const gt: Obj = {
      position: gm.gradualTempo.position,
      end: gm.gradualTempo.end,
      endBpm: gm.gradualTempo.endBpm,
    };
    if (gm.gradualTempo.startBpm !== undefined) gt["startBpm"] = gm.gradualTempo.startBpm;
    if (gm.gradualTempo.kind) gt["kind"] = gm.gradualTempo.kind;
    ext["gradualTempo"] = gt;
  }
  if (gm.time?.display === "senzaMisura") ext["senzaMisura"] = true;
  return ext;
}

function serializeTempo(t: Tempo): Obj {
  const tObj: Obj = {
    bpm: t.bpm,
    value: serializeTempoNoteValue(t.value),
  };
  if (t.location) tObj["location"] = t.location;
  const tempoViritura: Obj = {};
  if (t.text !== undefined) tempoViritura["text"] = t.text;
  if (t.showMetronomeMark !== undefined) tempoViritura["showMetronomeMark"] = t.showMetronomeMark;
  if (t.showText !== undefined) tempoViritura["showText"] = t.showText;
  if (t.manualOffset) tempoViritura["manualOffset"] = t.manualOffset;
  if (t.avoidCollisions === false) tempoViritura["avoidCollisions"] = false;
  if (Object.keys(tempoViritura).length > 0) {
    tObj["_x"] = { viritura: tempoViritura };
  }
  return tObj;
}

function serializeGlobal(score: Score): Obj {
  const globalObj: Obj = {
    measures: score.global.measures.map(serializeGlobalMeasure),
  };
  if (score.global.lyrics) {
    const lyrics: Obj = {};
    if (score.global.lyrics.lineMetadata) {
      const lm: Obj = {};
      for (const [key, entry] of Object.entries(score.global.lyrics.lineMetadata)) {
        const e: Obj = {};
        if (entry.label) e["label"] = entry.label;
        if (entry.lang) e["lang"] = entry.lang;
        lm[key] = e;
      }
      lyrics["lineMetadata"] = lm;
    }
    if (score.global.lyrics.lineOrder) {
      lyrics["lineOrder"] = score.global.lyrics.lineOrder;
    }
    globalObj["lyrics"] = lyrics;
  }
  if (score.global.sounds && Object.keys(score.global.sounds).length > 0) {
    const soundsObj: Obj = {};
    for (const [key, s] of Object.entries(score.global.sounds)) {
      const so: Obj = {};
      if (s.midiNumber !== undefined) so["midiNumber"] = s.midiNumber;
      if (s.name !== undefined) so["name"] = s.name;
      if (s.id !== undefined) so["id"] = s.id;
      soundsObj[key] = so;
    }
    globalObj["sounds"] = soundsObj;
  }
  return globalObj;
}

function serializeTempoNoteValue(v: { base: string; dots?: number }): Obj {
  const obj: Obj = { base: v.base };
  if (v.dots !== undefined) obj["dots"] = v.dots;
  return obj;
}

function serializeTextExpression(expr: TextExpression): Obj {
  const obj: Obj = {
    text: expr.text,
    position: expr.position,
  };
  if (expr.placement) obj["placement"] = expr.placement;
  if (expr.staff !== undefined) obj["staff"] = expr.staff;
  if (expr.voice) obj["voice"] = expr.voice;
  if (expr.manualOffset) obj["manualOffset"] = expr.manualOffset;
  if (expr.avoidCollisions === false) obj["avoidCollisions"] = false;
  return obj;
}

// ═══════════════════════════════════════════
// Beams
// ═══════════════════════════════════════════

function serializeBeam(beam: Beam): Obj {
  const obj: Obj = {};
  if (beam.beams && beam.beams.length > 0) {
    obj["beams"] = beam.beams.map(serializeBeam);
  }
  if (beam.direction) obj["direction"] = beam.direction;
  obj["events"] = beam.events;
  return obj;
}

// ═══════════════════════════════════════════
// Sequences
// ═══════════════════════════════════════════

function serializeSequence(seq: Sequence): Obj {
  const seqObj: Obj = {
    content: seq.content.map(serializeSequenceContent),
  };
  if (seq.fullMeasure) {
    const fmObj: Obj = {
      visualDuration: serializeDuration(seq.fullMeasure.visualDuration),
    };
    if (seq.fullMeasure.staffPosition !== undefined) {
      fmObj["staffPosition"] = seq.fullMeasure.staffPosition;
    }
    seqObj["fullMeasure"] = fmObj;
  }
  if (seq.orient) seqObj["orient"] = seq.orient;
  if (seq.staff !== undefined) seqObj["staff"] = seq.staff;
  if (seq.voice !== undefined) seqObj["voice"] = seq.voice;
  return seqObj;
}

export function serializeSequenceContent(item: SequenceContent): Obj {
  switch (item.type) {
    case "tuplet":
      return serializeTuplet(item);
    case "tremolo":
      return serializeMultiNoteTremolo(item);
    case "grace":
      return serializeGrace(item);
    case "space":
      return serializeSpace(item);
    default:
      return serializeEvent(item);
  }
}

// ═══════════════════════════════════════════
// Tuplet
// ═══════════════════════════════════════════

function serializeTuplet(t: Tuplet): Obj {
  const obj: Obj = {
    type: "tuplet",
    inner: { multiple: t.inner.multiple, duration: serializeDuration(t.inner.duration) },
    outer: { multiple: t.outer.multiple, duration: serializeDuration(t.outer.duration) },
    content: t.content.map(serializeSequenceContent),
  };
  if (t.bracket !== undefined) obj.bracket = t.bracket;
  if (t.showNumber !== undefined) obj.showNumber = t.showNumber;
  if (t.showValue !== undefined) obj.showValue = t.showValue;
  if (t.orient) obj["orient"] = t.orient;
  return obj;
}

// ═══════════════════════════════════════════
// Multi-note tremolo
// ═══════════════════════════════════════════

function serializeMultiNoteTremolo(m: MultiNoteTremolo): Obj {
  const obj: Obj = {
    type: "tremolo",
    content: m.content.map(serializeEvent),
    marks: m.marks,
    outer: { duration: serializeDuration(m.outer.duration), multiple: m.outer.multiple },
  };
  if (m.individualDuration !== undefined) obj["individualDuration"] = serializeDuration(m.individualDuration);
  return obj;
}

// ═══════════════════════════════════════════
// Grace notes
// ═══════════════════════════════════════════

function serializeGrace(g: Grace): Obj {
  const obj: Obj = {
    type: "grace",
    content: g.content.map(serializeEvent),
  };
  if (g.graceType) obj["graceType"] = g.graceType;
  if (g.slash !== undefined) obj["slash"] = g.slash;
  if (g.color) obj["color"] = g.color;
  return obj;
}

// ═══════════════════════════════════════════
// Space
// ═══════════════════════════════════════════

function serializeSpace(s: Space): Obj {
  return {
    type: "space",
    duration: s.duration,
  };
}

// ═══════════════════════════════════════════
// Events
// ═══════════════════════════════════════════

export function serializeEvent(ev: NoteEvent): Obj {
  const evObj: Obj = {
    duration: serializeDuration(ev.duration),
  };
  if (ev.id) evObj["id"] = ev.id;
  if (typeof ev.staff === "number") evObj["staff"] = ev.staff;
  if (ev.orient) evObj["orient"] = ev.orient;
  if (ev.lyrics) evObj["lyrics"] = serializeLyrics(ev.lyrics);
  if (ev.markings) evObj["markings"] = serializeMarkings(ev.markings);
  // Native MNX fermata (event-level since v15).
  if (ev.fermata !== undefined) {
    const f: Obj = {};
    if (ev.fermata.symbol) f["symbol"] = ev.fermata.symbol;
    if (ev.fermata.duration) f["duration"] = ev.fermata.duration;
    if (ev.fermata.orient) f["orient"] = ev.fermata.orient;
    if (ev.fermata.pointing) f["pointing"] = ev.fermata.pointing;
    evObj["fermata"] = f;
  }
  if (ev.notes && ev.notes.length > 0) {
    evObj["notes"] = ev.notes.map(serializeNote);
  }
  if (ev.kitNotes && ev.kitNotes.length > 0) {
    evObj["kitNotes"] = ev.kitNotes.map(serializeKitNote);
  }
  if (ev.rest) {
    const restObj: Obj = {};
    if (ev.rest.staffPosition !== undefined) {
      restObj["staffPosition"] = ev.rest.staffPosition;
    }
    evObj["rest"] = restObj;
  }
  if (ev.slurs && ev.slurs.length > 0) {
    evObj["slurs"] = ev.slurs.map(serializeSlur);
  }
  // MNX spec: stemDirection enum is only `up | down`. `auto` is Viritura's
  // internal sentinel for "engine decides"; never emit it.
  if (ev.stemDirection && ev.stemDirection !== "auto") {
    evObj["stemDirection"] = ev.stemDirection;
  }
  // _x.viritura vendor extensions on event
  const evViritura: Obj = {};
  if (ev.glissandos && ev.glissandos.length > 0) {
    evViritura["glissandos"] = ev.glissandos.map((g) => {
      const gObj: Obj = { target: g.target };
      if (g.style) gObj["style"] = g.style;
      if (g.text) gObj["text"] = g.text;
      return gObj;
    });
  }
  if (Object.keys(evViritura).length > 0) {
    evObj["_x"] = { viritura: evViritura };
  }
  return evObj;
}

// ═══════════════════════════════════════════
// Markings
// ═══════════════════════════════════════════

function orientObj(mk: { orient?: string } | undefined): Obj {
  const o: Obj = {};
  if (mk?.orient) o["orient"] = mk.orient;
  return o;
}

function serializeMarkings(m: Markings): Obj {
  const obj: Obj = serializeSpecMarkings(m);
  const markViritura = serializeVendorMarkings(m);
  if (Object.keys(markViritura).length > 0) {
    obj["_x"] = { viritura: markViritura };
  }
  return obj;
}

function serializeSpecMarkings(m: Markings): Obj {
  const obj: Obj = {};
  if (m.accent !== undefined) obj["accent"] = orientObj(m.accent);
  if (m.staccato !== undefined) obj["staccato"] = orientObj(m.staccato);
  if (m.staccatissimo !== undefined) obj["staccatissimo"] = orientObj(m.staccatissimo);
  if (m.spiccato !== undefined) obj["spiccato"] = orientObj(m.spiccato);
  if (m.strongAccent !== undefined) {
    const sa: Obj = orientObj(m.strongAccent);
    if (m.strongAccent.pointing) sa["pointing"] = m.strongAccent.pointing;
    obj["strongAccent"] = sa;
  }
  if (m.tenuto !== undefined) obj["tenuto"] = orientObj(m.tenuto);
  if (m.tremolo !== undefined) {
    const t: Obj = { marks: m.tremolo.marks };
    if (m.tremolo.orient) t["orient"] = m.tremolo.orient;
    obj["tremolo"] = t;
  }
  if (m.softAccent !== undefined) obj["softAccent"] = orientObj(m.softAccent);
  if (m.stress !== undefined) obj["stress"] = orientObj(m.stress);
  if (m.unstress !== undefined) obj["unstress"] = orientObj(m.unstress);
  if (m.breath !== undefined) {
    const b: Obj = orientObj(m.breath);
    if (m.breath.symbol) b["symbol"] = m.breath.symbol;
    obj["breath"] = b;
  }
  if (m.bowDirection !== undefined) {
    const bd: Obj = { direction: m.bowDirection.direction };
    if (m.bowDirection.orient) bd["orient"] = m.bowDirection.orient;
    obj["bowDirection"] = bd;
  }
  return obj;
}

function serializeVendorMarkings(m: Markings): Obj {
  const ext: Obj = {};
  if (m.staccatissimoWedge !== undefined) {
    ext["staccatissimoWedge"] = orientObj(m.staccatissimoWedge);
  }
  if (m.trill !== undefined) {
    const t: Obj = {};
    if (m.trill.accidental !== undefined) t["accidental"] = m.trill.accidental;
    ext["trill"] = t;
  }
  if (m.ornaments !== undefined && m.ornaments.length > 0) {
    ext["ornaments"] = m.ornaments;
  }
  if (m.arpeggio !== undefined) {
    const a: Obj = {};
    if (m.arpeggio.direction) a["direction"] = m.arpeggio.direction;
    ext["arpeggio"] = a;
  }
  if (m.caesura !== undefined) {
    const c: Obj = {};
    if (m.caesura.style) c["style"] = m.caesura.style;
    ext["caesura"] = c;
  }
  if (m.fingerings !== undefined && m.fingerings.length > 0) {
    ext["fingerings"] = m.fingerings.map((f) => ({ finger: f.finger }));
  }
  return ext;
}

// ═══════════════════════════════════════════
// Lyrics
// ═══════════════════════════════════════════

function serializeLyrics(l: Lyrics): Obj {
  const obj: Obj = {};
  if (l.lines) {
    const lines: Obj = {};
    for (const [key, line] of Object.entries(l.lines)) {
      const lineObj: Obj = {};
      if (line.type) lineObj["type"] = line.type;
      lineObj["text"] = line.text;
      lines[key] = lineObj;
    }
    obj["lines"] = lines;
  }
  return obj;
}

// ═══════════════════════════════════════════
// Slurs
// ═══════════════════════════════════════════

function serializeSlur(s: Slur): Obj {
  const obj: Obj = {};
  if (s.endNote) obj["endNote"] = s.endNote;
  if (s.lineType) obj["lineType"] = s.lineType;
  if (s.side) obj["side"] = s.side;
  if (s.sideEnd) obj["sideEnd"] = s.sideEnd;
  if (s.startNote) obj["startNote"] = s.startNote;
  obj["target"] = s.target;
  if (s.shape && (s.shape.p0 || s.shape.p1 || s.shape.p2 || s.shape.p3)) {
    const shapeObj: Obj = {};
    if (s.shape.p0) shapeObj["p0"] = [s.shape.p0[0], s.shape.p0[1]];
    if (s.shape.p1) shapeObj["p1"] = [s.shape.p1[0], s.shape.p1[1]];
    if (s.shape.p2) shapeObj["p2"] = [s.shape.p2[0], s.shape.p2[1]];
    if (s.shape.p3) shapeObj["p3"] = [s.shape.p3[0], s.shape.p3[1]];
    obj["_x"] = { viritura: { shape: shapeObj } };
  }
  return obj;
}

// ═══════════════════════════════════════════
// Notes
// ═══════════════════════════════════════════

function serializeNote(n: Note): Obj {
  const nObj: Obj = {};
  if (n.id) nObj["id"] = n.id;
  nObj["pitch"] = {
    ...(n.pitch.alter !== undefined ? { alter: n.pitch.alter } : {}),
    octave: n.pitch.octave,
    step: n.pitch.step,
  };
  if (n.staff !== undefined) nObj["staff"] = n.staff;
  if (n.ties && n.ties.length > 0) {
    nObj["ties"] = n.ties.map(serializeTie);
  }
  if (n.accidentalDisplay) {
    // Per MNX spec: only `show` is required; `force` and `enclosure` (with
    // `symbol: "parentheses" | "brackets"`) are optional. Emit each field
    // explicitly so we don't leak unknown properties to consumers.
    const ad: Obj = { show: n.accidentalDisplay.show };
    if (n.accidentalDisplay.force !== undefined) ad["force"] = n.accidentalDisplay.force;
    if (n.accidentalDisplay.enclosure) {
      ad["enclosure"] = { symbol: n.accidentalDisplay.enclosure.symbol };
    }
    nObj["accidentalDisplay"] = ad;
  }
  if (n.written) {
    const w: Obj = {};
    if (n.written.diatonicDelta !== undefined) w["diatonicDelta"] = n.written.diatonicDelta;
    nObj["written"] = w;
  }
  // _x.viritura.notehead: per-note notehead-shape override (MNX issue #249).
  if (n.notehead !== undefined) {
    nObj["_x"] = { viritura: { notehead: n.notehead } };
  }
  return nObj;
}

function serializeKitNote(kn: KitNote): Obj {
  const obj: Obj = { kitComponent: kn.kitComponent };
  if (kn.id) obj["id"] = kn.id;
  if (kn.staff !== undefined) obj["staff"] = kn.staff;
  if (kn.ties && kn.ties.length > 0) {
    obj["ties"] = kn.ties.map(serializeTie);
  }
  if (kn.perform) {
    const p: Obj = {};
    if (kn.perform.id) p["id"] = kn.perform.id;
    obj["perform"] = p;
  }
  return obj;
}

function serializeTie(t: Tie): Obj {
  const obj: Obj = {};
  if (t.lv !== undefined) obj["lv"] = t.lv;
  if (t.side) obj["side"] = t.side;
  if (t.target) obj["target"] = t.target;
  if (t.targetType) obj["targetType"] = t.targetType;
  return obj;
}

// ═══════════════════════════════════════════
// Duration
// ═══════════════════════════════════════════

function serializeDuration(d: { base: string; dots?: number }): Obj {
  const obj: Obj = { base: d.base };
  if (d.dots) obj["dots"] = d.dots;
  return obj;
}
