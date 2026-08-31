/* eslint-disable -- auto-generated; edit viritura-extensions.json + run pnpm gen:raw-viritura */
// AUTO-GENERATED FROM packages/format/schemas/viritura-extensions.json — DO NOT EDIT BY HAND.
// Regenerate with:  pnpm --filter @viritura/format gen:raw-viritura
// These are wire-shape types for `_x.viritura` payloads (1:1 with the
// extensions schema). The Rust counterpart lives at
// engine/viritura-engine/src/raw_viritura.rs.
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description A rhythmic position within a measure, expressed as a fraction of the measure duration. */
        "rhythmic-position": {
            /** @description Fraction as [numerator, denominator]. E.g. [1, 4] = beat 2 in 4/4 time. */
            fraction: number[];
        };
        /** @description A rhythmic position that may reference a different measure (for cross-barline spans). */
        "measure-rhythmic-position": {
            /** @description ID of the target measure. */
            measure: string;
            position: components["schemas"]["rhythmic-position"];
        };
        /** @description A rehearsal mark displayed above the staff (e.g. 'A', 'B', '1'). Typically rendered in a box or circle. */
        "rehearsal-mark": {
            /** @description The rehearsal mark label text. */
            text: string;
            /**
             * @description Display style. Default: 'boxed'.
             * @enum {string}
             */
            style?: "boxed" | "circled" | "plain";
            /** @description Manual [dx, dy] offset in spatia (sp); +x right, +y up. */
            manualOffset?: components["schemas"]["sp-delta"];
            /** @description Whether automatic collision avoidance may re-flow this mark. Default/unset: true. */
            avoidCollisions?: boolean;
        };
        /** @description A coda navigation marker on a global measure. */
        coda: {
            /** @description Position within the measure. */
            location: components["schemas"]["rhythmic-position"];
            /** @description Optional SMuFL glyph name override. */
            glyph?: string;
            /** @description Optional rendering color (CSS hex, e.g. '#FF0000'). */
            color?: string;
        };
        /** @description A caesura (grand pause / railroad tracks) on an event marking. */
        caesura: {
            /**
             * @description Caesura style variant. Default: 'normal'.
             * @enum {string}
             */
            style?: "normal" | "thick" | "short" | "curved";
        };
        /** @description Viritura engraving placement extensions on a standard MNX dynamic-group object. */
        "dynamic-group-extensions": {
            /** @description Manual [dx, dy] offset in spatia (sp), applied after automatic placement. */
            manualOffset?: components["schemas"]["sp-delta"];
            /** @description Whether automatic collision avoidance may re-flow this dynamic group. Default/unset: true. */
            avoidCollisions?: boolean;
        };
        /** @description Viritura display and placement extensions on a standard MNX tempo object. */
        "tempo-extensions": {
            text?: string;
            showMetronomeMark?: boolean;
            showText?: boolean;
            manualOffset?: components["schemas"]["sp-delta"];
            avoidCollisions?: boolean;
        };
        /** @description Viritura extensions on a standard MNX key-signature object. */
        "key-extensions": {
            /** @constant */
            atonal?: true;
        };
        /**
         * @description Piano pedal type.
         * @enum {string}
         */
        "pedal-type": "sustain" | "sostenuto" | "una-corda";
        /**
         * @description Pedal marking display style. 'text' shows Ped/*, 'bracket' shows a horizontal line with hooks.
         * @enum {string}
         */
        "pedal-line-style": "text" | "bracket";
        /** @description A piano pedal marking spanning from a position to an end position. */
        pedal: {
            type: components["schemas"]["pedal-type"];
            /** @description Start position within the measure. */
            position: components["schemas"]["rhythmic-position"];
            /** @description End position (may reference a different measure). */
            end: components["schemas"]["measure-rhythmic-position"];
            /** @description Display style. Default: 'text'. */
            style?: components["schemas"]["pedal-line-style"];
            /** @description Staff number (1-based). */
            staff?: number;
            /** @description Voice name. */
            voice?: string;
        };
        /**
         * @description Harmonic quality of a chord symbol.
         * @enum {string}
         */
        "chord-quality": "major" | "minor" | "dominant" | "diminished" | "augmented" | "half-diminished" | "minor-major" | "power" | "suspended2" | "suspended4";
        /** @description Root or bass note of a chord symbol. */
        "chord-root": {
            /**
             * @description Note letter name.
             * @enum {string}
             */
            step: "A" | "B" | "C" | "D" | "E" | "F" | "G";
            /** @description Chromatic alteration in semitones (-1 = flat, 1 = sharp). */
            alter?: number;
        };
        /** @description A chord symbol above the staff (e.g. 'Cmaj7', 'Dm', 'G7', 'F#dim'). */
        "chord-symbol": {
            /** @description Rhythmic position within the measure. */
            position: components["schemas"]["rhythmic-position"];
            /** @description Root note of the chord. */
            root: components["schemas"]["chord-root"];
            quality: components["schemas"]["chord-quality"];
            /** @description Bass note for slash chords (e.g. the 'E' in 'C/E'). */
            bass?: components["schemas"]["chord-root"];
            /**
             * @description Chord extension (7th, 9th, 11th, 13th).
             * @enum {integer}
             */
            extension?: 7 | 9 | 11 | 13;
            /** @description Override the computed display text (e.g. 'Cadd9'). */
            textOverride?: string;
        };
        /**
         * @description Placement of a text expression relative to the staff. Default: 'below'.
         * @enum {string}
         */
        "expression-placement": "below" | "above";
        /** @description A text expression or direction at a rhythmic position (e.g. 'dolce', 'rit.', 'a tempo'). Rendered in italic serif font. */
        "text-expression": {
            /** @description The expression text. */
            text: string;
            /** @description Rhythmic position within the measure. */
            position: components["schemas"]["rhythmic-position"];
            placement?: components["schemas"]["expression-placement"];
            /** @description Staff number (1-based). */
            staff?: number;
            /** @description Voice name. */
            voice?: string;
            /** @description Manual [dx, dy] offset in spatia (sp), applied after automatic placement. */
            manualOffset?: components["schemas"]["sp-delta"];
            /** @description Whether automatic collision avoidance may re-flow this expression outward to clear other directions. Default (and when unset): true. Set false when the user manually places the expression (e.g. by dragging) so it stays exactly where put and others flow around it. */
            avoidCollisions?: boolean;
        };
        /** @description A trill marking on a note. Renders the tr~ symbol above the note. */
        trill: {
            /**
             * @description Accidental on the auxiliary note: -1 = flat, 0 = natural, 1 = sharp.
             * @enum {integer}
             */
            accidental?: -1 | 0 | 1;
        };
        /**
         * @description Ornament type. Each maps to a SMuFL ornament glyph.
         * @enum {string}
         */
        "ornament-type": "turn" | "invertedTurn" | "mordent" | "invertedMordent" | "shortTrill" | "trillMordent" | "delayedTurn" | "schleifer";
        /** @description A fingering annotation on a note (digits 0–5). */
        fingering: {
            /** @description Finger number (0 = thumb/open, 1–5 = index through pinky). */
            finger: number;
        };
        /**
         * @description Glissando/portamento line style.
         * @enum {string}
         */
        "glissando-style": "straight" | "wavy";
        /** @description A glissando or portamento connecting this event to a target event. */
        glissando: {
            /** @description ID of the target event. */
            target: string;
            /** @description Line style. Default: 'straight'. */
            style?: components["schemas"]["glissando-style"];
            /** @description Optional text label (e.g. 'gliss.', 'port.'). */
            text?: string;
        };
        /** @description A [dx, dy] delta in spatia (sp) applied on top of an engine-computed point. */
        "sp-delta": number[];
        /** @description Per-handle bezier overrides for a slur. Each field is a [dx, dy] delta in spatia (sp) applied on top of the engine-computed point, so user edits compose with automatic collision avoidance. Used by engrave-mode handle drags. */
        "slur-shape": {
            /** @description Start endpoint delta. */
            p0?: components["schemas"]["sp-delta"];
            /** @description First control point delta. */
            p1?: components["schemas"]["sp-delta"];
            /** @description Second control point delta. */
            p2?: components["schemas"]["sp-delta"];
            /** @description End endpoint delta. */
            p3?: components["schemas"]["sp-delta"];
        };
        /** @description Viritura vendor extensions on an MNX slur object. */
        "slur-extensions": {
            shape?: components["schemas"]["slur-shape"];
        };
        /** @description A jump direction with a type not supported by the MNX spec (e.g. D.S. al Coda, D.C. al Coda). */
        jump: {
            /**
             * @description Non-standard jump type.
             * @enum {string}
             */
            type: "dsalcoda" | "dcalcoda";
            /** @description Position within the measure. */
            location: components["schemas"]["rhythmic-position"];
        };
        /** @description A gradual tempo change (ritardando / accelerando) playback curve. MNX has no gradual-tempo field, so Viritura models the playback ramp as a vendor extension on the global measure where it begins. The tempo ramps linearly in BPM from the tempo active at `position` (or `startBpm` if given) to `endBpm` at `end`. This is playback data only; the printed 'rit.'/'accel.' text is an ordinary text-expression. */
        "gradual-tempo": {
            /** @description Start position within this measure. */
            position: components["schemas"]["rhythmic-position"];
            /** @description End position (may reference a later measure). */
            end: components["schemas"]["measure-rhythmic-position"];
            /** @description Quarter-note BPM reached at the end of the ramp. */
            endBpm: number;
            /** @description Optional start BPM (quarter-note). Defaults to the tempo active at `position`. */
            startBpm?: number;
            /**
             * @description Optional classification. Cosmetic only; the BPM direction determines the audible behavior.
             * @enum {string}
             */
            kind?: "rit" | "accel";
        };
        /** @description Viritura vendor extensions on a global measure object. */
        "measure-global-extensions": {
            rehearsalMark?: components["schemas"]["rehearsal-mark"];
            coda?: components["schemas"]["coda"];
            jump?: components["schemas"]["jump"];
            gradualTempo?: components["schemas"]["gradual-tempo"];
            /**
             * @description Marks this measure as open meter without adding a nonstandard value to MNX time.display.
             * @constant
             */
            senzaMisura?: true;
        };
        /** @description Viritura vendor extensions on a part measure object. */
        "part-measure-extensions": {
            /** @description Piano pedal markings. */
            pedals?: components["schemas"]["pedal"][];
            /** @description Chord symbols above the staff. */
            chordSymbols?: components["schemas"]["chord-symbol"][];
            /** @description Text expressions and performance directions. */
            expressions?: components["schemas"]["text-expression"][];
            /**
             * @description User-specified condensing mode override for this measure.
             * @enum {string}
             */
            condensingOverride?: "unison" | "solo1" | "solo2" | "amalgamate" | "divisi";
        };
        /** @description Viritura vendor extensions on an event-markings object. */
        "event-markings-extensions": {
            /** @description Staccatissimo wedge articulation variant (SMuFL articStaccatissimoWedge). */
            staccatissimoWedge?: {
                /**
                 * @description Vertical orientation relative to the staff.
                 * @enum {string}
                 */
                orient?: "above" | "below" | "auto";
            };
            trill?: components["schemas"]["trill"];
            /** @description Ornament markings (turn, mordent, etc.). */
            ornaments?: components["schemas"]["ornament-type"][];
            /** @description Fingering annotations. */
            fingerings?: components["schemas"]["fingering"][];
            caesura?: components["schemas"]["caesura"];
            arpeggio?: components["schemas"]["arpeggio"];
        };
        /** @description A rolled-chord (arpeggio) indication on a chord event: a wavy vertical line to the left of the chord. Created on MusicXML `<arpeggiate>` import and authored natively. */
        arpeggio: {
            /**
             * @description Roll direction. Omitted means the renderer's default (upward) arpeggio.
             * @enum {string}
             */
            direction?: "up" | "down" | "auto";
        };
        /** @description Viritura vendor extensions on an event object. */
        "event-extensions": {
            /** @description Glissando/portamento lines to target events. */
            glissandos?: components["schemas"]["glissando"][];
        };
        /**
         * @description A notehead shape. MNX has no notehead field on note, kit-note or kit-component (W3C MNX issue #249); Viritura tracks it as a vendor extension on the kit-component (per-instrument) and optionally on a pitched note (per-note override).
         * @enum {string}
         */
        "notehead-shape": "normal" | "x" | "circleX" | "diamond" | "slash" | "triangleUp" | "triangleDown";
        /** @description Viritura vendor extensions on an MNX kit-component object. */
        "kit-component-extensions": {
            /** @description Notehead shape rendered for hits on this kit component (e.g. 'x' for cymbals/hi-hat). Default: 'normal'. */
            notehead?: components["schemas"]["notehead-shape"];
            /** @description GS drum-kit program (bank 128) that this component's `sound.midiNumber` should play on, overriding the percussion part's default kit. Lets a single percussion staff borrow a sound from another kit (e.g. a Tam-tam/Big Gong from the Ethnic kit, pgm 49) that the part's main kit lacks. The audio engine routes such hits to a dedicated drum channel loaded with this program. */
            drumKit?: number;
        };
        /** @description Viritura vendor extensions on an MNX note object (the `_x.viritura` dict on a pitched note). */
        "note-extensions": {
            /** @description Notehead-shape override for this single pitched note, overriding the default notehead for the note's duration (e.g. a diamond harmonic among normal noteheads in a chord). MNX has no notehead field on note (W3C MNX issue #249); Viritura tracks it as a per-note vendor extension. Default: inherit from duration. */
            notehead?: components["schemas"]["notehead-shape"];
        };
        /** @description A 2D position on the concert-hall stage, in meters. X runs left (negative) to right (positive); Y runs from the audience (negative) toward backstage (positive). */
        "stage-position": {
            /** @description Horizontal position in meters (left negative, right positive). */
            x: number;
            /** @description Depth position in meters (audience negative, backstage positive). */
            y: number;
        };
        /** @description Viritura vendor extensions on an MNX part object (the `_x.viritura` dict on a part). Carries instrument identity so the editor and audio engine can resolve a part to a stable instrument without fuzzy name matching, plus its spatial-audio stage placement. */
        "part-extensions": {
            /** @description Stable instrument-catalog ID (e.g. 'flute', 'bflat-clarinet'). */
            instrumentId?: string;
            /** @description General-MIDI program (0..127). Used directly by the audio engine. */
            midiProgram?: number;
            /** @description Instrument family for spatial placement / catalog routing. */
            family?: string;
            /** @description Spatial-audio stage position in concert-hall meters, persisted from Play mode so a user's instrument arrangement survives reload. */
            spatial?: components["schemas"]["stage-position"];
        };
        /** @description Viritura extensions on a standard MNX system-layout object. */
        "system-layout-extensions": {
            /** @constant */
            derived?: true;
        };
        "page-turn-weights": {
            density?: number;
            turn?: number;
            sparse?: number;
            titlePage?: number;
            blankPage?: number;
            timeMarking?: number;
        };
        "page-turn-settings": {
            enabled: boolean;
            /** @enum {string} */
            preset?: "relaxed" | "professional";
            comfortableSecs?: number;
            vsSecs?: number;
            minAcceptableSecs?: number;
            targetFillFraction?: number;
            minFillFraction?: number;
            verticalJustifyThreshold?: number;
            allowPartialPages?: boolean;
            allowIntentionalBlanks?: boolean;
            /** @enum {string} */
            titlePage?: "auto" | "always" | "never";
            firstPageRecto?: boolean;
            emitVsMarks?: boolean;
            defaultBpm?: number;
            weights?: components["schemas"]["page-turn-weights"];
        };
        "page-margins": {
            top: number;
            right: number;
            bottom: number;
            left: number;
        };
        "page-setup": {
            width?: number;
            height?: number;
            /** @enum {string} */
            orientation?: "portrait" | "landscape";
            margins?: components["schemas"]["page-margins"];
            spatiumMm?: number;
            pageTurns?: components["schemas"]["page-turn-settings"];
        };
        /** @description Viritura extensions on a standard MNX score definition. */
        "score-extensions": {
            pageSetup?: components["schemas"]["page-setup"];
        };
        /**
         * @description Generic font family for a text style. Maps to a curated typeface (serif≈Times, sans-serif≈Helvetica, monospace≈Courier).
         * @enum {string}
         */
        "font-family": "serif" | "sans-serif" | "monospace";
        /**
         * @description Horizontal alignment of a text style relative to its anchor.
         * @enum {string}
         */
        "text-alignment": "left" | "center" | "right";
        /** @description A partial override of a named text style. Every field is optional: omitted fields fall back to the engine's built-in default for that role, so a document only stores what it changes. */
        "text-style": {
            /** @description Font size in staff spaces (spatium-relative). */
            size?: number;
            family?: components["schemas"]["font-family"];
            /** @description Render with a bold weight. */
            bold?: boolean;
            /** @description Render with an italic/oblique slant. */
            italic?: boolean;
            /** @description Text color as a CSS hex triplet (e.g. '#000000'). */
            color?: string;
            align?: components["schemas"]["text-alignment"];
        };
        /** @description Per-document text style overrides keyed by role. Each entry is a partial override merged over the engine's built-in stylesheet at layout time. Stored at `_x.viritura.textStyles` on the score root. */
        "text-styles": {
            title?: components["schemas"]["text-style"];
            subtitle?: components["schemas"]["text-style"];
            composer?: components["schemas"]["text-style"];
            arranger?: components["schemas"]["text-style"];
            staffLabel?: components["schemas"]["text-style"];
            pageNumber?: components["schemas"]["text-style"];
            tempo?: components["schemas"]["text-style"];
            pedalText?: components["schemas"]["text-style"];
            copyright?: components["schemas"]["text-style"];
        };
        /** @description Clearances a single dependent kind keeps as it settles into the keep-out field. All distances are in staff spaces (spatium). Each field is an optional partial override; omitted fields keep the engine default. */
        "placement-metrics": {
            /** @description Minimum clearance from the element's own anchor edge (the old `*_min_distance` / `*_above_staff` family). */
            attachGap?: number;
            /** @description CSS-like padding: the clearance the dependent keeps on each axis. A scalar sets both axes equally; an object overrides each independently. `vertical` is the gap kept above the previous dependent it stacks against (the old `*_padding` family); `horizontal` is the clearance from neighbouring ink. */
            padding?: number | {
                vertical?: number;
                horizontal?: number;
            };
            /** @description Ordering within a stacked column; lower sits closer to the staff. */
            stackRank?: number;
        };
        /** @description Per-document placement overrides keyed by dependent kind. Each entry is a partial `placement-metrics` override merged over the engine's built-in defaults at layout time. Stored at `_x.viritura.placement` on the score root. */
        placement: {
            dynamic?: components["schemas"]["placement-metrics"];
            expression?: components["schemas"]["placement-metrics"];
            fermata?: components["schemas"]["placement-metrics"];
            articulation?: components["schemas"]["placement-metrics"];
            lyric?: components["schemas"]["placement-metrics"];
            ornament?: components["schemas"]["placement-metrics"];
            trill?: components["schemas"]["placement-metrics"];
            breathMark?: components["schemas"]["placement-metrics"];
            caesura?: components["schemas"]["placement-metrics"];
            tempo?: components["schemas"]["placement-metrics"];
            rehearsalMark?: components["schemas"]["placement-metrics"];
            measureNumber?: components["schemas"]["placement-metrics"];
            chordSymbol?: components["schemas"]["placement-metrics"];
            segno?: components["schemas"]["placement-metrics"];
            coda?: components["schemas"]["placement-metrics"];
            fine?: components["schemas"]["placement-metrics"];
            jump?: components["schemas"]["placement-metrics"];
        };
        /**
         * @description Legacy combined preset accepted for backward compatibility. New documents serialize a time-signature-settings object.
         * @enum {string}
         */
        "time-signature-legacy-style": "normal" | "large" | "narrow" | "aboveStaff" | "spanning" | "singleNumber" | "noteValue";
        /**
         * @description The glyph treatment only. `outsideStaff` uses the music font's tall, tightly condensed digits designed to be enlarged outside a staff. Position, distribution, and size are configured independently.
         * @enum {string}
         */
        "time-signature-render-style": "standard" | "narrow" | "outsideStaff" | "singleNumber" | "noteValue";
        /**
         * @description Whether a meter is engraved once on every staff or once for each staff group.
         * @enum {string}
         */
        "time-signature-distribution": "perStaff" | "perGroup";
        /**
         * @description For per-group distribution, whether a brace group (grand staff) receives one shared meter (`include`) or one meter on each constituent staff (`exclude`).
         * @enum {string}
         */
        "time-signature-grand-staff": "include" | "exclude";
        /**
         * @description Vertical alignment relative to the target staff or staff group. `above` is independent of distribution.
         * @enum {string}
         */
        "time-signature-position": "center" | "top" | "bottom" | "above";
        /**
         * @description Whether MNX `display: senzaMisura` engraves the open-meter glyph or remains unprinted.
         * @enum {string}
         */
        "senza-misura-display": "open" | "hidden";
        /** @description Orthogonal time signature engraving settings. Every field is optional and omitted fields use the standard per-staff, centered, 1× defaults. */
        "time-signature-settings-object": {
            renderStyle?: components["schemas"]["time-signature-render-style"];
            distribution?: components["schemas"]["time-signature-distribution"];
            grandStaff?: components["schemas"]["time-signature-grand-staff"];
            position?: components["schemas"]["time-signature-position"];
            /** @description Scale multiplier over the selected render style's normal optical size. */
            scale?: number;
            senzaMisura?: components["schemas"]["senza-misura-display"];
        };
        /** @description Time signature engraving settings. Legacy preset strings remain readable; new documents use the object form. */
        "time-signature-settings": components["schemas"]["time-signature-settings-object"] | components["schemas"]["time-signature-legacy-style"];
        /** @description Per-document time signature engraving settings. Stored at `_x.viritura.timeSignatures` on the score root. Scores and parts are configured independently. */
        "time-signature-styles": {
            /** @description Settings used when engraving a full score. */
            score?: components["schemas"]["time-signature-settings"];
            /** @description Settings used when engraving a single-part layout. */
            parts?: components["schemas"]["time-signature-settings"];
        };
        /** @description Score-level bibliographic metadata. Stored at `_x.viritura.metadata` on the score root. The engine consumes `title`/`subtitle`/`composer`/`arranger`/`copyright`; the remaining fields are preserved verbatim from MusicXML import (`work-title`, `movement-title`, etc.) for round-tripping. */
        "score-metadata": {
            /** @description Display title (typically movement title, falling back to work title). */
            title?: string;
            /** @description Work subtitle. */
            subtitle?: string;
            /** @description Composer credit. */
            composer?: string;
            /** @description Lyricist credit. */
            lyricist?: string;
            /** @description Arranger credit. */
            arranger?: string;
            /** @description Copyright notice. */
            copyright?: string;
            /** @description MusicXML `work-title`. */
            workTitle?: string;
            /** @description MusicXML `work-number`. */
            workNumber?: string;
            /** @description MusicXML `movement-title`. */
            movementTitle?: string;
            /** @description MusicXML `movement-number`. */
            movementNumber?: string;
        };
        /** @description A profile-defined playable sound source selected for one stable MNX part ID. */
        "part-sound-override": {
            /** @description Stable source ID defined by the selected sound profile; not a MIDI program number. */
            sourceId: string;
            /** @description Profile this source belongs to, when the part targets a different profile than the assignment-level one. Absent means the assignment-level profileId applies. */
            profileId?: string;
            /** @description Version of the per-part profileId's rules. Absent means the assignment-level profileVersion applies. */
            profileVersion?: number;
        };
        /** @description Score playback assignment: one sound profile plus per-part selected source overrides keyed by stable MNX part ID. */
        "sound-profile-assignment": {
            /** @description Stable sound-profile identifier. */
            profileId: string;
            /** @description Version of the sound-profile rules used by this assignment. */
            profileVersion: number;
            /** @description Selected source overrides keyed by stable MNX part ID; array indexes are never persisted. */
            parts: {
                [key: string]: components["schemas"]["part-sound-override"];
            };
        };
        /** @description A moment in the picture that music is written against — a cut, an impact, an emotional pivot. Addressed in picture time rather than musical time because that is what it actually is: a fact about the film, fixed while the score around it changes. Solving a cue means choosing bars, meters and tempi that place a downbeat here. */
        "hit-point": {
            /** @description Stable identifier, so a hit survives edits and reordering. */
            id: string;
            /** @description Position in the picture's own timeline, in seconds from the first frame. Independent of `pictureOffsetSeconds`, so re-aligning the picture against the score does not move the hits relative to the film. */
            pictureSeconds: number;
            /** @description What happens on screen ('belly flop', 'cut to wide'). Free text from the spotting session. */
            label?: string;
            /** @description Whether the solver must land a downbeat on this hit. A locked hit constrains the spans either side of it; an unlocked one is a note-to-self that the solver may ignore. Defaults to true. */
            locked?: boolean;
        };
        /** @description Portable identity of an attached picture. Deliberately carries no filesystem path and no media bytes: a score must open on another machine (and round-trip through any MNX reader) without dragging a multi-hundred-megabyte video along, so a local file stays a device-local binding the user relinks. */
        "video-media-identity": {
            /** @description File or clip name shown in the UI. Never a path. */
            displayName: string;
            /** @description `sha256:<hex>` over sampled regions of a local file plus its byte length. Lets a relink verify the user picked the same cut rather than a revision that would silently shift every sync point. Absent for demo clips, which are identified by `demoSourceId`. */
            contentHash?: string;
            /** @description Identifier of a clip from Viritura's built-in demo catalog. Such a clip streams from a public URL, so it needs no device-local binding and can be reattached automatically on reopen. */
            demoSourceId?: string;
            /** @description Media duration in seconds, when known at attach time. */
            durationSeconds?: number;
        };
        /** @description Score-to-picture synchronization settings for film/TV scoring. Stored at `_x.viritura.videoSync` on the score root. MNX has no concept of picture, so the whole feature lives in one versioned vendor object rather than scattering unrelated extensions. */
        "video-sync": {
            /** @description Schema version of this payload. */
            version: number;
            /** @description Attached picture identity. Absent when settings exist but no media is attached. */
            media?: components["schemas"]["video-media-identity"];
            /** @description Media time (seconds) corresponding to score time zero. 120 means the score starts two minutes into the picture. Negative values place the score before the first frame. */
            pictureOffsetSeconds: number;
            /** @description Whether the picture's production audio is audible. Defaults to false so attaching a video never doubles up against score playback. */
            pictureAudioEnabled?: boolean;
            /** @description Display-only offset applied to the picture timecode readout, for deliveries that start at e.g. 01:00:00:00. Never affects the media time Viritura seeks to. */
            startTimecodeSeconds?: number;
            /**
             * @description Frame rate of the delivery, as an identifier rather than a decimal, because NTSC rates are rational (23.976 is exactly 24000/1001) and because drop-frame is a labelling convention rather than a distinct speed. Browsers expose neither the file's true rate nor its drop-frame flag, so this is declared by the user.
             * @enum {string}
             */
            frameRate?: "23.976" | "24" | "25" | "29.97" | "29.97df" | "30" | "50" | "59.94" | "59.94df" | "60";
            /** @description Spotted moments in the picture, in no guaranteed order. Kept alongside the picture identity because they describe the film rather than the score, and so must survive any amount of rewriting of the music. */
            hitPoints?: components["schemas"]["hit-point"][];
        };
        /** @description Viritura vendor extensions on the MNX document root (the `_x.viritura` dict on the top-level score object). */
        "root-extensions": {
            /** @description Score-level bibliographic metadata. */
            metadata?: components["schemas"]["score-metadata"];
            /** @description Per-document text style overrides. */
            textStyles?: components["schemas"]["text-styles"];
            /** @description Per-document placement (clearance) overrides keyed by dependent kind. */
            placement?: components["schemas"]["placement"];
            /** @description Per-document time signature engraving styles for scores and parts. */
            timeSignatures?: components["schemas"]["time-signature-styles"];
            /** @description Per-part playback sound assignments keyed by stable MNX part ID. */
            soundProfile?: components["schemas"]["sound-profile-assignment"];
            /** @description Score-to-picture synchronization settings. */
            videoSync?: components["schemas"]["video-sync"];
        };
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
// Auto-generated convenience aliases for every $def in viritura-extensions.json.
export type RhythmicPosition = components["schemas"]["rhythmic-position"];
export type MeasureRhythmicPosition = components["schemas"]["measure-rhythmic-position"];
export type RehearsalMark = components["schemas"]["rehearsal-mark"];
export type Coda = components["schemas"]["coda"];
export type Caesura = components["schemas"]["caesura"];
export type DynamicGroupExtensions = components["schemas"]["dynamic-group-extensions"];
export type TempoExtensions = components["schemas"]["tempo-extensions"];
export type KeyExtensions = components["schemas"]["key-extensions"];
export type PedalType = components["schemas"]["pedal-type"];
export type PedalLineStyle = components["schemas"]["pedal-line-style"];
export type Pedal = components["schemas"]["pedal"];
export type ChordQuality = components["schemas"]["chord-quality"];
export type ChordRoot = components["schemas"]["chord-root"];
export type ChordSymbol = components["schemas"]["chord-symbol"];
export type ExpressionPlacement = components["schemas"]["expression-placement"];
export type TextExpression = components["schemas"]["text-expression"];
export type Trill = components["schemas"]["trill"];
export type OrnamentType = components["schemas"]["ornament-type"];
export type Fingering = components["schemas"]["fingering"];
export type GlissandoStyle = components["schemas"]["glissando-style"];
export type Glissando = components["schemas"]["glissando"];
export type SpDelta = components["schemas"]["sp-delta"];
export type SlurShape = components["schemas"]["slur-shape"];
export type SlurExtensions = components["schemas"]["slur-extensions"];
export type Jump = components["schemas"]["jump"];
export type GradualTempo = components["schemas"]["gradual-tempo"];
export type MeasureGlobalExtensions = components["schemas"]["measure-global-extensions"];
export type PartMeasureExtensions = components["schemas"]["part-measure-extensions"];
export type EventMarkingsExtensions = components["schemas"]["event-markings-extensions"];
export type Arpeggio = components["schemas"]["arpeggio"];
export type EventExtensions = components["schemas"]["event-extensions"];
export type NoteheadShape = components["schemas"]["notehead-shape"];
export type KitComponentExtensions = components["schemas"]["kit-component-extensions"];
export type NoteExtensions = components["schemas"]["note-extensions"];
export type StagePosition = components["schemas"]["stage-position"];
export type PartExtensions = components["schemas"]["part-extensions"];
export type SystemLayoutExtensions = components["schemas"]["system-layout-extensions"];
export type PageTurnWeights = components["schemas"]["page-turn-weights"];
export type PageTurnSettings = components["schemas"]["page-turn-settings"];
export type PageMargins = components["schemas"]["page-margins"];
export type PageSetup = components["schemas"]["page-setup"];
export type ScoreExtensions = components["schemas"]["score-extensions"];
export type FontFamily = components["schemas"]["font-family"];
export type TextAlignment = components["schemas"]["text-alignment"];
export type TextStyle = components["schemas"]["text-style"];
export type TextStyles = components["schemas"]["text-styles"];
export type PlacementMetrics = components["schemas"]["placement-metrics"];
export type Placement = components["schemas"]["placement"];
export type TimeSignatureLegacyStyle = components["schemas"]["time-signature-legacy-style"];
export type TimeSignatureRenderStyle = components["schemas"]["time-signature-render-style"];
export type TimeSignatureDistribution = components["schemas"]["time-signature-distribution"];
export type TimeSignatureGrandStaff = components["schemas"]["time-signature-grand-staff"];
export type TimeSignaturePosition = components["schemas"]["time-signature-position"];
export type SenzaMisuraDisplay = components["schemas"]["senza-misura-display"];
export type TimeSignatureSettingsObject = components["schemas"]["time-signature-settings-object"];
export type TimeSignatureSettings = components["schemas"]["time-signature-settings"];
export type TimeSignatureStyles = components["schemas"]["time-signature-styles"];
export type ScoreMetadata = components["schemas"]["score-metadata"];
export type PartSoundOverride = components["schemas"]["part-sound-override"];
export type SoundProfileAssignment = components["schemas"]["sound-profile-assignment"];
export type HitPoint = components["schemas"]["hit-point"];
export type VideoMediaIdentity = components["schemas"]["video-media-identity"];
export type VideoSync = components["schemas"]["video-sync"];
export type RootExtensions = components["schemas"]["root-extensions"];
