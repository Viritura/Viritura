//! Last-resort detection of vertical overflow after all overlays are emitted.

use super::super::LayoutConfig;
use super::vertical_ink_extent;
use crate::render::{DisplayList, PageOverflow};

impl std::fmt::Display for PageOverflow {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Page {} cannot fit its notation (top overflow {:.2}sp, bottom overflow {:.2}sp). Increase the page size or reduce the staff size.",
            self.page_number + 1,
            self.top_overflow_sp,
            self.bottom_overflow_sp,
        )
    }
}

impl std::error::Error for PageOverflow {}

/// Validate emitted ink, returning the first overflowing page.
pub fn validate_page_fit(dl: &DisplayList, config: &LayoutConfig) -> Result<(), PageOverflow> {
    match page_overflows(dl, config).into_iter().next() {
        Some(overflow) => Err(overflow),
        None => Ok(()),
    }
}

/// Measure emitted ink, including late cross-system curves, and report the
/// worst overflow per page. Musical commands must stay inside the printable
/// frame; page furniture may occupy the margins.
pub fn page_overflows(dl: &DisplayList, config: &LayoutConfig) -> Vec<PageOverflow> {
    let mut overflows: Vec<PageOverflow> = Vec::new();
    if config.page_width.is_none() || dl.pages.is_empty() {
        return overflows;
    }
    for (index, command) in dl.commands.iter().enumerate() {
        let Some((top, bottom)) = vertical_ink_extent(command) else {
            continue;
        };
        let center = (top + bottom) * 0.5;
        let page_index = dl
            .pages
            .partition_point(|page| page.y_offset <= center)
            .saturating_sub(1);
        let page = &dl.pages[page_index];
        let musical = dl
            .element_ids
            .get(index)
            .and_then(|id| id.as_deref())
            .is_some_and(|id| {
                id.split('/').any(|segment| {
                    segment
                        .strip_prefix('m')
                        .is_some_and(|value| value.parse::<usize>().is_ok())
                })
            });
        let frame_top = page.y_offset
            + if musical {
                config.page_margin_top * config.sp
            } else {
                0.0
            };
        let frame_bottom = page.y_offset + page.height
            - if musical {
                config.page_margin_bottom * config.sp
            } else {
                0.0
            };
        let top_overflow = (frame_top - top).max(0.0) / config.sp;
        let bottom_overflow = (bottom - frame_bottom).max(0.0) / config.sp;
        if top_overflow <= 1e-6 && bottom_overflow <= 1e-6 {
            continue;
        }
        let entry = match overflows
            .iter()
            .position(|overflow| overflow.page_number == page.page_number)
        {
            Some(position) => &mut overflows[position],
            None => {
                overflows.push(PageOverflow {
                    page_number: page.page_number,
                    top_overflow_sp: 0.0,
                    bottom_overflow_sp: 0.0,
                });
                overflows.last_mut().expect("overflow was just pushed")
            }
        };
        entry.top_overflow_sp = entry.top_overflow_sp.max(top_overflow);
        entry.bottom_overflow_sp = entry.bottom_overflow_sp.max(bottom_overflow);
    }
    overflows.sort_by_key(|overflow| overflow.page_number);
    overflows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{PageLayout, RenderCommand};

    #[test]
    fn rejects_late_overlay_overflow_without_treating_control_hulls_as_ink() {
        let config = LayoutConfig {
            sp: 10.0,
            page_width: Some(200.0),
            page_margin_top: 1.0,
            page_margin_bottom: 1.0,
            ..LayoutConfig::default()
        };
        let mut dl = DisplayList::new(200.0, 100.0);
        dl.pages.push(PageLayout {
            page_number: 0,
            y_offset: 0.0,
            height: 100.0,
            system_indices: vec![0],
        });
        dl.push_tagged(
            RenderCommand::DrawBezier {
                x1: 20.0,
                y1: 50.0,
                cx1: 40.0,
                cy1: 100.0,
                cx2: 60.0,
                cy2: 100.0,
                x2: 80.0,
                y2: 50.0,
                width: 1.0,
                color: "#000".into(),
            },
            "p0/m0/slur".into(),
        );
        assert!(validate_page_fit(&dl, &config).is_ok());
        dl.commands[0].translate_in_place(0.0, 10.0);
        let error = validate_page_fit(&dl, &config).unwrap_err();
        assert_eq!(error.page_number, 0);
        assert!((error.bottom_overflow_sp - 0.8).abs() < 1e-9);

        let mut deeper = dl.commands[0].clone();
        deeper.translate_in_place(0.0, 5.0);
        dl.push_tagged(deeper, "p0/m1/slur".into());
        let overflows = page_overflows(&dl, &config);
        assert_eq!(overflows.len(), 1, "one worst-case entry per page");
        assert!((overflows[0].bottom_overflow_sp - 1.3).abs() < 1e-9);

        let unpaged = LayoutConfig {
            page_width: None,
            ..config
        };
        assert!(validate_page_fit(&dl, &unpaged).is_ok());
    }
}
