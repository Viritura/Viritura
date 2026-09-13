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

## Review version history

> [!NOTE]
> **Availability: Project folders only**
>
> Review reads Git history from a versioned project folder. A standalone file
> can choose **Set up version history** and move into a project folder before
> revisions become available.

Review opens with a **Before** and **After** score. The **Changes** tab
summarizes added, removed, and modified musical items and provides a semantic
diff tree. Select a node in that tree to focus the affected measure in both
scores.

Use the **Versions** tab to choose the comparison:

- selecting a saved version compares it with its parent;
- **Working tree** compares unsaved changes;
- **Change** on either endpoint lets you choose an explicit Before or After
  revision;
- versions are grouped into dated editing sessions, with older history loaded
  in batches.

A few things to know:

- The two score panes share a synchronized viewport — scroll or zoom one and the
  other follows.
- A concert/written‑pitch toggle re‑renders both panes without touching the
  document.
- Click a changed measure to focus it in both panes.
- **Scores only** keeps the visual comparison full-height. **Scores and MNX
  source** adds either changed snippets or the full file; full-file source can
  render side by side or inline.
- When a GitHub remote is connected, the history footer can check for new
  versions, push local commits, and open the repository. Projects without a
  remote can create and connect one there after GitHub sign-in.

The semantic diff identifies musical changes such as a revised slur or dynamic.

For selection and notation navigation, see
[Notation & Editing](/docs/notation-and-editing#select-musical-material). See
[Keyboard & Mouse](/docs/keyboard-shortcuts) for the complete reference.

For real-time sessions, see [Collaboration](/docs/collaboration). For proposed
document changes from external clients, see [MCP](/docs/mcp).
