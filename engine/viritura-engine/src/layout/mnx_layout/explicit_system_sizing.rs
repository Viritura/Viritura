//! Measured vertical extents shared by authored-system pagination and rendering.

use super::super::config::LayoutConfig;
use super::super::full_score::{FlatStaff, GroupRange};
use super::super::types::MeasureLayout;
use super::staff_placement::compute_staff_y_offsets_for_system;
use crate::render::{DisplayList, PageLayout};

pub(super) struct ExplicitSystemSize {
    pub(super) above: f64,
    pub(super) below: f64,
    content_gaps: Vec<f64>,
    staff_height: f64,
    default_clearance: f64,
}

impl ExplicitSystemSize {
    pub(super) fn measure(
        layouts: &[Vec<MeasureLayout>],
        staves: &[FlatStaff],
        groups: &[GroupRange],
        config: &LayoutConfig,
        use_beams: bool,
    ) -> Self {
        let sp = config.sp;
        let staff_height = 4.0 * sp;
        let default_clearance = config.default_intra_staff_clearance * sp;
        let view: Vec<Vec<&MeasureLayout>> =
            layouts.iter().map(|staff| staff.iter().collect()).collect();
        let placement = compute_staff_y_offsets_for_system(
            &view,
            staves,
            groups,
            0.0,
            0.0,
            default_clearance,
            sp,
            staff_height,
            config,
            false,
        );
        let content_gaps = placement
            .offsets
            .windows(2)
            .map(|pair| (pair[1] - pair[0] - staff_height).max(0.0))
            .collect();
        let above = layouts.first().map_or(0.0, |staff| {
            let measures: Vec<_> = staff.iter().map(|layout| &layout.resolved).collect();
            super::super::compute_above_staff_extra(
                &measures,
                Some(staff),
                sp,
                config.stem_length,
                config,
            )
            .max(Self::outer_ink_extents(staff, 0.0, &placement.offsets, config, use_beams).0)
        });
        let below = layouts.last().map_or(0.0, |staff| {
            super::super::compute_below_staff_extra_from_layouts(
                staff,
                sp,
                config.stem_length,
                config,
            )
            .max(
                Self::outer_ink_extents(
                    staff,
                    placement.offsets.last().copied().unwrap_or(0.0),
                    &placement.offsets,
                    config,
                    use_beams,
                )
                .1,
            )
        });
        Self {
            above,
            below,
            content_gaps,
            staff_height,
            default_clearance,
        }
    }

    fn outer_ink_extents(
        layouts: &[MeasureLayout],
        staff_y: f64,
        offsets: &[f64],
        config: &LayoutConfig,
        use_beams: bool,
    ) -> (f64, f64) {
        use super::super::render_annotations::{collect_articulation_boxes, render_dynamics};
        let sp = config.sp;
        let mut above = 0.0_f64;
        let mut below = 0.0_f64;
        let mut scratch = DisplayList::new(0.0, 0.0);
        let beamed_ids = super::super::beams::collect_all_beamed_event_ids(layouts, use_beams);
        let slur_map = super::super::slurs::collect_slur_participation(layouts);
        for ml in layouts {
            for element in super::super::render_geometry::compute_measure_bboxes(
                ml,
                staff_y,
                sp,
                config,
                ml.part_index,
                &beamed_ids,
                0.0,
                false,
                false,
                None,
            ) {
                above = above.max(staff_y - element.bbox.y);
                below = below.max(element.bbox.y + element.bbox.height - staff_y - 4.0 * sp);
                scratch.push_element_bbox_with_shape(element);
            }
            for (voice_index, voice) in ml.voice_layouts.iter().enumerate() {
                for index in 0..voice.events.len() {
                    super::super::render_articulations::render_articulations(
                        &mut scratch,
                        &voice.events,
                        index,
                        staff_y,
                        sp,
                        config,
                        "",
                        Some(&slur_map),
                        voice_index,
                    );
                }
            }
            let mut articulations = collect_articulation_boxes(&scratch.commands);
            let tuplets = super::super::tuplets::render_tuplet_brackets(
                &mut scratch,
                ml,
                staff_y,
                sp,
                config,
                &articulations,
                Some(offsets),
            );
            articulations.extend(tuplets);
            for dynamic in render_dynamics(
                &mut scratch,
                ml,
                staff_y,
                sp,
                config,
                &articulations,
                Some(offsets),
            ) {
                above = above.max(staff_y - dynamic.y_top);
                below = below.max(dynamic.y_bottom - staff_y - 4.0 * sp);
            }
        }
        if let Some(first) = layouts.first() {
            super::super::hairpins::render_hairpins(
                &mut scratch,
                layouts,
                staff_y,
                sp,
                config,
                first.part_index,
                0,
                0,
                Some(offsets),
            );
        }
        for element in &scratch.element_bboxes {
            above = above.max(staff_y - element.bbox.y);
            below = below.max(element.bbox.y + element.bbox.height - staff_y - 4.0 * sp);
        }
        (above, below)
    }

    pub(super) fn height(&self, gap: f64, clearance: f64) -> f64 {
        self.above
            + self.below
            + (self.content_gaps.len() + 1) as f64 * self.staff_height
            + self
                .content_gaps
                .iter()
                .map(|&content| gap.max(content - self.default_clearance + clearance))
                .sum::<f64>()
    }
}

/// Preserve the page planner's inter-system allocation, but solve intra-staff
/// spacing against the same content floors used by the renderer.
pub(super) fn fit_explicit_staff_spacing(
    sizes: &[ExplicitSystemSize],
    pages: &[PageLayout],
    config: &LayoutConfig,
    positions: &mut [f64],
    gaps: &mut [f64],
    clearances: &mut [f64],
) {
    let preferred = 7.0 * config.sp;
    let default_clearance = config.default_intra_staff_clearance * config.sp;
    let clearance_for = |gap: f64| {
        if gap < preferred {
            (default_clearance * gap / preferred).max(config.min_intra_staff_clearance * config.sp)
        } else {
            default_clearance
        }
    };
    for page in pages {
        let Some(&first) = page.system_indices.first() else {
            continue;
        };
        let Some(&last) = page.system_indices.last() else {
            continue;
        };
        let estimated_height = |index: usize| {
            sizes[index].height(preferred, default_clearance)
                + sizes[index].content_gaps.len() as f64 * (gaps[index] - preferred)
        };
        let skyline_gaps: Vec<_> = page
            .system_indices
            .windows(2)
            .map(|pair| positions[pair[1]] - positions[pair[0]] - estimated_height(pair[0]))
            .collect();
        let target_bottom = positions[last] + estimated_height(last);
        let available = target_bottom - positions[first] - skyline_gaps.iter().sum::<f64>();
        let gap_count: usize = page
            .system_indices
            .iter()
            .map(|&index| sizes[index].content_gaps.len())
            .sum();
        let total_height = |gap: f64| {
            page.system_indices
                .iter()
                .map(|&index| sizes[index].height(gap, clearance_for(gap)))
                .sum::<f64>()
        };
        let mut gap = gaps[first];
        if gap_count > 0 && (gap - preferred).abs() > 1e-6 {
            let mut low = config.min_intra_staff_squish.min(7.0) * config.sp;
            let mut high = preferred.max(gap) + available.max(0.0) / gap_count as f64;
            if total_height(low) > available {
                // If notation cannot fit even at the legibility floor, retain
                // clearance and report overflow rather than overlapping music.
                gap = low;
            } else {
                for _ in 0..40 {
                    let mid = (low + high) * 0.5;
                    if total_height(mid) > available {
                        high = mid;
                    } else {
                        low = mid;
                    }
                }
                gap = low;
            }
        }
        let clearance = clearance_for(gap);
        let mut y = positions[first];
        for (local, &index) in page.system_indices.iter().enumerate() {
            positions[index] = y + sizes[index].above;
            gaps[index] = gap;
            clearances[index] = clearance;
            y += sizes[index].height(gap, clearance);
            if let Some(&skyline_gap) = skyline_gaps.get(local) {
                y += skyline_gap;
            }
        }
    }
}
