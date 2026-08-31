//! Physical page-sequence adjustments selected by automatic part pagination.

use std::collections::HashSet;

use crate::layout::config::LayoutConfig;
use crate::render::PageLayout;

/// Insert a dedicated title page before the music pages, shifting every music
/// page down by one full page. Returns the title page's box height.
///
/// Call this on pages produced with no inline title reserve, since the credits
/// move to the dedicated page.
pub fn prepend_title_page(pages: &mut Vec<PageLayout>, config: &LayoutConfig) -> f64 {
    let page_height = config.page_height * config.sp;
    for page in pages.iter_mut() {
        page.page_number += 1;
        page.y_offset += page_height;
    }
    pages.insert(
        0,
        PageLayout {
            page_number: 0,
            system_indices: Vec::new(),
            y_offset: 0.0,
            height: page_height,
        },
    );
    page_height
}

/// Insert empty parity pages before the music pages whose first system is in
/// `system_starts`, then renumber/reposition the complete page sequence.
///
/// The page-turn optimizer uses this only for auto-paginated parts. Authored
/// pages and full-score pagination never pass blank starts here.
pub fn insert_blank_pages_before_systems(
    pages: &mut Vec<PageLayout>,
    system_starts: &[usize],
    config: &LayoutConfig,
) -> Vec<usize> {
    if pages.is_empty() || system_starts.is_empty() {
        return Vec::new();
    }
    let requested: HashSet<usize> = system_starts.iter().copied().collect();
    let page_height = config.page_height * config.sp;
    let mut with_blanks = Vec::with_capacity(pages.len() + requested.len());
    let mut blank_page_numbers = Vec::with_capacity(requested.len());
    for page in pages.drain(..) {
        if page
            .system_indices
            .first()
            .is_some_and(|system| requested.contains(system))
        {
            blank_page_numbers.push(with_blanks.len());
            with_blanks.push(PageLayout {
                page_number: 0,
                system_indices: Vec::new(),
                y_offset: 0.0,
                height: page_height,
            });
        }
        with_blanks.push(page);
    }
    for (page_number, page) in with_blanks.iter_mut().enumerate() {
        page.page_number = page_number;
        page.y_offset = page_number as f64 * page_height;
        page.height = page_height;
    }
    *pages = with_blanks;
    blank_page_numbers
}
