# Production configuration and secrets

> **Current production:** the standalone host loads API configuration from the
> root-owned `/etc/viritura/api.env` file. See
> [production-deployment.md](production-deployment.md) and
> [`deploy/api/README.md`](../../deploy/api/README.md). Railway is not
> configured; the remainder of this document records the proposed PaaS
> migration and its variable inventory.

The current host does not operate a separate secret manager. Configuration is
provisioned explicitly by the host administrator and consumed by the API
container through the protected environment file.

## Proposed Railway migration

This is intentionally a PaaS-level equivalent of Azure App Configuration plus
Key Vault injection, not a claim that Railway provides a general-purpose KMS or
HSM. Viritura needs protected runtime values, environment isolation, references
between services, and dashboard management; it does not currently need key
signing APIs or customer-managed encryption keys.

## Why Railway

- Service and shared variables are scoped per Railway environment.
- Shared and reference variables avoid duplicating settings across services.
- Sealed variable values are available to builds and deployments but cannot be
  retrieved through the dashboard, API, CLI, `railway run`, or environment
  duplication after sealing.
- Variable changes are staged for review and take effect only when deployed.
- The API, custom domain, TLS, deployment history, logs, configuration, and
  secrets can be managed without SSH.
- The Hobby plan currently costs $5 per month and includes $5 of aggregate
  resource usage. Actual API, storage, and network usage above that is billed at
  Railway's published rates.

Railway variables are not dynamically refreshed inside a running process.
Changing one creates a staged deployment change; review and deploy it to create
a new API instance with the new configuration.

## Railway project layout

Create one Railway project with isolated `staging` and `production`
environments. Initially it contains:

- `api`: the ASP.NET Core service built from `server/Dockerfile`;
- one persistent volume mounted at `/var/lib/viritura` for SQLite and ASP.NET
  Data Protection keys; and
- no Redis or central collaboration store while P2P collaboration remains
  sufficient.

Configure the API service's root directory as the repository root and its
Railway config file as `/railway.json`. The Docker build context must be the
repo root because the image builds `apps/server-ui` from the pnpm workspace
before it publishes the API. Attach the custom domain `api.viritura.com`.
Railway terminates TLS and injects configuration directly into the container.

A mounted volume prevents overlapping API deployments, so this SQLite phase can
have brief deployment downtime. That is acceptable for an invite-only alpha.
It is not a highly available database architecture.

## Variable classification

Use ordinary service or shared variables for non-sensitive configuration:

- `ASPNETCORE_ENVIRONMENT=Production`
- `PORT=8080`
- `AllowedHosts=api.viritura.com;healthcheck.railway.app`
- `Database__Provider=Sqlite`
- `DataProtection__KeysDirectory=/var/lib/viritura/data-protection-keys`
- `DataProtection__ApplicationName=Viritura`
- `Auth__RequireEmailVerification=true`
- `Auth__WebsiteBaseUrl=https://viritura.com`
- `ForwardedHeaders__KnownProxies__*` or
  `ForwardedHeaders__KnownNetworks__*`, restricted to Railway's documented
  ingress proxy addresses for the environment
- `Features__Authentication__GoogleLoginEnabled=false`
- `Features__Authentication__EmailRegistrationMode=AllowList`
- `Email__Provider=Resend`
- `Email__Resend__From`
- `Email__Resend__ReplyTo`
- `Viritura__GitHub__AppSlug`
- `Viritura__GitHub__RedirectUri`
- `Viritura__GitHub__FrontendBaseUrl`
- `Viritura__GitHub__AllowedFrontendOrigins__*`

Seal values that grant access or identify invited users:

- `ConnectionStrings__VirituraDb=Data Source=/var/lib/viritura/data/viritura.db`
- `Email__Resend__ApiKey`
- `Viritura__GitHub__ClientId`
- `Viritura__GitHub__ClientSecret`
- `Viritura__GitHub__WebhookSecret`, when webhooks are enabled
- `Authentication__Google__ClientId` and `ClientSecret`, when Google is enabled
- `Features__Authentication__EmailRegistrationAllowList__*`

The configuration inventory in
[../../deploy/api/api.env.example](../../deploy/api/api.env.example) contains
examples only, never real values.

When PostgreSQL is introduced, prefer a generated private connection reference
over copying credentials. A Railway `Postgres` service would use:

```text
ConnectionStrings__VirituraDb=${{Postgres.DATABASE_URL}}
```

For a database hosted elsewhere, seal the provider's connection string.

## Access controls and operating rules

1. Add production values directly in Railway's dashboard. Do not paste them
   into chat, agent prompts, repository files, or shell commands.
2. Seal every sensitive variable immediately after creation. Sealing cannot be
   reversed; rotation replaces the value.
3. Keep `production` changes staged until their diff and deployment source have
   been reviewed.
4. Give Railway project access only to people allowed to deploy code. Anyone
   who can alter production code can make that code transmit runtime secrets,
   even when the platform never displays them.
5. Keep staging credentials separate from production. Railway does not copy
   sealed values into duplicated or pull-request environments.
6. Rotate provider credentials at the provider first, update the sealed Railway
   variable, verify the deployment, and then revoke the old credential.
7. Schedule Railway volume backups and keep periodic off-provider SQLite
   exports. Preserve the database and Data Protection keys together.

Railway's fine-grained environment RBAC is currently an Enterprise feature.
For a solo or tightly controlled alpha workspace this is acceptable; revisit
the access model before adding broad collaborators.

## Database and collaboration upgrade triggers

Low write volume makes SQLite operationally viable; it does not make the data
replaceable. Move accounts to managed PostgreSQL when any of these becomes true:

- account loss beyond the last off-provider backup is unacceptable;
- multiple API replicas are required;
- deploy downtime from the attached volume is unacceptable;
- point-in-time recovery or managed failover is required; or
- concurrent database traffic exceeds the single SQLite writer model.

Railway's PostgreSQL template is convenient but documented as unmanaged. For a
meaningful resilience upgrade, use a managed PostgreSQL product such as
DigitalOcean Managed PostgreSQL or Supabase Pro after the server's Npgsql
provider and migrations are implemented. Supabase Free has neither production
backup guarantees nor an always-on posture suitable for this role.

Do not add Redis merely in anticipation of growth. Add it when collaboration
requires cross-instance pub/sub, server-side presence, durable room state,
queues, or rate-limit coordination. The present P2P model and a single API
instance do not require it.

## Why not Supabase or Cloudflare for configuration

Supabase Vault encrypts values stored in Postgres and exposes decrypted values
through a SQL view. It is useful for database functions, triggers, and webhooks,
but it cannot natively inject configuration into an externally hosted ASP.NET
container. Supabase's dashboard secrets are injected only into Supabase Edge
Functions. Making the API query Vault would still require a bootstrap database
credential and would move secret retrieval into application code.

Cloudflare Secrets Store is a centralized account-level store, but it is
currently an open beta whose consumers are Cloudflare Workers and AI Gateway.
Cloudflare Worker secrets and variables likewise bind only to Workers. They
cannot configure the existing long-running ASP.NET API without replacing or
proxying the backend through Workers.

None of these hosting platforms can inject configuration into the current
standalone server. The root-owned `/etc/viritura/api.env` workflow is therefore
the authoritative production configuration mechanism. Eliminating SSH
configuration management would require an explicit migration of the API runtime
to Railway, DigitalOcean App Platform, or another PaaS with native encrypted
variables.
