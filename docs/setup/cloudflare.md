# Cloudflare production setup

> **Status: planned, not configured.** Current production uses host nginx,
> manual SSH static deployment, and a host-managed API container. See
> [production-deployment.md](production-deployment.md). This document is a
> migration runbook for a possible Cloudflare/Railway topology.

In the proposed topology, Cloudflare would own Viritura's public edge while
Railway runs the ASP.NET API:

- Cloudflare Pages: `viritura.com` and `app.viritura.com`;
- Cloudflare DNS, DNSSEC, CDN, TLS, DDoS protection, and Free Managed WAF rules;
- Cloudflare R2: large static/application objects at `assets.viritura.com`;
- Railway: `api.viritura.com`, configuration, sealed secrets, SQLite, and the
  long-running API container.

GitHub Pages can publish static files, but Cloudflare Pages is a better
production fit here because it provides deployment previews, instant rollback,
custom response headers, SPA routing, edge caching, and direct integration with
the rest of the Cloudflare security boundary.

## Pages projects

Create two Pages projects from the same Git repository. Use the v3 build image,
enable build caching, and set the production branch to `main`.

### `viritura-website`

- Root directory: repository root
- Build command: `bash scripts/build-cloudflare-pages.sh website`
- Build output: `dist`
- Custom domains: `viritura.com`, `www.viritura.com`

The website build publishes the MNX project hub at `/mnx`, the playground at
`/mnx/playground`, and the public MNX Storybook at `/mnx/examples`. Redirect
`www.viritura.com` to the apex with a Cloudflare Redirect Rule.

### `viritura-editor`

- Root directory: repository root
- Build command: `bash scripts/build-cloudflare-pages.sh editor`
- Build output: `apps/editor/dist`
- Custom domain: `app.viritura.com`

Both projects require these production build variables:

```text
NODE_VERSION=22.16.0
PNPM_VERSION=9.15.4
VITE_VIRITURA_API_BASE_URL=https://api.viritura.com
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com
```

Cloudflare's build image does not include Rust or `wasm-pack`. The repository
build script installs the pinned Rust toolchain from `engine/rust-toolchain.toml`
and `wasm-pack` 0.14.0 before rebuilding WASM. Pages builds time out after 20
minutes, so verify the first uncached build before switching DNS.

Configure preview builds with a staging API URL or leave authentication disabled
in previews. Do not point arbitrary preview origins at production auth: the API
uses an explicit CORS allow-list and production OAuth callbacks use canonical
origins.

The `_headers` and `_redirects` files under each application's `public` directory
provide security headers, immutable caching for fingerprinted assets, HTML
revalidation, cross-origin isolation for the editor, and SPA fallback routing.

## R2 assets

Cloudflare Pages limits each static asset to 25 MiB. The editor's production
SoundFont is approximately 119 MiB, so it cannot be included in a Pages deploy.
The Cloudflare build removes that one file and the playback package loads it
from the configured asset origin.

1. Create an R2 Standard bucket named `viritura-assets`.
2. Upload the SoundFont at `sounds/Shan-SGM-Pro-15.sf2`.
3. Attach the custom domain `assets.viritura.com`.
4. Disable the public `r2.dev` development URL.
5. Configure CORS for `GET` and `HEAD` from `https://app.viritura.com` and
   `https://viritura.com`.
6. Add a cache rule for `assets.viritura.com/sounds/*` with a long edge/browser
   TTL. The filename must change when its bytes change so immutable caching is
   safe.
7. Use a bucket-scoped write token for deployments. The running editor needs no
   R2 credential because the SoundFont is a public read.

R2 Standard currently includes 10 GB-month storage, one million Class A
operations, ten million Class B operations, and Internet egress at no charge
per month. Additional Standard storage is $0.015/GB-month. R2 is also the future
home for score attachments and generated exports, but do not move ordinary
fingerprinted Vite assets there; Pages serves those directly without request or
storage charges.

Database backups should use a separate private bucket and credentials from
public application assets.

## DNS and API edge

Move the authoritative zone to Cloudflare and enable DNSSEC after the nameserver
change is stable.

Pages custom-domain setup creates the website/editor records. For Railway, add
the exact `CNAME` and verification `TXT` records Railway supplies for
`api.viritura.com`. Allow Railway to finish certificate validation before
changing proxy behavior.

Proxy `api.viritura.com` through Cloudflare when Railway's custom domain is
healthy:

- use SSL/TLS mode **Full (strict)**;
- do not cache `/auth/*`, `/account/*`, `/github/*`, `/live/*`, `/health`, or
  other API responses;
- preserve WebSocket support for `/live/signal`;
- enable the Free Managed WAF ruleset and review sampled Security Events; and
- use the one available Free-plan rate-limit rule only for a carefully selected
  high-abuse endpoint, retaining ASP.NET rate limiting as the authoritative
  application control.

Cloudflare is defense in depth, not the API's authentication or authorization
boundary.

## Optional Cloudflare services

### Turnstile

Turnstile Free supports up to 20 widgets and unlimited challenges. Add it only
when unrestricted registration or abuse demonstrates a need. Validate every
response server-side in the Railway API; hiding a submit button is not a
security boundary. Email verification and API rate limits remain required.

### Web Analytics

Cloudflare Web Analytics is free and does not use cookies, local storage, or
fingerprinting for its displayed analytics. Defer enabling its browser beacon
until the privacy notice accurately discloses production processors and
analytics. Edge traffic analytics are still useful without adding application
analytics code.

### Workers, Durable Objects, Queues, KV, and D1

Do not add these initially:

- Workers are useful later for small edge endpoints or signed R2 upload flows,
  not for replacing the current ASP.NET API.
- Durable Objects are a plausible future room coordinator if collaboration
  becomes server-authoritative, but the current P2P design does not need them.
- Queues are useful for asynchronous exports or email jobs only after those
  workloads exist.
- KV is suited to read-heavy edge configuration, not account records.
- D1 would duplicate the existing EF Core persistence architecture and require
  a backend rewrite.

Adopt a Cloudflare product when it removes a measured bottleneck or enables a
specific feature, not merely because it shares the provider.
