/* eslint-disable -- auto-generated; edit mnx-schema.json + run pnpm gen:raw */
// AUTO-GENERATED FROM packages/format/schemas/mnx-schema.json — DO NOT EDIT BY HAND.
// Regenerate with:  pnpm --filter @viritura/format gen:raw
// These are wire-shape types (1:1 with the MNX JSON schema). Use promote.ts
// to convert to the decoded Score model in @viritura/core.
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * MNX document
         * @description An encoding of Common Western Music Notation.
         */
        MnxDocument: components["schemas"]["root"];
        accent: {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        "accidental-display": {
            enclosure?: components["schemas"]["accidental-enclosure"];
            force?: boolean;
            show: boolean;
        } & components["schemas"]["global-attrs"];
        "accidental-enclosure": {
            symbol: components["schemas"]["accidental-enclosure-symbol"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "accidental-enclosure-symbol": "parentheses" | "brackets";
        alter: number;
        arpeggio: {
            arrow?: boolean;
            direction?: components["schemas"]["up-down-auto"];
            position: components["schemas"]["rhythmic-position"];
            span: components["schemas"]["id-pair"];
        } & components["schemas"]["global-attrs"];
        barline: {
            type: components["schemas"]["barline-type"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "barline-type": "regular" | "dotted" | "dashed" | "heavy" | "double" | "final" | "heavyLight" | "heavyHeavy" | "tick" | "short" | "noBarline";
        beam: {
            beams?: components["schemas"]["beam-list"];
            direction?: components["schemas"]["beam-hook-direction"];
            events: components["schemas"]["id"][];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "beam-hook-direction": "left" | "right" | "auto";
        "beam-list": components["schemas"]["beam"][];
        "bow-direction": {
            direction: components["schemas"]["up-down"];
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        bpm: number;
        "breath-mark": {
            orient?: components["schemas"]["orientation"];
            symbol?: components["schemas"]["breath-mark-symbol"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "breath-mark-symbol": "comma" | "tick" | "upbow" | "salzedo" | "auto";
        clef: {
            color?: components["schemas"]["simple-color"];
            glyph?: components["schemas"]["smufl-glyph"];
            octave?: components["schemas"]["ottava-amount-or-zero"];
            showOctave?: boolean;
            sign: components["schemas"]["clef-sign"];
            staffPosition: components["schemas"]["staff-position"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "clef-sign": "C" | "F" | "G";
        color: string;
        "dynamic-group": {
            accentPrefix?: components["schemas"]["dynamic-prefix"];
            accentSuffix?: components["schemas"]["dynamic-suffix"];
            end?: components["schemas"]["measure-rhythmic-position"];
            glyphs?: components["schemas"]["smufl-glyph"][];
            orient?: components["schemas"]["multi-staff-orientation"];
            position: components["schemas"]["rhythmic-position"];
            prefix?: components["schemas"]["string"];
            relativeValue?: components["schemas"]["relative-dynamic-value"];
            residualValue?: components["schemas"]["dynamic-value"];
            staff?: components["schemas"]["staff-number"];
            staffEnd?: components["schemas"]["staff-number"];
            suffix?: components["schemas"]["string"];
            type: components["schemas"]["dynamic-group-type"];
            value?: components["schemas"]["dynamic-value"];
            visuallyContinues?: components["schemas"]["id"];
            voice?: components["schemas"]["voice-name"];
            wedgeType?: components["schemas"]["wedge-type"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "dynamic-group-type": "immediate" | "gradual" | "relative" | "accent";
        /** @enum {string} */
        "dynamic-prefix": "s" | "r" | "";
        /** @enum {string} */
        "dynamic-suffix": "z" | "";
        /** @enum {string} */
        "dynamic-value": "ppp" | "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff" | "n" | "pppp" | "ppppp" | "ffff" | "fffff" | "pppppp" | "ffffff";
        ending: {
            color?: components["schemas"]["color"];
            duration: components["schemas"]["ending-duration"];
            numbers?: components["schemas"]["ending-number"][];
            open?: components["schemas"]["ending-open"];
        } & components["schemas"]["global-attrs"];
        "ending-duration": number;
        "ending-number": number;
        "ending-open": boolean;
        event: {
            duration: components["schemas"]["note-value"];
            fermata?: components["schemas"]["fermata"];
            kitNotes?: components["schemas"]["kit-note"][];
            lyrics?: components["schemas"]["lyrics"];
            markings?: components["schemas"]["event-markings"];
            notes?: components["schemas"]["note"][];
            orient?: components["schemas"]["orientation"];
            rest?: components["schemas"]["rest"];
            slurs?: components["schemas"]["slur"][];
            staff?: components["schemas"]["staff-number"];
            stemDirection?: components["schemas"]["stem-direction"];
            /** @constant */
            type?: "event";
        } & components["schemas"]["global-attrs"];
        "event-lyric-line": {
            text: components["schemas"]["string"];
            type?: components["schemas"]["event-lyric-line-type"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "event-lyric-line-type": "start" | "middle" | "end" | "whole";
        "event-lyric-lines": {
            [key: string]: components["schemas"]["event-lyric-line"];
        };
        "event-markings": {
            accent?: components["schemas"]["accent"];
            bowDirection?: components["schemas"]["bow-direction"];
            breath?: components["schemas"]["breath-mark"];
            softAccent?: components["schemas"]["soft-accent"];
            spiccato?: components["schemas"]["spiccato"];
            staccatissimo?: components["schemas"]["staccatissimo"];
            staccato?: components["schemas"]["staccato"];
            stress?: components["schemas"]["stress-marking"];
            strongAccent?: components["schemas"]["strong-accent"];
            tenuto?: components["schemas"]["tenuto"];
            tremolo?: components["schemas"]["tremolo-single"];
            unstress?: components["schemas"]["unstress-marking"];
        } & components["schemas"]["global-attrs"];
        fermata: {
            duration?: components["schemas"]["fermata-duration"];
            orient?: components["schemas"]["orientation"];
            pointing?: components["schemas"]["up-down-auto"];
            symbol?: components["schemas"]["fermata-symbol"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "fermata-duration": "auto" | "none" | "veryLong" | "long" | "normal" | "short" | "veryShort";
        /** @enum {string} */
        "fermata-symbol": "normal" | "angled" | "square" | "doubleAngled" | "doubleSquare" | "doubleDot" | "halfCurve" | "curlew";
        fifths: number;
        fine: {
            color?: components["schemas"]["color"];
            location: components["schemas"]["rhythmic-position"];
        } & components["schemas"]["global-attrs"];
        fraction: components["schemas"]["integer-unsigned"][];
        "full-measure-rest": {
            fermata?: components["schemas"]["fermata"];
            staffPosition?: components["schemas"]["staff-position"];
            visualDuration?: components["schemas"]["note-value"];
        } & components["schemas"]["global-attrs"];
        global: {
            lyrics?: components["schemas"]["lyrics-global"];
            measures: components["schemas"]["measure-global"][];
            sounds?: components["schemas"]["sounds-global"];
        } & components["schemas"]["global-attrs"];
        "global-attrs": {
            _c?: components["schemas"]["string"];
            _x?: components["schemas"]["vendor-extensions"];
            id?: components["schemas"]["id"];
        };
        grace: {
            color?: components["schemas"]["color"];
            content: components["schemas"]["event"][];
            graceType?: components["schemas"]["grace-type"];
            slash?: boolean;
            /** @constant */
            type: "grace";
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "grace-type": "makeTime" | "stealFollowing" | "stealPrevious";
        id: string;
        "id-pair": {
            end: components["schemas"]["id"];
            start: components["schemas"]["id"];
        };
        "integer-signed": number;
        "integer-unsigned": number;
        interval: {
            halfSteps: components["schemas"]["integer-signed"];
            staffDistance: components["schemas"]["integer-signed"];
        } & components["schemas"]["global-attrs"];
        jump: {
            location: components["schemas"]["rhythmic-position"];
            type: components["schemas"]["jump-type"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "jump-type": "dsalfine" | "segno";
        key: {
            color?: components["schemas"]["color"];
            fifths: components["schemas"]["fifths"];
        } & components["schemas"]["global-attrs"];
        kit: {
            [key: string]: components["schemas"]["kit-component"];
        };
        "kit-component": {
            name?: components["schemas"]["string"];
            sound?: components["schemas"]["id"];
            staffPosition: components["schemas"]["staff-position"];
        } & components["schemas"]["global-attrs"];
        "kit-note": {
            kitComponent: components["schemas"]["id"];
            perform?: components["schemas"]["perform-options"];
            staff?: components["schemas"]["staff-number"];
            ties?: components["schemas"]["tie-list"];
        } & components["schemas"]["global-attrs"];
        "language-code": string;
        "layout-change": {
            layout: components["schemas"]["id"];
            location: components["schemas"]["measure-rhythmic-position"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "line-type": "dashed" | "dotted" | "solid" | "wavy";
        "lyric-line-id": string;
        "lyric-line-label": string;
        "lyric-line-metadata": {
            label?: components["schemas"]["lyric-line-label"];
            lang?: components["schemas"]["language-code"];
        } & components["schemas"]["global-attrs"];
        "lyric-lines-metadata": {
            [key: string]: components["schemas"]["lyric-line-metadata"];
        };
        lyrics: {
            lines?: components["schemas"]["event-lyric-lines"];
        } & components["schemas"]["global-attrs"];
        "lyrics-global": {
            lineMetadata?: components["schemas"]["lyric-lines-metadata"];
            lineOrder?: components["schemas"]["lyric-line-id"][];
        } & components["schemas"]["global-attrs"];
        "measure-count": number;
        "measure-global": {
            barline?: components["schemas"]["barline"];
            ending?: components["schemas"]["ending"];
            fermata?: components["schemas"]["fermata"];
            fine?: components["schemas"]["fine"];
            jump?: components["schemas"]["jump"];
            key?: components["schemas"]["key"];
            number?: components["schemas"]["measure-number"];
            repeatEnd?: components["schemas"]["repeat-end"];
            repeatStart?: components["schemas"]["repeat-start"];
            segno?: components["schemas"]["segno"];
            tempos?: components["schemas"]["tempo"][];
            time?: components["schemas"]["time"];
        } & components["schemas"]["global-attrs"];
        "measure-number": number;
        "measure-repeat": {
            counter?: components["schemas"]["measure-repeat-counter"];
            displayNumber?: components["schemas"]["yes-no-auto"];
            number: components["schemas"]["measure-repeat-count"];
            staffPosition?: components["schemas"]["staff-position"];
        } & components["schemas"]["global-attrs"];
        "measure-repeat-count": number;
        "measure-repeat-counter": {
            count: components["schemas"]["positive-integer"];
            orient?: components["schemas"]["multi-staff-orientation"];
        } & components["schemas"]["global-attrs"];
        "measure-rhythmic-position": {
            measure: components["schemas"]["id"];
            position: components["schemas"]["rhythmic-position"];
        } & components["schemas"]["global-attrs"];
        "midi-number": number;
        mnx: {
            support?: components["schemas"]["support"];
            version: components["schemas"]["version-number"];
        } & components["schemas"]["global-attrs"];
        "multi-note-tremolo": {
            content: components["schemas"]["event"][];
            individualDuration?: components["schemas"]["note-value"];
            marks: components["schemas"]["positive-integer"];
            outer: components["schemas"]["note-value-quantity"];
            /** @constant */
            type: "tremolo";
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "multi-staff-orientation": "above" | "auto" | "below" | "between";
        "multimeasure-rest": {
            duration: components["schemas"]["measure-count"];
            label?: components["schemas"]["string"];
            start: components["schemas"]["id"];
        } & components["schemas"]["global-attrs"];
        "non-arpeggio": {
            position: components["schemas"]["rhythmic-position"];
            span: components["schemas"]["id-pair"];
        } & components["schemas"]["global-attrs"];
        note: {
            accidentalDisplay?: components["schemas"]["accidental-display"];
            perform?: components["schemas"]["perform-options"];
            pitch: components["schemas"]["pitch"];
            staff?: components["schemas"]["staff-number"];
            ties?: components["schemas"]["tie-list"];
            written?: components["schemas"]["written"];
        } & components["schemas"]["global-attrs"];
        "note-value": {
            base: components["schemas"]["note-value-base"];
            dots?: components["schemas"]["integer-unsigned"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "note-value-base": "duplexMaxima" | "maxima" | "longa" | "breve" | "whole" | "half" | "quarter" | "eighth" | "16th" | "32nd" | "64th" | "128th" | "256th" | "512th" | "1024th" | "2048th" | "4096th";
        "note-value-quantity": {
            duration: components["schemas"]["note-value"];
            multiple: components["schemas"]["positive-integer"];
        } & components["schemas"]["global-attrs"];
        octave: number;
        /** @enum {string} */
        orientation: "above" | "below" | "auto";
        ottava: {
            end: components["schemas"]["measure-rhythmic-position"];
            orient?: components["schemas"]["orientation"];
            position: components["schemas"]["rhythmic-position"];
            staff?: components["schemas"]["staff-number"];
            value: components["schemas"]["ottava-amount"];
            voice?: components["schemas"]["voice-name"];
        } & components["schemas"]["global-attrs"];
        /** @enum {integer} */
        "ottava-amount": 1 | 2 | -1 | -2 | 3 | -3;
        /** @enum {integer} */
        "ottava-amount-or-zero": 1 | 2 | -1 | -2 | 3 | -3 | 0;
        page: {
            layout?: components["schemas"]["id"];
            systems: components["schemas"]["system"][];
        } & components["schemas"]["global-attrs"];
        part: {
            kit?: components["schemas"]["kit"];
            measures: components["schemas"]["part-measure"][];
            name?: components["schemas"]["part-name"];
            shortName?: components["schemas"]["part-short-name"];
            smuflFont?: components["schemas"]["smufl-font"];
            staves?: components["schemas"]["staff-count"];
            transposition?: components["schemas"]["part-transposition"];
        } & components["schemas"]["global-attrs"];
        "part-measure": {
            arpeggios?: components["schemas"]["arpeggio"][];
            beams?: components["schemas"]["beam-list"];
            clefs?: components["schemas"]["positioned-clef"][];
            dynamics?: components["schemas"]["dynamic-group"][];
            measureRepeat?: components["schemas"]["measure-repeat"];
            nonArpeggios?: components["schemas"]["non-arpeggio"][];
            ottavas?: components["schemas"]["ottava"][];
            sequences: components["schemas"]["sequence"][];
        } & components["schemas"]["global-attrs"];
        "part-name": string;
        "part-short-name": string;
        "part-transposition": {
            interval: components["schemas"]["interval"];
            keyFifthsFlipAt?: components["schemas"]["integer-signed"];
            prefersWrittenPitches?: boolean;
        } & components["schemas"]["global-attrs"];
        "perform-options": components["schemas"]["global-attrs"];
        pitch: {
            alter?: components["schemas"]["alter"];
            octave: components["schemas"]["octave"];
            step: components["schemas"]["step"];
        } & components["schemas"]["global-attrs"];
        "positioned-clef": {
            clef: components["schemas"]["clef"];
            position?: components["schemas"]["rhythmic-position"];
            staff?: components["schemas"]["staff-number"];
        } & components["schemas"]["global-attrs"];
        "positive-integer": number;
        /** @enum {string} */
        "relative-dynamic-value": "louder" | "softer";
        "repeat-end": {
            times?: components["schemas"]["repeat-times"];
        } & components["schemas"]["global-attrs"];
        "repeat-start": components["schemas"]["global-attrs"];
        "repeat-times": number;
        rest: {
            staffPosition?: components["schemas"]["staff-position"];
        } & components["schemas"]["global-attrs"];
        "rhythmic-position": {
            fraction: components["schemas"]["fraction"];
            graceIndex?: components["schemas"]["integer-unsigned"];
        } & components["schemas"]["global-attrs"];
        root: {
            global: components["schemas"]["global"];
            layouts?: components["schemas"]["system-layout"][];
            mnx: components["schemas"]["mnx"];
            parts: components["schemas"]["part"][];
            scores?: components["schemas"]["score"][];
        } & components["schemas"]["global-attrs"];
        score: {
            layout?: components["schemas"]["id"];
            multimeasureRests?: components["schemas"]["multimeasure-rest"][];
            name: components["schemas"]["score-name"];
            pages?: components["schemas"]["page"][];
            useWritten?: boolean;
        } & components["schemas"]["global-attrs"];
        "score-name": string;
        segno: {
            color?: components["schemas"]["color"];
            glyph?: components["schemas"]["smufl-glyph"];
            location: components["schemas"]["rhythmic-position"];
        } & components["schemas"]["global-attrs"];
        sequence: {
            content: components["schemas"]["sequence-content"];
            fullMeasure?: components["schemas"]["full-measure-rest"];
            orient?: components["schemas"]["orientation"];
            staff?: components["schemas"]["staff-number"];
            voice?: components["schemas"]["voice-name"];
        } & components["schemas"]["global-attrs"];
        "sequence-content": (components["schemas"]["event"] | components["schemas"]["grace"] | components["schemas"]["tuplet"] | components["schemas"]["space"] | components["schemas"]["multi-note-tremolo"])[];
        "simple-color": string;
        slur: {
            endNote?: components["schemas"]["id"];
            lineType?: components["schemas"]["line-type"];
            side?: components["schemas"]["slur-side"];
            sideEnd?: components["schemas"]["slur-side"];
            startNote?: components["schemas"]["id"];
            target: components["schemas"]["id"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "slur-side": "up" | "down";
        "smufl-font": string;
        "smufl-glyph": string;
        "soft-accent": {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        sound: {
            midiNumber?: components["schemas"]["midi-number"];
            name?: components["schemas"]["string"];
        } & components["schemas"]["global-attrs"];
        "sounds-global": {
            [key: string]: components["schemas"]["sound"];
        };
        space: {
            duration: components["schemas"]["fraction"];
            /** @constant */
            type: "space";
        } & components["schemas"]["global-attrs"];
        spiccato: {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        staccatissimo: {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        staccato: {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        staff: {
            label?: components["schemas"]["staff-label"];
            labelref?: components["schemas"]["staff-labelref"];
            sources: components["schemas"]["staff-source"][];
            symbol?: components["schemas"]["staff-symbol"];
            /** @constant */
            type: "staff";
        } & components["schemas"]["global-attrs"];
        "staff-count": number;
        "staff-group": {
            barlineStyle?: components["schemas"]["staff-group-barline-style"];
            content: components["schemas"]["system-layout-content"];
            label?: components["schemas"]["staff-label"];
            symbol?: components["schemas"]["staff-symbol"];
            /** @constant */
            type: "group";
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "staff-group-barline-style": "individual" | "instrument" | "unified" | "mensurstrich";
        "staff-label": string;
        /** @enum {string} */
        "staff-labelref": "name" | "shortName";
        "staff-number": number;
        "staff-position": number;
        "staff-source": {
            label?: components["schemas"]["staff-label"];
            labelref?: components["schemas"]["staff-labelref"];
            part: components["schemas"]["id"];
            staff?: components["schemas"]["staff-number"];
            stem?: components["schemas"]["stem-direction"];
            voice?: components["schemas"]["voice-name"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "staff-symbol": "bracket" | "brace" | "noSymbol";
        /** @enum {string} */
        "stem-direction": "up" | "down";
        /** @enum {string} */
        step: "A" | "B" | "C" | "D" | "E" | "F" | "G";
        "stress-marking": {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        string: string;
        "strong-accent": {
            orient?: components["schemas"]["orientation"];
            pointing?: components["schemas"]["up-down-auto"];
        } & components["schemas"]["global-attrs"];
        support: {
            useAccidentalDisplay?: boolean;
            useBeams?: boolean;
        } & components["schemas"]["global-attrs"];
        system: {
            layout?: components["schemas"]["id"];
            layoutChanges?: components["schemas"]["layout-change"][];
            measure: components["schemas"]["id"];
        } & components["schemas"]["global-attrs"];
        "system-layout": {
            content: components["schemas"]["system-layout-content"];
        } & components["schemas"]["global-attrs"];
        "system-layout-content": (components["schemas"]["staff-group"] | components["schemas"]["staff"])[];
        tempo: {
            bpm: components["schemas"]["bpm"];
            location?: components["schemas"]["rhythmic-position"];
            value: components["schemas"]["note-value"];
        } & components["schemas"]["global-attrs"];
        tenuto: {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        tie: {
            lv?: boolean;
            side?: components["schemas"]["slur-side"];
            target?: components["schemas"]["id"];
            targetType?: components["schemas"]["tie-target-type"];
        } & components["schemas"]["global-attrs"];
        "tie-list": components["schemas"]["tie"][];
        /** @enum {string} */
        "tie-target-type": "nextNote" | "crossVoice" | "arpeggio" | "crossJump";
        time: {
            count: components["schemas"]["positive-integer"];
            display?: components["schemas"]["time-signature-display"];
            unit: components["schemas"]["time-signature-unit"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "time-signature-display": "common" | "cut";
        /** @enum {integer} */
        "time-signature-unit": 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128;
        "tremolo-single": {
            marks: components["schemas"]["positive-integer"];
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        tuplet: {
            bracket?: components["schemas"]["yes-no-auto"];
            content: components["schemas"]["sequence-content"];
            inner: components["schemas"]["note-value-quantity"];
            orient?: components["schemas"]["orientation"];
            outer: components["schemas"]["note-value-quantity"];
            showNumber?: components["schemas"]["tuplet-display-setting"];
            showValue?: components["schemas"]["tuplet-display-setting"];
            staff?: components["schemas"]["staff-number"];
            /** @constant */
            type: "tuplet";
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "tuplet-display-setting": "noNumber" | "inner" | "both";
        "unstress-marking": {
            orient?: components["schemas"]["orientation"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "up-down": "up" | "down";
        /** @enum {string} */
        "up-down-auto": "up" | "down" | "auto";
        "vendor-dict": Record<string, never>;
        "vendor-extensions": {
            [key: string]: components["schemas"]["vendor-dict"];
        };
        "version-number": number;
        "voice-name": string;
        /** @enum {string} */
        "wedge-type": "increasing" | "decreasing";
        written: {
            diatonicDelta?: components["schemas"]["integer-signed"];
        } & components["schemas"]["global-attrs"];
        /** @enum {string} */
        "yes-no-auto": "yes" | "no" | "auto";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

// ─── PascalCase aliases ─────────────────────────────────────────────
// Auto-generated convenience aliases for every $def in mnx-schema.json.
export type MnxDocument = components["schemas"]["MnxDocument"];
export type Accent = components["schemas"]["accent"];
export type AccidentalDisplay = components["schemas"]["accidental-display"];
export type AccidentalEnclosure = components["schemas"]["accidental-enclosure"];
export type AccidentalEnclosureSymbol = components["schemas"]["accidental-enclosure-symbol"];
export type Alter = components["schemas"]["alter"];
export type Arpeggio = components["schemas"]["arpeggio"];
export type Barline = components["schemas"]["barline"];
export type BarlineType = components["schemas"]["barline-type"];
export type Beam = components["schemas"]["beam"];
export type BeamHookDirection = components["schemas"]["beam-hook-direction"];
export type BeamList = components["schemas"]["beam-list"];
export type BowDirection = components["schemas"]["bow-direction"];
export type Bpm = components["schemas"]["bpm"];
export type BreathMark = components["schemas"]["breath-mark"];
export type BreathMarkSymbol = components["schemas"]["breath-mark-symbol"];
export type Clef = components["schemas"]["clef"];
export type ClefSign = components["schemas"]["clef-sign"];
export type Color = components["schemas"]["color"];
export type DynamicGroup = components["schemas"]["dynamic-group"];
export type DynamicGroupType = components["schemas"]["dynamic-group-type"];
export type DynamicPrefix = components["schemas"]["dynamic-prefix"];
export type DynamicSuffix = components["schemas"]["dynamic-suffix"];
export type DynamicValue = components["schemas"]["dynamic-value"];
export type Ending = components["schemas"]["ending"];
export type EndingDuration = components["schemas"]["ending-duration"];
export type EndingNumber = components["schemas"]["ending-number"];
export type EndingOpen = components["schemas"]["ending-open"];
export type Event = components["schemas"]["event"];
export type EventLyricLine = components["schemas"]["event-lyric-line"];
export type EventLyricLineType = components["schemas"]["event-lyric-line-type"];
export type EventLyricLines = components["schemas"]["event-lyric-lines"];
export type EventMarkings = components["schemas"]["event-markings"];
export type Fermata = components["schemas"]["fermata"];
export type FermataDuration = components["schemas"]["fermata-duration"];
export type FermataSymbol = components["schemas"]["fermata-symbol"];
export type Fifths = components["schemas"]["fifths"];
export type Fine = components["schemas"]["fine"];
export type Fraction = components["schemas"]["fraction"];
export type FullMeasureRest = components["schemas"]["full-measure-rest"];
export type Global = components["schemas"]["global"];
export type GlobalAttrs = components["schemas"]["global-attrs"];
export type Grace = components["schemas"]["grace"];
export type GraceType = components["schemas"]["grace-type"];
export type Id = components["schemas"]["id"];
export type IdPair = components["schemas"]["id-pair"];
export type IntegerSigned = components["schemas"]["integer-signed"];
export type IntegerUnsigned = components["schemas"]["integer-unsigned"];
export type Interval = components["schemas"]["interval"];
export type Jump = components["schemas"]["jump"];
export type JumpType = components["schemas"]["jump-type"];
export type Key = components["schemas"]["key"];
export type Kit = components["schemas"]["kit"];
export type KitComponent = components["schemas"]["kit-component"];
export type KitNote = components["schemas"]["kit-note"];
export type LanguageCode = components["schemas"]["language-code"];
export type LayoutChange = components["schemas"]["layout-change"];
export type LineType = components["schemas"]["line-type"];
export type LyricLineId = components["schemas"]["lyric-line-id"];
export type LyricLineLabel = components["schemas"]["lyric-line-label"];
export type LyricLineMetadata = components["schemas"]["lyric-line-metadata"];
export type LyricLinesMetadata = components["schemas"]["lyric-lines-metadata"];
export type Lyrics = components["schemas"]["lyrics"];
export type LyricsGlobal = components["schemas"]["lyrics-global"];
export type MeasureCount = components["schemas"]["measure-count"];
export type MeasureGlobal = components["schemas"]["measure-global"];
export type MeasureNumber = components["schemas"]["measure-number"];
export type MeasureRepeat = components["schemas"]["measure-repeat"];
export type MeasureRepeatCount = components["schemas"]["measure-repeat-count"];
export type MeasureRepeatCounter = components["schemas"]["measure-repeat-counter"];
export type MeasureRhythmicPosition = components["schemas"]["measure-rhythmic-position"];
export type MidiNumber = components["schemas"]["midi-number"];
export type Mnx = components["schemas"]["mnx"];
export type MultiNoteTremolo = components["schemas"]["multi-note-tremolo"];
export type MultiStaffOrientation = components["schemas"]["multi-staff-orientation"];
export type MultimeasureRest = components["schemas"]["multimeasure-rest"];
export type NonArpeggio = components["schemas"]["non-arpeggio"];
export type Note = components["schemas"]["note"];
export type NoteValue = components["schemas"]["note-value"];
export type NoteValueBase = components["schemas"]["note-value-base"];
export type NoteValueQuantity = components["schemas"]["note-value-quantity"];
export type Octave = components["schemas"]["octave"];
export type Orientation = components["schemas"]["orientation"];
export type Ottava = components["schemas"]["ottava"];
export type OttavaAmount = components["schemas"]["ottava-amount"];
export type OttavaAmountOrZero = components["schemas"]["ottava-amount-or-zero"];
export type Page = components["schemas"]["page"];
export type Part = components["schemas"]["part"];
export type PartMeasure = components["schemas"]["part-measure"];
export type PartName = components["schemas"]["part-name"];
export type PartShortName = components["schemas"]["part-short-name"];
export type PartTransposition = components["schemas"]["part-transposition"];
export type PerformOptions = components["schemas"]["perform-options"];
export type Pitch = components["schemas"]["pitch"];
export type PositionedClef = components["schemas"]["positioned-clef"];
export type PositiveInteger = components["schemas"]["positive-integer"];
export type RelativeDynamicValue = components["schemas"]["relative-dynamic-value"];
export type RepeatEnd = components["schemas"]["repeat-end"];
export type RepeatStart = components["schemas"]["repeat-start"];
export type RepeatTimes = components["schemas"]["repeat-times"];
export type Rest = components["schemas"]["rest"];
export type RhythmicPosition = components["schemas"]["rhythmic-position"];
export type Root = components["schemas"]["root"];
export type Score = components["schemas"]["score"];
export type ScoreName = components["schemas"]["score-name"];
export type Segno = components["schemas"]["segno"];
export type Sequence = components["schemas"]["sequence"];
export type SequenceContent = components["schemas"]["sequence-content"];
export type SimpleColor = components["schemas"]["simple-color"];
export type Slur = components["schemas"]["slur"];
export type SlurSide = components["schemas"]["slur-side"];
export type SmuflFont = components["schemas"]["smufl-font"];
export type SmuflGlyph = components["schemas"]["smufl-glyph"];
export type SoftAccent = components["schemas"]["soft-accent"];
export type Sound = components["schemas"]["sound"];
export type SoundsGlobal = components["schemas"]["sounds-global"];
export type Space = components["schemas"]["space"];
export type Spiccato = components["schemas"]["spiccato"];
export type Staccatissimo = components["schemas"]["staccatissimo"];
export type Staccato = components["schemas"]["staccato"];
export type Staff = components["schemas"]["staff"];
export type StaffCount = components["schemas"]["staff-count"];
export type StaffGroup = components["schemas"]["staff-group"];
export type StaffGroupBarlineStyle = components["schemas"]["staff-group-barline-style"];
export type StaffLabel = components["schemas"]["staff-label"];
export type StaffLabelref = components["schemas"]["staff-labelref"];
export type StaffNumber = components["schemas"]["staff-number"];
export type StaffPosition = components["schemas"]["staff-position"];
export type StaffSource = components["schemas"]["staff-source"];
export type StaffSymbol = components["schemas"]["staff-symbol"];
export type StemDirection = components["schemas"]["stem-direction"];
export type Step = components["schemas"]["step"];
export type StressMarking = components["schemas"]["stress-marking"];
export type String = components["schemas"]["string"];
export type StrongAccent = components["schemas"]["strong-accent"];
export type Support = components["schemas"]["support"];
export type System = components["schemas"]["system"];
export type SystemLayout = components["schemas"]["system-layout"];
export type SystemLayoutContent = components["schemas"]["system-layout-content"];
export type Tempo = components["schemas"]["tempo"];
export type Tenuto = components["schemas"]["tenuto"];
export type Tie = components["schemas"]["tie"];
export type TieList = components["schemas"]["tie-list"];
export type TieTargetType = components["schemas"]["tie-target-type"];
export type Time = components["schemas"]["time"];
export type TimeSignatureDisplay = components["schemas"]["time-signature-display"];
export type TimeSignatureUnit = components["schemas"]["time-signature-unit"];
export type TremoloSingle = components["schemas"]["tremolo-single"];
export type Tuplet = components["schemas"]["tuplet"];
export type TupletDisplaySetting = components["schemas"]["tuplet-display-setting"];
export type UnstressMarking = components["schemas"]["unstress-marking"];
export type UpDown = components["schemas"]["up-down"];
export type UpDownAuto = components["schemas"]["up-down-auto"];
export type VendorDict = components["schemas"]["vendor-dict"];
export type VendorExtensions = components["schemas"]["vendor-extensions"];
export type VersionNumber = components["schemas"]["version-number"];
export type VoiceName = components["schemas"]["voice-name"];
export type WedgeType = components["schemas"]["wedge-type"];
export type Written = components["schemas"]["written"];
export type YesNoAuto = components["schemas"]["yes-no-auto"];
