# Collaboration Follow-ups

> **Status:** Local live collaboration is shipped. The per-element Yjs projection, IndexedDB persistence, WebRTC transport, signaling relay, snapshot sidecar, awareness, host lifecycle, and concurrent editing are documented in [collaboration-system.md](../spec/collaboration-system.md). This plan tracks product capabilities that still depend on that foundation.

Project-wide scheduling is maintained in GitHub. Git-backed history and local branches are tracked in [git-versioning.md](git-versioning.md).

## Shipped baseline

- Schema-blind structural projection between MNX JSON and nested `Y.Map` / `Y.Array` state.
- Concurrent per-element editing with deterministic convergence.
- Local live-host sessions over WebRTC with Viritura signaling and bounded HTTP snapshots for late join.
- Awareness cursors and collaborator state.
- Host-disconnect handling and ephemeral capability links carried in URL fragments.
- Resource limits for signaling connections, topics, messages, snapshots, memory, and expiry.

The current security, transport, mapping, and undo contracts belong in [collaboration-system.md](../spec/collaboration-system.md), not in this plan.

## 1. Local-session polish

- Prompt joining guests for a display name instead of relying only on generated identity.
- Surface explicit connecting, reconnecting, and failed states.
- Measure WebRTC connection failure before adding TURN. If restrictive networks produce material failure rates, configure a managed or self-hosted TURN service.
- Add multi-replica signaling fan-out only when the API actually runs more than one replica.

Anonymous guest identity should use a session-scoped UUID with a locally remembered suggested display name. A refresh may restore the suggestion, but must not imply verified identity.

## 2. Public read-only sharing

Add a **Publish to public link** workflow independent of live collaboration:

- Upload bounded MNX content to managed blob storage.
- Serve it through the existing read-only score viewer with an embeddable chrome-free mode.
- Apply per-user share quotas and per-document size limits.
- Allow a viewer to fork the document into their own project when authenticated.

The published artifact should be static viewer content plus MNX, not a live Y.Doc. This keeps anonymous viewing cheap and removes signaling availability from the read path.

## 3. Review comments

Comments remain outside MNX so exchanging a score does not implicitly disclose review discussion.

- Persist project comments beside the score in the future project container or folder format.
- Synchronize live comments through a dedicated Yjs collection in the same session.
- Anchor comments to stable element IDs with measure/rhythmic-position fallback.
- Provide threads, replies, resolution, jump-to-element, and orphan reattachment in Review.
- Show a clear guest badge for comments from anonymous reviewers.

Coordinate the on-disk representation with [project-format.md](project-format.md); do not introduce a second temporary bundle format solely for comments.

## 4. Managed cloud collaboration

Cloud mode provides an always-online canonical authority and first-class browser support where local project folders are unavailable.

### Initial milestone: solo cross-device sync

1. Provision an authenticated cloud project.
2. Host its Y.Doc on the server through a transport adapter in `packages/crdt`.
3. Persist document snapshots and metadata using the backend/cloud architecture selected in [production-infrastructure.md](production-infrastructure.md).
4. Debounce durable version creation after idle with a maximum flush interval.
5. Reopen the project on another device and converge without a live local host.

Ship this single-writer path before enabling managed multi-writer sessions. It validates persistence, authorization, recovery, and deployment behavior with a smaller conflict surface.

### Multi-writer milestone

- Add project-scoped presence and concurrent server-hosted sessions.
- Preserve an audit/version trail for every durable save.
- On reconnect, converge silently and retain a recoverable pre-merge checkpoint rather than presenting version-control choices during editing.
- Add permission-gated private viewing and editing.
- Garbage-collect abandoned session state under explicit retention and quota policies.

The current roadmap intentionally does not require Redis or Postgres as initial implementation choices. Follow the backend topology in [production-infrastructure.md](production-infrastructure.md) rather than the older assumptions embedded in historical collaboration designs.

## 5. Named team branches

Build team branches only after managed cloud projects are stable:

- Create, switch, share, and compare named branches.
- Scope live sessions and canonical Y.Docs by project and branch.
- Let maintainers consolidate a branch into the default branch through the existing visual diff.
- Offer per-measure selection plus focused collision cards when automatic convergence produces semantically competing changes.
- Append a merge version with both parents; do not rewrite the default branch.
- Add owner/editor/viewer permissions sufficient for branch creation and consolidation.

Branch proposal notifications, granular per-staff permissions, and mid-session permission-revocation recovery are post-v1.

## Decisions

1. **Canonical authority stays online.** Local guests edit only while the host is present; cloud clients edit against the managed authority.
2. **Yjs handles concurrent state; Git/version history handles durable milestones.** Do not use textual Git merge as the live collaboration algorithm.
3. **Reconnect is silent.** Preserve recovery checkpoints in history instead of asking musicians to choose a merge strategy before they can inspect changes.
4. **Comments are project data, not MNX notation.** Their persistence format follows the project-format decision.
5. **Public views are static.** A read-only share does not allocate a collaboration room.
6. **TURN is measurement-gated.** Clear failure UX ships before new relay infrastructure.
7. **The default branch is append-only from the product UI.** Consolidation and restore create new versions.

## Completion criteria

- Local guests receive actionable connection and identity UX, with measured evidence guiding TURN deployment.
- Public links and embeds render without an active editor or collaboration session.
- Comments round-trip with projects, synchronize live, and survive deleted anchors gracefully.
- Managed projects reopen and converge across devices without a local host.
- Managed multi-writer sessions enforce project authorization and bounded persistence.
- Team branches can be reviewed and consolidated through score-aware visual diff without rewriting history.

## Explicit non-goals

- Real-time voice, video, or general chat.
- OPFS as the canonical store for local browser projects.
- Per-staff or per-section permissions in the first managed release.
- External MCP clients acting as Y.Doc peers; MCP behavior is specified in [mcp-integration.md](../spec/mcp-integration.md).
