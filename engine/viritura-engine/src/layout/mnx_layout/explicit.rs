// File-private to the `mnx_layout` folder module.
// Imports mirror the original `mnx_layout.rs` top block, adjusted for the
// extra folder hop (super::super::… to reach the `layout` module).

#![allow(unused_imports)]

use super::super::cache::{self, measure_content_hash};
use super::super::condensing::{
    analyze_merge_mode, find_partial_unison_onset_beat, find_unison_onset_beat,
    label_for_mode_styled, LabelStyle, MergeMode,
};
use super::super::config::LayoutConfig;
use super::super::full_score::{
    compute_system_object_staves, layout_full_score, FlatSource, FlatStaff, GroupRange,
};
use super::super::measure::*;
use super::super::page::*;
use super::super::page::{render_page_numbers, render_title_block, title_block_height};
use super::super::render_barlines::render_barline_connector;
use super::super::resolve::*;
use super::super::spacing::LogSpacing;
use super::super::spacing::*;
use super::super::system::*;
use super::super::types::*;
use super::super::{
    compute_above_staff_extra, compute_below_staff_extra_from_layouts, render_system_contents,
};
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use super::auto_flow::layout_auto_flow_mnx_score;
use super::explicit_pagination::{paginate_explicit_pages, ExplicitPagination};
use super::explicit_system_breaks::{expand_oversized_systems_explicit, SystemLayoutChanges};
use super::explicit_system_layouts::{build_explicit_system_layouts, PersistentStaffState};
use super::explicit_widths::compute_explicit_max_widths;
use super::page_turn_planning::single_source_part_index;
use super::shared::*;
use super::system_connectors::{
    render_system_connectors, render_system_start_barline, SystemConnectorPlacement,
};

/// Flat staves plus their group ranges for a single system.
type StaffGroupLayout = (Vec<FlatStaff>, Vec<GroupRange>);
/// Layout a score using MNX layout definitions and score definitions.
///
/// Uses the first score definition (or falls back to `layout_full_score`
/// if no scores/layouts are defined).
pub fn layout_with_mnx_scores(
    score: &Score,
    config: &LayoutConfig,
    score_index: usize,
) -> DisplayList {
    layout_with_mnx_scores_cached(score, config, score_index, None)
}

/// Resolve per-system measure ranges + flattened staff layouts + per-system
/// layout-change maps for the explicit-pages path.
///
/// MNX semantics: `system.layout` overrides apply from that system onward
/// until the next system that sets its own `layout`. The inherited override
/// is carried forward; without this, every system after the first would
/// silently fall back to the score-level base layout.
#[allow(clippy::too_many_arguments)] // pipeline boundary ΓÇö all inputs are required
fn resolve_explicit_systems_and_layouts(
    score: &Score,
    score_def: &ScoreDefinition,
    all_systems: &[&SystemDefinition],
    measure_id_map: &HashMap<String, usize>,
    part_id_map: &HashMap<String, usize>,
    layout_map: &HashMap<String, &LayoutDefinition>,
    measure_count: usize,
) -> (
    Vec<(usize, usize)>,
    Vec<StaffGroupLayout>,
    SystemLayoutChanges,
) {
    let mut system_measure_ranges: Vec<(usize, usize)> = Vec::new();
    for (i, sys) in all_systems.iter().enumerate() {
        let start = measure_id_map.get(&sys.measure).copied().unwrap_or(0);
        let end = if i + 1 < all_systems.len() {
            measure_id_map
                .get(&all_systems[i + 1].measure)
                .copied()
                .unwrap_or(measure_count)
        } else {
            measure_count
        };
        system_measure_ranges.push((start, end.max(start)));
    }

    let mut system_flat_staves: Vec<(Vec<FlatStaff>, Vec<GroupRange>)> = Vec::new();
    let mut system_layout_changes: SystemLayoutChanges = Vec::new();
    let mut inherited_layout_id: Option<&str> = None;
    for sys in all_systems {
        let explicit = sys.layout.as_deref();
        if let Some(id) = explicit {
            inherited_layout_id = Some(id);
        }
        let layout_id = explicit
            .or(inherited_layout_id)
            .or(score_def.layout.as_deref())
            .unwrap_or("");
        if let Some(layout_def) = layout_map.get(layout_id) {
            system_flat_staves.push(flatten_layout(&layout_def.content, part_id_map, score));
        } else {
            // No layout found ΓÇö create one staff per part
            let display_names = resolve_part_display_names(&score.parts);
            let mut staves = Vec::new();
            for (i, _part) in score.parts.iter().enumerate() {
                let full = display_names[i].display_name.clone();
                let short = display_names[i].display_short_name.clone();
                staves.push(FlatStaff {
                    sources: vec![FlatSource {
                        part_index: i,
                        staff_number: None,
                        voice_filter: None,
                        stem_direction: None,
                    }],
                    label: Some(full),
                    short_label: Some(short),
                    expansion: false,
                    condensed_numbers: Vec::new(),
                });
            }
            system_flat_staves.push((staves, Vec::new()));
        }

        let mut changes_map = HashMap::new();
        for lc in &sys.layout_changes {
            if let Some(&mi) = measure_id_map.get(&lc.location.measure) {
                if let Some(lc_layout) = layout_map.get(&lc.layout) {
                    changes_map.insert(mi, flatten_layout(&lc_layout.content, part_id_map, score));
                }
            }
        }
        system_layout_changes.push(changes_map);
    }

    (
        system_measure_ranges,
        system_flat_staves,
        system_layout_changes,
    )
}

/// Width of the left label gutter for the explicit-pages path: sized to the
/// widest actual label across all systems so long instrument names like
/// "Bass Clarinet in BΓÖ¡" hug the left margin without wasted space, and short
/// names don't leave a large empty gutter. Measured with accurate text metrics
/// (see `label_gutter_extent`).
fn compute_explicit_label_margin(
    system_flat_staves: &[(Vec<FlatStaff>, Vec<GroupRange>)],
    sp: f64,
    label_style: &crate::layout::text_styles::TextStyle,
) -> f64 {
    // Only multi-staff systems carry instrument labels (matches the auto-flow
    // path and `render_explicit_system`, which both gate label rendering on
    // `flat_staves.len() > 1`). A single-staff part repeats no instrument name,
    // so it reserves NO left gutter — otherwise the part would be pushed right
    // and rendered like a full score. Single-staff systems are skipped here.
    let labelled = |staves: &[FlatStaff], groups: &[GroupRange]| {
        staves.len() > 1
            && (staves.iter().any(|s| s.label.is_some())
                || groups.iter().any(|g| g.label.is_some()))
    };
    let has_labels = system_flat_staves
        .iter()
        .any(|(staves, groups)| labelled(staves, groups));
    if !has_labels {
        return 0.0;
    }
    // Gap between the label's right edge and the system margin; matches the
    // `render_staff_labels` anchor of `margin_left - 2.0 sp` on this path.
    let label_gap = 2.0 * sp;
    let widest: f64 = system_flat_staves
        .iter()
        .filter(|(staves, groups)| labelled(staves, groups))
        .flat_map(|(staves, groups)| {
            staves
                .iter()
                .filter_map(|s| s.label.as_ref().map(|l| (l, &s.condensed_numbers)))
                .map(|(l, cn)| label_gutter_extent(l, cn, sp, label_style))
                .chain(
                    groups
                        .iter()
                        .filter_map(|g| g.label.as_ref().map(|l| (l, Vec::<u32>::new())))
                        .map(|(l, cn)| label_gutter_extent(l, &cn, sp, label_style)),
                )
                .collect::<Vec<_>>()
        })
        .fold(0.0_f64, f64::max);
    widest + label_gap
}

/// Render the page-1 title block, the part-score instrument name (when only
/// a subset of parts is shown), and page numbers on pages 2+. No-op when
/// `config.page_width` is `None` (galley mode).
fn render_explicit_chrome(
    dl: &mut DisplayList,
    score: &Score,
    score_def: &ScoreDefinition,
    config: &LayoutConfig,
    sp: f64,
    page_w: f64,
    system_flat_staves: &[(Vec<FlatStaff>, Vec<GroupRange>)],
    pages: &[PageLayout],
) {
    if config.page_width.is_none() {
        return;
    }
    let title_y = config.page_margin_top * sp;
    let title_cmds = render_title_block(score.metadata(), config, title_y, page_w);
    for cmd in title_cmds {
        dl.commands.push(cmd);
    }

    let unique_parts: HashSet<usize> = system_flat_staves
        .iter()
        .flat_map(|(staves, _)| {
            staves
                .iter()
                .flat_map(|s| s.sources.iter().map(|src| src.part_index))
        })
        .collect();
    if unique_parts.len() < score.parts.len() {
        if let Some(name) = score_def.name.as_deref() {
            let shown: Vec<usize> = unique_parts.iter().copied().collect();
            let label = augment_part_score_name(name, &score.parts, &shown);
            render_part_score_name(dl, &label, config, page_w);
        }
    }

    render_page_numbers(dl, pages, config, page_w);
}

/// Capture one system's layout-debug snapshot for the explicit-pages path.
/// Mirrors the auto-flow debug capture in `compute_system_extras`; kept as a
/// separate helper because the explicit path has per-system access to
/// `all_staff_layouts` only inside the main loop.
#[allow(clippy::too_many_arguments)] // pipeline boundary ΓÇö all inputs are required
fn build_explicit_system_debug(
    sys_idx: usize,
    all_staff_layouts: &[Vec<MeasureLayout>],
    staff_y_offsets: &[f64],
    sys_pair_dbg: Vec<crate::render::StaffPairDebug>,
    pages: &[PageLayout],
    max_widths: &[f64],
    margin_left: f64,
    staff_height: f64,
    sp: f64,
    config: &LayoutConfig,
) -> crate::render::SystemDebug {
    use super::super::debug;
    let top_staff = all_staff_layouts
        .first()
        .map(|s| s.as_slice())
        .unwrap_or(&[]);
    let bottom_staff = all_staff_layouts
        .last()
        .map(|s| s.as_slice())
        .unwrap_or(&[]);
    let above_b = debug::above_breakdown(top_staff, sp, config.stem_length);
    let below_b = debug::below_breakdown(bottom_staff, sp, config.stem_length);
    let above_extra = above_b.stem_extra + above_b.annotation_extra;
    let below_extra = below_b
        .protrusion
        .max(below_b.dynamics)
        .max(below_b.lyrics)
        .max(below_b.pedals);
    let staff_top_y = staff_y_offsets[0];
    let bottom_staff_y = *staff_y_offsets.last().unwrap_or(&staff_top_y);
    let staff_bottom_y = bottom_staff_y + staff_height;
    let x_start = top_staff.first().map_or(margin_left, |ml| ml.x);
    let x_end = top_staff.last().map_or(x_start, |ml| ml.x + ml.width);
    crate::render::SystemDebug {
        index: sys_idx,
        page_index: debug::page_for_system(pages, sys_idx),
        bbox_top_y: staff_top_y - above_extra,
        staff_top_y,
        staff_bottom_y,
        bbox_bottom_y: staff_bottom_y + below_extra,
        x_start,
        x_end,
        above_extra,
        above_breakdown: above_b,
        below_extra,
        below_breakdown: below_b,
        measure_extremes: debug::measure_extremes(top_staff, sp, config.stem_length),
        staff_pairs: sys_pair_dbg,
        measure_spacings: debug::measure_spacings(top_staff, |idx| max_widths.get(idx).copied()),
        inter_system_gap_to_next: None,
    }
}

/// Bundled inputs that don't change across systems for the explicit-pages
/// per-system render. Carved off the giant call to keep the argument list
/// merely large rather than absurd.
struct ExplicitSystemCtx<'a> {
    score: &'a Score,
    score_def: &'a ScoreDefinition,
    config: &'a LayoutConfig,
    sp: f64,
    staff_height: f64,
    barline_w: f64,
    base_margin_l: f64,
    label_margin: f64,
    margin_left: f64,
    /// First-system indent (px) applied to `sys_idx == 0` only, for single-part
    /// layouts — signals the start of the music exactly like the auto-flow path.
    /// `0.0` for full scores (their instrument-name gutter is the start cue).
    first_system_indent: f64,
    system_count: usize,
    content_width: Option<f64>,
    common_shortest_beats: f64,
    lyric_line_order: Option<&'a [String]>,
    all_resolved: &'a [Vec<ResolvedMeasure>],
    max_widths: &'a [f64],
    mmr_start_map: &'a HashMap<usize, u32>,
    mmr_skip_measures: &'a HashSet<usize>,
    mmr_label_map: &'a HashMap<usize, String>,
    pages: &'a [PageLayout],
}

/// Render one system for the explicit-pages path: empty-system fallback,
/// Phase 1 measure layout build, Phase 2 content-aware staff Y placement,
/// debug capture, Phase 3 staff lines + contents + slur capture, inter-staff
/// barlines, system-start barline, group brackets/braces, staff labels.
#[allow(clippy::too_many_arguments)] // pipeline boundary ΓÇö all inputs are required
fn render_explicit_system(
    dl: &mut DisplayList,
    ctx: &ExplicitSystemCtx<'_>,
    sys_idx: usize,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    m_start: usize,
    m_end: usize,
    system_y_base: f64,
    j_gap: f64,
    min_clearance: f64,
    lc_map: &HashMap<usize, (Vec<FlatStaff>, Vec<GroupRange>)>,
    persistent_state: &mut PersistentStaffState,
    dbg_systems: &mut Vec<crate::render::SystemDebug>,
    slur_bounds: &mut HashMap<(usize, usize, usize), super::super::slurs::SystemSlurBounds>,
    global_slur_events: &mut Vec<super::super::slurs::GlobalSlurEvent>,
    global_tie_notes: &mut Vec<super::super::ties::GlobalTieNote>,
) {
    let sp = ctx.sp;
    let staff_height = ctx.staff_height;
    // First-system indent for single-part layouts: shift system 0 right by
    // `first_system_indent` and shrink its justification width to match, so the
    // music starts with the standard part indent instead of hugging the margin
    // like a full score. Subsequent systems and full scores get no indent.
    let indent = if sys_idx == 0 {
        ctx.first_system_indent
    } else {
        0.0
    };
    let margin_left = ctx.margin_left + indent;
    let content_width = ctx.content_width.map(|w| (w - indent).max(0.0));
    let system_count = ctx.system_count;

    // Initial naive staff Y offsets (overwritten by Phase 2 in the non-empty
    // branch; needed up-front so brackets/labels in this scope see the same
    // positions the staff lines actually render at).
    let mut staff_y_offsets = Vec::new();
    let mut y = system_y_base;
    for (i, _staff) in flat_staves.iter().enumerate() {
        if i > 0 {
            y += j_gap;
        }
        staff_y_offsets.push(y);
        y += staff_height;
    }

    let sys_measure_indices: Vec<usize> = (m_start..m_end)
        .filter(|mi| !ctx.mmr_skip_measures.contains(mi))
        .collect();

    if sys_measure_indices.is_empty() {
        // No measures ΓÇö draw empty staff lines with default width
        let default_width = content_width.unwrap_or(30.0 * sp);
        let sys_x_end = margin_left + default_width;
        for (staff_idx, _) in flat_staves.iter().enumerate() {
            let staff_y = staff_y_offsets[staff_idx];
            let is_expansion = flat_staves.get(staff_idx).is_some_and(|fs| fs.expansion);
            let recolor_start = dl.commands.len();
            for line in 0..5 {
                let ly = staff_y + line as f64 * sp;
                dl.staff_line(margin_left, sys_x_end, ly, ctx.config.staff_line_width * sp);
            }
            if is_expansion {
                dl.recolor_range(recolor_start, EXPANSION_COLOR);
            }
        }
    } else {
        // Compute justified widths
        let natural_total: f64 = sys_measure_indices
            .iter()
            .map(|&mi| ctx.max_widths.get(mi).copied().unwrap_or(0.0))
            .sum();
        let avail_w = content_width.unwrap_or(natural_total);
        let scale = if natural_total > 0.0 && ctx.config.page_width.is_some() && avail_w > 0.0 {
            let is_last = sys_idx == system_count - 1;
            if should_preserve_natural_final_width(natural_total, avail_w, is_last) {
                1.0
            } else {
                avail_w / natural_total
            }
        } else {
            1.0
        };

        // ΓöÇΓöÇ Phase 1: Build measure layouts for all staves ΓöÇΓöÇ
        let all_staff_layouts = build_explicit_system_layouts(
            ctx.score,
            ctx.score_def,
            ctx.config,
            sp,
            flat_staves,
            group_ranges,
            &sys_measure_indices,
            m_start,
            lc_map,
            ctx.all_resolved,
            ctx.max_widths,
            scale,
            margin_left,
            ctx.common_shortest_beats,
            ctx.mmr_start_map,
            ctx.mmr_label_map,
            persistent_state,
        );

        // Clef-change set scoped to the staves shown in THIS system (not the
        // whole score), so an individual-part layout never reserves a leading-
        // clef gap for another part's clef change. Used for both the per-staff
        // contents and the inter-staff connectors below.
        let clef_change_measures =
            super::super::render_measure::clef_change_measure_set_from_layouts(&all_staff_layouts);

        // ΓöÇΓöÇ Phase 2: Compute dynamic staff Y offsets based on content ΓöÇΓöÇ
        // Re-assigns the staff_y_offsets so brackets/labels (which run in
        // the outer scope) match the actual staff-line positions.
        //
        // SQUISH regime (`j_gap < 7sp`): the page cannot fit the system at
        // default spacing, so we honour the squished j_gap as a HARD CEILING
        // and accept note-protrusion collisions in exchange for legible page
        // boundaries ΓÇö matching standard practice on overfull systems.
        let squish_active = j_gap < 7.0 * sp - 1e-6;
        let staff_layout_view: Vec<Vec<&MeasureLayout>> = all_staff_layouts
            .iter()
            .map(|measures| measures.iter().collect())
            .collect();
        let StaffYPlacement {
            offsets: new_offsets,
            pair_debug: sys_pair_dbg,
        } = compute_staff_y_offsets_for_system(
            &staff_layout_view,
            flat_staves,
            group_ranges,
            system_y_base,
            j_gap,
            min_clearance,
            sp,
            staff_height,
            ctx.config,
            squish_active,
        );
        staff_y_offsets = new_offsets;

        if ctx.config.emit_layout_debug {
            dbg_systems.push(build_explicit_system_debug(
                sys_idx,
                &all_staff_layouts,
                &staff_y_offsets,
                sys_pair_dbg,
                ctx.pages,
                ctx.max_widths,
                margin_left,
                staff_height,
                sp,
                ctx.config,
            ));
        }

        // ΓöÇΓöÇ Phase 3: render staff lines + per-staff contents + slur capture ΓöÇΓöÇ
        // Next-system courtesy clef per staff. In this layout path the next
        // system starts at measure index `m_end`, so look there directly.
        let next_sys_clef_per_staff: Vec<Option<&Clef>> = if m_end < ctx.score.global.measures.len()
        {
            flat_staves
                .iter()
                .map(|fs| {
                    fs.sources
                        .first()
                        .and_then(|src| ctx.score.parts.get(src.part_index))
                        .and_then(|part| part.measures.get(m_end))
                        .and_then(|pm| pm.clefs.as_ref())
                        .and_then(|clefs| clefs.iter().find(|c| c.position.is_none()))
                        .map(|pc| &pc.clef)
                })
                .collect()
        } else {
            vec![None; flat_staves.len()]
        };
        render_system_staves_and_contents(
            dl,
            &all_staff_layouts,
            flat_staves,
            &staff_y_offsets,
            &next_sys_clef_per_staff,
            ctx.score,
            ctx.lyric_line_order,
            margin_left,
            sp,
            ctx.config,
            sys_idx,
            system_count,
            false,
            sys_idx,
            slur_bounds,
            global_slur_events,
            global_tie_notes,
            &clef_change_measures,
            None,
        );

        render_system_connectors(
            dl,
            ctx.config,
            &all_staff_layouts,
            group_ranges,
            &staff_y_offsets,
            &clef_change_measures,
            SystemConnectorPlacement {
                sys_idx,
                system_count,
                staff_height,
                sp,
            },
        );
    }

    // System start barline connecting all staves (even for empty systems)
    render_system_start_barline(
        dl,
        &staff_y_offsets,
        staff_height,
        margin_left,
        ctx.barline_w,
    );

    // Group brackets and braces. Explicit-pages renders brace labels only on
    // the first system (standard engraving practice for orchestral parts).
    render_group_brackets_and_braces(
        dl,
        group_ranges,
        &staff_y_offsets,
        margin_left,
        staff_height,
        sp,
        ctx.config,
        sys_idx == 0,
    );

    // Individual staff labels (long on first system, short on rest; staves
    // inside a labelled brace group are skipped ΓÇö group label covers them).
    // Single-staff layouts (a part / solo score) carry no instrument label
    // gutter, so skip the name there to match the auto-flow path and avoid
    // restating "D. B." on every system like a full score.
    if flat_staves.len() > 1 {
        render_staff_labels(
            dl,
            flat_staves,
            group_ranges,
            &staff_y_offsets,
            ctx.base_margin_l + ctx.label_margin - 2.0 * sp,
            staff_height,
            sp,
            sys_idx,
            ctx.config
                .text_styles
                .resolve(crate::layout::text_styles::TextRole::StaffLabel),
        );
    }
}

#[allow(clippy::too_many_lines)] // top-level cached layout entry; cohesive pipeline stage
pub fn layout_with_mnx_scores_cached(
    score: &Score,
    config: &LayoutConfig,
    score_index: usize,
    mut cache: Option<&mut cache::LayoutCache>,
) -> DisplayList {
    // P1: consume the patch-side dirty range up-front so the cache invariant
    // "after any cached layout pass `pending_dirty_range` is `None`" holds
    // regardless of which sub-path runs (auto-flow, explicit pages, fallback).
    // The value is then threaded into `layout_auto_flow_mnx_score` below — the
    // explicit-pages branch ignores it (Phase A/B do not scope explicit pages).
    let dirty_region = cache
        .as_deref_mut()
        .and_then(|c| c.take_pending_dirty_region());

    // Apply the document's `_x.viritura` overrides (text styles, placement,
    // time signature style) over the engine defaults. `layout_score_cached`
    // does this for the single-part path; this is the equivalent chokepoint
    // for the MNX multi-part path, and it must happen before the fallbacks
    // below so a score without explicit layouts still picks the overrides up.
    let context = crate::layout::orchestration::mnx_layout_context(score, score_index);
    let merged_config =
        crate::layout::orchestration::config_with_document_overrides(score, config, context);
    let config = merged_config.as_ref().unwrap_or(config);

    // Fall back to regular layout if no layouts/scores defined
    if score.layouts.is_empty() || score.scores.is_empty() {
        return layout_full_score(score, config);
    }
    let score_def = match score.scores.get(score_index) {
        Some(sd) => sd,
        None => return layout_full_score(score, config),
    };

    let sp = config.sp;
    let staff_height = 4.0 * sp;
    let inter_staff_gap = 5.0 * sp;
    let inter_group_gap = 7.0 * sp;
    let barline_w = config.barline_width * sp;

    let part_id_map = build_part_id_map(score);
    let measure_id_map = build_measure_id_map(score);

    // Build layout lookup map
    let layout_map: HashMap<String, &LayoutDefinition> =
        score.layouts.iter().map(|l| (l.id.clone(), l)).collect();

    // Collect all systems across all pages, AND track which system index
    // starts each page (system 0 implicitly starts page 0; subsequent
    // entries become forced page breaks for the page-break computation).
    let mut all_systems: Vec<&SystemDefinition> = Vec::new();
    let mut forced_page_starts: Vec<usize> = Vec::new();
    for page in &score_def.pages {
        if !all_systems.is_empty() {
            forced_page_starts.push(all_systems.len());
        }
        for sys in &page.systems {
            all_systems.push(sys);
        }
    }

    // Build MMR skip/start maps from score definition's multimeasureRests
    let mut skip_measures: HashSet<usize> = HashSet::new();
    let mut mmr_start_map: HashMap<usize, u32> = HashMap::new();
    let mut mmr_label_map: HashMap<usize, String> = HashMap::new();
    for mmr in &score_def.multimeasure_rests {
        if let Some(&start_idx) = measure_id_map.get(&mmr.start) {
            mmr_start_map.insert(start_idx, mmr.duration);
            if let Some(ref label) = mmr.label {
                mmr_label_map.insert(start_idx, label.clone());
            }
            for j in (start_idx + 1)..(start_idx + mmr.duration as usize) {
                skip_measures.insert(j);
            }
        }
    }

    // When no explicit pages/systems, auto-flow using the score definition's layout
    if all_systems.is_empty() {
        let Some(layout_id) = score_def.layout.as_deref() else {
            return DisplayList::new(0.0, 0.0);
        };
        let layout_def = match layout_map.get(layout_id) {
            Some(l) => l,
            None => return DisplayList::new(0.0, 0.0),
        };
        let (auto_flat_staves, auto_group_ranges) =
            flatten_layout(&layout_def.content, &part_id_map, score);

        let mut auto_config = config.clone();
        auto_config.multimeasure_rests |= !score_def.multimeasure_rests.is_empty()
            || (score.parts.len() > 1 && single_source_part_index(&auto_flat_staves).is_some());

        let use_written = score_def.use_written.unwrap_or(false);
        let mut dl = layout_auto_flow_mnx_score(
            score,
            &auto_config,
            &auto_flat_staves,
            &auto_group_ranges,
            &mmr_start_map,
            &skip_measures,
            &mmr_label_map,
            use_written,
            dirty_region,
            cache.as_deref_mut(),
        );

        // Add instrument name header in top-left for part scores
        if config.page_width.is_some() {
            let unique_parts: HashSet<usize> = auto_flat_staves
                .iter()
                .flat_map(|s| s.sources.iter().map(|src| src.part_index))
                .collect();
            if unique_parts.len() < score.parts.len() {
                if let Some(name) = score_def.name.as_deref() {
                    let shown: Vec<usize> = unique_parts.iter().copied().collect();
                    let label = augment_part_score_name(name, &score.parts, &shown);
                    let w = dl.width;
                    // Render into a temporary segment so the same commands can be
                    // folded into any pending patch-frame overlay (keeping the
                    // delta reconstruction byte-identical to this full layout).
                    let mut name_seg = DisplayList::new(w, dl.height);
                    render_part_score_name(&mut name_seg, &label, config, w);
                    if let Some(c) = cache.as_deref_mut() {
                        c.fold_into_pending_overlay(name_seg.clone());
                    }
                    dl.append(name_seg);
                }
            }
        }

        return dl;
    }

    // Resolve system measure ranges + per-system flat staves + layout-change maps.
    let measure_count = score.global.measures.len();
    let (mut system_measure_ranges, mut system_flat_staves, mut system_layout_changes) =
        resolve_explicit_systems_and_layouts(
            score,
            score_def,
            &all_systems,
            &measure_id_map,
            &part_id_map,
            &layout_map,
            measure_count,
        );

    let label_style = config
        .text_styles
        .resolve(crate::layout::text_styles::TextRole::StaffLabel);
    let label_margin = compute_explicit_label_margin(&system_flat_staves, sp, label_style);
    // When laid out into pages, use the configured page margins; the
    // editor-only `config.margin_*` values are smaller and intended for
    // the unpaged scrolling view. Without this, the explicit-pages path
    // would clip content beyond the right page edge and ignore the
    // user-visible page margins (the condensed/parts paths already do
    // this via `base_margin_l`/`base_margin_r`).
    let base_margin_l = if config.page_width.is_some() {
        config.page_margin_left * sp
    } else {
        config.margin_left * sp
    };
    let base_margin_r_sp = if config.page_width.is_some() {
        config.page_margin_right
    } else {
        config.margin_right
    };
    let margin_left = base_margin_l + label_margin;
    let margin_top = if config.page_width.is_some() {
        config.page_margin_top * sp
    } else {
        config.margin_top * sp
    };

    // First-system indent for a single-part paged layout, mirroring the
    // auto-flow path: when system 0 draws every staff from the same part (an
    // extracted part book, not a full score), indent it ~one staff height to
    // signal the start of the music. Full scores get this cue from their
    // instrument-name gutter, so they are not indented. Paged mode only.
    let first_system_indent = if config.page_width.is_some()
        && system_flat_staves
            .first()
            .is_some_and(|(staves, _)| single_source_part_index(staves).is_some())
    {
        4.0 * sp
    } else {
        0.0
    };

    // Compute natural measure widths per part
    let all_resolved: Vec<Vec<ResolvedMeasure>> = (0..score.parts.len())
        .map(|i| resolve_measures(score, i))
        .collect();
    let all_resolved_ottavas: Vec<Vec<ResolvedOttavaRange>> = all_resolved
        .iter()
        .map(|resolved| resolve_all_ottavas(resolved))
        .collect();

    // The set of part indices actually displayed in this score's systems. Width
    // and log-spacing must consider ONLY these parts — a part view (a lone
    // instrument) must be spaced for its own notes, not the cross-part maximum
    // over every instrument in the document. The auto-flow path is implicitly
    // scoped this way (it resolves only the layout's staves); here all parts are
    // resolved up front, so the shown set is filtered explicitly.
    let shown_parts: HashSet<usize> = system_flat_staves
        .iter()
        .flat_map(|(staves, _)| staves.iter())
        .flat_map(|fs| fs.sources.iter())
        .map(|src| src.part_index)
        .collect();

    // Detect common shortest duration for logarithmic spacing (shown parts only,
    // matching the auto-flow path's per-staff scope).
    let all_durations: Vec<f64> = all_resolved
        .iter()
        .enumerate()
        .filter(|(pi, _)| shown_parts.contains(pi))
        .flat_map(|(_, resolved)| collect_all_event_durations(resolved))
        .collect();
    let common_shortest_beats = detect_common_shortest_duration(&all_durations);

    // Compute max width per measure across the SHOWN parts (cache-aware).
    let max_widths = compute_explicit_max_widths(
        config,
        sp,
        measure_count,
        &all_resolved,
        &all_resolved_ottavas,
        common_shortest_beats,
        &mmr_start_map,
        &skip_measures,
        &shown_parts,
        cache,
    );

    let content_width = config
        .page_width
        .map(|pw| pw - margin_left - base_margin_r_sp * sp);

    // Sub-break systems whose natural width exceeds available content width.
    if let Some(avail_w) = content_width {
        expand_oversized_systems_explicit(
            avail_w,
            &max_widths,
            &skip_measures,
            &mut system_measure_ranges,
            &mut system_flat_staves,
            &mut system_layout_changes,
        );
    }

    let inter_system_gap = 10.0 * sp;
    let ExplicitPagination {
        page_w,
        total_height,
        pages,
        system_y_positions,
        justified_gaps,
        intra_clearances,
    } = paginate_explicit_pages(
        score,
        config,
        sp,
        staff_height,
        margin_top,
        margin_left,
        base_margin_r_sp,
        inter_group_gap,
        inter_staff_gap,
        inter_system_gap,
        &system_measure_ranges,
        &system_flat_staves,
        &max_widths,
        &forced_page_starts,
    );
    let system_count = system_measure_ranges.len();

    let mut dl = DisplayList::new(page_w, total_height);

    render_explicit_chrome(
        &mut dl,
        score,
        score_def,
        config,
        sp,
        page_w,
        &system_flat_staves,
        &pages,
    );

    let lyric_line_order = score
        .global
        .lyrics
        .as_ref()
        .and_then(|gl| gl.line_order.as_deref());

    // Debug capture for the explicit-pages/systems path. Each entry is built
    // inside the system loop (where we have access to per-system content) and
    // assembled into `LayoutDebugInfo` after the loop.
    let mut dbg_systems: Vec<crate::render::SystemDebug> = Vec::new();

    // Persistent per-physical-staff state that carries across system
    // boundaries (clef/key/time/condensing-mode inheritance). See doc on
    // `PersistentStaffState` for the rationale.
    let mut persistent_state = PersistentStaffState::default();

    // Accumulators for the cross-system slur post-pass (explicit-pages path).
    let mut global_slur_events: Vec<super::super::slurs::GlobalSlurEvent> = Vec::new();
    let mut global_tie_notes: Vec<super::super::ties::GlobalTieNote> = Vec::new();
    let mut slur_bounds: HashMap<(usize, usize, usize), super::super::slurs::SystemSlurBounds> =
        HashMap::new();

    let sys_ctx = ExplicitSystemCtx {
        score,
        score_def,
        config,
        sp,
        staff_height,
        barline_w,
        base_margin_l,
        label_margin,
        margin_left,
        first_system_indent,
        system_count,
        content_width,
        common_shortest_beats,
        lyric_line_order,
        all_resolved: &all_resolved,
        max_widths: &max_widths,
        mmr_start_map: &mmr_start_map,
        mmr_skip_measures: &skip_measures,
        mmr_label_map: &mmr_label_map,
        pages: &pages,
    };

    for (sys_idx, ((flat_staves, group_ranges), &(m_start, m_end))) in system_flat_staves
        .iter()
        .zip(system_measure_ranges.iter())
        .enumerate()
    {
        render_explicit_system(
            &mut dl,
            &sys_ctx,
            sys_idx,
            flat_staves,
            group_ranges,
            m_start,
            m_end,
            system_y_positions[sys_idx],
            justified_gaps[sys_idx],
            intra_clearances[sys_idx],
            &system_layout_changes[sys_idx],
            &mut persistent_state,
            &mut dbg_systems,
            &mut slur_bounds,
            &mut global_slur_events,
            &mut global_tie_notes,
        );
    }

    super::super::ties::render_cross_system_ties(
        &mut dl,
        &global_tie_notes,
        &slur_bounds,
        sp,
        config,
        false,
    );
    super::super::slurs::render_cross_system_slurs(
        &mut dl,
        &global_slur_events,
        &slur_bounds,
        sp,
        config,
        false,
    );

    dl.pages = pages;

    if config.emit_layout_debug && !dbg_systems.is_empty() {
        super::super::debug::link_inter_system_gaps(&mut dbg_systems, sp);
        dl.layout_debug = Some(crate::render::LayoutDebugInfo {
            systems: dbg_systems,
            sp,
            staff_height,
            min_note_spacing: config.min_note_spacing * sp,
            shortest_duration_space: config.shortest_duration_space * sp,
            spacing_increment: config.spacing_increment * sp,
            placement: super::super::debug::build_placement_debug(config, sp),
        });
    }

    // Galley/horizon view: translate stores so above-staff protrusion fits inside
    // the white workspace, then trim width/height to tightly wrap actual content.
    if config.page_width.is_none() {
        fit_unpaged_bounds(&mut dl, margin_top + sp, base_margin_r_sp * sp);
    }

    dl
}
