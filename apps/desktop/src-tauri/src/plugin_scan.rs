//! Discovery of installed VST3 plugins and Lua articulation scripts.
//!
//! Rather than have the user hand-pick a `.vst3` or `.lua` file each time (which
//! means remembering deep install paths), the Configure panel lists what it finds
//! in a configurable set of search folders — the way every DAW presents its
//! plugin list. This module walks those folders and reports the discovered
//! entries; it never loads a plugin (identity is read lazily on selection), so a
//! scan is cheap and side-effect-free.
//!
//! [`default_scan_folders`] seeds the folder list with the platform's standard
//! locations plus the app's bundled Lua examples, so a fresh install already
//! finds the common plugins and a couple of ready-made articulation maps.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// One discovered plugin or script: its display name (file stem) and full path.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEntry {
    pub name: String,
    pub path: String,
}

/// The platform-default search folders a fresh install starts with.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultScanFolders {
    pub plugin_folders: Vec<String>,
    pub lua_folders: Vec<String>,
}

/// How deep to descend while scanning. Vendors nest plugins a level or two
/// (`VST3/<Vendor>/<Plugin>.vst3`); this bounds the walk so a mistakenly-added
/// root folder can't trigger an unbounded traversal.
const MAX_DEPTH: usize = 6;

/// Collect every entry under `root` whose extension is `ext` (case-insensitive).
///
/// A matching entry is a leaf even when it is a directory: a `.vst3` on Windows
/// may be either a single file or a bundle folder, and in both cases it is the
/// plugin itself, never a folder to descend into.
fn scan_dir(root: &Path, ext: &str, depth: usize, out: &mut Vec<DiscoveredEntry>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let matches_ext = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(ext));
        if matches_ext {
            if let Some(name) = path.file_stem().and_then(|value| value.to_str()) {
                out.push(DiscoveredEntry {
                    name: name.to_owned(),
                    path: path.to_string_lossy().into_owned(),
                });
            }
        } else if path.is_dir() {
            scan_dir(&path, ext, depth - 1, out);
        }
    }
}

/// Scan `folders` for files/bundles with extension `ext`, de-duplicated by path
/// and sorted case-insensitively by display name.
fn scan_folders(folders: &[String], ext: &str) -> Vec<DiscoveredEntry> {
    let mut out = Vec::new();
    for folder in folders {
        scan_dir(Path::new(folder), ext, MAX_DEPTH, &mut out);
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    out.sort_by_key(|entry| entry.name.to_lowercase());
    out
}

/// List VST3 plugins (`.vst3`) found in the given search folders.
#[tauri::command]
pub fn scan_plugins(folders: Vec<String>) -> Vec<DiscoveredEntry> {
    scan_folders(&folders, "vst3")
}

/// List Lua articulation scripts (`.lua`) found in the given search folders.
#[tauri::command]
pub fn scan_lua_scripts(folders: Vec<String>) -> Vec<DiscoveredEntry> {
    scan_folders(&folders, "lua")
}

/// The user's home directory (`%USERPROFILE%` on Windows, `$HOME` elsewhere).
#[cfg_attr(windows, allow(dead_code))]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// The user's writable Viritura articulations folder, under the platform's
/// per-user app-data location:
///   - Windows: `%APPDATA%\Viritura\Articulations`
///   - macOS:   `~/Library/Application Support/Viritura/Articulations`
///   - Linux:   `${XDG_DATA_HOME:-~/.local/share}/Viritura/Articulations`
fn user_articulations_dir() -> Option<PathBuf> {
    let base: Option<PathBuf> = {
        #[cfg(windows)]
        {
            std::env::var_os("APPDATA").map(PathBuf::from)
        }
        #[cfg(target_os = "macos")]
        {
            home_dir().map(|home| home.join("Library").join("Application Support"))
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| home_dir().map(|home| home.join(".local").join("share")))
        }
    };
    base.map(|dir| dir.join("Viritura").join("Articulations"))
}

/// The platform's standard VST3 install directories.
fn default_plugin_folders() -> Vec<String> {
    let mut folders = Vec::new();
    #[cfg(windows)]
    {
        // `%CommonProgramFiles%\VST3` is the standard machine-wide VST3 location
        // (e.g. `C:\Program Files\Common Files\VST3`).
        if let Some(common) = std::env::var_os("CommonProgramFiles") {
            folders.push(PathBuf::from(common).join("VST3"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        folders.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
        if let Some(home) = home_dir() {
            folders.push(home.join("Library/Audio/Plug-Ins/VST3"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        folders.push(PathBuf::from("/usr/lib/vst3"));
        folders.push(PathBuf::from("/usr/local/lib/vst3"));
        if let Some(home) = home_dir() {
            folders.push(home.join(".vst3"));
        }
    }
    folders
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// The folder holding the app's bundled Lua example scripts (`articulations`).
///
/// These examples live alongside the sample scores in the editor's public
/// assets. In a dev build we resolve that source folder directly; in a
/// packaged build Tauri bundles it to `<resource_dir>/articulations`.
fn bundled_examples_dir(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        // `CARGO_MANIFEST_DIR` is `<repo>/apps/desktop/src-tauri`; its 4th
        // ancestor is the repo root. Join components individually so the path
        // keeps native separators (avoids `canonicalize`'s `\\?\` prefix).
        if let Some(repo_root) = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3) {
            return Some(
                repo_root
                    .join("apps")
                    .join("editor")
                    .join("public")
                    .join("articulations"),
            );
        }
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|resources| resources.join("articulations"))
}

/// Report the platform-default plugin and Lua search folders. The Lua defaults
/// are the user's Viritura articulations folder (under the platform app-data
/// location) plus the app's bundled examples.
#[tauri::command]
pub fn default_scan_folders(app: AppHandle) -> DefaultScanFolders {
    let mut lua_folders = Vec::new();
    if let Some(dir) = user_articulations_dir() {
        lua_folders.push(dir.to_string_lossy().into_owned());
    }
    if let Some(examples) = bundled_examples_dir(&app) {
        lua_folders.push(examples.to_string_lossy().into_owned());
    }
    DefaultScanFolders {
        plugin_folders: default_plugin_folders(),
        lua_folders,
    }
}
