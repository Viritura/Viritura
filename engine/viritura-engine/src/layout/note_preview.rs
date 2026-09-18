//! Score-independent entry previews using the ordinary and grace engravers.

use super::arena::EventArena;
use super::beams::render_rest_scaled;
use super::grace::GRACE_SCALE;
use super::render_events::{render_event, render_note_chord, NoteChordStyle};
use super::types::EventLayout;
use super::LayoutConfig;
use crate::model::{
    AccidentalDisplay, Duration, Event, KeySignature, Note, NoteValueBase, NoteheadShape,
    StemDirection,
};
use crate::render::{DisplayList, RenderCommand};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

/// An explicitly displayed preview accidental, independent of key signature.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NotePreviewAccidental {
    Sharp,
    Flat,
    Natural,
    DoubleSharp,
    DoubleFlat,
    TripleSharp,
    TripleFlat,
}

impl NotePreviewAccidental {
    fn alteration(self) -> i32 {
        match self {
            Self::Sharp => 1,
            Self::Flat => -1,
            Self::Natural => 0,
            Self::DoubleSharp => 2,
            Self::DoubleFlat => -2,
            Self::TripleSharp => 3,
            Self::TripleFlat => -3,
        }
    }
}

/// Input coordinates are pixels; `staffY` is the top of a five-line staff.
/// `x` is the rhythmic column and `y` the notehead baseline (already snapped
/// by the caller). Rests use their standard staff anchor and ignore `y`.
///
/// `duration` accepts canonical model strings only, including `breve` and
/// `duplexMaxima` (not `duplex`). Missing dots/booleans default to zero/false.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePreviewInput {
    pub x: f64,
    pub y: f64,
    pub staff_y: f64,
    pub spatium: f64,
    pub duration: NoteValueBase,
    #[serde(default)]
    pub dots: u32,
    pub accidental: Option<NotePreviewAccidental>,
    #[serde(default)]
    pub is_rest: bool,
    #[serde(default)]
    pub is_grace: bool,
    #[serde(default)]
    pub slash: bool,
    pub notehead: Option<NoteheadShape>,
    pub stem_direction: Option<StemDirection>,
}

impl NotePreviewInput {
    fn is_valid(&self) -> bool {
        [self.x, self.y, self.staff_y]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && self.spatium.is_finite()
            && (0.001..=10_000.0).contains(&self.spatium)
            && ((self.y - self.staff_y) * 2.0 / self.spatium).abs() <= 128.0
            && self.dots <= 4
    }

    fn event(&self) -> Event {
        let mut note = Note {
            notehead: self.notehead,
            ..Note::default()
        };
        note.pitch.alter = self.accidental.map(NotePreviewAccidental::alteration);
        note.accidental_display = Some(AccidentalDisplay {
            show: self.accidental.is_some(),
            force: None,
            enclosure: None,
        });
        Event {
            duration: Duration {
                base: self.duration.clone(),
                dots: Some(self.dots),
            },
            id: None,
            notes: Some(vec![note]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: self.stem_direction,
            orient: None,
        }
    }
}

/// Engrave one un-beamed note/rest without constructing or laying out a score.
///
/// Returns no commands for nonfinite geometry, coordinates beyond ±1,000,000,
/// spatium outside 0.001..=10,000, positions beyond ±128 half-spaces from the
/// staff top, or more than four dots. Longa/maxima/duplexMaxima use the engine's
/// double-whole notehead; duplexMaxima rests use its maxima rest glyph.
/// 2048th/4096th durations retain the shared engraver's notehead/stem and rest
/// fallback without adding unavailable flag glyphs.
///
/// Grace glyphs and horizontal spacing use 0.65 scale; ledger/dot Y positions
/// remain on the staff grid and line strokes retain staff weight. Slash is
/// drawn only for flagged grace notes. Rest previews ignore note-only options.
pub fn compute_note_preview(input: &NotePreviewInput) -> Vec<RenderCommand> {
    if !input.is_valid() {
        return Vec::new();
    }
    let config = LayoutConfig::default();
    let mut dl = DisplayList::new(0.0, 0.0);
    let event = input.event();
    if input.is_rest {
        let scale = if input.is_grace { GRACE_SCALE } else { 1.0 };
        render_rest_scaled(
            &mut dl,
            "note-preview",
            input.x,
            input.staff_y,
            input.spatium,
            &event.duration,
            None,
            false,
            scale,
        );
        return dl.commands;
    }
    let pos = (input.y - input.staff_y) * 2.0 / input.spatium;
    let stem_up = input
        .stem_direction
        .as_ref()
        .map_or(input.is_grace || pos > 4.0, |direction| {
            *direction == StemDirection::Up
        });
    let pitches = event.notes().iter().map(|n| n.pitch.clone()).collect();
    let events = EventArena::from_events(vec![EventLayout {
        x: input.x,
        event,
        note_positions: vec![pos],
        note_x_offsets: vec![0.0],
        shared_noteheads: vec![false],
        shared_rest: false,
        display_pitches: pitches,
        stem_up,
        id: None,
        grace_notes: Vec::new(),
        num_voices: 1,
        sequence_staff: 1,
        beat_position: 0.0,
    }]);
    if input.is_grace {
        render_note_chord(
            &mut dl,
            &events,
            0,
            input.staff_y,
            input.spatium,
            &config,
            NoteChordStyle {
                scale: GRACE_SCALE,
                slash: input.slash,
            },
            &HashSet::new(),
            &KeySignature::default(),
            &mut HashMap::new(),
            true,
            "note-preview",
            config.ledger_extension,
            config.ledger_extension,
            None,
            None,
            &[],
            &[],
        );
    } else {
        render_event(
            &mut dl,
            &events,
            0,
            input.staff_y,
            input.spatium,
            &config,
            &HashSet::new(),
            &KeySignature::default(),
            &mut HashMap::new(),
            true,
            "note-preview",
            config.ledger_extension,
            config.ledger_extension,
            None,
            None,
            None,
            0,
            &[],
            &[],
            f64::INFINITY,
        );
    }
    dl.commands
}
