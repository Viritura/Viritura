# Viewing &amp; Review

This guide covers score display, canvas navigation, and revision comparison.

## View modes

Switch how the score flows from the view menu / status bar:

- **Page** — paginated pages exactly as they'll print. Best for final
  proofreading and publishing.
- **Horizon** — one continuous galley that scrolls horizontally. Best for fast
  note entry and reading long passages without page breaks getting in the way.
- **Spread** — facing pages, for checking page turns.

The same score can look subtly different between view modes because each uses a
layout strategy tuned to its job; page mode is the source of truth for print.

## Navigating the canvas

| Input                  | Action                  |
| ---------------------- | ----------------------- |
| Mouse wheel / trackpad | Scroll vertically       |
| `Shift` + wheel        | Scroll horizontally     |
| `Mod` + wheel          | Zoom toward the pointer |
| Middle‑drag            | Pan the viewport        |
| Pinch                  | Zoom (trackpad / touch) |

Keyboard zoom: `Mod+=` in, `Mod+-` out, `Mod+0` to reset the viewport. `Mod+\`
toggles the side panels for a distraction‑free view.

## Share a read-only preview

> [!NOTE]
> **Availability: GitHub Gist**
>
> Preview links currently load an MNX document from a GitHub Gist. The author
> needs a GitHub account to create the Gist; recipients do not need an account.

To share a score without starting a live editing session:

1. Create a public or secret GitHub Gist containing exactly one `.mnx` file.
2. In Viritura, choose **File > Share**.
3. Paste the main Gist URL.
4. Leave revision pinning off to follow future Gist edits, or enable it to keep
   the preview fixed at the current revision.
5. Create and copy the Viritura preview link.

The preview provides score-view controls, playback, an MNX download, and a link
to the source Gist. It cannot modify the author's document.

A secret Gist is unlisted, not private. Anyone with the link can open or
forward it, and the Gist exposes its GitHub author and revision history. Use
live collaboration for an editing session; do not use a Gist preview for
material that requires identity-based access control.

## Review version history

In a versioned project, Review reads the Git log. Pick a _from_ and _to_
revision and the Original / Modified panes render the score at each, with
changed measures highlighted and a semantic diff tree on the side. Standalone
files can opt into a project folder before they gain revision history.

A few things to know:

- The two score panes share a synchronized viewport — scroll or zoom one and the
  other follows.
- A concert/written‑pitch toggle re‑renders both panes without touching the
  document.
- Click a changed measure to focus it in both panes.
- Switch between musical snippets and the full MNX file when you need different
  levels of detail.
- Connect a GitHub repository from the history panel when the project should
  have a remote backup or shared repository.

The semantic diff identifies musical changes such as a revised slur or dynamic.

For selection and notation navigation, see
[Notation & Editing](/docs/notation-and-editing#select-musical-material). See
[Keyboard & Mouse](/docs/keyboard-shortcuts) for the complete reference.

For real-time sessions, see [Collaboration](/docs/collaboration). For proposed
document changes from external clients, see [MCP](/docs/mcp).
