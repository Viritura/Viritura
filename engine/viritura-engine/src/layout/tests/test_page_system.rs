// Auto-generated from tests.rs — test_page_system
// 17 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::page::*;
use crate::layout::system::*;

// ═══════════════════════════════════════════
// Page breaking tests
// ═══════════════════════════════════════════
#[test]
fn test_sparse_final_system_natural_width_threshold() {
    assert!(should_preserve_natural_final_width(64.9, 100.0, true));
    assert!(!should_preserve_natural_final_width(65.0, 100.0, true));
    assert!(!should_preserve_natural_final_width(40.0, 100.0, false));
}

#[test]
fn test_page_breaks_single_system_fits_one_page() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let system_h = 10.0 * sp; // small system, fits easily
    let pages = compute_page_breaks(&[system_h], &config, 0.0);

    assert_eq!(pages.len(), 1, "Single small system should fit on 1 page");
    assert_eq!(pages[0].page_number, 0);
    assert_eq!(pages[0].system_indices, vec![0]);
    assert_eq!(pages[0].y_offset, 0.0);
    assert_eq!(pages[0].height, config.page_height * sp);
}

#[test]
fn test_page_breaks_empty_input() {
    let config = LayoutConfig::default();
    let pages = compute_page_breaks(&[], &config, 0.0);
    assert!(pages.is_empty(), "No systems should produce no pages");
}

#[test]
fn test_page_breaks_multiple_systems_one_page() {
    let config = LayoutConfig::default();
    let _sp = config.sp;
    let system_h = 100.0;
    let pages = compute_page_breaks(&[system_h, system_h, system_h], &config, 0.0);

    assert_eq!(pages.len(), 1, "3 small systems should fit on 1 page");
    assert_eq!(pages[0].system_indices, vec![0, 1, 2]);
}

#[test]
fn test_page_breaks_systems_span_multiple_pages() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let usable = (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
    let system_h = usable * 0.4;

    let pages = compute_page_breaks(
        &[system_h, system_h, system_h, system_h, system_h],
        &config,
        0.0,
    );

    assert_eq!(pages.len(), 3, "5 medium systems should span 3 pages");
    assert_eq!(pages[0].system_indices, vec![0, 1]);
    assert_eq!(pages[1].system_indices, vec![2, 3]);
    assert_eq!(pages[2].system_indices, vec![4]);
    assert_eq!(pages[0].page_number, 0);
    assert_eq!(pages[1].page_number, 1);
    assert_eq!(pages[2].page_number, 2);
    let ph = config.page_height * sp;
    assert!((pages[1].y_offset - ph).abs() < 0.01);
    assert!((pages[2].y_offset - 2.0 * ph).abs() < 0.01);
}

#[test]
fn test_page_breaks_large_system_gets_own_page() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let usable = (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
    let big_h = usable * 1.5;
    let small_h = usable * 0.3;

    let pages = compute_page_breaks(&[small_h, big_h, small_h], &config, 0.0);
    assert_eq!(pages.len(), 3);
    assert_eq!(pages[0].system_indices, vec![0]);
    assert_eq!(pages[1].system_indices, vec![1]);
    assert_eq!(pages[2].system_indices, vec![2]);
}

#[test]
fn test_oversized_system_keeps_fixed_page_box() {
    // The configured page height is a hard boundary. An orchestral system
    // taller than the page must NOT grow its page box; instead the positioner
    // force-squishes the intra-staff gaps to fit. Every page keeps the exact
    // configured height, and pages tile at fixed `page_height` intervals.
    let config = LayoutConfig::default();
    let sp = config.sp;
    let usable = (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
    let page_height = config.page_height * sp;
    let big_h = usable * 1.5; // taller than one page
    let small_h = usable * 0.3;

    let pages = compute_page_breaks(&[big_h, small_h], &config, 0.0);
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].system_indices, vec![0]);

    // The oversized page does NOT grow — it stays at the configured height.
    assert!(
        (pages[0].height - page_height).abs() < 0.01,
        "oversized page box must stay at the configured page height: {} vs {}",
        pages[0].height,
        page_height
    );
    // The next page starts exactly one page height below — fixed tiling.
    assert!(
        (pages[1].y_offset - page_height).abs() < 0.01,
        "next page must start one fixed page height below: {} vs {}",
        pages[1].y_offset,
        page_height
    );
    // A normal-sized page also keeps the exact configured height.
    assert!(
        (pages[1].height - page_height).abs() < 0.01,
        "normal page height should be unchanged: {}",
        pages[1].height
    );
}

#[test]
fn test_page_breaks_many_measures_multiple_pages() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_height = 4.0 * sp;
    let system_height = staff_height + config.margin_top * sp * 2.0;

    let heights: Vec<f64> = vec![system_height; 20];
    let pages = compute_page_breaks(&heights, &config, 0.0);

    assert!(
        pages.len() > 1,
        "20 systems should span multiple pages, got {}",
        pages.len()
    );
    let total_systems: usize = pages.iter().map(|p| p.system_indices.len()).sum();
    assert_eq!(
        total_systems, 20,
        "All 20 systems should be placed on pages"
    );
    for page in &pages {
        assert!(
            !page.system_indices.is_empty(),
            "Each page should have at least 1 system"
        );
    }
}

#[test]
fn test_two_page_spread_self_balances() {
    // The greedy packer alone fills the first page to capacity and leaves the
    // trailing page sparse. With self-balancing, an adjacent spread should even
    // out (e.g. 10/7 → 9/8) while keeping the fuller page ≥ 75% full.
    let config = LayoutConfig::default();
    let sp = config.sp;
    let page_height = config.page_height * sp;
    let usable = page_height - config.page_margin_top * sp - config.page_margin_bottom * sp;
    let gap = config.inter_system_spacing * sp;

    // Pick a uniform system height so that exactly 10 systems fill one page
    // (11 would overflow). 17 systems total ⇒ greedy yields 10 then 7.
    let h = 180.0;
    assert!(
        10.0 * h + 9.0 * gap <= usable && 11.0 * h + 10.0 * gap > usable,
        "test fixture must pack exactly 10 systems per page"
    );

    let heights = vec![h; 17];
    let pages = compute_page_breaks(&heights, &config, 0.0);

    assert_eq!(pages.len(), 2, "17 systems of this height span two pages");
    assert_eq!(
        pages[0].system_indices.len(),
        9,
        "first page should shed a system to balance the spread"
    );
    assert_eq!(
        pages[1].system_indices.len(),
        8,
        "second page should receive the shed system"
    );

    // All systems still present and in order.
    let mut all: Vec<usize> = pages
        .iter()
        .flat_map(|p| p.system_indices.clone())
        .collect();
    all.sort_unstable();
    assert_eq!(all, (0..17).collect::<Vec<_>>());

    // The fuller page stays at or above the 75% fill floor.
    let fill0 = (9.0 * h + 8.0 * gap) / usable;
    assert!(
        fill0 >= 0.75,
        "balanced first page must remain ≥ 75% full, got {fill0:.3}"
    );
}

#[test]
fn test_selected_page_membership_disables_packer_rebalancing() {
    let config = LayoutConfig::default();
    let heights = vec![180.0; 17];

    let pages = compute_page_breaks_preserving_membership(&heights, None, &config, 0.0, &[0]);

    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].system_indices, (0..10).collect::<Vec<_>>());
    assert_eq!(pages[1].system_indices, (10..17).collect::<Vec<_>>());
}

#[test]
fn test_balance_respects_min_fill_floor() {
    // When evening out would push the donor page below 75%, the balancer must
    // stop. 14 systems (10 fit per page) greedily give 10/4; balancing to 7/7
    // would drop the first page to 70%, so it should settle no lower than the
    // floor (8/6).
    let config = LayoutConfig::default();
    let sp = config.sp;
    let page_height = config.page_height * sp;
    let usable = page_height - config.page_margin_top * sp - config.page_margin_bottom * sp;
    let gap = config.inter_system_spacing * sp;

    let h = 180.0;
    let heights = vec![h; 14];
    let pages = compute_page_breaks(&heights, &config, 0.0);

    assert_eq!(pages.len(), 2);
    let n0 = pages[0].system_indices.len();
    let fill0 = (n0 as f64 * h + (n0 as f64 - 1.0) * gap) / usable;
    assert!(
        fill0 >= 0.75,
        "first page must not be balanced below the 75% floor, got {n0} systems ({fill0:.3})"
    );
    // It should not over-balance to a perfectly even but too-sparse 7/7.
    assert!(
        n0 >= 8,
        "balancer should keep the first page full enough, got {n0} systems"
    );
}

#[test]
fn test_break_into_systems_single_system() {
    let widths = vec![100.0, 100.0, 100.0];
    let systems = break_into_systems(&widths, 500.0);
    assert_eq!(systems.len(), 1);
    assert_eq!(systems[0], vec![0, 1, 2]);
}

#[test]
fn test_break_into_systems_multiple_systems() {
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let systems = break_into_systems(&widths, 200.0);
    assert_eq!(systems.len(), 2);
    assert_eq!(systems[0], vec![0, 1]);
    assert_eq!(systems[1], vec![2, 3]);
}

#[test]
fn test_break_into_systems_one_per_system() {
    let widths = vec![150.0, 150.0, 150.0];
    let systems = break_into_systems(&widths, 200.0);
    assert_eq!(systems.len(), 3);
    assert_eq!(systems[0], vec![0]);
    assert_eq!(systems[1], vec![1]);
    assert_eq!(systems[2], vec![2]);
}

#[test]
fn test_break_into_systems_empty() {
    let widths: Vec<f64> = vec![];
    let systems = break_into_systems(&widths, 500.0);
    assert!(systems.is_empty());
}

#[test]
fn test_break_into_systems_sparse_last_line_redistribution() {
    let widths = vec![50.0, 50.0, 50.0, 50.0, 50.0];
    let systems = break_into_systems(&widths, 200.0);
    assert_eq!(systems.len(), 2);
    // Redistribution: last system had 1 measure, moved 1 from prev
}

#[test]
fn test_break_into_systems_measure_wider_than_system() {
    let widths = vec![300.0, 100.0];
    let systems = break_into_systems(&widths, 200.0);
    assert_eq!(systems.len(), 2);
    assert_eq!(systems[0], vec![0]);
    assert_eq!(systems[1], vec![1]);
}

#[test]
fn test_enforce_tempo_breaks_no_tempo_unchanged() {
    // No measure carries a tempo, so the system grouping is untouched.
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let tempo_widths = vec![0.0, 0.0, 0.0, 0.0];
    let systems = vec![vec![0, 1, 2, 3]];
    let out = enforce_tempo_system_breaks(systems, &widths, &tempo_widths, 400.0);
    assert_eq!(out, vec![vec![0, 1, 2, 3]]);
}

#[test]
fn test_enforce_tempo_breaks_splits_before_overflowing_tempo() {
    // Measure 2 carries a tempo wider than the room remaining to the right
    // edge once justified, so the system is split before it.
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let tempo_widths = vec![0.0, 0.0, 350.0, 0.0];
    let systems = vec![vec![0, 1, 2, 3]];
    let out = enforce_tempo_system_breaks(systems, &widths, &tempo_widths, 400.0);
    assert_eq!(out, vec![vec![0, 1], vec![2, 3]]);
}

#[test]
fn test_enforce_tempo_breaks_keeps_fitting_tempo() {
    // The tempo on measure 2 fits in the remaining room (200px > 150px), so no
    // break is forced.
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let tempo_widths = vec![0.0, 0.0, 150.0, 0.0];
    let systems = vec![vec![0, 1, 2, 3]];
    let out = enforce_tempo_system_breaks(systems, &widths, &tempo_widths, 400.0);
    assert_eq!(out, vec![vec![0, 1, 2, 3]]);
}

#[test]
fn test_enforce_tempo_breaks_first_measure_tempo_never_splits() {
    // A tempo on the first measure of a system can't be helped by breaking
    // (it is already at the left edge); the grouping is left as-is.
    let widths = vec![100.0, 100.0];
    let tempo_widths = vec![500.0, 0.0];
    let systems = vec![vec![0, 1]];
    let out = enforce_tempo_system_breaks(systems, &widths, &tempo_widths, 400.0);
    assert_eq!(out, vec![vec![0, 1]]);
}

#[test]
fn test_tempo_width_reserves_room_for_colocated_rehearsal_mark() {
    // A measure carrying BOTH a wide tempo and a rehearsal mark flows the tempo
    // to the right of the mark's box. The break decision must reserve the mark's
    // footprint too, otherwise the tempo is shoved back left over the mark by the
    // right-margin clamp instead of being pushed to a fresh system. Here the bare
    // tempo (300px) fits in the remaining room (350px), but tempo + mark does not,
    // so the system must split before the tempo's measure.
    use crate::layout::render_annotations::global_tempo_widths;
    use crate::model::direction::{RehearsalMark, RehearsalMarkStyle, Tempo, TempoNoteValue};
    use crate::model::duration::NoteValueBase;
    use crate::model::measure::{GlobalMeasure, GlobalMeasureExtensions, VendorExtensions};

    let config = LayoutConfig::default();
    let sp = config.sp;

    let wide_tempo = Tempo {
        bpm: 120.0,
        value: TempoNoteValue {
            base: NoteValueBase::Quarter,
            dots: None,
        },
        location: None,
        text: Some("Grandioso ma non troppo".to_string()),
        show_metronome_mark: Some(false),
        show_text: Some(true),
        manual_offset: None,
        avoid_collisions: None,
    };

    let make_measure = |with_tempo: bool, with_mark: bool| GlobalMeasure {
        id: None,
        number: None,
        time: None,
        key: None,
        barline: None,
        repeat_start: None,
        repeat_end: None,
        ending: None,
        tempos: with_tempo.then(|| vec![wide_tempo.clone()]),
        segno: None,
        fine: None,
        jump: None,
        extensions: with_mark.then(|| VendorExtensions {
            viritura: Some(GlobalMeasureExtensions {
                rehearsal_mark: Some(RehearsalMark {
                    text: "30".to_string(),
                    style: Some(RehearsalMarkStyle::Boxed),
                    manual_offset: None,
                    avoid_collisions: None,
                }),
                coda: None,
                jump: None,
                senza_misura: None,
            }),
        }),
    };

    // Measure 2 carries the tempo + rehearsal mark; the others are plain.
    let measures = vec![
        make_measure(false, false),
        make_measure(false, false),
        make_measure(true, true),
        make_measure(false, false),
    ];

    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let tempo_only = global_tempo_widths(&measures, measures.len(), &config, sp);

    // Reserving the rehearsal-mark clearance must make the tempo's footprint
    // wider than the same tempo without a co-located mark.
    let no_mark = vec![
        make_measure(false, false),
        make_measure(false, false),
        make_measure(true, false),
        make_measure(false, false),
    ];
    let tempo_no_mark = global_tempo_widths(&no_mark, no_mark.len(), &config, sp);
    assert!(
        tempo_only[2] > tempo_no_mark[2],
        "tempo width with rehearsal mark ({}) should exceed bare tempo width ({})",
        tempo_only[2],
        tempo_no_mark[2]
    );

    // Choose the system width so the room remaining at measure 2 (half of
    // `avail`, since the four equal-width bars place it at the midpoint) sits
    // strictly between the bare-tempo and tempo+mark footprints: the bare tempo
    // fits, the tempo+mark does not.
    let avail = tempo_no_mark[2] + tempo_only[2];

    // The combined footprint forces a break before measure 2 …
    let systems = vec![vec![0, 1, 2, 3]];
    let out = enforce_tempo_system_breaks(systems.clone(), &widths, &tempo_only, avail);
    assert_eq!(
        out,
        vec![vec![0, 1], vec![2, 3]],
        "tempo + co-located rehearsal mark should break onto a fresh system"
    );
    // … but the bare tempo alone fits the remaining room and must not split.
    let out_bare = enforce_tempo_system_breaks(systems, &widths, &tempo_no_mark, avail);
    assert_eq!(
        out_bare,
        vec![vec![0, 1, 2, 3]],
        "bare tempo alone fits the remaining room and must not split"
    );
}

#[test]
fn test_abbreviate_part_name_common_instruments() {
    assert_eq!(abbreviate_part_name("Violin"), "Vln.");
    assert_eq!(abbreviate_part_name("Violin I"), "Vln. I");
    assert_eq!(abbreviate_part_name("Violin II"), "Vln. II");
    assert_eq!(abbreviate_part_name("Viola"), "Vla.");
    assert_eq!(abbreviate_part_name("Cello"), "Vc.");
    assert_eq!(abbreviate_part_name("Flute"), "Fl.");
    assert_eq!(abbreviate_part_name("Oboe"), "Ob.");
    assert_eq!(abbreviate_part_name("Clarinet"), "Cl.");
    assert_eq!(abbreviate_part_name("Trumpet"), "Tpt.");
    assert_eq!(abbreviate_part_name("Piano"), "Pno.");
    assert_eq!(abbreviate_part_name("Harp"), "Hp.");
}

#[test]
fn test_abbreviate_part_name_fallback() {
    // Unknown instruments fall back to first 3 chars + period
    assert_eq!(abbreviate_part_name("Xylophone"), "Xyl.");
    assert_eq!(abbreviate_part_name("Banjo"), "Ban.");
}

#[test]
fn test_abbreviate_part_name_empty() {
    assert_eq!(abbreviate_part_name(""), "");
    assert_eq!(abbreviate_part_name("   "), "");
}

// ═══════════════════════════════════════════
// build_display_name / transposition suffix
// ═══════════════════════════════════════════
#[test]
fn test_build_display_name_no_transposition() {
    // Non-transposing part: name unchanged
    assert_eq!(build_display_name("Flute", None, None), "Flute");
    assert_eq!(build_display_name("Violin I", None, None), "Violin I");
}

#[test]
fn test_build_display_name_appends_key_suffix() {
    // Bb clarinet (halfSteps=2): should append "in B♭"
    assert_eq!(
        build_display_name("Clarinet", Some(2), None),
        "Clarinet in B\u{266d}"
    );
    // F horn (halfSteps=7): should append "in F"
    assert_eq!(build_display_name("Horn", Some(7), None), "Horn in F");
}

#[test]
fn test_build_display_name_no_double_suffix_when_embedded() {
    // Name already has " in B♭" — must not append it again
    assert_eq!(
        build_display_name("Clarinet in B\u{266d}", Some(2), None),
        "Clarinet in B\u{266d}",
    );
    assert_eq!(
        build_display_name("Horn 1 in F", Some(7), None),
        "Horn 1 in F",
    );
}

#[test]
fn test_build_display_name_no_false_positive_infix() {
    // "violin" contains the letters "in" but should NOT suppress "in F"
    assert_eq!(build_display_name("violin", Some(7), None), "violin in F");
    // A name that contains "in" mid-word followed by F elsewhere must not match
    assert_eq!(
        build_display_name("Violin I", Some(7), None),
        "Violin I in F"
    );
}

#[test]
fn test_build_display_name_with_number() {
    assert_eq!(
        build_display_name("Clarinet", Some(2), Some(1)),
        "Clarinet in B\u{266d} 1"
    );
    // No double-suffix even when number is added
    assert_eq!(
        build_display_name("Clarinet in B\u{266d}", Some(2), Some(1)),
        "Clarinet in B\u{266d} 1",
    );
}

// ═══════════════════════════════════════════
// augment_part_score_name — part-header transposition suffix
// ═══════════════════════════════════════════
fn transposing_part(name: &str, half_steps: i32) -> crate::model::part::Part {
    crate::model::part::Part {
        id: None,
        name: name.to_string(),
        short_name: None,
        measures: Vec::new(),
        staves: 1,
        transposition: Some(crate::model::part::Transposition {
            interval: crate::model::part::Interval {
                half_steps,
                staff_distance: 0,
            },
            key_fifths_flip_at: None,
            prefers_written_pitches: None,
        }),
        kit: None,
    }
}

fn concert_part(name: &str) -> crate::model::part::Part {
    crate::model::part::Part {
        id: None,
        name: name.to_string(),
        short_name: None,
        measures: Vec::new(),
        staves: 1,
        transposition: None,
        kit: None,
    }
}

#[test]
fn test_augment_part_score_name_inserts_before_number() {
    // "Trumpet 1" on a B♭ trumpet → "Trumpet in B♭ 1" (suffix before number).
    let parts = vec![transposing_part("Trumpet", 2)];
    assert_eq!(
        augment_part_score_name("Trumpet 1", &parts, &[0]),
        "Trumpet in B\u{266d} 1"
    );
}

#[test]
fn test_augment_part_score_name_appends_when_no_number() {
    // No trailing number → append suffix at the end.
    let parts = vec![transposing_part("Horn", 7)];
    assert_eq!(augment_part_score_name("Horn", &parts, &[0]), "Horn in F");
}

#[test]
fn test_augment_part_score_name_no_double_suffix() {
    // Authored name already spells out the transposition → unchanged.
    let parts = vec![transposing_part("Clarinet", 2)];
    assert_eq!(
        augment_part_score_name("Clarinet in B\u{266d} 1", &parts, &[0]),
        "Clarinet in B\u{266d} 1"
    );
}

#[test]
fn test_augment_part_score_name_concert_pitch_unchanged() {
    // Non-transposing instrument → name unchanged.
    let parts = vec![concert_part("Flute")];
    assert_eq!(augment_part_score_name("Flute 1", &parts, &[0]), "Flute 1");
}

#[test]
fn test_augment_part_score_name_mixed_transpositions_unchanged() {
    // A multi-part header with disagreeing transpositions can't pick one suffix.
    let parts = vec![transposing_part("Trumpet", 2), transposing_part("Horn", 7)];
    assert_eq!(augment_part_score_name("Brass", &parts, &[0, 1]), "Brass");
}

#[test]
fn test_system_y_positions_single_page() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    // 3 single-staff systems on one page — a sparse single (= last) page, so
    // it stays ragged: top-aligned with default gaps, leftover pooled below.
    let staves_per_system = vec![1_usize; 3];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1, 2],
        y_offset: 0.0,
        height: config.page_height * sp,
    }];

    let (positions, gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        None,
        None,
        None,
    );
    assert_eq!(positions.len(), 3);
    let margin_top = config.page_margin_top * sp;
    // Ragged: top-aligned, uniform default gaps.
    let expected_y0 = margin_top;
    assert!(
        (positions[0] - expected_y0).abs() < 0.01,
        "expected top y0 = {:.1}, got {:.1}",
        expected_y0,
        positions[0]
    );
    assert!((positions[1] - (expected_y0 + staff_h + default_gap)).abs() < 0.01);
    assert!((positions[2] - (expected_y0 + 2.0 * (staff_h + default_gap))).abs() < 0.01);
    assert!((gaps[0] - default_gap).abs() < 0.01);
}

#[test]
fn test_system_y_positions_across_pages() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let ph = config.page_height * sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    // 4 single-staff systems, 2 per page. Page 0 is a NON-last page, so it
    // justifies (spreads to fill). Page 1 is the last page and is sparse, so
    // it stays ragged (top-aligned, default gap).
    let staves_per_system = vec![1_usize; 4];

    let pages = vec![
        PageLayout {
            page_number: 0,
            system_indices: vec![0, 1],
            y_offset: 0.0,
            height: ph,
        },
        PageLayout {
            page_number: 1,
            system_indices: vec![2, 3],
            y_offset: ph,
            height: ph,
        },
    ];

    let (positions, _gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        None,
        None,
        None,
    );
    let margin_top = config.page_margin_top * sp;
    let expected_y0 = margin_top;

    // Each page's first system sits at its top margin.
    assert!((positions[0] - expected_y0).abs() < 0.01);
    assert!((positions[2] - (ph + expected_y0)).abs() < 0.01);
    let gap_p0 = positions[1] - (positions[0] + staff_h);
    let gap_p1 = positions[3] - (positions[2] + staff_h);
    // Non-last page 0 justifies (gap grows); last page 1 stays ragged.
    assert!(
        gap_p0 > default_gap + 0.01,
        "non-last page 0 should justify"
    );
    assert!(
        (gap_p1 - default_gap).abs() < 0.01,
        "last page 1 stays ragged"
    );
}

#[test]
fn test_auto_part_can_leave_an_acceptable_turn_page_ragged() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let page_height = config.page_height * sp;
    let staff_height = 4.0 * sp;
    let default_gap = 7.0 * sp;
    let pages = vec![
        PageLayout {
            page_number: 0,
            system_indices: vec![0, 1],
            y_offset: 0.0,
            height: page_height,
        },
        PageLayout {
            page_number: 1,
            system_indices: vec![2, 3],
            y_offset: page_height,
            height: page_height,
        },
    ];

    let (positions, _, _) = compute_system_y_positions_with_ragged_pages(
        &[1; 4],
        staff_height,
        &pages,
        &config,
        0.0,
        None,
        None,
        None,
        Some(&[0]),
    );

    let first_page_gap = positions[1] - positions[0] - staff_height;
    assert!(
        (first_page_gap - default_gap).abs() < 0.01,
        "an explicitly accepted partial turn page should remain top-aligned"
    );
}

#[test]
fn test_spread_inset_aligns_first_staff_lines_across_a_spread() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let ph = config.page_height * sp;
    let staff_h = 4.0 * sp;
    let margin_top = config.page_margin_top * sp;

    // Two facing pages (a spread): page A's first system has a TALL above-staff
    // protrusion (e.g. a tempo mark, 6sp); page B's first system has none.
    // Each page has 2 single-staff systems.
    let staves_per_system = vec![1_usize; 4];
    let sys_heights = vec![staff_h; 4];
    let above_a = 6.0 * sp;
    let extras: Vec<(f64, f64)> = vec![
        (above_a, 0.0), // sys 0 — page A first system: tall above
        (0.0, 0.0),     // sys 1
        (0.0, 0.0),     // sys 2 — page B first system: no above
        (0.0, 0.0),     // sys 3
    ];
    let pages = vec![
        PageLayout {
            page_number: 0,
            system_indices: vec![0, 1],
            y_offset: 0.0,
            height: ph,
        },
        PageLayout {
            page_number: 1,
            system_indices: vec![2, 3],
            y_offset: ph,
            height: ph,
        },
    ];

    // Pages 0 and 1 are facing each other in one spread.
    let partners = vec![Some(1usize), Some(0usize)];
    let (positions, _g, _c) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&sys_heights),
        Some(&extras),
        Some(&partners),
    );

    // Staff line = bbox top + above-extra. The spread inset is max(6sp, 0) = 6sp
    // for BOTH pages, so both first staff lines land at margin_top + 6sp.
    let staff_a = positions[0] + above_a; // page A first staff line
    let staff_b = positions[2] + 0.0; // page B first staff line (relative to its page top)
    let staff_b_on_page = staff_b - ph; // strip the page y_offset
    let staff_a_on_page = staff_a;
    assert!(
        (staff_a_on_page - staff_b_on_page).abs() < 0.01,
        "first staff lines must align across the spread: A={staff_a_on_page} B={staff_b_on_page}"
    );
    // And both sit at margin_top + inset_top (the spread-max above-extent).
    assert!((staff_a_on_page - (margin_top + above_a)).abs() < 0.01);
}

#[test]
fn test_spread_inset_standalone_is_unchanged() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let ph = config.page_height * sp;
    let staff_h = 4.0 * sp;

    // A single page alone in its spread (partner None) with a tall above-extra
    // must reproduce the legacy layout: staff line = margin_top + above_extra,
    // i.e. bbox top = margin_top (pad 0). Compare with-partners-None against
    // the explicit None-slice.
    let staves_per_system = vec![1_usize; 2];
    let sys_heights = vec![staff_h; 2];
    let extras: Vec<(f64, f64)> = vec![(6.0 * sp, 0.0), (0.0, 0.0)];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1],
        y_offset: 0.0,
        height: ph,
    }];

    let legacy = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&sys_heights),
        Some(&extras),
        None,
    );
    // Page alone in its spread: partner None.
    let alone = vec![None];
    let banded = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&sys_heights),
        Some(&extras),
        Some(&alone),
    );
    assert_eq!(legacy.0, banded.0, "standalone page must be byte-identical");
}

#[test]
fn test_system_y_positions_justified_when_full() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    let page_h = config.page_height * sp;
    let _usable = page_h - margin_top - margin_bottom;
    // Use enough staves to exceed the fill threshold (65%).
    // Each system has 4 staves (like a full orchestral system).
    // 4 systems × 4 staves = 16 staves.
    // Natural = 16 * 48 + 15 * 84 = 768 + 1260 = 2028. Fill = 2028/3204 = 0.63.
    // Try 5 systems × 4 staves = 20 staves:
    // Natural = 20 * 48 + 19 * 84 = 960 + 1596 = 2556. Fill = 2556/3204 = 0.80. ✓
    let staves_per_system = vec![4_usize; 5];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1, 2, 3, 4],
        y_offset: 0.0,
        height: page_h,
    }];

    let (positions, gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        None,
        None,
        None,
    );
    // 5 systems of 4 staves each; inter-system gap is distributed across
    // 4 inter-system boundaries. Each system's internal height is computed
    // as 4*staff_h + 3*gap (with the gap value returned).
    // Total: 5 * (4*staff_h + 3*gap) + 4*gap = usable
    //        20*staff_h + 19*gap = usable
    //        gap = (usable - 20*staff_h) / 19
    // But compute_system_y_positions without content heights treats each
    // system's height as 4*48 + 3*gap, so gap and inter-system gap are the same.
    let _total_staff = 20.0 * staff_h;
    // The function distributes available space across 4 inter-system gaps,
    // but each system also uses the gap value internally. With None content
    // heights, system height = n*staff_h + (n-1)*gap, yielding a system
    // total of system_h * 5 + 4 * gap = usable.
    // Justified gap should be larger than the default
    assert!(gaps[0] > 7.0 * sp, "Expected justified gap > default gap");
    // First system starts at margin
    assert!((positions[0] - margin_top).abs() < 0.01);
}

// ═══════════════════════════════════════════
// Forced page break tests (engrave-mode user-authored breaks
// and MNX `score.pages[]` boundary honoring)
// ═══════════════════════════════════════════

#[test]
fn test_forced_page_break_overrides_fit() {
    // Even though all systems would fit on one page, a forced break at
    // index 1 must split them into two pages.
    let config = LayoutConfig::default();
    let small = 100.0;
    let pages = compute_page_breaks_with_forced(&[small, small, small], &config, 0.0, &[1]);
    assert_eq!(
        pages.len(),
        2,
        "Forced break at idx 1 should produce 2 pages"
    );
    assert_eq!(pages[0].system_indices, vec![0]);
    assert_eq!(pages[1].system_indices, vec![1, 2]);
}

#[test]
fn test_forced_page_break_at_zero_ignored() {
    // Index 0 is always implicitly the start of page 0, never a "forced break".
    let config = LayoutConfig::default();
    let small = 100.0;
    let pages = compute_page_breaks_with_forced(&[small, small], &config, 0.0, &[0]);
    assert_eq!(pages.len(), 1, "Forced break at idx 0 must be ignored");
    assert_eq!(pages[0].system_indices, vec![0, 1]);
}

#[test]
fn test_forced_page_break_out_of_range_ignored() {
    let config = LayoutConfig::default();
    let small = 100.0;
    let pages = compute_page_breaks_with_forced(&[small, small], &config, 0.0, &[5, 10]);
    assert_eq!(pages.len(), 1, "Out-of-range forced breaks must be ignored");
}

#[test]
fn test_forced_page_break_combines_with_auto_fit() {
    // 4 systems where 3 fit per page naturally; force break at index 1
    // → page 0: [0], page 1: [1, 2, 3].
    let config = LayoutConfig::default();
    let small = 100.0;
    let pages = compute_page_breaks_with_forced(&[small, small, small, small], &config, 0.0, &[1]);
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].system_indices, vec![0]);
    assert_eq!(pages[1].system_indices, vec![1, 2, 3]);
}

#[test]
fn test_forced_page_break_multiple() {
    // Force breaks at 1 and 3 in a 5-system layout that would otherwise
    // fit on one page. Result: 3 pages.
    let config = LayoutConfig::default();
    let small = 100.0;
    let pages = compute_page_breaks_with_forced(&[small; 5], &config, 0.0, &[1, 3]);
    assert_eq!(pages.len(), 3);
    assert_eq!(pages[0].system_indices, vec![0]);
    assert_eq!(pages[1].system_indices, vec![1, 2]);
    assert_eq!(pages[2].system_indices, vec![3, 4]);
}

#[test]
fn test_no_forced_breaks_matches_auto() {
    // Empty forced-breaks list must produce identical output to the
    // legacy compute_page_breaks function.
    let config = LayoutConfig::default();
    let sp = config.sp;
    let usable = (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
    let h = usable * 0.4;
    let heights = vec![h, h, h, h, h];
    let auto = compute_page_breaks(&heights, &config, 0.0);
    let forced = compute_page_breaks_with_forced(&heights, &config, 0.0, &[]);
    assert_eq!(auto.len(), forced.len());
    for (a, f) in auto.iter().zip(forced.iter()) {
        assert_eq!(a.system_indices, f.system_indices);
    }
}

// ═══════════════════════════════════════════
// Title-block / part-name header layout
// ═══════════════════════════════════════════

#[test]
fn test_composer_and_arranger_stack_right_aligned_at_top() {
    use crate::model::score::ScoreMetadata;
    use crate::render::{RenderCommand, TextAlign};

    let config = LayoutConfig::default();
    let page_w = 1000.0_f64;
    let y_start = config.page_margin_top * config.sp;
    let meta = ScoreMetadata {
        title: Some("Rhapsody in Blue".into()),
        subtitle: None,
        composer: Some("George Gershwin".into()),
        lyricist: None,
        arranger: Some("Peter Yang".into()),
        copyright: None,
    };

    let cmds = render_title_block(Some(&meta), &config, y_start, page_w);

    let right_x = page_w - config.page_margin_right * config.sp;
    let mut composer_y = None;
    let mut arranger_y = None;
    for c in &cmds {
        if let RenderCommand::DrawText {
            x, y, text, align, ..
        } = c
        {
            if text == "George Gershwin" {
                assert!(
                    matches!(align, TextAlign::Right),
                    "composer must be right-aligned"
                );
                assert!(
                    (x - right_x).abs() < 0.01,
                    "composer anchored at right margin"
                );
                composer_y = Some(*y);
            } else if text == "Peter Yang" {
                assert!(
                    matches!(align, TextAlign::Right),
                    "arranger must be right-aligned"
                );
                assert!(
                    (x - right_x).abs() < 0.01,
                    "arranger anchored at right margin"
                );
                arranger_y = Some(*y);
            }
        }
    }
    let composer_y = composer_y.expect("composer rendered");
    let arranger_y = arranger_y.expect("arranger rendered");
    // Composer sits at the top margin; arranger is stacked directly beneath it.
    assert!(composer_y < arranger_y, "arranger must be below composer");
    assert!(
        composer_y
            < y_start
                + 2.0
                    * config
                        .text_styles
                        .resolve(crate::layout::text_styles::TextRole::Composer)
                        .size_px(config.sp),
        "composer aligned near the top margin"
    );
}

#[test]
fn test_part_score_name_is_boxed_below_top_margin() {
    use crate::render::DisplayList;
    use crate::render::RenderCommand;

    let config = LayoutConfig::default();
    let page_w = 1000.0_f64;
    let mut dl = DisplayList::new(page_w, 1400.0);
    render_part_score_name(&mut dl, "Violin I", &config, page_w);

    let top_margin = config.page_margin_top * config.sp;
    let mut text_baseline = None;
    let mut line_count = 0;
    let mut max_x = f64::NEG_INFINITY;
    for c in &dl.commands {
        match c {
            RenderCommand::DrawText { y, text, .. } if text == "Violin I" => {
                text_baseline = Some(*y);
            }
            RenderCommand::DrawLine { x1, x2, .. } => {
                line_count += 1;
                max_x = max_x.max(x1.max(*x2));
            }
            _ => {}
        }
    }
    // Four strokes form the frame around the label.
    assert_eq!(line_count, 4, "instrument label must be framed by a box");
    let baseline = text_baseline.expect("instrument label rendered");
    assert!(
        baseline > top_margin,
        "label sits below the top margin, not up in the margin"
    );

    // The frame must hug the text: its width should match the accurate AFM
    // metric plus padding, NOT the old crude `chars * 0.5em` estimate which ran
    // the right edge well past narrow-glyph text like "Violin I" (the 'I',
    // 'l', 'i' and space are all far below 0.5em).
    let sp = config.sp;
    let style = config
        .text_styles
        .resolve(crate::layout::text_styles::TextRole::StaffLabel);
    let font_size = style.size_px(sp);
    let pad_x = 0.6 * sp;
    let box_left = config.page_margin_left * sp;
    let expected_right = box_left
        + crate::layout::text_styles::text_width("Violin I", font_size, style.family, style.bold)
        + 2.0 * pad_x;
    assert!(
        (max_x - expected_right).abs() < 0.01,
        "frame right edge {max_x:.1} should match accurate text metric {expected_right:.1}"
    );
}

#[test]
fn test_render_title_page_centers_credits_in_upper_page() {
    use crate::model::score::ScoreMetadata;
    use crate::render::{RenderCommand, TextAlign};

    let config = LayoutConfig::default();
    let page_w = 1000.0_f64;
    let page_h = config.page_height * config.sp;
    let meta = ScoreMetadata {
        title: Some("Rhapsody in Blue".into()),
        subtitle: Some("for solo violin".into()),
        composer: Some("George Gershwin".into()),
        lyricist: None,
        arranger: Some("Peter Yang".into()),
        copyright: None,
    };

    let cmds = render_title_page(Some(&meta), &config, 0.0, page_h, page_w);

    let center_x = page_w / 2.0;
    let mut title_y = None;
    let mut composer_y = None;
    for c in &cmds {
        if let RenderCommand::DrawText {
            x, y, text, align, ..
        } = c
        {
            assert!(
                matches!(align, TextAlign::Center),
                "all cover credits are centered"
            );
            assert!((x - center_x).abs() < 0.01, "credit centered horizontally");
            match text.as_str() {
                "Rhapsody in Blue" => title_y = Some(*y),
                "George Gershwin" => composer_y = Some(*y),
                _ => {}
            }
        }
    }
    let title_y = title_y.expect("title rendered on cover");
    let composer_y = composer_y.expect("composer rendered on cover");
    // Title sits in the upper third; composer is stacked below it.
    assert!(
        title_y > page_h * 0.25 && title_y < page_h * 0.55,
        "title spread into the upper-middle of the cover, got {title_y}"
    );
    assert!(composer_y > title_y, "composer sits below the title");
}

#[test]
fn test_render_title_page_renders_copyright_at_foot() {
    use crate::model::score::ScoreMetadata;
    use crate::render::{RenderCommand, TextAlign};

    let config = LayoutConfig::default();
    let page_w = 1000.0_f64;
    let page_h = config.page_height * config.sp;
    let copyright = "Music by George Gershwin (1924, public domain). Arr. © 2024 Peter Yang.";
    let meta = ScoreMetadata {
        title: Some("Rhapsody in Blue".into()),
        subtitle: None,
        composer: Some("George Gershwin".into()),
        lyricist: None,
        arranger: None,
        copyright: Some(copyright.into()),
    };

    let cmds = render_title_page(Some(&meta), &config, 0.0, page_h, page_w);

    let center_x = page_w / 2.0;
    let bottom_margin_line = page_h - config.page_margin_bottom * config.sp;
    let mut found = false;
    for c in &cmds {
        if let RenderCommand::DrawText {
            x, y, text, align, ..
        } = c
        {
            if text == copyright {
                found = true;
                assert!(matches!(align, TextAlign::Center), "copyright centered");
                assert!(
                    (x - center_x).abs() < 0.01,
                    "copyright centered horizontally"
                );
                // Seated at the foot, just above the bottom margin line.
                assert!(
                    (y - bottom_margin_line).abs() < 0.01,
                    "copyright seated on the bottom margin line, got {y} vs {bottom_margin_line}"
                );
            }
        }
    }
    assert!(found, "copyright notice rendered on the cover page");
}

#[test]
fn test_render_title_page_empty_without_credits() {
    use crate::model::score::ScoreMetadata;

    let config = LayoutConfig::default();
    let meta = ScoreMetadata {
        title: None,
        subtitle: None,
        composer: None,
        lyricist: None,
        arranger: None,
        copyright: None,
    };
    let cmds = render_title_page(Some(&meta), &config, 0.0, 1400.0, 1000.0);
    assert!(cmds.is_empty(), "no credits ⇒ no cover commands");
    assert!(
        render_title_page(None, &config, 0.0, 1400.0, 1000.0).is_empty(),
        "no metadata ⇒ no cover commands"
    );
}

#[test]
fn test_prepend_title_page_shifts_music_pages() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let page_h = config.page_height * config.sp;
    // Two music pages produced by the packer, starting at y_offset 0.
    let mut pages = vec![
        PageLayout {
            page_number: 0,
            system_indices: vec![0, 1],
            y_offset: 0.0,
            height: page_h,
        },
        PageLayout {
            page_number: 1,
            system_indices: vec![2, 3],
            y_offset: page_h,
            height: page_h,
        },
    ];

    let cover_h = prepend_title_page(&mut pages, &config);
    assert!((cover_h - page_h).abs() < 0.01, "cover is a full page tall");
    assert_eq!(pages.len(), 3, "cover page prepended");
    // Cover page: index 0, no systems, at the very top.
    assert_eq!(pages[0].page_number, 0);
    assert!(pages[0].system_indices.is_empty());
    assert_eq!(pages[0].y_offset, 0.0);
    // Music pages shifted down by one page and renumbered.
    assert_eq!(pages[1].page_number, 1);
    assert!((pages[1].y_offset - page_h).abs() < 0.01);
    assert_eq!(pages[2].page_number, 2);
    assert!((pages[2].y_offset - 2.0 * page_h).abs() < 0.01);
}

#[test]
fn test_insert_blank_page_before_selected_music_system() {
    use crate::render::PageLayout;
    let config = LayoutConfig::default();
    let page_height = config.page_height * config.sp;
    let mut pages = vec![
        PageLayout {
            page_number: 0,
            system_indices: vec![0, 1],
            y_offset: 0.0,
            height: page_height,
        },
        PageLayout {
            page_number: 1,
            system_indices: vec![2, 3],
            y_offset: page_height,
            height: page_height,
        },
    ];

    let blank_page_numbers = insert_blank_pages_before_systems(&mut pages, &[2], &config);

    assert_eq!(pages.len(), 3);
    assert_eq!(blank_page_numbers, vec![1]);
    assert!(pages[1].system_indices.is_empty());
    assert_eq!(pages[2].system_indices, vec![2, 3]);
    assert_eq!(pages[2].page_number, 2);
    assert!((pages[2].y_offset - 2.0 * page_height).abs() < 0.01);
}

#[test]
fn test_intentional_blank_page_has_no_folio_but_following_number_is_preserved() {
    use crate::render::{DisplayList, PageLayout, RenderCommand};

    let config = LayoutConfig::default();
    let page_height = config.page_height * config.sp;
    let page_width = 500.0;
    let mut pages = vec![
        PageLayout {
            page_number: 0,
            system_indices: vec![0, 1],
            y_offset: 0.0,
            height: page_height,
        },
        PageLayout {
            page_number: 1,
            system_indices: vec![2, 3],
            y_offset: page_height,
            height: page_height,
        },
    ];
    let blank_page_numbers = insert_blank_pages_before_systems(&mut pages, &[2], &config);
    let mut display_list = DisplayList::new(page_width, 3.0 * page_height);

    render_page_numbers_excluding(
        &mut display_list,
        &pages,
        &config,
        page_width,
        &blank_page_numbers,
    );

    let folios: Vec<_> = display_list
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(folios, vec!["3"]);
}

// ═══════════════════════════════════════════
// First-system indent for single-part layouts
// ═══════════════════════════════════════════

/// Collect, for each distinct staff-line Y, the leftmost X of the staff lines
/// drawn at that Y. Staff lines are long horizontal strokes; ledger lines and
/// barlines are excluded by the length / orientation filters.
fn staff_line_left_x_by_y(
    dl: &crate::render::DisplayList,
    sp: f64,
) -> std::collections::BTreeMap<i64, f64> {
    use crate::render::RenderCommand;
    let mut map: std::collections::BTreeMap<i64, f64> = std::collections::BTreeMap::new();
    for c in &dl.commands {
        if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = c {
            let horizontal = (y1 - y2).abs() < 0.01;
            let long = (x2 - x1).abs() > 4.0 * sp;
            if horizontal && long {
                let key = (y1 * 4.0).round() as i64; // quantize to ¼ px
                let left = x1.min(*x2);
                map.entry(key)
                    .and_modify(|x| *x = x.min(left))
                    .or_insert(left);
            }
        }
    }
    map
}

#[test]
fn test_part_first_system_is_indented() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::parse::parse_mnx;

    // A single part (one staff drawn from one part) with enough measures to
    // wrap onto several systems. Standard engraving indents the first system
    // of a part book; subsequent systems start flush at the left margin.
    let mut measures = String::new();
    for _ in 0..8 {
        measures.push_str(
            r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]},"#,
        );
    }
    let measures = measures.trim_end_matches(',');
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{}]}},
            "layouts": [{{"id": "L", "content": [{{"type": "staff", "sources": [{{"part": "vln"}}]}}]}}],
            "scores": [{{"name": "Violin", "layout": "L"}}],
            "parts": [{{"id": "vln", "name": "Violin", "measures": [{}]}}]
        }}"#,
        [r#"{"time": {"count": 4, "unit": 4}}"#; 8].join(","),
        measures
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: Some(500.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let sp = config.sp;

    let lines = staff_line_left_x_by_y(&dl, sp);
    assert!(
        lines.len() >= 10,
        "expected at least two systems of staff lines, got {} distinct Ys",
        lines.len()
    );

    // The five smallest-Y staff lines belong to the first system; a later
    // system's staff lines sit lower. Compare their left edges.
    let xs: Vec<(i64, f64)> = lines.into_iter().collect();
    let first_system_x = xs[0].1;
    let first_system_y = xs[0].0;
    let later_x = xs
        .iter()
        .find(|(y, _)| (*y - first_system_y) as f64 / 4.0 > 4.0 * sp)
        .map(|(_, x)| *x)
        .expect("a later system exists");

    let indent = first_system_x - later_x;
    assert!(
        (indent - 4.0 * sp).abs() < 1.0,
        "first system should be indented by ~one staff height (4 sp = {}), got {}",
        4.0 * sp,
        indent
    );
}

#[test]
fn test_full_score_first_system_not_indented() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::parse::parse_mnx;

    // A full score (two distinct parts) is NOT given the single-part first-system
    // indent — the instrument-name gutter already signals the start. With both
    // parts named so the full and abbreviated labels coincide, the label gutter
    // is identical on every system, so all systems begin at the same left edge.
    let global = [r#"{"time": {"count": 4, "unit": 4}}"#; 8].join(",");
    let measures = (0..8)
        .map(|_| r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]}"#)
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{global}]}},
            "layouts": [{{"id": "L", "content": [
                {{"type": "staff", "sources": [{{"part": "a"}}]}},
                {{"type": "staff", "sources": [{{"part": "b"}}]}}
            ]}}],
            "scores": [{{"name": "Full Score", "layout": "L"}}],
            "parts": [
                {{"id": "a", "name": "Aaa", "shortName": "Aaa", "measures": [{measures}]}},
                {{"id": "b", "name": "Bbb", "shortName": "Bbb", "measures": [{measures}]}}
            ]
        }}"#
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: Some(500.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let sp = config.sp;

    let lines = staff_line_left_x_by_y(&dl, sp);
    let xs: Vec<(i64, f64)> = lines.into_iter().collect();
    assert!(xs.len() >= 10, "expected multiple systems");
    let first_system_x = xs[0].1;
    let first_system_y = xs[0].0;
    let later_x = xs
        .iter()
        .find(|(y, _)| (*y - first_system_y) as f64 / 4.0 > 12.0 * sp)
        .map(|(_, x)| *x)
        .expect("a later system exists");
    assert!(
        (first_system_x - later_x).abs() < 1.0,
        "full-score systems should share the same left edge: first {} vs later {}",
        first_system_x,
        later_x
    );
}

#[test]
fn test_longest_label_hugs_left_margin() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::layout::text_styles::{text_width, FontFamily};
    use crate::parse::parse_mnx;
    use crate::render::{RenderCommand, TextAlign};

    // A two-part full score with one long and one short instrument name. The
    // instrument-name gutter is sized to the widest actual label, so the longest
    // name's left edge should sit flush against the page's left margin (no
    // wasted gutter, no overflow). Both parts carry matching short names so the
    // gutter is identical on every system.
    let global = [r#"{"time": {"count": 4, "unit": 4}}"#; 4].join(",");
    let measures = (0..4)
        .map(|_| r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]}"#)
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{global}]}},
            "layouts": [{{"id": "L", "content": [
                {{"type": "staff", "labelref": "name", "sources": [{{"part": "a"}}]}},
                {{"type": "staff", "labelref": "name", "sources": [{{"part": "b"}}]}}
            ]}}],
            "scores": [{{"name": "Full Score", "layout": "L"}}],
            "parts": [
                {{"id": "a", "name": "Baritone Saxophone", "shortName": "Baritone Saxophone", "measures": [{measures}]}},
                {{"id": "b", "name": "Bsn", "shortName": "Bsn", "measures": [{measures}]}}
            ]
        }}"#
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let sp = config.sp;
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let base_margin_l = config.page_margin_left * sp;

    // Leftmost glyph of any right-aligned serif label (the instrument names).
    let mut min_left_edge = f64::INFINITY;
    for c in &dl.commands {
        if let RenderCommand::DrawText {
            x,
            text,
            font,
            align,
            size,
            ..
        } = c
        {
            if font.contains("serif") && matches!(align, TextAlign::Right) {
                let w = text_width(text, *size, FontFamily::Serif, false);
                min_left_edge = min_left_edge.min(x - w);
            }
        }
    }
    assert!(
        min_left_edge.is_finite(),
        "expected at least one instrument-name label"
    );
    assert!(
        (min_left_edge - base_margin_l).abs() < 2.0,
        "longest label should hug the left margin: leftEdge={min_left_edge:.1} margin={base_margin_l:.1}"
    );
}

#[test]
fn test_staff_labels_follow_the_staff_label_text_style() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::parse::parse_mnx;
    use crate::render::RenderCommand;

    // A per-document `staffLabel` override must reach the instrument names in
    // the left margin. These were previously drawn with a hardcoded serif face
    // at 2.0 sp, so the role resolved but had no visible effect.
    let global = [r#"{"time": {"count": 4, "unit": 4}}"#; 2].join(",");
    let measures = (0..2)
        .map(|_| r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]}"#)
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r##"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{global}]}},
            "layouts": [{{"id": "L", "content": [
                {{"type": "staff", "labelref": "name", "sources": [{{"part": "a"}}]}},
                {{"type": "staff", "labelref": "name", "sources": [{{"part": "b"}}]}}
            ]}}],
            "scores": [{{"name": "Full Score", "layout": "L"}}],
            "parts": [
                {{"id": "a", "name": "Oboe", "shortName": "Ob.", "measures": [{measures}]}},
                {{"id": "b", "name": "Bassoon", "shortName": "Bsn", "measures": [{measures}]}}
            ],
            "_x": {{"viritura": {{"textStyles": {{"staffLabel": {{
                "size": 4.0, "family": "sans-serif", "bold": true, "color": "#c0392b"
            }}}}}}}}
        }}"##
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let sp = config.sp;
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let label = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawText {
                text,
                font,
                size,
                color,
                ..
            } if text == "Oboe" => Some((font.clone(), *size, color.clone())),
            _ => None,
        })
        .expect("expected the 'Oboe' instrument label to be rendered");

    let (font, size, color) = label;
    assert!(
        (size - 4.0 * sp).abs() < 0.01,
        "label size should follow the staffLabel style: {size} vs {}",
        4.0 * sp
    );
    assert!(
        font.contains("sans-serif") && font.contains("bold"),
        "label font should follow the staffLabel style: {font}"
    );
    assert_eq!(color, "#c0392b", "label colour should follow the style");
}

#[test]
fn test_staff_label_gutter_grows_with_the_style_size() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::parse::parse_mnx;
    use crate::render::{RenderCommand, TextAlign};

    // The reserved gutter is measured separately from the drawn glyphs, so a
    // size override has to move both — otherwise a larger label overruns the
    // space set aside for it and collides with the system's left margin.
    let build = |style: &str| {
        let global = [r#"{"time": {"count": 4, "unit": 4}}"#; 2].join(",");
        let measures = (0..2)
            .map(|_| r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]}"#)
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{global}]}},
                "layouts": [{{"id": "L", "content": [
                    {{"type": "staff", "labelref": "name", "sources": [{{"part": "a"}}]}},
                    {{"type": "staff", "labelref": "name", "sources": [{{"part": "b"}}]}}
                ]}}],
                "scores": [{{"name": "Full Score", "layout": "L"}}],
                "parts": [
                    {{"id": "a", "name": "Clarinet", "shortName": "Cl.", "measures": [{measures}]}},
                    {{"id": "b", "name": "Bassoon", "shortName": "Bsn", "measures": [{measures}]}}
                ]{style}
            }}"#
        )
    };

    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Left edge of the staff itself — the gutter is everything to its left.
    let staff_left = |json: &str| {
        let score = parse_mnx(json).unwrap();
        let dl = layout_with_mnx_scores(&score, &config, 0);
        dl.commands
            .iter()
            .filter_map(|c| match c {
                RenderCommand::DrawText { x, align, text, .. }
                    if matches!(align, TextAlign::Right) && text == "Clarinet" =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .fold(f64::NEG_INFINITY, f64::max)
    };

    let base = staff_left(&build(""));
    let scaled = staff_left(&build(
        r#", "_x": {"viritura": {"textStyles": {"staffLabel": {"size": 4.0}}}}"#,
    ));

    assert!(base.is_finite() && scaled.is_finite(), "labels must render");
    assert!(
        scaled > base + 1.0,
        "a larger staffLabel size must widen the reserved gutter: {scaled:.1} vs {base:.1}"
    );
}

#[test]
fn test_page_number_sits_above_top_staff() {
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::parse::parse_mnx;
    use crate::render::RenderCommand;

    // Enough measures to spill onto a second page, so a folio is emitted.
    let n = 80;
    let global = vec![r#"{"time": {"count": 4, "unit": 4}}"#; n].join(",");
    let measures = (0..n)
        .map(|_| r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}]}]}"#)
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{global}]}},
            "layouts": [{{"id": "L", "content": [{{"type": "staff", "sources": [{{"part": "p"}}]}}]}}],
            "scores": [{{"name": "Piece", "layout": "L"}}],
            "parts": [{{"id": "p", "name": "Piano", "measures": [{measures}]}}]
        }}"#
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: Some(500.0),
        ..LayoutConfig::default()
    };
    let sp = config.sp;
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let page_h = config.page_height * sp;
    let margin_top = config.page_margin_top * sp;

    // Folio: a numeric, baseline-Bottom DrawText on the 2nd page hugging a margin.
    let page2_off = page_h;
    let mut folio_y: Option<f64> = None;
    for c in &dl.commands {
        if let RenderCommand::DrawText {
            y, text, baseline, ..
        } = c
        {
            if text.chars().all(|ch| ch.is_ascii_digit())
                && !text.is_empty()
                && matches!(baseline, crate::render::TextBaseline::Bottom)
                && *y >= page2_off
                && *y < page2_off + page_h
            {
                folio_y = Some(folio_y.map_or(*y, |p| p.min(*y)));
            }
        }
    }
    let folio_y = folio_y.expect("expected a page number on page 2");

    // First staff line on page 2.
    let first_staff_y = staff_line_left_x_by_y(&dl, sp)
        .keys()
        .map(|k| *k as f64 / 4.0)
        .find(|y| *y >= page2_off)
        .expect("expected a staff on page 2");

    // The folio is above the top staff (smaller Y) and its baseline sits a 1sp
    // gap above the margin border (the inner edge of the top margin), so it sits
    // just inside the margin band, clear of the content frame.
    let folio_rel = folio_y - page2_off; // distance from page top
    assert!(
        folio_y < first_staff_y,
        "folio should be above the top staff: folioY={folio_y:.1} staffY={first_staff_y:.1}"
    );
    assert!(
        (folio_rel - (margin_top - sp)).abs() < 0.01,
        "folio baseline should sit 1sp above the top-margin border: rel={folio_rel:.1} margin={margin_top:.1}"
    );
}

#[test]
fn test_below_staff_extra_reserves_for_system_start_bar_number() {
    // A below-staff bar number is real ink that protrudes below the staff and
    // must be reserved in the inter-system gap, else the next system crowds it
    // (Rhapsody Violin II, bars 148–154). Build a multi-system part whose later
    // systems carry system-start bar numbers, and assert the per-system
    // below-staff extra reserves for the number's full ink extent.
    use crate::layout::compute_below_staff_extra_from_layouts;
    use crate::layout::layout_measure;
    use crate::layout::render_annotations::below_staff_number_top_y;
    use crate::layout::resolve::resolve_measures;
    use crate::parse::parse_mnx;

    // 6 plain whole-note bars; bars are auto-numbered 1..6 (house style numbers
    // the first measure of each system, > bar 1).
    let measures = (0..6)
        .map(|_| r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}"#)
        .collect::<Vec<_>>()
        .join(",");
    let global = (0..6)
        .map(|_| r#"{"time": {"count": 4, "unit": 4}}"#)
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{global}]}},
            "parts": [{{"id": "p", "name": "Vln", "measures": [{measures}]}}]
        }}"#
    );
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);

    // Synthesize a one-measure "system" whose single bar is a system start
    // carrying bar number 3 (so a number renders), and lay it out.
    let mut rm = resolved[2].clone();
    rm.global.number = Some(3);
    let mut ml = layout_measure(&rm, sp, 0.0, &config, None, &[], 1.0);
    ml.is_first_on_system = true;
    ml.is_first_staff = true;
    ml.part_index = 0;
    let layouts = vec![ml];

    let below = compute_below_staff_extra_from_layouts(&layouts, sp, config.stem_length, &config);

    // The reserved extent must reach the bar number's ink bottom (its top edge
    // is `below_staff_number_top_y`, plus a 2sp font height for TextBaseline::Top).
    let staff_bottom = 4.0 * sp;
    let num_top = below_staff_number_top_y(&layouts[0], 0.0, sp, &config);
    let num_bottom = num_top + 2.0 * sp;
    let needed = num_bottom - staff_bottom;
    assert!(
        below + 0.01 >= needed,
        "below-staff extra ({below:.1}px) must reserve for the bar number's ink \
         bottom ({needed:.1}px below the staff)"
    );
    // And it must be more than the bare note/stem protrusion (a whole note on
    // the middle line protrudes ~0), proving the number drove the reservation.
    assert!(
        below > 1.0 * sp,
        "the bar number should drive a meaningful below-staff reservation, got {below:.1}px"
    );
}

#[test]
fn test_below_staff_extra_reserves_for_treble_clef_tail() {
    // A system-start treble (G) clef's tail descends ~1.68sp below the bottom
    // staff line — real ink that must be reserved so it doesn't spill into the
    // next system / page margin. On a resting system the clef tail is often the
    // lowest ink present. A bass-clef system reserves nothing extra (the F clef
    // stays inside the staff), proving the reservation tracks actual clef ink.
    use crate::layout::compute_below_staff_extra_from_layouts;
    use crate::layout::layout_measure;
    use crate::layout::render_annotations::start_clef;
    use crate::layout::render_signatures::clef_bottom_y;
    use crate::layout::resolve::resolve_measures;
    use crate::parse::parse_mnx;

    let make = |sign: &str| {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"id": "p", "measures": [{{
                    "clefs": [{{"clef": {{"sign": "{sign}", "staffPosition": {pos}}}}}],
                    "sequences": [{{"content": [{{"duration": {{"base": "whole"}}, "rest": {{}}}}]}}]
                }}]}}]
            }}"#,
            pos = if sign == "G" { -2 } else { 2 }
        );
        let score = parse_mnx(&json).unwrap();
        let config = LayoutConfig::default();
        let sp = config.sp;
        let resolved = resolve_measures(&score, 0);
        let mut ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], 1.0);
        ml.is_first_on_system = true;
        ml.is_first_staff = true;
        ml.part_index = 0;
        let clef_bottom = start_clef(&ml).map(|c| clef_bottom_y(c, 0.0, sp));
        let below = compute_below_staff_extra_from_layouts(&[ml], sp, config.stem_length, &config);
        (below, clef_bottom, sp)
    };

    let (below_g, clef_bottom_g, sp) = make("G");
    let staff_bottom = 4.0 * sp;
    let clef_bottom_g = clef_bottom_g.expect("G clef should render at system start");
    let needed = clef_bottom_g - staff_bottom;
    assert!(
        needed > 1.0 * sp,
        "treble clef tail must descend below the staff"
    );
    assert!(
        below_g + 0.01 >= needed,
        "below-staff extra ({below_g:.1}px) must reserve for the treble clef tail \
         ({needed:.1}px below the staff)"
    );

    // Bass clef stays inside the staff → no clef-driven reservation.
    let (below_f, _clef_bottom_f, _) = make("F");
    assert!(
        below_f < needed,
        "a bass-clef system ({below_f:.1}px) must NOT reserve the treble tail amount"
    );
}

#[test]
fn test_above_staff_extra_reserves_for_mmr_count_number() {
    // A collapsed multimeasure rest centers a big count number ~2.5sp above the
    // staff. It is real ink that must sit inside the system box even when NO
    // tempo overlaps it — otherwise a resting system carrying only the count
    // number under-reserves and the number spills into the page margin above.
    use crate::layout::compute_above_staff_extra;
    use crate::layout::layout_measure;
    use crate::layout::render_measure::multimeasure_rest_number_extent;
    use crate::layout::resolve::resolve_measures;
    use crate::parse::parse_mnx;

    // A bass-clef resting bar (no above-staff note/stem/clef ink of note), so
    // the MMR count number is the dominant above-staff ink.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"id": "p", "measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
            "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let mut ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], 1.0);
    ml.is_first_on_system = true;
    ml.is_first_staff = true;
    ml.part_index = 0;
    ml.multimeasure_rest_count = Some(12);

    let extent = multimeasure_rest_number_extent(&ml, 0.0, sp)
        .expect("an MMR count number should have an extent");
    let count_top = extent.2; // negative = above staff
    let needed = (-count_top).max(0.0);
    assert!(
        needed > 1.0 * sp,
        "the MMR count number should rise above the staff"
    );

    let resolved_refs: Vec<&_> = std::iter::once(&resolved[0]).collect();
    let layouts = [ml];
    let above = compute_above_staff_extra(
        &resolved_refs,
        Some(&layouts),
        sp,
        config.stem_length,
        &config,
    );
    assert!(
        above + 0.01 >= needed,
        "above-staff extra ({above:.1}px) must reserve for the MMR count number's \
         top ({needed:.1}px above the staff)"
    );
}

// ── Right-margin text-overflow planning (compress / pull / break) ──────────

#[test]
fn test_overflow_compress_in_place_leaves_partition() {
    // A wide marking on the LAST bar (demand 130 > its 100px natural tail) can
    // be cleared by compressing the three bars before it (head 300 → 270,
    // within the 0.83 floor), so the planner makes NO structural change — the
    // justifier handles it in place.
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let demands = vec![0.0, 0.0, 0.0, 130.0];
    let systems = vec![vec![0, 1, 2, 3]];
    let out = plan_text_overflow(systems, &widths, &demands, 400.0);
    assert_eq!(out, vec![vec![0, 1, 2, 3]]);
}

#[test]
fn test_overflow_breaks_when_compression_insufficient() {
    // Demand 350 on bar 2 can't be absorbed by compressing the 200px head down
    // to the floor (would need head ≤ 50), and there is no previous line to
    // pull into, so the system breaks before the wide bar.
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let demands = vec![0.0, 0.0, 350.0, 0.0];
    let systems = vec![vec![0, 1, 2, 3]];
    let out = plan_text_overflow(systems, &widths, &demands, 400.0);
    assert_eq!(out, vec![vec![0, 1], vec![2, 3]]);
}

#[test]
fn test_overflow_pulls_into_stretched_previous_system() {
    // System 0 = [0,1] is heavily stretched (natural 200 vs avail 400). The
    // wide marking (demand 350) on the last bar of system 1 can't compress in
    // place, but pulling bars 2,3 up FILLS the stretched first line for free —
    // cheaper than breaking — leaving the wide bar alone on a full-width line.
    let widths = vec![100.0, 100.0, 100.0, 100.0, 100.0];
    let demands = vec![0.0, 0.0, 0.0, 0.0, 350.0];
    let systems = vec![vec![0, 1], vec![2, 3, 4]];
    let out = plan_text_overflow(systems, &widths, &demands, 400.0);
    assert_eq!(out, vec![vec![0, 1, 2, 3], vec![4]]);
}

#[test]
fn test_overflow_first_bar_marking_never_reflows() {
    // A marking wider than a whole system on the FIRST bar is already as far
    // left as possible; the base case accepts the overhang rather than looping.
    let widths = vec![100.0, 100.0];
    let demands = vec![500.0, 0.0];
    let systems = vec![vec![0, 1]];
    let out = plan_text_overflow(systems, &widths, &demands, 400.0);
    assert_eq!(out, vec![vec![0, 1]]);
}

#[test]
fn test_overflow_no_demand_is_identity() {
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let demands = vec![0.0, 0.0, 0.0, 0.0];
    let systems = vec![vec![0, 1, 2, 3]];
    let out = plan_text_overflow(systems.clone(), &widths, &demands, 400.0);
    assert_eq!(out, systems);
}

#[test]
fn test_reserve_text_demand_shifts_width_to_tail() {
    // Proportional justification gives [100;4]; reserving a 130px tail for the
    // last bar squeezes the head to 90% (270 total) and hands the freed 30px to
    // the last bar (100 → 130), preserving the 400px system total.
    let widths = vec![100.0, 100.0, 100.0, 100.0];
    let natural = vec![100.0, 100.0, 100.0, 100.0];
    let demands = vec![0.0, 0.0, 0.0, 130.0];
    let out = crate::layout::reserve_text_demand(widths, &natural, &demands, 400.0);
    let expected = [90.0, 90.0, 90.0, 130.0];
    for (got, want) in out.iter().zip(expected.iter()) {
        assert!((got - want).abs() < 1e-6, "got {out:?}, want {expected:?}");
    }
    assert!((out.iter().sum::<f64>() - 400.0).abs() < 1e-6);
}

#[test]
fn test_reserve_text_demand_no_demand_is_identity() {
    let widths = vec![123.0, 77.0, 200.0];
    let natural = widths.clone();
    let demands = vec![0.0, 0.0, 0.0];
    let out = crate::layout::reserve_text_demand(widths.clone(), &natural, &demands, 400.0);
    assert_eq!(out, widths);
}
