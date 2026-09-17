use super::*;
use tauri::ipc::{InvokeResponseBody, IpcResponse};

fn fixture_path() -> PathBuf {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let resources = config["bundle"]["resources"].as_object().unwrap();
    let (source, _) = resources
        .iter()
        .find(|(_, target)| target.as_str() == Some(SOUNDFONT_RESOURCE))
        .expect("the fixed SoundFont destination must have a bundled source");
    Path::new(env!("CARGO_MANIFEST_DIR")).join(source)
}

fn missing_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("soundfont_resource")
        .join("missing.sf2")
}

#[test]
fn bundled_mapping_points_to_canonical_repository_asset() {
    let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("audio")
        .join("assets")
        .join(SOUNDFONT_RESOURCE);
    assert_eq!(
        fixture_path().canonicalize().unwrap(),
        expected.canonicalize().unwrap()
    );
    assert!(validate_file(&fixture_path()).unwrap());
}

#[test]
fn existing_resource_wins_without_consulting_repository() {
    let fixture = fixture_path();
    assert_eq!(
        resolve_candidates(Ok(fixture.clone()), || panic!("must prefer resource")).unwrap(),
        fixture
    );
}

#[test]
fn debug_policy_falls_back_only_when_resource_is_absent() {
    let fixture = fixture_path();
    assert_eq!(
        resolve_candidates(Ok(missing_path()), || Some(fixture.clone())).unwrap(),
        fixture
    );
    assert_eq!(
        resolve_candidates(Err("resource directory unavailable".to_owned()), || {
            Some(fixture.clone())
        })
        .unwrap(),
        fixture
    );
}

#[test]
fn release_policy_never_uses_existing_repository_asset() {
    assert!(fixture_path().is_file());
    let error = resolve_candidates(Ok(missing_path()), || None).unwrap_err();
    assert!(error.contains("bundled SoundFont is missing"));
    assert!(error.contains("no repository or network fallback"));
    let error =
        resolve_candidates(Err("resource directory unavailable".to_owned()), || None).unwrap_err();
    assert!(error.contains("resource directory unavailable"));
}

#[test]
fn compiled_fallback_matches_build_policy() {
    #[cfg(debug_assertions)]
    assert_eq!(
        repository_fallback().unwrap().canonicalize().unwrap(),
        fixture_path().canonicalize().unwrap()
    );
    #[cfg(not(debug_assertions))]
    assert!(repository_fallback().is_none());
}

#[test]
fn missing_debug_asset_has_actionable_error() {
    let error = resolve_candidates(Ok(missing_path()), || Some(missing_path())).unwrap_err();
    assert!(error.contains("debug repository SoundFont is missing"));
    assert!(error.contains("Git LFS"));
    assert!(error.contains("no network fallback"));
}

#[test]
fn invalid_existing_resource_does_not_silently_fall_back() {
    let non_font = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let error =
        resolve_candidates(Ok(non_font), || panic!("invalid resource must fail")).unwrap_err();
    assert!(error.contains("invalid SoundFont"));
    assert!(error.contains("RIFF"));
}

#[test]
fn directory_resource_does_not_silently_fall_back() {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let error = resolve_candidates(Ok(directory), || panic!("directory must fail")).unwrap_err();
    assert!(error.contains("SoundFont"));
}

#[test]
fn binary_response_contains_exact_bundled_bytes_not_json() {
    let path = resolve_candidates(Ok(fixture_path()), || None).unwrap();
    let response = read_response(&path).unwrap().body().unwrap();
    let InvokeResponseBody::Raw(bytes) = response else {
        panic!("SoundFont IPC must be raw binary, never a JSON array or base64");
    };
    assert_eq!(bytes.len() as u64, fs::metadata(&path).unwrap().len());
    let mut file = File::open(path).unwrap();
    let mut buffer = [0; 8192];
    for chunk in bytes.chunks(buffer.len()) {
        file.read_exact(&mut buffer[..chunk.len()]).unwrap();
        assert_eq!(chunk, &buffer[..chunk.len()]);
    }
}

#[test]
fn response_surfaces_missing_and_invalid_files() {
    assert!(read_response(&missing_path())
        .err()
        .unwrap()
        .contains("cannot read SoundFont"));
    let non_font = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    assert!(read_response(&non_font)
        .err()
        .unwrap()
        .contains("invalid SoundFont"));
}

#[test]
fn header_validation_rejects_lfs_truncation_wrong_form_and_size() {
    let pointer = b"version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 123\n";
    assert!(validate_header(pointer, pointer.len() as u64)
        .unwrap_err()
        .contains("Git LFS pointer"));
    for len in 0..12 {
        assert!(validate_header(&[0; 12][..len], len as u64)
            .unwrap_err()
            .contains("truncated"));
    }
    assert!(validate_header(b"RIFF\x0c\0\0\0WAVE", 20)
        .unwrap_err()
        .contains("sfbk"));
    assert!(validate_header(b"RIFX\x0c\0\0\0sfbk", 20).is_err());
    assert!(validate_header(b"RIFF\x04\0\0\0sfbk", 12).is_err());
    assert!(validate_header(b"RIFF\x0c\0\0\0sfbk", 19).is_err());
    assert!(validate_header(b"RIFF\x0c\0\0\0sfbk", 21).is_err());
    assert!(validate_header(b"RIFF\xff\xff\xff\xffsfbk", 20).is_err());
    assert!(validate_header(b"RIFF\x0c\0\0\0sfbk", 20).is_ok());
}

#[test]
fn command_boundary_accepts_only_tauri_injected_handle() {
    fn assert_binary_command<Fut>(_: fn(tauri::AppHandle) -> Fut)
    where
        Fut: std::future::Future<Output = Result<tauri::ipc::Response, String>>,
    {
    }
    assert_binary_command(crate::desktop_soundfont_bytes);
    let _: fn(tauri::AppHandle) -> Result<String, String> = crate::vst_soundfont_path;
}
