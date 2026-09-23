use super::GRACE_SCALE;
use crate::layout::config::LayoutConfig;
use crate::layout::render_events::notehead_for_note;
use crate::layout::resolve::active_clef_at_beat;
use crate::layout::spacing::{event_accidental_extent_sp_transposed, spacing_display_pitch};
use crate::layout::types::{EventLayout, GraceNoteLayout};
use crate::model::*;
use crate::render::smufl::smufl;
use std::collections::{HashMap, HashSet};

const GRACE_GAP_SP: f64 = 0.3;
const GRACE_MIN_ADVANCE_SP: f64 = 1.6;
const FLAG_GAP_SP: f64 = 0.1;
const PRINCIPAL_GAP_SP: f64 = 1.2;

pub(crate) struct GraceSpacingContext<'a> {
    pub key: &'a KeySignature,
    pub transposition: Option<(i32, i32)>,
    pub clef: Option<&'a Clef>,
    pub kit: Option<&'a HashMap<String, KitComponent>>,
    pub suppressed_note_ids: Option<&'a HashSet<String>>,
    pub config: &'a LayoutConfig,
}

pub(crate) struct GraceEventExtent {
    pub left: f64,
    pub right: f64,
    pub accidental: f64,
}

#[derive(Default)]
pub(crate) struct GraceRunSpacing {
    pub offsets: Vec<f64>,
    pub width: f64,
}

impl GraceRunSpacing {
    pub fn before_padding(&self, principal: &GraceEventExtent) -> f64 {
        if self.offsets.is_empty() {
            0.0
        } else {
            self.width + PRINCIPAL_GAP_SP + principal.left
        }
    }

    pub fn after_start(&self, principal: &GraceEventExtent) -> f64 {
        principal.right + PRINCIPAL_GAP_SP
    }

    pub fn after_extent(&self, principal: &GraceEventExtent) -> f64 {
        self.after_start(principal) + self.width
    }
}

impl GraceSpacingContext<'_> {
    pub fn accidental_extent(
        &self,
        event: &Event,
        measure_acc: &mut HashMap<(String, i32), i32>,
    ) -> f64 {
        event_accidental_extent_sp_transposed(
            event.notes(),
            self.key,
            self.transposition,
            measure_acc,
            self.clef,
            self.config.ledger_extension,
            self.suppressed_note_ids,
        )
    }

    pub fn event_extent(
        &self,
        event: &Event,
        scale: f64,
        measure_acc: &mut HashMap<(String, i32), i32>,
    ) -> GraceEventExtent {
        let accidental = self.accidental_extent(event, measure_acc);
        let (mut left, right) = self.event_ink_extent(event);
        if accidental > 0.0 {
            left = left.max(accidental + 0.20);
        }
        GraceEventExtent {
            left: left * scale,
            right: right * scale,
            accidental: accidental * scale,
        }
    }

    pub fn after_right_edge(&self, graces: &[GraceNoteLayout], sp: f64) -> Option<f64> {
        graces
            .iter()
            .filter(|grace| grace.after_main)
            .map(|grace| {
                let right = (self.event_ink_extent(&grace.event).1 * GRACE_SCALE)
                    .max(self.grace_flag_extent(&grace.event).1);
                grace.x + right * sp
            })
            .max_by(f64::total_cmp)
    }

    fn grace_flag_extent(&self, event: &Event) -> (f64, f64) {
        let stem_up = event
            .stem_direction
            .as_ref()
            .is_none_or(|direction| matches!(direction, StemDirection::Up));
        let Some(flag) = smufl::flag_glyph(event.duration.base.flag_count(), stem_up) else {
            return (0.0, 0.0);
        };
        let (flag_x, _, flag_width, _) = smufl::glyph_bbox(flag);
        // Beam membership is not yet resolved here. Keep a conservative flag
        // envelope even for potentially beamed graces rather than assuming that
        // every short grace belongs to an explicit or automatic beam group.
        event
            .notes()
            .iter()
            .fold((0.0_f64, 0.0_f64), |(left, right), note| {
                let anchors = smufl::stem_anchors(notehead_for_note(
                    Some(note),
                    &event.duration.base,
                    self.kit,
                ));
                // Grace glyphs scale, but their stem stroke retains staff weight.
                let stem_x = if stem_up {
                    anchors.up_se.0 * GRACE_SCALE - self.config.stem_width * 0.5
                } else {
                    anchors.down_nw.0 * GRACE_SCALE + self.config.stem_width * 0.5
                };
                (
                    left.max(-stem_x - flag_x * GRACE_SCALE),
                    right.max(stem_x + (flag_x + flag_width) * GRACE_SCALE),
                )
            })
    }

    fn event_ink_extent(&self, event: &Event) -> (f64, f64) {
        let default_head = smufl::notehead_glyph(&event.duration.base);
        let mut left = 0.0_f64;
        let mut right = smufl::notehead_right_extent(default_head);
        for note in event.notes() {
            let cp = notehead_for_note(Some(note), &event.duration.base, self.kit);
            let (bbox_x, _, _, _) = smufl::glyph_bbox(cp);
            let origin = if cp == smufl::NOTEHEAD_DOUBLE_WHOLE {
                smufl::NOTEHEAD_DOUBLE_WHOLE_ORIGIN.0
            } else {
                0.0
            };
            left = left.max(origin - bbox_x);
            right = right.max(smufl::notehead_right_extent(cp));
            if self.clef.is_some_and(|clef| {
                let pitch = spacing_display_pitch(note, self.transposition);
                let position = (4 - clef.line_from_bottom()) * 2
                    - (pitch.diatonic_position() - clef.reference_diatonic());
                note.kit_component.is_none() && !(-1..=9).contains(&position)
            }) {
                left = left.max(self.config.ledger_extension);
                right = right.max(smufl::notehead_width(cp) + self.config.ledger_extension);
            }
        }
        // Dot columns align to the rightmost head, not the ledger-line end.
        if let Some(dots) = event.duration.dots.filter(|dots| *dots > 0) {
            let head_right = event.notes().iter().fold(
                smufl::notehead_right_extent(default_head),
                |right, note| {
                    right.max(smufl::notehead_right_extent(notehead_for_note(
                        Some(note),
                        &event.duration.base,
                        self.kit,
                    )))
                },
            );
            let (dot_x, _, dot_width, _) = smufl::glyph_bbox(smufl::AUGMENTATION_DOT);
            right = right.max(head_right + 0.4 + f64::from(dots - 1) * 0.5 + dot_x + dot_width);
        }
        (left, right)
    }

    pub fn run<'a>(
        &self,
        events: impl Iterator<Item = &'a Event>,
        measure_acc: &mut HashMap<(String, i32), i32>,
    ) -> GraceRunSpacing {
        let mut run = GraceRunSpacing::default();
        let mut previous_ink_right = 0.0;
        for event in events {
            let extent = self.event_extent(event, GRACE_SCALE, measure_acc);
            let (flag_left, flag_right) = self.grace_flag_extent(event);
            let left = extent.left.max(flag_left);
            // Preserve the legacy origin floor while retaining wider accidental
            // and dot spacing. Flags need visible clearance too, including when
            // opposite stem directions put both flags in the same gap.
            let offset = run.offsets.last().map_or(left, |previous| {
                (previous + GRACE_MIN_ADVANCE_SP)
                    .max(previous_ink_right + extent.left + GRACE_GAP_SP)
                    .max(run.width + left + FLAG_GAP_SP)
            });
            run.offsets.push(offset);
            previous_ink_right = offset + extent.right;
            run.width = offset + extent.right.max(flag_right);
        }
        run
    }
}

pub(crate) fn position_grace_notes(
    events: &mut [EventLayout],
    context: &GraceSpacingContext<'_>,
    clef_changes: &[(f64, Clef)],
    measure_acc: &mut HashMap<(String, i32), i32>,
    sp: f64,
) {
    for event in events {
        let context = GraceSpacingContext {
            clef: Some(active_clef_at_beat(clef_changes, event.beat_position)),
            ..*context
        };
        if event.grace_notes.is_empty() {
            context.accidental_extent(&event.event, measure_acc);
            continue;
        }
        let before = context.run(
            event
                .grace_notes
                .iter()
                .filter(|grace| !grace.after_main)
                .map(|grace| &grace.event),
            measure_acc,
        );
        let mut principal = context.event_extent(&event.event, 1.0, measure_acc);
        let head_width = context.config.notehead_rx * 2.0;
        principal.left +=
            -event.note_x_offsets.iter().copied().fold(0.0_f64, f64::min) * head_width;
        principal.right +=
            event.note_x_offsets.iter().copied().fold(0.0_f64, f64::max) * head_width;
        let after = context.run(
            event
                .grace_notes
                .iter()
                .filter(|grace| grace.after_main)
                .map(|grace| &grace.event),
            measure_acc,
        );
        for (grace, offset) in event
            .grace_notes
            .iter_mut()
            .filter(|grace| !grace.after_main)
            .zip(&before.offsets)
        {
            grace.x = event.x + (offset - before.before_padding(&principal)) * sp;
        }
        for (grace, offset) in event
            .grace_notes
            .iter_mut()
            .filter(|grace| grace.after_main)
            .zip(&after.offsets)
        {
            grace.x = event.x + (after.after_start(&principal) + offset) * sp;
        }
    }
}
