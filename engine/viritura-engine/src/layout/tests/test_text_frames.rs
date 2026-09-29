// Text frames (#199): page-relative free text located by page index or by
// the page that currently holds a measure/event.

use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;
use crate::render::*;

const PAGE_WIDTH: f64 = 800.0;

fn document(frames: &str, score_extra: &str, breaks: &str) -> String {
    let global: Vec<String> = (0..20)
        .map(|index| {
            if index == 0 {
                r#"{"id":"m0","time":{"count":4,"unit":4}}"#.to_owned()
            } else {
                format!(r#"{{"id":"m{index}"}}"#)
            }
        })
        .collect();
    let measures: Vec<String> = (0..20)
        .map(|index| {
            let clef = if index == 0 {
                r#""clefs":[{"clef":{"sign":"G","staffPosition":-2}}],"#
            } else {
                ""
            };
            format!(
                r#"{{{clef}"sequences":[{{"content":[{{"type":"event","id":"e{index}","duration":{{"base":"whole"}},"notes":[{{"pitch":{{"step":"C","octave":5}}}}]}}]}}]}}"#
            )
        })
        .collect();
    format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{}]}},
            "layouts": [{{"id": "L", "content": [{{"type": "staff", "sources": [{{"part": "P1"}}]}}]}}],
            "scores": [{{"name": "Full", "layout": "L"{score_extra},
                "_x": {{"viritura": {{"layoutBreaks": [{breaks}], "textFrames": [{frames}]}}}}}}],
            "parts": [{{"id": "P1", "name": "Flute", "measures": [{}]}}]
        }}"#,
        global.join(","),
        measures.join(",")
    )
}

fn frame(id: &str, text: &str, locator: &str, rest: &str) -> String {
    let text = serde_json::to_string(text).unwrap();
    format!(
        r#"{{"id":"{id}","content":[{{"text":{text}}}],"locator":{locator},"width":{{"unit":"staffSpaces","value":30}}{rest}}}"#
    )
}

fn paged() -> LayoutConfig {
    LayoutConfig {
        page_width: Some(PAGE_WIDTH),
        ..LayoutConfig::default()
    }
}

fn layout(doc: &str, config: &LayoutConfig) -> DisplayList {
    layout_with_mnx_scores(&parse_mnx(doc).unwrap(), config, 0)
}

/// `(x, y, text, align)` for every text command whose string contains `needle`.
fn texts(dl: &DisplayList, needle: &str) -> Vec<(f64, f64, String, &'static str)> {
    dl.commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText {
                x, y, text, align, ..
            } if text.contains(needle) => Some((
                *x,
                *y,
                text.clone(),
                match align {
                    TextAlign::Left => "left",
                    TextAlign::Center => "center",
                    TextAlign::Right => "right",
                },
            )),
            _ => None,
        })
        .collect()
}

fn page_of(dl: &DisplayList, y: f64) -> usize {
    dl.pages
        .iter()
        .position(|page| y >= page.y_offset && y < page.y_offset + page.height)
        .expect("y should fall on a page")
}

const PAGE_BREAK_AT_10: &str = r#"{"measure":"m10","kind":"page"}"#;
const PAGE_BREAK_AT_5: &str = r#"{"measure":"m5","kind":"page"}"#;
const PAGE_BREAK_AT_15: &str = r#"{"measure":"m15","kind":"page"}"#;
const TOP_LEFT: &str = r#","placement":{"anchor":"top-left","offset":{"x":0,"y":0}}"#;

#[test]
fn page_locator_places_frame_on_final_page_inside_margins() {
    let config = paged();
    let doc = document(
        &frame(
            "f",
            "PAGEFRAME",
            r#"{"type":"page","pageIndex":1}"#,
            TOP_LEFT,
        ),
        "",
        PAGE_BREAK_AT_10,
    );
    let dl = layout(&doc, &config);
    assert_eq!(dl.pages.len(), 2);
    let hits = texts(&dl, "PAGEFRAME");
    assert_eq!(hits.len(), 1);
    let (x, y, _, _) = &hits[0];
    let sp = config.sp;
    assert!((x - config.page_margin_left * sp).abs() < 1e-6);
    let top = dl.pages[1].y_offset + config.page_margin_top * sp;
    assert!(
        *y > top && *y < top + 3.0 * sp,
        "baseline {y} below top {top}"
    );
    assert_eq!(page_of(&dl, *y), 1);
}

#[test]
fn out_of_range_page_and_unknown_targets_are_not_drawn() {
    let frames = [
        frame(
            "a",
            "MISSINGPAGE",
            r#"{"type":"page","pageIndex":9}"#,
            TOP_LEFT,
        ),
        frame(
            "b",
            "MISSINGMEASURE",
            r#"{"type":"globalMeasure","measureId":"nope"}"#,
            TOP_LEFT,
        ),
        frame(
            "c",
            "WRONGPART",
            r#"{"type":"event","partId":"P9","eventId":"e3"}"#,
            TOP_LEFT,
        ),
    ]
    .join(",");
    let dl = layout(&document(&frames, "", ""), &paged());
    assert!(texts(&dl, "MISSING").is_empty());
    assert!(texts(&dl, "WRONGPART").is_empty());
    assert!(
        dl.pages.len() <= 9,
        "pages[] exposes the count an editor compares pageIndex against"
    );
    for id in ["text-frame/a", "text-frame/b", "text-frame/c"] {
        assert!(frame_bbox(&dl, id).is_none(), "{id} is unplaced");
        assert!(tagged(&dl, id).is_empty(), "{id} draws nothing");
    }
}

#[test]
fn musical_locators_follow_their_target_through_reflow() {
    let config = paged();
    let frames = [
        frame(
            "m",
            "MEASUREFRAME",
            r#"{"type":"globalMeasure","measureId":"m12"}"#,
            TOP_LEFT,
        ),
        frame(
            "e",
            "EVENTFRAME",
            r#"{"type":"event","partId":"P1","eventId":"e3"}"#,
            TOP_LEFT,
        ),
    ]
    .join(",");
    let early_break = layout(&document(&frames, "", PAGE_BREAK_AT_10), &config);
    let late_break = layout(&document(&frames, "", PAGE_BREAK_AT_15), &config);
    let very_early = layout(&document(&frames, "", PAGE_BREAK_AT_5), &config);

    let page = |dl: &DisplayList, needle: &str| {
        let hits = texts(dl, needle);
        assert_eq!(hits.len(), 1, "{needle} should render once");
        page_of(dl, hits[0].1)
    };
    assert_eq!(page(&early_break, "MEASUREFRAME"), 1);
    assert_eq!(page(&late_break, "MEASUREFRAME"), 0);
    assert_eq!(page(&early_break, "EVENTFRAME"), 0);
    assert_eq!(page(&very_early, "EVENTFRAME"), 0);
    assert_eq!(page(&very_early, "MEASUREFRAME"), 1);
}

#[test]
fn frames_are_hidden_in_horizon_mode() {
    let doc = document(
        &frame(
            "f",
            "HORIZONFRAME",
            r#"{"type":"page","pageIndex":0}"#,
            TOP_LEFT,
        ),
        "",
        "",
    );
    let dl = layout(&doc, &LayoutConfig::default());
    assert!(texts(&dl, "HORIZONFRAME").is_empty());
}

#[test]
fn wrapping_is_deterministic_and_keeps_authored_breaks() {
    let config = paged();
    let body = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu\nomega";
    let doc = document(
        &frame("f", body, r#"{"type":"page","pageIndex":0}"#, TOP_LEFT),
        "",
        "",
    );
    let first = layout(&doc, &config);
    let second = layout(&doc, &config);
    let lines: Vec<_> = texts(&first, "a")
        .into_iter()
        .filter(|(_, _, text, _)| body.contains(text.as_str()))
        .collect();
    assert_eq!(
        lines,
        texts(&second, "a")
            .into_iter()
            .filter(|(_, _, text, _)| body.contains(text.as_str()))
            .collect::<Vec<_>>()
    );
    assert!(lines.len() >= 3, "30sp frame should wrap: {lines:?}");
    let last = lines.last().unwrap();
    assert_eq!(last.2, "omega", "authored newline starts its own line");
    assert!(
        !lines[..lines.len() - 1]
            .iter()
            .any(|line| line.2.contains('\n')),
        "no raw newlines reach the renderer"
    );
    let sp = config.sp;
    let limit = 30.0 * sp;
    for (_, _, text, _) in &lines {
        let width = crate::layout::text_styles::text_width(
            text,
            2.0 * sp,
            crate::layout::text_styles::FontFamily::Serif,
            false,
        );
        assert!(
            width <= limit + 1e-6,
            "line {text:?} ({width}) exceeds {limit}"
        );
    }
    for pair in lines.windows(2) {
        assert!(pair[1].1 > pair[0].1, "lines advance downward");
    }
}

#[test]
fn alignment_and_justification_are_independent() {
    let config = paged();
    let sp = config.sp;
    let column_left = config.page_margin_left * sp;
    let column_right = PAGE_WIDTH - config.page_margin_right * sp;
    let centre = (column_left + column_right) / 2.0;
    let frames = [
        frame(
            "a",
            "RIGHTJUSTIFIED",
            r#"{"type":"page","pageIndex":0}"#,
            r#","placement":{"anchor":"top","offset":{"x":0,"y":10}},"paragraphJustification":"right""#,
        ),
        frame(
            "b",
            "LEFTALIGNED",
            r#"{"type":"page","pageIndex":0}"#,
            r#","placement":{"anchor":"top","offset":{"x":0,"y":20}},"horizontalAlignment":"left","paragraphJustification":"center""#,
        ),
    ]
    .join(",");
    let dl = layout(&document(&frames, "", ""), &config);

    let right = &texts(&dl, "RIGHTJUSTIFIED")[0];
    assert_eq!(right.3, "right");
    assert!(
        (right.0 - (centre + 15.0 * sp)).abs() < 1e-6,
        "top anchor centres the frame"
    );

    let left = &texts(&dl, "LEFTALIGNED")[0];
    assert_eq!(left.3, "center");
    assert!(
        (left.0 - (centre + 15.0 * sp)).abs() < 1e-6,
        "left alignment puts the frame's left edge on the anchor; text centres inside it"
    );
}

#[test]
fn full_justification_stretches_all_but_paragraph_last_lines() {
    let config = paged();
    let sp = config.sp;
    let body = "aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv ww xx";
    let dl = layout(
        &document(
            &frame(
                "f",
                body,
                r#"{"type":"page","pageIndex":0}"#,
                r#","placement":{"anchor":"top-left","offset":{"x":0,"y":0}},"paragraphJustification":"justify""#,
            ),
            "",
            "",
        ),
        &config,
    );
    let runs: Vec<_> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText { x, y, text, .. }
                if !text.is_empty()
                    && text
                        .split(' ')
                        .all(|word| body.split(' ').any(|w| w == word)) =>
            {
                Some((*x, *y, text.clone()))
            }
            _ => None,
        })
        .collect();
    let emitted: Vec<&str> = runs.iter().flat_map(|run| run.2.split(' ')).collect();
    assert_eq!(
        emitted,
        body.split(' ').collect::<Vec<_>>(),
        "every word renders once, in order"
    );
    let width = |text: &str| {
        crate::layout::text_styles::text_width(
            text,
            2.0 * sp,
            crate::layout::text_styles::FontFamily::Serif,
            false,
        )
    };
    let right_edge = config.page_margin_left * sp + 30.0 * sp;
    let first_line_y = runs[0].1;
    let first_line: Vec<_> = runs.iter().filter(|run| run.1 == first_line_y).collect();
    assert!(
        first_line.len() > 1,
        "stretched lines place each word individually"
    );
    let last = first_line.last().unwrap();
    assert!(
        (last.0 + width(&last.2) - right_edge).abs() < 1e-6,
        "stretched line reaches the right edge"
    );
    let final_run = runs.last().unwrap();
    assert!(final_run.1 > first_line_y);
    assert!(
        final_run.0 + width(&final_run.2) < right_edge - sp,
        "last paragraph line stays ragged"
    );
}

#[test]
fn bottom_anchor_border_and_padding_share_the_frame_rectangle() {
    let config = paged();
    let sp = config.sp;
    let dl = layout(
        &document(
            &frame(
                "f",
                "BOXED",
                r#"{"type":"page","pageIndex":0}"#,
                r#","placement":{"anchor":"bottom-right","offset":{"x":-1,"y":0}},"padding":1,"border":"solid""#,
            ),
            "",
            "",
        ),
        &config,
    );
    let page = &dl.pages[0];
    let bottom = page.y_offset + page.height - config.page_margin_bottom * sp;
    let right = PAGE_WIDTH - config.page_margin_right * sp - sp;
    let left = right - 30.0 * sp;
    let border: Vec<_> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine { x1, y1, x2, y2, .. } => Some((*x1, *y1, *x2, *y2)),
            _ => None,
        })
        .filter(|(x1, _, x2, _)| (x1 - left).abs() < 1e-6 || (x2 - right).abs() < 1e-6)
        .filter(|(_, y1, _, y2)| (y1 - bottom).abs() < 1e-6 || (y2 - bottom).abs() < 1e-6)
        .collect();
    assert!(
        border.len() >= 3,
        "bottom edge plus both sides touch the anchor: {border:?}"
    );
    let text = &texts(&dl, "BOXED")[0];
    assert!(
        (text.0 - (left + sp)).abs() < 1e-6,
        "padding insets the text"
    );
    assert!(
        text.1 < bottom - sp,
        "padding keeps the baseline above the bottom edge"
    );
}

#[test]
fn explicit_pages_path_renders_frames() {
    let config = paged();
    let doc = document(
        &frame(
            "f",
            "EXPLICITFRAME",
            r#"{"type":"globalMeasure","measureId":"m10"}"#,
            TOP_LEFT,
        ),
        r#","pages":[{"systems":[{"measure":"m0"}]},{"systems":[{"measure":"m10"}]}]"#,
        "",
    );
    let dl = layout(&doc, &config);
    assert_eq!(dl.pages.len(), 2);
    let hits = texts(&dl, "EXPLICITFRAME");
    assert_eq!(hits.len(), 1);
    assert_eq!(page_of(&dl, hits[0].1), 1);
}

const EXPLICIT_PAGES: &str =
    r#","pages":[{"systems":[{"measure":"m0"}]},{"systems":[{"measure":"m10"}]}]"#;

fn frame_bbox<'a>(dl: &'a DisplayList, element_id: &str) -> Option<&'a BoundingBox> {
    dl.element_bboxes
        .iter()
        .find(|entry| entry.element_id == element_id)
        .map(|entry| &entry.bbox)
}

/// Commands tagged with `element_id`.
fn tagged<'a>(dl: &'a DisplayList, element_id: &str) -> Vec<&'a RenderCommand> {
    dl.commands
        .iter()
        .zip(&dl.element_ids)
        .filter(|(_, id)| id.as_deref() == Some(element_id))
        .map(|(command, _)| command)
        .collect()
}

#[test]
fn frames_are_selectable_with_one_tag_and_page_offset_bbox() {
    let config = paged();
    let sp = config.sp;
    let doc = document(
        &frame(
            "notes/1",
            "SELECTME\nSECOND",
            r#"{"type":"page","pageIndex":1}"#,
            r#","placement":{"anchor":"top-left","offset":{"x":2,"y":3}},"padding":1,"border":"solid""#,
        ),
        "",
        PAGE_BREAK_AT_10,
    );
    let dl = layout(&doc, &config);
    let id = "text-frame/notes%2F1";
    let bbox = frame_bbox(&dl, id).expect("frame publishes a bbox");
    let page = &dl.pages[1];
    assert!((bbox.x - (config.page_margin_left + 2.0) * sp).abs() < 1e-6);
    assert!(
        (bbox.y - (page.y_offset + (config.page_margin_top + 3.0) * sp)).abs() < 1e-6,
        "bbox is measured on the rendered page's y offset"
    );
    assert!((bbox.width - 30.0 * sp).abs() < 1e-6);
    assert!(bbox.y + bbox.height < page.y_offset + page.height);

    let commands = tagged(&dl, id);
    let lines = commands
        .iter()
        .filter(|command| matches!(command, RenderCommand::DrawLine { .. }))
        .count();
    let texts: Vec<&str> = commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(lines, 4, "every border edge carries the frame tag");
    assert_eq!(
        texts,
        ["SELECTME", "SECOND"],
        "each authored line is tagged"
    );
    for command in &commands {
        let Some(ink) = command.bbox() else {
            continue;
        };
        assert!(ink.y >= bbox.y - sp && ink.y + ink.height <= bbox.y + bbox.height + sp);
    }
    assert!(dl
        .element_shapes
        .iter()
        .any(|shape| shape.element_id == id && shape.kind == ElementKind::Other));
}

#[test]
fn overlong_word_overflows_on_its_own_line_without_splitting() {
    let config = paged();
    let long = "Supercalifragilisticexpialidociousnessandthensomemoreletters";
    let body = format!("before {long} after");
    let dl = layout(
        &document(
            &frame("f", &body, r#"{"type":"page","pageIndex":0}"#, TOP_LEFT),
            "",
            "",
        ),
        &config,
    );
    let tagged_texts: Vec<(f64, String)> = tagged(&dl, "text-frame/f")
        .into_iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText { y, text, .. } => Some((*y, text.clone())),
            _ => None,
        })
        .collect();
    let lines: Vec<&str> = tagged_texts.iter().map(|(_, text)| text.as_str()).collect();
    assert_eq!(lines, ["before", long, "after"]);
    assert!(tagged_texts.windows(2).all(|pair| pair[1].0 > pair[0].0));
    let width = crate::layout::text_styles::text_width(
        long,
        2.0 * config.sp,
        crate::layout::text_styles::FontFamily::Serif,
        false,
    );
    assert!(
        width > 30.0 * config.sp,
        "fixture word must exceed the frame"
    );
}

#[test]
fn blank_authored_lines_are_preserved_as_vertical_space() {
    let config = paged();
    let place = |body: &str| {
        let dl = layout(
            &document(
                &frame("f", body, r#"{"type":"page","pageIndex":0}"#, TOP_LEFT),
                "",
                "",
            ),
            &config,
        );
        let ys: Vec<f64> = texts(&dl, "LINE").iter().map(|hit| hit.1).collect();
        ys[1] - ys[0]
    };
    let single = place("LINEA\nLINEB");
    let blank = place("LINEA\n\nLINEB");
    assert!(
        (blank - 2.0 * single).abs() < 1e-6,
        "an empty paragraph keeps one line of height ({single} vs {blank})"
    );
}

#[test]
fn authored_pages_map_page_and_event_locators_to_final_pages() {
    let config = paged();
    let frames = [
        frame(
            "p",
            "AUTHOREDPAGE",
            r#"{"type":"page","pageIndex":1}"#,
            TOP_LEFT,
        ),
        frame(
            "e",
            "AUTHOREDEVENT",
            r#"{"type":"event","partId":"P1","eventId":"e14"}"#,
            TOP_LEFT,
        ),
        frame(
            "early",
            "AUTHOREDEARLY",
            r#"{"type":"event","partId":"P1","eventId":"e2"}"#,
            TOP_LEFT,
        ),
    ]
    .join(",");
    let dl = layout(&document(&frames, EXPLICIT_PAGES, ""), &config);
    assert_eq!(dl.pages.len(), 2);
    for (needle, element, page) in [
        ("AUTHOREDPAGE", "text-frame/p", 1),
        ("AUTHOREDEVENT", "text-frame/e", 1),
        ("AUTHOREDEARLY", "text-frame/early", 0),
    ] {
        let hits = texts(&dl, needle);
        assert_eq!(hits.len(), 1, "{needle}");
        assert_eq!(page_of(&dl, hits[0].1), page, "{needle}");
        let bbox = frame_bbox(&dl, element).unwrap();
        assert_eq!(page_of(&dl, bbox.y), page, "{element} bbox");
    }
}

#[test]
fn horizon_mode_suppresses_frames_for_auto_and_authored_pages() {
    let frames = frame(
        "f",
        "HIDDENFRAME",
        r#"{"type":"globalMeasure","measureId":"m10"}"#,
        r#","placement":{"anchor":"top-left","offset":{"x":0,"y":0}},"border":"solid""#,
    );
    for extra in ["", EXPLICIT_PAGES] {
        let dl = layout(
            &document(&frames, extra, PAGE_BREAK_AT_10),
            &LayoutConfig::default(),
        );
        assert!(texts(&dl, "HIDDENFRAME").is_empty());
        assert!(frame_bbox(&dl, "text-frame/f").is_none());
        assert!(tagged(&dl, "text-frame/f").is_empty());
    }
}

#[test]
fn authored_newlines_survive_parsing_across_styled_runs() {
    let config = paged();
    let content =
        r#"[{"text":"\nRUNONE\r\nRUN"},{"text":"TWO","style":{"weight":"bold"}},{"text":"\n"}]"#;
    let doc = document(
        &format!(
            r#"{{"id":"f","content":{content},"locator":{{"type":"page","pageIndex":0}},"width":{{"unit":"staffSpaces","value":30}}{TOP_LEFT}}}"#
        ),
        "",
        "",
    );
    let score = parse_mnx(&doc).unwrap();
    let frames = &score.scores[0].text_frames;
    let authored: String = frames[0]
        .content
        .0
        .iter()
        .filter_map(|chunk| match chunk {
            crate::model::TextContentChunk::Text(run) => Some(run.text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        authored, "\nRUNONE\r\nRUNTWO\n",
        "parsing keeps authored breaks verbatim"
    );

    let dl = layout_with_mnx_scores(&score, &config, 0);
    let lines: Vec<(f64, String)> = tagged(&dl, "text-frame/f")
        .into_iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText { y, text, .. } => Some((*y, text.clone())),
            _ => None,
        })
        .collect();
    let words: Vec<&str> = lines.iter().map(|(_, text)| text.as_str()).collect();
    assert_eq!(
        words,
        ["RUNONE", "RUN", "TWO"],
        "styled runs glue into one word"
    );
    assert!(
        (lines[1].0 - lines[2].0).abs() < 1e-9,
        "RUN+TWO share a line"
    );
    let top = config.page_margin_top * config.sp;
    let line_height = lines[1].0 - lines[0].0;
    assert!(
        lines[0].0 - top > line_height,
        "the leading authored newline leaves an empty first line"
    );
    let bbox = frame_bbox(&dl, "text-frame/f").unwrap();
    assert!(
        (bbox.height - 4.0 * line_height).abs() < 1e-6,
        "leading, two text and trailing empty lines give four line heights"
    );
}

#[test]
fn frames_paint_in_array_order_so_later_entries_are_on_top() {
    let ids = ["z", "a", "m"];
    let frames: Vec<String> = ids
        .iter()
        .map(|id| {
            frame(
                id,
                &format!("ORDER{id}"),
                r#"{"type":"page","pageIndex":0}"#,
                TOP_LEFT,
            )
        })
        .collect();
    let dl = layout(&document(&frames.join(","), "", ""), &paged());
    let painted: Vec<&str> = dl
        .element_ids
        .iter()
        .flatten()
        .filter_map(|id| id.strip_prefix("text-frame/"))
        .fold(Vec::new(), |mut order, id| {
            if order.last() != Some(&id) {
                order.push(id);
            }
            order
        });
    assert_eq!(painted, ids, "command order follows textFrames array order");
    let boxes: Vec<&str> = dl
        .element_bboxes
        .iter()
        .filter_map(|entry| entry.element_id.strip_prefix("text-frame/"))
        .collect();
    assert_eq!(boxes, ids);
}

#[test]
fn malformed_frames_fail_the_document_parse() {
    let page = r#"{"type":"page","pageIndex":0}"#;
    let duplicate = [
        frame("f", "ONE", page, TOP_LEFT),
        frame("f", "TWO", page, TOP_LEFT),
    ]
    .join(",");
    let bad_locator = frame("g", "BAD", r#"{"type":"page"}"#, TOP_LEFT);
    for frames in [duplicate, bad_locator] {
        let error = parse_mnx(&document(&frames, "", "")).expect_err("must not load");
        assert!(
            matches!(
                error,
                crate::parse::ParseMnxError::Promote(
                    crate::promote::PromoteError::InvalidTextFrame(_)
                )
            ),
            "{error}"
        );
    }
}
