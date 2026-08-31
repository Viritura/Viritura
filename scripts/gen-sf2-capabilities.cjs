// Generate a SoundFont capability manifest (see sf2-capabilities.schema.json).
//
// Layers 1 (raw presets + per-key drum maps) are extracted directly from the
// SF2. Layers 2/3 (semantic resolution + known collisions) come from a curated,
// per-font overlay keyed by the font id below — sample names are auto-filled
// and VALIDATED against the parsed key maps so the manifest can't drift from
// what the font actually contains.
//
// Usage: node scripts/gen-sf2-capabilities.cjs <font-id> <path.sf2> <out.json>
"use strict";
const fs = require("fs");

/* ----------------------------- SF2 RIFF parser ---------------------------- */
const GEN_INSTRUMENT = 41;
const GEN_KEYRANGE = 43;
const GEN_SAMPLEID = 53;

function readChunks(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not RIFF");
  if (buf.toString("ascii", 8, 12) !== "sfbk") throw new Error("not sfbk");
  const lists = {};
  let pos = 12;
  while (pos < buf.length - 8) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "LIST") {
      const listType = buf.toString("ascii", pos + 8, pos + 12);
      const sub = {};
      let p = pos + 12;
      const end = pos + 8 + size;
      while (p < end - 8) {
        const sid = buf.toString("ascii", p, p + 4);
        const ssize = buf.readUInt32LE(p + 4);
        sub[sid] = { offset: p + 8, size: ssize };
        p += 8 + ssize + (ssize & 1);
      }
      lists[listType] = sub;
    }
    pos += 8 + size + (size & 1);
  }
  return lists;
}

function cstr(buf, off, len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function parseSf2(path) {
  const buf = fs.readFileSync(path);
  const pdta = readChunks(buf).pdta;
  if (!pdta) throw new Error("no pdta");

  const presets = [];
  for (let i = 0; i + 38 <= pdta.phdr.size; i += 38) {
    const o = pdta.phdr.offset + i;
    presets.push({
      name: cstr(buf, o, 20),
      program: buf.readUInt16LE(o + 20),
      bank: buf.readUInt16LE(o + 22),
      pbagNdx: buf.readUInt16LE(o + 24),
    });
  }
  const pbagGen = [];
  for (let i = 0; i + 4 <= pdta.pbag.size; i += 4) pbagGen.push(buf.readUInt16LE(pdta.pbag.offset + i));
  const insts = [];
  for (let i = 0; i + 22 <= pdta.inst.size; i += 22) {
    const o = pdta.inst.offset + i;
    insts.push({ name: cstr(buf, o, 20), ibagNdx: buf.readUInt16LE(o + 20) });
  }
  const ibagGen = [];
  for (let i = 0; i + 4 <= pdta.ibag.size; i += 4) ibagGen.push(buf.readUInt16LE(pdta.ibag.offset + i));
  const samples = [];
  for (let i = 0; i + 46 <= pdta.shdr.size; i += 46) samples.push(cstr(buf, pdta.shdr.offset + i, 20));

  const readGens = (chunk, start, end) => {
    const out = [];
    for (let i = start; i < end; i++) {
      const o = chunk.offset + i * 4;
      out.push({ op: buf.readUInt16LE(o), amt: buf.readUInt16LE(o + 2) });
    }
    return out;
  };

  const instrumentZones = (instIdx) => {
    const start = insts[instIdx].ibagNdx;
    const end = instIdx + 1 < insts.length ? insts[instIdx + 1].ibagNdx : ibagGen.length;
    const zones = [];
    for (let z = start; z < end; z++) {
      const gStart = ibagGen[z];
      const gEnd = z + 1 < ibagGen.length ? ibagGen[z + 1] : pdta.igen.size / 4;
      let keyLo = 0;
      let keyHi = 127;
      let sampleId = -1;
      for (const g of readGens(pdta.igen, gStart, gEnd)) {
        if (g.op === GEN_KEYRANGE) {
          keyLo = g.amt & 0xff;
          keyHi = (g.amt >> 8) & 0xff;
        } else if (g.op === GEN_SAMPLEID) sampleId = g.amt;
      }
      if (sampleId >= 0) zones.push({ keyLo, keyHi, sample: samples[sampleId] ?? `#${sampleId}` });
    }
    return zones;
  };

  const presetKeyMap = (presetIdx) => {
    const start = presets[presetIdx].pbagNdx;
    const end = presetIdx + 1 < presets.length ? presets[presetIdx + 1].pbagNdx : pbagGen.length;
    const keyMap = {};
    for (let z = start; z < end; z++) {
      const gStart = pbagGen[z];
      const gEnd = z + 1 < pbagGen.length ? pbagGen[z + 1] : pdta.pgen.size / 4;
      let pLo = 0;
      let pHi = 127;
      let instIdx = -1;
      for (const g of readGens(pdta.pgen, gStart, gEnd)) {
        if (g.op === GEN_KEYRANGE) {
          pLo = g.amt & 0xff;
          pHi = (g.amt >> 8) & 0xff;
        } else if (g.op === GEN_INSTRUMENT) instIdx = g.amt;
      }
      if (instIdx < 0) continue;
      for (const zn of instrumentZones(instIdx)) {
        const lo = Math.max(pLo, zn.keyLo);
        const hi = Math.min(pHi, zn.keyHi);
        for (let k = lo; k <= hi; k++) if (!(k in keyMap)) keyMap[k] = zn.sample;
      }
    }
    return keyMap;
  };

  const real = presets.filter((p) => p.name !== "EOP");
  return {
    sampleCount: samples.length - 1,
    presets: real.map((p) => {
      const idx = presets.indexOf(p);
      const out = { bank: p.bank, program: p.program, name: p.name };
      if (p.bank === 128) out.keyMap = presetKeyMap(idx);
      return out;
    }),
  };
}

/* --------------------- GM Level-1 percussion key names -------------------- */
const GM_PERC = {
  27: "High Q",
  28: "Slap",
  29: "Scratch Push",
  30: "Scratch Pull",
  31: "Sticks",
  32: "Square Click",
  33: "Metronome Click",
  34: "Metronome Bell",
  35: "Acoustic Bass Drum",
  36: "Bass Drum 1",
  37: "Side Stick",
  38: "Acoustic Snare",
  39: "Hand Clap",
  40: "Electric Snare",
  41: "Low Floor Tom",
  42: "Closed Hi-Hat",
  43: "High Floor Tom",
  44: "Pedal Hi-Hat",
  45: "Low Tom",
  46: "Open Hi-Hat",
  47: "Low-Mid Tom",
  48: "Hi-Mid Tom",
  49: "Crash Cymbal 1",
  50: "High Tom",
  51: "Ride Cymbal 1",
  52: "Chinese Cymbal",
  53: "Ride Bell",
  54: "Tambourine",
  55: "Splash Cymbal",
  56: "Cowbell",
  57: "Crash Cymbal 2",
  58: "Vibraslap",
  59: "Ride Cymbal 2",
  60: "Hi Bongo",
  61: "Low Bongo",
  62: "Mute Hi Conga",
  63: "Open Hi Conga",
  64: "Low Conga",
  65: "High Timbale",
  66: "Low Timbale",
  67: "High Agogo",
  68: "Low Agogo",
  69: "Cabasa",
  70: "Maracas",
  71: "Short Whistle",
  72: "Long Whistle",
  73: "Short Guiro",
  74: "Long Guiro",
  75: "Claves",
  76: "Hi Wood Block",
  77: "Low Wood Block",
  78: "Mute Cuica",
  79: "Open Cuica",
  80: "Mute Triangle",
  81: "Open Triangle",
  82: "Shaker",
  83: "Jingle Bell",
  84: "Belltree",
  85: "Castanets",
  86: "Mute Surdo",
  87: "Open Surdo",
};

/* ---------------------- Per-font curated overlays ------------------------- */
// Each semantic entry: gmKey + per-kit-program {key, borrowKit?, reason?}.
// `sample` is filled from the parsed key map and validated below. The STANDARD
// kit (program 0) intentionally resolves 1:1 with the GM key — only deviations
// (concert percussion, the Orchestra-kit timpani collision, borrowed gong) need
// explicit non-GM addresses.
const OVERLAYS = {
  "shan-sgm-pro-15": {
    soundfont: { name: "Shan SGM Pro", version: "15", standard: "GM/GS", approxSizeMb: 119 },
    semantics: {
      bassDrum: {
        gmKey: 36,
        description: "Standard kick.",
        resolution: { 0: { key: 36 }, 48: { key: 36, reason: "Orchestra kit maps 36 to a concert bass drum." } },
      },
      acousticBassDrum: { gmKey: 35, description: "Deep/concert kick.", resolution: { 0: { key: 35 } } },
      sideStick: { gmKey: 37, description: "Rim click.", resolution: { 0: { key: 37 }, 48: { key: 37 } } },
      snareDrum: {
        gmKey: 38,
        description: "Snare.",
        resolution: { 0: { key: 38 }, 48: { key: 38, reason: "Orchestra kit maps 38 to a concert/military snare." } },
      },
      electricSnare: { gmKey: 40, description: "Electric snare.", resolution: { 0: { key: 40 } } },
      snareRoll: {
        gmKey: 25,
        description: "Sustained snare roll (GS extension key 25). Used for percussion roll playback.",
        resolution: { 0: { key: 25 }, 48: { key: 25 } },
      },
      closedHiHat: { gmKey: 42, description: "Closed hi-hat.", resolution: { 0: { key: 42 } } },
      pedalHiHat: { gmKey: 44, description: "Pedal hi-hat.", resolution: { 0: { key: 44 } } },
      openHiHat: { gmKey: 46, description: "Open hi-hat.", resolution: { 0: { key: 46 } } },
      crashCymbal: {
        gmKey: 49,
        description: "Primary crash.",
        resolution: {
          0: { key: 49 },
          48: {
            key: 57,
            reason: "GM key 49 is a chromatic timpani zone in the Orchestra kit; 57 is the usable concert crash.",
          },
        },
        fallback: ["crashCymbal2", "concertCymbal"],
      },
      crashCymbal2: { gmKey: 57, description: "Secondary crash.", resolution: { 0: { key: 57 }, 48: { key: 57 } } },
      concertCymbal: {
        gmKey: 59,
        description: "Concert (clash) cymbal — Orchestra kit specialty.",
        resolution: {
          48: { key: 59 },
          0: { key: 59, reason: "Standard kit key 59 is a ride; concert cymbal only exists in the Orchestra kit." },
        },
      },
      rideCymbal: {
        gmKey: 51,
        description: "Ride.",
        resolution: { 0: { key: 51 }, 48: { key: 30, reason: "Orchestra kit places its ride at key 30." } },
      },
      chineseCymbal: { gmKey: 52, description: "China/chinese cymbal.", resolution: { 0: { key: 52 } } },
      splashCymbal: { gmKey: 55, description: "Splash.", resolution: { 0: { key: 55 }, 48: { key: 55 } } },
      tambourine: { gmKey: 54, description: "Tambourine.", resolution: { 0: { key: 54 }, 48: { key: 54 } } },
      cowbell: { gmKey: 56, description: "Cowbell.", resolution: { 0: { key: 56 }, 48: { key: 56 } } },
      claves: { gmKey: 75, description: "Claves.", resolution: { 0: { key: 75 }, 48: { key: 75 } } },
      hiWoodBlock: { gmKey: 76, description: "High wood block.", resolution: { 0: { key: 76 }, 48: { key: 76 } } },
      lowWoodBlock: { gmKey: 77, description: "Low wood block.", resolution: { 0: { key: 77 }, 48: { key: 77 } } },
      muteTriangle: { gmKey: 80, description: "Muted triangle.", resolution: { 0: { key: 80 }, 48: { key: 80 } } },
      openTriangle: { gmKey: 81, description: "Open triangle.", resolution: { 0: { key: 81 }, 48: { key: 81 } } },
      castanets: {
        gmKey: 85,
        description: "Castanets.",
        resolution: { 48: { key: 39, reason: "Orchestra kit houses castanets at key 39." } },
      },
      tamTam: {
        gmKey: 52,
        description:
          "Tam-tam / large gong. No GM key exists; GM falls back to the Chinese cymbal as the nearest portable approximation. The real sample is the Big Gong in the Ethnic kit, borrowed onto a dedicated channel.",
        resolution: {
          49: {
            key: 45,
            borrowKit: 49,
            reason:
              "Big Gong lives only in the Ethnic kit (program 49); borrowed via the kit-component drumKit override.",
          },
        },
      },
    },
    collisions: [
      {
        kit: 48,
        keys: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53],
        expectedFromGm: true,
        note: "Orchestra kit's keys 41–53 are a single chromatic TIMPANI zone (F2–F4), so every GM percussion meaning in that range is overridden by a timpani pitch. Most damaging: GM key 49 'Crash Cymbal 1' plays timpani. `crashCymbal`/`rideCymbal` resolve to keys 57/30 in this kit to avoid it.",
      },
    ],
  },
};

/* ------------------------------- Generate -------------------------------- */
const fontId = process.argv[2];
const sf2Path = process.argv[3];
const outPath = process.argv[4];
if (!fontId || !sf2Path || !outPath) {
  console.error("usage: node scripts/gen-sf2-capabilities.cjs <font-id> <path.sf2> <out.json>");
  process.exit(1);
}
const overlay = OVERLAYS[fontId];
if (!overlay) throw new Error(`no curated overlay for font id '${fontId}'`);

const parsed = parseSf2(sf2Path);
const drumPresets = parsed.presets.filter((p) => p.bank === 128).sort((a, b) => a.program - b.program);
const melodic = parsed.presets.filter((p) => p.bank !== 128);
const kitByProgram = new Map(drumPresets.map((d) => [d.program, d]));

const warnings = [];
const sampleAt = (kitProgram, key) => {
  const kit = kitByProgram.get(kitProgram);
  const s = kit && kit.keyMap[key];
  if (!s) warnings.push(`semantic resolution references missing (kit ${kitProgram}, key ${key})`);
  return s ?? "(MISSING)";
};

// Layer 1: raw drum kits with GM annotations.
const drumKits = drumPresets.map((d) => {
  const keys = {};
  for (const [k, sample] of Object.entries(d.keyMap).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const entry = { sample };
    if (GM_PERC[Number(k)]) entry.gm = GM_PERC[Number(k)];
    keys[k] = entry;
  }
  return { program: d.program, name: d.name, keyCount: Object.keys(keys).length, keys };
});

// Layer 2: semantic resolution with sample names filled + validated.
const percussionSemantics = {};
for (const [id, def] of Object.entries(overlay.semantics)) {
  const resolution = {};
  for (const [kitProg, addr] of Object.entries(def.resolution)) {
    const entry = { key: addr.key, sample: sampleAt(addr.borrowKit ?? Number(kitProg), addr.key) };
    if (addr.borrowKit !== undefined) entry.borrowKit = addr.borrowKit;
    if (addr.reason) entry.reason = addr.reason;
    resolution[kitProg] = entry;
  }
  percussionSemantics[id] = { gmKey: def.gmKey, description: def.description, resolution };
  if (def.fallback) percussionSemantics[id].fallback = def.fallback;
}

// Layer 3: known collisions expanded with the actual sample at each key.
const knownCollisions = [];
for (const c of overlay.collisions) {
  for (const key of c.keys) {
    knownCollisions.push({
      kit: c.kit,
      key,
      expectedGm: GM_PERC[key] ?? `(GM key ${key})`,
      actualSample: sampleAt(c.kit, key),
      workaround: c.note,
    });
  }
}

const manifest = {
  $schema: "./sf2-capabilities.schema.json",
  soundfont: {
    id: fontId,
    name: overlay.soundfont.name,
    version: overlay.soundfont.version,
    file: sf2Path.split(/[\\/]/).pop(),
    format: "sf2",
    standard: overlay.soundfont.standard,
    approxSizeMb: overlay.soundfont.approxSizeMb,
    generatedFrom: "scripts/gen-sf2-capabilities.cjs (parses the SF2 RIFF hydra directly)",
  },
  banks: {
    melodic: [...new Set(melodic.map((p) => p.bank))].sort((a, b) => a - b),
    percussion: 128,
  },
  drumKits,
  melodicPresets: melodic
    .slice()
    .sort((a, b) => a.bank - b.bank || a.program - b.program)
    .map((p) => ({ bank: p.bank, program: p.program, name: p.name })),
  percussionSemantics,
  knownCollisions,
};

fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${outPath}`);
console.log(
  `  drumKits=${drumKits.length} melodicPresets=${manifest.melodicPresets.length} samples=${parsed.sampleCount}`,
);
console.log(`  semantics=${Object.keys(percussionSemantics).length} collisions=${knownCollisions.length}`);
if (warnings.length) {
  console.log(`  WARNINGS (${warnings.length}):`);
  for (const w of [...new Set(warnings)]) console.log(`    - ${w}`);
} else {
  console.log("  all semantic addresses validated against parsed key maps ✓");
}
