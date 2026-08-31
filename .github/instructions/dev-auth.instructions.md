---
description: Development authentication fixture and safety constraints
applyTo: "{server/Viritura.Api/**/*.cs,apps/editor/src/auth/**/*.{ts,tsx},infra/dev/**/*.{yml,yaml,ps1,md}}"
---

# Development authentication

- Worktree API environments seed `test@example.com` with password `letmein123`.
- This is a public, non-production fixture credential, not a production secret.
- Seeding must remain protected by both `IHostEnvironment.IsDevelopment()` and
  the explicit `Development:SeedTestAccount` setting.
- The worktree Compose profile enables that setting. Production configuration
  must never enable it.
