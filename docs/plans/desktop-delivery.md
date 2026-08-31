# Desktop and PWA Delivery Follow-ups

> **Status:** The Tauri v2 desktop shell is functional and builds native installers. It wraps the production editor, keeps the engraving engine in WASM, and ships native playback, VST3 hosting, Lua articulation mapping, and filesystem-backed instrument profiles. Desktop delivery hardening and the separate installable-web/PWA track remain open.

The implementation and development commands are documented in [`apps/desktop/README.md`](../../apps/desktop/README.md). Instrument-host follow-ups are tracked in [instrument-profiles-vst.md](instrument-profiles-vst.md).

## Shipped desktop baseline

- Tauri v2 application under `apps/desktop` with Windows, macOS, and Linux bundle targets configured.
- Production builds bundle `apps/editor/dist`; development launches the existing editor Vite server.
- WASM is built and staged automatically for both direct desktop development and release builds.
- COOP/COEP headers preserve `SharedArrayBuffer` support under the Tauri asset protocol.
- Native VST3 scanning/hosting, SF2/VST playback, mixing, convolution reverb, and Lua mapping.
- Filesystem-backed instrument-profile storage and native plugin/state selection workflows.
- Application icons plus MSI/NSIS, app bundle/DMG, AppImage/deb/RPM bundle generation through Tauri.

The web editor remains a first-class build. Desktop-specific capabilities must stay behind the existing host boundary rather than leaking Tauri APIs into reusable editor or package code.

## Desktop delivery work

### 1. Native document and project integration

Browser file APIs are not an adequate desktop contract. Route desktop open/save workflows through narrow Tauri commands or plugins:

- Open and save `.mnx`, `.musicxml`, `.xml`, `.mxl`, and future `.viritura` documents through native dialogs.
- Open/create folder-backed Git projects without `showDirectoryPicker`.
- Register file associations and handle files passed at process launch.
- Forward a second-launch document to the existing window instead of opening conflicting application instances.
- Preserve the web implementations as fallbacks when the same editor bundle runs in a browser.

Keep filesystem scope explicit. The frontend should receive selected document/project handles or narrow commands, not unrestricted path access.

### 2. Packaging identity and signing

Before public desktop distribution:

- Replace the development `0.0.1` version with the release version from one authoritative source.
- Confirm the stable application identifier, publisher metadata, icons, product names, and uninstall behavior.
- Sign and notarize macOS bundles with hardened runtime and the required entitlements.
- Sign Windows installers/binaries and establish a repeatable certificate-handling process.
- Decide supported Linux formats and document system dependencies.
- Verify bundled fonts, articulation scripts, SoundFont resources, and licenses in clean-machine installs.

Signing credentials remain external deployment secrets and must not enter the worktree or CI logs.

### 3. Updates and release channels

Add a signed desktop update path rather than relying on the web deployment lifecycle:

- Integrate the Tauri updater with signature verification.
- Publish immutable artifacts and update metadata for stable and preview channels.
- Require explicit user confirmation before restart when a document is dirty or playback/plugin state is active.
- Retain a manual-download fallback and a rollback procedure for a bad update.
- Keep document-format compatibility independent of the installed application version; do not pin ordinary scores to an old executable build.

### 4. Cross-platform qualification

The shell must be exercised on WebView2, WKWebView, and WebKitGTK rather than assuming browser parity:

- Canvas/SMuFL metrics, WASM workers, clipboard, keyboard shortcuts, dialogs, drag/drop, and accessibility.
- Audio-device changes, suspend/resume, plugin scanning, native editor windows, and shutdown cleanup.
- Folder permission, read-only media, long paths, Unicode paths, and external document changes.
- Installer upgrade/downgrade, file association, single-instance, and update behavior.

VST3 hosting currently has platform-specific implementation constraints. Publish the actual capability matrix per release rather than implying that every native feature is available on every desktop OS.

### 5. Release automation

Add a reproducible desktop release workflow that:

1. Runs repository validation and desktop host tests.
2. Builds the editor and WASM once per revision.
3. Produces platform-native bundles on matching runners.
4. Signs/notarizes artifacts without exposing credentials.
5. Generates checksums, provenance, and update metadata.
6. Publishes a draft release for manual smoke approval.
7. Promotes identical artifacts to the chosen distribution channels.

Do not rebuild after approval; promotion must move the artifacts that were tested.

## Optional PWA track

PWA delivery remains useful for an installable offline web experience, but it is no longer a precursor to desktop delivery and does not replace Tauri capabilities.

### Scope

- Web app manifest, complete icon set, standalone display mode, and install affordance.
- Service-worker caching for the editor shell, WASM, fonts, and required assets.
- User-controlled update prompt with cache/version recovery.
- Chromium file handlers and launch queue for `.mnx` where supported.
- Explicit browser fallbacks for file access and unsupported APIs.
- Optional Microsoft Store packaging through PWABuilder after the web install path is stable.

### Boundaries

- A PWA does not give Safari or Firefox the File System Access API.
- It cannot host VST plugins, native low-latency audio, or local subprocesses.
- Service-worker updates must never replace a running editor underneath an unsaved document.
- OPFS must not become the only durable copy of a musician's project.

Version-pinned web bundles, custom protocol handlers, background sync, badges, push notifications, and multi-window coordination should be added only when a concrete product workflow requires them.

## Explicit decisions

1. **Tauri is the desktop runtime.** Electron is not on the roadmap.
2. **The editor remains shared.** Desktop wraps the production web editor rather than creating a second UI.
3. **The engine remains WASM for now.** A native engine binding requires measured benefit and a stable IPC/API contract; it is not part of delivery completion.
4. **Native APIs stay narrow.** Filesystem, plugin, audio, and update access cross explicit Tauri commands/capabilities.
5. **PWA and desktop are parallel channels.** Neither blocks the other.
6. **Artifact promotion is immutable.** Tested installers are the installers that ship.

## Completion criteria

### Desktop

- Native open/save/project workflows work without browser-only directory APIs.
- File associations and single-instance document forwarding work on supported platforms.
- Installers are signed, resources and licenses are complete, and clean-machine smoke tests pass.
- Signed updates support stable/preview channels and protect dirty documents.
- Release automation produces reproducible, promotable artifacts.
- The support matrix accurately states platform-specific native capabilities.

### PWA

- The app installs and starts offline after one successful online load.
- Updates are user-controlled and cannot discard unsaved work.
- File handling works where supported and degrades clearly elsewhere.
- Browser storage is never presented as the sole safe copy of a project.
