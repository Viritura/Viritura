# Production Infrastructure Plan

> **Status: proposed migration, not active.** Viritura currently runs on a
> standalone nginx host and deploys static bundles over SSH. Cloudflare Pages,
> R2, and Railway are not configured. See
> [../setup/production-deployment.md](../setup/production-deployment.md) for the
> authoritative production runbook.

Target deployment topology for Viritura's public alpha and beyond. Optimizes for **low ops burden**, **predictable cost**, and **no premature infrastructure**. The initial database workload is mostly user accounts, while live collaboration remains peer-to-peer.

**Rollout strategy: put the API on a small PaaS, keep SQLite while writes are light, and add managed Postgres or Redis only when a concrete reliability or scaling trigger appears.**

---

## Topology

```
Cloudflare (DNS, WAF, DDoS, CDN, TLS — orange-cloud every record)
├── viritura.com           → Cloudflare Pages   (marketing site, static)
├── app.viritura.com       → Cloudflare Pages   (editor SPA, static)
├── api.viritura.com       → Railway             (.NET API, long-running)
│                              └── persistent volume (SQLite + Data Protection keys)
└── assets.viritura.com    → Cloudflare R2       (large public assets)
```

**Two vendors (Cloudflare + Railway), approximately $5–15/month to start.**
Railway's variables and sealed variables provide provider-managed application
configuration and secret injection, so routine production configuration does
not require SSH.

---

## Service choices and rationale

### Marketing site & editor SPA → Cloudflare Pages

`apps/website` and `apps/editor` both produce static Vite builds. Pages is purpose-built for this and beats DO App Platform's static tier on every axis that matters:

- Truly free at our scale (unlimited bandwidth, 500 builds/mo, 100 custom domains).
- Global edge — instant loads worldwide, not pinned to one DO region.
- Automatic preview deployments per PR (every PR gets its own URL).
- Faster builds than App Platform for static output.
- SPA routing via a one-line `_redirects` file (`/* /index.html 200`).

Use two Pages projects, one for each production origin. The editor's 119 MiB
SoundFont exceeds Pages' 25 MiB per-file limit, so the Cloudflare build omits it
and playback loads it from `assets.viritura.com`. The complete project settings
and build commands are in [../setup/cloudflare.md](../setup/cloudflare.md).

### API → Railway

`server/Viritura.Api` is a long-running .NET process, so it needs a container
runtime rather than Cloudflare Workers or Supabase Edge Functions. Railway:

- builds the existing Dockerfile directly from the monorepo;
- provides custom domains, automatic TLS, deployment logs, and health-checked
  rollouts;
- manages ordinary, shared, referenced, and sealed variables in its dashboard;
- isolates staging and production environments; and
- starts at $5/month with the Hobby plan's included $5 usage credit.

Sealed variables are the closest fit among the shortlisted providers to the
deployment-secret portion of Azure Key Vault: they are injected into builds and
runtimes but cannot be read back through Railway's UI, API, CLI, or local-run
commands. They are not a general-purpose KMS and do not provide cryptographic
key operations.

### Database → SQLite first, managed Postgres when justified

For an invite-only alpha, the durable server-side data is primarily accounts,
OAuth connections, and authentication state. The write rate is low and a single
SQLite writer is sufficient. Store the database and ASP.NET Data Protection
keys on one Railway volume, schedule Railway volume backups, and keep periodic
off-provider exports.

Low write volume does **not** make account data disposable. Move to managed
Postgres when recovery objectives, multiple API replicas, deployment downtime,
or concurrent writes justify it. Railway's Postgres template is convenient but
documented as unmanaged; use DigitalOcean Managed PostgreSQL or Supabase Pro
when the goal is a meaningful resilience upgrade. The server's Npgsql provider
and migrations must be implemented before that move.

### Collaboration → P2P, no Redis initially

The existing peer-to-peer collaboration model is sufficient while the API has
one instance and the server does not own durable room state. Redis would add
cost and another failure mode without improving that path. Add Redis only for a
specific requirement such as cross-instance pub/sub, server-side presence,
durable room state, queues, or distributed rate-limit coordination.

### Blob storage → Cloudflare R2

R2 is required on day one for the 119 MiB SoundFont because Pages assets are
limited to 25 MiB. It is also the future home for MNX attachments, audio/PDF
exports, and other large objects.

- S3-compatible — use the AWS SDK in .NET, just swap the endpoint.
- **Zero egress fees** — critical because users will download scores, exports, and soundfonts frequently. DO Spaces' $5 flat / 1TB egress would dominate the bill at scale.
- Globally cached automatically (it's Cloudflare).
- Custom domain (`assets.viritura.com`) integrates with Cloudflare Cache and WAF.

**Day-one safety toggles (mandatory):**

1. Use a dedicated public `viritura-assets` bucket and disable its `r2.dev`
   development URL after attaching the custom domain.
2. Use immutable, versioned filenames when object bytes change; do not overwrite
   a long-cached asset in place.
3. Use a bucket-scoped write token only in the deployment path. Public browser
   reads require no credential.
4. Keep database backups in a separate private bucket and an additional
   off-provider location; R2 lifecycle rules are not object versioning.

### CDN / DNS / WAF / DDoS → Cloudflare (free tier)

Cloudflare provides authoritative DNS, DNSSEC, CDN, TLS, DDoS mitigation, the
Free Managed WAF ruleset, custom rules, and one Free-plan rate-limit rule. Proxy
the Railway API after its custom-domain certificate is healthy, use Full
(strict) TLS, bypass caching for API routes, and preserve WebSocket upgrades.

### Production configuration and secrets → Railway variables

Use ordinary Railway variables for non-sensitive configuration and sealed
variables for credentials and invitation lists. Changes are staged, reviewed,
and deployed through Railway rather than copied over SSH. The exact
classification and operating rules are in
[../setup/production-secrets.md](../setup/production-secrets.md).

---

## What we explicitly considered and rejected

| Option                                   | Why not for the initial configuration/runtime job                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase Vault / Edge Function secrets   | Vault serves secrets through SQL and Edge Function secrets bind only to Supabase functions. Neither injects values into the existing ASP.NET container without a bootstrap credential and custom code. |
| Cloudflare Secrets Store                 | Currently open beta and limited to Workers and AI Gateway. It cannot inject configuration into a Railway or standalone ASP.NET container.                                                              |
| Firebase / Supabase full BaaS            | Viritura already has ASP.NET Identity, a .NET API, and P2P CRDT collaboration. Replacing them would be a migration, not infrastructure setup.                                                          |
| Railway Postgres as a resilience upgrade | Easy and inexpensive, but Railway documents the template as unmanaged. It is not equivalent to a managed HA database with PITR and failover.                                                           |
| Azure / AWS / GCP                        | Stronger KMS and IAM capabilities, but more complexity and cost than this alpha requires.                                                                                                              |
| Standalone server                        | Cheap and already available, but routine configuration still requires privileged host access. Keep only as a rollback path after Railway cutover.                                                      |

---

## Cost estimate (initial)

| Service                     | Tier                   | Monthly             |
| --------------------------- | ---------------------- | ------------------- |
| Cloudflare Pages (×2 sites) | Free                   | $0                  |
| Cloudflare DNS / CDN / WAF  | Free                   | $0                  |
| Cloudflare R2               | 119 MiB public asset   | $0 within free tier |
| Railway API + SQLite volume | Hobby + measured usage | ~$5–15              |
| Redis                       | Not deployed           | $0                  |
| Managed Postgres            | Deferred               | $0                  |
| **Total**                   |                        | **~$5–15**          |

Railway is usage-priced above its included credit, so configure usage alerts and
a hard limit appropriate for an alpha.

---

## Phased rollout

The end-state topology is the target, not a day-one requirement. We migrate **one piece at a time** as the droplet phase starts hurting in concrete, identifiable ways. Each migration is independent and reversible.

### Phase 0 — Railway API + SQLite (start here)

- Move the website and editor to separate Cloudflare Pages projects.
- Put the oversized production SoundFont in R2 behind `assets.viritura.com`.
- Deploy the existing API container to Railway.
- Mount one volume at `/var/lib/viritura` for SQLite and Data Protection keys.
- Store configuration in Railway variables and credentials in sealed variables.
- Enable Railway volume backups and periodic off-provider exports.
- Keep collaboration P2P and run one API instance.
- Keep the current standalone deployment available as a short-lived rollback
  path during cutover, then retire it.

**Cost: approximately $5–15/month plus negligible R2 usage.**

### Phase 1 — Move accounts to managed Postgres

**Trigger:** any of:

- Losing account changes since the most recent export is unacceptable.
- Multiple API replicas are required.
- Brief downtime on volume-attached deployments is unacceptable.
- Point-in-time recovery, managed upgrades, or managed failover is required.
- SQLite lock contention appears in measurements.

Implement the Npgsql provider and EF Core migrations, select a genuinely managed
Postgres service, migrate during a short maintenance window, and replace the
sealed connection string. Supabase Pro is viable here; DigitalOcean Managed
PostgreSQL is currently less expensive and offers a more direct API/database
pairing if the API is later moved there.

### Phase 2 — Add Redis only if collaboration centralizes

Do not add Redis for account storage or the current peer-to-peer path. Add it
only when one of these is implemented:

- multiple signaling/API replicas requiring pub/sub;
- server-authoritative presence or room membership;
- durable collaboration snapshots or event queues;
- distributed rate limiting; or
- background jobs that require a shared queue.

### Phase 3 — Add edge services only for concrete needs

Turnstile, Workers, Durable Objects, Queues, KV, and D1 are not prerequisites.
Turnstile becomes useful when signup abuse appears. Durable Objects are a
possible future room coordinator if collaboration becomes server-authoritative.
The remaining products should wait for a workload that needs them.

### Keeping the Postgres migration easy

Keep the SQLite-to-Postgres cutover cheap by enforcing these constraints now:

1. **Use EF Core migrations exclusively.** Do not make ad-hoc production schema
   changes.
2. **Keep provider-specific SQL out of application queries.** Exercise tests
   against both SQLite and Postgres once Npgsql lands.
3. **Keep connection strings in platform configuration.** The cutover should
   not require a source-code change.
4. **Keep blobs out of the relational database.** Put score exports and other
   large objects in R2.
5. **Build and rehearse an explicit export/import tool.** SQLite cannot be
   moved with `pg_dump`; data must be transformed into the Postgres schema and
   verified before DNS or traffic cutover.

---

## Recovery posture

| Failure mode                             | Phase 0 (Railway + SQLite)                                                                | Phase 1+ (managed Postgres)                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Railway volume failure                   | Restore the latest off-provider SQLite export and Data Protection keys                    | Provider replication or backup restore              |
| Accidental DB row delete / bad migration | Restore a Railway volume snapshot or off-provider export; lose changes since that point   | Use the provider's PITR window                      |
| Accidental blob delete or overwrite      | R2 versioning + lifecycle                                                                 | Same                                                |
| API deployment failure                   | Railway keeps the previous healthy deployment; volume attachment can cause brief downtime | Previous healthy deployment remains available       |
| Region outage                            | Single-region; wait or restore elsewhere                                                  | Provider-dependent; pay for cross-region only later |
| Provider outage affecting secrets        | Running instances retain injected variables; new deployments may wait                     | Same                                                |
| Vendor lock-in                           | Docker + SQLite export + environment variables                                            | Docker + standard Postgres + environment variables  |

---

## Initial setup order

1. Point `viritura.com` nameservers at Cloudflare (one-time).
2. Cloudflare R2 → create `viritura-assets`, upload the SoundFont, attach `assets.viritura.com`, configure CORS/cache rules, and disable `r2.dev` access.
3. Cloudflare Pages × 2 → use the settings in [../setup/cloudflare.md](../setup/cloudflare.md), then attach `viritura.com` and `app.viritura.com`.
4. Railway → create the Viritura project and `staging`/`production` environments.
5. Railway API → connect the repository, set root to the repository root, config `/railway.json`, mount a volume at `/var/lib/viritura`, and enter variables according to [../setup/production-secrets.md](../setup/production-secrets.md).
6. Railway API → attach `api.viritura.com`, then update Cloudflare DNS with the records Railway supplies and proxy it only after certificate validation.
7. Enable Railway volume backups, create an off-provider export procedure, and run restore verification.
8. Smoke-test authentication, signaling, restart persistence, and rollback before opening invitations.

---

## Open questions

- **SQLite export destination:** choose encrypted R2 or another off-provider target and automate restore drills rather than treating provider snapshots as the only copy.
- **Managed database selection:** compare recovery guarantees and total cost when a trigger occurs; do not choose based on write throughput alone.
- **Observability:** Railway's built-in logs and metrics are enough to start. Add external uptime monitoring because Railway health checks run during deployment, not continuously.
