---
description: Mark platform, browser, host, and workflow limitations consistently in public guides
applyTo: "{docs/guide/**/*.md,apps/website/src/routes/docs/**/*.{ts,tsx},apps/website/src/index.css}"
---

# Public documentation availability

Use a GitHub-compatible Availability alert whenever a documented workflow is
limited by browser engine, host platform, account state, permissions, or another
material prerequisite:

```markdown
> [!NOTE]
> **Availability: Chromium web / desktop app**
>
> Folder-backed projects require directory access. Other browsers can open
> standalone MNX files but cannot create or open project folders.
```

Keep the label short and concrete, such as **Desktop app only**, **Chromium web
/ desktop app**, or **Project folders only**. Explain the practical limitation
and the fallback, when one exists. Do not use an Availability callout for
ordinary instructions, optional preferences, or features available everywhere.
