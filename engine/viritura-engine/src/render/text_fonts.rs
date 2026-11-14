//! Bundled text faces used for vector export.

use std::sync::LazyLock;
use ttf_parser::Face;

const REGULAR: &[u8] = include_bytes!("../../../../assets/fonts/LibertinusSerif-Regular.otf");
const BOLD: &[u8] = include_bytes!("../../../../assets/fonts/LibertinusSerif-Bold.otf");
const ITALIC: &[u8] = include_bytes!("../../../../assets/fonts/LibertinusSerif-Italic.otf");
const BOLD_ITALIC: &[u8] =
    include_bytes!("../../../../assets/fonts/LibertinusSerif-BoldItalic.otf");

static FACES: LazyLock<[Face<'static>; 4]> = LazyLock::new(|| {
    [REGULAR, BOLD, ITALIC, BOLD_ITALIC]
        .map(|data| Face::parse(data, 0).expect("bundled Libertinus face must be valid"))
});

/// Resolve canonical serif command fonts; other families have no bundled face.
pub(crate) fn face(font: &str) -> Option<&'static Face<'static>> {
    let mut parts = font.split_whitespace();
    if parts.next()? != "serif" {
        return None;
    }
    let (mut bold, mut italic) = (false, false);
    for part in parts {
        match part {
            "bold" => bold = true,
            "italic" => italic = true,
            _ => return None,
        }
    }
    Some(&FACES[usize::from(bold) + 2 * usize::from(italic)])
}

pub(super) fn is_bundled_regular(data: &[u8]) -> bool {
    data == REGULAR
}
