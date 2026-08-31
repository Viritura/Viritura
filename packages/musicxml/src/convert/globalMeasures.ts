import { BARLINE_STYLE_MAP, BEAT_UNIT_MAP } from "../constants";
import { Fraction } from "../fraction";
import { childElements, childText, findChild, findChildren } from "../xmlHelpers";
import type { MnxGlobalMeasure, MnxRhythmicPosition, MnxTempo } from "../types";
import { IdGenerator } from "./idGenerator";
import { makePosition } from "./pitchDuration";

// eslint-disable-next-line max-lines-per-function, max-statements, complexity -- branchy traversal of MusicXML measure grammar (time/key/direction/barline/repeat/volta); decomposing further would fragment a single linear pipeline
export function buildGlobalMeasures(
  root: Element,
  ids: IdGenerator,
  vendorExt = false,
  hideMetronomeWhenTempoText = false,
): MnxGlobalMeasure[] {
  const partEls = findChildren(root, "part");
  if (partEls.length === 0) return [];

  const firstPartMeasures = findChildren(partEls[0]!, "measure");
  const globalMeasures: MnxGlobalMeasure[] = [];
  let currentTime: string | null = null;
  let currentKey: number | null = null;

  for (let mi = 0; mi < firstPartMeasures.length; mi++) {
    const mxmlMeasure = firstPartMeasures[mi]!;
    const measureId = ids.next("m");
    const gm: MnxGlobalMeasure = { id: measureId };

    const measureNum = mxmlMeasure.getAttribute("number");
    if (measureNum) {
      const n = parseInt(measureNum, 10);
      if (!isNaN(n)) gm.number = n;
    }

    const attrs = findChild(mxmlMeasure, "attributes");

    if (attrs) {
      // Time signature
      const timeEl = findChild(attrs, "time");
      // `senza-misura` (unmetered cadenza) carries no beats/beat-type. Emitting
      // a default 4/4 here would force the engine to bar-fit an arbitrarily long
      // cadenza into four beats; instead we leave the meter unchanged so the
      // measure inherits context and lays out its content freely.
      if (timeEl && !findChild(timeEl, "senza-misura")) {
        const symbol = timeEl.getAttribute("symbol");
        const count = parseInt(childText(timeEl, "beats") ?? "4", 10);
        const unit = parseInt(childText(timeEl, "beat-type") ?? "4", 10);
        const newTimeKey = `${count}/${unit}/${symbol ?? ""}`;
        if (newTimeKey !== currentTime) {
          const time: { count: number; unit: number; display?: string } = { count, unit };
          if (symbol === "common") time.display = "common";
          else if (symbol === "cut") time.display = "cut";
          gm.time = time;
          currentTime = newTimeKey;
        }
      }

      // Key signature
      const keyEl = findChild(attrs, "key");
      if (keyEl) {
        const fifthsText = childText(keyEl, "fifths");
        if (fifthsText !== null) {
          const fifths = parseInt(fifthsText, 10);
          const transpose = findChild(attrs, "transpose");
          if (!transpose) {
            if (fifths !== currentKey) {
              gm.key = { fifths };
              currentKey = fifths;
            }
          }
        }
      }
    }

    // Directions for tempo, segno, coda, fine, jumps
    let divisions = 4;
    if (attrs) {
      const divEl = findChild(attrs, "divisions");
      if (divEl) divisions = parseInt(divEl.textContent ?? "4", 10);
    }

    // Tempo / navigation carried by a `<sound>` element. MusicXML allows a
    // `<sound>` either nested inside a `<direction>` or as a direct child of
    // `<measure>` (many exporters emit bare `<sound tempo="…"/>` for tempo
    // changes). Handle both via this closure so neither placement is dropped.
    const applySound = (sound: Element, pos: Fraction): void => {
      const tempoAttr = sound.getAttribute("tempo");
      // Only the first tempo per measure wins (a metronome direction, when
      // present, is processed earlier and takes precedence over `<sound>`).
      if (tempoAttr && !gm.tempos?.length) {
        const bpm = parseFloat(tempoAttr);
        if (bpm > 0) {
          const tempo: MnxTempo = { bpm, value: { base: "quarter" } };
          if (pos.n !== 0) {
            tempo.location = makePosition(pos);
          }
          gm.tempos = [tempo];
        }
      }

      // Navigation
      if (sound.getAttribute("fine") === "yes") {
        gm.fine = { location: makePosition(pos) };
      }
      if (sound.getAttribute("dacapo") === "yes") {
        gm.jump = { type: "dsalfine", location: makePosition(pos) };
      }
      if (sound.getAttribute("dalsegno")) {
        gm.jump = { type: "segno", location: makePosition(pos) };
      }
    };

    let currentPos = Fraction.ZERO;
    // Tempo text directive (e.g. "Molto moderato"). MusicXML carries the tempo
    // value (metronome / `<sound tempo>`) and its textual description in
    // separate elements; the text lives in a `<direction directive="yes">`
    // `<words>`. Captured here and attached to the measure's tempo below as a
    // viritura vendor extension (MNX has no tempo-text field).
    let tempoText: string | undefined;
    for (const child of childElements(mxmlMeasure)) {
      if (child.tagName === "direction") {
        // Tempo
        for (const dt of findChildren(child, "direction-type")) {
          const metronome = findChild(dt, "metronome");
          if (metronome) {
            const beatUnit = childText(metronome, "beat-unit") ?? "quarter";
            const beatDots = findChildren(metronome, "beat-unit-dot").length;
            const perMinute = childText(metronome, "per-minute");
            if (perMinute) {
              const bpm = Math.round(parseFloat(perMinute));
              if (bpm > 0) {
                const base = BEAT_UNIT_MAP[beatUnit] ?? "quarter";
                const tempo: MnxTempo = {
                  bpm,
                  value: beatDots > 0 ? { base, dots: beatDots } : { base },
                };
                // eslint-disable-next-line max-depth -- nested MusicXML grammar requires this depth
                if (currentPos.n !== 0) {
                  tempo.location = makePosition(currentPos);
                }
                // eslint-disable-next-line max-depth -- nested MusicXML grammar requires this depth
                if (!gm.tempos) gm.tempos = [];
                gm.tempos.push(tempo);
              }
            }
          }

          // Segno
          {
            const segnoEl = findChild(dt, "segno");
            if (segnoEl) {
              const seg: { location: MnxRhythmicPosition; glyph?: string } = {
                location: makePosition(currentPos),
              };
              // MusicXML <segno smufl="segnoSerpent1"/> → MNX `segno.glyph`.
              const smuflName = segnoEl.getAttribute("smufl");
              if (smuflName) seg.glyph = smuflName;
              gm.segno = seg;
            }
          }
          // Coda (store as vendor extension since MNX uses jumps)
          if (findChild(dt, "coda")) {
            // MNX doesn't have a separate coda object; it uses segno + jumps
            // We map coda to segno as a reasonable approximation
            if (!gm.segno) {
              gm.segno = { location: makePosition(currentPos) };
            }
          }
        }

        // Sound element for tempo / navigation
        const sound = findChild(child, "sound");
        if (sound) {
          applySound(sound, currentPos);
        }

        // Tempo text directive (e.g. "Molto moderato"). Only directions flagged
        // `directive="yes"` carry tempo/expression directives; the first such
        // `<words>` in the measure becomes the tempo text.
        if (vendorExt && tempoText === undefined && child.getAttribute("directive") === "yes") {
          for (const dt of findChildren(child, "direction-type")) {
            const wordsEl = findChild(dt, "words");
            const txt = wordsEl?.textContent?.trim();
            if (txt) {
              tempoText = txt;
              break;
            }
          }
        }
      } else if (child.tagName === "sound") {
        // Bare `<sound>` directly under `<measure>` (tempo changes, jumps).
        applySound(child, currentPos);
      } else if (child.tagName === "note") {
        if (findChild(child, "chord") === null && findChild(child, "grace") === null) {
          const durEl = findChild(child, "duration");
          if (durEl) {
            currentPos = currentPos.add(new Fraction(parseInt(durEl.textContent ?? "0", 10), divisions * 4));
          }
        }
      } else if (child.tagName === "forward") {
        const durEl = findChild(child, "duration");
        if (durEl) {
          currentPos = currentPos.add(new Fraction(parseInt(durEl.textContent ?? "0", 10), divisions * 4));
        }
      } else if (child.tagName === "backup") {
        const durEl = findChild(child, "duration");
        if (durEl) {
          currentPos = currentPos.subtract(new Fraction(parseInt(durEl.textContent ?? "0", 10), divisions * 4));
          if (currentPos.isNegative()) currentPos = Fraction.ZERO;
        }
      }
    }

    // Attach the captured tempo-text directive to the measure's tempo. MNX has
    // no tempo-text field, so it rides along as a viritura vendor extension
    // (`_x.viritura.text`) on the first tempo of the measure.
    if (tempoText !== undefined && gm.tempos?.length) {
      const tempo = gm.tempos[0]!;
      if (!tempo._x) tempo._x = { viritura: {} };
      tempo._x.viritura["text"] = tempoText;
      // When a written tempo text is present (e.g. "Molto moderato"), hide the
      // numeric metronome mark if requested. Metronome marks are typical of
      // modern repertoire; many earlier works carry a verbal tempo only, and
      // their bpm is often an implicit playback value the exporter added rather
      // than an engraved marking. Tagging `showMetronomeMark: false` keeps the
      // tempo audible for playback while engraving the text alone.
      if (hideMetronomeWhenTempoText) {
        tempo._x.viritura["showMetronomeMark"] = false;
      }
    }

    // Barlines and repeats
    for (const bl of findChildren(mxmlMeasure, "barline")) {
      const location = bl.getAttribute("location") ?? "right";
      const barStyle = findChild(bl, "bar-style");
      const repeat = findChild(bl, "repeat");
      const endingEl = findChild(bl, "ending");

      if (repeat) {
        const direction = repeat.getAttribute("direction");
        const times = repeat.getAttribute("times");
        if (direction === "forward") {
          gm.repeatStart = {};
        } else if (direction === "backward") {
          const repeatEnd: { times?: number } = {};
          if (times) {
            const t = parseInt(times, 10);
            if (t > 0) repeatEnd.times = t;
          }
          gm.repeatEnd = repeatEnd;
        }
      } else if (barStyle && location === "right") {
        const style = BARLINE_STYLE_MAP[barStyle.textContent ?? "regular"] ?? "regular";
        if (style !== "regular") {
          gm.barline = { type: style };
        }
      }

      // Volta endings
      if (endingEl) {
        const endingType = endingEl.getAttribute("type");
        if (endingType === "start") {
          const numberAttr = endingEl.getAttribute("number") ?? "1";
          const numbers = numberAttr
            .split(/[,\s]+/)
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n));
          gm.ending = {
            duration: 1, // will be updated by ending stop
            numbers: numbers.length > 0 ? numbers : [1],
          };
        }
      }
    }

    globalMeasures.push(gm);
  }

  // Post-process: fix ending durations by scanning for stop markers
  let activeEndingStart = -1;
  for (let mi = 0; mi < globalMeasures.length; mi++) {
    const gm = globalMeasures[mi]!;
    if (gm.ending) {
      activeEndingStart = mi;
    }

    // Check if this measure has an ending stop
    const mxmlMeasure = firstPartMeasures[mi]!;
    for (const bl of findChildren(mxmlMeasure, "barline")) {
      const endingEl = findChild(bl, "ending");
      if (endingEl) {
        const endingType = endingEl.getAttribute("type");
        if ((endingType === "stop" || endingType === "discontinue") && activeEndingStart >= 0) {
          const startGm = globalMeasures[activeEndingStart]!;
          if (startGm.ending) {
            startGm.ending.duration = mi - activeEndingStart + 1;
            if (endingType === "discontinue") startGm.ending.open = true;
          }
          activeEndingStart = -1;
        }
      }
    }
  }

  // Fix: ensure concert-pitch key from a non-transposing part
  if (currentKey === null && globalMeasures.length > 0) {
    for (const partEl of partEls) {
      const m1 = findChild(partEl, "measure");
      if (!m1) continue;
      const a = findChild(m1, "attributes");
      if (!a) continue;
      const t = findChild(a, "transpose");
      const k = findChild(a, "key");
      if (!t && k) {
        const fifthsText = childText(k, "fifths");
        if (fifthsText !== null) {
          globalMeasures[0]!.key = { fifths: parseInt(fifthsText, 10) };
          break;
        }
      }
    }
  }

  return globalMeasures;
}
