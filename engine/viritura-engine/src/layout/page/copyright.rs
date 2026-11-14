use super::super::config::LayoutConfig;
use super::super::text_styles::TextRole;
use crate::model::score::ScoreMetadata;
use crate::render::{RenderCommand, TextAlign, TextBaseline};

fn notice(metadata: Option<&ScoreMetadata>) -> Option<&str> {
    metadata
        .and_then(|meta| meta.copyright.as_deref())
        .filter(|text| !text.trim().is_empty())
}

pub(crate) fn copyright_footer_height(
    metadata: Option<&ScoreMetadata>,
    config: &LayoutConfig,
) -> f64 {
    if config.page_width.is_none() || notice(metadata).is_none() {
        return 0.0;
    }
    config
        .text_styles
        .resolve(TextRole::Copyright)
        .size_px(config.sp)
        + config.sp
}

pub(crate) fn render_copyright_footer(
    metadata: Option<&ScoreMetadata>,
    config: &LayoutConfig,
    page_top: f64,
    page_height: f64,
    page_width: f64,
) -> Option<RenderCommand> {
    let text = notice(metadata)?;
    let style = config.text_styles.resolve(TextRole::Copyright);
    Some(RenderCommand::DrawText {
        x: page_width / 2.0,
        y: page_top + page_height - config.page_margin_bottom * config.sp,
        text: text.to_owned(),
        font: style.font_string(),
        size: style.size_px(config.sp),
        color: style.color.clone(),
        align: TextAlign::Center,
        baseline: TextBaseline::Alphabetic,
    })
}

pub(crate) fn render_first_page_copyright(
    metadata: Option<&ScoreMetadata>,
    config: &LayoutConfig,
    page_width: f64,
) -> Option<RenderCommand> {
    config.page_width?;
    render_copyright_footer(
        metadata,
        config,
        0.0,
        config.page_height * config.sp,
        page_width,
    )
}
