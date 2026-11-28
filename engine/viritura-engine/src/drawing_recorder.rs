//! Saves what each layout in the engine's tests draws, for
//! `tools/render-report`.
//!
//! In test builds, setting `RENDER_RECORDING` to a folder saves the pages of
//! every outermost layout as SVG, with the MNX the test parsed, and lists them
//! in `manifest.jsonl` there. Otherwise these functions only call through.

use crate::model::Score;
use crate::render::DisplayList;
use serde_json::Value;

#[cfg(test)]
pub(crate) use recording::{layout, parse};

#[cfg(not(test))]
pub(crate) fn parse<E>(
    mnx: Value,
    parse: impl FnOnce(Value) -> Result<Score, E>,
) -> Result<Score, E> {
    parse(mnx)
}

#[cfg(not(test))]
pub(crate) fn layout(_score: &Score, layout: impl FnOnce() -> DisplayList) -> DisplayList {
    layout()
}

#[cfg(test)]
mod recording {
    use super::{DisplayList, Score, Value};
    use crate::render::svg::{display_list_to_svg_pages, SvgExportConfig};
    use std::{
        cell::{Cell, RefCell},
        collections::{hash_map::DefaultHasher, HashMap},
        fs::{self, File, OpenOptions},
        hash::{Hash, Hasher},
        io::Write,
        path::{Path, PathBuf},
        sync::{Mutex, OnceLock},
        thread,
    };

    const MM_PER_UNIT: f64 = 25.4 / 96.0;

    thread_local! {
        static DEPTH: Cell<usize> = const { Cell::new(0) };
        static COUNT: Cell<usize> = const { Cell::new(0) };
        static PARSED: RefCell<HashMap<String, String>> = RefCell::default();
    }

    pub(crate) fn parse<E>(
        mnx: Value,
        parse: impl FnOnce(Value) -> Result<Score, E>,
    ) -> Result<Score, E> {
        if folder().is_none() {
            return parse(mnx);
        }
        let source = mnx.to_string();
        let score = parse(mnx)?;
        PARSED.with_borrow_mut(|parsed| parsed.insert(write(&score), source));
        Ok(score)
    }

    pub(crate) fn layout(score: &Score, layout: impl FnOnce() -> DisplayList) -> DisplayList {
        let Some(folder) = folder() else {
            return layout();
        };
        DEPTH.set(DEPTH.get() + 1);
        let list = layout();
        DEPTH.set(DEPTH.get() - 1);
        if DEPTH.get() == 0 {
            COUNT.set(COUNT.get() + 1);
            save(folder, score, &list);
        }
        list
    }

    fn folder() -> Option<&'static Path> {
        static FOLDER: OnceLock<Option<PathBuf>> = OnceLock::new();
        FOLDER
            .get_or_init(|| {
                let folder = PathBuf::from(std::env::var_os("RENDER_RECORDING")?);
                fs::create_dir_all(folder.join("pictures")).unwrap();
                Some(folder)
            })
            .as_deref()
    }

    fn save(folder: &Path, score: &Score, list: &DisplayList) {
        let thread = thread::current();
        let store = |content: &str, extension| store(folder, content, extension);
        let entry = serde_json::json!({
            "test": thread.name().unwrap_or("unnamed thread"),
            "call": COUNT.get(),
            "mnx": store(&original(score), "mnx"),
            "pages": svgs(list).iter().map(|svg| store(svg, "svg")).collect::<Vec<_>>(),
        });
        writeln!(manifest(folder).lock().unwrap(), "{entry}").unwrap();
    }

    /// The MNX the test parsed, or the engine's own if the test changed the score.
    fn original(score: &Score) -> String {
        let written = write(score);
        PARSED.with_borrow(|parsed| parsed.get(&written).cloned().unwrap_or(written))
    }

    fn write(score: &Score) -> String {
        serde_json::to_string(score).unwrap()
    }

    fn svgs(list: &DisplayList) -> Vec<String> {
        static FONTS: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();
        let (music, text) = FONTS.get_or_init(|| {
            let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/fonts");
            let font = |name| fs::read(fonts.join(name)).unwrap();
            (font("Bravura.otf"), font("LibertinusSerif-Regular.otf"))
        });
        let height = list.pages.first().map_or(list.height, |page| page.height);
        let config = SvgExportConfig {
            spatium_mm: MM_PER_UNIT,
            sp_pixels: 1.0,
            page_width_mm: list.width * MM_PER_UNIT,
            page_height_mm: height * MM_PER_UNIT,
        };
        let pages = display_list_to_svg_pages(list, music, Some(text), &config).unwrap();
        pages.into_iter().map(|page| page.svg).collect()
    }

    /// Named by content, so that recordings share what they have in common.
    fn store(folder: &Path, content: &str, extension: &str) -> String {
        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        let name = format!("{:016x}.{extension}", hasher.finish());
        let path = folder.join("pictures").join(&name);
        if !path.exists() {
            let unfinished = path.with_extension(format!("{:?}", thread::current().id()));
            fs::write(&unfinished, content).unwrap();
            fs::rename(unfinished, path).unwrap();
        }
        name
    }

    fn manifest(folder: &Path) -> &'static Mutex<File> {
        static MANIFEST: OnceLock<Mutex<File>> = OnceLock::new();
        MANIFEST.get_or_init(|| {
            let path = folder.join("manifest.jsonl");
            let file = OpenOptions::new().create(true).append(true).open(path);
            Mutex::new(file.unwrap())
        })
    }
}
