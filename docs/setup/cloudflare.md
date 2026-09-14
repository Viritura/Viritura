# Cloudflare production setup

Cloudflare owns Viritura's public static edge. The ASP.NET API remains on the
current host until a separate backend migration:

- Cloudflare Pages: `viritura.com` and `app.viritura.com`;
- Cloudflare DNS, CDN, TLS, DDoS protection, and Free Managed WAF rules;
- Cloudflare R2: large static/application objects at `assets.viritura.com`;
- current host nginx/API container: `api.viritura.com`.

GitHub Pages can publish static files, but Cloudflare Pages is a better
production fit here because it provides deployment previews, instant rollback,
custom response headers, SPA routing, edge caching, and direct integration with
the rest of the Cloudflare security boundary.

## Pages projects

The existing Pages projects remain connected to the GitHub repository, with
their production branch set to `main`, but automatic production deployments
must be disabled under **Settings → Builds → Branch control**. The **Deploy
Pages** GitHub Actions workflow is the deployment identity and uploads prebuilt
directories with Wrangler after smoke-testing SHA-specific Pages previews.

Create a custom Cloudflare Account API token named, for example,
`Viritura GitHub Actions Pages Production` with only:

```text
Account → Cloudflare Pages → Edit
Account resources → Include → the Viritura account
```

Do not grant DNS, Workers, R2, zone, SSL, or account-administration permissions.
Store the token as `CLOUDFLARE_API_TOKEN` in the repository's protected GitHub
`cloudflare-pages-production` Environment. Store the non-secret account
identifier there as the `CLOUDFLARE_ACCOUNT_ID` Environment variable. Restrict
the Environment's deployment branches to `main`, disable administrator bypass,
and optionally require reviewer approval. Keep this separate from the existing
`production` Environment, which owns API-host SSH credentials. Never put the
token in repository files, Cloudflare build variables, or repository-wide
Actions variables.

Automatic preview deployments remain disabled with **Preview branch control**
set to **None**. The release workflow creates `preprod-<commit>` preview branch
aliases before every production upload. For an exceptional ad hoc preview from
a trusted workstation, Wrangler can still upload a prebuilt artifact to a
synthetic preview branch:

```bash
VITE_VIRITURA_API_BASE_URL=https://api.viritura.com \
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com \
bash scripts/build-cloudflare-pages.sh editor
npx wrangler pages deploy apps/editor/dist \
 --project-name viritura-app \
 --branch cf-preview-my-pr-or-topic \
 --commit-dirty=false
```

The resulting branch alias is
`https://cf-preview-my-pr-or-topic.viritura-app.pages.dev`. Use the same
pattern for the website:

```bash
VITE_VIRITURA_API_BASE_URL=https://api.viritura.com \
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com \
bash scripts/build-cloudflare-pages.sh website
npx wrangler pages deploy dist \
  --project-name viritura-website \
  --branch cf-preview-my-pr-or-topic \
  --commit-dirty=false
```

Routine pull requests do not consume Pages build queue time. The release
workflow is path-filtered to static application, engine, package, documentation,
asset, browser-test, and build-configuration changes.

### `viritura-website`

- Project name: `viritura-website`
- Build output: `dist`
- Custom domains: `viritura.com`, `www.viritura.com`

The website build publishes the MNX project hub at `/mnx`, the playground at
`/mnx/playground`, and the public MNX Storybook at `/mnx/examples`. If the
canonical hostname should be apex-only, add a Cloudflare Redirect Rule from
`www.viritura.com` to `viritura.com`.

### `viritura-app`

- Project name: `viritura-app`
- Build output: `apps/editor/dist`
- Custom domain: `app.viritura.com`

The workflow sets the two public Vite build values directly:

```text
VITE_VIRITURA_API_BASE_URL=https://api.viritura.com
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com
```

Node 24 and pnpm 9.15.4 are pinned by the workflow and root package metadata.
The GitHub `cloudflare-pages-production` Environment supplies only the
Cloudflare account ID and API token. The runner installs the pinned Rust
toolchain and `wasm-pack` 0.14.0 before rebuilding WASM.

Configure preview builds with a staging API URL or leave authentication disabled
in previews that are built independently. The release workflow deliberately
uploads the exact production-configured bytes to its pre-production aliases so
the tested artifact and promoted artifact are identical. Its Playwright gate
holds account requests at an unauthenticated test boundary and does not test
API or OAuth behavior from preview origins; production CORS and OAuth callbacks
remain limited to canonical origins.

The `_headers` and `_redirects` files under each application's `public`
directory provide security headers, immutable caching for fingerprinted assets,
HTML revalidation, cross-origin isolation for the editor, and SPA fallback
routing. The website Pages HTTP CSP intentionally contains only
`frame-ancestors 'self'` because Astro and the MNX Storybook emit their own CSP
meta policies with generated script/style hashes. The website post-build step
removes `wasm-unsafe-eval` from every page except `/mnx/`,
`/mnx/playground/`, and `/mnx/mxl-converter/`, the three routes that instantiate
the engraving engine. It also limits Monaco's
`style-src-elem 'unsafe-inline'` allowance to the playground and converter. Keep
`apps/website/scripts/scope-content-security-policy.ts` aligned with routes that
add either runtime.

The editor uses build-generated AJV standalone validators, so its script policy
does not require exact `unsafe-eval`. The narrower `wasm-unsafe-eval` remains on
the editor, public MNX Storybook, and the two website engraving routes.
Chromium, Firefox, and Safari support that CSP source expression; CSP hashes and
nonces authorize scripts but do not authorize WebAssembly compilation. See the
[CSP Level 3 WebAssembly algorithms](https://www.w3.org/TR/CSP3/#wasm-integration)
and [MDN's `script-src` reference](https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution).

## R2 assets

Cloudflare Pages limits each static asset to 25 MiB. The editor's production
SoundFont is approximately 119 MiB, so it cannot be included in a Pages deploy.
The Cloudflare build removes that one file and the playback package loads it
from the configured asset origin.

Current public asset configuration:

1. R2 Standard bucket `viritura-assets`.
2. SoundFont object `sounds/Shan-SGM-Pro-15.sf2`.
3. Custom domain `assets.viritura.com`.
4. Public `r2.dev` development URL disabled.
5. CORS allows `GET` and `HEAD`, the `Range` request header, and exposes
   `Accept-Ranges`, `Content-Length`, `Content-Range`, and `ETag`.
6. The SoundFont is uploaded with
   `Cache-Control: public, max-age=31536000, immutable`.
7. A cache rule applies to `assets.viritura.com/sounds/*`. The filename must
   change when its bytes change so immutable caching is safe.
8. Use a bucket-scoped write token only for future asset deployment automation.
   The running editor needs no R2 credential because the SoundFont is a public
   read.

R2 Standard currently includes 10 GB-month storage, one million Class A
operations, ten million Class B operations, and Internet egress at no charge
per month. Additional Standard storage is $0.015/GB-month. R2 is also the future
home for score attachments and generated exports, but do not move ordinary
fingerprinted Vite assets there; Pages serves those directly without request or
storage charges.

Database backups should use a separate private bucket and credentials from
public application assets.

## DNS

The authoritative `viritura.com` zone is in Cloudflare. Current production DNS:

- `viritura.com` CNAME `viritura-website.pages.dev`, proxied.
- `www.viritura.com` CNAME `viritura-website.pages.dev`, proxied.
- `app.viritura.com` CNAME `viritura-app.pages.dev`, proxied.
- `assets.viritura.com` R2 custom domain for `viritura-assets`, proxied.
- `api.viritura.com` A `104.236.162.149`, DNS-only.

Keep `api.viritura.com` pointed at the existing host unless and until the API
moves. Enable DNSSEC after the static cutover has been stable long enough for a
separate DNS maintenance window.

## API edge

If the API later moves to Railway, add the exact `CNAME` and verification `TXT`
records Railway supplies for `api.viritura.com`. Allow Railway to finish
certificate validation before changing proxy behavior.

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
fingerprinting for its displayed analytics. The editor CSP allows Cloudflare's
auto-injected beacon script and RUM endpoint; if analytics is disabled in the
dashboard, those allowances can be removed in a later hardening pass. Keep the
privacy notice aligned with the production analytics processor state.

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
