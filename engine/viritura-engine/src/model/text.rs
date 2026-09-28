use serde::{Deserialize, Serialize};

/// Inline formatting for a text or glyph run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextRunStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Relative size, as a multiple of the owning text role's resolved size
    /// (the CSS `em` equivalent), never an absolute point size. Layout
    /// multiplies this by the role's base size, which is in staff spaces.
    pub size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<TextWeight>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<TextFontStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Line decorations applied together; a set rather than a single value,
    /// matching how MusicXML and Finale carry them independently.
    pub decorations: Option<Vec<TextDecoration>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enclosure: Option<TextEnclosure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TextWeight {
    Named(TextWeightName),
    Numeric(f64),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TextWeightName {
    Normal,
    Bold,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TextFontStyle {
    Normal,
    Italic,
    Oblique,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TextDecoration {
    Underline,
    Overline,
    Strikethrough,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TextEnclosure {
    Box,
    Circle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TextRunStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlyphRun {
    pub glyphs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TextRunStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smufl_style: Option<TextRunStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TextContentChunk {
    Text(TextRun),
    Glyph(GlyphRun),
}

/// Inline text content as ordered chunks.
///
/// Always a chunk list: a bare string is not a valid representation, so layout
/// never branches on which form it received. Legacy plain-string documents are
/// widened to a single text run before they reach the engine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(transparent)]
pub struct TextContent(pub Vec<TextContentChunk>);

impl TextContent {
    pub fn chunks(&self) -> &[TextContentChunk] {
        &self.0
    }

    pub fn from_raw(raw: crate::raw_viritura::TextContent) -> Self {
        Self(
            raw.0
                .into_iter()
                .map(|chunk| match chunk {
                    crate::raw_viritura::TextContentItem::TextRun(run) => {
                        TextContentChunk::Text(TextRun {
                            text: run.text,
                            style: run.style.map(Into::into),
                        })
                    }
                    crate::raw_viritura::TextContentItem::GlyphRun(run) => {
                        TextContentChunk::Glyph(GlyphRun {
                            glyphs: run
                                .glyphs
                                .into_iter()
                                .map(|glyph| glyph.to_string())
                                .collect(),
                            style: run.style.map(Into::into),
                            smufl_style: run.smufl_style.map(Into::into),
                        })
                    }
                })
                .collect(),
        )
    }
}

impl From<crate::raw_viritura::TextRunStyle> for TextRunStyle {
    fn from(raw: crate::raw_viritura::TextRunStyle) -> Self {
        Self {
            font: raw.font.map(|font| font.to_string()),
            size: raw.size,
            weight: raw.weight.map(Into::into),
            font_style: raw.font_style.map(Into::into),
            decorations: raw
                .decorations
                .map(|items| items.into_iter().map(Into::into).collect()),
            enclosure: raw.enclosure.map(Into::into),
            color: raw.color.map(|color| color.to_string()),
        }
    }
}

impl From<crate::raw_viritura::TextRunStyleWeight> for TextWeight {
    fn from(raw: crate::raw_viritura::TextRunStyleWeight) -> Self {
        match raw {
            crate::raw_viritura::TextRunStyleWeight::Variant0(
                crate::raw_viritura::TextRunStyleWeightVariant0::Normal,
            ) => Self::Named(TextWeightName::Normal),
            crate::raw_viritura::TextRunStyleWeight::Variant0(
                crate::raw_viritura::TextRunStyleWeightVariant0::Bold,
            ) => Self::Named(TextWeightName::Bold),
            crate::raw_viritura::TextRunStyleWeight::Variant1(value) => Self::Numeric(value),
        }
    }
}

impl From<crate::raw_viritura::TextRunStyleFontStyle> for TextFontStyle {
    fn from(raw: crate::raw_viritura::TextRunStyleFontStyle) -> Self {
        match raw {
            crate::raw_viritura::TextRunStyleFontStyle::Normal => Self::Normal,
            crate::raw_viritura::TextRunStyleFontStyle::Italic => Self::Italic,
            crate::raw_viritura::TextRunStyleFontStyle::Oblique => Self::Oblique,
        }
    }
}

impl From<crate::raw_viritura::TextRunStyleDecorationsItem> for TextDecoration {
    fn from(raw: crate::raw_viritura::TextRunStyleDecorationsItem) -> Self {
        match raw {
            crate::raw_viritura::TextRunStyleDecorationsItem::Underline => Self::Underline,
            crate::raw_viritura::TextRunStyleDecorationsItem::Overline => Self::Overline,
            crate::raw_viritura::TextRunStyleDecorationsItem::Strikethrough => Self::Strikethrough,
        }
    }
}

impl From<crate::raw_viritura::TextRunStyleEnclosure> for TextEnclosure {
    fn from(raw: crate::raw_viritura::TextRunStyleEnclosure) -> Self {
        match raw {
            crate::raw_viritura::TextRunStyleEnclosure::Box => Self::Box,
            crate::raw_viritura::TextRunStyleEnclosure::Circle => Self::Circle,
        }
    }
}

impl TextContent {
    pub fn plain_text(&self) -> String {
        self.0
            .iter()
            .filter_map(|chunk| match chunk {
                TextContentChunk::Text(run) => Some(run.text.as_str()),
                TextContentChunk::Glyph(_) => None,
            })
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.0.iter().all(|chunk| match chunk {
            TextContentChunk::Text(run) => run.text.is_empty(),
            TextContentChunk::Glyph(run) => run.glyphs.is_empty(),
        })
    }
}

impl From<String> for TextContent {
    fn from(value: String) -> Self {
        Self(vec![TextContentChunk::Text(TextRun {
            text: value,
            style: None,
        })])
    }
}

impl From<&str> for TextContent {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::{TextContent, TextContentChunk, TextWeight};

    #[test]
    fn converts_generated_raw_text_content_without_serialization_round_trips() {
        let raw: crate::raw_viritura::TextContent = serde_json::from_str(
            r##"[{"text":"con ","style":{"font":"serif","size":1.25,"weight":650,"fontStyle":"italic"}},{"glyphs":["dynamicMF"],"smuflStyle":{"color":"#aabbcc"}}]"##,
        )
        .unwrap();
        let content = TextContent::from_raw(raw);

        let chunks = content.chunks();
        let TextContentChunk::Text(text) = &chunks[0] else {
            panic!("expected a text run");
        };
        assert_eq!(text.text, "con ");
        assert_eq!(text.style.as_ref().and_then(|style| style.size), Some(1.25));
        assert!(matches!(
            text.style.as_ref().and_then(|style| style.weight.as_ref()),
            Some(TextWeight::Numeric(value)) if *value == 650.0
        ));
        let TextContentChunk::Glyph(glyph) = &chunks[1] else {
            panic!("expected a glyph run");
        };
        assert_eq!(glyph.glyphs, ["dynamicMF"]);
        assert_eq!(
            glyph
                .smufl_style
                .as_ref()
                .and_then(|style| style.color.as_deref()),
            Some("#aabbcc")
        );
    }
}
