# Read-only score sharing

> **Status:** Proposed. This plan covers durable, read-only previews of an MNX
> document. It does not cover live editing, review comments, or managed cloud
> projects.
>
> **Related:** [`crdt-collaboration.md`](crdt-collaboration.md),
> [`git-versioning.md`](git-versioning.md),
> [`production-infrastructure.md`](production-infrastructure.md),
> [`../spec/auth.md`](../spec/auth.md)

## Goal

A signed-in user can publish the current state of an MNX document and send a
stable URL to someone who only needs to view it. The recipient must not need
Viritura, GitHub, an account, or a live connection to the author.

This is a publication workflow, not a collaboration workflow:

- publishing captures an explicit, immutable document revision;
- subsequent edits remain private until the owner updates the publication;
- the viewer cannot edit the owner's document;
- opening a publication does not allocate a Yjs room or require the author to
  be online; and
- only canonical MNX is published, never a `.viritura` container, `.git`
  history, local handles, comments, or other project-private state.

The existing `@viritura/score-viewer-react` package is the rendering surface.
Layout remains client-side, so the service stores and transfers small text
documents rather than rendered pages.

## Recommendation

Use the existing Viritura API as the policy boundary and a **separate private
Cloudflare R2 bucket** as the document store.

```
Owner's editor
    │ authenticated publish/update/revoke
    ▼
Viritura API ───── metadata, ownership, quotas ───── database
    │
    └──── immutable MNX revisions ───── private R2 bucket

Recipient
    │ public id + optional fragment capability
    ▼
Cloudflare Pages viewer shell
    │ bounded read request
    ▼
Viritura API ───── authorized MNX response ───── score viewer
```

Do not put published documents in the existing public asset bucket. A private
bucket keeps access policy, revocation, deletion, and future permission changes
under application control. Bucket credentials remain in the API deployment;
the browser never receives R2 credentials.

Because MNX documents are small, the first release should stream them through
the API rather than issue direct R2 URLs. This makes revocation immediate and
avoids signed-URL leakage, CORS configuration, and a second authorization
surface. If measured bandwidth or API load later warrants direct delivery, the
API may issue very short-lived signed URLs after the same authorization check.

## Options considered

| Option                    | Advantages                                                                                                                                                 | Problems                                                                                                                                                                                     | Decision                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GitHub public repository  | Existing GitHub integration, no new blob store, visible version history                                                                                    | Requires a public repository, exposes repository/account/history, is awkward for non-technical recipients, and makes Viritura permissions, deletion, and stable viewer URLs depend on GitHub | Keep as an explicit source/versioning workflow, not the primary share feature |
| GitHub private repository | Existing repository permissions                                                                                                                            | Every viewer needs an authorized GitHub account and repository access; unsuitable for a simple preview link                                                                                  | Not a preview-sharing solution                                                |
| GitHub Gist or raw URL    | Fast prototype                                                                                                                                             | Introduces another OAuth scope and storage contract, leaks provider identity, and provides weak lifecycle and abuse controls                                                                 | Reject                                                                        |
| Public R2 object URL      | Cheap, simple, cacheable                                                                                                                                   | Anyone who learns the object key bypasses Viritura policy; revocation, private links, metadata, quotas, and deletion are hard to enforce consistently                                        | Reject                                                                        |
| Cloudflare Worker plus R2 | Can run at the edge                                                                                                                                        | Duplicates authentication and authorization already owned by the ASP.NET API and creates another backend/runtime to operate                                                                  | Revisit only if measured scale requires it                                    |
| API plus private R2       | Reuses Viritura accounts and security controls, supports all visibility modes, preserves immediate revocation, and fits the production infrastructure plan | Requires metadata tables, object lifecycle handling, and an R2 client in the API                                                                                                             | **Selected**                                                                  |
| Store MNX bytes in SQLite | Smallest infrastructure spike                                                                                                                              | Grows backups and database I/O with user content and creates a migration to object storage almost immediately                                                                                | Permit only in automated tests, not production                                |

GitHub can still offer **Open repository** or **Share repository** alongside
publication when a project already has a remote. That action should be named
and presented separately so users understand that repository visibility and
history are controlled by GitHub, not by a Viritura share.

## Visibility and permission model

Use product language that describes the actual guarantee:

| Mode                 | Who can open it                                  | Discovery                                                 | Initial release                     |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------- | ----------------------------------- |
| Draft                | Owner only                                       | None                                                      | Internal state before first publish |
| Anyone with the link | Anyone holding the capability link               | No listing; `noindex`; not included in sitemaps           | **Yes; default**                    |
| Public               | Anyone with the stable URL                       | Eligible for indexing and a future public profile/gallery | Later (Phase 3)                     |
| Restricted           | Specific signed-in Viritura users or invitations | None                                                      | Later                               |

Do not call **Anyone with the link** "private." It is an unlisted bearer
capability: recipients can forward it, and Viritura cannot prevent screenshots
or downloaded copies. The publish dialog must state this directly.

Public and link-access views are read-only. "Read-only" prevents mutation of the
owner's publication; it does not imply copy protection. A later **Make a copy**
action may import the published MNX into a separate local or cloud project
without granting access to the source project.

### Capability-link shape

Use a random public share id in the path and put the unlisted capability in the
URL fragment:

```
https://app.viritura.com/s/<public-id>#access=<secret>
```

The Pages shell receives only `<public-id>`. Client code reads the fragment and
sends the secret in a dedicated request header. URL fragments do not enter HTTP
request targets, reverse-proxy logs, or referrer headers.

- Generate the public id and secret with a cryptographically secure random
  generator, each with at least 128 bits of entropy.
- Store only a versioned hash of the secret.
- Compare hashes in constant time.
- Do not accept the secret in a query parameter.
- Let the owner rotate the link, invalidating the previous secret immediately.
- Return the same not-found response for an unknown share, revoked share, or
  invalid secret so the endpoint does not disclose share existence.

Public publications use the same opaque public id but do not require the
fragment secret. Opaque ids prevent enumeration even though public content is
not confidential.

Restricted sharing must use account authorization or a separately modeled
invitation. Do not overload the bearer capability with an email address or
claim that it verifies recipient identity.

## Publication and revision semantics

A publication has a stable URL and points at one immutable revision.

1. **Publish** serializes the current canonical MNX and creates both the
   publication and its first revision.
2. Editing the local project does not change the published view.
3. **Update published version** uploads a new immutable revision and atomically
   moves the publication pointer after the object write succeeds.
4. **Unpublish** makes reads unavailable immediately and schedules object
   deletion.
5. Changing visibility preserves the stable public id. Entering or leaving
   link-access mode rotates the capability secret.

The API must never overwrite an existing revision object. A stable manifest
response may be revalidated with an ETag; revision content is content-addressed
or revision-addressed and immutable. This avoids readers seeing metadata for
one revision and bytes from another.

The initial product need not expose revision history to viewers. Retaining a
small number of superseded objects for recovery is an operations policy, not a
promise that old revisions remain publicly addressable.

## Data model

Names are illustrative; final names should follow the server's established EF
Core conventions.

### `PublishedScore`

- internal primary key;
- random public id with a unique index;
- owner user id with cascade-independent deletion handling;
- visibility enum;
- current revision id;
- optional capability-secret hash and hash version;
- optional owner-approved display title and attribution;
- created, updated, published, and revoked timestamps; and
- optimistic concurrency token.

### `PublishedScoreRevision`

- internal primary key and publication id;
- opaque R2 object key;
- SHA-256 content digest;
- byte length;
- source document or Git commit identifier when available, for owner-facing
  traceability only;
- created timestamp; and
- server-recognized MNX media/schema version.

Use an opaque object key such as
`shares/<partition>/<share-id>/<revision-id>.mnx`. Never derive an object key
from a user-supplied title or filename.

The database is authoritative for access. The bucket is not a directory of
publications and object existence does not grant access.

## HTTP surface

Exact route naming can follow existing controller conventions, but the
capabilities should remain separate:

### Owner operations

- `POST /shares` — authenticated and antiforgery-protected; validates and
  publishes one MNX revision.
- `PUT /shares/{publicId}/content` — owner only; creates a revision and switches
  the current pointer.
- `PATCH /shares/{publicId}` — owner only; changes title, attribution, or
  visibility and rotates a capability when required.
- `DELETE /shares/{publicId}` — owner only; revokes immediately and enqueues
  object cleanup.
- `GET /shares/mine` — owner only; returns metadata, never capability hashes.

Creation and capability rotation return the complete share URL once. If the
owner later loses that URL, the service rotates the capability and returns a
new link; it does not retain a recoverable bearer secret. It must never return
the stored hash as though it were usable.

### Viewer operations

- `GET /shares/{publicId}` — returns bounded public metadata and the current
  immutable revision identifier after the visibility check.
- `GET /shares/{publicId}/revisions/{revisionId}/content` — returns
  `application/mnx+json` after applying the same visibility check.

For link-access shares, both requests require the capability header. Do not put
the document in an HTML response. The viewer treats all document strings as
data and does not render MNX text or metadata through unsafe HTML.

Public manifest responses can use short shared-cache lifetimes plus ETag
revalidation. Link-access and restricted responses use `Cache-Control:
private, no-store`. Revision bytes for public shares can be cached immutably
only while the URL remains authorization-aware; CDN configuration must not
create a route that continues serving after revocation.

## Viewer experience

Add a code-split route before the editor boot sequence:

```
/s/<public-id>
```

It mounts a small publication shell around `ScoreViewer`, not the full editable
workspace. The shell provides:

- title and optional attribution;
- score-definition selection for documents with multiple renderings;
- page/spread/horizontal view controls, zoom, and fit;
- clear loading, unavailable, malformed-document, and unsupported-version
  states;
- optional **Download MNX**;
- optional **Make a copy** as a separate import flow; and
- owner controls when the signed-in viewer owns the publication.

The first release should not include editing controls, presence, comments,
playback, analytics that require cross-site identifiers, or third-party embeds.
An embeddable chrome-free route can follow after CSP, framing policy, and abuse
behavior have been reviewed explicitly.

The owner's editor gets a **Share** action with:

1. visibility selection, defaulting to **Anyone with the link**;
2. a disclosure that document title, composer, copyright, and other embedded
   MNX metadata are included;
3. **Publish and copy link** for the first revision;
4. **Copy link**, **Update published version**, **Change access**, and
   **Unpublish** thereafter; and
5. the local save state and published revision state shown separately.

Publishing must never happen automatically on save or Git push.

## Privacy and security requirements

### Upload boundary

- Require an authenticated, verified account to publish.
- Accept only UTF-8 JSON with the MNX media type.
- Apply a configurable request-body limit before buffering. Start with the
  existing 16 MiB collaboration-snapshot ceiling unless product measurements
  justify a lower limit.
- Parse and validate the document server-side against the supported MNX shape;
  client validation is not a security boundary.
- Reject duplicate JSON keys, invalid Unicode, excessive nesting, and trailing
  content according to one documented canonical policy.
- Do not accept ZIP containers, arbitrary attachments, HTML, scripts, remote
  fonts, or remote media in the publication endpoint.
- Ensure the viewer does not fetch arbitrary URLs referenced by vendor
  extensions.

### Privacy

- Publish only the serialized MNX document, not project metadata or history.
- Show the owner the metadata fields that recipients will see before the first
  publish.
- Do not expose the owner's email, GitHub identity, internal user id, source
  repository, or commit id.
- Make attribution opt-in independently of account profile identity.
- Keep link-access pages out of sitemaps and emit `noindex, nofollow`.
- Avoid third-party scripts on capability-link pages. A fragment secret is
  protected from servers and referrers, not from JavaScript executing in the
  page.
- Document retention for revoked shares, account deletion, backups, and abuse
  holds in the privacy policy before general availability.

### Abuse and cost controls

- Apply separate per-account publication and update limits, per-source anonymous
  read limits, maximum active-share count, and maximum stored bytes.
- Make initial limits configurable. A reasonable alpha starting point is 20
  active publications and 100 MiB of current content per verified account, with
  superseded-revision retention bounded separately.
- Count storage from database metadata rather than listing the bucket.
- Reject new writes when quota accounting is unavailable; do not publish first
  and reconcile later.
- Use conditional object creation and database concurrency so retries cannot
  create conflicting current revisions.
- Run a reconciliation job for orphaned objects and metadata whose object is
  missing.
- Keep the bucket non-public, disable `r2.dev`, use least-privilege credentials,
  and separate production and non-production buckets.
- Add a report-abuse path, an administrative disable/takedown action, and
  auditable owner/admin lifecycle events before public discovery.
- Return generic recipient errors while giving the owner actionable validation
  and quota errors.

Client-side rendering bounds server CPU, but malformed inputs can still consume
recipient CPU and memory. Validation, document-size limits, parser limits, and
viewer error boundaries are therefore required even for public data.

## Failure and deletion behavior

- If object upload fails, do not create or advance the visible publication.
- If the database transaction fails after object upload, leave an orphan marker
  or deterministic object key for reconciliation.
- If R2 is unavailable during a read, return an unavailable response rather
  than a misleading not-found response.
- Unpublish changes database authorization first, then deletes objects
  asynchronously. A deletion retry must not make the share readable again.
- Account deletion revokes publications synchronously before scheduling
  physical deletion.
- Database backups must not contain document bytes or bearer secrets.
- Object-store backups and lifecycle policies must match the promised deletion
  window.

## Delivery plan

### Phase 0 — GitHub Gist preview

Before provisioning Viritura storage, ship a deliberately constrained,
replaceable proof of concept:

- The user manually creates a public or secret GitHub Gist containing exactly
  one `.mnx` file.
- **File > Share** accepts the main Gist URL, validates the document, and
  produces a Viritura viewer URL.
- Viewer URLs follow the latest Gist revision by default. An optional
  `revision=<sha>` query parameter pins a link to the current revision.
- The Gist id remains in the URL fragment so it does not enter Viritura's Pages
  request logs or referrer headers.
- A dedicated read-only route composes `@viritura/score-viewer-react` with the
  existing playback provider and transport controls; it does not initialize the
  editable workspace or live collaboration.
- The viewer supports download and links to the source Gist.

Both public and secret Gists are publicly retrievable by URL. Secret Gists are
unlisted, not private; GitHub identity and Gist history remain visible. The
dialog and viewer must disclose this, and this phase must not be described as
private or restricted sharing.

Treat Gist loading as one `PublishedMnxSource` implementation. The permanent
R2-backed publication service replaces that source without replacing the
viewer route or playback surface.

### Phase 1 — service and viewer vertical slice

- Add a blob-store interface with an R2 implementation and an in-memory test
  implementation.
- Add EF Core publication/revision entities and migration.
- Add authenticated create, owner list, anonymous read, and revoke endpoints.
- Add server-side bounded MNX validation and focused authorization, quota,
  rollback, and object-lifecycle tests.
- Add the code-split `/s/<public-id>` viewer route using
  `@viritura/score-viewer-react`.
- Ship **Anyone with the link** only, behind a feature flag, with publish, copy,
  open, and unpublish flows.

This is a better proof of concept than GitHub: it tests the actual viewer,
permission, privacy, object-storage, and revocation boundaries without first
shipping provider-specific behavior that must be replaced.

### Phase 2 — durable publication management

- Add update-as-new-revision, stable links, capability rotation, optimistic
  concurrency, configurable quotas, and orphan reconciliation.
- Add owner-facing publication status and a clear stale-publication indicator
  after local edits.
- Add download and make-a-copy flows.
- Add production dashboards for publish failures, read failures, R2 bytes,
  active publications, bandwidth, revocations, and abuse-rate-limit events.

### Phase 3 — public visibility

- Add **Public** visibility without requiring a gallery.
- Add owner-approved title/attribution, Open Graph metadata, canonical URLs,
  and search-index policy.
- Add moderation/takedown tooling and terms/privacy updates before enabling
  indexing or public profiles.

### Phase 4 — restricted access and embeds

- Add account ACLs or expiring invitations for genuinely restricted sharing.
- Add chrome-free embedding only after defining `frame-ancestors`, embed-origin
  policy, referrer policy, and whether capability shares may be embedded.

Do not make managed cloud projects a prerequisite. A local standalone MNX file
and a Git-backed folder project should both be publishable by serializing their
current canonical document.

## Validation matrix

At minimum, automated coverage should prove:

- owner create, update, rotate, visibility change, list, and revoke;
- non-owner mutation denial;
- public access, valid capability access, and invalid/missing capability
  indistinguishability;
- fragment secrets never appear in API URLs or logs generated by application
  code;
- malformed, oversized, deeply nested, and unsupported documents are rejected;
- failed object writes do not create visible publications;
- failed metadata writes are reconciled without data exposure;
- concurrent updates leave exactly one current revision;
- revocation denies reads before object deletion completes;
- public and capability responses emit the intended cache and indexing headers;
- viewer loading, unavailable, invalid-document, multiple-score, and large
  valid-document states; and
- publication renders without initializing live collaboration or the editable
  workspace.

## Decisions

1. A share is a static published MNX revision, not a live Y.Doc.
2. Viritura owns the stable viewer URL and authorization policy.
3. Published bytes live in a dedicated private R2 bucket behind the API.
4. **Anyone with the link** is the default; it is unlisted, not private.
5. True restricted sharing requires identity-based authorization and is
   deferred.
6. GitHub sharing remains a distinct, opt-in repository workflow.
7. Publishing is explicit and does not follow local saves automatically.
8. Revocation is database-first and immediate from the application's point of
   view.

## Completion criteria

- A user can publish the current MNX document and copy a stable read-only link.
- An anonymous recipient can render it without an account or live author.
- Local edits remain unpublished until the owner explicitly updates the share.
- The owner can rotate access or unpublish with immediate effect.
- No published link exposes project history, provider credentials, account
  identifiers, or a public object-store URL.
- Size, schema, account, storage, request-rate, and retention limits bound the
  service's cost and abuse surface.
