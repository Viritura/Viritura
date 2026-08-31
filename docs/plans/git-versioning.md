# Git-Backed Version History

> **Status:** Core local-first Git versioning and GitHub synchronization are shipped. This plan tracks the remaining project-upgrade, history-management, and collaboration UX.

Related references: [file-format.md](../spec/file-format.md), [id-system.md](../spec/id-system.md), [collaboration-system.md](../spec/collaboration-system.md), [auth.md](../spec/auth.md), and [project-format.md](project-format.md).

## Shipped baseline

- `isomorphic-git` behind `FsAdapter` and `ProjectAdapter`, with folder-backed and standalone project modes.
- Project creation/opening, recent-project persistence, author identity, and real Git commits on save.
- Review History panel with log selection, working-tree state, branch/tag detection, and dual-canvas plus JSON diff.
- GitHub App connection, repository creation, push/fetch, periodic background fetch, and ahead/behind status.
- Server-side GitHub credential handling and constrained smart-HTTP proxy. Reusable provider credentials do not enter browser storage.
- Auto-snapshot recognition through commit metadata. Scheduling and history cleanup remain open.

The implementation is under `apps/editor/src/git/`, with state in `apps/editor/src/store/projectStore.ts`. GitHub endpoints and security behavior are specified in [auth.md](../spec/auth.md).

## Remaining work

### 1. Standalone-to-project upgrade

Add **File ▸ Save as Project…**. The command should choose a folder, write the current MNX document, initialize Git, create the first commit, and switch the open document to `GitProjectAdapter` without requiring a reopen.

Coordinate this flow with the future `.viritura` container described in [project-format.md](project-format.md), so the user chooses between a folder project and packaged project in one coherent save flow.

### 2. Project status and branch UI

- Add project name, current branch, dirty state, and ahead/behind state to `WriteStatusBar`.
- Add a branch popover using the existing `branches()`, `checkout()`, and `createBranch()` adapter methods.
- Add **Create branch from here…** to commit context menus.
- Let diff selectors compare branch tips without requiring manual SHA selection.
- Add **Tag this version…** using the existing `tag()` adapter method.

### 3. Snapshot scheduling and cleanup

- Commit a configurable automatic snapshot when a dirty project remains idle for the configured interval.
- Attempt a final snapshot on `visibilitychange=hidden`; do not rely solely on `beforeunload`, which cannot guarantee asynchronous completion.
- Add History filters for manual/automatic snapshots and free-text commit search.
- Add a guarded command to squash contiguous local auto-snapshots without rewriting commits already published to a remote.

### 4. Restore workflow

Add **Restore this version…** to commit context menus:

1. Show the selected version against the working tree in the existing review UI.
2. Require confirmation.
3. Write the selected content as a new commit on the current branch; never rewrite history for a restore.
4. Keep the previous tip available through ordinary Git history.

### 5. GitHub workflow polish

Build on the shipped GitHub connection rather than introducing a second credential path:

- Open the connected repository and relevant commits in GitHub.
- Create a pull request after pushing a feature branch.
- Surface pull-request and Actions check status in History.
- Link issue references in commit messages.
- Clone a GitHub repository into a user-selected folder.

A fine-grained PAT fallback is optional and should only be added for environments where the OAuth flow cannot operate. It must use the same constrained Git transport and must not persist a reusable token in ordinary browser storage.

### 6. External-change handling

Detect when the project document changes outside Viritura. Offer reload/compare choices and, when accepted, record the external content as a normal commit rather than silently replacing in-memory work.

## Deferred research

### Music-aware merge

A structural three-way merge could resolve changes by stable note, event, and measure IDs. Do not build it until real branch conflicts demonstrate that textual MNX conflict resolution is inadequate. Any implementation must preserve valid MNX, surface unresolved musical conflicts for review, and avoid silently choosing one branch's notation.

### Large-history performance

Typical projects contain one MNX document, so loose-object performance and full-file commits are acceptable today. Revisit pack generation, paginated log loading, or a native Git implementation only after measurements on real projects show a user-visible problem.

## Constraints

1. A project is local first; GitHub is an optional synchronization layer, not the primary storage model.
2. Every saved version is valid Git data readable by standard Git tooling.
3. Provider credentials remain server-side; browser code uses narrow Viritura operations and the constrained Git proxy.
4. Restore operations append history rather than rewriting it.
5. Automatic cleanup never rewrites a published remote-tracking range.
6. Folder permission loss must degrade to an explicit reconnect flow without discarding the in-memory document.
7. Browser/platform limitations must be presented where the affected workflow is offered.

## Completion criteria

- A standalone document can become a folder-backed project without reopening.
- Branch, tag, dirty, and synchronization state are visible and operable in the editor.
- Automatic snapshots are configurable, searchable, and safely squashable.
- Restoring a historical version creates a reviewed revert commit.
- External disk edits cannot silently overwrite unsaved work.
- GitHub pull-request/check workflows use the existing secure connection path.
